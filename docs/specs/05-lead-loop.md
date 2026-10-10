# 05. Lead loop

**Status:** draft
**Outcome:** A build keeps moving between presses: ready stories are dispatched, finished branches reviewed and merged, and stalled lanes recovered, without the person re-prompting the lead.
**Actors:** the mod (watches and prompts); the lead (acts, with the existing skills); lane agents; the person (sets autonomy, pauses the loop)
**Depends on:** 06-hold-and-ask, 07-reviewer, 09-merge-queue, 12-settings

## In scope

- Prompting the lead to dispatch, review and merge when it's idle, from what `next` reports.
- Stall detection per lane agent: a message at 5 minutes, a restart at 10, at most twice, then a flag.
- Autonomy levels, autonomous by default; a pause in the band.
- The loop's own record of what it did, shown in the pane.

## Later

- Running several loops for several projects in one session.

## Data

| Entity    | Field    | Type      | Required | Rules                                                                      |
| --------- | -------- | --------- | -------- | -------------------------------------------------------------------------- |
| Loop step | at       | timestamp | yes      |                                                                            |
| Loop step | kind     | enum      | yes      | `dispatch`, `review`, `merge`, `nudge`, `restart`, `flag`, `pause`, `done` |
| Loop step | target   | string    | yes      | Story ids, a branch, or an agent                                           |
| Loop step | prompt   | string    | no       | The prompt given to the lead, for dispatch, review and merge               |
| Loop step | outcome  | string    | no       | What came of it, once known                                                |
| Agent     | lastCall | timestamp | yes      | The agent's last tool call, from the session's events                      |
| Agent     | restarts | integer   | yes      | Restarts by the loop for the current story, at most 2                      |

Loop steps are kept for the session and shown in the pane; they aren't written to the repository.

## States

The loop: `running` → `waiting` (the lead is mid-turn, or the person is typing) → `running`; `running` → `paused` (the person pressed Pause, or autonomy is `off`) → `running`; `running` → `done` (every story in the plan is done).

A lane agent, as the loop sees it: `working` → `quiet` (no tool call for 5 minutes) → `nudged` → `working` or `restarted` (10 minutes) → `flagged` (after 2 restarts). An agent waiting on a held call (06) stays `working`.

## Requirements

### LOOP-1 Prompts the lead when it's idle

When no turn is running and the prompt holds no draft, the loop asks `next` what to do and, if it's a step the lead takes (`dispatch`, `lead`, `review`), submits that step to the lead as a prompt naming the skill and its argument, for example "Dispatch ST-7, ST-9: run /code-kit:dispatch ST-7 ST-9." (Claude Code refuses a mod's prompt that begins with `/`). It never submits while a turn runs or while the person is typing, and submits at most one prompt per idle period.

- **Who:** the mod; only in a project with `.claude/code-kit.json`.
- **Errors:** if `next` fails, the band shows its error and the loop waits for the next change.
- **Events:** a loop step `dispatch` or `review`, with the prompt.

**Acceptance**

- Given two ready stories and an idle lead, when the loop ticks, then the lead receives one prompt dispatching both, and the pane records the step.
- Given a turn in progress, when a lane finishes, then nothing is submitted until the turn completes.
- Given the person typing in the prompt, when the lead is idle, then nothing is submitted until the draft is sent or cleared.

### LOOP-2 The lead decides concurrency

The loop doesn't cap how many lanes run. It dispatches what `next` reports ready (code-kit works out from dependencies what can run in parallel), and the lead's dispatch decides how many lanes go.

**Acceptance**

- Given four ready stories in three lanes, when the loop dispatches, then the prompt names all four and the dispatch skill decides what starts.

### LOOP-3 Stalls: nudge, restart, flag

A lane agent with no tool call for 5 minutes is messaged: "No tool call for 5 minutes: report where you are, or carry on." At 10 minutes it's stopped and its story dispatched again with the same brief on the same branch, by prompting the lead. After 2 restarts on one story, the lane is flagged in the band for the person and not restarted again. An agent waiting on a held call (06) or running a long command is never counted as quiet while that call is open.

- **Errors:** a message that can't be delivered counts as a nudge; the restart follows at 10 minutes.

**Acceptance**

- Given a lane agent silent for 5 minutes, when the loop ticks, then the agent receives the nudge and the pane shows `nudged`.
- Given it is still silent at 10 minutes, then it's stopped and the lead is prompted to dispatch its story again; the pane shows `restarted 1/2`.
- Given a third stall on the same story, then the band shows "web stalled 3 times on ST-4" with Lanes and Resume buttons, and nothing restarts it.

### LOOP-4 Reviews and merges in sequence

When a branch is ready for review, the loop starts the reviewer (07) if it's on, and prompts the lead to review once the reviewer reports (or at once when it's off). When the lead's review passes a branch, the merge queue (09) takes it.

**Acceptance**

- Given the reviewer on and a branch finished, when the reviewer reports, then the lead is prompted `/code-kit:review <branch>` with the reviewer's findings named.

### LOOP-5 Autonomy

Autonomy (12) is `autonomous` (the default), `propose` or `off`.

- `autonomous`: the loop prompts the lead on its own, and merges go through the queue where `approvals.delegate.merge` allows.
- `propose`: each step appears in the band ("Dispatch ST-7, ST-9? 1 Go") and is submitted when the person presses it.
- `off`: no steps; the panes and band still show everything.

**Acceptance**

- Given `propose`, when two stories are ready, then the band offers the dispatch and nothing is submitted until the person presses Go.

### LOOP-6 Pause and resume

The band shows the loop's state ("loop on", "loop paused") with a Pause or Resume key. Pausing stops new steps at once; a turn in progress finishes. The pause is recorded (`code-kit loop`), so another tool's background work in the project, such as Context Graph's card writer and curator, pauses with it; a new session starts with the loop running.

**Acceptance**

- Given the loop running, when the person presses Pause, then no further prompt is submitted until Resume.
- Given the loop paused, then `code-kit loop --json` reports it paused, and after Resume, running.

### LOOP-7 Done

When every story in the plan is done, the loop stops and the band reads "Milestone done: N stories merged" until dismissed.

### LOOP-8 A step that doesn't take goes to the person

The lead is prompted with one step at most twice in a row. A step still next after that didn't take (the lead couldn't, or wouldn't), and lanes committing elsewhere don't make a third prompt useful: the band offers it instead, "Merge lead/st-1: still next after 2 prompts. Ask the lead again?", with Go. A different step, or none for the lead, starts the count again.

**Acceptance**

- Given `next` reporting the same merge after each of four lead turns while lanes commit, then the lead is prompted twice, the band offers the third, and Go submits it.

## Quality targets

- A step is submitted within 5 seconds of the lead going idle with work to do.
- The loop never submits two prompts for the same step.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
