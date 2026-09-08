# decisions.md

## What this is

Git, but for database schemas instead of files. You can branch a schema, change it (add/remove/rename columns, tables, indexes, etc.), see what changed between two branches, and merge branches back together. Row data (the actual rows in your tables) is NOT part of this — only the shape of the schema is versioned.

Below is a plain-language log of the real decisions made while building it.

---

## 1. Every table/column/index gets a permanent ID

**What I did:** When you create a column, it gets a random ID behind the scenes that never changes, even if you rename it later. Everything internally tracks that ID, not the name.

**Why:** Imagine a column called `email` gets renamed to `email_address`. If the system only looked at names, it couldn't tell the difference between:
- "someone renamed this column," vs
- "someone deleted `email` and separately created a new column called `email_address`"

These look identical if you're just comparing names. But they should be treated very differently when merging two branches. Giving every column a permanent ID fixes this — rename it all you want, the system still knows it's "the same column."

**Tradeoff:** this only works for changes made through the app. If someone messed with the raw data file by hand, this guarantee wouldn't hold. That's fine — the app is meant to be the only way you edit schemas.

---

## 2. Each commit stores the whole schema, not just "what changed"

**What I did:** Every commit saves a complete snapshot of the entire schema at that point — not a small note like "added column X."

**Alternative:** Only save the individual change (like Git does with diffs), and rebuild the full picture by replaying every change from the beginning.

**Why:** Snapshots are much simpler to work with. Need to see what a branch looks like right now? Just look at its latest commit — no replaying history required. It also makes the merge logic simpler, since it only has to compare three snapshots (common starting point / your version / their version), not think about sequences of edits.

**Tradeoff:** you can't ask "show me every single edit that led here" in fine detail — just "what's different between these two points in time." Good enough for this tool's purpose.

---

## 3. Storage: plain files, one per repo, one per commit

**What I did:** Repos and commits are stored as plain files on disk, split up like this:
- A small manifest file listing just `{id, name, createdAt}` for every repo — enough to show a list of repos without opening any of them.
- One small file per repo, holding just its branch pointers (`branch name → latest commit id`). This is the only thing rewritten when someone makes a commit or a branch.
- One file per commit, written once and never touched again, since commits never change after they're created.

**Why:** The actual amount of data and the way it's accessed is simple — load one repo, add one commit, done. There's no complex searching or filtering that a database like Postgres is built for. Splitting the data this way (instead of one giant file for everything) means editing one repo never touches another repo's data, and a bad write only risks the one small file it was writing, not the whole system's history.

**Tradeoff:** this is still just files, not a database. It works well for one person using this locally, but it does not solve real scale — see the note at the bottom.

---

## 4. Finding "where two branches split" uses a simple search, not a perfect one

**What I did:** To merge two branches, the system needs to find their common starting point (like Git's "merge base"). It does this with a straightforward search rather than the more complex algorithm real Git uses.

**Why:** The simple search works correctly for every scenario this tool actually supports (branch, edit, merge back). The more complex algorithm is only needed for fancier workflows (like repeatedly merging the same two branches back and forth) that this tool doesn't offer.

---

## 5. Conflicts are resolved field by field, not by picking a whole version

**What I did:** If two branches both changed the same column, the tool compares it *attribute by attribute*. Anything only one branch touched gets merged in automatically. You're only asked about the specific attributes both branches changed to different values — and you decide each one separately.

**Alternative considered:** Show both full versions of the column and make you pick one wholesale. The appeal is safety — mixing attributes from two sides could produce a combination neither branch ever had, and might be invalid, whereas picking one whole side is always something that really existed somewhere.

**Why I rejected it:** that safety argument is fine in isolation and disastrous in practice. It means any two edits to the same column collide, *even when they have nothing to do with each other*. Branch A renames `email` to `email_address`; Branch B changes its type to `varchar(500)`. Those two edits don't disagree about anything — but whole-version picking calls it a conflict and makes you throw one of them away. That's the normal way two people work on the same table, so nearly every merge would conflict, and every resolution would destroy someone's work. At that point branches stop being worth having, which is the entire product.

So the safety argument gets answered properly instead of dodged: mixing is allowed, and a validator (#17) checks the merged result and blocks the merge if a mix produced something invalid. You get the automatic merging *and* the guarantee.

**Tradeoff:** more machinery — a field-level merge, a validator, and a resolve screen with per-attribute controls instead of two buttons. Worth it: a simpler version would have been simple and useless.

(See #12 for how the choice is presented, and #6 for the one case that's still a whole-entity decision.)

---

## 6. "Deleted on one side, edited on the other" is its own special conflict

**What I did:** If Branch A deletes a column and Branch B changes that same column, this is treated as a distinct type of conflict — not lumped in with "both branches edited it differently."

**Why:** This is a case a lot of tools quietly get wrong by picking a default (usually either "always keep it" or "always delete it"). Either default can silently throw away someone's work. So instead, the tool always stops and asks: keep the edited version, or confirm the delete?

---

## 7. A whole table changing doesn't automatically mean a conflict

**What I did:** If both branches changed the same table, the tool looks inside the table and compares column-by-column, instead of treating "this table is different on both sides" as one big conflict.

**Why:** Without this, adding a totally unrelated column on each branch (like Branch A adds `email`, Branch B adds `phone`) would look like a conflict just because the table object changed on both sides — even though nothing actually clashes. Looking inside avoids tons of fake conflicts.

**The same principle applies one level deeper:** looking inside the table stops "both branches touched this table" from being a fake conflict; looking inside the *column* (#5) stops "both branches touched this column" from being one too. It's applied until it runs out of levels — never call something a conflict at a level where you can still go down and check.

---

## 8. No logins, no multiple people editing at once

**What cut:** Anyone with the link can see and edit everything. There's no "two people editing the same thing at the same time" protection — if that happens, the last save wins and the other gets silently overwritten.

**Why:** Out of scope for the time given. The interesting problem here was branching/diffing/merging, not building a login system.

---

## 9. Only basic merging — no rebase, no cherry-pick

**What cut:** You can merge two branches. You can't move a branch onto a new base (rebase), grab just one specific change from another branch (cherry-pick), or merge three+ branches at once.

**Why:** Each of those is its own hard problem. Rather than doing five things halfway, the goal was to do one thing (merging two branches) really well.

---

## 10. The frontend and backend each keep their own copy of the data shapes

**What I did:** The website (frontend) and the server (backend) each have their own definitions of what a "Column" or "Table" looks like, instead of sharing one common definition.

**Why:** Sharing one definition properly requires extra project setup (a "monorepo") that wasn't worth the time for a project this size.

**Tradeoff:** if I change something on the backend, I have to remember to also update it on the frontend — nothing forces them to stay in sync automatically. In a bigger project, this is the first thing I'd fix.

---

## 11. It's a React app

**What I did:** The frontend is a React single-page app that talks to the backend over plain HTTP requests. No server-rendering framework, no extra layers.

**Why:** This is a tool people log into and use, not a public webpage. There's no benefit to server-rendering here, so a plain React app is the simplest thing that works.

---

## 12. Conflicts are shown as a compact diff table — and that table is the control

**What I did:** Each conflict shows one compact table — one row per field, three columns: Base / Source branch / Target branch. Rows the merge settled on its own are muted and labelled with *why* they settled ("converged", "only source changed"). Rows where both branches disagree get a source/target pick right there in the row — the table isn't an explanation of a decision made elsewhere, it *is* the decision.

**Alternative considered:** A read-only diff table paired with two buttons underneath ("keep source" / "keep target"). Rejected for the same reason as #5: resolution is field by field, so the decision belongs on the row it describes, not on a button below a summary of several rows at once.

**Why:** If a column has 6 fields and only `type` is in dispute, showing two complete versions side by side means scanning several identical fields to find the one that matters. This table shows, at a glance, exactly what's being decided and what isn't.

**Worth keeping visible:** the auto-merged rows stay on screen rather than being hidden. They're the evidence that most of the column merged itself — which turns the card from a demand into a report with one or two open questions.

---

## 13. A decided conflict stays on screen, with an Undo

**What I did:** Resolution happens at the attribute level (#5), so the server sends two things for a comparison: the full set of attributes that ever needed a decision, and the shrinking set of attributes still undecided. The UI renders one against the other — every attribute that needed a decision keeps a row on screen; once it drops out of the undecided set it's shown resolved, with the pick displayed and an "Undo decision" button. "Can this merge be applied?" is just `stillUndecided.length === 0`.

**Alternative considered:** Have the client keep its own list of decided conflicts, adding to it as you resolve each one, since the server only reports what's still outstanding. Rejected — that's state the client would have to mirror and keep honest by hand, when the server already knows the full set and can just send both.

**Why decided items stay visible at all:** rendering only the outstanding set means a row disappears the instant you make a choice. That looks like the decision worked, but leaves no way to see what you picked or change your mind — and on a merge with several conflicts, no way to review the whole set before committing. Since resolutions are what the merge is *for*, they should be the most visible thing on screen, not the thing that vanishes.

---

## 14. Diff and merge are one screen, and it isn't a tab

**What I did:** There's no Diff tab and no Merge tab. There's a **Compare & merge** button that opens a sheet over the app: pick a source and a target, see what diverged, resolve whatever conflicts that surfaces, apply. Tabs are down to Schema and History.

**Why:** Diff and merge were never two features. They're the same question asked twice — "what's different between these two branches, and what do I do about it" — and splitting them meant picking your two branches in one tab, then picking the same two again in the next. Worse, they didn't belong in that tab strip at all: Schema and History describe *the branch you're on*, while a comparison is about two branches at once. Putting it on the same rail implied it was another view of the current branch, which it isn't. A button that opens a sheet says what it actually is — a thing you go do, then come back from.

**Tradeoff:** you can't look at a diff and edit the schema side by side, since the sheet covers the app. That's the right call for a merge, which deserves undivided attention, but if this grew a "review someone's proposed change while editing" flow, the sheet would need to become a panel.

---

## 15. Three columns of narrowing scope, instead of one long page

**What I did:** Repository and branches on the left, tables on the current branch in the middle, the selected table on the right.

**Alternative considered:** Render every table on the branch stacked down one long page. Works fine for three tables and falls apart at twenty — you scroll past everything you don't care about to reach the one you do, and you lose your place every time the page refetches after an edit. Since every edit here is a commit and triggers a refetch, that would be constant.

**Why:** A list you pick from keeps the working set on screen and the selection stable across edits. Each column also narrows the scope of the next, which makes "where am I" answerable without reading a breadcrumb.

**Detail worth noting:** table selection lives in the app shell rather than the schema view, so it survives switching to History and back, and falls back to the first table if the selected one was dropped or doesn't exist on the branch you just switched to.

---

## 16. Commit ids are never shown

**What I did:** No hashes anywhere in the UI. History rows are identified by their message, relative time, and branch-ref chips; branches show their name, not their head commit.

**Why:** A hash is a storage detail. In Git you need it because you type it into commands — here there's no command line, nothing accepts a hash as input, and nothing in the UI is addressed by one. Showing a seven-character string next to every row cost attention and bought nothing. `Commit.id` still exists in the API and does real work (React keys, parent pointers, merge-base lookup) — it just isn't the user's business.

---

## 17. The merge validator only enforces rules the schema editor already enforces

**What I did:** Because you can now mix attributes from two branches (#5), the merged result gets checked before it can be applied — no duplicate table names, no duplicate column names inside a table, no empty names or types, no index pointing at a column the merge dropped. If any of that fails, the merge is blocked and each problem is a link back to the exact row whose pick caused it, so you can change your mind.

**The rule I held myself to:** the validator checks *exactly* what the ordinary schema editor checks, and nothing more.

**Why that rule matters:** it's tempting to also enforce things that merely seem sensible — like "a primary key column shouldn't be nullable". But the editor lets you do that on a single branch with no merge involved. If the validator enforced it anyway, you could get a merge blocked over a state that each branch was independently allowed to reach, with no way to fix it inside the merge screen. That's a worse failure than the one being fixed: a tool that refuses to merge two legal schemas. So the validator's job is strictly "did mixing produce something the editor would have rejected", never "is this schema good".

**The case this exists for:** every table gets a random permanent ID (#1), so two branches can never independently create *the same* table — they create two different tables that happen to share a name. Without a check, a naive merge would happily include both, silently producing a schema with two tables called `users`. The duplicate-name rule catches exactly this.

**Tradeoff:** that particular case is a dead end — there's no pick to change, because neither branch did anything wrong on its own. The tool says so plainly and tells you to rename on one branch first. A "rename one of them during the merge" flow would be nicer and is a bigger feature than it looks; reporting it honestly beats offering a button that can't help.

---

## 18. An index's column list is decided as a whole, not column by column

**What I did:** Field-by-field resolution (#5) stops at lists. If two branches both changed which columns an index covers, you pick one branch's list entirely — you don't merge the two lists together.

**Why:** the order of columns in an index is meaningful. An index on `(tenant_id, created_at)` is a genuinely different index from one on `(created_at, tenant_id)` — they speed up different queries. Merging two lists element by element would produce an ordering neither branch asked for, and it would look reasonable while being wrong, which is the worst kind of wrong. A list is one decision, so it gets one choice.

---

## A note on scale

The per-repo, per-commit file layout (#3) keeps writes isolated and avoids one repo's changes touching another's data. It does **not** make this ready for many people, many schemas, or very long history:
- Reading a branch's full history still means reading every commit file — there's no pagination.
- There's still no protection against two people saving to the same branch at the same time.
- There's no indexed search across repos or commits.

None of this was solved in this build — it wasn't in scope for the timeframe. Fixing it for real would mean moving to an actual database (like Postgres) with proper indexing, pagination, and safe concurrent writes.
