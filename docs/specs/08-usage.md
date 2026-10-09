# 08. Usage per lane

**Status:** draft
**Outcome:** The person sees what each lane, story and background agent costs, outliers are flagged, and background agents stop before the plan runs out.
**Actors:** the mod (measures); the person (reads)
**Depends on:** 11-panes

## In scope

- Tokens (input, output, cache reads) per agent, rolled up per story and lane, for the session.
- A flag when a story uses three times the median of the stories finished this session.
- Pausing every background agent when the plan's 5-hour usage passes 80%, and resuming below it.

## Later

- Usage kept across sessions, per story, in the repository.

## Data

| Entity | Field   | Type    | Required | Rules                                              |
| ------ | ------- | ------- | -------- | -------------------------------------------------- |
| Usage  | agent   | string  | yes      | The agent id; the lead is `lead`                   |
| Usage  | story   | string  | no       | The story the agent works on, from its brief       |
| Usage  | lane    | string  | no       |                                                    |
| Usage  | input   | integer | yes      | Tokens                                             |
| Usage  | output  | integer | yes      |                                                    |
| Usage  | cache   | integer | yes      | Cache reads                                        |
| Plan   | percent | number  | yes      | The 5-hour window's use, from the session's limits |

## Requirements

### USE-1 Measured per agent

Every model request's usage is attributed to the agent that made it, and rolled up to its story and lane.

**Acceptance**

- Given a lane agent's turn, when it completes, then its tokens appear on its lane's row within 2 seconds.

### USE-2 Shown

The pane shows usage per lane and story, and the background agents' share, with the plan's 5-hour use as a bar.

### USE-3 Outliers flagged

A story whose usage passes three times the median of the stories finished this session (with at least three finished) is flagged in the band: "ST-7 has used 3.4× the usual". Nothing is stopped.

**Acceptance**

- Given three finished stories at about 200k tokens and ST-7 at 700k, then the band flags ST-7.

### USE-4 Background agents pause near the limit

When the plan's 5-hour use passes 80%, the reviewer, card writer and curator stop starting new work, and running ones finish; the band says "background agents paused: plan at 82%". Below 80% they resume. The lead and lanes are never paused by the harness.

**Acceptance**

- Given the plan at 81%, when a branch finishes, then no reviewer starts and the review is marked `skipped`.

## Open questions

| Question                                                                         | Owner  | Blocks |
| -------------------------------------------------------------------------------- | ------ | ------ |
| Whether usage per agent is readable from the session's model requests (spike C). | Claude | USE-1  |
