# Low-Level Design — Graft

## 1. Architecture overview

```
┌─────────────────────┐        HTTP/JSON        ┌──────────────────────────┐
│  client/ (Vite+React) │ ───────────────────────▶ │  server/ (Express, Node) │
│  SPA, fetch() only    │ ◀─────────────────────── │                          │
└─────────────────────┘                            │  ┌────────────────────┐ │
                                                     │  │ store.ts (persist) │ │
                                                     │  │  data/ (files)     │ │
                                                     │  └────────────────────┘ │
                                                     │  ┌────────────────────┐ │
                                                     │  │ operations.ts      │ │
                                                     │  │ diff.ts            │ │
                                                     │  │ merge.ts           │ │
                                                     │  └────────────────────┘ │
                                                     └──────────────────────────┘
```

No database server, no auth layer, no background jobs. The server is a single Express process; the client is a static SPA that talks to it over `fetch`.

## 2. Module responsibilities (server)

| File | Responsibility |
|---|---|
| `types.ts` | Domain model: `Schema`, `Table`, `Column`, `IndexDef`, `ConstraintDef`, `Repo`, `Branch`, `Commit`. No logic. |
| `operations.ts` | Pure functions `(schema, params) → newSchema` for every schema edit (`createTable`, `addColumn`, `retypeColumn`, …). Never mutates input. Throws `OpError` for invalid ops (duplicate names, missing tables). |
| `diff.ts` | `diffSchemas(before, after) → SchemaDiff`. Pure, two-way structural diff keyed by entity `id`. |
| `merge.ts` | `merge3(base, ours, theirs, resolutions?) → { schema, conflicts, entities, provenance }`. The 3-way merge engine, field-level (detailed in §4). Pure. |
| `validate.ts` | `validate(schema, provenance) → Violation[]`. Checks a merged schema against the invariants `operations.ts` upholds, and nothing else (§4.6). Pure. |
| `store.ts` | The only module touching disk. Repo/branch/commit CRUD, `findMergeBase` (common-ancestor BFS), `isAncestor` (fast-forward detection). Backed by plain files on disk — see §6 for the layout. |
| `index.ts` | Express routes. Thin — parses request, calls into the modules above, translates `OpError`/thrown errors into HTTP status codes. |

All of `operations.ts`, `diff.ts`, `merge.ts`, and `validate.ts` are pure and side-effect free by design — this is what makes them unit-testable without spinning up the server or the store, and what lets the merge engine be called repeatedly (once per conflict-resolution click) without any state to reset.

## 3. Diff algorithm (`diff.ts`)

`diffSchemas(before: Schema, after: Schema) → SchemaDiff`

1. Build `id → entity` maps for `before.tables` and `after.tables`.
2. Any table `id` in `after` but not `before` → `tablesAdded`.
3. Any table `id` in `before` but not `after` → `tablesRemoved`.
4. Any table `id` in both: recursively diff its `columns`, `indexes`, `constraints` (same id-map-and-compare approach, one level down) and compare `name`. If anything differs (name or any sub-collection), the table appears in `tablesChanged` with a `TableDiff` describing exactly what changed.
5. Column/index/constraint-level diffing (`diffColumns`/`diffIndexes`/`diffConstraints`) all share one generic helper, `diffCollection`, which partitions two id-keyed arrays into `added` / `removed` / `modifiedPairs` by set difference and `JSON.stringify` equality on shared ids. For each `modifiedPairs` entry, `fieldDiff` walks every own field of both objects and reports which fields differ (`{field, from, to}`).

This is a two-way diff — no common ancestor involved. It answers "what's different between these two snapshots," not "who caused it," which is exactly what the Diff tab needs.

## 4. Three-way merge algorithm (`merge.ts`)

`merge3(base: Schema, ours: Schema, theirs: Schema, resolutions: ResolutionMap = {}) → MergeResult`

The engine recurses until it runs out of levels: schema → table → entity → **field**. Stopping
one level short is what made the earlier version unusable — see `decisions.md` #5.

### 4.1 Top level — tables

For every table `id` appearing in any of `base`/`ours`/`theirs`, call `mergeTable`, which returns
either a merged `Table` or `undefined` (the table doesn't survive), plus any conflicts.

### 4.2 Presence, then content

`mergeTable` and `mergeEntitySet` both decide *presence* first, and hand anything still present
on both sides to `mergeFields`:

| base | ours | theirs | Result |
|---|---|---|---|
| absent | present | absent | include ours as-is |
| absent | absent | present | include theirs as-is |
| present | absent | absent | omit (removed on both sides) |
| present | absent | present = base | omit (ours' removal wins; theirs never touched it) |
| present | present = base | absent | omit (theirs' removal wins) |
| present | absent | present ≠ base | **conflict: `modify-delete`**, `deletedSide: "ours"` |
| present | present ≠ base | absent | **conflict: `modify-delete`**, `deletedSide: "theirs"` |
| any | present | present | **recurse into fields** — §4.3 |

`modify-delete` is the one decision that stays whole-entity: deletion isn't a field, so there is
nothing to scope it to (`decisions.md` #6). Its resolutions remain `"keep" | "delete"`.

A table's children are merged by three `mergeEntitySet` calls (`columns`, `indexes`,
`constraints`), which is what lets "ours adds `email`" and "theirs adds `phone`" merge cleanly —
different ids, handled independently.

### 4.3 `mergeFields` — the field-level merge

For each field name across the three sides (`id` excluded — identity is the key, never a merge
candidate), with base `b`, ours `o`, theirs `t`:

| condition | result |
|---|---|
| `o == t` | take it (converged, or neither side touched it) |
| base entity exists && `b == o` | take theirs (only theirs changed this field) |
| base entity exists && `b == t` | take ours (only ours changed this field) |
| otherwise | **conflict, scoped to that field** |

Comparison is `deepEqual` (JSON-string equality), so an absent optional field and an explicitly
`undefined` one compare equal — the two are indistinguishable in a stored schema. Merged fields
whose value is `undefined` are left off the entity rather than written as an explicit key, since
the result goes straight into a commit.

**The base-exists gate matters.** The two middle rows mean "this side didn't change the field",
which is meaningless without an ancestor. So in an `add-add` a field auto-merges only on exact
equality — ours creating a column with no default and theirs creating it with `default: 'x'` is
a real disagreement, not a free merge.

**Arrays are atomic.** `columnIds` on an index or constraint is one field, compared and picked
whole. Merging element-wise would produce a column *ordering* neither branch chose, and index
column order is load-bearing (`decisions.md` #18).

`add-add` is in practice unreachable: ids are random, so two branches cannot mint the same one.
The case people mean by it — both branches creating a `users` table — is two distinct ids
sharing a name, caught by §4.6 rather than raised as a conflict.

### 4.4 Conflict identity and resolution

| kind | id | resolutions |
|---|---|---|
| field conflict | `${kind}:${tableId}:${entityId}:${field}` | `"ours" \| "theirs"` |
| modify-delete | `${kind}:${tableId}:${entityId}` | `"keep" \| "delete"` |

`ConflictKind` is `table \| column \| index \| constraint`. A table's own `name` goes through
`mergeFields` like any other field, which is why there is no `table-name` kind.

Ids are computed the same way on every run, so `merge3` is safe to call repeatedly (once per
click) with a growing resolutions map; a conflict not yet in the map simply reappears. While a
field conflict is unresolved the engine provisionally emits the `ours` value, so the returned
schema is always renderable.

There is no free-text or revert-to-base option: every value in a merged schema must be traceable
to a real commit on one of the two sides.

### 4.5 `entities` and `provenance`

A field conflict carries only scalars, but the resolve card has to render the *whole* entity,
auto-merged rows included. `MergeResult` therefore also returns:

- **`entities: EntityContext[]`** — one per entity holding at least one conflict, with each
  side's full value and a per-field `FieldStatus` (`auto` + which side won, or `conflict` + its
  id). Computed **as if the resolution map were empty**, so it is identical on every call in a
  merge session. That is what keeps a decided row on screen (`decisions.md` #13) with no
  client-side state: `entities` is the stable set of cards, `conflicts` the shrinking set of
  what's still owed.
- **`provenance: Record<"tableId:entityId:field", conflictId>`** — which pick decided each
  contested field. Internal; it is stripped at the HTTP layer and surfaces only as
  `Violation.conflictIds`.

### 4.6 Validation (`validate.ts`)

Field-mixing can produce an entity neither branch had. `validate(schema, provenance)` runs on the
merged result and `store.applyBlockedReason` refuses the commit unless **both** `conflicts` and
`validation` are empty.

> The validator enforces exactly the invariants `operations.ts` already enforces, and nothing more.

Any rule beyond that set would block a merge over a state each branch could reach on its own
through ordinary editing — a worse failure than the one being fixed. Rules: unique table names;
unique column/index/constraint names within a table; non-empty names, column `type`, constraint
`definition`; index covers ≥1 column; index/constraint `columnIds` all resolve to a surviving
column. Deliberately **not** included: `primaryKey ⇒ !nullable`, because `setColumnPrimaryKey`
doesn't require it.

Each `Violation` carries `conflictIds`, looked up through `provenance`, so the UI links it to the
row to re-pick. Empty means no pick can fix it — the message says what to change on a branch
instead.

## 5. Merge-base lookup (`store.ts: findMergeBase`)

```
findMergeBase(repo, commitA, commitB):
  ancestorsOfA = DFS-collect all commit ids reachable from commitA via parentIds (a Set)
  BFS from commitB via parentIds:
    for each id popped:
      if id in ancestorsOfA: return that commit   # first hit = merge base
  throw if queue empties with no hit (no shared history)
```

`isAncestor(repo, ancestorId, descendantId)` is a simple DFS used to detect fast-forward merges (target hasn't diverged from source) so those can skip the conflict machinery entirely and just move the branch pointer.

Simplification accepted: this finds *a* common ancestor via first-BFS-hit, not a general lowest-common-ancestor across all possible merge bases (relevant for repeated criss-cross merges). See `decisions.md` #4 for why that's sufficient for this tool's supported workflows.

## 6. Storage layout and commit/branch model

**On disk**, data is split into small, isolated files rather than one shared blob (see `decisions.md` #3):

```
data/
  manifest.json                     # [{ id, name, createdAt, defaultBranch }] — one entry per repo
  repos/<repoId>/branches.json      # [{ name, headCommitId }] — rewritten on every commit/branch op
  repos/<repoId>/commits/<commitId>.json   # one Commit per file, written once, never modified again
```

- `manifest.json` is the only file touched when a repo is created or deleted, and is small regardless of how much history exists (it never stores commit content).
- `repos/<repoId>/branches.json` is the only file touched by a normal commit or branch operation on that repo — its size depends on the number of branches, not the number of commits.
- Each commit file is write-once and immutable, matching the fact that `Commit` values are never mutated after creation. A crash mid-write can only ever affect the one file being written, not unrelated repos or already-written commits.

**In-memory model** (what `types.ts` describes and what `operations.ts`/`diff.ts`/`merge.ts` operate on) is unaffected by this split — `store.ts` is the only module that knows about the file layout; everything else still deals with plain `Repo`/`Schema` objects assembled from these files.

**Commit/branch semantics:**
- `Commit.parentIds`: `[]` for the root commit, `[parent]` for a normal edit, `[targetHead, sourceHead]` for a merge commit.
- `Branch` is just `{ name, headCommitId }` — a mutable pointer.
- `createBranch(repo, name, fromBranch)` copies the source branch's current `headCommitId`; the two branches then diverge independently as each accumulates its own commits.
- Every schema-editing operation (`ops/:op` route) reads the current branch head's schema, applies one pure operation function, and writes a new commit file, then updates `branches.json` to move the branch pointer forward. One HTTP call = one commit = one operation. There is no batching of multiple edits into a single commit.

## 7. API reference

Base path: `/api`. All bodies/responses are JSON. Errors: `{ error: string }` with `400` (bad operation, `OpError`), `404` (repo/branch not found), `409` (merge apply attempted with unresolved conflicts, or with a merged schema that fails validation), `500` (unexpected).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/repos` | — | `Repo[]` |
| POST | `/repos` | `{ name }` | `Repo` (201) |
| GET | `/repos/:repoId` | — | `Repo` |
| DELETE | `/repos/:repoId` | — | 204 |
| POST | `/repos/:repoId/branches` | `{ name, from }` | `Branch` (201) |
| DELETE | `/repos/:repoId/branches/:name` | — | 204 |
| GET | `/repos/:repoId/branches/:name/schema` | — | `Schema` |
| GET | `/repos/:repoId/branches/:name/log` | — | `Commit[]` (all ancestors, newest first) |
| POST | `/repos/:repoId/branches/:name/ops/:op` | op-specific, see `OP_HANDLERS` in `index.ts` | `Commit` (201) |
| GET | `/repos/:repoId/diff?from=&to=` | — | `SchemaDiff` |
| POST | `/repos/:repoId/merge` | `{ source, target, resolutions?, apply? }` | `{ schema, conflicts, entities, validation, fastForward?, commit? }` (200, or 201 if applied, or 409 if applying while blocked). `provenance` is stripped here. |

`op` values and bodies (see `OP_HANDLERS` map in `server/src/index.ts`): `createTable {name}`, `dropTable {tableId}`, `renameTable {tableId, name}`, `addColumn {tableId, input}`, `dropColumn {tableId, columnId}`, `renameColumn {tableId, columnId, name}`, `retypeColumn {tableId, columnId, input}`, `setColumnNullable {tableId, columnId, nullable}`, `setColumnDefault {tableId, columnId, value}`, `setColumnPrimaryKey {tableId, columnId, pk}`, `addIndex {tableId, input}`, `dropIndex {tableId, indexId}`, `addConstraint {tableId, input}`, `dropConstraint {tableId, constraintId}`.

## 8. Frontend architecture

The screen is **three columns of narrowing scope** — repository/branches, then tables on the current branch, then the selected table — with compare-and-merge lifted out into a sheet because it concerns two branches rather than the one being edited (see `decisions.md` #14).

```
App.tsx                         — repo/branch/table selection, tab state, op dispatch
├── (topbar, Landing)           — inline in App.tsx: brand, breadcrumbs, first-run state
├── Sidebar.tsx                 — repository picker dropdown, new/delete repo,
│                                 branch list with search, dots, current/default badges;
│                                 new repo + new branch are modals, not inline forms
├── SchemaEditor.tsx            — table pane (search + counts) beside the selected table
│   └── TableCard.tsx           — the selected table: columns grid with inline
│                                 rename/retype/nullable/default/PK, then indexes and
│                                 constraints as side-by-side cards
├── HistoryView.tsx             — commit timeline for the current branch, with branch-ref chips
└── CompareMerge.tsx            — the sheet: source/target pickers, merge preview, and diff
    ├── ConflictCard.tsx        — one conflicting entity: the field table with per-row picks
    └── DiffPanel.tsx           — presentation-only rendering of a SchemaDiff

components/icons.tsx            — inline SVG icon set (branch, merge, trash, table, …)
components/ui.tsx               — Modal, ConfirmDialog, InlineEdit, Toast
lib/api.ts                      — fetch wrapper; ApiError carries the server's `{ error }` text
lib/types.ts                    — hand-maintained mirror of the server's exported shapes
lib/format.ts                   — formatType / formatTime / formatValue / fieldLabel
```

State flow: `App` owns `repo`, `branch`, `schema`, `log`, `selectedTableId` and refetches after every operation (`handleOp` → `api.runOp` → `refresh()`). Table selection is held in `App` rather than `SchemaEditor` so it survives a tab switch, and self-heals: if the selected table no longer exists on the current branch, selection falls back to the first table.

`CompareMerge` owns its own `resolutions: ResolutionMap` and calls `api.mergePreview` (server-side, `apply: false`) after every resolution change — the server is the single source of truth for merge computation; the client never re-implements the merge algorithm. `api.mergeApply` (`apply: true`) is only enabled once `preview.conflicts.length === 0` **and** `preview.validation.length === 0`. It fetches the diff (`target → source`, i.e. "what source brings into target") alongside the preview, so one view answers both halves of the question.

Cards render from `preview.entities`, not from `preview.conflicts`. The server computes `entities` as if no resolutions were supplied (§4.5), so it is the same on every call in a merge session while `conflicts` shrinks as decisions land — which is what keeps a decided row on screen with an Undo instead of vanishing at the moment of choice (`decisions.md` #13). The client holds no registry of its own; `resolutions` is its only merge state, cleared when either branch changes since conflict ids are tied to a specific pair of tips.

**Naming:** the merge engine speaks `ours`/`theirs`; the UI speaks Target/Source. `ours` is always the **target** branch (merged into) and `theirs` the **source**. That mapping is confined to `lib/types.ts` and `ConflictCard.tsx`.

**Commit ids are never rendered.** They're a storage detail, not something a user of this tool identifies a change by — history rows are identified by message, time and branch-ref chips instead. `Commit.id` still exists in the API and is the key for React lists and merge-base lookup.

**Conflict display (`ConflictCard`):** one card per *entity*, driven by an `EntityContext` — a column whose `type` and `default` both clash is one card with two decisions, not two cards. The card is a Base / Source / Target table with a fourth Decision column, and that table **is** the control (`decisions.md` #12):

- a field with `status: 'auto'` is muted and labelled with why it settled — "both agree", "only source changed", "only target changed";
- a field with `status: 'conflict'` is highlighted and carries its own `Source` / `Target` buttons, replaced after a pick by "kept source/target" plus a per-row Undo.

Keeping the auto rows visible is the point: they show that most of the entity merged unaided, which turns the card from a demand into a report with one or two open questions. A `modify-delete` has no field rows, so it renders instead as the two whole-entity choice cards ("keep the edited version" / "accept the delete").

**Validation display (`ValidationProblems`):** a "What's wrong" section above the cards, listing each `Violation`. Where `conflictIds` is non-empty it renders a "Change the pick" button that scrolls to and flashes the offending row; where it is empty it says "no pick can fix this", and the violation's own message names what has to change on a branch instead. The status banner above already says the merge is blocked, so this section doesn't repeat that headline.

Types in `client/src/lib/types.ts` are a hand-maintained mirror of the server's `types.ts`/`diff.ts`/`merge.ts` exported shapes (see `decisions.md` #10 for why this isn't a shared package).

## 9. Design tokens (visual)

Ink/stone palette (`--ink #14181c`, `--bg #eceae3`, `--accent #3d5a80` steel blue, `--amber #a86d1f` for conflicts, standard muted green/red for diff add/remove) — deliberately not the cream+terracotta or dark+neon defaults. Two type families: IBM Plex Mono for anything that *is* schema content (table/column names, types), IBM Plex Sans for UI chrome (labels, buttons, section headers) — so the visual distinction between "your schema" and "the tool's interface" is legible at a glance.

## 10. Test coverage (`server/tests/`)

**`diff.test.ts`** (6 tests): identical-schema no-op, added table, removed table, added column, rename-vs-drop+add distinction (the key identity test), retype detected as field-level modification.

**`merge.test.ts`** (25 tests):
- Clean merges: non-overlapping column additions, only-one-side-changed wins, clean drop, index+column combo, two independently created tables.
- **Field level:** disjoint field edits to one column auto-merge (the headline case); a same-field clash conflicts alone while its siblings still auto-merge; two contested fields on one entity resolve independently; an optional field added by one side is taken; an optional field cleared by one side and left by the other is dropped without an explicit `undefined` key; one side clearing what the other changed conflicts; `add-add` requires exact per-field equality; a table rename clash surfaces as `kind: table, field: name`; `columnIds` is atomic.
- Modify/delete: conflict raised when one side drops what the other modified; both resolution paths verified.
- Entity context: auto-merged fields labelled with the winning side; `entities` identical before and after resolving; clean entities omitted; a modify-delete card carries no field rows; provenance maps each contested field to its conflict.

**`validate.test.ts`** (18 tests): one per rule in §4.6, plus — the same column name allowed in two different tables; a table-name collision anchored on the colliding tables rather than the first table; `conflictIds` populated from provenance and empty when no pick can fix it; the message switching to rename-on-a-branch advice in that case; and the guard that a nullable primary key raises **no** violation, since the editor permits it.

**`apply-guard.test.ts`** (4 tests): `applyBlockedReason` permits a clean merge, blocks on outstanding conflicts, blocks on validation violations even with no conflicts left, and reports conflicts first when both are outstanding.

## 11. Known limitations (see `decisions.md` for the reasoning behind each)

No auth or multi-user concurrency control · file-based storage isolates repos/commits from each other but still has no pagination or indexed queries, so it doesn't scale to many people or very long history · merge-base lookup is simplified (no general LCA) · no rebase/cherry-pick/octopus merge · a name collision produced by two branches independently creating the same entity is reported but not resolvable in-merge (no rename-during-merge flow) · client/server types are manually kept in sync.
