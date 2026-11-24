# 32. A project on a cloud machine

**Status:** built, and run end to end with a throwaway project on a real Sprite (21 November 2026). One of the person's own projects went up on 22 November 2026 and passes every check in its clone there; its lead's session hasn't been opened yet
**Outcome:** A person can move a code-kit project's work onto a cloud machine they own: the lead session, its lane agents, their worktrees, the checks and the merge queue all run there on the person's own Claude subscription, the work reaches GitHub from there, and the person's computer only connects to it.
**Actors:** the person (chooses the platform, signs in to Claude and GitHub on the machine, opens and closes the lead's session, sets the budget); the lead and its lane agents (work on the machine as they do on a computer); the merge queue
**Depends on:** 05-lead-loop, 09-merge-queue, 23-the-team, 26-durable-lanes, 29-running-cost

One Mac running several code-kit projects sat at a load of 32 on 28 cores (the spike, `docs/spikes/cloud-lanes.md`). The Claude sessions used under one core between them. The rest was what they run: test suites, simulations, browser tests, and the merge queue's checks of every merged tree. Every project adds its own, and they all land on the one computer.

The spike tried a Fly Sprite as the place for that work, and the pieces hold. A Claude session there ran on the person's subscription after a sign-in in its console. code-kit installed by script, and its hooks held the lead and a lane agent to their paths with no change to code-kit. A commit made there reached GitHub in under two seconds as the person. The machine is created in a second, keeps its disk, and bills its disk alone while it sleeps, about 7 cents a month for the 3.4 GB that one held.

So the whole project moves, and nothing in it is split across machines. The lead's session runs on the machine, its lane agents are its sub-agents there, and the worktrees, the installs, the event log and the queue are files on the machine's disk, as they are on a computer today. The rules need no second form. What this spec adds is getting a machine ready, opening the lead's session on it from any computer, keeping the project in one place at a time, letting the machine sleep when nothing is moving, and bringing the project home.

One machine carries one project: 8 cores and 16 GB on a Sprite, and its cores looked slower than the Mac's. A project that outgrows that gets lanes on machines of their own, which is a later spec.

## Decisions

| Date       | Decision                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-20 | The whole project runs on one machine; a machine per lane waits until a project needs it                                                                                                                                 | A lane agent is a sub-agent inside the lead's process, so moving the lead moves them all with no state crossing machines. A lane on another machine needs its claim, its questions and its hand-back carried                                                                                                                         |
| 2026-11-20 | Each platform is an adapter under `hooks/lib/adapters/`, Sprites first                                                                                                                                                   | The core never names another tool                                                                                                                                                                                                                                                                                                    |
| 2026-11-20 | The machine is the person's own, found through their own sign-in; the config names the platform, not the account                                                                                                         | The project's source goes nowhere that isn't the person's, and a team shares one config                                                                                                                                                                                                                                              |
| 2026-11-20 | The person signs in to Claude on the machine themselves, and code-kit never reads, copies or passes on that sign-in                                                                                                      | Anthropic's terms rule out a product that collects, stores or passes on these credentials                                                                                                                                                                                                                                            |
| 2026-11-20 | The lead's session on the machine runs with Claude Code's permission prompts off                                                                                                                                         | Nobody is attached to answer a prompt while the loop works, and in the spike a session with prompts on refused the lane's own report. code-kit's refusals held with them off. The machine is the sandbox                                                                                                                             |
| 2026-11-20 | The machine starts from the remote, and work in flight on the computer is finished or pushed before the move                                                                                                             | `.claude/state` (claims, the queue, the event log, decisions waiting) isn't in git and isn't worth carrying mid-story                                                                                                                                                                                                                |
| 2026-11-20 | A project is worked in one place at a time                                                                                                                                                                               | Two leads on two machines would dispatch the same stories, each with its own claims                                                                                                                                                                                                                                                  |
| 2026-11-22 | A machine with an address of its own serves the lead's session as a terminal in a browser, behind the platform's sign-in, unless the config turns it off                                                                 | A phone has no `cloud open`, and the hub's page for a machine opens this address. The only thing in front of it is the platform's own sign-in to the account that holds the machine; code-kit adds no password of its own to keep                                                                                                    |
| 2026-11-22 | A question the lead's session asks the person, or a plan it waits for them to approve, ends the session like any other quiet once it has waited `idleMinutes`, and the next session asks it again                        | The first real project's session waited at a question for seven hours with the machine awake and billing. A machine that waits on a person costs what one that works does, and the person asked for no idle machine to run on. The conversation is kept, so only the question's place in it is lost, and asking again puts that back |
| 2026-11-23 | A machine can be made, started, stopped and removed by a workflow the repository commits, with nobody at a computer. The sign-ins to GitHub and to Claude stay out of it: the machine's owner types them at its terminal | A person with only a browser, a phone included, has no `cloud up`. A workflow can hold the platform's token as the repository's secret, and can't hold a person's sign-in without becoming a holder of it                                                                                                                            |
| 2026-11-23 | The machine's first clone is the workflow's own checkout, sent as one bundle                                                                                                                                             | The machine can't clone until someone signs it in to GitHub, and the only token a workflow has is its own. Sent this way, no credential reaches the machine but its owner's                                                                                                                                                          |
| 2026-11-23 | Sprites stays the first platform. GitHub Codespaces would be a second adapter, for work the person is connected to                                                                                                       | Tried on 23 November 2026: a codespace nobody is connected to by SSH or an editor is stopped at its idle timeout, with a tmux session printing and with a browser on its terminal page too, so a lead left to work is killed mid-story. A Sprite holds itself awake from inside                                                      |
| 2026-11-23 | A hosted team provider that asks for a machine names itself in the workflow's inputs, by its address. The machine keeps the address, and its owner chooses at its terminal whether to pair                               | A repository can have a machine before it has a config, so the config can't be where the machine learns who asked. The address is no secret. Nothing of the provider is installed, and nothing is paired, until the machine's owner says yes there                                                                                   |
| 2026-11-23 | On a paired machine there is still one lead's session, started by code-kit whoever asks for it, with what the provider needs to see it                                                                                   | Two ways of starting a session on one machine are two leads waiting to happen (CLOUD-6). The provider's own start runs code-kit's `cloud join`, and the workflow's start and the terminal's run the same steps                                                                                                                       |
| 2026-11-20 | This is part of code-kit, free, from a terminal. Reaching the machine's sessions through the hub is the hub's                                                                                                            | Nothing here needs a service: the person's own platform account and command line are enough                                                                                                                                                                                                                                          |

## In scope

- `cloud` in the config, and what `check` says about it.
- The machine adapter's interface, and a Sprites adapter.
- `code-kit cloud up`: a machine made ready for the project, with the two sign-ins the person does.
- `code-kit cloud open`: the lead's session there, in a terminal that stays when the person leaves.
- The same session as a terminal in a browser, at the machine's own address, that a phone can work in.
- The machine workflow: one file a repository commits, which makes the machine, starts and stops its session and removes it, with nobody at a computer.
- The owner's first visit to the machine's terminal, which asks for the sign-ins only they can give.
- Pairing the machine with the hosted team provider that asked for it, offered to its owner on that visit.
- Work reaching GitHub from the machine with the computer off.
- The computer knowing the project is on its machine.
- Ending an idle session so the machine sleeps, and `code-kit cloud stop`.
- `code-kit cloud`: the machine's state, its sign-ins, what's open, and what isn't on the remote yet.
- `code-kit cloud down`: the project brought home and the machine removed.
- The machine's line in the cost register.

## Out of scope

- A machine per lane, with the lead elsewhere. A later spec, when a project outgrows one machine.
- What the hub's companion does on the machine, and its assistant starting or answering sessions there. That's the hub's own spec. Here, code-kit offers the pairing, keeps the companion running and starts the lead's session so the companion sees it (CLOUD-16).
- Carrying a story in flight from the computer to the machine.
- Prices. code-kit holds none (spec 29).
- Docker on the machine. A project whose checks need it can't move to a Sprite (see the open questions).

## Data

| Entity   | Where                                                       | Fields                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud    | `.claude/code-kit.json` → `cloud`                           | `{ "<adapter>": { its options } }`, with `prepare` (a command), `carry` (paths of ignored files and folders to copy there), `idleMinutes` (30 unless set) and `terminal` (true unless set)                                         |
| Machine  | the platform, in the person's account                       | its name (from the project), the project's clone, the installs, Claude Code with its plugins, the person's two sign-ins, the lead's session                                                                                        |
| Marker   | `.claude/state/cloud.json`, on the computer                 | the machine's name, the adapter, when the project went up, and the address of its terminal in a browser when it serves one. The machine's own copy also keeps the hosted team provider that asked for it, where one did (CLOUD-16) |
| Activity | `.claude/state/cloud-activity.json`, on the machine         | when the person last sent a prompt, when the watcher last looked, the awake seconds counted so far this month                                                                                                                      |
| Workflow | `.github/workflows/code-kit-machine.yml`, in the repository | code-kit's own file for the platform and version: the inputs `act`, `request`, `discard` and `provider`, and the one secret the platform's sign-in reads (CLOUD-15)                                                                |

An example:

```json
"cloud": { "sprites": {}, "prepare": "npx playwright install --with-deps chromium", "carry": [".env.local"] }
```

## Requirements

### CLOUD-1 The config names the platform

`cloud` names one adapter by its key, with its options, and may set `prepare`, `carry` and `idleMinutes`. Without `cloud`, nothing in this spec applies. `prepare` is a command run on a new machine, and again when the command changes: the tools the project needs that the platform's image lacks. `carry` lists files and folders git ignores that the project can't run without, such as `.env.local` or a folder of generated content its tests read. `check` names a `cloud` with no adapter or two, options an adapter doesn't take, a `carry` entry that git tracks (or a folder git tracks part of) or that leaves the project's folder, and an `idleMinutes` that isn't a whole number of 5 or more.

**Acceptance**

- Given no `cloud`, then `code-kit cloud` says the project names no platform, and how to name one.
- Given `"cloud": { "sprites": {}, "carry": ["src/app.ts"] }` where git tracks `src/app.ts`, then `check` says `carry` is for ignored files and that one already travels with the clone.
- Given `carry` names a folder git tracks part of, then `check` says so, and to name the ignored files and folders inside it.

### CLOUD-2 The machine adapter

The core reaches a machine through one module, which never names a platform. An adapter says its key, the options it takes, and these operations:

| Operation   | Given                                                            | Answers                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs`     | nothing                                                          | What the platform needs on the computer: for each, whether it's there, the command that installs it or signs in, and where that command comes from        |
| `ready`     | nothing                                                          | The project's machine, made if it wasn't there                                                                                                            |
| `run`       | a command, the folder to run it in, a time limit                 | The exit status, whether it ran out of time, and the end of its output                                                                                    |
| `put`       | a file on the computer, and where it goes                        | Whether it arrived                                                                                                                                        |
| `terminal`  | a command, and the folder to run it in                           | The person's terminal joined to that command on the machine, until it ends or they detach                                                                 |
| `state`     | nothing                                                          | The machine, the sessions open on it and since when                                                                                                       |
| `release`   | nothing                                                          | Whether the machine was removed                                                                                                                           |
| `stayAwake` | a number of seconds; run on the machine itself                   | Whether the platform will keep the machine running that much longer with nobody connected (CLOUD-7)                                                       |
| `maySleep`  | nothing; run on the machine itself                               | Whether that hold was let go                                                                                                                              |
| `address`   | nothing                                                          | The machine's own web address, whether anyone who has it can open it, who the platform lets in, and the command that makes an open one private (CLOUD-12) |
| `serve`     | a command, its arguments, a folder and a port                    | Whether the platform now keeps that command running on the machine, starts it again after a sleep, and routes the address to the port                     |
| `unserve`   | nothing                                                          | Whether that was taken away                                                                                                                               |
| `install`   | package names                                                    | Whether the machine's image now has them, from the image's own source                                                                                     |
| `keep`      | a name for it, a command and a folder; run on the machine itself | Whether the platform now keeps that command running on the machine, and whether it had to be made. It carries on when the machine wakes (CLOUD-16)        |

`address`, `serve`, `unserve` and `install` are for the terminal in a browser, and an adapter whose platform gives a machine no address leaves them out. `keep` is for what a paired provider runs on the machine, and an adapter without it leaves that to the person.

`needs` is how code-kit learns what to ask the person for without knowing the platform: its command line, and a sign-in to it. An adapter that can't reach its platform for any other reason (the platform doesn't answer, the account can't make a machine) says which, and every `cloud` command passes that on with what to do. The sessions code-kit keeps on a machine (the lead's, and the watcher's) are tmux sessions it starts through `run`, so they're the same on every platform, and a platform whose image has no tmux gets it from `prepare`.

**Acceptance**

- Given an adapter whose `needs` names a command line that isn't installed, then `cloud up` asks about it by the name, command and source the adapter gave (CLOUD-3).
- Given a platform that doesn't answer, then `cloud up` says so in the adapter's words and changes nothing.

### CLOUD-3 `cloud up` makes the machine ready

`code-kit cloud up` is run by the person, on the computer, in the project. It can be run again at any point and does only what's left. In order:

1. It checks what it needs on the computer: git, and whatever the adapter's `needs` lists. For each thing missing it shows the exact command that installs it or signs in, says where that comes from, and asks before running it. It never installs unasked, since the command downloads and runs someone else's program on the person's computer. A sign-in that needs the person's browser is run in their terminal, and code-kit reads nothing it stores. Declined, or run where there's no terminal to ask in (a Claude session running it for the person), it stops with the commands for the person to run themselves.
2. It stops if the move would leave work behind: stories running or queued here, decisions waiting on the person, lane branches that aren't on the remote, or merges into the base that aren't published (MQ-6). It names each and what to do with it.
3. It makes the machine and clears what the platform's image would get wrong (CLOUD-11).
4. It checks the two sign-ins, asks about each one that's missing, and carries on in the same run once the person has signed in. For GitHub it starts gh's device sign-in on the machine and shows the code to enter at GitHub, then sets git on the machine to use that sign-in, which a device sign-in started with no terminal leaves undone. For Claude it joins the person's terminal to Claude Code's own sign-in on the machine. Declined, or run where there's no terminal, it stops and says to run `code-kit cloud signin`, which is that same sign-in as a command of its own. code-kit never reads either credential.
5. It clones the project from its remote, and sets the clone's git name and email to the ones the computer's clone uses.
6. It installs code-kit there from its marketplace, or updates it when its version differs from the computer's, and installs the plugins the project's own settings enable.
7. It runs `prepare` and copies what `carry` lists. A folder goes as one archive, and is copied again only when a file in it was added, removed or written since the last copy, so a later `up` doesn't send it twice. Files the machine has in that folder that the computer doesn't have are left there. When something `carry` lists doesn't arrive, `up` stops there, says which and why, and leaves the project's work on the computer, since its checks may not pass on the machine without it. Run again, it copies what's missing and carries on.
8. It writes the marker on the computer and says how to open the lead's session.

It then names the plugins Claude Code lists on the computer and not on the machine, and says that MCP servers and tools on the computer (a design tool, a browser) can't be reached from there. `code-kit cloud console` is a shell on the machine, for what only the person can put right there.

**Acceptance**

- Given a computer without the platform's command line, then `up` shows the install command and its source and asks; on yes it installs, goes on to the sign-in, and carries on.
- Given the person answers no, then nothing is installed, and `up` stops with the install and sign-in commands to run by hand.
- Given `up` run by a Claude session with the command line missing, then it installs nothing and tells the session what to ask the person to run.
- Given the command line installed and the person not signed in to the platform, then `up` asks only about the sign-in.
- Given a story running on the computer, then `up` stops, names the story, and says to finish it or hand it back first.
- Given a machine with no sign-in to Claude and the person at a terminal, then `up` asks, joins them to Claude Code's sign-in on yes, and carries on to the clone in the same run.
- Given the same machine and no terminal, or the person answers no, then `up` stops after making it, says to run `cloud signin`, and a second `up` after the sign-in carries on from the clone.
- Given `carry` names an ignored folder with a folder inside it, then `up` copies every file in both to the same paths in the clone, and says how many files and how much.
- Given that folder unchanged, then a second `up` says it's there as it is here and copies nothing.
- Given a file changed in it on the computer and a file the machine made in it, then the next `up` copies the folder again and the machine's file is still there.
- Given the connection dropping while a carried folder is sent, then `up` stops, names the folder and the platform's error, never says the machine is ready, and writes no marker; a second `up` copies it and finishes.
- Given a machine signed in to GitHub by the device sign-in, then the clone that follows asks for no username.
- Given `up` run twice on a ready machine, then the second run changes nothing and says it's ready.
- Given an `ANTHROPIC_API_KEY` set on the machine, then `up` stops and says it would be used in place of the subscription, and to remove it.
- Given a commit made on the machine afterwards, then its author is the name and email of the computer's clone.

### CLOUD-4 `cloud open` is the lead's session

`code-kit cloud open` starts Claude Code in the project's clone on the machine, in a tmux session, with permission prompts off, and joins the person's terminal to it. A session already open there is joined, never started twice. Detaching (Ctrl-b, then d) leaves it working. Run where there's no terminal, it starts the session and says how to join it. A machine's first session waits at Claude Code's own first-run questions (its theme, whether to trust the folder, working without permission prompts), which are the person's to answer, so a first `open` with no terminal says the session waits for them and that nothing runs until they join it. Where an earlier session ended (CLOUD-7), the new one continues its conversation. It's the lead session because it's the first in that checkout (SESS-2), and its lane agents are its sub-agents with their worktrees on the machine, so every rule code-kit enforces on a computer is enforced there by the same hooks.

**Acceptance**

- Given a ready machine with no session, then `open` starts one, and `code-kit sessions` there shows it as the lead.
- Given a machine no session has run on and no terminal, then `open` starts the session and says it waits at Claude Code's first-run questions for the person.
- Given the person detaches while two lanes are working, then both lanes finish their stories and the queue merges them with nobody attached.
- Given `open` from a second computer signed in to the same platform account, then it joins the same session.
- Given a lane agent on the machine that writes outside its lane, then it's refused with the message it would get on a computer.

### CLOUD-5 Work reaches GitHub from the machine

Lane branches are pushed, and merges into the base published as `branches.publish` says (MQ-6), from the machine, as the person, with the computer off. The team provider, `ci usage` and pull requests use the machine's gh sign-in as they use the computer's. That sign-in is the person's step (CLOUD-3), and `cloud` shows its login and the scopes gh reports, since a device sign-in gives a token for every repository the person has.

**Acceptance**

- Given the computer asleep, when a story is dispatched, reviewed and merged on the machine, then its merge is on the remote's base as `branches.publish` says.
- Given the machine's gh signed in as someone other than the computer's, then `cloud up` and `cloud` name both logins and stop for the person.

### CLOUD-6 One place at a time

While the marker is on the computer, the project is worked on its machine. A Claude session starting in the project on the computer is told so, and how to open the machine's. `next` there answers with that step. A lane agent started there is refused, with the reason and the two ways on: `cloud open`, or `cloud down` to bring the project home. Reading the code, and the person's own commits, are never refused.

**Acceptance**

- Given a project that's up, when the lead on the computer dispatches a story, then the lane agent is refused, naming the machine and both commands.
- Given `cloud down`, then the next dispatch on the computer goes ahead.

### CLOUD-7 An idle machine sleeps

When a Sprite with nobody connected is paused can't be predicted from outside it. Fly's documentation says a Sprite pauses about 30 seconds after its activity stops, and counts as activity a request being served, a platform session producing output, and an open connection. A tmux session is none of those. Measured, it varied: in eight windows of four to nine minutes with nobody connected, a Sprite was paused in two (a silent wait in the spike, and an idle lead with the first watcher beside it, which ended that session five minutes late), and ran throughout in six, with a silent wait, a tick each minute, or an idle Claude Code on it. A pause stops everything on the machine, a lane's test run included, until something connects.

The platform gives one way to rule a pause out: a hold the machine places on itself through its own management socket, which lasts an hour at most and is asked for again while the work goes on. So `open` starts a watcher beside the lead's session, and it does two things. Each minute it asks the adapter to keep the machine running for three minutes more (`stayAwake`), so work that waits quietly isn't frozen, and a watcher that dies leaves a hold that runs out by itself. And when no agent is running, the queue isn't merging, no tool call (DUR-1) is running, and there's been no tool call and no prompt from the person for `idleMinutes`, it ends the lead's session, lets go of the hold (`maySleep`) and stops, and the machine sleeps. What waits on the person stays in its files, and the next `open` continues the conversation and says why the last one ended. `code-kit cloud stop` ends the session at once, from the computer.

A tool call counts as running from its start to its end. One that a guard refuses gets no end, so each is noted against its session and agent, and an agent's turn ending clears that agent's: otherwise a refused call would hold the session open until it went stale twelve hours later, which is what the first real run did. A new session starts with none noted.

A question to the person is a tool call too, open from when it's asked until they answer, and so is a plan that waits for their approval. Neither is work, so each is noted apart from the calls that run, and the watcher counts the wait as quiet: a question unanswered for `idleMinutes` ends the session as an idle one is ended, unless a lane agent is working beside it. The session's end takes the question with it, so the record of the end says a question was waiting, and the next session, which continues the conversation, is started with one line that tells the lead to ask it again. A session stopped from the computer at a question is started the same way. While a question waits, `code-kit cloud` says so on the computer, with how long it has before the session is ended.

**Acceptance**

- Given `idleMinutes` of 30, a finished milestone and nobody typing, then 30 minutes after the last tool call the session is gone from the machine's sessions.
- Given a lane's test run that takes 40 minutes, then the session isn't ended while it runs.
- Given a session ended as idle, then `open` continues its conversation and says it was ended after 30 idle minutes.
- Given a tool call one of code-kit's guards refused, then once that agent's turn has ended it no longer counts as running, and the idle session is ended on time.
- Given a question the lead asked the person and `idleMinutes` of 30, when nobody answers for 30 minutes and no lane agent is working, then the session is ended and the machine holds no keep-running hold.
- Given a session ended at a question, then `open` says it was ended after its question waited 30 minutes, continues the conversation, and the lead asks the question again without being told to by the person.
- Given a question waiting and a lane agent's test run beside it, then the session isn't ended while the run goes on.
- Given an open session with nobody connected, then the machine holds the platform's keep-running hold, renewed each minute, and holds none once the session has ended.
- Given `cloud stop` while a lane is working, then it names the lane and the story and asks the person to confirm before it ends them.

### CLOUD-8 The person can see it

`code-kit cloud`, on the computer, shows the machine and its platform; the Claude sign-in (the kind of account and when it ends) and GitHub's (the login and scopes); the sessions open on it and since when; the hours it's been awake this month; its load, memory and disk; code-kit's version there against the computer's; and what's on the machine that isn't on the remote: branches, merges not published, and worktrees with uncommitted files. `--json` gives the same for tools. `next` on the computer names, from the report `cloud` last read (asking the machine would wake it each time the loop looks), as attention, a Claude sign-in that has ended or ends within three days, and a code-kit version there behind the computer's.

The awake hours come from the machine's own uptime, which the spike showed stops counting while a Sprite sleeps. The watcher adds it up, and where the platform restarted the count, `cloud` says since when the figure runs.

The machine's own code-kit gives the report (`code-kit cloud here`, run on the machine), so a hosted provider's part there (CLOUD-16) can pass it on without the computer. For that reader it also says the machine's name, its platform and its terminal's address; which of the open sessions is the lead's and which the watcher's; what the lead's session is doing, by the watcher's own order (CLOUD-7): working while a tool call, a lane or a merge runs, waiting when only a question to the person is open, idle otherwise; and after how many idle minutes a session is ended. The three days a sign-in is named within are one number, which a hub reads from code-kit.

The report also says what the work waits for that has a time on it, so that whoever reads it can start a sleeping machine when the wait is over. There are two such waits. Claude's usage limit ends a turn with an error, and Claude Code writes when the limit resets on that turn's last entry (`quotaLimits.resetsAt`); the Stop hook reads the field and the machine keeps the time, whichever session or lane agent met the limit, since the limit is the account's. A tool call starting afterwards means Claude answers again, and the note goes. The other is a story the lead holds until a date (LOOP-15): the first hold to end. The limit comes first while it's in force, since nothing works until it resets. The report gives one wait: what it's for, until when, and the story where it's a hold. `cloud` on the computer says it too. A turn ended by anything else, or with no time on it, is no wait.

**Acceptance**

- Given a lane branch on the machine that was never pushed, then `cloud` lists it under what isn't on the remote.
- Given the lead's session open on the machine with a test run going, then the machine's own report names the machine and its platform and says the lead's session is working; with nothing running it says idle; and once the watcher has ended the session it says nothing is open.
- Given a Claude sign-in that ends in two days, then `cloud` and `next` say so, and that the person signs in again with `cloud signin`.
- Given a lead's turn on the machine ended by Claude's usage limit, which Claude Code says resets at 15:10, then the machine's own report says the work waits for the limit until 15:10; once a tool call starts there again, it says no wait.
- Given ST-4 held until 10 November and nothing limited, then the report says the work waits for that hold until then, with the story.
- Given code-kit 0.39.0 on the machine and 0.40.0 on the computer, then `cloud` shows both and says `cloud up` brings it level.

### CLOUD-9 `cloud down` brings the project home

`code-kit cloud down` stops while anything on the machine isn't on the remote, or a story is running there, naming each (CLOUD-8's list). With nothing left behind it ends the sessions, removes the machine, and with it both sign-ins, removes the marker, and tells the person to pull. `--discard` removes the machine with what's left on it, after listing what will be lost; it's the person's act, and no Claude session may run it.

**Acceptance**

- Given an unpublished merge on the machine, then `down` stops, names it, and says to publish it from the machine.
- Given everything on the remote, then `down` removes the machine and the marker, and `cloud` says the project is on this computer.
- Given the lead's session on the computer running `cloud down --discard`, then it's refused as the person's act.

### CLOUD-10 The machine is in the cost register

A machine is a paid thing, so spec 29 applies. With `cloud` in the config and a budget set, `code-kit cost` names a missing register row for the machine as a problem. The lead estimates the row from the platform's published prices and the awake hours `cloud` reports, and its Basis says which it used. Reading the platform's own meter is COST-8's.

**Acceptance**

- Given `"cloud": { "sprites": {} }`, a budget, and no register row for the machine, then `cost` names the missing row.

### CLOUD-11 The Sprites adapter

The adapter's key is `sprites`. It works through the `sprite` command, in the organisation the person's sign-in selects, and never reads its token. Its `needs` are that command, installed by Fly's own installer from sprites.dev (it checks the download against its SHA-256 and puts `sprite` in `~/.local/bin`), and `sprite login`, which opens the person's browser and has to run in a terminal. A project has one Sprite, named from the project's folder and a hash of its remote's address, so a second computer finds the same one. Its `ready` makes the Sprite if there's none, empties the image's global git ignore (it ignores `.env.*`, `build/`, `dist/` and `target/`, which would leave a project's files out of commits made there), and replaces the image's git identity (`Sprite <noreply@sprites.dev>`). `terminal` is `sprite exec --tty`, and `state` lists the platform's own sessions, which are the terminals joined to it. `put` names a full path, since the platform expands no `~` in one, and sends the file as the input of a command on the Sprite, checking the bytes that arrived against the file's size. The platform's own file upload is a single request that it ends after 30 seconds: a 224 MB archive got through it once in a trial at about 30 seconds, then failed twice when the project went up, and a 600 MB file failed at 31 seconds. Sent as a command's input, 600 MB arrived whole in 51 seconds. The status the platform reports read `cold` whether the Sprite was awake or not, so it isn't used.

A Sprite's hosts file gives `localhost` the Sprite's own network address (`fdf::1`) ahead of the loopback one, and Node takes the first address it's given. A dev server told to listen on `localhost`, which is Vite's default, then listens on that address, while a browser on the Sprite looks for `localhost` at `127.0.0.1` and `::1` only. Every browser test of one real project failed that way with a refused connection. So every command the adapter runs on a Sprite sets Node to take IPv4 addresses first (`--dns-result-order=ipv4first` in `NODE_OPTIONS`), and the lead's session and everything started from it inherit that. The server then listens on `127.0.0.1`, which the browser reaches and the platform's port forwarding reaches too. A machine that already sets an order keeps its own.

A Sprite's address is `https://<name>-<organisation>.sprites.app`, read from `sprite info` with its auth setting. `sprite`, which a new Sprite has, puts Fly's sign-in in front of it and is the only setting the adapter reads as private. `serve` is one of the Sprite's own services, `code-kit-terminal`, made on the Sprite with `sprite-env services create` and given the Sprite's HTTP port. A Sprite routes its address to one port, so the terminal takes the address from a web app a project was showing there, and `"terminal": false` gives it back. A service's arguments are one comma-separated list, so `serve` refuses a path that holds a comma, a space or a quote. `install` is `apt-get` through `sudo -n`, which a Sprite's user may run.

**Acceptance**

- Given a project with no Sprite, then `cloud up` makes one and names it.
- Given two projects, then each has its own Sprite.
- Given a tracked file `build/main.ts` changed by a lane on the Sprite, then its commit includes it.
- Given the lead's session started on a Sprite, then it and the watcher have Node's IPv4-first order set.
- Given a Sprite that sets an order of its own, then a command run there keeps it.

### CLOUD-12 The lead's session in a browser

A machine whose platform gives it an address of its own serves the lead's session there as a terminal, so the person can work from a phone or any browser without the platform's command line. `cloud up` sets it up after the clone and code-kit are in place, and again on every run:

1. It asks the adapter for the machine's address. An address open to anyone who has it serves no terminal: `up` says so with the adapter's command that makes it private, takes away a terminal it served before, and carries on.
2. It installs ttyd through the adapter where the machine's image lacks it.
3. It builds the page. ttyd's own page is read from a ttyd started for a moment on a port only the machine reaches, and code-kit's part (`templates/cloud-terminal.html`) is put at the end of its body. The page goes to the machine as a file.
4. It writes what the terminal runs for each browser: a script that sets the `PATH` and Node options the adapter's commands have there, which a platform's service may not be given, and runs `code-kit cloud join` in the clone.
5. It has the adapter serve ttyd with that page and script on port 7681, with the address routed to it, started by the platform when a request arrives, after a sleep too.
6. It writes the address into both markers, and names it with who the platform lets in.

`cloud join` runs on the machine only. It starts the lead's session if there's none, by the same steps as `cloud open` (continuing the last conversation, with the watcher beside it), and joins the terminal to it. Closing the page leaves the session working. A second browser, or `cloud open` from the computer, joins the same session.

code-kit's part of the page shows its keys where the pointer is a finger. It adds a row of the keys a phone's keyboard lacks (Esc, Tab, Shift-Tab, the arrows, Enter, Ctrl-C) and two for the type size, sizes the terminal to what can be seen above the phone's keyboard, and joins the session again when the person comes back to a page whose connection the phone closed. A page left open and in view isn't joined again by itself, so a session the watcher ended for being idle stays ended and the machine sleeps. Enter joins it again.

A terminal that can't be set up doesn't stop the move: `up` says what was missing, and running it again tries once more. `"terminal": false` in `cloud` leaves the machine's address alone and takes away a terminal served before. `cloud` shows the address, and `cloud --json` and the machine's own report carry it.

The platform's sign-in is the only thing in front of the terminal, and code-kit adds no password of its own. ttyd is started so that it refuses a connection asked for by a page from another address.

**Acceptance**

- Given a machine made ready on a platform that gives it an address, then the address serves a terminal joined to the lead's session, and `up` names the address.
- Given a browser that opens it with no session open, then the lead's session starts, continuing its last conversation, with the watcher.
- Given a second browser, then it joins the same session.
- Given a machine whose address is open to anyone, then no terminal is served, one served before is taken away, and `up` says how to make the address private.
- Given `"terminal": false`, then `up` serves none and takes away one served before.
- Given a platform that can't serve it, then `up` says why in the platform's words, and the project still goes up.
- Given `cloud join` run on the computer, then it's refused, naming `cloud open`.

### CLOUD-13 A machine made with nobody at a computer

`cloud up`, `open`, `stop` and `down` each take `--unattended`, for a workflow's runner: nobody is there to answer, the checkout is thrown away when the run ends, and the sign-in to GitHub there is the workflow's own and no person's. `--platform <key>` names the platform where the config doesn't, so a repository whose config has no `cloud`, or that has no config yet, can have a machine. On the machine its own marker names the platform from then on, and the hooks that note tool calls and prompts for the watcher (CLOUD-7) run there whether or not the repository has a config.

Unattended, `up` asks nothing and installs nothing on the runner: where the platform's command is missing or not signed in it stops, saying the workflow does both. It doesn't ask for the two sign-ins on the machine and doesn't stop for them. A machine that isn't signed in to GitHub can't clone, so its clone is made from the runner's checkout: the branch it's on goes over as one git bundle, the clone is made from that with the remote's address set on it, and the bundle is removed. A checkout that holds only its latest commit is refused, naming `fetch-depth: 0`. No git name or email is set from the runner, since they'd be nobody's. `carry` has nothing to copy from a checkout, and says the files are the owner's to put there. The terminal in a browser is the only way in to a machine made this way, so `up` stops where it can't be served or the config turns it off. It ends by naming the terminal's address and which sign-ins wait for the owner there, and writes no marker in the runner's checkout.

`--stage machine` stops once the machine is made and `--stage clone` once the clone is there, so a workflow can show each as a step of its own and a failure names which.

With no marker in the checkout, `open`, `stop` and `down` ask the platform whether the machine is there and the machine whether the project is on it. `open` starts no session on a machine its owner hasn't signed in, and says where they do. `down` refuses while work there isn't on the remote, as it does from a computer, and with `--discard` removes the machine without asking: the choice was made where the workflow was started. A Claude session is refused `--unattended` on every one of them, so an agent can't use it to skip the person's yes.

A person's own clone of the repository isn't told the project is on a machine made this way (CLOUD-6), which is in the open questions.

**Acceptance**

- Given a runner with the platform's command signed in and a full checkout of `acme/app`, when `cloud up --unattended --platform sprites` runs, then the machine exists, holds a clone at the checkout's commit with `https://github.com/acme/app.git` as its remote, has code-kit and the terminal installed, and the run asked nothing and exits 0 naming the terminal's address.
- Given that machine before its owner has signed in, when `cloud open --unattended` runs, then no session is started and the run says the machine waits for its owner's sign-ins at its terminal.
- Given a checkout made with `fetch-depth: 1`, then the clone stage stops, naming `fetch-depth: 0`, and nothing is copied.
- Given a branch on the machine that isn't on the remote, when `cloud down --unattended` runs, then nothing is removed and the branch is named; with `--discard` the machine is removed.
- Given a Claude session, when it runs any cloud command with `--unattended`, then it's refused.
- Given a repository with no `.claude/code-kit.json`, when `cloud up --unattended --platform sprites` runs, then its machine is made, and a tool call in a session there is noted for the watcher.

### CLOUD-14 The owner's first visit

A machine made with nobody at a computer has neither sign-in, and both are its owner's alone. When its terminal is opened with no session running, `cloud join` looks at both before it starts one. Where GitHub's is missing it runs GitHub's own device sign-in in that terminal: the person reads a one-time code there and enters it at github.com, signed in as the account the project is pushed as. Then git on the machine is set to use that sign-in, the remote is fetched, which brings the branches the first copy left out, and where the machine has no git name or email they're set from the account: its name, and GitHub's own address for it (`<id>+<login>@users.noreply.github.com`), said in a line with how to change them. Where the fetch fails, the account can't read the repository: the visit says so, offers to sign it out so another can sign in, and starts nothing. Where Claude's is missing it runs Claude Code's own sign-in, on the person's subscription. code-kit starts each sign-in and reads neither credential.

Each sign-in sends the person to another page, GitHub's for the code and Claude's for its own, and so does a provider's pairing (CLOUD-16). A browser that leaves the terminal's page closes its connection, a phone's as soon as the page is out of sight, and the terminal ends what it ran for that browser. So the sign-ins and the pairing run in a session of their own on the machine (`code-kit-owner`), which the terminal joins: left, it waits as it was, with the same code, and the terminal opened again joins the same one. It ends when the sign-ins and the pairing are done, and the lead's session starts then. Where they didn't finish, the visit says which sign-in the machine still waits for and starts nothing.

With both in place the lead's session starts and the terminal joins it. A later visit finds a session open, or both sign-ins there, and asks for nothing. A visit with no terminal to type in starts nothing and says the sign-ins take one.

**Acceptance**

- Given a machine with neither sign-in, when its owner opens its terminal, then GitHub's device code is shown first, Claude's sign-in follows, and the lead's session opens once both are done.
- Given the GitHub sign-in done as an account that can't read the repository, then the visit names the account and the failure, offers to sign it out, and no session starts.
- Given the sign-in done, then `git config --global user.email` on the machine is the account's `noreply` address, and a branch that was on the remote and not in the first copy is there.
- Given a machine signed in to both, when its terminal is opened, then nothing is asked.
- Given a visit whose terminal is closed while GitHub's code waits, when the terminal is opened again, then it joins the same sign-in, and no second one is started.

### CLOUD-15 The machine workflow

`code-kit cloud workflow` prints the workflow a repository commits as `.github/workflows/code-kit-machine.yml`, and with `--write` puts it there and says what's left: commit it, add the platform's token as the repository's secret, run it. The file is code-kit's own, the same text for the same platform and code-kit version, so whoever starts it can tell a committed file from one changed by hand.

It runs on `workflow_dispatch` with four inputs: `act` (`up`, `start`, `stop`, `down`), `request` (the asker's own id for the request, shown in the run's name so a run can be matched to it), `discard`, and `provider` (the hosted team provider that asked, as `name=address`, which `up` passes on, CLOUD-16). It checks out the whole history without keeping the workflow's token in the checkout, then runs the platform's steps, which come from its adapter: for Sprites, Fly's installer and `sprite auth setup` with the `SPRITES_TOKEN` secret, stopping with what to add where the secret is missing. Then it runs this code-kit version's unattended command for the act, `up` as its three stages. Each step has a name a person can read in the run. One run at a time, and the workflow's own token can only read the repository.

The token is passed by the workflow to the platform's command. code-kit doesn't read it, and nothing in the inputs is a secret.

A hub that starts the workflow draws its runs and names its machine from code-kit's own answers, not from a copy of the file: the steps in order with the acts each runs for and the stage each is (`prepare`, `signin`, `machine`, `clone`, `ready`, `start`, `stop`, `remove`), the name a repository's machine gets, the inputs a repository's file takes, read from the file, and whether that file is this version's, another version's as that version printed it, or changed by hand. The file changes between versions, so a version from before the last change is known by a hash of what it printed, kept with its platform's adapter. A test fails when the file changes without the last released version's hash being kept.

**Acceptance**

- Given `"cloud": { "sprites": {} }`, when `cloud workflow` runs, then the output is a workflow with the four inputs, the two Sprites steps reading `secrets.SPRITES_TOKEN`, and `cloud up --unattended --platform sprites` in its three stages at this code-kit's version.
- Given the file written by `--write`, when `--write` runs again, then nothing changes and it says the file is code-kit's already.
- Given a repository without the secret, when the workflow runs, then it fails at "Sign in to Sprites", saying which secret to add and where.
- Given the file as code-kit prints it, then every step in it is one of the steps code-kit lists, in the same order, the three `up` stages listed for `up` alone.
- Given a file printed by another version with the same steps, then it is told from this version's and from one changed by hand, with the version it names.
- Given the file 0.40.0 printed, which has no `provider` input, then it is read as 0.40.0's, its inputs as `act`, `request` and `discard`, and with one line changed as changed by hand.

### CLOUD-16 Pairing with the provider that asked

A hosted team provider that starts the workflow gives its own address in the `provider` input, as `name=address`, and `cloud up --unattended --provider` keeps it in the machine's marker. The name must be a provider adapter that pairs with machines and the address an https one; anything else is refused before the machine is touched, and an empty input names nobody. A later `up` that names nobody leaves the machine with who asked, and one that names a provider is offered to the owner again. `--provider` is refused anywhere but `up --unattended`. Nothing of the provider is installed by the workflow.

On the owner's first visit, once both sign-ins are there (CLOUD-14) and before the lead's session starts, `cloud join` says who asked for the machine, at which address, and what pairing does, in the adapter's own sentences, and asks whether to pair now. A yes runs the adapter's pairing in the terminal: for the hub, its companion installed from the hub's own address with npm, and the companion's setup for this machine and repository, which shows a code the owner confirms on the hub. code-kit starts those commands and reads no credential of them. A no installs nothing and asks whether to stop offering it; unless the owner says to stop, the next visit offers it again, and once they have, later visits say nothing until the provider makes the machine ready again. A visit that finds a session open, or no terminal to type in, offers nothing.

A paired machine keeps the provider's part running through its platform's `keep`: a script in the clone's state that sets the `PATH` and Node option this terminal has and runs the adapter's command, registered once and left alone after. On Sprites that is a second service beside the terminal's, which is paused with the machine and carries on when it wakes. A pairing that doesn't finish says so, opens the session without it, and is offered on the next visit.

From then on the lead's session is started with what the adapter says the provider needs to see it (for the hub, where the companion's settings are and its adapter plugin), asked of the machine each time a session starts, whoever starts it: the terminal, the workflow's `start`, or the provider itself, which runs `cloud join --detached` on the machine to start the session with nobody attached. An answer that isn't an environment of plain names and values and a list of plain arguments is not used, and the session starts without it.

**Acceptance**

- Given `up --unattended --provider hub=https://hub.example`, then the machine's marker names that provider, and the run says its owner is offered the pairing on a first visit.
- Given `--provider` with a name code-kit pairs no machine with, or an http address, then the command is refused and the marker is unchanged.
- Given the owner's visit to a machine a provider asked for, when they answer no and don't say to stop, then nothing is installed, the session opens, and the next visit offers it again.
- Given a yes, then npm installs the companion from the provider's address, its setup runs with the machine's name, the clone's parent folder and the repository, the platform keeps its `run` command, and the lead's session is started with the companion's environment and plugin folder.
- Given a pairing that fails, then the visit says the machine isn't paired, no service is kept, and the session opens without the plugin.
- Given a paired machine, then a later visit asks nothing and keeps one service, and the workflow's `start` and `cloud join --detached` start the session the same way.

## What was tried on a Sprite

- A lead (`claude -p` in a tmux session, nobody attached) started the web lane's agent with a worktree. code-kit claimed the lane, gave the agent `.claude/worktrees/lane-web`, and held its write at spec-check, as on a computer.
- The Sprite stayed awake for the nine and a half minutes the agent worked, and was suspended for 160 seconds of the silent wait that followed (CLOUD-7).
- The adapter ran against the real platform: a Sprite made in 1.6 seconds and found again, commands with their exit status, a time limit that stops the command there, a file put, a tmux session that outlives the command that started it, and the Sprite removed.
- The account used is on Fly's trial, which allows three Sprites. A person with more than three projects up needs a card on the account.

## The whole flow on a real Sprite

On 21 November 2026 the whole flow ran with a throwaway project in a private repository: a word tally with one spec, a plan of three stories and two lanes, two of the stories able to run at once. code-kit on the Sprite was this branch's build, copied there by hand, since the released version has none of the machine's own commands.

- `cloud up` run by a Claude session made the Sprite and stopped at the GitHub sign-in, installing nothing. With both sign-ins done by the person, it took 18 seconds from there to ready: the clone, the git name and email, and the marker on both sides.
- On the computer, `next` answered `wait`, and `cloud` reported the sign-ins, what was open, load, memory, disk and that everything there was on the remote.
- The person opened the lead's session, answered Claude Code's first-run questions and typed `/code-kit:next`. The lead started both lanes' agents at once in their worktrees, reviewed and merged their two stories through the queue, then the third, and pushed the base. That took six minutes. Pulled to the computer, its 11 tests pass and the command it built prints a file's tally.
- `cloud stop` ended the session from the computer, `open` continued its conversation, the watcher ended it five minutes after its last tool call, and `cloud down` removed the Sprite and brought the project home.
- The eight and a half minutes a lane agent's two tool calls took in the spike didn't happen again: three stories took six minutes in all.
- The Sprite's image sets Claude Code's permission mode to `auto` in its own settings. The first session ran in that mode and the second, started the same way, with permission prompts off. Both worked without stopping to ask.
- A later session started with a question from Claude Code about its display, which waited for an answer as the first-run questions do.

It found four defects, each fixed with a check that failed first: the yes/no question at a real terminal was answered no before anything was typed; a device sign-in to GitHub left git on the machine unable to clone; a first `open` with no terminal said the session was running when it was waiting at the first-run questions; and two commands the guards refused kept the finished session from ever being ended as idle.

What it didn't cover: a lane's work going on with nobody connected (the person's terminal was attached while the stories were built), the Claude sign-in offered by `up` in the same run (added after, and checked against the stand-in only), and installing code-kit there from its marketplace.

## A real project's checks on a Sprite

On 21 November 2026 one of the person's own projects was cloned onto a Sprite to see what its checks need there, before moving it. It has four lanes, a Vite client, a Node API, and 45 browser tests that start both servers.

- The clone took 4 seconds, its installs 13 seconds, and Playwright's browsers with their system packages 129 seconds.
- 19 of its 483 client unit tests and one of its build tests failed, all for images git ignores. The project keeps 1.9 GB of ignored content. Its tests read 236 MB of that in 108 files (two folders of images and a search index), and none of the 1.6 GB that makes up most of it. With those three folders copied over, every unit test passed. The 224 MB archive of the images uploaded in about 30 seconds.
- All 45 browser tests failed with a refused connection, because of the `localhost` address described under CLOUD-11. With Node taking IPv4 first, 39 passed and 6 waited for the search index. With the index there, those 6 passed too.
- Through the platform's port forwarding, a listener on `127.0.0.1` answered and so did one on the Sprite's own address. One on `::1` didn't.

The content has to reach more than the clone. A lane's worktree got the ignored files `.worktreeinclude` names, and the merge queue's checkout of the merged tree didn't, so this project's checks would have passed in a lane and failed at every merge, on a computer as on a machine. The queue's checkout now gets them too (MQ-1), and a lane's worktree gets the ones it lacks each time it's reused. A project lists such content twice: in `carry`, which the person agrees to send to the machine, and in `.worktreeinclude`, which spreads it from the clone to the worktrees there.

`carry` took single files until this trial, and now takes folders. The address fix is in the adapter. Both are checked against the stand-in platform; the trial itself moved the content by hand, in the same way `carry` now does.

## That project, moved

On 22 November 2026 the person ran `cloud up` for it.

- The first run made the Sprite and stopped with GitHub signed in and Claude not. What it printed wasn't kept, so the same-run Claude sign-in still has no recorded pass on a real machine. The second run finished the sign-in, the clone, the installs and Playwright.
- That run said the machine was ready when the largest carried folder (209 MB) hadn't arrived: the platform's file upload had ended at 30 seconds. `put` now sends a file as a command's input, and `up` stops when carried content doesn't arrive (CLOUD-3, CLOUD-11). Run again, the folder arrived in under 50 seconds, packing included.
- One build test reads the raw sources the index was built from, which the trial clone hadn't shown because that test only runs once the index is there. With a fourth folder carried (16 MB), every check passes in the machine's clone: 807 unit tests across the client, the API and the build, and 49 browser tests in 1.7 minutes.
- `cloud` on the computer reports the machine's sign-ins, load and disk. code-kit there is this branch's build, copied over the installed plugin by hand.

## The tools a project uses, on a Sprite

Tried on 22 November 2026, on the spike's Sprite.

- The connectors on the person's Claude account come with the Claude sign-in: the one that account has was connected there with nothing done. Servers set up in Claude Code on the computer alone aren't there.
- A hosted server is reachable. A design tool's remote server, added with `claude mcp add --transport http`, read "Needs authentication". `claude mcp login <name> --no-browser` printed the tool's authorization address and waits for the redirect address to be pasted back, in a real terminal. That sign-in is the person's, as the Claude one is, and hasn't been completed there yet.
- That sign-in was completed later the same day on a real project's machine, in the person's own terminal, and the server then read "Connected" there.
- The same design tool added as a connector on the person's Claude account, from a phone, read "Connected" in every new Claude Code process on the computer with nothing done there, as the account's other connectors do on both Sprites. A session already running on the computer didn't get its tools; whether one on a machine does wasn't checked. For a hosted tool this is the route with no sign-in per machine: the person connects it once on their account.
- A server that drives an app on the person's computer (a design tool's desktop app, a browser) can't be reached from a Sprite.
- Blender installed with `apt` in 82 seconds, and rendered its default scene with Cycles on the CPU at 960 by 540 and 64 samples in 3 seconds, from a script. A Sprite has no GPU. Driving a running Blender through an add-on's server, as its MCP server does on a computer, wasn't tried.

## The terminal in a browser, on a real Sprite

Tried on 22 November 2026, first by hand on the spike's Sprite from the person's phone, then through `cloud up` on the real project's machine.

- Fly's sign-in stood in front of the address. Signed in to a Fly account outside the organisation, the person was refused by name; signed in to the right one, the terminal opened.
- ttyd's live connection passed through the Sprite's address with its check of where the page came from switched on.
- Claude Code in ttyd's page as it comes wasn't usable on a phone: the type was too small, the keyboard has no Esc, Tab or arrows, and the keyboard covered the prompt. With the key row, a larger type and the terminal sized to what's visible, the person worked in it.
- Coming back to the page after a while, the terminal asked for Enter to connect again and took it only from the phone's keyboard, not the key row. The page now sends that key itself on return, and the row's Enter does the same. That fix hasn't been seen on a phone yet.
- On the project's machine `cloud up` installed ttyd 1.7.7 from Ubuntu's archive (651 kB), read its page (730 kB) from a ttyd on the spare port in about a third of a second on the spike, and made the service. A browser on the computer, through the platform's port forwarding, was joined to the lead's session that had been running there for seven hours, with the key row under it.
- A Sprite's service was given `PATH`, `HOME` and `LANG` as a command there is, and not the Node option the adapter sets, which is why the script sets it.
- That session had been waiting at a question to the person for those seven hours, with the machine awake: a question is a tool call that stays open, and an open tool call counted as work. A question now waits `idleMinutes` at most (CLOUD-7).

## What a paired provider needs, on a real Sprite

Tried on 23 November 2026 on the spike's Sprite, with the hub's companion packed from its repository. The pairing itself needs a hub the machine can reach and its owner at the terminal, and hasn't been run.

- A service made with `sprite-env services create` and no `--http-port` ran beside the terminal's. With nobody connected the Sprite was paused about a minute after the last command, and on the next command the same process carried on from where it was, with nothing starting it. A process that polls a provider doesn't keep the Sprite awake.
- `sprite-env services get` exits with an error for a service that isn't there, which is how `keep` knows whether to make one.
- `npm install -g` of the companion's package took two seconds and put its command in the folder of the Sprite's Node version, which isn't on the `PATH` there. The hub adapter finds the command by `npm prefix -g`.
- The installed companion found Node, Claude Code, git and the code-kit plugin, and said the machine isn't set up. Its adapter plugin passed `claude plugin validate`.

## GitHub Codespaces, tried as a second platform

Tried on 23 November 2026 with one 2-core codespace on a throwaway repository and a 5-minute idle timeout, the shortest GitHub allows.

| What was tried                                                             | What happened                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A new codespace, until a command answered                                  | 17 seconds                                                                |
| A stopped one, until a command answered                                    | 22 seconds                                                                |
| A tmux session doing nothing, nobody connected                             | Stopped 5 minutes 6 seconds after the SSH connection closed               |
| A tmux session printing a line every 20 seconds, nobody connected          | Stopped after 5 minutes 5 seconds                                         |
| A browser on the terminal page through a forwarded port, with output on it | Stopped 5 minutes after the SSH connection closed                         |
| An open `gh codespace ssh` printing a line every 20 seconds                | Stayed up for the half hour it was held                                   |
| A stop                                                                     | Ended the tmux sessions; the packages installed with apt were still there |
| The terminal page (ttyd with code-kit's keys) behind GitHub's sign-in      | Worked in a desktop browser and on the person's phone                     |
| A forwarded port's address before anything registered the port             | 404; `gh codespace ports forward` once made it answer, and it stayed so   |

So a codespace runs for as long as someone is connected to it by SSH or an editor, and for its idle timeout after, which is 4 hours at most. GitHub's documentation also gives a codespace 12 hours at most from its start, which wasn't tried. A lead left to work overnight would be stopped mid-story. Only a person's own token can start or connect to a codespace, so nothing but their own computer could hold one up. For 8 cores GitHub lists $0.72 an hour while it runs; Fly's listed rates for a Sprite come to about $0.20 an hour waiting and $0.50 with every core busy, by this spec's arithmetic and not from a bill.

## Open questions

| Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner  | Blocks                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| A wait on a clock (the hold until Claude's usage limit resets, a parked story) counts as idle, so the session is ended and nothing takes it up again until the person opens it. On a computer the loop resumes by itself. Something has to wake the machine at that time: the computer when it's on, or the hub                                                                                                                                                                                                                                                                   | Warren | unattended work across a usage limit                 |
| How many lanes one Sprite carries. Two of code-kit's own mod tests run out of time there, and a project's checks may need a longer `timeoutSeconds`                                                                                                                                                                                                                                                                                                                                                                                                                               | Warren | none; the first real project measures it             |
| Which memory figure Fly bills while a Sprite is awake: what's in use (about $18 a month if never asleep) or the 8 GB its policy reserves (about $129)? The usage API read zero five and a half hours into the spike                                                                                                                                                                                                                                                                                                                                                               | Warren | CLOUD-10's estimate                                  |
| How the person sees a web app running on the machine from their own browser. The platform's port forwarding reached test listeners on `127.0.0.1` and on the Sprite's own address; code-kit has no command for it yet, and the Sprite's web address wasn't tried                                                                                                                                                                                                                                                                                                                  | Warren | reviewing screens built there                        |
| Design stories use a design tool on the person's computer, which a session on the machine can't reach. Where the tool has a hosted server, the machine can use that once the person signs in to it there; should `cloud up` offer that sign-in for each hosted server the project's `.mcp.json` names, as it does Claude's, and `cloud` show each one's state? Where it has none, do those stories run on the computer while the project is up, or does the design step work from exported files only?                                                                            | Warren | design stories on the machine                        |
| A project whose checks need Docker (a local Postgres, Supabase's local stack). Docker installs on a Sprite by Fly's own instructions in half a minute, and containers, their ports and their networks work. Running a command inside a container whose process changed user fails, because root on a Sprite has no `CAP_SYS_PTRACE`, and that includes the Postgres image's health check, which stays unhealthy. So a stack that waits on health checks won't come up as it is. Postgres installed on the machine itself, a hosted database for development, or a second adapter? | Warren | those projects                                       |
| Ignored content made on the machine (generated images, a rebuilt index, an edited `.env.local`) isn't in git, so `cloud down` doesn't see it and removing the machine loses it. `carry` copies one way. Should `down` name carried paths that changed there, and bring them back?                                                                                                                                                                                                                                                                                                 | Warren | projects that generate content there                 |
| A project's toolchain on the platform's image. Trial clones of two real projects found: packages installed with `npm install -g` land off the PATH (pnpm works through `corepack enable --install-directory ~/.local/bin`); Python goes through pyenv, and a project pinned to a version that isn't installed hung there; npm blocks packages' install scripts. A trial clone that runs the project's checks before it moves would find these first. Should `cloud up` offer one?                                                                                                 | Warren | none                                                 |
| Who Fly lets through a private address: every member of the organisation, or its admins only. Its own help says members, the platform has a setting for either (`--private-access`), and which a new Sprite has wasn't read. Whether a member who isn't an admin can also run commands on the Sprite wasn't checked either                                                                                                                                                                                                                                                        | Warren | a team sharing one Fly organisation                  |
| Claude Code's Remote Control as a second way to reach the lead's session, from a phone or the web. A browser sign-in can join it; a `setup-token` one can't                                                                                                                                                                                                                                                                                                                                                                                                                       | Warren | none                                                 |
| A person's own clone isn't told its project is on a machine a workflow made, so a lead could be started in both places (CLOUD-6). The marker could come from the remote, or from the hub                                                                                                                                                                                                                                                                                                                                                                                          | Warren | one place at a time, for machines made by a workflow |
| A machine is named from the checkout's folder, which in a workflow is the repository's name. A person whose own clone is in a folder of another name would get a second machine from `cloud up`                                                                                                                                                                                                                                                                                                                                                                                   | Warren | a project moved both ways                            |
| The machine workflow hasn't run in GitHub Actions yet: it installs code-kit by its released version, and this isn't released. Its commands were run by hand on a real Sprite                                                                                                                                                                                                                                                                                                                                                                                                      | Warren | CLOUD-15                                             |
| The pairing hasn't been run on a real machine: it needs a hub the machine can reach, with the Cloud page's request passing its address, and the machine's owner at its terminal to confirm the code. Its parts were tried on a Sprite one by one                                                                                                                                                                                                                                                                                                                                  | Warren | CLOUD-16                                             |
