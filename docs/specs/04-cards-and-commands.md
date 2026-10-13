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

### CARD-7 A request waits until it's answered

An approval request waits until an approval answers it, its file is committed by someone who could (a package request, until the package is in a committed `package.json`, whoever installed it), or it's dropped, and at most a week; not 60 minutes, which let one vanish while the lead was still asking for it. The same refusal while a request is open asks once. `code-kit requests` numbers the open ones, newest first; `code-kit requests drop <n>[,<n>…]|all [--reason …]` drops them: the lead's, when it went another way, or the person's **Not needed** on the request's card (`--via pane`, which the hooks refuse from every agent). A lane can't drop one. Refused again after a drop, it asks again.

**Acceptance**

- Given a lane's request from two hours ago that nobody answered, then it's still open.
- Given a lane running `code-kit requests drop 1`, or the lead running it with `--via pane`, then it's refused; the lead's own drop closes it, and the same refusal later opens a new one.

### CARD-8 One card per decision

The band keeps one line per kind of thing waiting ("2 approvals waiting", "3 questions from the lead"), but the Decisions tab lists each decision as its own card: each approval with its lane and files, each held call, each of the lead's questions and the brief's, each call Claude Code refused, each report. Each card's options answer that one.

**Acceptance**

- Given two approvals waiting, for the web and api lanes, then the Decisions tab has two cards, and Not needed on the second drops only the api lane's request.

### CARD-9 Decisions as short cards

The Decisions tab opens on how many decisions need the person and of which kinds ("10 approvals · 2 questions · 12 your brief"), then each as a short card: its kind, a one-line headline ("Approve fastify, jose, drizzle-orm and 4 more") and one line on who or what it's for, with a command cut at its first pipe or chain and never over a line. Five cards show at a time around the selected one, with how many more above and below; **j** and **k** move. The selected one follows in full, with its lineage and options.

**Acceptance**

- Given eight approvals and a question, then the tab says "8 approvals · 1 question", shows five cards with "4 more" below, each approval's command on one line without what follows its pipe, and j moves the selection down the list.

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
