<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/logo-dark.png">
    <img src="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/logo.png" alt="code-kit" width="300">
  </picture>
</p>

# code-kit

A Claude Code plugin that keeps AI coding agents inside a project's engineering rules. You write the rules once, per project, in `.claude/code-kit.json`. The plugin's hooks check them on every file edit, shell command and finish, for the main session and every subagent. A rule Claude would otherwise only be _asked_ to follow becomes one a hook refuses to let it break, or, for shell commands, reports straight after for the agent to undo. `code-kit verify` runs the same rules on a branch, in review and in CI.

It has two parts. The core is the rules and their checks: who may write where, layers, protected files with an audit log, approvals, and proof before finishing. On top of it sits an optional workflow that carries work from idea to merged code: spec an idea into requirements, hand stories to lanes, review each branch against its requirements, and track the build against the spec. You can use the core without the workflow.

**Pairs with [Context Graph](https://github.com/warrendeanlangeveldt/context-graph).** code-kit decides who may change what, and what has to be proved. Context Graph gives each agent the why behind a file before it edits it: the file's card, its rules and the decisions made on it, kept in git. Each detects the other: Context Graph's cards and slices then carry the file's spec requirement and layer rule. Install both for agents that stay in their lane and know why the code is the way it is.

<p align="center">
  <img src="https://raw.githubusercontent.com/warrendeanlangeveldt/code-kit/main/assets/workflow.svg" alt="How code-kit works: the specs create the agents, skills and rules; the lead agent delegates stories to lane agents and takes decisions and approvals to you; lanes send scope and dependency requests back to the lead; hooks enforce ownership, layers, approvals and spec-check while each lane implements, tests and commits; the lead reviews against the requirements and CI runs verify." width="820">
</p>

<p align="center">
  <a href="https://warrendeanlangeveldt.github.io"><img src="https://warrendeanlangeveldt.github.io/assets/media/harness.gif" alt="code-kit and Context Graph in a Claude Code session: the band above the prompt, the lanes, the code map lighting up as agents read and edit, and the module graph" width="900"></a>
</p>

**See it in action at [warrendeanlangeveldt.github.io](https://warrendeanlangeveldt.github.io)**, with a live replay of a real build.

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

code-kit catches each of these, most at the moment it would happen: the hook refuses the edit or command and tells the agent why and what to do instead. A file a shell command writes is caught straight after the command, and the agent is told to revert it. The rules live in one reviewed file, not in every prompt, so they hold for every agent and every session. They are guard rails for agents, not a sandbox: see [What verify proves, and its limits](#what-verify-proves-and-its-limits).

## What it enforces

- **Lanes:** each lane agent writes only its own paths. The main session (the lead) writes contracts, specs and config, and delegates the rest. Any other subagent is read-only. An edit outside those paths is refused before it happens; a file a shell command writes outside them is reported straight after, for the agent to revert, and the finish check refuses to finish until it's gone.
- **Layers:** each layer depends only on the layers it lists, and never on packages it's denied, for JavaScript and TypeScript imports. An edit that would add a violation is refused before it's written; the rules are checked again after each edit and before finishing, which is what catches a file a shell command wrote. In brownfield code, existing violations can be recorded in a baseline so only new ones block. Imports are found by pattern, not by parsing: see [the limits](#what-verify-proves-and-its-limits).
- **Protected paths and the approval log:** every committed change to the kit, registers or contracts is appended to `.claude/approval-log.jsonl`, in the same commit. Only the lead writes these paths without an approval, and the person reviews them in the pull request. A lane needs an approval: the lead's for what `approvals.delegate` gives it, otherwise the person's.
- **Spec-check before code:** when the project has specs, a lane can't write code on a branch until it has saved a spec-check report for that branch. The hook checks that the report exists; review checks what it says.
- **Designs before screens** (optional): a screen file can't be written until the design register lists it.
- **Shell rules**, matched against the command's text before it runs:
  - no force-push, pushing to or committing on protected branches, `--no-verify`, destructive deletes, or piping downloads into a shell;
  - no new dependency without an approval, for that package and that lane: the lead's, for a story it judged needs it, where dependencies are delegated, otherwise a person's; the approval also covers the manifest and lockfile changes the install makes;
  - no forged approvals;
  - no commit that weakens a test (deletes it, skips or focuses it, removes cases or assertions, or rewrites a snapshot) without a `tests` approval: the lead's on a lane's branch, after its review, where tests are delegated (the default), and the person's on the lead's own branches;
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
  - no screens without an approved design;
  - no secret files (`.env`, `secrets/`, keys and keystores) anywhere in the branch's history, including ones committed and deleted again, and, where gitleaks is installed, no secrets in any commit's content;
  - no test weakened (deleted, skipped or focused, cut down, or its snapshot rewritten) without the person's `tests` approval in the log;
  - a fix (a plan story with `**Fixes:**`, or a `<lane>/fix-…` branch) comes with a test that fails without it, as the bug, and passes with it;
  - the project's checks pass.

A project without `.claude/code-kit.json` isn't governed at all. An invalid config fails closed: nothing but the config itself can be written until it's fixed.

## What verify proves, and its limits

When `verify` passes on a branch, you can conclude:

- every file the branch changed is one its lane may write, or is logged under an approval;
- every protected change is in the approval log, and the log was only appended to;
- no import found adds a layer violation, and the baseline didn't grow;
- no test was weakened without the person's `tests` approval, and, on a fix, its tests fail without the fix;
- the project's checks for the changed files ran and passed, apart from any `verify` lists as **not run**: a check whose tool isn't installed where it ran is skipped, and named, unless the check sets `ifMissing: "fail"`, which fails it instead. Set that on every check that matters, and install the project's tools in CI.

It's a check of the branch as it is when it runs, at the commit it names. A merge code-kit makes records that commit, and any checks not run, in the merge commit's message. From the merge queue, it merges exactly the commit the lead's review passed: a branch that moves on after its review leaves the queue to be reviewed again.

Its limits:

- **Guard rails, not a sandbox** ([SECURITY.md](SECURITY.md)). The hooks refuse what they recognise. Shell commands are matched by their text, so a command written to hide what it does can get past a shell rule, and a file a shell command writes is caught after the command, not before. Tools other than Edit, Write, NotebookEdit and Bash, such as an MCP server that writes files, aren't seen by the hooks at all; the finish check and `verify` still see what they changed in git.
- **Layers are pattern-matched.** Imports are found with regular expressions for `import`, `export … from`, `require()` and `import()` with a literal path, in JavaScript and TypeScript files. A computed import isn't seen, and an import written inside a comment or a string can be reported as if it were real. An import resolves to a file through a relative path or `importAliases` only. Anything else, a workspace package's name included, counts as a package, held only by `denyPackages`, so map workspace packages and `tsconfig` paths in `importAliases`.
- **Secrets.** Without gitleaks, only file names are checked (`.env`, `secrets/`, keys and keystores), not what files contain. The CI workflow init installs doesn't install gitleaks; add it if you rely on the scan.
- **The finish check stops after three tries.** When it has reported the same problem three times without progress, it lets the agent finish and says so, for the lead to take up.
- **Review is the lead's judgement.** The workflow's skills have the lead review each branch against its requirements, and the merge queue records the commit it reviewed. What the review looked at isn't recorded. `verify` is the mechanical check, and it runs before every merge code-kit makes.

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
- **On every edit, shell command and finish** in those projects, through Claude Code hooks:

  | Hook                         | Runs                        | Enforces                                                                                                     |
  | ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `PreToolUse` Edit/Write      | `hooks/guard-paths.mjs`     | lanes, protected paths, spec-check and design gates                                                          |
  | `PreToolUse` Bash            | `hooks/guard-bash.mjs`      | shell rules, dependencies, approval log and secret scan on commit                                            |
  | `PostToolUse` Edit/Write     | `hooks/post-edit-check.mjs` | layer rules and the project's `postEdit` commands                                                            |
  | `PostToolUse` Bash           | `hooks/lane-audit.mjs`      | ownership of files a shell command wrote, reported for revert                                                |
  | `PreToolUse` Agent           | `hooks/guard-agent.mjs`     | one agent per lane at a time, across every session                                                           |
  | `Stop`, `SubagentStop`       | `hooks/stop-check.mjs`      | proof before finishing; a lane's finish frees the lane                                                       |
  | `SessionStart`, `SessionEnd` | `hooks/session.mjs`         | the session recorded as the lead or a working session; as it ends, it leads nothing, and its lanes are freed |

- **For the main session and every subagent**, including agents in worktrees under `.claude/worktrees/`.
- **In front of you, in the terminal and the Desktop app,** through the code-kit mod (Claude Code 2.1.287 or later; see [In the session](#in-the-session)). It shows and acts, and never enforces: the hooks above do that everywhere, the mod or not.
- **In CI**, through `code-kit verify` in a GitHub Actions workflow that init can install (`templates/github-workflow.yml`).
- **Locally, with Node 22 or later.** The CLI in `bin/` runs the same rules from a terminal. The rules themselves send nothing over the network. Three features do, and only when you use them: delegated dependency approvals read the package from the npm registry, the team features (`team`, `intend`) talk to GitHub through your `gh`, or to the team provider you configure, and a bug report you send goes to code-kit's GitHub through your `gh`.

## Install

**Requirements:** Claude Code, Node 22 or later, and git. [gitleaks](https://github.com/gitleaks/gitleaks) is optional: when it's installed, every commit gets a secret scan, and `verify` scans every commit on the branch.

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

| The project has                                | `next` runs                                       |
| ---------------------------------------------- | ------------------------------------------------- |
| Nothing                                        | spec-design                                       |
| A spec still being shaped                      | spec-design, picking up where it stopped          |
| A ready spec, existing code, or a draft config | init                                              |
| A companion installed but not set up yet       | its setup (Context Graph's init), before any code |
| Design stories ready                           | design, with you, before their screens are built  |
| Stories finished on their branches             | review, then dispatch                             |
| Stories ready                                  | dispatch                                          |
| Stories being built                            | nothing: it tells you what's running              |
| Everything done                                | a status summary, then offers the next milestone  |

`code-kit next` on the command line shows the same decision without running anything.

## Start from an idea

```text
/code-kit:spec-design a booking app for mobile dog groomers
```

spec-design works an idea into a specification with you before any code exists. It asks the questions that decide the build, a few at a time with a recommended answer, and writes every decision down:

1. **Frame:** the problem, the users, the outcome, the constraints and the non-goals.
2. **Explore:** two or three different shapes of solution, the main user journeys, and the riskiest assumptions. You choose.
3. **Scope:** capability areas, and what the first release has to deliver end to end.
4. **Specify:** one spec per area, with numbered, testable requirements covering data, states, rules, permissions, errors and acceptance criteria, and a short threat model with the security requirements that answer it.
5. **Architecture, principles and plan:** the layers, contracts, recipes for each layer's common additions (they become the lane agents' skills), definition of done, and stories split into lanes, with a design story before the screens of each area that has any.
6. **Check:** every journey maps to requirements and every requirement to a story, with no gaps left as "TBD".

It writes `docs/brief.md` (with the decision log and open questions), `docs/specs/NN-<area>.md`, `docs/architecture.md`, `docs/standards.md`, `docs/principles.md` and `docs/plan.md`. Those are exactly what `/code-kit:init docs/` turns into lanes, layers and standards, and what lanes spec-check against. Run it again to resume where it left off, to change a decision, or to spec a new feature in an existing codebase.

Requirements are headings (`### BOOK-4 Cancel a booking`). Stories are `### ST-12` headings in the plan with `**Lane:**`, `**Requirements:**`, `**Depends on:**` and `**Status:**` lines (`templates/plan.md`). The lane `lead` marks the lead's own stories, such as contracts and spikes, which the lead builds itself instead of dispatching; the lane `design` marks a design story, which the lead designs with you (`/code-kit:design`) before any screen that depends on it is built; `**Requirements:** none` marks a story that delivers no requirement. Those two formats are what the build loop below runs on.

## Set up a project

```text
/code-kit:init docs/
```

- **A new build:** init reads the docs in full: the architecture and layer map, the plan or work split, and the principles. It drafts the rules from them.
- **An existing codebase (brownfield):** the docs can be thin or missing. Init works the layers out from the code: which folders import which, and who works where according to the git history. It also runs each check once and flags any that already fail, so you decide what to do with them.
- **Either way:** you get a draft (`.claude/code-kit.draft.json`), one agent per lane with its project skills (one per recipe, in the same approval), a read-only security reviewer, the design gate for lanes that own screens, a CLAUDE.md section and a list of questions (see [The agents and skills it creates](#the-agents-and-skills-it-creates)). Nothing is enforced until you approve and the draft becomes `.claude/code-kit.json`.

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
│   ├── db-engineer.md
│   └── security-reviewer.md  # reads every sensitive change as an attacker would; owns nothing
└── skills/
    └── new-migration/     # project recipes, only the ones you approve
        └── SKILL.md
CLAUDE.md                  # plus a section telling the lead how the rules work
```

**Who's who.** There are four kinds of actor. The hooks tell the three Claude kinds apart on every call they see; the person works outside them:

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

**How the spec is followed, step by step** (the steps a hook or `verify` enforces are marked):

1. The brief names the story's requirement IDs.
2. The agent runs the spec-check skill and saves a requirement table for its branch.
3. **Enforced:** the path guard blocks any code in its lane until that report exists.
4. The agent's tests name the requirement IDs; `status` lists the requirements no test names.
5. **Enforced:** the stop hook runs the checks before the agent can finish.
6. Review compares the branch with the requirements and the report.
7. **Enforced:** `verify` checks the rules again before merging and in CI.

**The security reviewer** (`.claude/agents/security-reviewer.md`, from `templates/security-reviewer.md`) is a reviewer, not a lane: it owns no paths and checks everyone's work. Init writes it whenever the product handles sign-in, personal data, payments, input from outside or secrets, which is nearly always. It only reads (Read, Grep, Glob, and Bash for `git diff` and the project's audit commands), and the hooks hold it to that like any subagent outside the lanes. spec-design gives each spec a short threat model (what's sensitive, who might attack it, the trust boundaries) and security requirements stories cite. When `code-kit security` says a story's change touches something sensitive, the review runs the agent on the diff against those threat models: it attacks authentication and authorisation, injection (prompt injection too), data exposure, secrets, cryptography, SSRF and redirects, deserialisation, new dependencies and the privacy targets, and grades each finding blocker, concern or nit, with where, the attack and the fix. A blocker sends the branch back like a failing test.

**Project skills** (`.claude/skills/<recipe>/SKILL.md`) are the step-by-step recipes your docs describe, like "add a migration" or "add an endpoint". Init lists the ones it finds and writes them only if you say yes, never as empty stubs. Each is listed in the owning lane agent's "Skills to use". Like the agents, they're kit files: the lead maintains them, and changes are logged.

**Kept in step.** When the project changes (a new app, a new lane, moved folders), re-run `/code-kit:init`. It drafts new agents for new lanes and updates the paths of existing ones, keeping anything written by hand. You see the difference and approve it before anything changes.

## In the session

With Claude Code 2.1.287 or later, code-kit's mod shows the project in the session, in the terminal (VS Code's terminal included) and the Desktop app. Older versions skip it and keep enforcing everything through the hooks. The mod shows and acts; it never enforces. Mods don't draw in the VS Code extension's chat panel, the Agent SDK or `claude -p`, and outside a project with `.claude/code-kit.json` the mod draws nothing.

### The band

The band sits above the prompt. With nothing happening and nothing waiting, it's gone.

- **The mission**, while the build is moving (the lead mid-turn, an agent at work, the loop started):
  - **goal**: the milestone being built and how many of its stories are done;
  - **now**: what the lead is doing and the loop's state, with **Pause** or **Resume**;
  - **next**: the step the loop takes next;
  - **agents**: a line per agent at work, with its current tool and how long since;
  - with Context Graph installed, a line when a lane edited files without understanding them, and only then.
- **you**: what only you can decide, each with the story it's for ("for ST-4 Booking form (BOOK-1)"). **d** ("Why, and what each choice does") opens it as a card in the Decisions tab. Usage and the plan's pause are labelled **note**.
- **The team**, with `team` in the config: only what of the team needs you. Your stale claim (Keep or Release), a claim of yours changing the same files as someone else's, an intent touching what you own or lease (every intent, with Agree and Drop, for the tech lead), and a pull request in a lane you own.

What waits for you there:

- **A held call.** An agent installing a new package, writing or committing a protected file, or a lane changing the kit, where the approval is yours. Rather than stopping the agent, the call waits while the band asks ("web wants to install dayjs · 1:53"). **Approve** opens the confirmation and, once you confirm, the same call runs; **Refuse**, or no answer within `harness.hold.minutes` (2 unless set), refuses it as before. What the lead decides (`approvals.delegate`) is never held for you: the lane asks the lead, which approves it on its merits. Nothing is held under `claude -p` or the SDK, where nobody can answer.
- **Approvals agents asked for.** **Approve…** opens a confirmation with a reason prefilled from the request, which you keep or rewrite. When it isn't clear what it's for, **Ask about it**: the answer comes from a side call over the lead's conversation and code-kit's facts about the request, shown in the pane and never added to the lead's session, and follow-ups carry on the aside. A request waits until it's answered, its file is committed by someone who could, or it's dropped (at most a week); on its card, **Not needed** drops it.
- **Questions from the lead** ("The lead asks: which weather provider?"), asked with `code-kit ask`: what it can't settle and only you can. **Answer…** opens it as a card with each of the lead's options and what it does, and **Something else…** for your own words; your answer is recorded and sent to the lead. A question can hold its story, which then reads `waiting on you`: nothing dispatches or reviews it, and the stories that depend on it wait, until you answer.
- **Your brief's open questions**, each with who decides and what it holds up (from the table's Owner and Blocks columns; one owned by the lead alone isn't yours, and doesn't show). **Answer…** sends your answer to the lead, which records it in the brief's decisions, and **Ask about it** in the answer box explains it first, beside the conversation; **Later** puts one off until the next session.
- **A bug report for code-kit**, with `harness.report.on`, drafted by an agent code-kit got in the way of. It holds only code-kit's own facts (its version, the rule, what it said, the command), with the project's folders and email addresses taken out. **Read it** shows the exact text; **Send** files it on code-kit's GitHub with your own `gh` (a comment, if it's filed already; without `gh`, you get the link to file it); **Discard** drops it.
- **Stories waiting for review**, with the loop off: **Review** asks the lead to run `/code-kit:review` on the branch, and **Merge** runs `verify`, checks included, then merges if it passes. While the loop runs, a lane's finished work is the lead's to review and merge, so it never waits here.
- **Warnings:** a finish check failing in this session, or a story using more than three times the median of the stories finished this session (once three have finished), each with **Lanes** to open the pane; and background agents paused once the plan's 5-hour use passes `harness.background.pauseAtPercent` (80% unless set).

Every decision belongs to the session that raised it: it's shown, asked and answered there, and its answer goes to that session's lead. Another session's band shows only how many wait there ("1 decision in session kim/7f3a91c2, answered there"). Only what's holding work up is a decision: a call Claude Code's own permission check refused (its auto mode, a deny rule) shows in the Lanes pane as that lane's activity, and the lead asks you with `code-kit ask` only if there's no other way. `code-kit decisions` lists this session's.

Each button has a digit: type it in an empty prompt to press it. The band keeps one line per kind ("2 approvals waiting"); the Decisions tab says how many of each kind, then lists a short card for each decision, five at a time (**j** and **k** move), with the selected one in full below.

- **Notifications.** When something new needs you (an approval, a question from the lead, the lead waiting on you, a step or a merge that's yours), code-kit raises a system notification through your notification channel, once per decision, from the session the decision belongs to: "code-kit: the lead asks you". What was already waiting when the session started isn't announced. It needs Claude Code 2.1.301 or later; turn it off with `notify.on`.

### The lead loop

The loop keeps the build moving between your prompts, under `harness.autonomy`. `/code-kit:init` asks you how hands-off you want it. Until you've chosen, its first step waits in the band ("code-kit can keep the build moving between your prompts") with **Keep going**, **Ask each time** and **Off**, and your answer is recorded as your setting.

- **Each step.** Once the lead has finished a turn, with the lead idle and nothing typed in the prompt, the loop asks `code-kit next` and prompts the lead to dispatch the ready stories, review a finished one, or build its own. It never prompts the same step twice while nothing has changed, and never a story an agent is still on: one its lane agent is building, or a reviewer is reviewing, waits until that agent finishes ("waiting: ST-10 is still with its agent").
- **It reads the lead's reply first.** Before prompting again, the loop reads the lead's last reply with a side call over the lead's own conversation. A reply that waits on you (a question, a design to look at, an approval), or a turn you stopped, holds the loop until you answer or speak to the lead: the band says what the lead waits on, and its question is asked in Claude Code's own question dialog. A step the lead didn't take shows in the band as a note, with its reason and **Ask again**.
- **Stories waiting on other work.** When the lead says a story isn't due yet because it waits on work still going (a paired story a lane is building, a rebuild, a check running), the loop parks that story and leaves it out of every step, so a step naming it with others prompts only the others. It wakes when its own branch or state moves, or when a story it waits on (one the lead named, or an unfinished one building on it) changes state; that story's commits along the way don't wake it, nor do other lanes'. A story the lead's turn left exactly where it stood is parked too, whatever the reply said. After 30 minutes with nothing moving, the lead is asked once more.
- **A step that doesn't move.** One the lead was prompted with three times in a row that is still next shows as a note, not a decision: "Merge lead/st-1: still next after 3 prompts to the lead", with **Ask again** if you want it.
- **A lean lead.** A lane writes its full report, with its commands and their output, to `.claude/state/reports/<branch>.md`, and hands the lead a few lines naming it; the stop hook won't let a lane on a story branch finish without it, or with a hand-back of more than ten lines, and the lead reads the file when it reviews. Lanes don't message the lead while they work. When a milestone finishes, the lead's context is compacted before the next one (`harness.compact.milestone`: you're asked by default, or it's done at once): the summary keeps what's in flight and what waits on you, and drops the finished stories' detail.
- **Token use.** A long-lived agent rereads its whole context on every request, which is most of what a build costs. So each lane agent builds one story; one past `agents.lanes.contextLimit` is told to wrap up, and the lead carries its story on with a fresh agent that reads its report (`code-kit worktrees release` frees the branch). The lead's context is compacted between turns once it's past `compact.at`. The loop reads the lead's replies with Sonnet, and the reviewers run on Sonnet by default.
- **Designs.** A design story is handed to the lead once a session; while you and the lead design it, the loop leaves it to you.
- **One session leads.** The loop runs in the project's lead session: the one that started when no other led, or the one you chose with **Lead from here** (or `/code-kit:lead`). See [Several sessions in one project](#several-sessions-in-one-project).
- **Modes.** **Pause** and **Resume** stop and start it. Under `propose`, each step waits for **Go**; under `off`, the loop does nothing. When every story is done, the band says so and the loop stops.
- **Choices in Claude Code's dialog.** A decision you settle by choosing (how hands-off the loop is, a step to take under `propose`, a stale claim, a question from the lead with answers offered) is asked in Claude Code's own question dialog while the lead is idle, once; dismissed, it stays in the band and the Decisions tab. Approvals, send-backs and settings, which need your reason, stay in the pane.
- **Stalled lanes.** A lane agent with no tool call for `harness.stall.nudgeMinutes` (5) is messaged, unless its work is done (it handed back, or its branch is in review or the merge queue). At `stall.restartMinutes` (10) the lead is asked to stop it and dispatch its story again, at most `stall.maxRestarts` (2) times; after that the lead decides how the story goes on (a narrower brief, smaller stories, or handing it back), and the band shows a note.
- **The reviewer agent**, with `harness.agents.reviewer.on`. A finished branch is first reviewed in the background by code-kit's reviewer agent, which the lead starts: it runs `verify` and the review checklist, read-only, and grades each finding blocker, concern or nit. The lead's review prompt then carries the findings, and a blocker means the branch is sent back. The pane shows each review, running with its clock or what it found. If the reviewer hasn't reported within 15 minutes, or the plan's 5-hour use is past `harness.background.pauseAtPercent`, the lead reviews without it.
- **The merge queue** (`code-kit queue`). A branch the lead's review passes joins the queue. Branches merge one at a time, in the order they passed, each verified against the base as it is then: the lead merges where `approvals.delegate.merge` is on under `autonomous`, otherwise the band shows the head with **Merge** for you. Who may merge is read from the config committed on the base, so a branch can't grant itself merges. The queue records the commit each review passed, and merges exactly that commit: a branch that moves on after its review leaves the queue (`moved`) for the lead to review it again. A head that conflicts or fails verify goes back to its lane. A merged lane's worktree is removed when it holds nothing uncommitted. The pane lists the queue, and lanes whose branch waits in it read `queued`.
- **The first merge.** There's none for you: setting up commits the rules you approved straight onto the base, and in a project set up before that, the lead puts them there itself (`code-kit queue rules`) before its first merge.

### The Lanes pane

**`/lanes`** opens it; `/lanes` again, or Escape, closes it. It stays current within 2 seconds of a commit, a branch change, a plan edit or an agent starting or stopping. Inline (when the terminal can't dock it beside the transcript), it shows the counts, what needs you and a line per lane.

- **The top.** A count of the stories by state (building, in review, queued, sent back, blocked, ready, merged), with the loop's state and the plan's 5-hour use; press a count to show only those lanes. Beneath it, whatever needs you (held calls, approvals, reviews, merges, stalled lanes, outliers) is pinned with its key.
- **Tabs, on 1 to 7:**
  - **Lanes**: the loop as a card (its mode, the steps it took, the one running and the next), then each lane on fixed columns: its name, state and story, its agent's current or last tool call with the time since beneath (amber once quiet, red when stalled), and its tokens; the lead reads orchestrating while its turn runs. Each lane has its own small pixel character, tinted in the lane's colour, whose pose shows its state: working (animated while its agent works), waiting on you, quiet, stalled, done or resting; the lead's wears a crown. Under each lane, its story's timeline on a shared time axis: building, then in review, with send-backs (↩), approvals (◆) and the merge (✓) marked where they fell. A selected lane shows its stories as cards (state, requirements, what each waits on or its branch), then its agent and the paths it owns.
  - **Decisions**: each decision that needs you as a card: what you asked for, the story and its requirements, what was happening, what's already settled, why the lead couldn't settle it, and each option with what it does.
  - **Journal**: the build from your request to now in plain sentences, by day: the request and the decisions in the brief, the specification, each story handed out, sent back and merged, each approval and who gave it, each milestone finished, and the loop's steps this session, yours in yellow.
  - **Code map**: the whole project's folders by layer when no story is at work, or a story's files in a column per layer with the imports between them. A file fills with a lane's colour while that lane reads or edits it, and says whether its why (its Context Graph card) is written, out of date or not written yet. **j**/**k** select a file to see its card and what it imports and what imports it, and **o** opens it in Context Graph (box-drawing text in the terminal, an SVG on Desktop).
  - **Trail**: every requirement in the specs as a cell by spec, its glyph and colour saying whether it's done and tested, done but untested, in progress, todo, without a story or removed, with a legend counting each. **h**/**l** and **j**/**k** move between cells and specs (or pick one from the list), showing the requirement's stories, their branches, the code they changed and the tests that name it. Beneath the cells, the spec's trail drawn as a flow, each requirement to its stories, code and tests, with a missing link dashed in red.
  - **Queue**: the merge queue.
  - **Usage**.
- **Keys.** **j** and **k** move between lanes, and the selected lane's acts are on **a** (approve), **r** (review), **s** (send back, with your reason), **m** (merge), **w** (watch: its agent's own transcript in the main view, on Claude Code 2.1.301 or later; the tasks list brings the conversation back), **n** (nudge its agent) and **x** (stop it); **p** pauses or resumes the loop, and **f** filters the lanes by name, agent or story.
- **A story.** **Enter** (or **o**) opens the selected lane's story: its requirements beside its spec-check report, the reviewer's findings by severity (each a way into the diff), `verify`'s problems, its usage and loop steps, and its diff against the base, file by file, with the acts its state allows. **b** or Escape goes back to the lanes.

### Other views

- **Refusals** a code-kit hook gives an agent are drawn as cards: what was refused, the rule, what to do, and Approve… where your approval would allow it. The full text is a press away.
- **`/harness`** opens the harness settings: how the lead loop acts, how long a call waiting on your approval is held, when a stalled lane is nudged and restarted, the reviewer agent and its model, the lane agents' model, the use at which background agents pause, and whether agents draft bug reports for code-kit. Changing one asks your reason, writes `.claude/code-kit.json` and logs a `kit` approval. Lanes, paths and rules still change through `/code-kit:init`.
- **`/approvals`** lists the approvals waiting (one per approval and lane, with every file it covers), the approvals in force with minutes left, and every approval given, newest first: who gave it (you, or the lead within your delegated rules), its reason, and the files and branches it covered, merged or not. A request stops waiting once an approval is given for it, or its file is committed by someone who could; a read-only agent such as the reviewer never asks.
- **`/verify-branch`** runs `code-kit verify` on this branch. Neither it nor `/approvals` calls the model.

Approving from the band records `(approved in the code-kit pane)` with your reason, and a merge from it says it was merged by the person from the pane. A settings change is logged as made in the pane. These happen only on your press: the hooks refuse `approve --via pane`, `merge --person` and `settings set` from every agent.

## Build

Once init has switched the rules on, the lead runs the build in a loop:

```text
/code-kit:dispatch next      # start every ready story on its lane
/code-kit:decide             # decide what lanes asked for: approve, offer something better, or bring it to you
/code-kit:review ST-12       # check a finished branch, then merge or send it back
/code-kit:status             # where the build stands against the spec
```

- **Dispatch** picks the stories whose dependencies are done, one per lane: a lane runs one story at a time across the whole project, and the open slice's stories go first (a story's `**Slice:**`, the feature it's part of; `harness.slices.open`). It checks that no open question blocks them and that their contracts exist, then starts each lane agent in its own worktree on the branch `<lane>/st-<n>`, every free lane in parallel. A second agent for a lane that's running one is refused. Each brief names the story's requirements and acceptance criteria. Lanes spec-check first, build end to end, name requirement IDs in their test titles, and commit.
- **Decide** takes what a lane asked for and couldn't do itself: a package, a migration, a protected file, a UX question. The lead judges it against the story's requirements, the spec, the principles and the architecture, and approves it, tells the lane what to use instead, or brings it to you when it crosses a guardrail. See [Who decides what](#who-decides-what).
- **Review** runs `verify` on the branch, then checks each requirement: built end to end, proved by a test, matching the spec-check report, and nothing beyond the story. It ends with merge, send back with the list of problems, or a question for you.
- **Status** traces every requirement to its story, branch and tests. It shows what's done, in review, ready and blocked, which requirements no test names, and where the plan's status lines are out of date.

## Several sessions in one project

You can open several Claude Code sessions in one project: one building the plan, others auditing, checking merges or looking into something ad hoc. code-kit treats each session as a member of the team, as it treats each developer in a team:

- **One lead session.** The loop runs there, and the plan's stories are dispatched from it. The first session to start leads; one started while it's open is a working session. When the lead session ends, no other takes over by itself: the next session to start leads, or you choose one with **Lead from here** or `/code-kit:lead`. `code-kit who` says which this session is.
- **Working sessions stay quiet.** Their band shows only their own: their refusals and held calls, their lead's questions, their task. No loop prompts, no other session's decisions, dialogs or notifications. Every rule still applies.
- **Ad hoc work records a task.** A working session records what it's doing before it changes code, with the paths it'll change: `code-kit task "Integration readiness" --touches "src/integrations/**"`. The task leases those paths: another session's agents writing there are refused, naming the session and its task. `code-kit sessions` lists the sessions and their tasks; `task done` ends one, and `task take <session>` moves a task whose session ended to yours.
- **Each in its own worktree.** A working session that changes code works in a worktree of its own (`claude --worktree`); its writes in the main checkout are refused, so its uncommitted files never block another session's git. Where git does refuse because of another session's uncommitted files, code-kit says whose they are.
- **One story per lane, across every session.** A lane runs one story at a time, whichever session started it (`code-kit lanes`).

Spec: `docs/specs/23-the-team.md`.

## Teams (preview)

For several people in one repository, each with their own agents. Not every developer works in a team, so it's off until you set it up: `/code-kit:init` asks whether others work in the repository, and `/code-kit:team-init` sets the team up (or changes it, or takes it out) at any time, asking for the tech lead and each lane's owners and showing what it writes first. Everything goes through GitHub; there's no server:

- **Owners and claims.** A lane's owners are the only ones whose agents work it. Making a story's branch claims the story, through a ref in the shared repository, so two people can't both take it. The lead says what files the story will change (`team claim --lease`), and each commit adds what it changed; another person's agent editing a leased file is refused with who holds it.
- **The tech lead's paths.** Only the tech lead's sessions change the plan, specs and contracts. Anyone else raises an **intent** (`code-kit intend`), a discussion in the repository's Intents category, before any code. The tech lead agrees, drops or marks it a duplicate; an agreed one becomes a numbered decision record (`code-kit intend record`) through a pull request, where every agent reads it.
- **Since you last looked.** `code-kit team since` says, by person, what was pushed, opened, merged, reviewed, claimed and intended. The Team pane shows it.
- **`/team`** opens the Team pane: the tech lead, who you are, and what coordinates the team (GitHub, or a hosted provider, and whether it's live). Its tabs: **People**, each person with their lanes, where they're at work (with a live provider), claims, pull requests and intents; **Since you looked**; **Claims**, with Keep and Release on yours, and Release and Reassign for the tech lead; **Intents**, with Agree and Drop for the tech lead; **Drift**, when the provider checks for it; and **Setup**, the team's config and what GitHub still needs.
- **Stale claims** (nothing pushed for three working days) are flagged, never released on their own: the holder keeps or releases it, and the tech lead can reassign it.
- **GitHub does its part.** `code-kit team codeowners --write` writes CODEOWNERS from the config, and `"board": { "owner", "number" }` mirrors the plan onto a GitHub Project.

It's a preview: it's tested end to end against a stand-in for GitHub, and has been run once against a real private repository (claims, leases, intents as discussions, decision records, since-you-last-looked and the Project board). Spec: `docs/specs/16-teams.md`.

## Enforce it in CI

The hooks only see Claude Code sessions. For everything else, init offers `.github/workflows/code-kit.yml` (from `templates/github-workflow.yml`). It runs `verify` on every pull request, through `npx @warren-dean/code-kit@<version>`, pinned so CI doesn't change under you. It needs no secret. Two settings to make: mark the `code-kit` check as required on the protected branches, and make sure the workflow installs what the project's checks run, since a check whose tool is missing is skipped, and listed as not run, unless it sets `ifMissing: "fail"`. Add gitleaks to the workflow for the secret scan of commits' content.

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

code-kit's own instructions to your agents, its section of CLAUDE.md and each lane agent's `Always:` rules, are kept between markers and rendered from your config, so a newer code-kit can bring them up to date without touching anything you wrote around them. `code-kit instructions` says where each stands, and `--write` updates them. When they're behind, `code-kit next` says so before any other step and the loop asks the lead to update them. A setup from before the markers is merged once, by the lead, keeping your own lines.

## The CLI

Run from the project root, as `code-kit <command>` once installed (`npm i -g @warren-dean/code-kit`), or `npx @warren-dean/code-kit <command>`. Add `--config .claude/code-kit.draft.json` to any command to read a draft instead. In a session, the `/code-kit:check` skill runs `check` and `unowned` for you. `next` also works in a project without code-kit, or outside a git repository.

```bash
code-kit check [--json]     # validate and summarise
code-kit who <path>...      # owner and layer of each path
code-kit unowned            # tracked files nobody may write
code-kit diff --config .claude/code-kit.draft.json  # what a draft changes
code-kit baseline [--write] # layer violations in the code as it is
code-kit graph [--depth N]  # which folders import which
code-kit verify [--base ref] [--branch name] [--no-checks] [--json]  # a branch's changes, for CI and review
code-kit security [--base ref] [--branch name] [--json]  # whether a branch needs the security review, and why: sign-in, permissions, outside input, personal data, payments, secrets, dependencies
code-kit status [--base ref] [--json]  # stories and requirements against the spec
code-kit next [--base ref] [--json]    # the step to take now, from the project's state
code-kit worktrees [--json] | worktrees release <branch> | worktrees prune [--quiet]  # the project's worktrees and why each stays; free one for a fresh agent on its story, or remove every one that's done with, keeping their reports (also after each merge and as a session starts)
code-kit worktrees discard <branch>  # the person's, from the band: remove a merged worktree that still holds changes, kept as a patch
code-kit instructions [--write] [--json] | instructions show lead|lane [<lane>]  # code-kit's part of CLAUDE.md and the lane agents: where each stands, brought up to date, or printed
code-kit standards [--json] [--for <path>...]  # the project's standards with any its organisation's provider supplies, and what's wrong with them; --for keeps the ones for those files' layers
code-kit trace <path>... [--json]      # what a file is for: requirements, lane, layer rules
code-kit merge <branch> --delegated|--person [--into branch]  # merge a branch that passes verify: the lead where approvals.delegate.merge is on, or the person
code-kit requests [--json]                                   # approval requests still waiting, numbered, each the lead's or the person's to decide, the approvals in force, and every approval given
code-kit requests drop <n>[,<n>…]|all [--reason "…"]         # stop waiting on requests nobody needs answered (the lead, or Not needed in the pane)
code-kit ask "<question>" [--story ST-n] [--blocks] [--why "…"] [--option "Label: what it does"]...   # the lead asks you what it can't settle; it waits in your Decisions tab
code-kit ask [--json] | ask answer <id> "<answer>" | ask withdraw <id> --reason "…"   # the questions; your answer (given in chat, recorded by the lead); one settled another way
code-kit report "<title>" --what "…" [--expected …] [--command …] [--refusal …] [--rule …]   # with harness.report.on, an agent drafts a bug report for code-kit
code-kit report [--json] | report send|discard <id>          # the drafts; sending files it on code-kit's GitHub with your gh, which only you do
code-kit stops [--session id] [--json]                       # finish checks that refused an agent's last stop and still fail
code-kit sent-back <branch> [--reason "…"]                    # record a review's send-back: status shows the story as sent back until the branch moves on
code-kit decisions [--json] [--all]                          # what waits on you in this session, and a count in each other one; --all lists every session's
code-kit who                                                 # which session this is, whether it leads the project, and its task
code-kit sessions [--json]                                   # the sessions working the project, which one leads, and each one's task
code-kit sessions lead                                       # make this session the lead (the person's own act, as Lead from here)
code-kit task "<what>" --touches "<globs>"                    # a working session's ad hoc task, leasing the paths it changes; task done ends it, task take <session> moves a stale one here
code-kit lanes [--json]                                      # what each lane is running now, one story each across every session
code-kit lanes release <lane>                                # free a lane whose agent stopped without finishing
code-kit settings [--json]                                   # the harness settings in force, with their defaults, and who decides each approval
code-kit settings set <key> <value> --reason "…"               # change one, as the person (approvals.<name> lead|person among them): written to the config and logged as a kit approval
code-kit queue [--json]                                      # the merge queue: branches whose review passed, in order
code-kit queue add|drop <branch>                              # the lead queues a branch at the commit its review passed, or takes it out
code-kit queue rules                                          # the lead puts the approved rules onto a base that has none yet (a project set up before 0.8.0)
code-kit queue merge --delegated|--person                     # merge the head at the commit its review passed, verified against the base as it is now; a conflict or failed verify sends it back to its lane, and a branch that moved since its review leaves the queue to be reviewed again
code-kit loop [--json]                                        # whether the person paused the lead loop; other tools' background work pauses with it
code-kit loop pause|resume                                    # the person's act, as Pause and Resume in the band
code-kit loop lead|release --session <id> [--take]            # which session runs the loop: the mod's, and Lead from here in the band
code-kit story <id> [--json]                                  # one story's requirements, spec-check report, diff against the base and verify (without checks), for the drill-down
code-kit timeline [--json]                                    # when each story's work happened: its branch made, last commit, merge, send-backs and approvals
code-kit journal [--json]                                     # the build's lineage: the request, its decisions, the spec, each story handed out, sent back and merged, each approval and who gave it
code-kit team [--json] [--fresh]                              # the team (preview): tech lead, owners, claims, intents and open pull requests (spec 16)
code-kit team since [--json] [--peek]                         # what everyone pushed, opened, merged, reviewed, claimed and intended since you last looked
code-kit team init --tech-lead <handle> [--owner <lane>=<handles>] [--stale-days n] [--intents category] [--write] | team init --off [--write]   # show, then write, the team's setup; or make the project one developer's again
code-kit team claim <story> [--lease globs] | team release <story>   # claim a story for yourself, leasing what it changes; release it (yours, or any as the tech lead)
code-kit team keep <story> | team reassign <story> <handle>   # keep your stale claim (its clock starts again); the tech lead hands a claim to someone else
code-kit team codeowners [--write]                            # .github/CODEOWNERS from the config: the tech lead for their paths, each lane's owners for its paths
code-kit team board                                           # mirror the plan onto the team's GitHub Project: each story with Lane, Claimed by, Stale and State
code-kit team report [--dry-run] [--json]                     # report the project's facts to the team provider; --dry-run prints exactly what would be sent (spec 21)
code-kit team provider signin|signout|status|connect          # a hosted team provider the config names (preview): sign this machine in, connect the repository
code-kit team pulse --session <id>                            # used by the mod with a hosted provider: the session's agents and token use, on stdin, and the report when something changed
code-kit intend "<what and why>" [--touches globs]            # raise a change of direction before any code, as a discussion in the repository's Intents category
code-kit intend agree|drop|duplicate <id> [--reason "…"]     # the tech lead's answer, from their terminal or the pane
code-kit intend record <id>                                   # write an agreed intent as a numbered decision record in docs.decisions, for a pull request
code-kit map <story>|project [--json]                                 # a story's code: its files by layer, the imports between them, and what adapters know of each
code-kit trail [--json]                                       # each requirement to its stories, the code they changed and the tests that name it
code-kit adapters [--json --session id]                       # the adapters in use; with --json, what they know of each lane's work in a session
code-kit hold <id> [--minutes N]                              # used by the mod: a held call waits here for the band's answer (--answer approved|refused)
code-kit approve <name>... --reason "…" [--lane name] [--delegated [--story ST-n] | --via pane|<tool>]  # record a person's approval from chat, or (--delegated) the lead's own, for a story (a package needs --story); a package name stands for its dep- approval
```

`verify` compares the branch with where it left `--base` (default `origin/main`, then `main`). A branch named `<lane>/…`, or given as `--branch`, is held to that lane. `--no-checks` leaves the project's checks to CI's own steps. `status` reads `docs.specs` and `docs.plan`.

## Config

`.claude/code-kit.json`. Globs use `*` (one segment), `**` (any depth), `**/` (zero or more folders), `?` and `{a,b}`. Patterns under `shell` are regular expressions.

| Field                          | Required          | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`                      | yes               | `1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs.specs`                   | no                | Folder of specs. With it, a lane needs a spec-check report before writing code on a branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs.principles`, `docs.plan` | no                | The engineering principles and the implementation plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs.decisions`               | no                | Where agreed intents are recorded as numbered decision records (`code-kit intend record`); default `docs/decisions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs.standards`               | no                | The project's standards (spec 22), default `docs/standards.md`: each a `### <id> <title>` heading with `level` (required or recommended), `applied` (enforced, checked or advice), `layers`, `why`, `source` and, when enforced, `enforced by` naming the layer rule, protected path, check or shell rule that refuses a breach. The id's prefix is its category: `PRI-` principles, `PAT-` patterns, `ARC-` architecture, `CON-` conventions, `POL-` policies. Each lane agent is given the ones for its layers; a refusal from an enforcing rule names the standard; reviews check the checked ones. Protect the file with the `standards` approval: removing a standard, or weakening a required one, always needs the person's, whatever is delegated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lead.paths`                   | yes               | What the main session writes. `.claude/**` is always added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `lead.outside`                 | no                | Paths outside the repository the lead may write, e.g. `../shared-lib/**`. Claude's memory and scratchpad are always included.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `anyActor`                     | no                | Paths every writer may change (e.g. the lockfile), read-only agents included. `.claude/state/**` is always included. An entry may be `{ "glob", "reviewer" }` to name the lane (or `"lead"`) that reviews changes to it; otherwise the lead reviews them, and `who` and `trace` say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lanes.<name>`                 | yes (may be `{}`) | `{ agent, paths, exclude?, owners? }`: the agent name maps a subagent to its lane; `owners` (GitHub handles) are the people whose sessions work it, in a team (needs `team`). A worktree with a `.lane` file holding the lane name makes the main session that lane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `protected[]`                  | no                | `{ glob, approval, why }`: logged on every commit. Anyone but the lead needs an approval: the lead's where `approvals.delegate.protected` names it, otherwise a person's (see [Approvals](#approvals)). `.claude/**` is always protected as `kit`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `designGate`                   | no                | `{ register, screens: [{ glob, not? }], howTo }`: screen files wait until the register (`{ "screens": [{ "file": … }] }`) lists them. Init sets it for every lane that owns screens; `/code-kit:design` adds approved designs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `layers[]`                     | no                | `{ name, paths, mayImport, denyPackages? }`: the first layer whose paths match a file owns it. A layer may always import itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `importAliases`                | no                | `{ "@app/domain": "packages/domain/src" }`: resolves non-relative imports to repository paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `shell.block[]`                | no                | `{ pattern, why, person?, command? }`: never run. `person: true` marks a person's act, which the lead may do for them with `approvals.lead` on. `command: true` matches the pattern from the start of each command the line runs, so a heredoc or quoted text that mentions it isn't refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `shell.restricted[]`           | no                | `{ pattern, lanes, why }`: only the lead and these lanes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `postEdit[]`                   | no                | `{ files, exclude?, run }`: after each edit of a matching file. `{file}` is the file. Exit 127 (tool not installed) is skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests[]`                      | no                | Globs naming the test files, for the weakened-test and fix rules. Default: the usual conventions (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `tests/`, `e2e/`, `*_test.go`, `test_*.py`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `regression.prepare`           | no                | A command run in a fresh checkout before a fix's tests run there without the fix, such as `npm ci`. Without it, the checkout's `node_modules` and virtualenvs are linked in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `checks[]`                     | no                | `{ name, files, exclude?, run[], each?, owners?, ifMissing?, timeoutSeconds? }`: before finishing, when matching files changed. `each` runs the commands in every changed folder matching that glob. `owners` limits who may change the files (the lead always may). `ifMissing: "fail"` makes a missing tool an error (the default is to skip the check, which `verify` and a merge list as not run).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `adapters`                     | no                | `{ "<adapter>": false }` switches off an adapter that would otherwise be detected; `true` says the project wants that tool, so until it's set up here `next` gives its setup before any code. See [Adapters](#adapters).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `approvals.lead`               | no                | `true` lets the lead act on what the person says in chat, for when `!` isn't available (on a phone, say): it records their approvals with `code-kit approve`, and runs `shell.block` commands marked `person`. Default `false`. See [Approvals](#approvals).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `approvals.delegate`           | no                | `false`, or `{ protected?: [approval names], merge?: true, tests?: true, dependencies?: { licences?, minWeeklyDownloads?, maxMonthsSinceRelease?, allowInstallScripts?: true \| false \| [kinds] } }`: what the lead decides, inside the guardrails you keep: the protected approvals it grants, and packages it approves for a story, with `code-kit approve --delegated`; with `merge`, merges into a protected branch with `code-kit merge --delegated`; with `tests`, weakened tests on a lane's branch. Left out, the lead decides everything technical: every protected approval but `spec`, `design`, `ci` and `kit`, packages, merges and weakened tests (WHO-1); `false` keeps everything for you. Lanes ask the lead for these, never you. npm packages are also checked against the registry; the defaults are MIT, Apache-2.0, BSD and ISC, 10,000 weekly downloads, a release within 18 months, and no install scripts. See [Approvals](#approvals).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `setup`                        | no                | The version of init's setup the project has (3 now). Without it, or lower, `next` names what the project is missing (the design gate, design stories before screens, a QA lane, a security reviewer) and starts no new story until re-running init adds it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `team`                         | no                | Preview. For several people in one repository: `{ techLead, staleDays?, intents?, board?, provider?, report? }`. `techLead` is the GitHub handle of the person who owns the plan, specs and contracts; `staleDays` is how many working days without a push make a claim stale (default 3); `intents` is the discussion category intents go in (default `Intents`; create it once in the repository's Settings › Discussions); `board` is `{ owner, number }`, a GitHub Project the plan is mirrored onto; `provider` is `"github"` (default), `{ command, fallback? }` for another team provider, or, in preview, a hosted provider's adapter as `{ "<name>": "<https address>" }`, which keeps the intents (Discussions only when `intents` is set) and has GitHub as its fallback; with `fallback: "github"`, claims go through GitHub whenever that provider can't be reached; `report` (default true) is whether the project reports its facts (stories' stages, send-backs, the requirement trail, approvals, token use and the rules; never code) to a provider that isn't GitHub. A provider may also supply an organisation's standards (`standards`, answering `{ standards, waivers, version }`, each standard in `docs.standards`' fields, each waiver `{ standard, paths?, expires?, reason?, approvedBy? }`): they apply as if in the project's file, which may extend or tighten one but weaken a required one only under a waiver. See docs/specs/16-teams.md, docs/specs/21-hub-adapter-and-reports.md and docs/specs/22-standards.md. |
| `branches.protected`           | no                | Default `["main", "master"]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `harness`                      | no                | What the mod's harness does in the session: `autonomy` (`autonomous`, `propose` or `off`; default `autonomous`), `hold.minutes` (how long a call waiting on your approval is held, 0 to 10; default 2), `stall.nudgeMinutes` and `stall.restartMinutes` (default 5 and 10), `stall.maxRestarts` (default 2), `agents.reviewer.on` (default `false`) and `agents.reviewer.model` (code-kit's reviewer and the security reviewer; default `sonnet`), `agents.lanes.model` (the model each lane agent starts on, unless the lead's call or the lane's agent file names one; default the session's), `slices.open` (how many of the plan's slices are in focus: a free lane builds an open slice's stories first; default 1), `background.pauseAtPercent` (default 80), `compact.at` (compact the lead's context between turns once it's past this share of its window; default 40, 0 for never), `compact.milestone` (when a milestone finishes, compact the lead's context: `ask`, `auto` or `off`; default `ask`), `agents.lanes.contextLimit` (the context a lane agent may reach before it hands its story to a fresh agent; default 250,000 tokens), `notify.on` (a system notification when something new needs you; default `true`) and `report.on` (agents draft bug reports for code-kit, which you send or discard; default `false`). Change them with `/harness` or `code-kit settings set`.                                                                                                                                                   |

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
- **Tests:** a commit that weakens a test needs `tests`, used up by the commit, which logs it with what was weakened. On a lane's branch the lead approves it after reviewing the change, where tests are delegated (the default): `code-kit approve tests --lane web --delegated --story ST-9 --reason "the keeps-order case tested the old sort"`. On the lead's own branches, and where tests aren't delegated, it's the person's: `echo "The keeps-order test is wrong until ST-9" > .claude/approvals/web/tests`.
- **Lifetime:** 60 minutes; a dependency approval (`dep-…`) lasts until the lane commits the install it allows, at most 7 days, since a story may resume hours later.
- **Agents can't write them.** An edit to an approval or the log is refused, and so is any agent shell command that names them. Like every shell rule, that's a match on the command's text.

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

### Requests

Every refusal that an approval would allow is recorded as a request in `.claude/state/requests.jsonl` in the main checkout: who was refused, the approvals that would allow it, the command or file, and why. A request stays open until approvals for all its names answer it, its file is committed by someone who could, or it's dropped (`code-kit requests drop`), and at most a week. `code-kit requests` lists the open ones, numbered, and the approvals in force, with minutes left. The code-kit mod shows the person's own above the prompt; the lead decides the rest (`code-kit next` hands them to it as `decide`).

`--via pane` and `merge --person` are the person's own acts, which the code-kit mod uses for a press in its pane. The hooks refuse both from every agent.

### Who decides what

You're the product owner: you set the guardrails and decide what crosses them, which is the specs, the screens' visual design, CI and the pipelines, the kit, product questions the spec doesn't answer, and anything with production, cost or strategy implications. The lead is the technical lead and decides everything technical. With no `approvals.delegate`, that's the default: the lead approves packages within the registry rules, every protected change but `spec`, `design`, `ci` and `kit`, merges into the base (merging isn't releasing; your pipelines decide what reaches production), and weakened tests on a lane's branch after its review. `approvals.delegate` draws the line differently where you want it to: what it names is the lead's, the rest is yours, and `false` keeps everything for you. Change it in the Settings tab's Approvals section, or `code-kit settings set approvals.<name> lead|person --reason "…"`.

```json
"approvals": { "delegate": { "protected": ["schema", "truth"], "dependencies": {} } }
```

A lane asks the lead, never you. When a lane is refused something the lead decides, the refusal says so, with no `!` command, and the lane hands the lead a change request and stops: what it needs, the story and requirement, and what it checked first. The call isn't held and nothing reaches your band. `code-kit next` hands the waiting requests to the lead (`decide`), and `/code-kit:decide` judges each on its merits: approve it for the story, tell the lane what to use instead, or bring it to you when it crosses a guardrail, with a recommendation.

```bash
code-kit approve pillow --lane api --delegated --story ST-138 --reason "MED-5 needs HEIC decoding; nothing installed reads HEIC"
```

- **Protected approvals:** the lead may grant those named in `protected`, and no others.
- **Dependencies:** approved for a story, with `--story`: the lead approves a package only when the story's requirements need it, nothing the project already depends on does the job, and it fits the principles and the lane's layer. An npm package must also pass the registry rules: its licence must be in `licences`; it must have at least `minWeeklyDownloads` downloads last week and a release within `maxMonthsSinceRelease` months; and installing it must run no scripts, unless `allowInstallScripts` allows them: `true` for any, or a list of the kinds allowed, such as `["binary"]` for packages that only download a prebuilt binary for the platform (esbuild, sharp). The kinds are `binary`, `build` (compiles native code with node-gyp) and `other` (runs the package's own code). A package from another ecosystem (pip, uv, Poetry, cargo, go, bundler) is the lead's judgement alone.
- **All or nothing:** if any name is outside the rules, nothing is approved, and the command says which rule each one broke.
- **The record:** the approval reads `(approved by the lead within the delegated rules: <rule>)` after the reason. The approval log keeps it when the change is committed.
- **Who:** only the lead. With `"approvals": { "delegate": false }`, `--delegated` is refused, and every approval is yours.
- **Weakened tests:** with `"tests": true` (the default), the lead approves a weakened test on a lane's branch for the story it reviewed, with `--lane` and `--story`; on its own branches it's yours.
- **Merges:** with `"merge": true`, the lead merges a reviewed branch into a protected branch with `code-kit merge <branch> --delegated`.
  - It runs `code-kit verify` on the branch first, checks included, and merges only if it passes. The checks run where the branch is checked out; in a temporary worktree without the project's install, checks that need one fail rather than being skipped.
  - The merge commit says it was verified and delegated.
  - Committing or merging on a protected branch with git stays blocked for every actor, the lead included, as does switching to one and committing in the same command.

## Adapters

Other tools share a project with code-kit and keep files of their own. An adapter tells code-kit about one such tool, without the core knowing its name. Each adapter lives in `hooks/lib/adapters/`, and declares:

- how to detect the tool;
- what the tool adds to the rules: paths for the lead, paths any actor may write, protected paths, blocked commands;
- the setup init should apply;
- what the tool knows of the lanes' work, for the Lanes pane (its `facts`).

While the tool is detected, its additions are merged into the effective config, like the kit's own defaults. Run `code-kit adapters` to see them, or switch one off with `"adapters": { "<name>": false }`.

| Adapter         | Detected by | Adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context-graph` | `.ctx/`     | `.ctx/**` for the lead. `.ctx/decisions.ctx` and `.ctx/cards.ctx` for any actor, since every agent records decisions and file cards. `graph.ctx` and `config.toml` are protected (approval `ctx`). No Claude actor may write a person's `Ctx-Ratified-By` trailer: ratifying is a person's act (with `approvals.lead`, the lead may add it when the person says so in chat). A delegated trailer, `Ctx-Ratified-By: <ratifier> (delegated)`, is the lead's alone, under Context Graph's `[delegate]` rules. `verify` accepts a `graph.ctx` change whose commits carry a person's trailer (`ctx ratify --commit`, `ctx drop --commit`) without an approval-log entry. Changing Context Graph's harness settings (`ctx settings set`) is the person's act too. Agents can't run those commands. With `ctx` on the PATH, the Lanes pane shows each lane's edits made without understanding and the cards it owes, and a story's drill-down lists the files still unread and the rules on its files, agreed and proposed; **v** opens a file in Context Graph's pane (`/graph <path>`). |

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

## Changes

What changed in each release is in [CHANGELOG.md](https://github.com/warrendeanlangeveldt/code-kit/blob/main/CHANGELOG.md), and on [GitHub Releases](https://github.com/warrendeanlangeveldt/code-kit/releases).

## Licence

MIT. See [LICENSE](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
