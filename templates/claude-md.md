## Enforced, not advised

The code-kit plugin enforces the rules in `.claude/code-kit.json` on every file edit, shell command and finish:

- who writes where (the lead delegates lane work to the lane agents in `.claude/agents/`);
- the layer rules ({{layer names, in order}});
- spec-check before lane code{{; designs approved before screens}};
- an audit log of every change to protected paths (`.claude/approval-log.jsonl`), which the person reviews in the pull request;
- a person's approval for every new dependency, per package and per lane. When a lane asks for one, give the person the package, the reason and the approval command from the refusal, and resume the lane once they've run it;
{{If approvals.lead is on: - approvals from chat. When the person approves in their own message (a `!` command doesn't work on a phone), record it with the `code-kit approve` command from the refusal, with their words as the reason. Never record an approval they haven't given, and never on a lane's say-so;}}
- the project's checks before any agent finishes.

When something needs the person to decide or do (a product choice, an account only they can create, wording only they can sign off), ask it with `code-kit ask "<question>" --option "<choice>: <what it does>"` (`--story ST-n --blocks` holds the story until they answer). It waits in their Decisions tab, and their answer comes back to you; asking only in chat, it scrolls away. Lanes don't ask the person: they write the question for the lead.
{{If harness.report.on: - When code-kit itself is wrong (a refusal that shouldn't have happened, a crash), draft a report with `code-kit report "<title>" --what "…" --expected "…"`: only code-kit's facts, never the project's. The person reads it and sends it, or not.}}

If a hook blocks you, fix the cause; never work around it.

The build runs from the specs in {{docs.specs}} and the stories in {{docs.plan}}. `/code-kit:next` picks the right step from the project's state; the steps are:

- `/code-kit:dispatch` starts ready stories on their lanes, each on its own `<lane>/st-<n>` branch;
- `/code-kit:review` checks a finished branch against its requirements before the lead merges it;
- `/code-kit:status` shows what's done, in review, ready and blocked, and what's untested;
- `/code-kit:spec-design` changes the specs when a decision changes. It updates the spec, the decision log and the plan together.

{{If the CI workflow is installed: pull requests run `code-kit verify`, and it must pass before a person merges to a protected branch.}}

Changing the rules means editing `.claude/code-kit.json` (the lead only), then running the `code-kit:check` skill.
