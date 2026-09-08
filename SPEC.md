# Spec — Graft: version control for database schemas

## 1. Problem

Build branch, diff, and merge for database schemas — the Git workflow, applied to schema shape instead of files. A user should be able to branch a schema, evolve it independently on each branch (add/drop/rename/retype columns; change constraints and indexes; create/drop tables), see exactly what diverged between two branches, and merge one branch into another with conflicts surfaced explicitly when both sides changed the same thing incompatibly.

**Who it's for:** a small team (or a solo developer working across features) that wants to evolve a schema on parallel branches — the way they already do with application code — without hand-reconciling `CREATE TABLE` statements by eye, and without silently losing someone's change when two branches touch the same column.

**Out of scope, explicitly:** row data. The artifact under version control is the schema itself — table/column/index/constraint definitions — not the rows inside those tables. See `decisions.md` items 8–9 for the full list of what else was deliberately cut (auth, rebase, cherry-pick).

## 2. The hard part

Two things make this non-trivial, and both are addressed head-on rather than routed around (see `decisions.md` for the full reasoning):

1. **Identity.** Diffing two schema snapshots by name alone can't distinguish "column renamed" from "column dropped, unrelated column added" — they produce the same textual diff. Solved by giving every table/column/index/constraint a stable id assigned at creation, independent of its current name.
2. **Three-way merge with real conflicts, at the right granularity.** Comparing two branches' *tip* schemas only tells you they differ, not what to do about it — you need the common ancestor to know which side actually changed something. Solved with a proper base/ours/theirs 3-way merge that recurses all the way down to individual fields, so only a field both branches moved to different values is a conflict. Two cases most naive tools get wrong are handled head-on: one branch deletes something the other modified (`modify-delete`), which has no safe default winner; and two branches editing *different* attributes of the same column, which is not a disagreement at all and must merge silently.

## 3. Scope of this build (the "slice")

**End-to-end path shipped:**
1. Create a repository (starts with an empty `main` branch).
2. Edit the schema on `main`: create tables, add/rename/retype/drop columns, toggle nullable/default/primary key, add/drop indexes and constraints.
3. Branch from `main`.
4. Make independent edits on both branches.
5. View a structured diff between any two branches (added/removed/modified tables, columns, indexes, constraints).
6. Preview a merge between two branches. Non-overlapping changes merge automatically with zero conflicts. Overlapping changes are surfaced as conflicts requiring an explicit decision.
7. Resolve conflicts **field by field**. Each entity that conflicts is one card holding a compact Base / Source / Target table: fields only one branch touched are already merged and shown muted with the reason they settled, and each field both branches changed differently carries its own keep-source / keep-target pick. A modify-delete stays a whole-entity confirm-delete / keep-edited-version choice, since deletion is not a field. Then apply the merge, producing a merge commit with two parents.
8. Because picks can be combined across branches, the merged schema is validated before it can be applied; violations block the merge and link back to the pick that caused them.

**Edge cases handled deliberately:**
- **Modify/delete conflicts** (one branch drops an entity the other branch has since modified) — the case flagged in the brief as commonly skipped.
- **Disjoint edits to the same entity.** A rename on one branch and a retype on the other are not a conflict; both survive. This is the ordinary case when two people work on one table, and treating it as a conflict is what makes naive schema-merge tools unusable — see `decisions.md` #5.
- **Name collisions from independent creation.** Two branches each creating a `users` table produce two distinct ids sharing a name, which is not an `add-add` conflict and would otherwise merge into an invalid schema. The validator catches it.

## 4. Domain model

```
Schema { tables: Table[] }
Table { id, name, columns: Column[], indexes: IndexDef[], constraints: ConstraintDef[] }
Column { id, name, type, length?, nullable, default?, primaryKey }
IndexDef { id, name, columnIds[], unique }
ConstraintDef { id, name, type: check|foreign_key|unique, definition, columnIds? }

Repo { id, name, branches: Branch[], defaultBranch, createdAt }
Branch { name, headCommitId }
Commit { id, parentIds[], message, schema: Schema, createdAt }
```

Every commit stores a full schema snapshot (not a diff or op-log — see `decisions.md` #2). A merge commit has two `parentIds`. On disk, a repo's branch pointers and its commits are stored as separate files rather than as one nested object — see `decisions.md` #3 and `LOW_LEVEL_DESIGN.md` §6 for the storage layout.

## 5. User-facing workflows

| Workflow | Where |
|---|---|
| Create/select/delete a repository | Left sidebar — repository picker |
| Create/switch/delete/search a branch | Left sidebar — branch list |
| Pick a table to work on | Table pane (second column) |
| Edit schema (tables/columns/indexes/constraints) on the current branch | Schema tab |
| View commit history for the current branch | History tab |
| Compare two branches *and* merge one into the other, resolving conflicts interactively | "Compare & merge" sheet |

The screen is three columns of narrowing scope — repository and branches, then tables on the
current branch, then the selected table. Comparing and merging is deliberately *not* a tab:
tabs describe the branch you're on, while a merge is about two branches at once, so it opens
as a sheet over the app instead (see `decisions.md` #14).

## 6. API summary

All endpoints under `/api`. Full request/response shapes are in `LOW_LEVEL_DESIGN.md` §7.

- `GET/POST /repos`, `GET/DELETE /repos/:repoId`
- `POST /repos/:repoId/branches`, `DELETE /repos/:repoId/branches/:name`
- `GET /repos/:repoId/branches/:name/schema`
- `GET /repos/:repoId/branches/:name/log`
- `POST /repos/:repoId/branches/:name/ops/:op` — applies one schema-editing operation, creates a commit
- `GET /repos/:repoId/diff?from=&to=`
- `POST /repos/:repoId/merge` — `{ source, target, resolutions?, apply? }`; preview when `apply` is falsy, commits when `apply: true` and neither conflicts nor validation violations remain. Resolution keys are field-scoped (`column:<tableId>:<columnId>:type`). The response carries `conflicts` (still outstanding), `entities` (the stable set of cards to render), and `validation`.

## 7. Non-functional notes

- Single-user, local-first tool; no auth, no concurrent-write protection (see `decisions.md` #3, #8).
- Storage is plain files on disk (one per repo, one per commit) — fine for the data volumes this tool produces, not intended to scale past that (see `decisions.md` #3 and its closing note on scale).
- Frontend is a plain Vite/React SPA; no SSR needed (see `decisions.md` #11).

## 8. Testing

The diff, merge, and validation engines are the parts that must be provably correct — they're covered by 53 unit tests (`server/tests/`) exercising: identity-based rename vs. drop+add detection, clean non-overlapping merges, disjoint field edits merging without conflict, field-scoped edit/edit conflicts resolved independently, optional-field add and removal, add/add requiring exact per-field equality, atomic `columnIds`, modify/delete (both resolution paths), entity-context stability across resolution, provenance, every validation rule, and the guard that the validator enforces nothing the schema editor doesn't. See `LOW_LEVEL_DESIGN.md` §7 for the full list.
