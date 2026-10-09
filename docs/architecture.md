# Architecture: code-kit in the session

This covers what the mod adds. The rest of code-kit (hooks, the CLI, skills, templates, adapters) is described in the README and `AGENTS.md`, and doesn't change shape.

## Components

| Component      | Where                    | What it does                                                                                                                                |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings hooks | `hooks/*.mjs` (as today) | Enforce the rules. They also record approval requests (BAND-1).                                                                             |
| The mod        | `hooks/mod/` (new)       | Draws the band, the Lanes pane and refusal cards; registers `/lanes`, `/approvals`, `/verify-branch`; turns presses into the person's acts. |
| The CLI        | `bin/code-kit.mjs`       | The mod's only source of facts and its only way to act. New: `requests`, `verify --json`, `approve --via pane`, `merge --person`.           |

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

## The harness (specs 05–13)

The harness grows the mod from showing and acting on a press into running the loop between presses. The rules stay in the settings hooks; the mod holds, asks, prompts the lead and runs background agents.

| Component    | Where                                       | What it does                                                                                                                                                                                                           |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loop engine  | `hooks/mod/loop.mjs`                        | Pure: from `status`, `next`, the agents' activity, the queue, the settings and the clock, the next loop step (dispatch, review, merge, nudge, restart, flag).                                                          |
| Hold         | `hooks/mod/hold.mjs`                        | Pure: from a refused call's result, the approvals that would allow it (new packages, protected files, kit edits), reusing the refusal cards' reading; the band's question; the timeout. The hooks stay the only judge. |
| Reviewer     | `hooks/mod/reviewer.mjs`                    | Pure: the reviewer's brief and the parsing of its graded findings.                                                                                                                                                     |
| Usage        | `hooks/mod/usage.mjs`                       | Pure: usage per agent, story and lane; outliers; the pause point.                                                                                                                                                      |
| Merge queue  | `hooks/lib/queue.mjs`, `code-kit queue`     | The queue's state in `.claude/state/merge-queue.json`, shared by the CLI and the mod.                                                                                                                                  |
| Settings     | `hooks/lib/config.mjs`, `code-kit settings` | The `harness` section, validated; `code-kit settings set <key> <value> --reason … --via pane` writes it as the person's change and logs it.                                                                            |
| Views        | `hooks/mod/views/`                          | Pure drawing: header, lanes and timeline, characters, story drill-down, queue, map, usage, settings.                                                                                                                   |
| Live regions | `hooks/mod/regions/`                        | Client modules for animated parts (characters, timelines): their own frame clock, keys and pointer.                                                                                                                    |
| Register     | `hooks/mod/register.mjs`                    | The only file that calls the mods API: events, timers, agents, prompts; it wires the pure parts together.                                                                                                              |

### How it acts

- **Through the lead:** dispatch, review and merge are prompts to the lead naming the skills, submitted when the lead is idle and the person isn't typing.
- **Through agents the lead starts:** the mod prompts the lead to start the reviewer (auto mode refuses an agent a mod starts itself), then follows it by `agentId`; its report starts a lead turn.
- **Through the CLI:** approvals (`approve --via pane`), merges (`merge --person`), sends-back, the queue and settings, all on the person's press or the loop's step.
- **Holding a call:** the mod's `tool.call` hook lets the hooks judge; when the result is a refusal a person's approval would allow, the call waits while the band asks, and on Approve the approval is written and the same call retried (spike B). Everything else passes through unchanged.

### Contracts

New JSON outputs the mod reads, changed with it: `queue`, `settings`, and the `harness` section's schema. `status`, `next`, `requests`, `stops` and `verify` stay as they are.

### Tests

The pure parts in `test/units.test.mjs`; the queue and settings end to end in `test/hooks.test.mjs`, and hold's reading of refusals against the hooks' real refusal text; the mod in `claude plugin test`, with timers on the mock clock and agents stubbed.
