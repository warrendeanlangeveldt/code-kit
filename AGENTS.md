# Working on code-kit

code-kit is a Claude Code plugin: hooks (`hooks/`), skills (`skills/<name>/SKILL.md`), templates (`templates/`) and a command line (`bin/code-kit.mjs`). It's plain Node ESM with no dependencies and no build step. Node 22 or later.

## Layout

- `hooks/*.mjs`: one file per hook event, wired in `hooks/hooks.json`. Each reads the tool call from stdin, and exits 2 with a message to refuse it.
- `hooks/lib/`: the shared rules.
  - `rules.mjs`: who may write where;
  - `config.mjs`: loading and validation;
  - `layers.mjs`: imports;
  - `dependencies.mjs`: the packages a command adds, and the files installing them changes;
  - `registry.mjs`: what the npm registry says about a package, for delegated approvals;
  - `checks.mjs`, `verify.mjs`, `plan.mjs`, `trace.mjs`, `next.mjs`;
  - `adapters/`: tools that share a project, such as Context Graph.
- `bin/code-kit.mjs`: the CLI (`check`, `who`, `unowned`, `diff`, `baseline`, `graph`, `verify`, `status`, `next`, `adapters`, `trace`).
- `skills/`: instructions for Claude, not code. They call the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`.
- `test/units.test.mjs` (pure functions), `test/hooks.test.mjs` (every hook end to end in throwaway git repositories), `test/fixture.json` (the config they use).

## Rules

- Run `npm test` before finishing. Every behaviour change gets an end-to-end check in `test/hooks.test.mjs`.
- Format with Prettier (`npx prettier --check .`).
- The core never names another tool: tool-specific rules belong in `hooks/lib/adapters/`.
- Refusals say why, and what to do instead, in plain sentences an agent can act on.
- Keep the README's config table and CLI list in step with the code.
