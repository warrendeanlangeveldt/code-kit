# 09. Merge queue

**Status:** draft
**Outcome:** Reviewed branches merge one at a time in the order they passed review, each verified against the base as it is then, so parallel lanes don't break each other.
**Actors:** the lead (merges within `approvals.delegate.merge`); the person (merges from the pane otherwise); lanes (resolve their own conflicts)
**Depends on:** 05-lead-loop, 03-approve-review-merge

## In scope

- A queue of branches that passed the lead's review, in the order they passed.
- Merging the head of the queue with `code-kit merge` (`--delegated` for the lead, `--person` from the pane), which verifies first.
- A branch that no longer merges cleanly, or fails verify against the moved base, goes back to its lane.
- The lead pausing the whole queue on purpose, with why (MQ-8).

## Data

| Entity | Field  | Type      | Required | Rules                                       |
| ------ | ------ | --------- | -------- | ------------------------------------------- |
| Entry  | branch | string    | yes      | Unique in the queue                         |
| Entry  | passed | timestamp | yes      | When the lead's review passed it            |
| Entry  | state  | enum      | yes      | `waiting`, `merging`, `merged`, `sent back` |

The queue is kept in `.claude/state/merge-queue.json` in the main checkout, so a restarted session picks it up, and every command finds the main checkout before it does anything else: a merge run from inside a lane's worktree still reaches the queue once that worktree is done with. The lead's pause is kept beside it, in `.claude/state/merge-queue-paused.json` (MQ-8).

## States

`waiting` → `merging` → `merged` | `sent back` (conflict or verify failure; recorded with `code-kit sent-back`).

## Requirements

### MQ-1 Order

Branches merge in the order their reviews passed; one at a time. Each is verified as it will land: the branch merged with the base as it is then, in a fresh checkout with its own copy of the base's checkout's installs, never at the branch's own head and never without its dependencies. A branch's worktree can be far behind the base, or hold no installs at all, so its installs are never used. Where the merged tree's manifests or lockfiles differ from the installs copied in, the project's install runs in the fresh checkout first (`regression.prepare`, else the install its lockfile calls for); one that fails there says nothing against the branch, which keeps its place. Where code-kit knows no install for what differs, the merge says which installs the checks ran with, and that they may not match. While a `queue merge` runs, its head is marked as merging: a second run starts nothing, and `next` asks for no merge until it's done; a run that died leaves the head waiting in its place.

A queued branch whose commit the base already holds (merged outside the queue, or by a run that couldn't record it) leaves the queue as merged, said so, and is never verified again or sent back: against the base it's an empty change, which says nothing about it.

Only uncommitted changes to the files a merge changes stop it, in the base's checkout. It looks before the verify, which can take many minutes, and again before merging; changes to other files there (a log another tool appends at each turn) are carried as they are. A merge refused for them keeps the branch in its place.

A merge run from inside the merged branch's own worktree keeps that worktree, since its shell is in it, and says so; it goes at the next merge (LEAN-8).

**Acceptance**

- Given web/st-4 passed before api/st-5, then web/st-4 merges first and api/st-5 is verified against the base that includes it.
- Given web/st-6 behind main, which has since gained a fix its check needs, and no worktree of its own, then its checks run on it merged with main, with the installs of the main checkout copied in, and it merges.
- Given web/st-31's worktree with no installs, then its checks run with the main checkout's, and it merges.
- Given web/st-32 changing the lockfile, then the install runs in the merged tree's checkout, the main checkout's installs are untouched, and the merge says so; given that install failing, then nothing merges and web/st-32 keeps its place, not sent back.
- Given the lead running `queue add web/st-30 && queue merge --delegated` from web/st-30's own worktree, then web/st-30 is merged, its entry reads merged, its worktree stays until the next merge, and the next `queue merge` finds the queue empty.
- Given web/fix-2 queued and then merged into main by hand, then `queue merge` says it was already merged, and it leaves the queue as merged, not sent back as a fix without a test.
- Given a tool appending to a tracked file in the main checkout while web/st-50 is verified, then web/st-50 merges and the file keeps its change; given an uncommitted change to a file web/st-51 adds, then nothing is verified or merged, and it keeps its place.

### MQ-2 Who merges

Where `approvals.delegate.merge` is on and autonomy is `autonomous`, the loop prompts the lead to merge the head of the queue (`code-kit merge <branch> --delegated`). Otherwise the head of the queue shows in the band with Merge for the person (ACT-4).

Delegation is read from the config committed on the base, so a branch can't grant itself merges. Until the base has one (a new project's first merge, which brings code-kit's rules onto it), the merge is the person's: `next` says so instead of prompting the lead, the band reads "lead/st-1 is next to merge: the first merge is yours, then the lead merges", and the lead's `--delegated` merge is refused with the person's way to make it.

### MQ-3 Conflicts go back to the lane

A branch that no longer merges cleanly, or fails verify against the moved base, is sent back (`code-kit sent-back <branch> --reason "conflicts with <base> after <branch>"`); the loop dispatches the lane's fix, which merges the base and resolves; it rejoins the queue after its next review.

**Acceptance**

- Given api/st-5 conflicting with the base after web/st-4 merged, then api/st-5 is sent back with that reason, and the next item merges.

### MQ-4 Shown

The pane shows the queue in order with each entry's state.

### MQ-5 Stories merge only into the base

A story's branch (`<lane>/st-<n>`) reaches the project only through the queue, into the base. An agent's `git merge` of a story branch into any other branch that isn't itself a story's (an integration branch such as `lead/next`) is refused, with the way through the queue. Merged elsewhere, the story looks unmerged to the queue, the trail and worktree cleanup (LEAN-8), and that branch becomes a second base that never reaches the first. A lane merging the base or a story it depends on into its own story's branch is unaffected (MQ-3).

**Acceptance**

- Given the lead on `lead/next`, then `git merge web/st-1` is refused, and so is `git switch lead/next && git merge origin/web/st-1`; `git merge main` there is not.
- Given a lane on `web/st-2`, then `git merge main` and `git merge web/st-1` are not refused.

### MQ-6 Merged work reaches the remote

The base's rules say how a merge reaches the remote's base (`branches.publish`, read from the config committed on the base). With `push`, the merge pushes the base, fast-forward only. With `pull-request`, for a base the remote only lets change through pull requests (GitHub's branch protection), it pushes the base's head to code-kit's own branch `code-kit/publish-<base>` and opens a pull request from it, titled with the stories it holds; or updates the one already open. Moving the remote's base is the person's, or the lead's where `approvals.delegate.push` is on: then the lead pushes, or merges the pull request and deletes code-kit's branch, and the local base fast-forwards to the remote's. Otherwise nothing is pushed to the base, and the pull request waits for the person. A pull request GitHub won't merge yet (a review or a check it requires) waits there, and the local merge stands; `code-kit publish --delegated|--person` tries again. Left unset, code-kit doesn't publish, as before.

**Acceptance**

- Given `branches.publish` `pull-request` and pushing delegated, when the lead merges `web/st-1`, then a pull request "ST-1 from the code-kit queue" is opened from `code-kit/publish-main` and merged, the remote's main contains `web/st-1`, and the branch is deleted.
- Given GitHub refuses to merge it, then the merge stands locally, the pull request waits, and `code-kit publish --delegated` merges it once GitHub allows.
- Given pushing isn't delegated, then the lead opens the pull request and leaves it for the person.
- Given `branches.publish` `push` and pushing delegated, then the merge pushes main.

### MQ-7 Branches that only land together

Some reviewed branches break the base merged alone: a new API and the follow-up that updates its callers. The lead queues such a branch with the partners it lands with: `code-kit queue add <branch> --with <branch>[,<branch>]`. It waits in the queue, neither merged nor sent back, and `next` says what it waits for, until each partner is reviewed and queued too; meanwhile the queue merges the branches after it. Once the whole group is queued, it's verified as one tree (each branch merged onto the base as it is then, the checks run on the result), each branch is still held to its own lane's paths for its own changes, and the branches merge one after another. A member's own changes are measured against the base merged with its partners, leaving out a partner built on it: a lane's branch built on its lead partner's, as dispatch has it, isn't held to the lead's files, and the lead's branch is still held to its own. A group that conflicts or fails verify goes back to its lanes together; a member that moved after its review leaves the queue to be reviewed again, and the group waits for it.

**Acceptance**

- Given `web/st-20`, a new API, queued with `--with web/st-21`, the follow-up that updates its callers, then `queue merge` merges nothing and says it waits for `web/st-21` to be queued, and `next` asks for no merge of it and no review of it.
- Given `web/st-21` then queued, then `queue merge` verifies both merged onto main and merges both.
- Given `lead/st-40` (docs) queued with `web/st-41`, built on it, then the group merges, and web/st-41 isn't reported for the lead's docs; given `web/st-43`, built on `lead/st-42`, also changing a doc itself, then the group goes back, naming web/st-43's own doc and not lead/st-42's.

### MQ-8 The lead pauses the queue

The lead can hold the whole queue on purpose, saying why: `code-kit queue pause --reason "…"`, until `code-kit queue resume`. While it's paused, `queue merge` merges nothing and says why; `next` offers no merge step and lists the pause under attention; the band offers no Merge and shows the pause as a note. Branches are still queued and keep their places. A story the lead holds on its own (LOOP-15) holds its branch in the queue the same way, and its group with it, while the queue goes on with the next.

**Acceptance**

- Given the queue paused "the base is being released", then `queue merge` merges nothing and says so, and `next` offers no merge and lists the pause with its reason; once resumed, the head is offered again.
- Given ST-2 held, then `queue merge` merges the next branch, says why web/st-2 waits, and keeps it in its place.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
