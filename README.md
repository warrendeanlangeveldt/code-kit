# code-kit

A Claude Code plugin that turns a project's engineering rules into hard guarantees. You write the rules once, per project, in `.claude/code-kit.json`. The plugin's hooks enforce them on every tool call, for the main session and every subagent. A rule Claude would otherwise only be _asked_ to follow becomes one it _can't_ break.

## Why

Rules in `CLAUDE.md` and agent prompts are advice. Over a long session, or across a dozen parallel subagents, advice drifts:

- a backend agent "quickly fixes" a frontend file, and two agents overwrite each other's work;
- a domain module starts importing the database client, and the layering the architecture doc describes stops being true;
- a contract or schema changes with no record of who changed it or why;
- code gets written before anyone checked it against the spec, or a screen before it was designed;
- an agent declares "done" with failing type checks, or with work nobody committed;
- someone force-pushes, commits to `main`, adds a dependency, or runs a deploy nobody asked for.

code-kit stops each of these at the moment it would happen. The hook refuses the tool call and tells the agent why and what to do instead. The rules live in one reviewed file, not in every prompt, so they hold for every agent and every session.

## What it enforces

- **Lanes:** each lane agent writes only its own paths. The main session (the lead) writes contracts, specs and config, and delegates the rest. Any other subagent is read-only.
- **Layers:** each layer depends only on the layers it lists, and never on packages it's denied. This is checked on every edit and again before finishing, for JavaScript and TypeScript imports. In brownfield code, existing violations can be recorded in a baseline so only new ones block.
- **Protected paths and the approval log:** every committed change to the kit, registers or contracts is appended to `.claude/approval-log.jsonl`, in the same commit. Only the lead writes these paths without a person's approval, and the person reviews them in the pull request.
- **Spec-check before code:** when the project has specs, a lane can't write code on a branch until the spec-check report for that branch exists.
- **Designs before screens** (optional): a screen file can't be written until the design register lists it.
- **Shell rules:**
  - no force-push, pushing to or committing on protected branches, `--no-verify`, destructive deletes, or piping downloads into a shell;
  - no new dependencies without the lead;
  - no forged approvals;
  - the project's own blocked commands (deploys, releases) and lane-restricted commands (shared local services).
- **Proof before finishing:** before any agent finishes, the plugin runs:
  - an ownership audit of every uncommitted change;
  - the layer rules;
  - the project's checks, for the files that changed.

  A lane also has to commit its work first.

A project without `.claude/code-kit.json` isn't governed at all. An invalid config fails closed: nothing but the config itself can be written until it's fixed.

## When to use it

Use it when:

- **Several agents work on one codebase at once**, such as a lead delegating to frontend, backend and data lanes, possibly in separate worktrees. Lanes are what keep them out of each other's files.
- **The architecture has layers worth protecting**, like domain, services, adapters and UI, or a shared package that mustn't reach into apps.
- **Some files need an audit trail:** API contracts, schemas, registers, the kit's own config.
- **The project has specs or designs** that code should follow rather than improvise.
- **"Done" has to mean done:** checks passing and work committed, not an agent's say-so.

It's overkill for a throwaway script, a spike, or a single-file change. In those, just don't add `.claude/code-kit.json`: the plugin stays installed and does nothing.

Set it up at the start of a new build, straight from the architecture docs, or bring it into an existing codebase at any point (init works the rules out from the code). Re-run init whenever the shape of the project changes: new apps or packages, moved folders, a changed plan.

## Where it runs

- **In Claude Code**, as a plugin. It's installed once per machine and governs only projects that have `.claude/code-kit.json`.
- **On every tool call** in those projects, through Claude Code hooks:

  | Hook                     | Runs                        | Enforces                                                          |
  | ------------------------ | --------------------------- | ----------------------------------------------------------------- |
  | `PreToolUse` Edit/Write  | `hooks/guard-paths.mjs`     | lanes, protected paths, spec-check and design gates               |
  | `PreToolUse` Bash        | `hooks/guard-bash.mjs`      | shell rules, dependencies, approval log and secret scan on commit |
  | `PostToolUse` Edit/Write | `hooks/post-edit-check.mjs` | layer rules and the project's `postEdit` commands                 |
  | `PostToolUse` Bash       | `hooks/lane-audit.mjs`      | ownership of files written by shell commands                      |
  | `Stop`, `SubagentStop`   | `hooks/stop-check.mjs`      | proof before finishing                                            |

- **For the main session and every subagent**, including agents in worktrees under `.claude/worktrees/`.
- **Locally, with Node 22 or later.** Nothing is sent anywhere. The CLI in `bin/` runs the same rules from a terminal.

## Install

From GitHub (the repository is private, so `gh auth login` or git credentials for it are needed):

```text
/plugin marketplace add warrendeanlangeveldt/code-kit
/plugin install code-kit@code-kit
```

Or from a local checkout:

```text
/plugin marketplace add ~/workspace/code-kit
/plugin install code-kit@code-kit
```

Needs Node 22 or later. `gitleaks` is recommended, for the secret scan on commit.

## Set up a project

```text
/code-kit:init docs/
```

- **A new build:** init reads the docs in full: the architecture and layer map, the plan or work split, and the principles. It drafts the rules from them.
- **An existing codebase (brownfield):** the docs can be thin or missing. Init works the layers out from the code: which folders import which, and who works where according to the git history. It also runs each check once and flags any that already fail, so you decide what to do with them.
- **Either way:** you get a draft (`.claude/code-kit.draft.json`), one agent per lane, a CLAUDE.md section and a list of questions. Nothing is enforced until you approve and the draft becomes `.claude/code-kit.json`.

**Existing violations.** Brownfield code usually breaks some layer rules already. On approval, `baseline --write` records them in `.claude/code-kit.baseline.json`:

- the violations it records don't block;
- new ones, even in the same file, do;
- the baseline only ever shrinks: re-recording drops what's been fixed and refuses anything new.

**No specs yet?** Leave `docs.specs` out, and lanes aren't held to a spec-check report. Add it once specs exist.

## Keep it up to date

Re-run `/code-kit:init` whenever the build moves on: new apps or packages, moved folders, a changed plan, or files `unowned` keeps listing. It drafts the whole config again, then shows you the difference before anything changes:

```text
+ lane jobs: jobs-engineer, workers/jobs/**
~ lane backend: exclude + workers/jobs/**
~ layer services: mayImport - schemas
Owner backend lane / backend-engineer → jobs lane / jobs-engineer: 14 file(s), e.g. workers/jobs/run.ts
```

Lanes never change silently: only when you approve the diff.

## The CLI

Run from the project root. Add `--config .claude/code-kit.draft.json` to any command to read a draft instead. In a session, the `/code-kit:check` skill runs `check` and `unowned` for you.

```bash
node ~/workspace/code-kit/bin/code-kit.mjs check              # validate and summarise
node ~/workspace/code-kit/bin/code-kit.mjs who <path>...      # owner and layer of each path
node ~/workspace/code-kit/bin/code-kit.mjs unowned            # tracked files nobody may write
node ~/workspace/code-kit/bin/code-kit.mjs diff --config .claude/code-kit.draft.json  # what a draft changes
node ~/workspace/code-kit/bin/code-kit.mjs baseline [--write] # layer violations in the code as it is
node ~/workspace/code-kit/bin/code-kit.mjs graph [--depth N]  # which folders import which
```

## Config

`.claude/code-kit.json`. Globs use `*` (one segment), `**` (any depth), `**/` (zero or more folders), `?` and `{a,b}`. Patterns under `shell` are regular expressions.

| Field                          | Required          | What it is                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`                      | yes               | `1`                                                                                                                                                                                                                                                                                                                                              |
| `docs.specs`                   | no                | Folder of specs. With it, a lane needs a spec-check report before writing code on a branch                                                                                                                                                                                                                                                       |
| `docs.principles`, `docs.plan` | no                | The engineering principles and the implementation plan                                                                                                                                                                                                                                                                                           |
| `lead.paths`                   | yes               | What the main session writes. `.claude/**` is always added.                                                                                                                                                                                                                                                                                      |
| `lead.outside`                 | no                | Paths outside the repository the lead may write, e.g. `../shared-lib/**`. Claude's memory and scratchpad are always included.                                                                                                                                                                                                                    |
| `anyActor`                     | no                | Paths every writer may change (e.g. the lockfile). `.claude/state/**` is always included.                                                                                                                                                                                                                                                        |
| `lanes.<name>`                 | yes (may be `{}`) | `{ agent, paths, exclude? }`: the agent name maps a subagent to its lane. A worktree with a `.lane` file holding the lane name makes the main session that lane.                                                                                                                                                                                 |
| `protected[]`                  | no                | `{ glob, approval, why }`: logged on every commit. Anyone but the lead needs `.claude/approvals/<approval>` from a person. `.claude/**` is always protected as `kit`.                                                                                                                                                                            |
| `designGate`                   | no                | `{ register, screens: [{ glob, not? }], howTo }`: screen files wait until the register (`{ "screens": [{ "file": … }] }`) lists them                                                                                                                                                                                                             |
| `layers[]`                     | no                | `{ name, paths, mayImport, denyPackages? }`: the first layer whose paths match a file owns it. A layer may always import itself.                                                                                                                                                                                                                 |
| `importAliases`                | no                | `{ "@app/domain": "packages/domain/src" }`: resolves non-relative imports to repository paths                                                                                                                                                                                                                                                    |
| `shell.block[]`                | no                | `{ pattern, why }`: never run                                                                                                                                                                                                                                                                                                                    |
| `shell.restricted[]`           | no                | `{ pattern, lanes, why }`: only the lead and these lanes                                                                                                                                                                                                                                                                                         |
| `postEdit[]`                   | no                | `{ files, exclude?, run }`: after each edit of a matching file. `{file}` is the file. Exit 127 (tool not installed) is skipped.                                                                                                                                                                                                                  |
| `checks[]`                     | no                | `{ name, files, exclude?, run[], each?, owners?, ifMissing?, timeoutSeconds? }`: before finishing, when matching files changed. `each` runs the commands in every changed folder matching that glob. `owners` limits who may change the files (the lead always may). `ifMissing: "fail"` makes a missing tool an error (the default is to skip). |
| `branches.protected`           | no                | Default `["main", "master"]`                                                                                                                                                                                                                                                                                                                     |

Add `.claude/approvals/`, `.claude/state/` and `.claude/code-kit.draft.json` to `.gitignore`. Commit `.claude/code-kit.baseline.json` if the project has one.

## Approvals

The lead edits protected paths directly. The audit log records every committed change as `lead`, and the person reviews it in the pull request. To attach a reason, or to let a lane commit a protected file, a person runs this at the terminal (the `!` prefix in Claude Code runs it; hooks never see it):

```bash
echo "Approve the reset password screens" > .claude/approvals/design
```

It lasts 60 minutes. Agents can't create, edit or even mention approvals or the log.

## Develop

```bash
npm test        # unit tests, then the hooks end to end in throwaway repositories
```
