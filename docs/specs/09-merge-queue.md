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

### MQ-3 Conflicts go back to the lane

A branch that no longer merges cleanly, or fails verify against the moved base, is sent back (`code-kit sent-back <branch> --reason "conflicts with <base> after <branch>"`); the loop dispatches the lane's fix, which merges the base and resolves; it rejoins the queue after its next review.

**Acceptance**

- Given api/st-5 conflicting with the base after web/st-4 merged, then api/st-5 is sent back with that reason, and the next item merges.

### MQ-4 Shown

The pane shows the queue in order with each entry's state.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
