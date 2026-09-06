# Spec — Strata: version control for database schemas

## 1. Problem

Build branch, diff, and merge for database schemas — the Git workflow, applied to schema shape instead of files. A user should be able to branch a schema, evolve it independently on each branch (add/drop/rename/retype columns; change constraints and indexes; create/drop tables), see exactly what diverged between two branches, and merge one branch into another with conflicts surfaced explicitly when both sides changed the same thing incompatibly.

**Who it's for:** a small team (or a solo developer working across features) that wants to evolve a schema on parallel branches — the way they already do with application code — without hand-reconciling `CREATE TABLE` statements by eye, and without silently losing someone's change when two branches touch the same column.

**Out of scope, explicitly:** row data. The artifact under version control is the schema itself — table/column/index/constraint definitions — not the rows inside those tables. See `decisions.md` items 8–9 for the full list of what else was deliberately cut (auth, rebase, cherry-pick).

## 2. The hard part

Two things make this non-trivial, and both are addressed head-on rather than routed around (see `decisions.md` for the full reasoning):

1. **Identity.** Diffing two schema snapshots by name alone can't distinguish "column renamed" from "column dropped, unrelated column added" — they produce the same textual diff. Solved by giving every table/column/index/constraint a stable id assigned at creation, independent of its current name.
2. **Three-way merge with real conflicts.** Comparing two branches' *tip* schemas only tells you they differ, not what to do about it — you need the common ancestor to know which side actually changed something. Solved with a proper base/ours/theirs 3-way merge, including the case most naive tools skip: one branch deletes something the other branch modified (`modify-delete` conflict), which can't be resolved by picking a "usual" winner without silently losing information.

## 3. Scope of this build (the "slice")

**End-to-end path shipped:**
1. Create a repository (starts with an empty `main` branch).
2. Edit the schema on `main`: create tables, add/rename/retype/drop columns, toggle nullable/default/primary key, add/drop indexes and constraints.
3. Branch from `main`.
4. Make independent edits on both branches.
5. View a structured diff between any two branches (added/removed/modified tables, columns, indexes, constraints).
6. Preview a merge between two branches. Non-overlapping changes merge automatically with zero conflicts. Overlapping changes are surfaced as conflicts requiring an explicit decision.
7. Resolve conflicts — each shown as a compact table (Base / Source / Target per field, with only the differing field highlighted) — and pick keep-source / keep-target per conflict (or confirm-delete / keep-edited-version for a modify-delete conflict), then apply the merge, producing a merge commit with two parents.

**Edge case handled deliberately:** modify/delete conflicts (one branch drops an entity the other branch has since modified) — the case flagged in the brief as commonly skipped.

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
| Create/select a repository | Top bar |
| Create/switch/delete a branch | Left sidebar |
| Edit schema (tables/columns/indexes/constraints) on the current branch | Schema tab |
| Compare any two branches structurally | Diff tab |
| Merge one branch into another, resolving conflicts interactively | Merge tab |
| View commit history for the current branch | History tab |

## 6. API summary

All endpoints under `/api`. Full request/response shapes are in `LOW_LEVEL_DESIGN.md` §7.

- `GET/POST /repos`, `GET/DELETE /repos/:repoId`
- `POST /repos/:repoId/branches`, `DELETE /repos/:repoId/branches/:name`
- `GET /repos/:repoId/branches/:name/schema`
- `GET /repos/:repoId/branches/:name/log`
- `POST /repos/:repoId/branches/:name/ops/:op` — applies one schema-editing operation, creates a commit
- `GET /repos/:repoId/diff?from=&to=`
- `POST /repos/:repoId/merge` — `{ source, target, resolutions?, apply? }`; preview when `apply` is falsy, commits when `apply: true` and no conflicts remain

## 7. Non-functional notes

- Single-user, local-first tool; no auth, no concurrent-write protection (see `decisions.md` #3, #8).
- Storage is plain files on disk (one per repo, one per commit) — fine for the data volumes this tool produces, not intended to scale past that (see `decisions.md` #3 and its closing note on scale).
- Frontend is a plain Vite/React SPA; no SSR needed (see `decisions.md` #11).

## 8. Testing

The diff and merge engines are the parts that must be provably correct — they're covered by 17 unit tests (`server/tests/`) exercising: identity-based rename vs. drop+add detection, clean non-overlapping merges, edit/edit conflicts (with and without resolution), modify/delete conflicts (both resolution paths), and table-level add/add and modify/delete scenarios. See `LOW_LEVEL_DESIGN.md` §7 for the full list.
