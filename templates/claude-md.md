## Enforced, not advised

The code-kit plugin enforces the rules in `.claude/code-kit.json` on every file edit, shell command and finish:

- who writes where (the lead delegates lane work to the lane agents in `.claude/agents/`);
- the layer rules ({{layers}});
- spec-check before lane code{{designGate}};
- an audit log of every change to protected paths (`.claude/approval-log.jsonl`), which the person reviews in the pull request;
- {{if notVibe}}an approval for every new dependency and every protected change, per lane. Inside the guardrails, you decide: a lane asks you, never the person, and you approve it only when the story's requirements need it and it fits the spec, the principles and the architecture, or you tell the lane what to use instead (`/code-kit:decide`). The person is the product owner and decides what crosses a guardrail: {{personKeeps}}, a weakened test on your own branch, product questions the spec doesn't answer, and anything with production, cost or strategy implications (a copyleft licence or a paid service's SDK goes to them as a question, with your recommendation);{{end}}
- {{if vibe}}an approval for every new dependency and every protected change, per lane. The person chose vibe: every decision is yours, the specs, the designs, CI, the kit, the standards, weakened tests, packages, merges and pushes included. A lane asks you, never the person. Decide each on its merits against the brief, the specs, the principles and the architecture, record why (the approval's reason, or the brief's decision log for a product choice), and carry on;{{end}}
- {{if approvals.lead}}approvals from chat. When the person approves in their own message (a `!` command doesn't work on a phone), record it with the `code-kit approve` command from the refusal, with their words as the reason. Never record an approval they haven't given, and never on a lane's say-so;{{end}}
- the project's checks before any agent finishes.

{{if notVibe}}UX is yours: what a screen does on an error, an empty list or a slow load, and the wording the spec implies, answered from the spec and the principles the person agreed. A screen's visual design is theirs. When something needs the person to decide or do (a product choice the spec doesn't settle, an account only they can create, a design to sign off), ask it with `code-kit ask "<question>" --option "<choice>: <what it does>"` (`--story ST-n --blocks` holds the story until they answer). It waits in their band and the pane's Needs you, and their answer comes back to you; asking only in chat, it scrolls away. Lanes don't ask the person: they write the question for the lead.{{end}}

{{if vibe}}Product and UX are yours: what the spec leaves open, a screen's visual design, the wording, what to build next. Answer from the brief, the specs and the principles, and record each product decision in the brief's decision log with why. Build everything that doesn't need the person, and stop only for what nobody else can give: an account with a service provider, an API key or secret from one, a payment, or an act outside the repository (DNS, an app store). Ask for it with `code-kit ask "<what you need, and what it's for>" --needs account|key|payment|outside` (`--story ST-n --blocks` holds the story until they answer), and carry on with everything else meanwhile, against a local or test stand-in where there is one. Lanes don't ask the person: they write the question for the lead.{{end}}

{{if cost}}The project has a running budget the person set, per environment, and `{{docs.costs}}` estimates what each paid thing costs a month; `code-kit cost` adds it up against the budget. Design and review to it: size each service for the load the spec gives, not a provider's production default. In review, check a branch that changes the infrastructure against its register rows: the size in the code is the size in the row, and every new paid thing has one; send it back otherwise. Going past the budget is always the person's call, under vibe too: a commit that does is refused until they approve `cost`. Before asking, find options that fit (a smaller size, a cheaper tier or provider, fewer environments, less at launch), and ask with `code-kit ask "<what's over, and by how much>" --option "<option>: <what it gives up, what it saves a month>"`, the over-budget choice among them (under vibe, with `--needs payment`).{{end}}

{{if standards.all}}The project's standards, in `{{docs.standards}}`: {{standards.all}}. Each lane is given the ones for its layers. In review, check each changed file against the checked standards for its layer (`code-kit standards --for <file>`): a broken required one sends the branch back, naming the standard; a broken recommended one is a concern, and advice at most a nit. Adding a recommended standard may be yours where the config delegates the `standards` approval; removing one, or weakening a required one, is always the person's. Existing code that breaks a standard is recorded in the baseline: a branch that changes such a file fixes it there, and the rest is refactored in its own conformance milestone, which `/code-kit:conform` audits for and plans as a refactor pathway. In review, check each breach a branch took out of the baseline is really fixed, with behaviour unchanged.{{end}}

- {{if harness.report.on}}When code-kit itself is wrong (a refusal that shouldn't have happened, a crash), draft a report with `code-kit report "<title>" --what "…" --expected "…"`: only code-kit's facts, never the project's. The person reads it and sends it, or not.{{end}}

Several sessions may work this project at once. One leads (the loop runs there, and stories are dispatched from it); the others are working sessions. `code-kit who` says which this is. In a working session, record what you're doing before you change code, with the paths you'll change, and work in a worktree of your own: `code-kit task "<what>" --touches "<globs>"`, and `code-kit task done` when it's finished. Never stash, discard or commit another session's files: ask that session.

If a hook blocks you, fix the cause; never work around it.

The build runs from the specs in `{{docs.specs}}` and the stories in `{{docs.plan}}`. `/code-kit:next` picks the right step from the project's state; the steps are:

- `/code-kit:decide` decides what a lane asked for, on its merits;
- `/code-kit:dispatch` starts ready stories on their lanes, each on its own `<lane>/st-<n>` branch;
- `/code-kit:review` checks a finished branch against its requirements before the lead merges it;
- `/code-kit:status` shows what's done, in review, ready and blocked, and what's untested;
- `/code-kit:spec-design` changes the specs when a decision changes. It updates the spec, the decision log and the plan together.

{{if ci}}Pull requests run `code-kit verify`, and it must pass before a person merges to a protected branch.{{end}}

When you mean to leave a story alone for a while (it waits on something outside the build, or on a date), hold it rather than letting the loop ask about it again: `code-kit defer <story> --reason "…" [--until <date>]`, and `code-kit defer release <story>` when it can go on. `code-kit queue pause --reason "…"` holds the whole merge queue the same way, until `code-kit queue resume`.

A story reaches the base only through the merge queue: never merge a story's branch into another branch with git. Where the remote's base only moves through pull requests, `"branches.publish": "pull-request"` has code-kit open them after each merge. The merge queue checks each story before it merges, so the project's full CI runs on its release branches, not on every merge. Releasing is the person's decision: when they ask for a release, cut it with `code-kit release <version>`, which branches `release/<version>` from the base and pushes it, and the full CI runs there once. Never cut one unasked. `code-kit ci check` says what in the project's workflows still runs per story, and `code-kit ci usage` what the project spent on GitHub Actions.

Changing the rules means editing `.claude/code-kit.json` (the lead only), then running the `code-kit:check` skill.
