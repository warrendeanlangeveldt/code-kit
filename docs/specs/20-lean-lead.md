# 20. A lean lead

**Status:** specified
**Outcome:** The lead's context holds what it needs to run the build, not the lanes' working. A lane's detail waits in a file the lead reads when it needs it, lanes speak to the lead once per story, and when a milestone finishes the lead's context is compacted before the next one.
**Actors:** lane agents (report); the lead (reads reports when it reviews or decides); the person (chooses whether to compact); the mod (offers or runs the compaction); the stop hook (requires the report)
**Depends on:** 05-lead-loop, 12-settings, 19-lead-at-the-helm

Found measuring a lead session on a project of 138 stories: about 780k tokens since its last compaction. Lanes' final reports and messages were about 236k of it, 103 of them at a median of 4,500 characters and up to 16,000, because the lane template asked for "the commands you ran with their output", and one lane pasted a whole migration it was waiting to write. Context Graph's "became active" note was injected 118 times, because its hooks undid each other's session state (fixed in Context Graph). Nothing ever trimmed what a finished milestone left behind.

## In scope

- A lane's full report in a file, and a short hand-back (LEAN-1).
- Lanes speak to the lead once per story (LEAN-2).
- Compacting the lead's context when a milestone finishes (LEAN-3), and whenever it's past a threshold (LEAN-4).
- A lane agent's context limit, one agent per story, and worktrees released (LEAN-5, LEAN-6).
- Lanes reading what they need, and reviewers on Sonnet (LEAN-7).

## Out of scope

- Claude Code's own task notifications.
- Trimming the lead's own reads and commands.

## Requirements

### LEAN-1 The report in a file, a short hand-back

Before a lane on a story's branch finishes, it writes its full report to `.claude/state/reports/<branch with / as _>.md` in its worktree: what it did and why, the spec section, the commands it ran with their output, what's left, and anything it needs decided, with the choices and any text it would otherwise paste. Its hand-back to the lead is at most ten lines: the story and branch, done or blocked, any decision the lead must make, and the report's path. The stop hook refuses to let a lane on a story branch finish without the report (in its worktree, or by its path in the main checkout), and refuses a hand-back of more than ten lines or 1,200 characters, three times at most, as for every block it repeats. The review, dispatch and decide skills read the report when they need its detail.

**Acceptance**

- Given the platform lane on `platform/st-5` with its work committed and no report, when it finishes, then it's refused, and told where to write the report and what the hand-back holds; with the report written, it finishes.
- Given a hand-back of 15 lines, then it's refused with its length and what to keep; one of three lines finishes.

### LEAN-2 One word per story

A lane doesn't message the lead while it works. It hands back once, when it finishes or when it's blocked on something only the lead or the person can settle.

**Acceptance**

- Given the lane template, then it tells lanes not to message the lead while they work, and to finish when blocked.

### LEAN-3 Compacting when a milestone finishes

When every story of a milestone is done during the session, at the end of the lead's next turn, before the loop's next step, the lead's context is compacted, as `harness.compact.milestone` says: `ask` (the default) asks in Claude Code's dialog with Compact now and Not now; `auto` compacts at once; `off` leaves it. The summary keeps the milestone in a line, every story in flight with its lane, branch and state, the decisions and questions waiting on the person, and what the person asked for that still applies, and drops the finished stories' details, reports and output. A context under 25% full isn't compacted, a milestone done before the session began isn't offered, and none is offered twice. The loop's step follows.

**Acceptance**

- Given M0's last story merging and the lead's context 62% full, when the lead's turn ends, then the person is asked whether to compact; Compact now compacts with the milestone's instructions, and the loop's next step follows.
- Given the context 10% full, then nothing is asked.

### LEAN-4 Compacting at a threshold

Milestones take days, and a lead's context reached 968k tokens before Claude Code compacted it on its own. So whenever the lead's context is past `harness.compact.at` (40% of its window by default; 0 for never) at the end of its turn, it's compacted at once, between turns and before the loop's next step, keeping what's in flight and what waits on the person. Nothing is asked: the milestone compaction (LEAN-3) asks, this one doesn't.

**Acceptance**

- Given the lead's context 35% full, then nothing is compacted; at 46%, it's compacted at the turn's end, without a question, with instructions keeping what's in flight.

### LEAN-5 A lane agent's context limit

When a lane agent's request carries more than `harness.agents.lanes.contextLimit` tokens of context (250,000 by default; 0 for no limit), it's told once to finish the step it's on, commit, write its report and hand back. Once it hands back, the loop prompts the lead to release its worktree and dispatch the story again to a fresh agent, which reads the report first. A long-lived agent rereads its whole context on every request, which is most of what a build costs.

**Acceptance**

- Given the web lane's agent at 270k tokens, then it's told to wrap up, once; when it hands back, the lead is prompted to release `web/st-4` and dispatch ST-4 again, reading `.claude/state/reports/web_st-4.md` first.

### LEAN-6 One agent per story, and worktrees released

A lane agent builds one story. A send-back or a story carried on goes to a fresh agent, never to the one that built it. `code-kit worktrees` lists the project's worktrees with their story, whether each is merged and whether it holds anything uncommitted; `worktrees release <branch>` removes one so a fresh agent can check the branch out again, keeping its commits and moving its report to the main checkout; `worktrees prune` releases every merged and clean one. Neither removes a worktree with uncommitted work, and only the lead runs them. `next` names merged and clean worktrees under attention. The lead reads the loop's view of its reply (LOOP-11) with Sonnet from the reply itself, not a fork of its whole conversation on its own model.

**Acceptance**

- Given `web/st-2` with uncommitted work, then `worktrees release web/st-2` removes nothing; committed, it removes the worktree, keeps the branch and moves its report to the main checkout.
- Given `web/st-1` merged and clean, then `worktrees prune` removes it, keeping its report.
- Given the lead's reply at a turn's end, then the loop reads it with Sonnet from the reply, not a fork.

### LEAN-7 Lanes read what they need, and reviewers run on Sonnet

A lane agent reads every file it changes in full, and of what it imports and what calls it, what the change needs; a context tool's fresh card stands for reading a file whole. It runs the narrowest tests for each step with failures only in the output, and the full suite once before committing. The lead's review starts from the lane's report, the reviewer's findings and the diff's summary, and opens the diff a file at a time. `harness.agents.reviewer.model` defaults to Sonnet and covers the security reviewer too, unless its agent file names a model.

**Acceptance**

- Given no reviewer model set, then the security reviewer starts on Sonnet; given its agent file names Opus, it starts on Opus.

## Quality targets

- A lane's hand-back is at most ten lines.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
