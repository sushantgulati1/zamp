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

## 5. When there's a conflict, you pick a whole version — not field by field

**What I did:** If two branches both changed the same column differently, you're shown both full versions and pick one, rather than being asked "keep this field or that field?" for every individual attribute.

**Why:** Picking pieces from each version could create something invalid (e.g., mixing values that don't make sense together). Picking one whole version at a time is simpler, always safe, and easier to understand at a glance. (See #12 for how this choice is actually displayed to the person resolving it.)

---

## 6. "Deleted on one side, edited on the other" is its own special conflict

**What I did:** If Branch A deletes a column and Branch B changes that same column, this is treated as a distinct type of conflict — not lumped in with "both branches edited it differently."

**Why:** This is a case a lot of tools quietly get wrong by picking a default (usually either "always keep it" or "always delete it"). Either default can silently throw away someone's work. So instead, the tool always stops and asks: keep the edited version, or confirm the delete?

---

## 7. A whole table changing doesn't automatically mean a conflict

**What I did:** If both branches changed the same table, the tool looks inside the table and compares column-by-column, instead of treating "this table is different on both sides" as one big conflict.

**Why:** Without this, adding a totally unrelated column on each branch (like Branch A adds `email`, Branch B adds `phone`) would look like a conflict just because the table object changed on both sides — even though nothing actually clashes. Looking inside avoids tons of fake conflicts.

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

## 12. Conflicts are shown as a compact diff table, not full duplicated cards

**What I did:** Each conflict shows one compact table — one row per field, three columns: Base / Source branch / Target branch. Rows where all three match are muted since they're not in question. Only the row(s) that actually differ are highlighted.

**Why:** If a column has 6 fields and only `type` is different, showing two complete versions side by side means scanning through several identical fields to spot the one that matters. Highlighting only what's actually different lets the person resolving the conflict see, at a glance, exactly what their choice affects — instead of doing the comparison themselves. You still pick "keep source" or "keep target" as a whole (see #5), but the table makes that choice easy to reason about.

---

## 13. A conflict you've decided stays on screen

**What I did:** The server only ever returns conflicts that are *still* unresolved — that's what makes "can this merge be applied?" a simple `conflicts.length === 0` check. But the UI keeps its own list of every conflict it has seen for the current pair of branches, so a conflict you just decided stays visible, marked resolved, with an "Undo decision" button.

**Why:** Rendering the server's list directly meant a conflict card disappeared the instant you clicked a choice. That looks like the decision worked, but it leaves you with no way to see what you decided or change your mind — and on a merge with several conflicts, no way to review the set before committing to it. Since resolutions are what the merge is *for*, they should be the most visible thing on the screen, not the thing that vanishes.

**Tradeoff:** the client now holds a little state that mirrors something the server computed, which is exactly the kind of duplication that drifts. It's kept honest by only ever *adding* to the list from server responses and treating the server's response as the authority on what's still outstanding — the client never decides a conflict is resolved on its own.

---

## A note on scale

The per-repo, per-commit file layout (#3) keeps writes isolated and avoids one repo's changes touching another's data. It does **not** make this ready for many people, many schemas, or very long history:
- Reading a branch's full history still means reading every commit file — there's no pagination.
- There's still no protection against two people saving to the same branch at the same time.
- There's no indexed search across repos or commits.

None of this was solved in this build — it wasn't in scope for the timeframe. Fixing it for real would mean moving to an actual database (like Postgres) with proper indexing, pagination, and safe concurrent writes.
