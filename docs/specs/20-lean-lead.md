# 20. A lean lead

**Status:** specified
**Outcome:** The lead's context holds what it needs to run the build, not the lanes' working. A lane's detail waits in a file the lead reads when it needs it, lanes speak to the lead once per story, and when a milestone finishes the lead's context is compacted before the next one.
**Actors:** lane agents (report); the lead (reads reports when it reviews or decides); the person (chooses whether to compact); the mod (offers or runs the compaction); the stop hook (requires the report)
**Depends on:** 05-lead-loop, 12-settings, 19-lead-at-the-helm

Found measuring a lead session on a project of 138 stories: about 780k tokens since its last compaction. Lanes' final reports and messages were about 236k of it, 103 of them at a median of 4,500 characters and up to 16,000, because the lane template asked for "the commands you ran with their output", and one lane pasted a whole migration it was waiting to write. Context Graph's "became active" note was injected 118 times, because its hooks undid each other's session state (fixed in Context Graph). Nothing ever trimmed what a finished milestone left behind.

## In scope

- A lane's full report in a file, and a short hand-back (LEAN-1).
- Lanes speak to the lead once per story (LEAN-2).
- Compacting the lead's context when a milestone finishes (LEAN-3).

## Out of scope

- Claude Code's own task notifications.
- Trimming the lead's own reads and commands.

## Requirements

### LEAN-1 The report in a file, a short hand-back

Before a lane on a story's branch finishes, it writes its full report to `.claude/state/reports/<branch with / as _>.md` in its worktree: what it did and why, the spec section, the commands it ran with their output, what's left, and anything it needs decided, with the choices and any text it would otherwise paste. Its hand-back to the lead is at most ten lines: the story and branch, done or blocked, any decision the lead must make, and the report's path. The stop hook refuses to let a lane on a story branch finish without the report. The review, dispatch and decide skills read the report when they need its detail.

**Acceptance**

- Given the platform lane on `platform/st-5` with its work committed and no report, when it finishes, then it's refused, and told where to write the report and what the hand-back holds; with the report written, it finishes.

### LEAN-2 One word per story

A lane doesn't message the lead while it works. It hands back once, when it finishes or when it's blocked on something only the lead or the person can settle.

**Acceptance**

- Given the lane template, then it tells lanes not to message the lead while they work, and to finish when blocked.

### LEAN-3 Compacting when a milestone finishes

When every story of a milestone is done during the session, at the end of the lead's next turn, before the loop's next step, the lead's context is compacted, as `harness.compact.milestone` says: `ask` (the default) asks in Claude Code's dialog with Compact now and Not now; `auto` compacts at once; `off` leaves it. The summary keeps the milestone in a line, every story in flight with its lane, branch and state, the decisions and questions waiting on the person, and what the person asked for that still applies, and drops the finished stories' details, reports and output. A context under 25% full isn't compacted, a milestone done before the session began isn't offered, and none is offered twice. The loop's step follows.

**Acceptance**

- Given M0's last story merging and the lead's context 62% full, when the lead's turn ends, then the person is asked whether to compact; Compact now compacts with the milestone's instructions, and the loop's next step follows.
- Given the context 10% full, then nothing is asked.

## Quality targets

- A lane's hand-back is at most ten lines.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
