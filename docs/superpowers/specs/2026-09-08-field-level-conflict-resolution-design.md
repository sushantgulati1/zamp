# Field-level conflict resolution

**Status:** approved, not yet implemented
**Date:** 2026-09-08
**Touches:** `server/src/merge.ts`, new `server/src/validate.ts`, `server/src/index.ts`, `server/src/store.ts`, `client/src/components/ConflictCard.tsx`, `client/src/components/CompareMerge.tsx`, `client/src/lib/types.ts`, `server/tests/`

## 1. Problem

Merge conflicts today are resolved by picking one whole entity — a whole column, index, or
constraint — from one side. That makes the tool nearly unusable for the workflow it exists to
support.

Concretely, `mergeEntitySet` (`server/src/merge.ts:120-141`) handles the present-on-all-three
case like this:

```ts
if (b && o && t) {
  if (deepEqual(o, t)) …      // converged
  if (deepEqual(b, o)) …      // only theirs changed
  if (deepEqual(b, t)) …      // only ours changed
  // otherwise → conflict, whole entity
}
```

The final branch fires whenever both sides changed *anything* about the same entity — including
when they changed **different fields**. If branch A renames `users.email` to `email_address`
and branch B changes its type to `varchar(500)`, those two edits are disjoint and trivially
compatible, but the engine reports an `edit-edit` conflict and forces one of them to be
discarded.

That is the common case, not the edge case. Two people evolving the same table will routinely
touch the same column for unrelated reasons. Under the current model almost every such merge
conflicts, and resolving it always destroys work, which defeats the point of having branches.

`decisions.md` #5 is the decision that causes this. It is reversed by this design.

**Not the problem:** conflict *detection* is already per-entity. `mergeEntitySet` runs an
independent 3-way merge per entity id, so "branch A adds `email`, branch B adds `phone`"
already merges clean. Nothing here is ever a whole-branch pick. The gap is strictly one level
deeper, inside a single entity.

## 2. The change in one sentence

Push merge granularity from entity-level to field-level: fields both sides left alone or
changed compatibly merge automatically, and only a field both sides changed to *different*
values becomes a conflict — scoped to that one field.

## 3. Field-level merge

A new helper replaces the whole-entity `edit-edit` branch. It runs over the union of field
names across the three sides of one entity, with `id` excluded (identity is the key, never a
merge candidate).

For a field `f` with base value `b`, ours `o`, theirs `t`:

| condition | result |
|---|---|
| `o == t` | take it — converged, or neither side touched it |
| base entity exists && `b == o` | take theirs — only theirs changed this field |
| base entity exists && `b == t` | take ours — only ours changed this field |
| otherwise | **conflict, scoped to field `f`** |

Comparison is the existing `deepEqual` (JSON-string equality), so an absent optional field and
an explicitly-undefined one compare equal — which is what we want, since the two are
indistinguishable in the stored schema.

### 3.1 The base-exists gate

The `b == o` and `b == t` shortcuts are gated on the base entity being present. Their whole
justification is "this side did not change the field", and that statement is meaningless
without an ancestor to compare against.

In an add-add (no base entity), a field therefore auto-merges only on exact equality. Example:
ours creates the column with no `default`, theirs creates it with `default: 'x'`. There is no
base, so this is a real disagreement about what the new column should be — it conflicts rather
than silently taking `'x'`.

### 3.2 Where the helper is applied

- The table's own scalar fields — in practice just `name`. This removes `mergeTable`'s
  hand-rolled three-way `name` comparison (`merge.ts:188-203`) and the `table-name` conflict
  kind along with it.
- Each column, index, and constraint present on all three sides, from inside `mergeEntitySet`.
- Each entity present on both sides but absent from base (add-add), under the §3.1 gate.

## 4. What stays entity-level

**modify-delete.** One side deleted the entity while the other modified it. Deletion is not a
field, so there is no field to scope the conflict to. This keeps today's whole-entity
keep/delete choice, and `decisions.md` #6 stands unchanged.

**`columnIds` arrays** on indexes and constraints are treated as a single atomic field:
compared by deep equality, picked whole. Merging them element-wise would produce a column
*ordering* that neither branch chose, and index column order is semantically load-bearing — a
composite index on `(a, b)` is not the same index as one on `(b, a)`.

## 5. Data shapes

```ts
type ConflictKind = 'table' | 'column' | 'index' | 'constraint';   // 'table-name' removed
type ConflictReason = 'edit-edit' | 'add-add' | 'modify-delete';
type Resolution = 'ours' | 'theirs' | 'keep' | 'delete';           // unchanged

interface Conflict {
  id: string;          // field conflict:  `${kind}:${tableId}:${entityId}:${field}`
                       // modify-delete:   `${kind}:${tableId}:${entityId}`
  kind: ConflictKind;
  reason: ConflictReason;
  tableId: string;
  entityId: string;
  field?: string;      // set on field conflicts; base/ours/theirs are then scalar values
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  deletedSide?: 'ours' | 'theirs';   // modify-delete only
}
```

`fieldsDiffering` is dropped. It existed to tell the read-only diff table which rows to
highlight; that job is now done by the presence of a conflict for the row.

### 5.1 Entity context

A field conflict carries only scalars, but §8.1's card has to render the *whole* entity —
including the rows that auto-merged and why. That information is not derivable from the
conflicts, so `MergeResult` gains a second array beside them:

```ts
type FieldStatus =
  | { status: 'auto'; won: 'converged' | 'ours' | 'theirs' }
  | { status: 'conflict'; conflictId: string };

interface EntityContext {
  key: string;          // `${kind}:${tableId}:${entityId}` — the card's identity
  kind: ConflictKind;
  tableId: string;
  entityId: string;
  tableName: string;    // for the card heading; resolved from whichever side has the table
  entityName: string;
  base?: unknown;       // the whole entity on each side, for the table's Base/Source/Target columns
  ours?: unknown;
  theirs?: unknown;
  fields: Record<string, FieldStatus>;
}
```

`entities` is **computed as if the resolution map were empty**, so it is identical on every call
within a merge session. That is what keeps a decided row on screen (`decisions.md` #13) without
the client accumulating anything: `entities` is the stable set of cards to render, `conflicts`
is the shrinking set of what is still outstanding, and the client renders the first against the
second. The client-side accumulation this replaces is removed.

`entities` contains one entry per entity that has at least one field conflict, plus one per
modify-delete conflict (whose `fields` map is empty — there is nothing to tabulate).

`Resolution` does not change, so the request body of `POST /repos/:repoId/merge` keeps its
shape. Only the resolution *key strings* gain a fourth segment. Existing resolution keys held
by a client mid-merge become unrecognised, which is harmless: an unmatched key is ignored and
the conflict simply reappears unresolved.

A field conflict resolves to `'ours'` or `'theirs'`, meaning "take the target branch's value
for this field" or "take the source branch's". There is no free-text entry and no revert-to-base
option: every value in a merged schema must be traceable to a real commit on one of the two
sides, which keeps this a merge tool rather than a schema editor wearing a merge tool's clothes.

While a field conflict is unresolved the engine keeps provisionally emitting the `ours` value,
exactly as today, so the returned schema is always well-formed enough to render.

## 6. Validation

Field-mixing can produce an entity that neither branch ever had. That risk is the honest reason
`decisions.md` #5 chose whole-entity picks, and it has to be answered rather than ignored.

A new `server/src/validate.ts` exports:

```ts
/** field key: `${tableId}:${entityId}:${field}` → the conflict id that decided it */
type Provenance = Record<string, string>;

function validate(schema: Schema, provenance: Provenance): Violation[];
```

It runs on the merged schema and its result is returned alongside `conflicts`. **Apply is
refused unless both arrays are empty.**

`merge3` builds `provenance` as it goes: whenever it emits a field value that came from a
conflicted field — resolved or provisional — it records that field's conflict id. `validate`
is otherwise pure and knows nothing about merging; provenance is only how a violation finds
its way back to a pick (§6.2).

### 6.1 The rule that keeps the validator honest

> The validator enforces exactly the invariants `operations.ts` already enforces, and nothing
> more.

Any rule beyond that set would let the merge screen invent constraints the schema editor does
not have — blocking a merge over a state that each branch was independently allowed to reach
through ordinary editing. That would be a worse failure than the one being fixed.

**In scope**, mirroring `operations.ts`:

| Rule | Enforced today by |
|---|---|
| Table names unique within the schema | `createTable`, `renameTable` |
| Column names unique within a table | `addColumn`, `renameColumn` |
| Index names unique within a table | `addIndex` |
| Constraint names unique within a table | `addConstraint` |
| Table / column / index / constraint name non-empty | the same ops |
| Column `type` non-empty | `addColumn`, `setColumnType` |
| Constraint `definition` non-empty | `addConstraint` |
| Index has at least one column | `addIndex` |
| Index / constraint `columnIds` all resolve to a surviving column in the table | `addIndex` (`findColumn` per id) |

**Explicitly out of scope:** `primaryKey ⇒ !nullable`. `setColumnPrimaryKey`
(`operations.ts:159`) does not enforce it, so that state is reachable on a single branch with no
merge involved. Making it a merge blocker would violate the rule above.

### 6.2 Violation shape

```ts
interface Violation {
  code: 'duplicate-table-name' | 'duplicate-column-name' | 'duplicate-index-name'
      | 'duplicate-constraint-name' | 'empty-name' | 'empty-type' | 'empty-definition'
      | 'index-no-columns' | 'dangling-column-ref';
  message: string;
  tableId: string;
  entityId?: string;
  field?: string;
  conflictIds: string[];   // the field conflicts whose picks produced this value
}
```

`conflictIds` is what makes "go back and change it" possible: the UI renders each violation as
a link to the exact card and row to re-pick. It is filled by looking up each field the
violation implicates in the `Provenance` map — for a duplicate-name violation, that is the
`name` field of every entity sharing the name; for a dangling reference, the `columnIds` field
of the offending index. Fields with no provenance entry contribute nothing.

When `conflictIds` is empty there is no pick that can fix the violation. The message says so
directly and names what has to change on a branch before the merge can proceed. This is a
genuine dead end, and reporting it plainly beats offering a control that cannot help.

### 6.3 A pre-existing bug this closes

Entity ids are random, generated at creation. Two branches therefore cannot independently mint
the same id, which makes `add-add` effectively unreachable in practice — it is kept for
completeness of the case analysis, not because it fires.

The case people actually mean by "both branches created a `users` table" is two tables with
*different* ids and the *same name*. Today `merge3` iterates by id, sees two unrelated tables,
merges both in, and produces a schema with two tables named `users` — silently, with no
conflict raised. The duplicate-table-name rule catches this as a blocking violation with an
empty `conflictIds`, per §6.2.

This is a pre-existing gap closed as a side effect of adding a validator, not new scope.

## 7. API

`POST /repos/:repoId/merge` keeps `{ source, target, resolutions?, apply? }`.

The response gains `entities: EntityContext[]` (§5.1) and `validation: Violation[]` beside the
existing `conflicts` and `schema`.
`store.mergeBranches` refuses to create a merge commit when `conflicts.length > 0` **or**
`validation.length > 0`, returning the same shape it returns for outstanding conflicts today so
the client renders the blocked state through one path.

`GET /repos/:repoId/diff` is untouched.

## 8. UI

### 8.1 One card per entity

`ConflictCard` becomes one card per *entity*, not per field: one card per `EntityContext`
(§5.1), so a column with two conflicting fields is one card with two decisions, not two cards.
`conflicts` is consulted only for which rows are still outstanding.

The compact Base / Source / Target table from `decisions.md` #12 stops being a read-only
explanation and becomes the control surface:

```
users.email                                    2 of 3 fields need a decision

Field      Base       Source · feat-a    Target · main
name       email      email_addr         email_addr        ✓ auto — converged
type       varchar    text               varchar           [ source ] [ target ]
nullable   true       true               false             ✓ auto — only target changed
default    —          'x'                NULL              [ source ] [ target ]
```

Auto-merged rows stay on screen, muted, each labelled with *why* it resolved itself
("converged", "only source changed", "only target changed"). Showing them is the point: it is
what makes visible that most of the entity merged without help, and it turns the card from a
demand into a report with two open questions.

A card is resolved when every conflicting row has a pick. Per-row Undo replaces per-card Undo.
`decisions.md` #13 (a decided conflict stays on screen rather than vanishing) is preserved, now
at row granularity — but its client-side accumulation is deleted, since `entities` is already
the stable set (§5.1). That removes the mirrored state #13 flagged as its own tradeoff.

modify-delete cards keep today's two whole-entity choice cards — there is nothing to tabulate.

### 8.2 Validation banner

Above the conflict list, hidden while clean: a blocking banner listing violations. Each entry
is a button that scrolls to and highlights the offending row so the pick can be changed.
Entries with empty `conflictIds` render as plain text stating what must change on a branch.

The Apply button is disabled while either conflicts or violations remain, with the banner
carrying the reason.

## 9. Testing

`server/tests/merge.test.ts` is rewritten around the new model; `server/tests/validate.test.ts`
is new.

Merge engine:
- **Disjoint field edits auto-merge.** Ours renames a column, theirs retypes it → zero
  conflicts, merged column carries both edits. This is the headline case and the reason the
  change exists.
- Same field changed differently on both sides → exactly one conflict, on that field, while
  sibling fields on the same entity still auto-merge.
- Two conflicting fields on one entity resolve independently: resolving one leaves the other
  outstanding.
- Optional field: base absent, ours adds it, theirs leaves it absent → auto-merges to ours.
- Optional field: base present, ours removes it, theirs changes it → conflicts.
- add-add requires exact per-field equality (§3.1) — differing optional field conflicts rather
  than auto-merging.
- Table `name` clash surfaces as `kind: 'table'`, `field: 'name'`, resolvable like any field.
- modify-delete behaviour is unchanged, both resolution paths.
- Non-overlapping entity adds still merge clean (regression guard on §1's "not the problem").
- Resolution keys are stable across repeated `merge3` calls with a growing map.
- `entities` is identical before and after resolving a conflict (§5.1's stability guarantee),
  and its `fields` map labels auto-merged fields with the right winner.

Validator:
- One test per rule in §6.1.
- The duplicate-table-name case from §6.3, asserting empty `conflictIds`.
- An index left dangling because the merge dropped its column.
- `primaryKey: true, nullable: true` produces **no** violation (§6.1 guard).
- A violation caused by a field pick carries the conflict id that produced it.

## 10. `decisions.md` updates

- **#5 rewritten.** It currently asserts the opposite of this design. Becomes "conflicts are
  resolved field by field", recording why the whole-entity call was originally made, what it
  cost (near-universal false conflicts on independent edits), and that the validator is what
  replaces the safety it was buying.
- **#7 extended.** Its principle — look inside instead of conflicting — now goes one level
  further, into fields.
- **#12 amended.** The diff table is now the control surface, not a read-only aid.
- **New: the validator's charter.** Mirror `operations.ts`, invent nothing, and why.
- **New: arrays are atomic.** `columnIds` picked whole, and why.
- **#13 amended.** Still true at row granularity, but its client-side mirroring is gone.

`SPEC.md` §3 step 7 and §8's test count also describe the old whole-entity model and are
updated as part of the implementation, not now — they describe what ships.

## 11. Out of scope

- Free-text or revert-to-base values during resolution (§5).
- Element-wise merging of `columnIds` (§4).
- A rename-on-collision resolution for the duplicate-name dead end (§6.2). It is reported, not
  resolvable in-merge.
- Any change to diff, storage, history, or the schema editor.
