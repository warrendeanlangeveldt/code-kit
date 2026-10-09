# 07. Reviewer agent

**Status:** draft
**Outcome:** Every finished branch gets a second, independent review in the background, graded by severity, before the lead decides.
**Actors:** the mod (starts the reviewer); the reviewer agent (reads, never writes); the lead (decides); the person (reads findings)
**Depends on:** 05-lead-loop, 08-usage, 12-settings

## In scope

- A background reviewer started when a branch is ready for review, if the reviewer is on.
- It runs `code-kit verify` on the branch and the review checklist, read-only, and reports findings graded `nit`, `concern` or `blocker`.
- The findings are shown in the pane and handed to the lead's review.

## Later

- Reviewers specialised by lane (a UI reviewer for web, a data reviewer for migrations).

## Data

| Entity  | Field    | Type   | Required | Rules                                  |
| ------- | -------- | ------ | -------- | -------------------------------------- |
| Review  | branch   | string | yes      |                                        |
| Review  | head     | string | yes      | The commit reviewed                    |
| Review  | state    | enum   | yes      | `running`, `done`, `failed`, `skipped` |
| Finding | severity | enum   | yes      | `nit`, `concern`, `blocker`            |
| Finding | where    | string | no       | `path:line`                            |
| Finding | text     | string | yes      | What's wrong and what fixed looks like |
| Finding | rule     | string | no       | The requirement or rule it cites       |

Findings are kept with the review for the session and written into the lead's review prompt.

## States

`running` → `done` (findings reported) | `failed` (the agent errored or was stopped; the lead reviews without it) | `skipped` (the reviewer is off, or paused for usage, 08).

## Requirements

### REVW-1 Started when a branch is ready

When a branch is ready for review and the reviewer is on, the mod starts one reviewer agent for it, in the background, with the branch, its story and requirements, and the review checklist. One reviewer per branch head; a branch that moves gets a new review.

**Acceptance**

- Given the reviewer on and `web/st-4` finished, then a reviewer starts for its head commit and the pane shows it running with a clock.

### REVW-2 Read-only

The reviewer may read, search and run `code-kit verify` and the project's test commands. It never writes files, commits, approves or merges; code-kit's hooks refuse those for it.

**Acceptance**

- Given a reviewer that tries to edit a file, then the hooks refuse it and the review continues.

### REVW-3 Graded findings

The reviewer reports each finding as `nit`, `concern` or `blocker`, with where, what, and the requirement or rule it cites. A failing `verify` is always a blocker.

**Acceptance**

- Given a branch whose verify fails, then the review has a blocker naming verify's problem.

### REVW-4 Feeds the lead

When the review is done, the lead is prompted to review the branch with the findings included. A blocker always means send back; the lead decides on concerns and nits.

**Acceptance**

- Given a review with one blocker, then the lead's review prompt includes it and the branch is sent back.

### REVW-5 Shown in the pane

The story's drill-down (11) shows the findings grouped by severity, each with its location as a link into the diff.

## Quality targets

- A reviewer never delays the lead: the lead reviews without it if it hasn't reported within 15 minutes.

## Open questions

| Question                            | Owner  | Blocks      |
| ----------------------------------- | ------ | ----------- |
| The default model for the reviewer. | Warren | 12-settings |
