# Low-Level Design — Strata

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
| `merge.ts` | `merge3(base, ours, theirs, resolutions?) → { schema, conflicts }`. The 3-way merge engine (detailed in §4). Pure. |
| `store.ts` | The only module touching disk. Repo/branch/commit CRUD, `findMergeBase` (common-ancestor BFS), `isAncestor` (fast-forward detection). Backed by plain files on disk — see §6 for the layout. |
| `index.ts` | Express routes. Thin — parses request, calls into the modules above, translates `OpError`/thrown errors into HTTP status codes. |

All of `operations.ts`, `diff.ts`, and `merge.ts` are pure and side-effect free by design — this is what makes them unit-testable without spinning up the server or the store, and what lets the merge engine be called repeatedly (once per conflict-resolution click) without any state to reset.

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

### 4.1 Top level — tables

For every table `id` appearing in any of `base`/`ours`/`theirs`, call `mergeTable(id, base?, ours?, theirs?, resolutions)`, which returns either a merged `Table` or `undefined` (table doesn't survive the merge), plus any conflicts. Collect all surviving tables into the merged schema; collect all conflicts.

### 4.2 `mergeTable` case analysis

Given `(base, ours, theirs)` for one table id — each may be present or absent:

| base | ours | theirs | Result |
|---|---|---|---|
| absent | present | absent | include ours' version as-is |
| absent | absent | present | include theirs' version as-is |
| absent | present | present, equal | include either (identical independent creation) |
| absent | present | present, differ | **conflict: `add-add`** (kind `table`) |
| present | absent | absent | table removed on both sides → omit |
| present | absent | present, unchanged from base | ours' removal wins → omit |
| present | absent | present, changed from base | **conflict: `modify-delete`**, `deletedSide: "ours"` |
| present | present, unchanged from base | absent | theirs' removal wins → omit |
| present | present, changed from base | absent | **conflict: `modify-delete`**, `deletedSide: "theirs"` |
| present | present | present | **recurse** — see §4.3 |

### 4.3 Present-in-all-three case: field-level / sub-entity recursion

Rather than treating "table differs on both sides" as one atomic conflict, `mergeTable` handles the table's `name` field with the same base/ours/theirs comparison as any other field (only-one-side-changed wins automatically; both-changed-differently → `edit-edit` conflict, kind `table-name`), and separately calls the generic `mergeEntitySet` helper once each for `columns`, `indexes`, and `constraints`. This is what lets "ours adds column A" and "theirs adds column B" to the same table merge with zero conflicts — they're different entity ids, handled independently.

### 4.4 `mergeEntitySet<T>` — shared logic for columns/indexes/constraints

For every entity `id` appearing in any of `base[]`/`ours[]`/`theirs[]` within the table:

| base | ours | theirs | Result |
|---|---|---|---|
| absent | present | absent | include ours' version |
| absent | absent | present | include theirs' version |
| absent | present | present, equal | include either |
| absent | present | present, differ | **conflict: `add-add`** |
| present | absent | absent | omit (removed both sides) |
| present | absent | present = base | omit (ours' removal wins, theirs never touched it) |
| present | absent | present ≠ base | **conflict: `modify-delete`**, `deletedSide: "ours"` |
| present | present = base | absent | omit (theirs' removal wins) |
| present | present ≠ base | absent | **conflict: `modify-delete`**, `deletedSide: "theirs"` |
| present | present | present, ours = theirs | include either (converged or both unchanged) |
| present | present | present, base = ours ≠ theirs | include theirs (only theirs changed) |
| present | present | present, base = theirs ≠ ours | include ours (only ours changed) |
| present | present | present, all three differ | **conflict: `edit-edit`** |

Every conflict object is annotated with `fieldsDiffering` (computed via the same `differingFields` field-walk diff uses) — this is what powers the compact per-field diff table in the UI (see §8), even though the resolution itself is whole-entity, not per-field (see `decisions.md` #5).

### 4.5 Conflict resolution application

Each conflict has a deterministic `id` string of the form `${kind}:${tableId}:${entityId}` (e.g. `column:3Wx8oQWb7b:gABM6xnmI2`), computed the same way every time `merge3` runs. This lets the caller pass a `resolutions: Record<conflictId, Resolution>` map and get a fully or partially resolved merge back — `merge3` is safe to call repeatedly (once per click in the UI) with the growing resolutions map, and any conflict *not yet* in the map simply reappears in the returned `conflicts` array. The server only permits creating a merge commit when the returned `conflicts` array is empty.

`Resolution` values: `"ours" | "theirs"` (edit-edit, add-add), `"keep" | "delete"` (modify-delete).

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

Base path: `/api`. All bodies/responses are JSON. Errors: `{ error: string }` with `400` (bad operation, `OpError`), `404` (repo/branch not found), `409` (merge apply attempted with unresolved conflicts), `500` (unexpected).

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
| POST | `/repos/:repoId/merge` | `{ source, target, resolutions?, apply? }` | `MergeResult` (200, or 201 if applied, or 409 if applying with unresolved conflicts) |

`op` values and bodies (see `OP_HANDLERS` map in `server/src/index.ts`): `createTable {name}`, `dropTable {tableId}`, `renameTable {tableId, name}`, `addColumn {tableId, input}`, `dropColumn {tableId, columnId}`, `renameColumn {tableId, columnId, name}`, `retypeColumn {tableId, columnId, input}`, `setColumnNullable {tableId, columnId, nullable}`, `setColumnDefault {tableId, columnId, value}`, `setColumnPrimaryKey {tableId, columnId, pk}`, `addIndex {tableId, input}`, `dropIndex {tableId, indexId}`, `addConstraint {tableId, input}`, `dropConstraint {tableId, constraintId}`.

## 8. Frontend architecture

```
App.tsx                         — repo/branch state, routing between tabs, op dispatch
├── (TopBar, Sidebar, Landing)  — inline in App.tsx: repo picker, branch list, first-run state
├── SchemaEditor.tsx            — renders tables for the current branch; "+ New table"
│   └── TableCard.tsx           — per-table: columns table + inline add/rename/retype/drop
│                                  controls, indexes list + add form, constraints list + add form
├── DiffView.tsx                — from/to branch pickers, renders SchemaDiff
├── MergeView.tsx               — source/target pickers, calls /merge on every resolution
│   └── ConflictCard            — one conflict: why-text, ConflictTable, resolve buttons
│       └── ConflictTable       — renders one conflict as a compact field-by-field table
└── HistoryView.tsx             — commit timeline for the current branch, with branch-ref chips

components/ui.tsx               — Modal, ConfirmDialog, InlineEdit, Toast
lib/api.ts                      — fetch wrapper; ApiError carries the server's `{ error }` text
lib/types.ts                    — hand-maintained mirror of the server's exported shapes
lib/format.ts                   — formatType / shortId / formatTime / formatValue / fieldLabel
```

State flow: `App` owns `repo`, `branch`, `schema`, `log` and refetches all three after every operation (`handleOp` → `api.runOp` → `refresh()`). `MergeView` owns its own `resolutions: ResolutionMap` local state and calls `api.mergePreview` (server-side, `apply: false`) after every single resolution change — the server is the single source of truth for merge computation; the client never re-implements the merge algorithm. `api.mergeApply` (`apply: true`) is only enabled once `preview.conflicts.length === 0`.

Because the server returns only *unresolved* conflicts, `MergeView` also keeps a `seen: Conflict[]` registry of every conflict this branch pair has surfaced, in first-seen order. Cards render from that registry rather than straight from the response, so a conflict stays on screen once decided (marked resolved, with an "Undo decision" control) instead of vanishing at the moment of choice — see `decisions.md` #13. A card is dropped only if it is neither outstanding nor decided, which is how conflicts made moot by an earlier decision disappear. Switching either branch clears both `resolutions` and `seen`, since conflict ids are tied to a specific pair of tips.

**Naming:** the merge engine speaks `ours`/`theirs`; the UI speaks Target/Source. `ours` is always the **target** branch (merged into) and `theirs` the **source**. That mapping is confined to `lib/types.ts` and `MergeView.tsx`.

**Conflict display (`ConflictTable`):** each conflict renders as one table — one row per field on the entity (name, type, nullable, default, etc.), three columns (Base / Source / Target). Rows where all three values match are shown muted, since they're not part of the decision. Only the row(s) captured in the conflict's `fieldsDiffering` are highlighted. A single "keep source" / "keep target" choice below the table applies to the whole entity (see `decisions.md` #5, #12) — the table's job is to make that choice legible at a glance, not to allow per-field picks.

Types in `client/src/lib/types.ts` are a hand-maintained mirror of the server's `types.ts`/`diff.ts`/`merge.ts` exported shapes (see `decisions.md` #10 for why this isn't a shared package).

## 9. Design tokens (visual)

Ink/stone palette (`--ink #14181c`, `--bg #eceae3`, `--accent #3d5a80` steel blue, `--amber #a86d1f` for conflicts, standard muted green/red for diff add/remove) — deliberately not the cream+terracotta or dark+neon defaults. Two type families: IBM Plex Mono for anything that *is* schema content (table/column names, types), IBM Plex Sans for UI chrome (labels, buttons, section headers) — so the visual distinction between "your schema" and "the tool's interface" is legible at a glance.

## 10. Test coverage (`server/tests/`)

**`diff.test.ts`** (6 tests): identical-schema no-op, added table, removed table, added column, rename-vs-drop+add distinction (the key identity test), retype detected as field-level modification.

**`merge.test.ts`** (11 tests):
- Clean merges: non-overlapping column additions, only-one-side-changed wins, clean drop, index+column combo.
- Edit/edit: conflict raised on divergent retypes, resolves once a resolution is supplied, identical edits on both sides don't conflict.
- Modify/delete: conflict raised when one side drops what the other modified; both resolution paths (`delete` removes it, `keep` restores the edited version) verified.
- Table-level: modify/delete conflict at the whole-table granularity; two independently created tables merge with zero conflicts.

## 11. Known limitations (see `decisions.md` for the reasoning behind each)

No auth or multi-user concurrency control · file-based storage isolates repos/commits from each other but still has no pagination or indexed queries, so it doesn't scale to many people or very long history · merge-base lookup is simplified (no general LCA) · no rebase/cherry-pick/octopus merge · conflict resolution is whole-entity, not per-field · client/server types are manually kept in sync.
