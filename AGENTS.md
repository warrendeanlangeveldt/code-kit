# Working on code-kit

code-kit is a Claude Code plugin: hooks (`hooks/`), skills (`skills/<name>/SKILL.md`), templates (`templates/`) and a command line (`bin/code-kit.mjs`). It's plain Node ESM with no dependencies and no build step. Node 22 or later.

## Layout

- `hooks/*.mjs`: one file per hook event, wired in `hooks/hooks.json` (`guard-agent.mjs` claims a lane as its agent starts; `session.mjs` records a session as the lead or a working one as it starts, and frees its lanes as it ends). Each reads the tool call from stdin, and exits 2 with a message to refuse it.
- `hooks/lib/`: the shared rules.
  - `rules.mjs`: who may write where;
  - `config.mjs`: loading and validation;
  - `layers.mjs`: imports;
  - `dependencies.mjs`: the packages a command adds, and the files installing them changes;
  - `registry.mjs`: what the npm registry says about a package, for delegated approvals;
  - `security.mjs`: which branches the security reviewer looks at, and why (spec 17, ONB-7);
  - `regression.mjs`: weakened tests, and whether a fix's tests prove its bug (spec 18, REG-1 and REG-2);
  - `harness.mjs`: the harness settings; `queue.mjs`: the merge queue; `loop-state.mjs`: whether the loop is paused, and which session runs it; `storymap.mjs`: a story's code by layer, and each requirement's trail; `timeline.mjs`: when each story's work happened; `instructions.mjs`: code-kit's own part of CLAUDE.md and the lane agents, rendered from the templates and kept current (spec 17, ONB-8); `journal.mjs`: the build's lineage, from the request to each merge; `team.mjs`: the team in the config, who the developer is, the team provider (GitHub's built in) and the team's rules for the hooks (spec 16); `teamfacts.mjs`: the pure parts the mod shares;
  - `laneclaims.mjs`: which lane is running which story, one each across every session (spec 23, SCHED-1); `schedule.mjs`: one story for each free lane, the open slice's first (SCHED-1, SCHED-2), and the model its size gives (SCHED-3); `dispatches.mjs`: each story's model from the plan, the specs and the reviews, and the log of what each lane agent started on (SCHED-3); `decisionstore.mjs`: the decisions waiting on the person, each owned by the session that raised it (OWN-1 to OWN-4); `sessions.mjs`: the sessions working the project, which one leads, each one's task and what it wrote in the shared checkout (SESS-1 to SESS-5); `worktrees.mjs`: the project's worktrees, why each stays, and taking away the ones done with (spec 20, LEAN-6 and LEAN-8);
  - `standards.mjs`: the project's standards, merged with an organisation's, what's wrong with them, which standard a refusal's rule is, and what weakens them (spec 22); `snapshot.mjs`: what a project reports to its team provider, and the allow-list a report is checked against (spec 21);
  - `checks.mjs`, `verify.mjs`, `plan.mjs`, `trace.mjs`, `next.mjs` (what to do next, including companions to set up and designs before screens, spec 17);
  - `adapters/`: tools that share a project, such as Context Graph.
- `hooks/mod/`: the mod, for Claude Code 2.1.287 or later: `register.mjs` (its hooks and the person's acts), `view.mjs`, `panes.mjs`, `art.mjs`, `loop.mjs`, `hold.mjs`, `review.mjs`, `mission.mjs` (the band's mission rows), `codemap.mjs` (the code map) and `trail.mjs` (the trail), `decisions.mjs` (each decision that needs the person, with its lineage, and how Claude Code's question dialog asks it), `teamview.mjs` (the team's band lines and the Team pane) (what it draws and decides, as pure functions) and `register.test.ts` (run by `claude plugin test`, through `test/mod.mjs`). It reads the CLI's JSON and never enforces anything.
- `bin/code-kit.mjs`: the CLI (`check`, `who`, `unowned`, `diff`, `baseline`, `graph`, `verify`, `security`, `status`, `next`, `instructions`, `standards`, `worktrees`, `adapters`, `trace`, `approve`, `merge`, `requests`, `stops`, `sent-back`, `settings`, `lanes`, `sessions`, `task`, `decisions`, `hold`, `queue`, `story`, `timeline`, `loop`, `map`, `trail`, `journal`, `team`, `intend`).
- `skills/`: instructions for Claude, not code. They call the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`.
- `test/units.test.mjs` (pure functions), `test/hooks.test.mjs` (every hook end to end in throwaway git repositories), `test/fixture.json` (the config they use), `test/mod.mjs` (the mod's tests, skipped on older Claude Code).

## Rules

- Run `npm test` before finishing. Every behaviour change gets an end-to-end check in `test/hooks.test.mjs`.
- Format with Prettier (`npx prettier --check .`).
- The core never names another tool: tool-specific rules belong in `hooks/lib/adapters/`.
- Refusals say why, and what to do instead, in plain sentences an agent can act on.
- Keep the README's config table and CLI list in step with the code.
- Every release adds an entry at the top of `CHANGELOG.md`: the version, the date, and what changed for someone using code-kit, in plain sentences. The GitHub Release notes use the same text.
