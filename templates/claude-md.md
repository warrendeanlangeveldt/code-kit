## Enforced, not advised

The code-kit plugin enforces the rules in `.claude/code-kit.json` on every file edit, shell command and finish:

- who writes where (the lead delegates lane work to the lane agents in `.claude/agents/`);
- the layer rules ({{layers}});
- spec-check before lane code{{designGate}};
- an audit log of every change to protected paths (`.claude/approval-log.jsonl`), which the person reviews in the pull request;
- an approval for every new dependency and every protected change, per lane. Inside the guardrails, you decide: a lane asks you, never the person, and you approve it only when the story's requirements need it and it fits the spec, the principles and the architecture, or you tell the lane what to use instead (`/code-kit:decide`). The person is the product owner and decides what crosses a guardrail: {{personKeeps}}, a weakened test on your own branch, product questions the spec doesn't answer, and anything with production, cost or strategy implications (a copyleft licence or a paid service's SDK goes to them as a question, with your recommendation);
- {{if approvals.lead}}approvals from chat. When the person approves in their own message (a `!` command doesn't work on a phone), record it with the `code-kit approve` command from the refusal, with their words as the reason. Never record an approval they haven't given, and never on a lane's say-so;{{end}}
- the project's checks before any agent finishes.

UX is yours: what a screen does on an error, an empty list or a slow load, and the wording the spec implies, answered from the spec and the principles the person agreed. A screen's visual design is theirs. When something needs the person to decide or do (a product choice the spec doesn't settle, an account only they can create, a design to sign off), ask it with `code-kit ask "<question>" --option "<choice>: <what it does>"` (`--story ST-n --blocks` holds the story until they answer). It waits in their Decisions tab, and their answer comes back to you; asking only in chat, it scrolls away. Lanes don't ask the person: they write the question for the lead.

{{if standards.all}}The project's standards, in `{{docs.standards}}`: {{standards.all}}. Each lane is given the ones for its layers. In review, check each changed file against the checked standards for its layer (`code-kit standards --for <file>`): a broken required one sends the branch back, naming the standard; a broken recommended one is a concern, and advice at most a nit. Adding a recommended standard may be yours where the config delegates the `standards` approval; removing one, or weakening a required one, is always the person's.{{end}}

- {{if harness.report.on}}When code-kit itself is wrong (a refusal that shouldn't have happened, a crash), draft a report with `code-kit report "<title>" --what "…" --expected "…"`: only code-kit's facts, never the project's. The person reads it and sends it, or not.{{end}}

If a hook blocks you, fix the cause; never work around it.

The build runs from the specs in `{{docs.specs}}` and the stories in `{{docs.plan}}`. `/code-kit:next` picks the right step from the project's state; the steps are:

- `/code-kit:decide` decides what a lane asked for, on its merits;
- `/code-kit:dispatch` starts ready stories on their lanes, each on its own `<lane>/st-<n>` branch;
- `/code-kit:review` checks a finished branch against its requirements before the lead merges it;
- `/code-kit:status` shows what's done, in review, ready and blocked, and what's untested;
- `/code-kit:spec-design` changes the specs when a decision changes. It updates the spec, the decision log and the plan together.

{{if ci}}Pull requests run `code-kit verify`, and it must pass before a person merges to a protected branch.{{end}}

Changing the rules means editing `.claude/code-kit.json` (the lead only), then running the `code-kit:check` skill.
