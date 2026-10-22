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
- One session in a project runs the loop; any other session opened there leaves its lead alone.
- Reading the lead's reply before prompting it again, so a reply that waits on the person isn't followed by another prompt.

## Later

- Running several loops for several projects in one session.

## Data

| Entity     | Field    | Type      | Required | Rules                                                                                                               |
| ---------- | -------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Loop step  | at       | timestamp | yes      |                                                                                                                     |
| Loop step  | kind     | enum      | yes      | `dispatch`, `review`, `merge`, `design`, `nudge`, `restart`, `flag`, `pause`, `resume`, `lead`, `done`              |
| Loop step  | target   | string    | yes      | Story ids, a branch, or an agent                                                                                    |
| Loop step  | prompt   | string    | no       | The prompt given to the lead, for dispatch, review and merge                                                        |
| Loop step  | outcome  | string    | no       | What came of it, once the lead's reply is read (LOOP-11): `done`, `started`, `needs-person`, `blocked`, or `unread` |
| Lead lease | session  | string    | yes      | The session that runs the loop (LOOP-10)                                                                            |
| Lead lease | at       | timestamp | yes      | When it last renewed the lease; one not renewed for 90 seconds has lapsed                                           |
| Agent      | lastCall | timestamp | yes      | The agent's last tool call, from the session's events                                                               |
| Agent      | restarts | integer   | yes      | Restarts by the loop for the current story, at most 2                                                               |

Loop steps are kept for the session and shown in the pane; they aren't written to the repository. The lead lease is kept with the pause in `.claude/state/loop.json`, in the main checkout.

## States

The loop: `running` → `waiting` (the lead is mid-turn, the person is typing, or the lead's reply waits on the person) → `running`; `elsewhere` (another session runs it) → `running` (that session ended, or the person pressed Lead from here); `running` → `paused` (the person pressed Pause, or autonomy is `off`) → `running`; `running` → `done` (every story in the plan is done).

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

A lane agent with no tool call for 5 minutes is messaged: "No tool call for 5 minutes: report where you are, or carry on." At 10 minutes it's stopped and its story dispatched again with the same brief on the same branch, by prompting the lead. After 2 restarts on one story, the lead is prompted to decide how the story goes on (a narrower brief, smaller stories, or handing it back), and the band shows a note (spec 23, WHO-4). An agent waiting on a held call (06) or running a long command is never counted as quiet while that call is open. Nor is an agent whose work is done: it has handed back, or its story is in review, in the merge queue or merged. Until the person has chosen how hands-off the loop is (and under propose), a restart is offered in the band like any other step, not taken.

- **Errors:** a message that can't be delivered counts as a nudge; the restart follows at 10 minutes.

**Acceptance**

- Given a lane agent silent for 5 minutes, when the loop ticks, then the agent receives the nudge and the pane shows `nudged`.
- Given it is still silent at 10 minutes, then it's stopped and the lead is prompted to dispatch its story again; the pane shows `restarted 1/2`.
- Given a third stall on the same story, then the lead is prompted with the story, its restarts and the agent's last call, and the band shows "web stalled 3 times on ST-4: the lead decides how it goes on" with Lanes, as a note, not a decision.

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

The band shows the loop's state ("loop on", "loop paused") with a Pause or Resume key. Pausing stops new steps at once; a turn in progress finishes. The pause is recorded (`code-kit loop`), so another tool's background work in the project, such as Context Graph's card writer and curator, pauses with it; a new session starts with the loop running, unless another session that still runs the loop (LOOP-10) paused it.

**Acceptance**

- Given the loop running, when the person presses Pause, then no further prompt is submitted until Resume.
- Given the loop paused, then `code-kit loop --json` reports it paused, and after Resume, running.

### LOOP-7 Done

When every story in the plan is done, the loop stops and the band reads "Milestone done: N stories merged" until dismissed.

### LOOP-8 A step that doesn't take is a note

The lead is prompted with one step at most three times in a row (spec 23, WHO-4). A step still next after that didn't take (the lead couldn't, or wouldn't), and lanes committing elsewhere don't make a fourth prompt useful: the band shows it as a note, "Merge lead/st-1: still next after 3 prompts to the lead", with Ask again. It isn't a decision: nothing is asked in the dialog. A different step, or none for the lead, starts the count again.

**Acceptance**

- Given `next` reporting the same merge after each of five lead turns while lanes commit, then the lead is prompted three times, the band shows the note, and Ask again submits it.

### LOOP-9 Never a story already in flight

`code-kit next` reads only the branches, so it can't tell a branch its lane agent is still building, or one a reviewer is already reviewing, from one that waits; nor a story dispatched a moment ago, before its first commit. Before prompting, the loop leaves out every story an agent at work names in its task (a lane agent is dispatched as "ST-12 booking form", a reviewer as "Review web/st-12"). A step left with no stories gives way to the next one `next` listed; with none left, the loop waits ("waiting: ST-10 is still with its agent"), and goes on when an agent finishes.

**Acceptance**

- Given ST-9 dispatched and its agent at work, and ST-4's lane agent still building, when `next` says review ST-4, then dispatch ST-9, then the lead isn't prompted and the band says it's waiting on both; when ST-4's agent finishes, the lead is asked to review ST-4 only.

### LOOP-10 One session runs the loop

Spec 23 (SESS-2) replaces the lease taken by whichever session acts first: where code-kit's session hook records the sessions, the loop runs in the lead session, chosen as the session that starts when no other leads, or by the person (Lead from here, or `code-kit sessions lead`), and a working session's band reads "the lead is in another session". The lease below still serves a session the hook never saw.

Only one session in a project prompts its lead. The first session whose loop acts takes the lead lease (`code-kit loop lead --session <id>`) and renews it every 30 seconds while it runs; a lease not renewed for 90 seconds has lapsed, and as the session ends it releases it (`code-kit loop release`). Any other session opened in the project, for any reason, never prompts its lead and offers no step: its band reads "the loop runs in another session" with **Lead from here**, which takes the lease over (`--take`); the other session then stops prompting. Once the lease has lapsed, the next session whose loop acts takes it. The hooks refuse `loop lead` and `loop release` from every agent.

- **Errors:** if the lease can't be read or written, the session doesn't run the loop.

**Acceptance**

- Given a session running the loop, when the person opens a second session in the project and works there, then the second session's lead receives no prompt from code-kit, and its band offers Lead from here.
- Given Lead from here pressed in the second session, then it runs the loop and the first stops prompting.
- Given the lead session ends, then its lease is released, and the next session to act takes it.
- Given an agent running `code-kit loop lead --take`, then the hooks refuse it.

### LOOP-11 The loop reads the lead's reply first

Before prompting the lead again, the loop reads the lead's last reply: with a side call over the lead's own conversation (which shares its prompt cache and adds nothing to it), it asks where the reply left things, as `done`, `started`, `needs-person` (with the question and up to four answers) or `blocked` (with why). The step's record keeps that outcome.

- A reply that waits on the person, a question the lead asked in the turn through `code-kit ask`, or a turn the person stopped holds the loop: nothing is prompted until the person speaks to the lead, answers, or presses **Carry on**. The band says what the lead waits on ("The lead waits on you: …"), and its question is asked in Claude Code's own dialog (DECIDE-4); an answer there, or in the Decisions tab, goes to the lead as "The person answered what you asked (…): …. Carry on with it."
- A step the lead didn't take (`blocked`) shows in the band as a note with its reason and **Ask again**, while it's still next; it isn't a decision (spec 23, WHO-4), and a different step goes on.
- A reply that can't be read leaves the loop as before (LOOP-8 still counts the prompts).

**Acceptance**

- Given the lead's reply asks the person whether prices include GST, when the turn ends, then no step is prompted, the dialog asks the question with the lead's answers, and the answer chosen goes to the lead.
- Given the dialog dismissed, then the band keeps the question, the loop prompts nothing however the project moves, and once the person has spoken and the lead's reply doesn't wait on them, the loop prompts the next step.
- Given the person stopped the lead mid-turn, then no dialog opens and nothing is prompted until they speak or press Carry on.
- Given the lead couldn't merge for a failing check, then the merge waits in the band with that reason; Ask again prompts it once more; a new step is prompted as usual.

### LOOP-12 A design story is handed over once

A design is made with the person (`/code-kit:design`), so the loop prompts the lead to design a story once a session. While every story `next` names for design has been handed over, the loop doesn't prompt it again, however the design register moves as the person approves screens, and the band says it's with the person and the lead, with **Ask the lead**. A design story not handed over yet is prompted as usual.

**Acceptance**

- Given ST-21 and ST-22 handed to the lead for design, when the person and the lead go back and forth and ST-21's design is approved, then the loop prompts no further design step for them; when ST-30 becomes ready to design, the lead is prompted for it.

### LOOP-13 A story waiting on other work is parked

When the lead's reply says a step's stories aren't due yet because they wait on work still going (a lane building a story they merge with, a rebuild, a check running), the loop parks each such story, by story rather than by step. A parked story is left out of every step, so a step that later names it with others prompts only the others. It wakes when anything it watches moves: its own state, branch commit or agent at work, or the state of a story it waits on, the stories the lead named and the unfinished stories that depend on it (a pair the lead merges together). A waited-on story's commits don't wake it, only its state: it waits for that story to finish, not for each step of it. A story step the lead's turn left exactly where it stood (its state, branch and agent unmoved) is parked the same way, whatever the reply reads as, so a reply the loop misreads can't bring the same prompt back; a design step, made with the person over many turns, is left to LOOP-12. With nothing moving for 30 minutes, it wakes anyway and the lead is asked once more. A step the lead didn't take for another reason parks its stories too, and its line stays in the band while any of them is parked, while other steps go on. Ask again and Carry on wake them at once. With every story in a step parked, the band's next row says what each waits on.

**Acceptance**

- Given the loop prompted "Review ST-158, ST-172" and the lead replied that ST-158 merges with ST-164, still being built, and ST-172's checks are re-running, when `next` then names ST-158, ST-172 and ST-173, then the lead is prompted to review ST-173 alone.
- Given both still parked and another lane committing, then nothing is prompted; ST-164 committing doesn't wake ST-158; when ST-164 is in review, then the lead is prompted to review ST-158, and ST-172 stays parked.
- Given "Review ST-160" prompted and the lead's reply read as done while ST-160 stands still and other lanes commit, then it isn't prompted again until its own branch moves.

## Quality targets

- A step is submitted within 5 seconds of the lead going idle with work to do.
- The loop never submits two prompts for the same step.
- The loop never prompts the lead while the lead's last reply waits on the person.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
