# Architecture: code-kit in the session

This covers what the mod adds. The rest of code-kit (hooks, the CLI, skills, templates, adapters) is described in the README and `AGENTS.md`, and doesn't change shape.

## Components

| Component      | Where                    | What it does                                                                                                                         |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Settings hooks | `hooks/*.mjs` (as today) | Enforce the rules. They also record approval requests (BAND-1).                                                                      |
| The mod        | `hooks/mod/` (new)       | Draws the band, the Lanes pane and refusal cards; registers `/lanes`, `/approvals`, `/verify`; turns presses into the person's acts. |
| The CLI        | `bin/code-kit.mjs`       | The mod's only source of facts and its only way to act. New: `requests`, `verify --json`, `approve --via pane`, `merge --person`.    |

`hooks/hooks.json` keeps its settings hooks under `hooks` and adds `"modules": ["./mod/register.mjs"]`. Claude Code older than 2.1.287 doesn't load the module and runs the hooks as before.

## How the mod reaches code-kit

A hooks module may import only files inside the plugin and `claude-code`, and reaches files and processes through the mods API. So the mod never imports `hooks/lib/` (which uses `node:` modules). It runs the CLI with `$.process.run('node', [<plugin root>/bin/code-kit.mjs, …, '--json'])` in the session's project and reads its JSON. Everything it shows comes from:

- `code-kit status --json` and `next --json`: lanes, stories, branches, states, what's ready;
- `code-kit requests --json`: open approval requests and approvals in force;
- `code-kit verify --json`: a branch's problems, grouped.

It acts only by running:

- `code-kit approve <names> [--lane x] --reason "…" --via pane`;
- `code-kit merge <branch> --person`.

Both are reached only from `ui.press` handlers on the mod's own buttons and confirmations, so only the person triggers them. An agent typing either command in a shell is judged by the hooks like any other approval or merge, and refused.

## Contracts

- **`.claude/state/requests.jsonl`:** one JSON object per refusal a person's approval would allow, written by the hooks in the main checkout: `{ at, actor, lane?, names, what, why }`.
- **The CLI's JSON outputs:** `status`, `next`, `requests` and `verify` with `--json`. Changing their shape means changing the mod with them.

## Tests

- **The CLI and the hooks:** as today, in `test/hooks.test.mjs`.
- **The mod:** `.test.ts` files beside it, run with `claude plugin test`. That needs Claude Code 2.1.287 or later, so `npm test` runs them only when that's available, and says when it skips them.
