# Changelog

What changed in each release of code-kit, newest first. Versions follow the plugin manifest and the npm package `@warren-dean/code-kit`. Each release is also on [GitHub Releases](https://github.com/warrendeanlangeveldt/code-kit/releases).

## 0.7.0 (2026-10-10)

The rest of the harness, in the mod (Claude Code 2.1.287 or later), and fixes from building a whole app with it.

**The lead keeps the build moving**

- **The lead loop.** When the lead is idle, the mod prompts it with the next step `code-kit next` reports: dispatch the ready stories, review a finished branch, build the lead's own story, or merge the head of the queue. `harness.autonomy` decides how hands-off it is: `autonomous` takes each step, `propose` offers it in the band with Go, `off` does nothing. Until you choose, `init` asks, and the loop offers its first step with Keep going, Ask each time and Off.
- **A step that doesn't take goes to you.** The lead is prompted with one step at most twice in a row; after that the band offers it ("Merge lead/st-1: still next after 2 prompts. Ask the lead again?").
- **Stalls.** A lane agent with no tool call for `harness.stall.nudgeMinutes` is nudged; at `restartMinutes` the lead stops it and dispatches its story again; after `maxRestarts` the band asks you.
- **Pause and Resume** in the band, and "Milestone done" when every story is.
- **Hold and ask.** A call your approval would allow (a new package, a protected file, a kit edit) waits up to `harness.hold.minutes` while the band asks you, then runs once you approve, or is refused.

**Review and merge**

- **The reviewer agent.** With `harness.agents.reviewer.on`, a read-only agent reviews each finished branch in the background, grades its findings blocker, concern or nit, and the lead's review starts from them. A blocker means the branch goes back.
- **The merge queue.** Branches that pass review merge one at a time, in the order they passed, each verified against the base as it is then. One that conflicts or fails is sent back to its lane. `code-kit queue` lists it, `queue add|drop` changes it, `queue merge --delegated|--person` merges the head.
- **The first merge is yours.** Who may merge is read from the config committed on the base, so before the base has one, `next`, the band and the refusal all say the first merge, which brings code-kit's rules onto it, is yours (Merge in the band, or `code-kit queue merge --person`). After it, the lead merges where the rules delegate it.
- A merged lane's worktree is removed when it holds nothing uncommitted. Its branch is kept.

**What you see**

- **The Lanes pane, redone.** Counts in the header, what needs you with a letter each, tabs for Lanes, Queue, Usage and Map, keys on every action, a pixel character per lane that shows what it's doing, and a timeline of each story's work.
- **The story drill-down:** its requirements, spec-check, review findings, verify, usage, the steps taken and the diff.
- **The traceability map:** every requirement as a cell, by spec, coloured by its state, live.
- **Context Graph in the lanes,** when it's installed: each lane's cards owed, its understanding of the files it edits, and the rules on them.
- New commands: `code-kit story <id>`, `code-kit timeline`, `code-kit hold`, `code-kit queue`.

**Fixes**

- Text a command carries isn't a command: a quoted `echo` that mentions `npm install` adds no dependency, a heredoc or quoted newline doesn't end a command, and a redirect elsewhere in a line isn't a write to the kit.
- A read-only agent (a reviewer, a card writer) is judged by what its own shell command changed, not by the lead's uncommitted work in the checkout it shares. Read-only agents may write the paths any actor may, such as Context Graph's cards and decisions.
- An env file's template (`.env.example`, `.env.local.sample`) isn't treated as a secret.
- Context Graph's settings committed with your `Ctx-Ratified-By` trailer pass verify, as its graph does.
- Refusing a shell command that names the approval log or an approval now says to read it with the Read tool.
- `init` offers `/context-graph:init` when Context Graph is installed but has no graph.
- The mod keeps working in a headless session where the agent list or registration fails.

## 0.6.0 (2026-10-10)

The first parts of the harness, in the mod (Claude Code 2.1.287 or later):

- **Harness settings.** A new `harness` section in `.claude/code-kit.json` holds how the lead loop acts (`autonomy`), how long a call waiting on your approval is held, when a stalled lane is nudged and restarted, the reviewer agent and its model, and the plan use at which background agents pause. `code-kit check` validates it; a wrong value gives way to its default.
- **`code-kit settings`** lists the settings in force; `settings set <key> <value> --reason "…"` changes one, as the person, and logs it as a `kit` approval. Agents are refused.
- **`/harness`** opens the settings in the session. A change asks your reason before anything is written, and the approval log records it as made in the pane.
- **Usage per lane.** The mod counts each model request's tokens against the agent that made it, its story and its lane. The Lanes pane shows tokens per lane and story, the background agents' share, and the plan's 5-hour use as a bar.
- **Outliers in the band:** a story using more than three times the median of the stories finished this session (once three have) is flagged, as "ST-7 has used 3.4× the usual". Nothing is stopped.
- **The background pause:** the band says when the plan's 5-hour use passes `harness.background.pauseAtPercent` (80% unless set). The background agents that will honour it come in a later release.
- **Refusals your approval would allow** (new packages, protected files, kit edits) are recognised, including a commit refused for a protected file, ready for the hold that comes next.
- `code-kit check --json` carries the harness settings in force.

## 0.5.0 (2026-10-07)

Fixes for gaps found running code-kit under an autonomous lead:

- **The Bash guard recognises commands where they run.** A commit message, a heredoc, a quoted `--text` or a grep pattern that mentions `git commit`, `code-kit merge` or switching to `main` no longer trips its rule. Text a command carries, such as a commit trailer or an approval path, is still read whole.
- **A dependency approval lasts until its install is committed,** at most 7 days, instead of 60 minutes, so a story that resumes later isn't refused again. The commit that adds the package uses it up. Other approvals still last 60 minutes.
- **status and next after a send-back:**
  - `code-kit sent-back <branch>` records the commit a review sent back, and the review skill runs it;
  - the story reads as "sent back", and `next` proposes the lane's fix instead of another review, until the branch moves on;
  - a story whose dependency isn't done is blocked on it, even with commits on its branch.
- **verify holds a `lead/…` branch to the lead's paths** for what its own commits change. Lane work merged in after review isn't counted against it.
- **A lane merging its base** no longer needs fresh approvals for what the base already logged, and the ownership audit doesn't ask it to revert the base's changes.
- **A delegated merge follows the target branch's config,** so a branch can't grant itself a merge.
- **init's update keeps project skills in step with the docs' recipes:** a new skill per new recipe, updates, removals, and each skill listed on every lane agent whose paths it touches.
- **verify scans the branch's whole history for secrets:** a secret file committed and deleted again still fails, and gitleaks scans every commit when it's installed.
- **Install scripts are told apart** in the delegated dependency rule: `allowInstallScripts` takes `true`, `false` or the kinds allowed: `binary` (prebuilt binaries, as esbuild and sharp fetch), `build` or `other`.
- **Files any agent may write have a reviewer:** the lead, or a lane named in `{ "glob", "reviewer" }`. `who` and `trace` name it.

## 0.4.1 (2026-10-07)

- **The band keeps other plugins' lines:** code-kit's lines go above whatever else the band holds, such as Context Graph's "N proposals to ratify", instead of replacing it.

## 0.4.0 (2026-10-07)

code-kit in the session: a mod for Claude Code 2.1.287 or later, in the terminal and the Desktop app. Older versions skip it and keep enforcing everything through the hooks, as before. See [In the session](README.md#in-the-session).

- **The band** above the prompt shows what waits for you: approvals agents asked for (**Approve…**, with a reason you keep or rewrite), stories ready for review (**Review**, **Merge**), and a finish check failing. Each has a digit hotkey, and the band is gone when nothing waits.
- **`/lanes`** opens a pane with each lane's agent, story, branch and state, the agents at work, and what's ready. It stays current within 2 seconds of a change.
- **Refusal cards:** a code-kit refusal reads as a card with the rule, what to do, and Approve… where an approval would allow it.
- **`/approvals`** and **`/verify-branch`** print without a model call.
- **New in the CLI:** `code-kit stops` lists finish checks still failing, and `check --json` reports the config's state for the mod.
- A merge from the pane says so in its commit.
- `code-kit` with no command now prints its whole usage.

## 0.3.15 (2026-10-06)

- **`verify` accepts your Context Graph ratifications:** a change to `.ctx/graph.ctx` whose commits all carry your `Ctx-Ratified-By` trailer passes without an approval-log entry. That's what `ctx ratify --commit` and `ctx drop --commit` write from your terminal, where code-kit's hooks don't run to log it. Agents still can't write that trailer, and a delegated trailer still needs the log.

## 0.3.14 (2026-10-06)

- **Context Graph's person acts:** with Context Graph in the project, the hooks refuse `ctx ratify … --commit` and `ctx drop` from every agent, matching Context Graph 0.2.11, which makes both the person's own acts. Only a real command counts; text that mentions one, such as an `echo` or documentation, isn't refused.

## 0.3.13 (2026-10-06)

The command-line groundwork for the coming code-kit mod (`docs/brief.md`), useful on its own:

- **Approval requests:** every refusal that a person's approval would allow is now recorded as a request, once per actor and command. `code-kit requests [--json]` lists the open requests and the approvals in force, with minutes left. A request closes when its approvals are given.
- **`code-kit approve … --via pane`** marks an approval as given in the code-kit pane.
- **`code-kit merge <branch> --person`:** the person merges a branch after `verify` passes, with no delegation needed.
- **Agents:** the hooks refuse `--via` and `--person` from every agent.
- **`code-kit verify --json`** prints the branch, its lane and the problems by group.

## 0.3.12 (2026-10-05)

- **Delegated merges:** with `"approvals": { "delegate": { "merge": true } }`, the lead can merge a reviewed branch into a protected branch with `code-kit merge <branch> --delegated`. This is for an autonomous lead.
  - It runs `code-kit verify` on the branch first, checks included, and merges nothing if verify fails or the branch doesn't merge cleanly.
  - Lanes can never run it.
  - Merging by hand on a protected branch stays blocked for everyone.
- **A hole closed:** a command that switches to a protected branch and then commits, merges, cherry-picks, rebases or reverts (`git switch main && git merge x`) is now refused. Before, the branch was read only before the command ran. Moving a protected branch directly (`git branch -f main`, `git update-ref refs/heads/main`) is refused too.
- **`code-kit unowned`** no longer reports files that any actor may write, such as the lockfile.

## 0.3.11 (2026-10-04)

- **`code-kit verify` and union-merged approval logs:** verify now accepts an approval log that git merged with `merge=union`, as the README recommends.
  - **The problem:** when a lane merged its base after the base had gained log entries, git put the lane's own entries first. verify read that as a rewritten log, and then refused the lane's approved manifest changes too.
  - **Now:** it accepts the log as long as every earlier line is still there, in order. A log whose earlier lines were changed, removed or reordered still fails.

## 0.3.10 (2026-10-04)

- **Delegated ratification trailer:** Context Graph's delegated ratification trailer (`Ctx-Ratified-By: <ratifier> (delegated)`) may be written by the lead only, never by a lane. A person's trailer stays blocked for every agent, as before.
- **Adapters:** they can now add lead-only shell rules (`shell.restricted`) as well as blocked ones.

## 0.3.9 (2026-10-04)

- **Delegated approvals:** with `"approvals": { "delegate": { "protected": [...], "dependencies": {...} } }`, the lead can approve on its own authority with `code-kit approve … --delegated`. This is for a lead that runs without a person watching.
  - **Protected approvals:** only the names you list.
  - **Dependencies:** checked against the npm registry for licence, weekly downloads, recent releases and install scripts.
  - **All or nothing:** anything outside the rules approves nothing, and goes to the person.
  - **The record:** every delegated approval is marked with the rule it used.
- **`code-kit approve` takes package names:** `approve @scope/pkg` now means `dep-@scope+pkg`, where it used to refuse the name.

## 0.3.8 (2026-10-03)

- **Lead stories:** plans can give the lead its own stories (`**Lane:** lead`), such as contracts, foundations and spikes. `code-kit next` hands them to the lead instead of dispatching them, and `status` no longer calls `lead` an unknown lane.
- **Stories with no requirements:** `**Requirements:** none` marks a story that delivers no requirement, such as a spike.
- **The CLI** no longer crashes when its output is piped into `head`.

## 0.3.7 (2026-10-03)

- **Approvals from chat:** with `"approvals": { "lead": true }`, the lead can record an approval you give in chat with `code-kit approve`, for when `!` isn't available, as on a phone. The approval is marked as given in chat. The lead may also run `shell.block` commands marked `person: true` when you say so.

## 0.3.6 (2026-10-02)

- **Companion plugin:** the README, `llms.txt` and the init skill now point to Context Graph. Init mentions it once when it isn't installed, and never installs it unasked.

## 0.3.5 (2026-10-02)

- **Logo and diagram:** the npm package now includes them, and the README shows them on npmjs.com too.

## 0.3.4 (2026-10-02)

- **Dependency approvals:** each new package needs a person's approval (`dep-<package>`), for one lane or for everyone. The approval also covers the manifest and lockfile changes the install makes. The commit hook logs those changes, and `code-kit verify` accepts them.
- **A hole closed:** flags before a package name (`npm install -D lodash`) no longer slip past the guard.
- **Worktrees:** approvals are read from the main checkout, so a lane working in its own worktree sees them.
- **Wording:** the README states the hooks' deliberate limits instead of promising hard guarantees.

## 0.3.3 (2026-10-01)

- **Descriptions:** they now open with what code-kit does for AI coding agents.

## 0.3.2 (2026-10-01)

- **npm:** published as `@warren-dean/code-kit`. CI uses `npx @warren-dean/code-kit verify`.
- **For AI tools:** an `llms.txt` and an `AGENTS.md` describe the plugin.

## 0.3.1 (2026-10-01)

- **Ready to install from a public repository:** MIT licence, a security policy, and install instructions.

## 0.3.0 (2026-09-30)

- **Adapters** for tools that share a project, starting with Context Graph.
- **`code-kit trace`:** reports the requirements, lane and layer of a file.
- **Earlier layer checks:** layer rules are now checked before a write, not just after it.

## 0.2.0 (2026-09-29)

- **From idea to merged code:** the spec-design, dispatch, review, status, verify and next skills, built on the rules from 0.1.0.

## 0.1.0

- **Project rules from `.claude/code-kit.json`:** lanes, layers, protected paths with an approval log, spec-check before code, and proof before finishing, all enforced by hooks.
