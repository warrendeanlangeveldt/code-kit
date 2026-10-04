<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/logo-dark.png">
    <img src="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/logo.png" alt="code-kit" width="300">
  </picture>
</p>

# code-kit

A Claude Code plugin that keeps AI coding agents inside a project's engineering rules. You write the rules once, per project, in `.claude/code-kit.json`. The plugin's hooks enforce them on every tool call, for the main session and every subagent. A rule Claude would otherwise only be _asked_ to follow becomes one the hooks refuse to let it break. The same rules run in CI for every pull request.

It also carries the work from idea to merged code: spec an idea into requirements, hand stories to lanes, review each branch against its requirements, and track the build against the spec.

**Pairs with [Context Graph](https://github.com/warrendeanlangeveldt/context-graph).** code-kit decides who may change what, and what has to be proved. Context Graph gives each agent the why behind a file before it edits it: the file's card, its rules and the decisions made on it, kept in git. Each detects the other: Context Graph's cards and slices then carry the file's spec requirement and layer rule. Install both for agents that stay in their lane and know why the code is the way it is.

<p align="center">
  <img src="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/workflow.svg" alt="How code-kit works: the specs create the agents, skills and rules; the lead agent delegates stories to lane agents and takes decisions and approvals to you; lanes send scope and dependency requests back to the lead; hooks enforce ownership, layers, approvals and spec-check while each lane implements, tests and commits; the lead reviews against the requirements and CI runs verify." width="820">
</p>

## Quick start

You need Claude Code, Node 22 or later, and git. Then, in Claude Code:

```text
/plugin marketplace add warrendeanlangeveldt/code-kit
/plugin install code-kit@code-kit
/code-kit:next
```

`/code-kit:next` works out where your project stands and takes you through the next step. A blank folder starts with speccing an idea; an existing codebase starts with drafting its rules. Nothing is enforced until you approve the rules it drafts. In a project without `.claude/code-kit.json`, the plugin does nothing.

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
- **Layers:** each layer depends only on the layers it lists, and never on packages it's denied. This is checked before every write (a write that would add a violation is refused, so a layer is never broken on disk), after it, and again before finishing, for JavaScript and TypeScript imports. In brownfield code, existing violations can be recorded in a baseline so only new ones block.
- **Protected paths and the approval log:** every committed change to the kit, registers or contracts is appended to `.claude/approval-log.jsonl`, in the same commit. Only the lead writes these paths without a person's approval, and the person reviews them in the pull request.
- **Spec-check before code:** when the project has specs, a lane can't write code on a branch until the spec-check report for that branch exists.
- **Designs before screens** (optional): a screen file can't be written until the design register lists it.
- **Shell rules:**
  - no force-push, pushing to or committing on protected branches, `--no-verify`, destructive deletes, or piping downloads into a shell;
  - no new dependency without a person's approval, for that package and that lane; the approval also covers the manifest and lockfile changes the install makes;
  - no forged approvals;
  - the project's own blocked commands (deploys, releases) and lane-restricted commands (shared local services).
- **Proof before finishing:** before any agent finishes, the plugin runs:
  - an ownership audit of every uncommitted change;
  - the layer rules;
  - the project's checks, for the files that changed.

  A lane also has to commit its work first.

- **The same rules in CI:** `code-kit verify` checks a pull request as a whole, including commits made outside Claude Code:
  - a `<lane>/…` branch stays in that lane's paths, apart from manifest and lockfile changes logged under a dependency approval;
  - every protected change is in the approval log, and the log is append-only;
  - no new layer violations, and the baseline doesn't grow;
  - no screens without an approved design, and no committed secrets;
  - the project's checks pass.

A project without `.claude/code-kit.json` isn't governed at all. An invalid config fails closed: nothing but the config itself can be written until it's fixed.

The hooks are guard rails, not a sandbox ([SECURITY.md](SECURITY.md)): they refuse the actions they recognise. Two limits are deliberate. The finish check stops blocking once it has reported the same problem three times without progress, and says so, for the lead to take up. A check whose tool isn't installed is skipped unless it sets `ifMissing: "fail"`.

## When to use it

Use it when:

- **Several agents work on one codebase at once**, such as a lead delegating to frontend, backend and data lanes, possibly in separate worktrees. Lanes are what keep them out of each other's files.
- **The architecture has layers worth protecting**, like domain, services, adapters and UI, or a shared package that mustn't reach into apps.
- **Some files need an audit trail:** API contracts, schemas, registers, the kit's own config.
- **The project has specs or designs** that code should follow rather than improvise.
- **"Done" has to mean done:** checks passing and work committed, not an agent's say-so.
- **You're starting from an idea**, and want the specification worked out before anyone writes code.

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
- **In CI**, through `code-kit verify` in a GitHub Actions workflow that init can install (`templates/github-workflow.yml`).
- **Locally, with Node 22 or later.** Nothing is sent anywhere. The CLI in `bin/` runs the same rules from a terminal.

## Install

**Requirements:** Claude Code, Node 22 or later, and git. [gitleaks](https://github.com/gitleaks/gitleaks) is optional: when it's installed, every commit gets a secret scan.

**The plugin**, from this repository's marketplace:

```text
/plugin marketplace add warrendeanlangeveldt/code-kit
/plugin install code-kit@code-kit
```

To update later, run `/plugin marketplace update code-kit` and restart Claude Code; sessions started before an update keep the old hooks. To pin it for a whole team, add it to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "code-kit": { "source": { "source": "github", "repo": "warrendeanlangeveldt/code-kit" } }
  },
  "enabledPlugins": { "code-kit@code-kit": true }
}
```

**The command line** is optional: the skills run it for you in a session. Use it for CI, or from a terminal:

```sh
npx @warren-dean/code-kit check          # no install
npm i -g @warren-dean/code-kit           # or install it, then: code-kit check
```

**From a clone**, for working on code-kit itself: `/plugin marketplace add <path to the clone>`.

**Its companion, [Context Graph](https://github.com/warrendeanlangeveldt/context-graph)**, installs the same way. Nothing needs configuring between the two:

```text
/plugin marketplace add warrendeanlangeveldt/context-graph
/plugin install context-graph@context-graph
```

## One command: `/code-kit:next`

Don't want to remember which skill comes when? Run `/code-kit:next`, from a blank folder or at any point in a build:

```text
/code-kit:next a booking app for mobile dog groomers
```

It reads where the project stands and runs the right skill. It carries on to the following step until something needs you: questions to answer, a draft to approve, a pull request to merge, or lanes still building.

| The project has                                | `next` runs                                      |
| ---------------------------------------------- | ------------------------------------------------ |
| Nothing                                        | spec-design                                      |
| A spec still being shaped                      | spec-design, picking up where it stopped         |
| A ready spec, existing code, or a draft config | init                                             |
| Stories finished on their branches             | review, then dispatch                            |
| Stories ready                                  | dispatch                                         |
| Stories being built                            | nothing: it tells you what's running             |
| Everything done                                | a status summary, then offers the next milestone |

`code-kit next` on the command line shows the same decision without running anything.

## Start from an idea

```text
/code-kit:spec-design a booking app for mobile dog groomers
```

spec-design works an idea into a specification with you before any code exists. It asks the questions that decide the build, a few at a time with a recommended answer, and writes every decision down:

1. **Frame:** the problem, the users, the outcome, the constraints and the non-goals.
2. **Explore:** two or three different shapes of solution, the main user journeys, and the riskiest assumptions. You choose.
3. **Scope:** capability areas, and what the first release has to deliver end to end.
4. **Specify:** one spec per area, with numbered, testable requirements covering data, states, rules, permissions, errors and acceptance criteria.
5. **Architecture, principles and plan:** the layers, contracts, definition of done, and stories split into lanes.
6. **Check:** every journey maps to requirements and every requirement to a story, with no gaps left as "TBD".

It writes `docs/brief.md` (with the decision log and open questions), `docs/specs/NN-<area>.md`, `docs/architecture.md`, `docs/principles.md` and `docs/plan.md`. Those are exactly what `/code-kit:init docs/` turns into lanes and layers, and what lanes spec-check against. Run it again to resume where it left off, to change a decision, or to spec a new feature in an existing codebase.

Requirements are headings (`### BOOK-4 Cancel a booking`). Stories are `### ST-12` headings in the plan with `**Lane:**`, `**Requirements:**`, `**Depends on:**` and `**Status:**` lines (`templates/plan.md`). The lane `lead` marks the lead's own stories, such as contracts and spikes, which the lead builds itself instead of dispatching; `**Requirements:** none` marks a story that delivers no requirement. Those two formats are what the build loop below runs on.

## Set up a project

```text
/code-kit:init docs/
```

- **A new build:** init reads the docs in full: the architecture and layer map, the plan or work split, and the principles. It drafts the rules from them.
- **An existing codebase (brownfield):** the docs can be thin or missing. Init works the layers out from the code: which folders import which, and who works where according to the git history. It also runs each check once and flags any that already fail, so you decide what to do with them.
- **Either way:** you get a draft (`.claude/code-kit.draft.json`), one agent per lane, any project skills you approve, a CLAUDE.md section and a list of questions (see [The agents and skills it creates](#the-agents-and-skills-it-creates)). Nothing is enforced until you approve and the draft becomes `.claude/code-kit.json`.

**Existing violations.** Brownfield code usually breaks some layer rules already. On approval, `baseline --write` records them in `.claude/code-kit.baseline.json`:

- the violations it records don't block;
- new ones, even in the same file, do;
- the baseline only ever shrinks: re-recording drops what's been fixed and refuses anything new.

**No specs yet?** Leave `docs.specs` out, and lanes aren't held to a spec-check report. Add it once specs exist.

## The agents and skills it creates

code-kit ships no fixed team. Init writes one for each project, from its docs or its code, and re-running init keeps it in step as the project changes.

```text
.claude/
├── code-kit.json          # the rules: lanes, layers, protected paths, checks
├── agents/
│   ├── web-engineer.md    # one lane agent per lane
│   ├── api-engineer.md
│   └── db-engineer.md
└── skills/
    └── new-migration/     # project recipes, only the ones you approve
        └── SKILL.md
CLAUDE.md                  # plus a section telling the lead how the rules work
```

**Who's who.** There are four kinds of actor. The hooks tell the three Claude kinds apart on every tool call; the person works outside them:

| Actor              | Who it is                                                                                   | May write                                       |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| The person         | You                                                                                         | Anything; you also approve and merge            |
| The lead           | The main Claude Code session                                                                | Contracts, specs, config, the kit: `lead.paths` |
| A lane agent       | A subagent whose name is a lane's `agent` in the config, or a session in a `.lane` worktree | Only its lane's paths, after its spec-check     |
| Any other subagent | Explore, Plan, reviewers, anything not mapped to a lane                                     | Nothing: read-only                              |

**Lane agents** (`.claude/agents/<agent>.md`, from `templates/agent.md`). Each is filled in from the project's docs, or from the code for brownfield projects:

- the paths the lane owns, its layers and what they may depend on;
- the specs it reads;
- the skills it uses: spec-check, plus its project recipes;
- the command that proves its work, and the lane's own rules.

It also carries the working rules: start from the story's branch and spec-check, build end to end with no mocks or placeholders, name requirement IDs in test titles, and commit before finishing.

The config's `lanes.<name>.agent` must match the agent file's `name`. That's how the hooks know a subagent is the web lane and not a read-only helper.

**Instructions and enforcement are separate.** The agent file tells the agent the rules, so it rarely hits them. The hooks enforce them whether or not the agent follows its file:

- writes outside its lane are blocked;
- code before a spec-check report is blocked;
- finishing with failing checks or uncommitted work is blocked.

Editing an agent file can't loosen a rule. And the agent files are kit files (`.claude/**`), so only the lead changes them, and every change is logged.

**Spawned per story.** Dispatch starts a fresh instance of the lane's agent for each story, in its own worktree on `<lane>/st-<n>`. Agents for different lanes run in parallel. Each starts knowing only its agent file and the story's brief, so nothing leaks between stories.

**How the spec is enforced, step by step:**

1. The brief names the story's requirement IDs.
2. The agent runs the spec-check skill and saves a requirement table for its branch.
3. The path guard blocks any code in its lane until that report exists.
4. The agent's tests name the requirement IDs.
5. The stop hook runs the checks before the agent can finish.
6. Review compares the branch with the requirements and the report, and `verify` checks the rules again in CI.

**Project skills** (`.claude/skills/<recipe>/SKILL.md`) are the step-by-step recipes your docs describe, like "add a migration" or "add an endpoint". Init lists the ones it finds and writes them only if you say yes, never as empty stubs. Each is listed in the owning lane agent's "Skills to use". Like the agents, they're kit files: the lead maintains them, and changes are logged.

**Kept in step.** When the project changes (a new app, a new lane, moved folders), re-run `/code-kit:init`. It drafts new agents for new lanes and updates the paths of existing ones, keeping anything written by hand. You see the difference and approve it before anything changes.

## Build

Once init has switched the rules on, the lead runs the build in a loop:

```text
/code-kit:dispatch next      # start every ready story on its lane
/code-kit:review ST-12       # check a finished branch, then merge or send it back
/code-kit:status             # where the build stands against the spec
```

- **Dispatch** picks the stories whose dependencies are done. It checks that no open question blocks them and that their contracts exist, then starts each lane agent in its own worktree on the branch `<lane>/st-<n>`, in parallel. Each brief names the story's requirements and acceptance criteria. Lanes spec-check first, build end to end, name requirement IDs in their test titles, and commit.
- **Review** runs `verify` on the branch, then checks each requirement: built end to end, proved by a test, matching the spec-check report, and nothing beyond the story. It ends with merge, send back with the list of problems, or a question for you.
- **Status** traces every requirement to its story, branch and tests. It shows what's done, in review, ready and blocked, which requirements no test names, and where the plan's status lines are out of date.

## Enforce it in CI

The hooks only see Claude Code sessions. For everything else, init offers `.github/workflows/code-kit.yml` (from `templates/github-workflow.yml`). It runs `verify` on every pull request, through `npx @warren-dean/code-kit@<version>`, pinned so CI doesn't change under you. It needs no secret. The one setting to make is marking the `code-kit` check as required on the protected branches.

`verify` can't see spec-check reports, because `.claude/state/` isn't committed. Review covers those.

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

Run from the project root, as `code-kit <command>` once installed (`npm i -g @warren-dean/code-kit`), or `npx @warren-dean/code-kit <command>`. Add `--config .claude/code-kit.draft.json` to any command to read a draft instead. In a session, the `/code-kit:check` skill runs `check` and `unowned` for you. `next` also works in a project without code-kit, or outside a git repository.

```bash
code-kit check              # validate and summarise
code-kit who <path>...      # owner and layer of each path
code-kit unowned            # tracked files nobody may write
code-kit diff --config .claude/code-kit.draft.json  # what a draft changes
code-kit baseline [--write] # layer violations in the code as it is
code-kit graph [--depth N]  # which folders import which
code-kit verify [--base ref] [--branch name] [--no-checks]  # a branch's changes, for CI and review
code-kit status [--base ref] [--json]  # stories and requirements against the spec
code-kit next [--base ref] [--json]    # the step to take now, from the project's state
code-kit trace <path>... [--json]      # what a file is for: requirements, lane, layer rules
code-kit approve <name>... --reason "…" [--lane name] [--delegated]  # record a person's approval from chat, or (--delegated) grant one within the delegated rules; a package name stands for its dep- approval
```

`verify` compares the branch with where it left `--base` (default `origin/main`, then `main`). A branch named `<lane>/…`, or given as `--branch`, is held to that lane. `--no-checks` leaves the project's checks to CI's own steps. `status` reads `docs.specs` and `docs.plan`.

## Config

`.claude/code-kit.json`. Globs use `*` (one segment), `**` (any depth), `**/` (zero or more folders), `?` and `{a,b}`. Patterns under `shell` are regular expressions.

| Field                          | Required          | What it is                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`                      | yes               | `1`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs.specs`                   | no                | Folder of specs. With it, a lane needs a spec-check report before writing code on a branch                                                                                                                                                                                                                                                                                                                                     |
| `docs.principles`, `docs.plan` | no                | The engineering principles and the implementation plan                                                                                                                                                                                                                                                                                                                                                                         |
| `lead.paths`                   | yes               | What the main session writes. `.claude/**` is always added.                                                                                                                                                                                                                                                                                                                                                                    |
| `lead.outside`                 | no                | Paths outside the repository the lead may write, e.g. `../shared-lib/**`. Claude's memory and scratchpad are always included.                                                                                                                                                                                                                                                                                                  |
| `anyActor`                     | no                | Paths every writer may change (e.g. the lockfile). `.claude/state/**` is always included.                                                                                                                                                                                                                                                                                                                                      |
| `lanes.<name>`                 | yes (may be `{}`) | `{ agent, paths, exclude? }`: the agent name maps a subagent to its lane. A worktree with a `.lane` file holding the lane name makes the main session that lane.                                                                                                                                                                                                                                                               |
| `protected[]`                  | no                | `{ glob, approval, why }`: logged on every commit. Anyone but the lead needs a person's approval (see [Approvals](#approvals)). `.claude/**` is always protected as `kit`.                                                                                                                                                                                                                                                     |
| `designGate`                   | no                | `{ register, screens: [{ glob, not? }], howTo }`: screen files wait until the register (`{ "screens": [{ "file": … }] }`) lists them                                                                                                                                                                                                                                                                                           |
| `layers[]`                     | no                | `{ name, paths, mayImport, denyPackages? }`: the first layer whose paths match a file owns it. A layer may always import itself.                                                                                                                                                                                                                                                                                               |
| `importAliases`                | no                | `{ "@app/domain": "packages/domain/src" }`: resolves non-relative imports to repository paths                                                                                                                                                                                                                                                                                                                                  |
| `shell.block[]`                | no                | `{ pattern, why, person? }`: never run. `person: true` marks a person's act, which the lead may do for them with `approvals.lead` on                                                                                                                                                                                                                                                                                           |
| `shell.restricted[]`           | no                | `{ pattern, lanes, why }`: only the lead and these lanes                                                                                                                                                                                                                                                                                                                                                                       |
| `postEdit[]`                   | no                | `{ files, exclude?, run }`: after each edit of a matching file. `{file}` is the file. Exit 127 (tool not installed) is skipped.                                                                                                                                                                                                                                                                                                |
| `checks[]`                     | no                | `{ name, files, exclude?, run[], each?, owners?, ifMissing?, timeoutSeconds? }`: before finishing, when matching files changed. `each` runs the commands in every changed folder matching that glob. `owners` limits who may change the files (the lead always may). `ifMissing: "fail"` makes a missing tool an error (the default is to skip).                                                                               |
| `adapters`                     | no                | `{ "<adapter>": false }` switches off an adapter that would otherwise be detected. See [Adapters](#adapters).                                                                                                                                                                                                                                                                                                                  |
| `approvals.lead`               | no                | `true` lets the lead act on what the person says in chat, for when `!` isn't available (on a phone, say): it records their approvals with `code-kit approve`, and runs `shell.block` commands marked `person`. Default `false`. See [Approvals](#approvals).                                                                                                                                                                   |
| `approvals.delegate`           | no                | `{ protected?: [approval names], dependencies?: { licences?, minWeeklyDownloads?, maxMonthsSinceRelease?, allowInstallScripts? } }`: approvals the lead may grant on its own, with `code-kit approve --delegated`. Dependencies are checked against the npm registry; the defaults are MIT, Apache-2.0, BSD and ISC, 10,000 weekly downloads, a release within 18 months, and no install scripts. See [Approvals](#approvals). |
| `branches.protected`           | no                | Default `["main", "master"]`                                                                                                                                                                                                                                                                                                                                                                                                   |

Add `.claude/approvals/`, `.claude/state/` and `.claude/code-kit.draft.json` to `.gitignore`, and `.claude/approval-log.jsonl merge=union` to `.gitattributes`, so merging branches that both logged changes keeps every entry. Commit `.claude/code-kit.baseline.json` if the project has one.

## Approvals

The lead edits protected paths directly. The audit log records every committed change as `lead`, and the person reviews it in the pull request. To attach a reason, to let a lane commit a protected file, or to allow a new dependency, a person runs a command at the terminal (the `!` prefix in Claude Code runs it; hooks never see it). The refusal an agent gets names the exact command.

```bash
echo "Approve the reset password screens" > .claude/approvals/design          # anyone
echo "Approve the reset password screens" > .claude/approvals/web/design      # the web lane only
echo "Date formatting for ST-12" > .claude/approvals/web/dep-dayjs             # the web lane adds dayjs
```

- **Scope:** an approval in a lane's folder serves that lane only; one directly in `.claude/approvals/` serves every agent. The refusal a lane gets names its own folder.
- **Dependencies:** each new package needs its own approval, `dep-<package>` (`/` becomes `+`, so `@scope/pkg` is `dep-@scope+pkg`). It allows the install, and the changes the install makes to manifests and lockfiles that no other lane owns. When the lane commits a manifest or lockfile outside its own paths, the commit hook logs it as a `dependency` approval, with the packages and reasons, and `code-kit verify` accepts it.
- **Worktrees:** approvals live in the main checkout, so a lane working in its own worktree sees the ones given at the lead's terminal.
- **Lifetime:** 60 minutes. Agents can't create, edit or even mention approvals or the log.

### From chat

On a phone, or anywhere the `!` prefix arrives as plain text, a person can't run the command. With `"approvals": { "lead": true }` in the config (init asks), the person says what they approve in chat, and the lead records it:

```bash
code-kit approve dep-dayjs --lane web --reason "Yes, add dayjs for ST-12"
```

- It writes the same approval a `!` command would, for the same 60 minutes, with `(given in chat, recorded by the lead)` after the reason, so the log shows how it was given.
- Only the lead may run it. A lane or read-only agent is refused, and so is the lead while the setting is off or the config is invalid.
- With the setting on, refusals name this command alongside the `!` one.
- The lead may also run `shell.block` commands marked `person: true`, such as Context Graph's ratification trailer.
- It trusts the lead to act only on the person's own words. Leave it off when the lead runs without a person watching.

### Delegated

For a lead that runs without a person watching, such as an autonomous team, `approvals.delegate` lets the lead approve some things on its own authority, within rules the person sets in the config:

```json
"approvals": { "delegate": { "protected": ["design"], "dependencies": { "minWeeklyDownloads": 10000 } } }
```

```bash
code-kit approve date-fns --lane web --delegated --reason "Date formatting for ST-12"
```

- **Protected approvals:** the lead may grant those named in `protected`, and no others.
- **Dependencies:** each package is checked against the npm registry. Its licence must be in `licences`; it must have at least `minWeeklyDownloads` downloads last week and a release within `maxMonthsSinceRelease` months; and installing it must run no scripts, unless `allowInstallScripts` is true. Packages from other ecosystems, and anything the registry can't confirm, go to the person.
- **All or nothing:** if any name is outside the rules, nothing is approved, and the command says which rule each one broke, so the lead asks the person.
- **The record:** the approval reads `(approved by the lead within the delegated rules: <rule>)` after the reason. The approval log keeps it when the change is committed.
- **Who:** only the lead. A lane asks the lead with a change request, and its refusals say the lead may approve within the rules. Without `approvals.delegate`, `--delegated` is refused.

## Adapters

Other tools share a project with code-kit and keep files of their own. An adapter tells code-kit about one such tool, without the core knowing its name. Each adapter lives in `hooks/lib/adapters/`, and declares:

- how to detect the tool;
- what the tool adds to the rules: paths for the lead, paths any actor may write, protected paths, blocked commands;
- the setup init should apply.

While the tool is detected, its additions are merged into the effective config, like the kit's own defaults. Run `code-kit adapters` to see them, or switch one off with `"adapters": { "<name>": false }`.

| Adapter         | Detected by | Adds                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context-graph` | `.ctx/`     | `.ctx/**` for the lead. `.ctx/decisions.ctx` and `.ctx/cards.ctx` for any actor, since every agent records decisions and file cards. `graph.ctx` and `config.toml` are protected (approval `ctx`). No Claude actor may write a `Ctx-Ratified-By` trailer: ratifying is a person's act (with `approvals.lead`, the lead may add it when the person says so in chat). |

Its setup:

- ignore ctx's working files;
- add `merge=union` for `decisions.ctx` and `cards.ctx`, so lanes' decisions and cards from parallel branches all survive a merge;
- keep the two CLAUDE.md blocks pointing to each other.

To add one, write `hooks/lib/adapters/<tool>.mjs` in the same shape and list it in `hooks/lib/adapters/index.mjs`.

The other direction is `code-kit trace <path> --json`. It's the contract other tools read: the requirements a file delivers (from the `ST-n` stories its commits name, and the current story branch), its lane and owner, and its layer with what that layer may import. Context Graph's tool adapter calls it, so a file's card and the slice before an edit carry the spec requirement and the layer rule.

## Develop

```bash
npm test        # unit tests, then the hooks end to end in throwaway repositories
```

## Licence

MIT. See [LICENSE](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
