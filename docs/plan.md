# Plan: code-kit in the session

`code-kit status` reads this file. Keep each story's heading and its four `**…:**` lines in this form.

## Lanes

| Lane | Agent              | Owns                 | Proves its work with                 |
| ---- | ------------------ | -------------------- | ------------------------------------ |
| lead | (the main session) | the whole repository | `npm test && npx prettier --check .` |

## Milestone 1: the facts and acts the mod needs

### ST-1 The hooks record approval requests, and `code-kit requests` lists them

**Lane:** lead
**Requirements:** BAND-1, CARD-2
**Depends on:** none
**Status:** done

Every refusal a person's approval would allow writes one request to `.claude/state/requests.jsonl` in the main checkout, without duplicates. `code-kit requests [--json]` lists open requests and approvals in force, with minutes left.

### ST-2 `approve --via pane`, `merge --person` and `verify --json`

**Lane:** lead
**Requirements:** ACT-2, CARD-3
**Depends on:** none
**Status:** done

- **`approve --via pane`:** marks approvals "(approved in the code-kit pane)".
- **`merge <branch> --person`:** verifies, then merges, as in `--delegated`, but without delegation. The hooks refuse it for every agent.
- **`verify --json`:** prints the grouped problems.

## Milestone 2: the mod

Needs Claude Code 2.1.287 or later on the machine that builds it.

### ST-3 The mod's skeleton

**Lane:** lead
**Requirements:** PANE-1, PANE-5, CARD-4
**Depends on:** ST-1, ST-2
**Status:** done

`hooks.json` gains the module. The mod registers `/lanes`, opens and closes the pane, draws nothing outside a code-kit project, and reports an unreadable config or plan. It passes `claude plugin validate`, and `claude plugin test` runs its tests.

### ST-4 The Lanes pane

**Lane:** lead
**Requirements:** PANE-2, PANE-3, PANE-4
**Depends on:** ST-3
**Status:** done

A row per lane with its agent, story, branch and state, the active mark from subagents starting and finishing, and what's ready. Refreshes on change, at most every 10 seconds otherwise.

### ST-5 The waiting band

**Lane:** lead
**Requirements:** BAND-2, BAND-3, BAND-4
**Depends on:** ST-3
**Status:** done

One line per kind of thing waiting, with counts, actions and digit hotkeys. Absent when nothing waits, and clears itself when causes go.

### ST-6 Approve, review and merge

**Lane:** lead
**Requirements:** ACT-1, ACT-3, ACT-4
**Depends on:** ST-4, ST-5
**Status:** done

- **Approve:** a confirmation with the prefilled, editable reason.
- **Review:** a prompt to the lead to run the review skill.
- **Merge:** a confirmation, then `merge --person`, with failures shown.

### ST-7 Refusal cards and `/approvals`, `/verify-branch`

**Lane:** lead
**Requirements:** CARD-1, CARD-2, CARD-3
**Depends on:** ST-6
**Status:** done

code-kit refusals redrawn as cards, with Approve… where an approval would allow them, and the raw text a press away. `/approvals` and `/verify-branch` print without a model call.

## Milestone 3: spikes for the harness

The riskiest assumptions in the brief, checked before building on them.

### ST-8 Spike: prompting the lead when idle

**Lane:** lead
**Requirements:** none
**Depends on:** none
**Status:** done

Submit a prompt on `turn.complete` and while a turn runs; record what happens (assumption A).

### ST-9 Spike: holding a call and letting it through

**Lane:** lead
**Requirements:** none
**Depends on:** none
**Status:** done

Against the real hooks: hold a refused install, write the approval, continue the same call; else the re-run fallback (assumption B).

### ST-10 Spike: a background agent, its usage and activity

**Lane:** lead
**Requirements:** none
**Depends on:** none
**Status:** done

Spawn a cheap agent beside a lead turn; read its usage per request and its last tool call (assumptions C and D).

### ST-11 Spike: the probe in VS Code’s terminal

**Lane:** lead
**Requirements:** none
**Depends on:** none
**Status:** todo

Run the probe pane in the person’s VS Code terminal; note what draws (assumption E).

## Milestone 4: code-kit's harness

### ST-12 Reading refusals for hold

**Lane:** lead
**Requirements:** HOLD-1
**Depends on:** ST-9
**Status:** done

Recognise, from a refused call's result, the refusals a person's approval would allow (new packages, protected files, kit edits) and the approvals that would; the spike showed the same call can then be retried (`docs/spikes/harness.md`).

### ST-13 Harness settings

**Lane:** lead
**Requirements:** SET-1, SET-2, SET-3
**Depends on:** none
**Status:** done

The `harness` section, validated; `code-kit settings` (read and `set … --via pane`); the Settings view.

### ST-14 Hold and ask

**Lane:** lead
**Requirements:** HOLD-2, HOLD-3, HOLD-4, HOLD-5, HOLD-6
**Depends on:** ST-12, ST-13
**Status:** done

The mod holds what a person’s approval would allow (read from the refusal), asks in the band, and lets it through or refuses.

### ST-15 The loop engine

**Lane:** lead
**Requirements:** LOOP-1, LOOP-2, LOOP-3, LOOP-5, LOOP-6, LOOP-7
**Depends on:** ST-8, ST-10, ST-13
**Status:** done

Prompting the lead when idle, stalls, autonomy, pause and done.

### ST-16 The reviewer agent

**Lane:** lead
**Requirements:** REVW-1, REVW-2, REVW-3, REVW-4, LOOP-4
**Depends on:** ST-10, ST-15
**Status:** done

Started by prompting the lead (auto mode refuses a mod's own spawn) per finished branch; graded findings into the lead’s review.

### ST-17 The merge queue

**Lane:** lead
**Requirements:** MQ-1, MQ-2, MQ-3, MQ-4
**Depends on:** ST-15
**Status:** done

`code-kit queue` and its state; merges in order; conflicts sent back.

### ST-18 Usage per lane

**Lane:** lead
**Requirements:** USE-1, USE-2, USE-3, USE-4
**Depends on:** ST-10
**Status:** done

Usage per agent, story and lane; outliers; background agents paused near the plan’s limit.

### ST-19 Panes v2: header, keyboard, needs-you and tabs

**Lane:** lead
**Requirements:** VIEW-1, VIEW-4, VIEW-5, VIEW-6, VIEW-8
**Depends on:** ST-11
**Status:** done

The pane’s new frame and keyboard model.

### ST-20 Panes v2: timelines and characters

**Lane:** lead
**Requirements:** VIEW-2, VIEW-3
**Depends on:** ST-19
**Status:** todo

Timelines per lane and the lane agents’ characters, animated in place.

### ST-21 Panes v2: the story drill-down

**Lane:** lead
**Requirements:** VIEW-7, REVW-5
**Depends on:** ST-16, ST-19
**Status:** done

Spec-check, diff, verify, findings, usage and steps for a story.

### ST-22 The traceability map

**Lane:** lead
**Requirements:** TRACE-1, TRACE-2, TRACE-3, TRACE-4
**Depends on:** ST-19
**Status:** done

Requirements by stories and tests, live, with drill-down.

## Milestone 6: the combined lane view

Milestone 5 is Context Graph's harness, planned in its own `docs/plan.md`.

### ST-23 The combined lane view

**Lane:** lead
**Requirements:** JOIN-1, JOIN-2, JOIN-3, JOIN-4
**Depends on:** ST-21
**Status:** todo

With Context Graph installed: understanding, cards owed and rules per lane.
