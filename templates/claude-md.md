## Enforced, not advised

The code-kit plugin enforces the rules in `.claude/code-kit.json` on every tool call:

- who writes where (the lead delegates lane work to the lane agents in `.claude/agents/`);
- the layer rules ({{layer names, in order}});
- spec-check before lane code{{; designs approved before screens}};
- an audit log of every change to protected paths (`.claude/approval-log.jsonl`), which the person reviews in the pull request;
- a person's approval for every new dependency, per package and per lane. When a lane asks for one, give the person the package, the reason and the approval command from the refusal, and resume the lane once they've run it;
- the project's checks before any agent finishes.

If a hook blocks you, fix the cause; never work around it.

The build runs from the specs in {{docs.specs}} and the stories in {{docs.plan}}. `/code-kit:next` picks the right step from the project's state; the steps are:

- `/code-kit:dispatch` starts ready stories on their lanes, each on its own `<lane>/st-<n>` branch;
- `/code-kit:review` checks a finished branch against its requirements before the lead merges it;
- `/code-kit:status` shows what's done, in review, ready and blocked, and what's untested;
- `/code-kit:spec-design` changes the specs when a decision changes. It updates the spec, the decision log and the plan together.

{{If the CI workflow is installed: pull requests run `code-kit verify`, and it must pass before a person merges to a protected branch.}}

Changing the rules means editing `.claude/code-kit.json` (the lead only), then running the `code-kit:check` skill.
