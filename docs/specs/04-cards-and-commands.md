# 04. Refusal cards and commands

**Status:** draft
**Outcome:** A code-kit refusal reads as a clear card, and the common questions are one instant command away.
**Actors:** the person

## Requirements

### CARD-1 Refusals as cards

Where Claude Code draws a tool result that a code-kit hook refused, the mod draws a card instead of the raw text: a title naming what was refused, the rule and why, and what to do. When an approval would allow it, the card has an Approve… button (ACT-1). The raw text stays available, expanded on request.

**Acceptance**

- Given a lane's write refused because another lane owns the file, when it's drawn, then the card shows "Write refused: apps/office/x.ts", the owning lane and agent, and "Write a change request for the lead".
- Given a refusal the card doesn't recognise, when it's drawn, then Claude Code's own drawing is used unchanged.

### CARD-2 `/approvals`

`/approvals` lists the open requests and the approvals in force, with what each allows and when it lapses, without a model call.

**Acceptance**

- Given one open request and one approval in force, when the person types `/approvals`, then both appear, the approval with its minutes left.

### CARD-3 `/verify`

`/verify` runs `code-kit verify` on the current branch and prints its result in the transcript, without a model call.

**Acceptance**

- Given a branch with a layer violation, when the person types `/verify`, then the transcript shows the violation and "1 problem(s)".

### CARD-4 Not in a code-kit project

In a folder without `.claude/code-kit.json`, the mod draws nothing, and its commands say so.

**Acceptance**

- Given a folder without code-kit, when a session runs, then no band appears, and `/lanes` says "This project doesn't use code-kit."

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
