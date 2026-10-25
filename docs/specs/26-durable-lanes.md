# 26. Durable lanes

**Status:** draft
**Outcome:** When a session, a lane agent or the machine stops mid-story, the next session knows exactly what each unfinished story was doing, what of it happened, and what to do next, from a record rather than a guess, and never repeats something that can't safely run twice.
**Actors:** lane agents (their tool calls are recorded); the lead (its own acts are recorded; it reconciles and decides what's unknown); the person (decides an unknown that crosses a guardrail); the hooks (write the log)
**Depends on:** 05-lead-loop, 09-merge-queue, 20-lean-lead, 23-the-team

Today a story's progress is recorded in three ways, and none of them says what was in flight when work stopped:

- **Git** shows what changed: commits, and the files a worktree holds uncommitted. It doesn't show whether an edit was finished, whether its tests had run, or what the agent was about to do.
- **`.claude/state`** holds the queue, the lane claims, the sessions and the loop as they are now, each rewritten as it changes, and a few logs (dispatches, reviews, requests). After a crash it says where things stand, not what was half done. The merge queue's `merging` state is the one place that records an act before it happens, which is why an interrupted merge can be recovered.
- **A lane's report** is written when it hands back (LEAN-1). An agent that dies mid-story leaves none, so the fresh agent that carries the story on (LEAN-6) starts from a dirty worktree and its commits, without the steps, test results and decisions that led there.

So `next` reads an unfinished story as `wait`, and recovery rests on the lead's reading of a worktree.

This spec records each act twice, before and after (an event sandwich): "about to do X", then "X happened, with this result". A crash between the two leaves an act with a start and no end, which names exactly what was in flight. Replaying the log rebuilds where each story stands; reconciling checks each act left open against git and the worktree, and decides what happens next. Replay never runs anything again.

## Decisions

| Date       | Decision                                                                                                                                                                    | Why                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-25 | The log is append-only JSONL, one file per story, in the main checkout's `.claude/state/events/`                                                                            | One machine's scale needs no database; appending a short line is safe from concurrent writers, and code-kit's other logs work this way. `node:sqlite` is experimental in Node 22       |
| 2026-10-25 | The hooks write the log, from PreToolUse and PostToolUse                                                                                                                    | They already see every tool call before and after it runs, so agents do nothing new and can't forget to                                                                                |
| 2026-10-25 | Replay rebuilds state; it never runs an act again                                                                                                                           | Running an agent's acts again could repeat a merge, a migration or a push                                                                                                              |
| 2026-10-25 | An act whose outcome is unknown and can't safely run twice goes to the lead, never retried                                                                                  | Guessing wrong about a merge or a migration costs more than asking                                                                                                                     |
| 2026-10-25 | The log is local and never sent to a team provider                                                                                                                          | It holds paths and commands, which can carry sensitive names; the report allow-list (spec 21) stays as it is                                                                           |
| 2026-10-25 | Writing the log never blocks a tool call                                                                                                                                    | It's a recovery record, not a guard. A failed write is said once, and the work goes on                                                                                                 |
| 2026-10-25 | Lanes don't mark acceptance criteria done themselves                                                                                                                        | The log already records each test run and commit, and lanes name requirement IDs in their test titles; one more command for agents to remember would be forgotten when it matters most |
| 2026-10-25 | Lanes commit after each step whose tests pass (DUR-7)                                                                                                                       | A crash then loses at most one step; more commits in a story's history is a small price                                                                                                |
| 2026-10-25 | A command can't safely run twice when it's a migration, a `git push`, a command the project's `shell.block` or `shell.restricted` names, or one in `execution.unrepeatable` | The project's blocked and restricted commands are already the ones it treats as consequential (deploys, `supabase db push`); the list adds seeds, sends and the like                   |

## In scope

- Recording each lane agent's and the lead's tool calls, before and after, per story.
- Recording the lead's acts on a story: dispatch, review, queue, merge, send back, release.
- Replaying a story's log into its state.
- Reconciling the acts left open, before `next` dispatches anything.
- A hand-over brief from the log for the fresh agent that carries a story on.
- How long the log is kept.

## Out of scope

- Replaying an agent's conversation: Claude Code keeps its own transcripts, and code-kit doesn't run the agent's loop.
- Recovering work that was never written to disk.
- Recovery across machines, leases with fencing, and a remote copy of the log: those wait for a team that runs one story's lanes on more than one machine (spec 23 keeps one story per lane across the project).
- A database, and importing the existing logs into the new one: the existing logs stay where they are, and the log refers to them.

## Data

| Entity         | Where                                   | Fields                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event          | `.claude/state/events/<story>.jsonl`    | `id` (unique), `at`, `story`, `act` (the tool call's id, shared by its start and end), `phase` (`start`, `end`), `actor` (`lead`, or the lane), `agent` (the agent's id), `session`, `kind`, `target`, `head` (the commit at the time), `result` (on `end`) |
| Lead's own     | `.claude/state/events/lead.jsonl`       | the same, for the lead's acts that belong to no story                                                                                                                                                                                                       |
| Story state    | (replayed from the log, never stored)   | `phase` (`dispatched`, `building`, `handed back`, `in review`, `queued`, `merging`, `merged`, `sent back`), the last commit, the tests last run and their outcome, the files changed since the last commit, the acts left open                              |
| Reconciliation | the log, as events of kind `reconciled` | the act, what was found (`done`, `not done`, `unknown`), how it was found, and what happens next                                                                                                                                                            |

**Kinds**: `edit` (Edit, Write, MultiEdit, NotebookEdit; target the file), `read` (Read, Grep, Glob), `run` (Bash; target the command, at most 300 characters), `test` (a command that's one of the project's checks or its test command), `commit`, `install` (a command that adds packages, as `dependencies.mjs` reads it), `merge`, `push`, `unrepeatable` (a command that writes a file protected with the `migration` approval, one the project's `shell.block` or `shell.restricted` names, or one listed in `execution.unrepeatable`), `agent` (a lane agent started; target its story), and the lead's acts: `dispatch`, `review`, `queue`, `merge`, `send-back`, `release`, `approve`.

**Never recorded**: file contents, edit strings, prompts, tool output beyond an exit status, and environment variables.

## Requirements

### DUR-1 Each act is recorded before and after

When a lane agent or the lead calls a tool, PreToolUse appends a `start` event to its story's log, and PostToolUse appends the `end` event with the outcome: the exit status for a command, whether the edit applied, the commit's SHA after `git commit`, pass or fail for a test. The story is the branch the call runs on (`web/st-4` → ST-4); the lead's acts on a story go to that story's log (`code-kit merge web/st-4` → ST-4), and its other acts to `lead.jsonl`. Calls on no story's branch by a lane go to `lead.jsonl` too, marked with the lane.

A tool that fails may leave no `end` event. An act left open is closed by the same agent's next call, as `ended without a result`: the agent went on, so it wasn't a crash. Only an agent's last act can be left open by one.

**Acceptance**

- Given the web agent on `web/st-4` editing `apps/office/lib/w.ts`, then ST-4's log gets a `start` and an `end` for the same act, of kind `edit`, with the file and the commit it was on.
- Given it runs `npm test` and it fails, then the `end` event is of kind `test`, with its exit status, as failed.
- Given a call with no `end`, followed by another call from the same agent, then the first is closed as ended without a result.

### DUR-2 What's recorded is short, local and never content

Each event holds paths, a command's first 300 characters, statuses and SHAs, never what a file contains or what a prompt said. The log is in the main checkout's `.claude/state`, which init already ignores in git, and no report to a team provider includes it (spec 21's allow-list stays as it is). Writing an event takes under 5 ms in the hook; a write that fails is said once in the session, and the tool call goes on.

**Acceptance**

- Given an edit, then its event holds the file's path, and neither the old nor the new text.
- Given the events folder can't be written, then the tool call runs, and the session is told once that the log isn't being kept.
- Given a report to the team provider, then it holds nothing from the log.

### DUR-3 Replay

`code-kit replay <story>` rebuilds the story's state from its log: its phase, the last commit, the tests last run and their outcome, what changed since the last commit, and any acts left open. With `--json` it prints the state for the mod and the skills. Replay only reads: it runs nothing the log records.

**Acceptance**

- Given ST-4's log with a dispatch, edits, a passing test, a commit and then an edit with no `end`, then `replay ST-4` says it's building, names the commit and the passing test, and lists the edit as left open.
- Given a story with no log (started before this spec), then replay says so, and reads its state from git and `.claude/state` as `next` does today.

### DUR-4 Reconciled before anything is dispatched

`next` reconciles before it chooses work, and so does a session's start and the loop's restart of a stalled lane (LOOP-3). For each act left open on an unfinished story whose agent is no longer running, it checks what happened, records it as a `reconciled` event, and decides what follows:

| Open act                         | How it's checked                                           | Found                | What follows                                                     |
| -------------------------------- | ---------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| `edit`, `read`, `run`, `test`    | They can safely run again                                  | `not done` or `done` | The fresh agent re-reads the files and runs the tests again      |
| `commit`                         | Whether the branch has a commit made after the act started | `done` or `not done` | The fresh agent commits what's uncommitted                       |
| `install`                        | Whether the manifest and lockfile hold the packages        | `done` or `not done` | The fresh agent installs again; installs can run twice           |
| `merge` (the lead's)             | Whether the base contains the branch's head                | `done` or `not done` | Done: the queue entry is settled. Not done: it stays at the head |
| `push`                           | Whether the remote's ref is the commit that was pushed     | `done` or `not done` | Not done: the lead pushes again                                  |
| `unrepeatable`, or anything else | Can't be checked from git                                  | `unknown`            | The lead decides; nothing runs it again on its own               |

An unknown goes to the lead as a decision (spec 15), with the act, when it ran and what was found. It goes to the person when it crosses a guardrail the lead doesn't hold (a migration where `migration` isn't delegated). Uncommitted work is never stashed, reset or removed by reconciling.

**Acceptance**

- Given ST-4's agent stopped after `git commit` started, and the branch has a commit made after it, then the act is reconciled as done, and ST-4 is dispatched to a fresh agent.
- Given `code-kit merge web/st-4` started and the base contains `web/st-4`'s head, then the merge is reconciled as done, and the queue entry is settled as merged.
- Given a migration command left open, then it's reconciled as unknown, and the lead is asked before anything else on that story.
- Given a worktree with two uncommitted files, then reconciling leaves both.

### DUR-5 The hand-over brief

When a story is carried on by a fresh agent (LEAN-5, LEAN-6, or after reconciling), its brief includes what the log says, whether or not the stopped agent wrote its report: the last commit, the tests last run and whether they passed, the files changed since the last commit, what was reconciled and how, and the last ten acts. Where there's a report, the brief has both, and says which is newer.

**Acceptance**

- Given ST-4's agent stopped mid-story with no report, then the fresh agent's brief names its last commit, the failing test it last ran, the three files changed since, and the open edit as reconciled.
- Given the report and the log, then the brief has both, and says the log's last act came after the report.

### DUR-6 Kept while it's useful

A story's log is kept until the story merges, and for 30 days after. `worktrees prune` removes logs older than that, along with the worktrees it removes. A log over 5 MB keeps its first `agent` event and everything from its last 2,000 events, and says what it dropped.

**Acceptance**

- Given ST-2 merged 31 days ago, then `worktrees prune` removes its log.
- Given ST-9's log reaches 5 MB, then it's trimmed to its first agent event and its last 2,000 events, with a line saying how many were dropped.

### DUR-7 A lane commits each step that passes

A lane agent commits after each step whose tests pass, not once at the end of its story, so a crash loses at most the step it was on. The lane agent template (`templates/`) says so, and `instructions` brings existing agent files up to date. The commits stay in the story's history; the merge keeps them.

**Acceptance**

- Given the lane agent template, then it tells the agent to commit after each step whose tests pass.
- Given ST-4 built in three steps, then its branch has at least three commits, and an agent that stops during the third loses only the third's uncommitted work.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
