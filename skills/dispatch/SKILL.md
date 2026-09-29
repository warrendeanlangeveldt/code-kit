---
name: dispatch
description: Hand stories from the plan to their lane agents, as many at once as can safely run in parallel. Picks the ready stories, checks each is buildable, briefs each lane agent with its story, requirements and acceptance criteria, and starts it on its own branch and worktree. Use when the lead is ready to start building, asks what to work on next, or runs /code-kit:dispatch [story IDs, a milestone, or "next"].
---

# Dispatch stories to lanes

Only the lead dispatches. Lane agents build; the lead writes contracts, reviews and merges.

The argument names what to dispatch: story IDs (`ST-4 ST-7`), a milestone, or `next` (everything that's ready). With no argument, show what's ready and ask.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`, run from the project root.

## 1. See what's ready

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" status
```

A story is **ready** when its dependencies are done and nobody has started it. `status` also lists gaps between the specs and the plan; a story with a gap (an unknown lane, a requirement no spec defines) isn't dispatched until the lead fixes the plan.

If the project has no `docs.plan`, or the plan has no stories in the `### ST-n` form (`${CLAUDE_PLUGIN_ROOT}/templates/plan.md`), stop and suggest the spec-design skill.

## 2. Check each story before it goes

For every story you're about to dispatch, read in full:

- the story in the plan;
- every requirement it cites, in its spec, with the spec's open questions;
- the lane's agent file in `.claude/agents/`.

Then check:

- **No open question blocks it.** If a spec's open questions touch a cited requirement, don't dispatch the story; list the question for the person.
- **The contracts exist.** If the story needs an API schema, event or database contract that isn't written yet, that's the lead's work first. Write it (the lead owns contracts), commit it on the lead's branch, then dispatch. A lane never invents a contract.
- **The lane is right.** Run `who` on the paths the story will touch. If they belong to two lanes, split the story or sequence it; don't hand one lane another's files.
- **Nothing overlaps.** At most one story per lane at a time, unless two stories touch disjoint folders. Two lanes may run in parallel; that's the point of lanes.

Commit everything the lanes need first. Each lane branches from the lead's branch as committed, so uncommitted work isn't there.

## 3. Brief and start each lane

Start each story with the Agent tool: `subagent_type` is the lane's agent, `isolation: "worktree"`, and run them in the background. Start every story in the batch in the same message so they run in parallel.

The brief is the agent's whole context. Write it so the agent needs nothing else:

```text
Story ST-<n>: <title>   (lane <lane>)
Branch: <lane>/st-<n>. Create it first, from the lead's branch: git switch -c <lane>/st-<n> <lead's branch>

Requirements (read each one in full, with its acceptance criteria):
- <spec path>#<ID> <name>
- …

What to build: <the story's description, and anything the lead decided that the spec doesn't say>
Contracts to use: <paths of the schemas, events or tables this story relies on>
Out of scope: <what neighbouring stories or other lanes will do>

Steps:
1. Run the spec-check skill against these requirements and save the report (the path guard requires it).
   If it recommends "blocked on questions", stop and report the questions.
2. Build it end to end in your lane's paths. No mocks, stubs, placeholder screens or "coming soon".
3. Write tests that prove each acceptance criterion. Name the requirement ID in each test's title,
   e.g. test('BOOK-4 a customer can cancel up to 24 hours before'), so `code-kit status` can trace it.
4. Run <the lane's proving command> until it passes.
5. Commit on your branch. The message names ST-<n>, what changed and the proof.
6. Finish with: what you built, per requirement; the commands you ran and their output; open questions.
```

**A person running a lane** instead of an agent gets its own worktree, marked with the lane:

```bash
git worktree add ../<repo>-<lane>-st-<n> -b <lane>/st-<n> <lead's branch>
echo <lane> > ../<repo>-<lane>-st-<n>/.lane
```

Give them the same brief. Claude Code opened in that worktree then acts as the lane.

## 4. Keep track

- Set each dispatched story's `**Status:**` in the plan to `in progress`, and commit it on the lead's branch.
- Tell the person, in a few lines: what was dispatched, to which lane and branch, what's still blocked and on what, and what's ready next.
- As each agent finishes, read its report. If it came back blocked on questions, bring the questions to the person. If it came back done, run the review skill on its branch.
