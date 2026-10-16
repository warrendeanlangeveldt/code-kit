# Changelog

What changed in each release of code-kit, newest first. Versions follow the plugin manifest and the npm package `@warren-dean/code-kit`. Each release is also on [GitHub Releases](https://github.com/warrendeanlangeveldt/code-kit/releases).

## 0.15.1 (2026-10-16)

Lanes stop less often to wait for you.

- A lane reading `.claude/code-kit.json` with an inline script, such as `python3 -c "json.load(open(...))"`, no longer waits for your approval. The bash guard used to count any Python command that named a kit file as a change to the kit, so each lane that read its spec folders this way filed a kit request and stopped: 11 of one project's 16 approval requests. An inline Python or Node script is now judged by its code, and only one that writes the kit, or whose output is redirected into it, is refused. A Python script run from a file still counts as a change, and the check after each shell call still catches any real write. The spec-check skill tells lanes to open the config with the Read tool.
- A call Claude Code refused that later goes through, the same tool from the same agent (for a shell command, the same command), leaves the band. Before, every refusal stayed in the band until you pressed Done it or Not now, even after a retry had worked, so the band could show calls refused that no longer needed you.

## 0.15.0 (2026-10-16)

The lane agents can run on a cheaper model than the lead.

- `harness.agents.lanes.model` sets the model each lane agent starts on, such as `sonnet`. The mod sets it as the lead dispatches each lane agent, so the lead, the background reviewer and the security reviewer keep your session's model. A model the lead's own call names still wins, and so does a `model:` line in a lane's agent file. Leave the setting out and lane agents start on the session's model, as before.
- `/code-kit:init` asks which model the lanes should use and recommends Sonnet: each lane agent builds one story inside its own paths, and the hooks, `verify` and the lead's review catch what it gets wrong. `/harness` has the setting as a model picker, and `code-kit settings set agents.lanes.model <model>` sets it from the command line.

## 0.14.0 (2026-10-16)

The lead loop stays in one session, listens to the lead before prompting it again, and asks your choices in Claude Code's own question dialog.

- Only one session in a project runs the loop. Opening a second session there, for anything else, used to have code-kit prompt that session's lead too. The first session whose loop acts now holds a lead lease in `.claude/state/loop.json` and renews it while it runs. Any other session leaves its lead alone, and its band says "the loop runs in another session" with Lead from here to move the loop over. A new session also no longer clears a pause the running session made. `code-kit loop lead` and `code-kit loop release` record the lease, and the hooks refuse both to agents.
- The loop reads the lead's last reply before prompting again, with a side call over the lead's own conversation. When the reply waits on you (a question, a design to look at, an approval), or you stopped the lead's turn, nothing more is prompted until you answer or speak to the lead. The band says what the lead is waiting on, and its question is asked in Claude Code's dialog with the answers it offered. A step the lead didn't take waits in the band with the lead's reason and Ask again. Before, the loop kept re-sending the same step and then asked you whether to ask again, without knowing what the lead had said.
- A design story is handed to the lead once a session. While you and the lead design it, the loop leaves it to you instead of prompting the design step again each time a screen is approved.
- Choices are asked in Claude Code's own question dialog while the lead is idle: how hands-off the loop is, a step under `propose`, a repeated or blocked step, a stalled lane, a stale claim, and a question from the lead with answers to pick from. Each is asked once; dismissed, it stays in the band and the Decisions tab. Approvals, send-backs and settings, which need your reason, stay in the pane.
- The card for a step still next after two prompts now says why it's yours (the lead was asked twice and something stopped it), where it used to say you'd asked to approve each step.

## 0.13.0 (2026-10-14)

A fix proves its bug, tests can't be weakened without you, and a passing `verify` says exactly what it covered.

- **A fix proves its bug.** A plan story with a `**Fixes:**` line, or a branch named `<lane>/fix-…`, must come with a test that fails without the fix and passes with it. `verify` runs the fix's tests in a fresh checkout with the fix taken out. A test that fails there only because it calls something the fix adds proves nothing, and `verify` asks for one that goes through the existing code. `regression.prepare` sets what that checkout runs first, such as `npm ci`.
- **Tests aren't weakened without you.** A commit that deletes a test, adds a skip or focus marker, removes cases or assertions, or rewrites a snapshot is refused and held in the band for your `tests` approval. The lead can't give it, and `verify` flags any weakening the approval log doesn't show you approved. A test that's only moved or renamed isn't flagged. `tests` in the config names the test files when the usual conventions don't.
- **Checks that didn't run are named.** A check whose tool isn't installed is listed under "Not run" by `verify` (and as `skipped` in its JSON), and a merge names it in its output and its merge commit. `ifMissing: "fail"` still fails it instead.
- **The merge queue merges the commit its review passed.** `queue add` records the reviewed commit, and `queue merge` verifies and merges exactly that commit. A branch that moves on after its review leaves the queue for the lead to review again.
- **An answer closes its decision at once.** Answering one of the lead's questions, or one in your brief, closes its card straight away. A question's card asks it plainly, with who decides and what it holds up, and the answer box has **Ask about it**. Brief questions owned by the lead alone no longer wait for you.
- **Clearer documentation.** The README says what a passing `verify` proves and where its limits are, and SECURITY.md lists the features that use the network: delegated dependency approvals, teams, and bug reports you send.

## 0.12.2 (2026-10-13)

The Decisions tab is readable, and old package requests stop waiting.

- **Decisions as short cards.** The tab says how many of each kind wait ("10 approvals · 2 questions"), then lists each as a card: its kind, a one-line headline ("Approve fastify, jose, drizzle-orm and 4 more") and who it's for, with commands cut at their first pipe instead of whole scripts. Five show at a time; **j** and **k** move, and the selected one opens in full below.
- **Package requests close once installed.** A request for a package closes once the package is in a committed `package.json`, whoever installed it, so installs already done no longer wait for you.

## 0.12.1 (2026-10-13)

Ask about an approval before you give it.

- **Ask about it, in the Approve pane.** When a request isn't clear, ask what it's for right there. The answer comes from a side call over the lead's conversation and what code-kit knows of the request (what was asked for and for whom, why it was refused, its story, the limits it missed), and it stays in the pane: nothing is added to the lead's session. Follow-ups carry on the conversation. Before the lead has replied, it answers from code-kit's facts alone. Nothing is approved until you press Approve.

## 0.12.0 (2026-10-13)

What only you can decide reaches you, and waits until you answer.

- **Questions from the lead.** What the lead can't settle itself (a product choice, an account only you can create, wording only you can sign off) is asked with `code-kit ask`, and waits in the Decisions tab with the lead's options and what each does. Your answer, a press or your own words, is sent to the lead. A question can hold its story, which reads "waiting on you": nothing dispatches or reviews it, and the stories that depend on it wait, until you answer.
- **Your brief's open questions** are decisions too, each with **Answer…** (the lead records it in the brief) and **Later**.
- **What Claude Code itself refused.** A call Claude Code's own permission check refused, which code-kit can't approve past, waits in the band with **Put it in the prompt** (the command after `!`, for you to run), **Done it** and **Not now**.
- **Approval requests wait until answered.** They no longer vanish after 60 minutes; one nobody needs is dropped with **Not needed**, or by the lead with `code-kit requests drop`.
- **A card for each decision.** Two approvals waiting are two cards in the Decisions tab, each answered on its own.
- **Bug reports for code-kit.** With `harness.report.on` (off unless you turn it on; init asks), an agent that code-kit got in the way of drafts a report with only code-kit's own facts, your project's folders and email addresses taken out. You read it and send it to code-kit's GitHub with your own `gh` (a comment, if it's filed already), or get the link to file it, or discard it.

## 0.11.1 (2026-10-12)

The loop and the lead stop talking past each other, and approvals ask only what still needs you.

- **The loop never asks for a story an agent is still on.** `code-kit next` reads only branches, so the loop kept asking the lead to review stories their lane agents were still building, or already being reviewed, and to dispatch stories started a moment ago. It now leaves out every story a running agent's task names ("ST-10 capture pipeline", "Review domain/st-78"), and when nothing's left it waits, saying for what, until an agent finishes.
- **Approvals are counted as decisions.** "contract for the platform lane: 5 files" is one approval, not five; approving it covers them all.
- **Only requests that still wait are shown.** A request closes once an approval is given after it, even if that approval has since lapsed or was used up, and once its file has been committed by someone who could. A read-only agent, such as the reviewer running a code generator, is never approved to write: it's told to put the file back, and you aren't asked.
- **The history of approvals.** `/approvals` and `code-kit requests` list every approval given, newest first: when, what for, which lane, who gave it (you, or the lead within your delegated rules), the reason, and the files and branches it covered, merged or not.

## 0.11.0 (2026-10-12)

Teams get their own pane and their own setup, and a hosted team provider can stand down to GitHub.

- **`/team` opens the Team pane.** It replaces the Lanes pane's Team tab. Its header names the tech lead, you, and what coordinates the team (GitHub, or a hosted provider, and whether it's live). Its tabs: People (who's at work on what), Since you looked, Claims (Keep and Release on yours; Release and Reassign for the tech lead), Intents (Agree and Drop for the tech lead), Drift (with a provider that checks for it) and Setup (the team's config and what GitHub still needs). A Team button in the band opens it on the tab its line is about.
- **Set up a team only when there is one.** `/code-kit:team-init` asks for the tech lead, each lane's owners, when a claim goes stale and where intents go, shows the team section, and writes it once you agree; it also changes a team or takes it out. `/code-kit:init` asks once whether other developers work in the repository and runs it only if they do. Behind it, `code-kit team init` (`--write` to write, `--off` for one developer again) says what GitHub still needs: gh signed in, the repository reachable, and the intents' discussion category. A lane agent can't write it.
- **A hosted provider can fall back to GitHub.** With `team.provider: { command, fallback: "github" }`, whatever the provider can't reach goes through GitHub's claim refs instead, and the band says GitHub is standing in. A live provider's state refreshes the band and the pane as it changes, and its presence and drift findings show in the pane, with drift on your own work in the band.
- **Two band lines with the same button no longer clash.** Each button and row keeps its own key.

## 0.10.0 (2026-10-12)

An older setup is brought up to date before new work starts, and a security reviewer checks the changes that need one.

- **The gaps stop new work until init fills them.** For a project set up by an older init, `code-kit next` names what it's missing: a design gate for the lanes that build screens, design stories before the screen stories not yet started, a QA lane, and a security reviewer. Work already started goes on through review and merge; nothing new starts. Once nothing is in flight, `next` gives `update`, and the loop has the lead re-run `/code-kit:init`, which shows you the difference first.
- **An adversarial security reviewer.** spec-design writes a short threat model for each spec (what's sensitive, who might attack it, the trust boundaries) and security requirements stories can cite. init writes a read-only `security-reviewer` agent. `code-kit security` says whether a branch touches sign-in, permissions, outside input, personal data, encryption, payments, secrets or dependencies, and where; when it does, the review runs the security reviewer, which reports only findings with a concrete attack path. A blocker sends the branch back like a failing test.
- **Setup version 3.** Re-running init records `"setup": 3`.

## 0.9.1 (2026-10-12)

Team mode, run against a real GitHub repository. It's still a preview.

- **Since you last looked names pull requests again.** GitHub's activity feed now leaves the title out of pull request events, so they read "undefined". Titles, drafts and merges now come from the pull requests themselves.
- **Pushes show up straight away, with how many commits.** GitHub's feed listed pushes late or not at all. code-kit now reads them from git after a fetch, counting only each branch's own commits.
- **The board stays as it is on a new machine.** The first `code-kit team board` on another computer rewrote fields that were already right. It now reads the board's values first and changes only what differs.

## 0.9.0 (2026-10-11)

Onboarding in the right order, a QA lane, maps that work on any project, and team mode as a preview.

**Onboarding**

- **Lane agents come with their skills.** spec-design writes a recipe for each layer's common additions (a screen, an endpoint, a migration), and init turns each into a project skill in the same approval as the agents. `next` says when an agent names a skill that doesn't exist.
- **Screens are designed before they're built.** When the product has screens, the plan gets a design story per area (`**Lane:** design`), and the stories that build them depend on it. init switches on the design gate for every lane with screens. The new `/code-kit:design` designs them in your design tool, or as HTML files, from the spec's own content, shows you each one, and records the ones you approve. `next` and the loop run design stories before anything they hold up.
- **A QA lane proves the journeys.** Each lane still writes its own unit tests. When there are screens or journeys across lanes, a `qa` lane with a `test-engineer` agent owns the end-to-end suites (Playwright, Maestro or Detox), with a test story per journey, and reviews run the journeys a story touches.
- **Companions are set up before coding.** When Context Graph is installed but not set up, init records it and runs its init before reporting, and `next` and the loop do it first until it's done.
- **An older setup is told what it's missing.** The config records the setup's version (`"setup": 2`). A project set up before gets a line from `next` naming what re-running `/code-kit:init` adds.

**Fixes**

- The Trail no longer goes blank on projects with more than 64 requirements: its list holds one spec at a time.
- The Code map shows the whole project, by folder, when no story is being built, instead of saying the next story has no code yet. `code-kit map project` gives the same.

**Teams (preview)**

- Several people in one repository, through GitHub alone: lane owners, story claims with leases on the files they change, the tech lead's paths, intents as discussions with decision records once agreed, since-you-last-looked, stale claims, CODEOWNERS from the config, the plan on a GitHub Project, and a Team tab. New commands: `code-kit team`, `team since`, `team claim|keep|release|reassign`, `team codeowners`, `team board`, `code-kit intend`. It's tested against a stand-in for GitHub, not yet on real repositories.

## 0.8.1 (2026-10-11)

Fixes for projects set up before 0.8.0.

- **No first merge for you here either.** A project set up before 0.8.0 has no code-kit rules on `main`, so its first merge still waited on you. Now the lead puts the rules you approved onto `main` itself (`code-kit queue rules`, a step the loop takes), without switching branches, and then merges the queue under them.
- **Waiting on the merge queue isn't a broken plan.** Stories that depend on branches waiting to merge were reported as a dependency cycle, sending the build back to spec design. `next` now says they wait for the merge.
- The band's key for decisions reads "d: Why, and what each choice does", not "d: d Why".

## 0.8.0 (2026-10-11)

You decide what's built and the rules; the lead delivers it. Only real decisions reach you, each with the story behind it, and the whole build reads as one story from your request to now.

**Who decides what**

- **No first merge.** Setting up commits the rules you approved straight onto `main`, so the lead can merge reviewed work from the start. Under autonomy, setup also drafts limits within which the lead merges and approves new packages itself; you adjust them before approving.
- **Lane work is the lead's.** While the loop runs, a lane's finished work never waits for you: the lead reviews, sends back and merges it. With the loop off, Review and Merge are offered to you as before.
- **Decisions come with their story.** Each one above the prompt says which story it's for ("for ST-4 Booking form (BOOK-1)"), and **d** opens it as a card in the new Decisions tab: what you asked for, the story and its requirements, what the agent was doing, what's already settled, why the lead couldn't settle it (the rule, and the limit it missed), and what each answer does. Usage and pauses are labelled "note", not "you".
- **The Journal.** A Journal tab, and `code-kit journal`, tell the build by day: your request and the decisions in your brief, the specification, each story handed out, sent back and merged, each approval and who gave it, each milestone finished, and the loop's steps this session.

**Seeing the build**

- **The mission band.** Above the prompt, while the build moves: the milestone being built and how far along it is, what the lead is doing, the loop's next step, and each agent at work with its current tool.
- **The Lanes pane** opens on the loop as a card (its mode, its steps, the next one), keeps each lane on fixed columns, shows a lane's stories as cards, and reads "orchestrating" while the lead works.
- **The code map.** A story's files in a column per layer with the imports between them; a file fills with a lane's colour while that lane reads or edits it, and says whether its why is written. `code-kit map <story>`.
- **The trail.** Each requirement drawn to its stories, code and tests, with a missing link in red. `code-kit trail`.
- Tabs are now Lanes 1, Decisions 2, Journal 3, Code map 4, Trail 5, Queue 6, Usage 7.

**Fixes**

- Pausing the loop is recorded (`code-kit loop`), so Context Graph's background work pauses with it. A new session starts unpaused.
- The stall check no longer nudges or restarts agents whose work is done, and until you choose how hands-off the loop is, a restart is offered, not taken.
- With Context Graph, agents can add the guidance they find without your approval; only its settings stay yours.

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
