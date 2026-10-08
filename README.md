# Graft — version control for database schemas..

Git's workflow — branch, diff, merge — applied to a database schema instead of files.
Branch a schema, evolve it independently on each branch (add/drop/rename/retype columns,
change constraints and indexes, create/drop tables), see exactly what diverged, and merge
back with conflicts surfaced explicitly instead of silently resolved — and surfaced at the
level they actually occur, so two people editing different attributes of the same column
don't collide.

Row data is out of scope. The artifact under version control is the schema itself.

- **[`SPEC.md`](SPEC.md)** — problem, the hard part, the slice that ships, domain model, API.
- **[`LOW_LEVEL_DESIGN.md`](LOW_LEVEL_DESIGN.md)** — module responsibilities, diff/merge algorithms, storage layout.
- **[`decisions.md`](decisions.md)** — the judgment calls, including what was deliberately cut and why.

## Running it

Requires Node 20+.

```bash
npm run setup   # installs server/ and client/ dependencies
npm run dev     # starts the API on :4000 and the SPA on :5173
```

Then open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend, so the
client has no base-URL configuration and there is nothing to set up between the two.

To run them separately:

```bash
npm run dev:server   # API only, http://localhost:4000
npm run dev:client   # SPA only, http://localhost:5173
```

Data is written to `server/data/` as plain files (gitignored). Deleting that directory resets
everything.

## Tests

```bash
npm test
```

53 unit tests covering the parts that must be provably correct — the diff engine, the
three-way merge engine, and the merge validator:

- identity-based rename vs. drop-and-re-add detection
- clean merges of non-overlapping changes
- **disjoint field edits to the same column merging with zero conflicts** — the case that
  makes branching worth having
- field-scoped edit/edit conflicts, resolved one field at a time
- add/add requiring exact per-field equality; `columnIds` treated atomically
- modify/delete conflicts, both resolution paths
- validation of the merged result, including the rule that it may enforce nothing the schema
  editor doesn't

## Trying the interesting path

The merge engine is the point, so the fastest way to see it work:

1. Create a repository — it starts with an empty `main`.
2. On the **Schema** tab, create a table and add a few columns.
3. Create a branch from the left sidebar (say `cleanup`).
4. Touch the *same* column on both branches, for **different** reasons — rename `total` to
   `order_total` on `cleanup`, and retype `total` to `numeric` on `main`.
5. Hit **Compare & merge**, with `cleanup` as source and `main` as target. Nothing to decide:
   the two edits don't disagree about anything, so both survive. The lower half shows the
   result carrying the rename *and* the retype, and the rename reads as a rename rather than a
   delete plus an unrelated add.
6. Now make them actually disagree — retype the same column to `bigint` on `cleanup` too, and
   on one branch **drop** a column you **rename** on the other. Re-open the sheet.
7. The upper half lists what needs deciding, and only that. The column comes up as one card
   whose Base / Source / Target table shows `name` already merged ("only source changed") and
   `type` awaiting a Source / Target pick on its own row. The dropped column comes up
   separately as a `modify/delete`, which is still a whole-entity keep-or-delete choice.
   Decide them (each stays on screen, with an Undo), then apply — you get a merge commit with
   two parents, visible on the **History** tab.

## Layout

```
server/          Express + TypeScript API, no database
  src/
    types.ts       domain model, no logic
    operations.ts  pure (schema, params) -> schema edits
    diff.ts        two-way structural diff, keyed on entity id
    merge.ts       three-way merge engine, down to individual fields
    validate.ts    checks a merged schema against operations.ts's own invariants
    store.ts       the only module that touches disk
    index.ts       HTTP routes; translates errors to status codes
  tests/         diff, merge, validation, and apply-guard unit tests

client/          Vite + React SPA, fetch() only
  src/
    lib/           API client, types mirror, formatters
    components/    Sidebar, SchemaEditor, TableCard, HistoryView,
                   CompareMerge (+ ResultPanel, ConflictCard), icons, ui
```

`operations.ts`, `diff.ts`, `merge.ts` and `validate.ts` are pure and side-effect free. That's
what makes the merge engine unit-testable without a server, and what lets the UI re-run a merge
preview on every resolution click with no state to reset.
