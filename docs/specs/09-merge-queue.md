# 09. Merge queue

**Status:** draft
**Outcome:** Reviewed branches merge one at a time in the order they passed review, each verified against the base as it is then, so parallel lanes don't break each other.
**Actors:** the lead (merges within `approvals.delegate.merge`); the person (merges from the pane otherwise); lanes (resolve their own conflicts)
**Depends on:** 05-lead-loop, 03-approve-review-merge

## In scope

- A queue of branches that passed the lead's review, in the order they passed.
- Merging the head of the queue with `code-kit merge` (`--delegated` for the lead, `--person` from the pane), which verifies first.
- A branch that no longer merges cleanly, or fails verify against the moved base, goes back to its lane.

## Data

| Entity | Field  | Type      | Required | Rules                                       |
| ------ | ------ | --------- | -------- | ------------------------------------------- |
| Entry  | branch | string    | yes      | Unique in the queue                         |
| Entry  | passed | timestamp | yes      | When the lead's review passed it            |
| Entry  | state  | enum      | yes      | `waiting`, `merging`, `merged`, `sent back` |

The queue is kept in `.claude/state/merge-queue.json` in the main checkout, so a restarted session picks it up.

## States

`waiting` → `merging` → `merged` | `sent back` (conflict or verify failure; recorded with `code-kit sent-back`).

## Requirements

### MQ-1 Order

Branches merge in the order their reviews passed; one at a time.

**Acceptance**

- Given web/st-4 passed before api/st-5, then web/st-4 merges first and api/st-5 is verified against the base that includes it.

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

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
