# Graft — version control for database schemas

Git's workflow — branch, diff, merge — applied to a database schema instead of files.
Branch a schema, evolve it independently on each branch (add/drop/rename/retype columns,
change constraints and indexes, create/drop tables), see exactly what diverged, and merge
back with conflicts surfaced explicitly instead of silently resolved.

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

17 unit tests covering the two parts that must be provably correct — the diff engine and the
three-way merge engine:

- identity-based rename vs. drop-and-re-add detection
- clean merges of non-overlapping changes
- edit/edit conflicts, with and without a supplied resolution
- modify/delete conflicts, both resolution paths
- table-level add/add and modify/delete

## Trying the interesting path

The merge engine is the point, so the fastest way to see it work:

1. Create a repository — it starts with an empty `main`.
2. On the **Schema** tab, create a table and add a few columns.
3. Create a branch from the left sidebar (say `cleanup`).
4. Change the *same* column on both branches — e.g. retype `total` to `numeric` on `cleanup`
   and to `bigint` on `main`. Then, on one branch, **drop** a column that you **rename** on the
   other.
5. Hit **Compare & merge**, with `cleanup` as source and `main` as target. The lower half shows
   what diverged — the rename reads as a rename, not as a delete plus an unrelated add.
6. The upper half lists what needs deciding. Non-overlapping changes merge silently; the two
   overlapping ones come up as an `edit/edit` and a `modify/delete` conflict, each with a
   Base / Source / Target table where only the deciding field is highlighted. Decide both
   (each stays on screen, with an Undo), then apply — you get a merge commit with two parents,
   visible on the **History** tab.

## Layout

```
server/          Express + TypeScript API, no database
  src/
    types.ts       domain model, no logic
    operations.ts  pure (schema, params) -> schema edits
    diff.ts        two-way structural diff, keyed on entity id
    merge.ts       three-way merge engine + conflict detection
    store.ts       the only module that touches disk
    index.ts       HTTP routes; translates errors to status codes
  tests/         diff and merge unit tests

client/          Vite + React SPA, fetch() only
  src/
    lib/           API client, types mirror, formatters
    components/    Sidebar, SchemaEditor, TableCard, HistoryView,
                   CompareMerge (+ DiffPanel, ConflictCard), icons, ui
```

`operations.ts`, `diff.ts` and `merge.ts` are pure and side-effect free. That's what makes the
merge engine unit-testable without a server, and what lets the UI re-run a merge preview on
every conflict-resolution click with no state to reset.
