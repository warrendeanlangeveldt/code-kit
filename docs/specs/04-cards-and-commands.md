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

`/approvals` lists the open requests and the approvals in force, with what each allows and when it lapses, without a model call. Requests are counted as the decisions they are: one per approval and lane, naming every file it covers ("contract for the platform lane: a.ts, b.ts (2 files)"), since one approval covers them all. The band and the decision card count and show them the same way.

**Acceptance**

- Given one open request and one approval in force, when the person types `/approvals`, then both appear, the approval with its minutes left.
- Given three requests, two for the platform lane's contract approval and one for the domain lane's, then the band says "2 approvals waiting" and the card names both platform files.

### CARD-5 Only requests that still wait

A request is the person's to answer only while it still waits. A read-only agent (a reviewer) is never approved to write, so what it changes (a code generator it ran, say) is refused with how to put it back, and asks nobody. A request is answered once its approval is given after it, even when that approval has since lapsed or was used up by the commit it allowed, and once the file it named has been committed since by someone who could (the lead, say).

**Acceptance**

- Given the reviewer writing a protected file, then it's refused, told to `git restore` it, and no request is open.
- Given a lane's request, then an approval given for it, then that approval gone, then the request isn't open again.
- Given a lane's request for a file the lead then commits, then the request isn't open.

### CARD-6 The approvals given

`/approvals` (and `code-kit requests`) ends with every approval given, newest first: when, what for, which lane, who gave it (you, in the pane; you, in chat; or the lead within your delegated rules), its reason, and the files and branches it covered, whether or not those branches have merged. It reads the approvals given through code-kit (kept in `.claude/state/approvals-given.jsonl`), those on disk (a person's own `!` echo included) and the audit log in every worktree.

**Acceptance**

- Given approvals given in the pane and in chat, then `requests --json` lists each in its history, newest first, with who gave it.

### CARD-3 `/verify-branch`

`/verify-branch` runs `code-kit verify` on the current branch and prints its result in the transcript, without a model call. It isn't `/verify`: that name is Claude Code's own, and a mod can't register a command whose name is taken.

**Acceptance**

- Given a branch with a layer violation, when the person types `/verify-branch`, then the transcript shows the violation and "1 problem(s)".

### CARD-4 Not in a code-kit project

In a folder without `.claude/code-kit.json`, the mod draws nothing, and its commands say so.

**Acceptance**

- Given a folder without code-kit, when a session runs, then no band appears, and `/lanes` says "This project doesn't use code-kit."

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
