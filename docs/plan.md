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
**Status:** review

One line per kind of thing waiting, with counts, actions and digit hotkeys. Absent when nothing waits, and clears itself when causes go.

### ST-6 Approve, review and merge

**Lane:** lead
**Requirements:** ACT-1, ACT-3, ACT-4
**Depends on:** ST-4, ST-5
**Status:** review

- **Approve:** a confirmation with the prefilled, editable reason.
- **Review:** a prompt to the lead to run the review skill.
- **Merge:** a confirmation, then `merge --person`, with failures shown.

### ST-7 Refusal cards and `/approvals`, `/verify`

**Lane:** lead
**Requirements:** CARD-1, CARD-2, CARD-3
**Depends on:** ST-6
**Status:** todo

code-kit refusals redrawn as cards, with Approve… where an approval would allow them, and the raw text a press away. `/approvals` and `/verify` print without a model call.
