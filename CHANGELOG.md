# Changelog

What changed in each release of code-kit, newest first. Versions follow the plugin manifest and the npm package `@warren-dean/code-kit`. Each release is also on [GitHub Releases](https://github.com/warrendeanlangeveldt/code-kit/releases).

## Unreleased

- **The loop no longer cuts into a conversation.** It prompted the lead as soon as each turn ended, so when you were talking with the lead about something else, the next step landed a minute after its answer to you. The reading of the lead's reply is now given what you said and tells a conversation from asking it to carry on; after a conversation, the loop waits until you've been quiet for `harness.loop.quietMinutes` (10 by default), and the band says so, with **Carry on**.
- **Each step is checked against the project before the lead gets it.** The loop kept prompting steps the lead had already explained: a merge whose verify was still running, instructions already brought up to date on the base, a story already under way. A story the lead said waits was held, but a merge or an instructions step wasn't, and anything you said to the lead let every step come back. Before each prompt, the loop now reads the project itself (the step's branches against the base, the merge queue, the agents at work, the latest commits and the lead's last replies) and a small model judges whether the step is still due. One that isn't waits in the band as a note with **Ask now**, and is checked again once the project moves. A step the lead said waits, or didn't take, is held the same way. `harness.loop.check` switches the check off. In auto mode a mod can't start an agent itself, so this is a side call, not a subagent.

- **code-kit's own records, then a commit.** `node "$CK" ask withdraw Q-3 --reason "…"`, `defer release`, `sent-back` or `queue add`, followed by a commit in the same command, was refused as a write the commit's checks can't see. These write only code-kit's state folder, which the project ignores, so they now pass when run by this code-kit's own CLI, by its path or through a variable the line sets to it. Any other code-kit command (one that writes instructions, merges or publishes), a script elsewhere with the same name, and a redirect into the checkout still count.
- **`git switch -qc <branch>`, then a commit.** A branch made with its flags combined was refused, though `git switch -q -c <branch>` passed. Both pass now.
- **A branch queued again after a batch failed no longer goes back to its lane.** When a batch fails verify in the merge queue, every branch in it is sent back, including those with nothing wrong. The lead queued those again at the same commits, yet `status` still read them as sent back, and `next` proposed dispatching lanes with nothing to fix whenever it wasn't the lead's turn to merge. A branch queued since its send-back, at that commit, now reads as passed and waits to merge. A branch that's sent back while it's in the queue stays sent back.
- **A branch merged after a send-back no longer asks for a dispatch.** A branch sent back, queued again and merged at the same commit still read as sent back until the plan said `done`, so the loop asked the lead to dispatch a story that was already on the base. A branch whose commits the base holds has nothing left to fix, and now reads as merged.
- **The loop says how to hold a story it keeps asking about.** A story the lead left because it waits on something outside the build (a run on a set day, say) was asked about again every half hour, as soon as other lanes committed. When a story comes up again with nothing it waits on having moved, the loop's prompt now adds that `code-kit defer` holds it, with a reason and an optional date, so the loop stops asking.
- **A lane's report, then its commit.** `cat >> .claude/state/reports/<branch>.md <<'EOF' … EOF`, followed by `git add … && git commit` in the same command, was refused as a write the commit's checks can't see, and lanes hit this often as they finished a story. The state folder is ignored, so no commit can take what goes there. A read or a heredoc redirected only into it now passes, as long as the project's `.gitignore` covers the folder.
- **Instructions from a newer code-kit are left alone.** When a teammate had updated code-kit and committed its instructions, a session on an older plugin read them as out of date. Its loop kept asking it to run `instructions --write`, which would have put the older rules back. From this release, `instructions` reads them as ahead, `--write` leaves them, and `next` says to update the plugin and restart instead. The instructions' version is now raised whenever they change, so this works between releases; existing projects will be asked once to bring theirs up to date. A session still on an older release keeps the old behaviour until it updates.
- **Reading the approval log beside a variable of your own.** `CK=…/code-kit.mjs; node "$CK" status; tail -3 .claude/approval-log.jsonl` was refused, because any variable set in the line made the whole line count as a possible write. A variable now counts only if a command could read it: `PATH`, `HOME`, `GIT_*` and the like, or one already exported.
- **The merge queue no longer fails every branch when the OS empties its kept installs.** The queue's kept checkout lives in the temporary folder, and macOS removes old files there while leaving the folders and links. The installs looked present, so checks failed with missing modules and each queued branch was sent back to its lane. Each merge now counts the kept installs' files. If any have gone, it copies them again and runs the project's install over the copy.

## 0.33.0 (2026-11-06)

- **A running budget.** Projects were being designed on each provider's production defaults, with nothing adding up what they'd cost a month. spec-design now asks how much a month each environment may cost, in your currency, and the load to plan for; init writes it to `cost` in the config, with the project's infrastructure files. spec-design costs each architecture it proposes against it and, when your preferred one doesn't fit, offers options that do, each with what it gives up. The costs go in `docs/costs.md`, a row per paid thing with where its price came from, and `code-kit cost` adds them up against the budget. A branch that changes the infrastructure has to change the register (verify), lanes may write it, and a commit that takes an environment past its budget waits for your `cost` approval, which the lead can't give, under vibe either. `next` asks a project with infrastructure and no budget for one. It works for any provider: code-kit holds no prices, and the lead cites where each came from. Reading real spend from an account comes later.
- **A branch made where the checkout stands, then a commit.** `git checkout -b <branch> main && git add … && git commit …`, run with the checkout already at main, was refused as a command that may write files the commit can't see, because the branch named a start point. A start point that is the commit the checkout is at changes no file, so it now passes like a branch made with no start point. One at any other commit is still refused.
- **Reverting a commit that logged approvals.** A `git revert` of a merge, or of any commit that appended to `.claude/approval-log.jsonl`, takes those entries back out with the rest, so verify failed the branch as an edited log, and no shell command was allowed to put the log back: the only way out was to make the branch again by hand. A command that doesn't commit may now put the log back as the last commit has it (`git restore --staged --worktree .claude/approval-log.jsonl`, or `git checkout HEAD -- …`), which can lose only what isn't committed. Verify's problem now says what took the entries out and how to make the revert again: `git revert --no-commit <commit>`, then that restore, then commit. A restore from any other commit, or in the same command as a commit, is still refused, since the commit hook appends before the command runs.

## 0.32.0 (2026-11-06)

- **Writes outside the checkout before a commit.** Drafting a commit message in a scratchpad and committing it in one command (`git log -1 --format=%B > /tmp/msg && sed -i '' 's/…/…/' /tmp/msg && git commit --amend -F /tmp/msg`) was refused as a command that may write files the commit can't see. A read whose output goes only to full paths outside the project and the commit's checkout, and sed's substitutions on such files in place, can't change what's committed, so they're allowed. A path from a variable, a link back into the project, a sed that writes a file or runs a command, and any write into the checkout are still refused.
- **Lane agents know the spec-check table before they write code.** A lane agent that wrote its spec-check report by hand, without the skill, often left out the requirement table. The report saved, but every code edit after it was refused, several at a time, until the agent rewrote the report. The lane agents' instructions and dispatch's brief now say the report is a table whose header row starts `| Requirement |`, one row per requirement, and that the path guard reads a report without it as none. Projects get the new wording when `code-kit next` brings their instructions up to date.
- **A lane agent stopped mid-command no longer holds its worktree for good.** `code-kit worktrees release <branch>` refused as long as the lane agent's last recorded act had no end, which is what an agent stopped in the middle of a command leaves behind. The refusal said the agent was still at work, though none was running, and nothing the lead could do would clear it. An open act now holds the worktree only while its agent may still be in it. Once `code-kit next` has reconciled the act, or the agent's session has ended, it handed back, or the act is older than the stall restart (`harness.stall.restartMinutes`, 10 by default), the release goes ahead.
- **A merged worktree holding only a tool's records goes.** A tool that writes its records in every worktree at each turn's end (Context Graph's `.ctx/` files) left each merged lane worktree with an uncommitted change, so `code-kit worktrees prune` kept every one, installs and all, for the person to decide. Those changes are now kept as a patch under `.claude/state/discarded/`, and the worktree goes; one holding anything else is still the person's.
- **The merge queue no longer copies the installs on every merge.** Each merge checked the branch in a new checkout with its own copy of `node_modules` (a copy-on-write clone, so no disk space, but every one of its files created and then deleted again). With several projects merging, that kept macOS's file-change tracking and Spotlight busy enough to slow the whole machine. The merge queue and the fix check now keep one checkout each per project, with its installs, and reuse it: each run checks out the tree it needs and installs again only where the manifests and lockfiles differ from the ones its installs were made for. It lives in the temporary folder under `code-kit-checkouts.noindex`, which Spotlight skips, and `code-kit worktrees` keeps it.
- **One worktree per lane.** Claude Code made a new worktree for every lane agent, so each story, send-back and restart got a folder and installs of its own; in one project, 25 of them held 85 GB. Each lane now has one worktree, `.claude/worktrees/lane-<lane>`, kept from story to story with its installs: code-kit's `WorktreeCreate` hook gives it to the lane's agent, detached at the main checkout's HEAD, and the agent makes or switches to its story's branch as before. Start agents that work in worktrees one per message: the hook is told only the worktree's name, so code-kit notes the lane as each agent starts and refuses a second until the first has its worktree. A lane worktree still holding uncommitted work isn't reused (the next agent gets its own); once its story is merged, `worktrees prune` keeps it and lets go of the branch. Every other agent gets the worktree Claude Code would make, with the files `.worktreeinclude` names, taken away with its branch when the agent stops having changed nothing.
- **A quoted variable before a commit is one assignment.** `K="node /path/to/code-kit.mjs"; git add … && git commit …` was refused as a command that may write files: the value's space split it, and the path after it was read as a command. A quoted value is now taken whole, in every rule that reads a command's parts.
- **The Decide pane: decisions no longer pop up mid-conversation, or get cut.** code-kit used to ask a decision in Claude Code's own question dialog whenever the lead went idle. The dialog took only the question and up to four short labels, cut what didn't fit, and came up over whatever you were reading. Now nothing pops up: a decision waits in the band and in Needs you, with a notification, until you open it with **d**, its line in Needs you, or `/lanes decide`. The Decide pane opens beside the conversation with one decision at a time, all of it: the whole question, why it's yours, the story and requirements, what was happening, what's settled, and each option on its number with what it does. Questions that take your own words have the box in the pane, with Ask about it. **n** and **p** move between decisions, and the one in view stays put as others come and go. Needs you is now a line per decision, so it no longer jumps as you move through it.

## 0.31.1 (2026-11-05)

- **`next` in a working session says whose step it is.** When another session leads the project, `code-kit next` and `/code-kit:next` handed a working session the lead's step, such as a dispatch. The session went on to write the lead's contracts and was refused at every edit. It now gets the step `working`: which session leads and what its next step is, and what this session does instead (a task of its own, recorded with `code-kit task`, in a worktree of its own).

## 0.31.0 (2026-11-05)

- **The project's own workspace packages are no new dependency.** `pnpm add @scope/pkg@workspace:*` (and `link:`, `file:` and `portal:` specs) adds one of the project's own packages, from no registry, but was refused as a new dependency that needs an approval. A registry package in the same command still needs its own.
- **`queue add` takes every `--with`.** `code-kit queue add <branch> --with a --with b` kept only `a`, so the group could be offered for merge before `b` was queued. Each `--with` now joins the group, as `--with a,b` does.
- **Harmless steps before a commit.** Making folders (`mkdir -p`), taking away a worktree (`git worktree remove`, `git worktree prune`) and unstaging (`git reset [HEAD] [--] <paths>`) in the same command as a commit were refused as commands that may write files. None changes a file the commit could take, so they're allowed. A reset to another commit, `git reset --hard` and a redirect are still refused.
- **The spec-check refusal says when only the table is missing.** A lane whose report was there but whose table header wasn't `| Requirement |` (an abbreviation such as `| Req |`) was told to run spec-check again, and kept retrying. The refusal now says the report has no requirement table and which header the gate looks for.
- **The review's screenshot for a screen another story designed.** verify and the merge queue ask for the review's screenshot of every registered screen a branch changes, but `code-kit designs evidence <story> …` and `code-kit designs <story>` only knew the screens whose design story was that story or one it depends on, so the command they named was refused. Both now include every registered screen the story's branch changes.
- **Vibe: hand the whole build to the lead.** A fourth answer to init's question of how hands-off the build is, `"harness": { "autonomy": "vibe" }`, chosen once the spec is done and code-kit is set up. The loop runs on its own, and every decision is the lead's: the specs for later milestones, the designs, CI, the kit, the standards, weakened tests on its own branches too, packages beyond the registry's rules (recorded with the rules they break), merges and pushes. The lead answers the open questions itself and records each in the brief's decision log. You're asked only for what nobody else can give, an account, a key, a payment or an act outside the repository: under vibe, `code-kit ask` needs `--needs account|key|payment|outside`. See the README's Vibe section.
- **The queue records a merge as soon as it lands.** `code-kit queue merge` now marks the branches merged the moment they're in the base, before it releases the stories' claims with the team provider and takes away the worktrees that are done with. Both can take minutes (a provider that's slow to answer, worktrees with big installs), and until now the queue showed the merged branches as still waiting all that time, or for good if the run was stopped meanwhile.
- **Reading the approval log beside other commands.** A shell read of `.claude/approval-log.jsonl` (`tail`, `grep`, `git log` and the rest) is no longer refused because something else runs in the same line, such as `git status` or a code-kit command after a `;` or `&&`. Each command that names the log must still only read it, and a line that defines a function or alias, sets a variable or has a heredoc is still judged whole.
- **A fork has the rights of the session it was forked from.** Claude Code's `fork` agent is a copy of the session's own conversation working in the background, but code-kit treated it as a read-only subagent, so the lead couldn't hand it work such as exporting approved designs into `design/`. A fork is now the lead (or the lane, in a lane's worktree), refused exactly what that session would be.
- **A throwaway merge to try a story isn't a merge into a branch.** Merging a story's branch where it lands on no branch (a detached worktree the command adds, a detached HEAD, or another repository it moves to with `cd`, also through a variable) is no longer refused as making a second main. A merge after a `cd` into another of the project's checkouts is judged against that checkout's branch, and the refusal names it. `git checkout -- <paths>` no longer reads as switching to a branch.
- **A commit is judged on the branch it lands on.** The protected branch's rules followed only where a command started and whether it switched to the protected branch anywhere, so a commit on a branch the command made first (`git switch -c x && git commit`), a commit followed by switching back to main, and a rebase in a worktree the command adds (after `cd` or with `git -C`) were all refused as commits on main. Each commit, merge or rebase is now judged on the branch it lands on, in the command's order; one that lands on the protected branch is still refused. Making a branch where the checkout stands (`git switch -c x`, `git checkout -b x`, with no start point) no longer counts as a command that may write files before a commit.
- **A file the design gate takes for a screen by mistake.** A file-based router keeps files that draw no screen beside its screens (an API route, middleware, a hook for links the phone hands the app), and a screens glob for the whole folder took them for screens, so a lane was told to design one first. The refusal now says what to do when the file draws no screen: ask the lead to leave it out with the screen's `not`. Init leaves out a router's layouts, API routes, middleware and special files from the start.
- **`code-kit designs` names an unnamed state.** A register entry whose state has no name or files is listed as `(unnamed) (no viewport): no files` instead of `undefined`.

## 0.30.2 (2026-11-04)

Fixes from how code-kit is used: fewer commits refused after commands that write nothing, the setup commit takes the person's approval of the setup, and the fix check and the merge queue see more of a project.

- **A commit after a tool records its notes.** With Context Graph on, a commit in the same command after `ctx record` or `ctx card` is no longer refused as possibly writing files: they write only Context Graph's own records, which any actor may write. An adapter names such commands in its `shell.records`.
- **Committing the setup.** Until code-kit's config has first been committed, the lead's protected files (the specs, the standards, the design register) need no approval of their own: the person approved them with the setup init showed. The commit that switches code-kit on no longer asks for an approval for each, and the stop check no longer asks the lead to revert the new specs; the approval log records each file as part of the setup. Once any commit has held the config, protected files need their approvals as before, even if a later commit takes the config away.
- **A screen state with commas in brackets.** A spec's `**States:**` line such as `default, error (timed out, offline)` is read as two states, not three, so the design register's entry for it matches.
- **A commit after code-kit's own reads.** A commit in the same command after `code-kit designs`, `status`, `check`, `next`, `who`, `trace` and its other commands that only read and print is no longer refused as possibly writing files, however code-kit is run (installed, through node or npx). `designs evidence` and anything with `--write` still are.
- **Setting a shell variable before a commit.** A commit in the same command after `f=docs/x.md` or `export MSG="…"` is no longer refused: setting a variable writes no file. A value that runs a command (`$(…)` or backticks) is still refused, and a `git add "$f"` still counts as staging every changed file, since what it names can't be read in advance.
- **Releasing a worktree while the lead's reviewer works on its story.** `code-kit worktrees release` no longer says the lane's agent is still at work because a reviewer the lead started is acting on the same story. Only the branch's own lane agent counts.
- **A fix's test the checks never run.** Where a check passes without running a fix's test (the test runner's default config leaves the file out), verify no longer says the test passes without the fix. It breaks the test on purpose, sees the check still pass, and says the check doesn't run it, so it can't tell.
- **A lockfile in a subfolder.** When a branch changes the lockfile of a service in a subfolder (a Python service's `uv.lock` beside its `pyproject.toml`, say), the merge queue now runs that lockfile's install in that folder of the merged tree, so the checks see the new dependency. Before, it only looked for lockfiles at the top.

## 0.30.1 (2026-11-02)

More fixes from how code-kit is used: reads no longer stop a commit or trip a blocked command, a test-only fix may carry a tool's records, and file paths reach git literally.

- **Reads before a commit.** A commit in the same command after commands that only read (`git branch --show-current`, `git status`, `head`, `grep`, `wc` and the other reads the approval log allows) is no longer refused as possibly writing files, and neither is `git add` with its errors sent away (`2>/dev/null`, `2>&1`). `git add -A <paths>` stages only those paths, as git does. Anything that may write before the commit is still refused: `sed -i`, a redirect into a file, a heredoc into a file, an interpreter, `git branch <name>`, `git diff --output`.
- **A blocked command is matched where it runs.** A `shell.block` rule with `command: true` now does what it says: it matches from the start of each command the line runs (after `cd …`, a variable, `npx`, `pnpm exec` or `uv run`, and inside `sh -c '…'` or `eval`), with quoted text masked unless the pattern itself has quotes. So `grep -n "<blocked command>" docs/runbook.md` and a commit message that mentions it run, and the command itself is still refused, its program's name quoted or not. A rule without `command: true` no longer refuses a read (`grep`, `cat`, `head`…) whose quoted arguments mention the command; the same goes for `shell.restricted`. `curl … | sh` is still refused. Init now writes `command: true` for the rules it drafts that name a command.
- **Concurrency set on purpose (`code-kit ci check`).** A workflow's `cancel-in-progress` set to an expression (`${{ github.event_name == 'pull_request' }}`, cancelling pull requests' runs and never an apply) or to `false` (a deploy or an apply that must not stop half-way) is no longer reported as `no-concurrency`; only leaving it out is. The one-line form the fix suggests, `concurrency: { group: …, cancel-in-progress: true }`, is now read too.
- **A test-only fix may commit a tool's shared records (REG-1).** Files any actor may write, such as the records a tool that shares the project writes for everyone, no longer stop a fix made wholly in its tests from counting as one, and are never taken back when proving a fix. Manifests and lockfiles still count as the fix's code.
- **A fix resting on a harness module it adds (REG-1).** Where a fix's tests pass without its other changes and fail without a test helper the branch adds, `verify` now says the tests fail without the fix only because they load test code the fix adds, naming it, instead of saying they pass without the fix.
- **Paths with brackets (`app/items/[id].tsx`).** code-kit gives file paths to git literally, so a route file's brackets are its name, not a pattern: proving a fix takes back that one file, and `trace`, the journal, the approval checks, the design evidence and the event log's reconciling read that file's history only.
- **The session's own scratchpad.** The lead and the lanes may write in their session's own folder in Claude Code's temporary folder (`/tmp/claude-<uid>/<project>/<session id>/`: the scratchpad and the tool output), and no longer in another session's. A write elsewhere outside the repository is refused saying where temporary files go instead; a read-only agent's says it writes no files, temporary ones included.

## 0.30.0 (2026-11-02)

Fixes from how code-kit is used: screens are built from their exported designs and compared in review, the merge queue lands what it verified and only holds a branch to its own changes, and the lead can hold stories and the queue on purpose. code-kit's part of CLAUDE.md is now version 12, so `next` asks to bring it up to date first.

- **A screen waits for its design as files (spec 24, HAND-6).** A register entry that names only an artboard in the design tool no longer lets a lane write the screen: the write is refused, saying the lead hands the design over with `/code-kit:design --hand-over` first. `code-kit next` doesn't dispatch a story that builds such a screen; its step is the hand-over (`design` with `handOver: true`), and the loop asks the lead for it.
- **The review's comparison is recorded (HAND-7).** The review records the screenshot of each built state it set beside the design: `code-kit designs evidence <story> <screen> <state> <screenshot.png>`, refused unless it's a PNG at the design's viewport. `verify`, and so the merge queue, report each approved state of a lane branch's screens with no screenshot since the screen last changed. In CI, where the review's records aren't, verify says it didn't check them.
- **Lanes can look at the design tool (HAND-8).** Where the architecture names a design tool with an MCP server, init gives the lanes that build screens, and the QA lane, its read-only tools, with a line saying the exported files in the register are what they build to.
- **A screen name means one screen (HAND-9).** A register entry's screen is matched only to the spec screen of exactly that name: a `###` or `####` heading, a `- **Name**` bullet, or a table row under `## Screens`, whose States column now counts. A name two screens share is reported as ambiguous, instead of one getting the other's states.
- **A design story stays in progress until its screens are designed (HAND-10).** Committing the first approved screen on `design/st-<n>` no longer sends the story to review: it's in progress while a screen it designs (its plan's `**Screens:**` line, or its specs' screens) isn't in the branch's register, or until the plan says `review`.
- **Merging the base into a branch (HAND-11).** The commit hook and `verify` hold a branch only to the register entries it adds or changes, so a lane merging the base isn't refused for the base's designs that are still only in the tool.
- **What counts as a test is one rule (spec 18).** Every check that asks now agrees: a file named as a test (`*.test.*`, `*.spec.*`, `*.smoke.*`, `test_*.py`, `*_test.go`, `*_test.py`) or in a test folder (`test/`, `tests/`, `__tests__/`, `e2e/`, `smoke/`), or your `tests` globs where the config has them. A fix whose tests are smoke scripts is no longer refused as bringing no test.
- **A fix's proof takes test helpers back too (REG-1).** Proving a fix keeps only the files named as tests and takes everything else back to the base, helpers and harness modules in test folders included, so a fix made in a test harness is no longer reported as "its tests pass without the fix". A helper the branch adds stays, for its tests to load. A fix made wholly in test files still passes as before.
- **The person's approval after the lead's commit (WHO-1).** Where the lead merges and the person approves a protected change the lead already committed, the lead no longer has to touch the file again. With their approval in force, the lead's next commit (`git commit -m "Record the person's <approval> approval for <file>"`, nothing staged) records the approval in the log for the file as the branch holds it, by its content's hash, and `verify` accepts it while the file is unchanged. `verify`'s refusal says exactly what to run.
- **Reading the approval log through the shell.** Read-only forms are allowed: a `cd` first, `2>&1` or a redirect into `/dev/null`, and `cat`, `head`, `tail`, `grep`, `wc`, `jq`, `cut`, `sort`, `uniq`, `awk` and `sed -n` printing lines, alone or piped from git's `diff`, `log`, `show` and `blame`. Anything that could write it is still refused: redirects into a file, `tee`, `sed -i`, `cp`, `mv`, editors, interpreters, a command's output in its arguments, and variables set before a command. The refusal lists the allowed forms.
- **A merge run from inside a lane's worktree is recorded.** Running `code-kit queue merge` from the worktree of the branch it merges used to remove that worktree, and with it the way back to the queue: the branch stayed queued, and the next `queue merge` verified it again against the base it was already in. Every queue command now finds the main checkout first, and the merge keeps the worktree it's run from (it goes at the next merge), saying so.
- **A queued branch the base already holds leaves the queue as merged.** It's never verified again, so a fix branch already merged is no longer sent back as "a fix that adds no test". `code-kit merge <branch>` says the same.
- **The merge queue checks with installs that match the merged tree.** It copies the base's checkout's installs (the main checkout's), not the branch worktree's, which could be far behind the base or have none. Where the merged tree's manifests or lockfiles differ from them, it installs in its own checkout first, with `regression.prepare` if set, else the install the lockfile calls for (pnpm, npm, yarn, bun or uv); an install that fails there keeps the branch in its place instead of sending it back. Where code-kit knows no install for what differs, the merge says which installs it used and that they may not match.
- **A tool pnpm can't find is named as not installed.** `pnpm exec` exits 254 with `Command "tsc" not found` after a stray `undefined` line; that's now read like a missing command (skipped and named, or failed where the check sets `"ifMissing": "fail"`), and the `undefined` line is left out of what a failed check shows.
- **A merge group's lane branch built on its lead partner's isn't blamed for the lead's files.** Each member of a `--with` group is held to its own lane's paths for its own changes, measured against the base merged with its partners.
- **A busy main checkout no longer fails a merge at the end.** Only uncommitted changes to files the merge changes stop it, and it looks before the verify as well as after; other tools' changes to other files there are carried as they are.
- **Holding on purpose.** `code-kit defer <story>… --reason "…" [--until <date or time>]` holds stories: `next`, the loop and the merge queue don't dispatch, review or merge them until then, or until `code-kit defer release <story>`, so the lead isn't asked about them every half hour. `code-kit queue pause --reason "…"` and `code-kit queue resume` hold the whole merge queue. `next` lists each hold with its reason, `queue` shows them, and the band shows them as notes with no Merge or Review. code-kit's part of CLAUDE.md tells the lead about both, so `code-kit next` asks for it to be brought up to date.

## 0.29.0 (2026-10-31)

A team provider's drift findings can hold a merge, and what a project reports covers models, security reviews, intents' pull requests and claims (report version 6).

- **Drift holds a merge (spec 21, HUBR-9).** Where a team's hosted provider checks each push for drift and its setting says what blocks a merge (a finding against a spec or decision, any finding, or nothing), the merge queue holds a branch while the provider has an open finding on it at that level, and goes on with the next. `code-kit queue`, `queue merge`, `merge` and `next` name the finding, say the tech lead decides, and how it clears: resolved on the provider, or a push the drift check no longer finds conflicting. The band offers no Merge for a held branch and says why. GitHub alone checks no drift, so it never holds; a provider that can't be reached holds nothing, and code-kit says drift wasn't checked.
- **What a project reports (report version 6, spec 21).** Each usage row now names the model its requests ran on. Each story whose branch needs the security review says why (the kinds of change), whether the security reviewer ran, when, and what it found, as counts of findings and blockers only. Each intent a story's claim carries out has that story's open pull request, and whether it's a draft. The team's claims are reported with when each was taken and last renewed (claimed again, its lease grown or its branch pushed), and whether it's stale; no claim renews on a schedule. A report from an older code-kit is still valid.
- **Intents and claims.** `code-kit team claim <story> --intent <number>` records the intent a story carries out on its claim; a claim again keeps it. The dispatch skill does this when it starts an intent's work.
- **The security reviewer's findings** are recorded in the story's event log as it stops, whether the lead waited on it or it ran in the background, so the review shows as run, with what it found.

## 0.28.0 (2026-10-31)

What a project reports to a team provider now covers its outcomes, who approved what, its designs and the sessions at work (report version 5).

- **What a project reports to a team provider (report version 5, spec 21).** Beside what version 4 carries, a report now holds each spec's id, title, outcome line and requirement ids; each layer's and lane's deliverable kind; each lane's layers and paths; each approval's story, and the GitHub login of the person who gave it, when code-kit knows who was at the machine; the security review's rules; each story's spec-check result and place in the merge queue; the design register's entries; and the sessions at work, with the code-kit and model each runs, when it started and the file it last edited. Nothing else of the specs or the plan is sent: no acceptance criteria, requirement bodies or decisions. `code-kit team report --dry-run` shows it all before anything is sent. A report from an older code-kit is still valid.
- **Labels.** A layer or a lane can name what it delivers with `label` ("Screens", "API contract"). Without one, the kind is taken from its name.
- **Approvals** you give are recorded in the approval log with your GitHub login, when code-kit has it.
- **Sessions** record the model they run on (from Claude Code's session start, or the session's latest reply), the code-kit version that started them and the file they last edited. A hosted provider's presence carries the same, by path only.

## 0.27.0 (2026-10-30)

Fixes for what projects reported: the loop respects Claude's usage limit, merges land as they were verified, claims end with their stories, and approved designs reach lanes as files.

- **Usage limits.** When Claude's usage limit stops the lead, the loop now waits until the limit resets instead of prompting into it, and the band says so, with **Try now**. With no reset time, it retries after 5 minutes, doubling up to an hour. A lane agent stopped by the limit isn't taken as finished: it keeps its lane, its story stays in progress, and its finish isn't checked.
- **The loop** no longer repeats steps it has already asked while nothing in the project has changed. It doesn't send a step it worked out while the lead's turn began, so a branch you just dropped from the queue isn't put up to merge. It carries on a lane agent at its context limit only when the agent says it isn't finished.
- **The merge queue** verifies each branch as it will land, merged with the base in a fresh checkout that has its own installs. A merge already running isn't started again or asked for. `queue add <branch> --with <other>` makes branches that only work together wait for each other and merge as one. `merge <branch>` marks its queue entry as merged.
- **Claims.** When a story merges, its claim is released on GitHub as well as on the hub, and claims stuck on merged stories are cleared.
- **Approvals.** When merges are delegated, the lead still needs your approval to change what's yours. Every commit is judged, including `git -C`, and a commit chained after a command that writes files is refused. A refusal says when the approval ran out or which commit used it up. A commit stopped by the secrets scan doesn't use one up, and a request is no longer closed by a commit made just before it.
- **Test checks.** `expect.poll` and `expect.soft` count as assertions. A branch deleting or reworking tests it added itself isn't weakening tests. A fix made entirely in tests (a flaky test, a broken helper) passes the fix check. A fix's proof that a typecheck failure hid is found.
- **verify** no longer counts files the branch holds exactly as the base does. A check's long output doesn't fail it, because its exit code decides. Installs inside a container (`docker run`, podman) aren't the project's dependencies. `.mcp.json` belongs to the lead.
- **Plans and commands.** A story marked `**Status:** dropped` is never dispatched or waited on. A story whose lane is building it again isn't offered for review. `ask --help` and `ask list` behave as commands. `git merge-base`, `merge-tree` and `commit-tree` aren't read as merges or commits.
- **Designs handed over (spec 24).** An approved design is now files in `design/` (each state's code and a PNG, with their hashes), so a lane builds from exactly what you approved. Committing the register is refused while a file is missing or changed, or a state the spec lists has no design. `code-kit designs <story>` lists a story's designs, and review compares each built screen with its design. `next` asks once to export designs that are still only in a design tool (`/code-kit:design --hand-over`).
- After updating, `next` asks to refresh each project's lane-agent instructions.

## 0.26.2 (2026-10-26)

The lanes pane tells the truth about what's being built, and is easier to read.

- A lane no longer says "building" when nothing is building it. A story whose branch had merged, but whose line in the plan hadn't moved on, read as in progress forever and held its lane, so nothing new was sent to it. Now a story is in progress only while an agent's claim names it or you have its branch checked out. One whose work has merged counts as done, and `code-kit next` lists the plan lines that are out of date. One whose agent stopped before its first commit is ready again, and `next` sends it to a fresh agent and says why.
- In a project with a long history, the plan's git reads no longer come back empty.
- The lane characters are smaller, 8 by 8 pixels (four rows), and every pose is redrawn. A resting lane shows a "z".
- The keys line shows each key once (`j: down · k: up · ⏎: open · f: filter · l: journal`), and a lane's action buttons no longer show their key twice.

## 0.26.1 (2026-10-26)

`/lanes` opens in large projects again.

- In a project with hundreds of stories, `/lanes` failed to open: reading the project's state made a git call or more per story, and took longer than the 30 seconds Claude Code gives a mod's command. `code-kit status`, `timeline`, `journal` and `trail` now read every branch in a few git calls, and answer in a couple of seconds however many stories there are.
- A read that doesn't answer in time no longer stops the pane opening: the pane shows everything else.
- A story's start on the lanes' timelines is now when its branch was made, not the time of the commit it branched from.

## 0.26.0 (2026-10-26)

The lanes pane is redesigned around what needs you, a lane's work survives its agent stopping, and merged work reaches the remote.

- **The pane.** `/lanes` is one page of panels with no tabs: Build (the milestone, by requirements tested), Needs you (everything waiting on you, most urgent first, one line each), Lanes (a card per lane at work, with a cell per requirement on its trail and a chip per layer of its code map), Queue and Log. When the cards don't fit, the lanes become swimlanes. It fits at any width, docked, inline or on Desktop.
- **The band** above the prompt is at most three lines while something needs you, one line while the build moves, and gone otherwise. A digit presses the button showing it, the same in the band and the pane.
- **Views.** On a story, `t` opens its Trail and `c` its Code map, and Escape comes back. `/lanes trail`, `/lanes map`, `/lanes journal`, `/lanes usage` and `/lanes characters` open those views directly.
- **Characters.** Each lane has a small animated character, drawn from the lane's name, so any number of lanes gets its own. Each one shows what its agent is doing, and plays a move when a story arrives, is handed back, is sent back or merges. `harness.motion: off` keeps them still.
- **Durable lanes.** Every tool call is logged per story in `.claude/state/events/` (paths, commands with credentials masked, results and commits, never file contents or prompts). `code-kit replay <story>` rebuilds where a story got to. When an agent stops partway, `next`, a session's start and `code-kit reconcile` check what it left open against git: what's done is marked done, what's safe runs again, and a command that can't safely run twice is put to the lead to find out, never rerun. A fresh agent on the story starts from a hand-over brief.
- **Merges reach the remote.** `branches.publish` says how: `push` pushes the base, and `pull-request` opens (or updates) a pull request from code-kit's own branch, for a base that GitHub only changes through pull requests. `code-kit publish` tries again when GitHub won't merge yet. A story branch merges only into the base: an agent's merge of one into any other branch is refused, pointing to the queue.
- **Worktrees** of stories merged on the remote's base are now cleaned up even when the local base is behind it.
- **A lane's claim** is no longer released while its agent is pending, waiting or idle, so a second agent can't start on the same paths. Only an agent that has ended frees it.
- **Reports** to a team provider (report version 4) carry each story's summary, the paragraph under its fields in the plan (at most 600 characters, cut at a sentence), and each requirement's title.
- code-kit's part of CLAUDE.md is updated for the band and the pane: `code-kit instructions` shows the change.
- The npm package no longer includes the mod's test file.

## 0.25.0 (2026-10-25)

code-kit spends far fewer GitHub Actions minutes: a project's full CI runs once per release instead of once per story, and you can see what it costs.

- code-kit's own workflow now checks the rules only (`verify --no-checks`): ownership, layers, approvals, the design gate and the standards, which take seconds. The project's checks already ran in the merge queue before each story merged. The job stops after 10 minutes, and a new push cancels the run it replaces. A project whose workflow was written before this keeps it until you approve the change.
- `code-kit ci check` reads the project's workflows and lists what costs most with code-kit's way of working, with the fix for each: a workflow that runs on every push to the base branch, a slow workflow on every pull request, a job with no time limit, a pull request workflow that doesn't cancel the run a new push replaces, and code-kit's older workflow running the checks again. init runs it and proposes the changes, applied only as you approve them (approval `ci`), and `code-kit next` mentions them.
- `code-kit release <version>` cuts `release/<version>` from the base branch's head and pushes it, so the project's full CI runs there once. It names the stories merged since the last release branch, and refuses a branch that already exists. Releasing stays your decision: the lead never cuts one unasked.
- `code-kit ci usage [--days 7]` lists the project's Actions runs by workflow and trigger, with their minutes and how many were cancelled or failed. It says plainly when GitHub has stopped starting jobs for the account's billing.

## 0.24.0 (2026-10-25)

Each lane agent can run on the model its story needs, instead of one model for every lane.

- Set `harness.agents.lanes.model` to `story` (init now recommends it, and `/harness` offers it as "each story's size"). Each story in the plan gets a `**Size:**` line written by the lead: `small` runs on Haiku, `medium` on Sonnet and `large` on Opus. A story with no size runs on Sonnet.
- The model goes up where the story calls for it. A story citing a security requirement runs on Opus. A fix story runs on Sonnet at least, since it has to write the test that proves its bug. Each time a story's branch is sent back, the next agent runs one model higher, up to Opus.
- A lane's agent file that names its own model keeps it, and a model the lead names on the call still wins over all of this.
- `code-kit next` says each story's model and why (`Model: ST-3 on haiku (a small story)`), and `next --json` gives it in `models`. The dispatch skill passes it to the agent, and the mod sets it when the call leaves it out.
- Each lane agent's start is logged in `.claude/state/dispatches.jsonl` with its model. The journal says which model a story was handed out on, and which one it had run on when it was sent back, so you can see whether the smaller models are being sent back more often than they save.

## 0.23.0 (2026-10-23)

Worktrees no longer fill the disk, bug reports send once, and a batch of reported bugs is fixed.

- A worktree goes once it's done with: its branch's own commits are merged, it holds nothing uncommitted, and no agent of its lane still holds the story. This happens after each merge and, in the background, as each session starts, along with an interrupted merge's temporary checkout, worktrees whose folder is gone, and stray folders under `.claude/worktrees`. `code-kit worktrees` says why each one that stays is staying.
- A merged worktree that still holds uncommitted changes waits in the band for you, with what it holds. Keep leaves it; Discard removes it and keeps the changes as a patch under `.claude/state/discarded`. No agent can discard one.
- A branch made for an agent just dispatched, with no commits of its own, is no longer taken as merged (#61).
- Sending a bug report claims it first, so pressing Send again while GitHub is still filing it files nothing more. The report leaves the band at once, and the result is a toast; a pane opens only when it fails.
- `approvals.delegate.push` (or `code-kit settings set approvals.push lead`) lets the lead push the protected branch, read from the config committed there, never by force or delete. Left out, pushing stays yours (#63).
- A Python lane's packages are checked on PyPI for the delegated rules: licence, downloads, last release, and whether a release has wheels (#70).
- A check that runs out of time leaves its branch at the head of the merge queue instead of sending it back, and says how to give it longer with `timeoutSeconds` (#62). A failed check's output leaves out Node's warnings and leads with the lines that name the failure, and the queue records which check failed (#57).
- The commit hook logs a renamed protected file's old path (#74), and counts files staged in the same command by a brace list, a glob, a variable or a soft reset (#76), and a commit made with `cd <worktree> && git commit` in that worktree (#55). A branch's spec-check report is kept in the main checkout when its worktree goes (#55).
- No hand-back or restart prompt for a story that's merged and done (#59).
- `instructions --write` keeps the blank lines Prettier puts inside code-kit's markers (#77).
- `requests drop` drops requests that carry a session (#78).

## 0.22.1 (2026-10-23)

For projects on the hosted team provider, which is in preview:

- A session shows as live only when its own link to the provider is up. Before, one session's link made every session on the checkout look live.
- `code-kit team provider status` checks each part of the setup: this machine's sign-in, the config in the checkout and on the base branch, the MCP server, whether the provider sees the repository, and whether this session is linked. Each part that fails says what to do, and the last line says whether the repository is connected.
- `/code-kit:team-init` links the session it runs in once it connects, so there's no restart.

## 0.22.0 (2026-10-23)

A team's roles are settled by default: the lead decides what's technical, a lane runs one story at a time, and several sessions can work one project without their decisions crossing.

- With no `approvals.delegate`, the lead decides new packages within the registry rules, protected changes other than the specs, designs, CI and the kit, merges into the base, and a weakened test on a lane's branch after its review. A weakened test on the lead's own branch is still yours. Change who decides each one in the Settings tab's Approvals section, or with `code-kit settings set approvals.<name> lead|person`.
- The loop asks the lead, not you, about steps it didn't take and lanes that stalled. Those show in the band as notes.
- A lane runs one story at a time across the whole project. Starting a second agent for a busy lane is refused, and `code-kit lanes` shows what each lane is running.
- A story can belong to a slice (`**Slice:** <name>`). Lanes build the open slice's stories first (`harness.slices.open`, 1 by default), and take other ready work when the slice has none for them.
- Several sessions in one project: one leads and runs the loop, and the others are working sessions that stay quiet. A working session records its task and the paths it changes with `code-kit task`, and works in a worktree of its own. When git is blocked by another session's uncommitted files, the refusal names that session. `code-kit who`, `code-kit sessions` and `/code-kit:lead` are new.
- A decision belongs to the session that raised it. It's asked and answered only there, and other sessions see a count. This fixes the lead's questions appearing in every open session, and answers reaching the wrong lead. Calls Claude Code's own permission check refused no longer pile up as decisions; they show in the Lanes pane.
- Reports to a team provider now carry the plan's slices (report version 3).

## 0.21.0 (2026-10-21)

A project can keep its engineering rules as named standards, and code-kit applies each as firmly as it can.

- `docs/standards.md` holds the project's standards, each with a category (principles, patterns, architecture, conventions or policies), a level (required or recommended) and how it's applied: enforced by a rule the project already has, checked in review, or given to agents as advice. `code-kit standards` says what's wrong with the file.
- `/code-kit:init` suggests standards after the layers: from the specs, citing where each came from, or from the code, with its evidence ("41 of 43 modules"). A pattern the code follows only partly is put to you as a choice. Nothing is written until you approve each one. An existing project gets the step on its next init.
- Each lane agent is given the standards for its own layers, one line each, and the lead sees them all. Engineering rules move out of `docs/principles.md` into the standards; principles keeps the definition of done, the commands and the privacy targets.
- A refusal from a rule a standard names now names the standard. Reviews send back a branch that breaks a required checked standard, citing its id.
- `docs/standards.md` is protected. Adding a recommended standard can be left to the lead, but removing one or weakening a required one always needs your approval, and `verify` checks it.
- A team provider can supply an organisation's standards. A project can extend or tighten them, and weaken one only with a waiver the provider confirms.
- Reports to a team provider now carry the project's standards (report version 2).

## 0.20.0 (2026-10-21)

A team provider can now receive a report of a project's facts, and a hosted provider's adapter is in preview.

- A team provider can receive a report of the project: each story's stage and when it changed, milestones and their targets, send-backs, the requirement trail, approvals, token use by kind of agent, and the project's rules. A report never holds code, diffs or prompts; its fields are a fixed list, and anything else is refused before it's sent. With GitHub as the provider, nothing is sent anywhere.
- `code-kit team report --dry-run` shows exactly what would be sent, and `team.report: false` turns reports off.
- A milestone in the plan can have a target date: `**Target:** 2026-11-30` under its heading.
- A hosted provider's adapter is in preview. It runs only for a project whose config names one, connects through code-kit's own hooks with GitHub as its fallback, and doesn't need a Discussions category for intents.
- A decision record now names whoever agreed the intent, not always the tech lead.

## 0.19.0 (2026-10-19)

A build uses far fewer tokens. In two days of two builds, output was under 1% of the tokens: nearly all of it was agents rereading large contexts on every request.

- Each lane agent builds one story. A send-back, or a story carried on, goes to a fresh agent, never to the one that built it. Lane agents had reached 900k to 970k tokens of context over hundreds of requests.
- A lane agent past `agents.lanes.contextLimit` (250,000 tokens by default) is told to finish its step, commit, write its report and hand back. The loop then has the lead carry the story on with a fresh agent that reads that report first.
- `code-kit worktrees` lists the project's worktrees. `worktrees release <branch>` frees one for a fresh agent, keeping the branch's commits and moving its report to the main checkout, and `worktrees prune` removes every one that's merged and clean. One project had 11 such leftovers, about 4.5 GB; `code-kit next` now points them out.
- The lead's context is compacted between turns once it's past `compact.at` (40% of its window by default), without asking. Waiting for a milestone wasn't enough: one lead reached 968k tokens first.
- The loop reads the lead's replies with Sonnet, from the reply itself. Before, it forked the lead's whole conversation on the lead's own model at the end of every turn.
- Lane agents read every file they change in full, but of its imports and callers only what the change needs; a fresh Context Graph card counts as reading a file. They run the narrowest tests with failures only in the output, and the full suite once before committing. The lead's review starts from the lane's report, the reviewer's findings and the diff's summary.
- `agents.reviewer.model` now defaults to Sonnet and covers the security reviewer too, unless its agent file names a model.
- The lane rules changed, so `code-kit next` asks the lead to bring code-kit's instructions up to date.

## 0.18.0 (2026-10-17)

code-kit's instructions to your agents now keep up with code-kit, it tells you when something needs you, and the fixes found by checking two live builds.

- Re-running `/code-kit:init` never updated code-kit's section of CLAUDE.md or the lane agents' `Always:` rules, so the rules from 0.16.0 and 0.17.0 never reached projects already set up. `code-kit instructions` now renders both from the templates and your config, between `<!-- code-kit:begin vN -->` and `<!-- code-kit:end -->` markers, and says whether each file is current, behind or written before the markers. `--write` brings marked parts up to date and never touches anything outside them. A part written before the markers, often tailored by an earlier init, is merged once by the lead, keeping your own lines. While any is behind, `code-kit next` says so before any other step and the loop asks the lead to update them. Init writes them with the same command.
- With Claude Code 2.1.301 or later, code-kit raises a system notification when something new needs you, such as an approval, a question from the lead, a stalled lane or a merge that's yours: "code-kit: the lead asks you". Each decision is notified once, and `notify.on` turns it off.
- **w** on a working lane in the Lanes pane puts that lane agent's transcript in the main view (Claude Code 2.1.301 or later).
- The loop no longer prompts the same story over and over. A story waiting on another wakes only when that story changes state, not on each of its commits, and a story the lead's turn left where it stood is parked whatever the reply said. In one build, "Review ST-160" had been prompted 31 times.
- A lane's hand-back of more than ten lines or 1,200 characters is refused by the stop hook, which also finds the report in the main checkout.
- Lanes may write scratch files in Claude Code's own temporary folder, and `git diff`, `log` and `show` may read the audit log's history.

## 0.17.0 (2026-10-17)

The lead's context stays lean: lanes report to a file, and the lead's context is compacted when a milestone finishes.

- A lane on a story's branch now writes its full report to `.claude/state/reports/<branch>.md` before it finishes: what it did, the commands it ran with their output, what's left, and anything it needs decided. It hands the lead at most ten lines naming that file. The stop hook won't let a lane finish without the report, and the review, dispatch and decide skills read it when they need the detail. Before, every lane pasted its whole report, output included, into the lead's context; in one project that was about 236k of the lead's 780k tokens.
- Lanes don't message the lead while they work. They hand back once, when they finish or when they're blocked.
- When a milestone finishes during the session, the lead's context is compacted before the loop's next step, as the new `harness.compact.milestone` setting says: `ask` (the default) asks you in Claude Code's dialog, `auto` compacts at once, and `off` leaves it alone. The summary keeps the stories in flight and what waits on you, and drops the finished stories' detail. It's skipped when the context is under 25% full.
- Re-run `/code-kit:init` to update your lane agent files with the new reporting rules. Until then, the stop hook tells each lane what to do.

## 0.16.1 (2026-10-16)

The lead loop stops asking for stories that are waiting on other work.

- When the lead says a story isn't due yet because it waits on work still going, such as a paired story a lane is building, a rebuild or a check running, the loop parks that story. A parked story is left out of every step, so a step that names it with others prompts the lead only for the others. Before, the loop held a declined step only while the step stayed exactly the same, so when one more story became ready, or any lane committed, it prompted the same reviews again.
- A parked story wakes when what it waits on moves: its own branch or state, the stories the lead named, or the unfinished stories in the plan that depend on it. Other lanes' commits don't wake it. After 30 minutes with nothing moving, the lead is asked once more.
- The band's next row says what each parked story waits on. A step the lead declined for another reason no longer holds up every other step.

## 0.16.0 (2026-10-16)

The lead runs the team inside your guardrails, and lanes ask the lead, never you.

- You decide what crosses a guardrail: changes to the specs, the contracts and the architecture's rules, the screens' visual design, CI, weakened tests, and product questions the spec doesn't answer. The lead decides the rest, as `approvals.delegate` names it. `/code-kit:init` proposes that split and asks what else you want to keep; re-run it on an existing project to get the split, and the new wording in CLAUDE.md and the lane agent files.
- A lane refused something the lead decides is told so, with no `!` command and no mention of you. It hands the lead a change request with what it needs, the story and requirement, and what it checked first. The call isn't held, and nothing reaches your band. `code-kit requests` numbers each request and says whose it is to decide.
- The new `/code-kit:decide` skill judges each request on its merits. A package is approved only when the story's requirements need it, nothing the project already depends on does the job, and it fits the principles and the lane's layer; otherwise the lead tells the lane what to use instead. Only what crosses a guardrail comes to you, with the lead's recommendation. `code-kit next` returns `decide` while a lane waits on the lead, so the loop prompts it before reviews and dispatches.
- `code-kit approve --delegated` takes a package for a story: `--story ST-n`, checked against the plan, and recorded in the audit log. The npm registry rules apply only to npm's packages. A Python, Rust, Go or Ruby package used to be looked up on npm and sent to you; it's now the lead's judgement.
- The mod no longer approves calls within the delegated rules by itself. Every approval the lead gives now comes with its reasons.
- UX is the lead's to decide from the spec and the principles you agreed, such as what a screen does on an error or an empty list. A screen's visual design is still yours to approve.

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
