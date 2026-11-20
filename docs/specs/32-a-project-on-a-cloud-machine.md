# 32. A project on a cloud machine

**Status:** built, and not yet run end to end with a real project on a real machine
**Outcome:** A person can move a code-kit project's work onto a cloud machine they own: the lead session, its lane agents, their worktrees, the checks and the merge queue all run there on the person's own Claude subscription, the work reaches GitHub from there, and the person's computer only connects to it.
**Actors:** the person (chooses the platform, signs in to Claude and GitHub on the machine, opens and closes the lead's session, sets the budget); the lead and its lane agents (work on the machine as they do on a computer); the merge queue
**Depends on:** 05-lead-loop, 09-merge-queue, 23-the-team, 26-durable-lanes, 29-running-cost

One Mac running several code-kit projects sat at a load of 32 on 28 cores (the spike, `docs/spikes/cloud-lanes.md`). The Claude sessions used under one core between them. The rest was what they run: test suites, simulations, browser tests, and the merge queue's checks of every merged tree. Every project adds its own, and they all land on the one computer.

The spike tried a Fly Sprite as the place for that work, and the pieces hold. A Claude session there ran on the person's subscription after a sign-in in its console. code-kit installed by script, and its hooks held the lead and a lane agent to their paths with no change to code-kit. A commit made there reached GitHub in under two seconds as the person. The machine is created in a second, keeps its disk, and bills its disk alone while it sleeps, about 7 cents a month for the 3.4 GB that one held.

So the whole project moves, and nothing in it is split across machines. The lead's session runs on the machine, its lane agents are its sub-agents there, and the worktrees, the installs, the event log and the queue are files on the machine's disk, as they are on a computer today. The rules need no second form. What this spec adds is getting a machine ready, opening the lead's session on it from any computer, keeping the project in one place at a time, letting the machine sleep when nothing is moving, and bringing the project home.

One machine carries one project: 8 cores and 16 GB on a Sprite, and its cores looked slower than the Mac's. A project that outgrows that gets lanes on machines of their own, which is a later spec.

## Decisions

| Date       | Decision                                                                                                            | Why                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-20 | The whole project runs on one machine; a machine per lane waits until a project needs it                            | A lane agent is a sub-agent inside the lead's process, so moving the lead moves them all with no state crossing machines. A lane on another machine needs its claim, its questions and its hand-back carried |
| 2026-11-20 | Each platform is an adapter under `hooks/lib/adapters/`, Sprites first                                              | The core never names another tool                                                                                                                                                                            |
| 2026-11-20 | The machine is the person's own, found through their own sign-in; the config names the platform, not the account    | The project's source goes nowhere that isn't the person's, and a team shares one config                                                                                                                      |
| 2026-11-20 | The person signs in to Claude on the machine themselves, and code-kit never reads, copies or passes on that sign-in | Anthropic's terms rule out a product that collects, stores or passes on these credentials                                                                                                                    |
| 2026-11-20 | The lead's session on the machine runs with Claude Code's permission prompts off                                    | Nobody is attached to answer a prompt while the loop works, and in the spike a session with prompts on refused the lane's own report. code-kit's refusals held with them off. The machine is the sandbox     |
| 2026-11-20 | The machine starts from the remote, and work in flight on the computer is finished or pushed before the move        | `.claude/state` (claims, the queue, the event log, decisions waiting) isn't in git and isn't worth carrying mid-story                                                                                        |
| 2026-11-20 | A project is worked in one place at a time                                                                          | Two leads on two machines would dispatch the same stories, each with its own claims                                                                                                                          |
| 2026-11-20 | This is part of code-kit, free, from a terminal. Reaching the machine's sessions through the hub is the hub's       | Nothing here needs a service: the person's own platform account and command line are enough                                                                                                                  |

## In scope

- `cloud` in the config, and what `check` says about it.
- The machine adapter's interface, and a Sprites adapter.
- `code-kit cloud up`: a machine made ready for the project, with the two sign-ins the person does.
- `code-kit cloud open`: the lead's session there, in a terminal that stays when the person leaves.
- Work reaching GitHub from the machine with the computer off.
- The computer knowing the project is on its machine.
- Ending an idle session so the machine sleeps, and `code-kit cloud stop`.
- `code-kit cloud`: the machine's state, its sign-ins, what's open, and what isn't on the remote yet.
- `code-kit cloud down`: the project brought home and the machine removed.
- The machine's line in the cost register.

## Out of scope

- A machine per lane, with the lead elsewhere. A later spec, when a project outgrows one machine.
- The hub's companion on the machine, and its assistant starting or answering sessions there. That's the hub's own spec; a machine made ready here is one more of the person's computers to it.
- Carrying a story in flight from the computer to the machine.
- Prices. code-kit holds none (spec 29).
- Docker on the machine. A project whose checks need it can't move to a Sprite (see the open questions).

## Data

| Entity   | Where                                               | Fields                                                                                                                                           |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud    | `.claude/code-kit.json` → `cloud`                   | `{ "<adapter>": { its options } }`, with `prepare` (a command), `carry` (paths of ignored files to copy there) and `idleMinutes` (30 unless set) |
| Machine  | the platform, in the person's account               | its name (from the project), the project's clone, the installs, Claude Code with its plugins, the person's two sign-ins, the lead's session      |
| Marker   | `.claude/state/cloud.json`, on the computer         | the machine's name, the adapter, when the project went up                                                                                        |
| Activity | `.claude/state/cloud-activity.json`, on the machine | when the person last sent a prompt, when the watcher last looked, the awake seconds counted so far this month                                    |

An example:

```json
"cloud": { "sprites": {}, "prepare": "npm install -g pnpm", "carry": [".env.local"] }
```

## Requirements

### CLOUD-1 The config names the platform

`cloud` names one adapter by its key, with its options, and may set `prepare`, `carry` and `idleMinutes`. Without `cloud`, nothing in this spec applies. `prepare` is a command run on a new machine, and again when the command changes: the tools the project needs that the platform's image lacks. `carry` lists files git ignores that the project can't run without. `check` names a `cloud` with no adapter or two, options an adapter doesn't take, a `carry` entry that git tracks or that leaves the project's folder, and an `idleMinutes` that isn't a whole number of 5 or more.

**Acceptance**

- Given no `cloud`, then `code-kit cloud` says the project names no platform, and how to name one.
- Given `"cloud": { "sprites": {}, "carry": ["src/app.ts"] }` where git tracks `src/app.ts`, then `check` says `carry` is for ignored files and that one already travels with the clone.

### CLOUD-2 The machine adapter

The core reaches a machine through one module, which never names a platform. An adapter says its key, the options it takes, and these operations:

| Operation  | Given                                            | Answers                                                                                                                                            |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs`    | nothing                                          | What the platform needs on the computer: for each, whether it's there, the command that installs it or signs in, and where that command comes from |
| `ready`    | nothing                                          | The project's machine, made if it wasn't there                                                                                                     |
| `run`      | a command, the folder to run it in, a time limit | The exit status, whether it ran out of time, and the end of its output                                                                             |
| `put`      | a file on the computer, and where it goes        | Whether it arrived                                                                                                                                 |
| `terminal` | a command, and the folder to run it in           | The person's terminal joined to that command on the machine, until it ends or they detach                                                          |
| `state`    | nothing                                          | The machine, the sessions open on it and since when                                                                                                |
| `release`  | nothing                                          | Whether the machine was removed                                                                                                                    |

`needs` is how code-kit learns what to ask the person for without knowing the platform: its command line, and a sign-in to it. An adapter that can't reach its platform for any other reason (the platform doesn't answer, the account can't make a machine) says which, and every `cloud` command passes that on with what to do. The sessions code-kit keeps on a machine (the lead's, and the watcher's) are tmux sessions it starts through `run`, so they're the same on every platform, and a platform whose image has no tmux gets it from `prepare`.

**Acceptance**

- Given an adapter whose `needs` names a command line that isn't installed, then `cloud up` asks about it by the name, command and source the adapter gave (CLOUD-3).
- Given a platform that doesn't answer, then `cloud up` says so in the adapter's words and changes nothing.

### CLOUD-3 `cloud up` makes the machine ready

`code-kit cloud up` is run by the person, on the computer, in the project. It can be run again at any point and does only what's left. In order:

1. It checks what it needs on the computer: git, and whatever the adapter's `needs` lists. For each thing missing it shows the exact command that installs it or signs in, says where that comes from, and asks before running it. It never installs unasked, since the command downloads and runs someone else's program on the person's computer. A sign-in that needs the person's browser is run in their terminal, and code-kit reads nothing it stores. Declined, or run where there's no terminal to ask in (a Claude session running it for the person), it stops with the commands for the person to run themselves.
2. It stops if the move would leave work behind: stories running or queued here, decisions waiting on the person, lane branches that aren't on the remote, or merges into the base that aren't published (MQ-6). It names each and what to do with it.
3. It makes the machine and clears what the platform's image would get wrong (CLOUD-11).
4. It checks the two sign-ins and stops at each one that's missing, saying what the person does. For GitHub it starts gh's device sign-in on the machine and shows the code to enter at GitHub. For Claude it tells the person to run `code-kit cloud signin`, which attaches their terminal to Claude Code's own sign-in on the machine. code-kit never reads either credential.
5. It clones the project from its remote, and sets the clone's git name and email to the ones the computer's clone uses.
6. It installs code-kit there from its marketplace, or updates it when its version differs from the computer's, and installs the plugins the project's own settings enable.
7. It runs `prepare`, lists the `carry` files and copies them.
8. It writes the marker on the computer and says how to open the lead's session.

It then names the plugins Claude Code lists on the computer and not on the machine, and says that MCP servers and tools on the computer (a design tool, a browser) can't be reached from there. `code-kit cloud console` is a shell on the machine, for what only the person can put right there.

**Acceptance**

- Given a computer without the platform's command line, then `up` shows the install command and its source and asks; on yes it installs, goes on to the sign-in, and carries on.
- Given the person answers no, then nothing is installed, and `up` stops with the install and sign-in commands to run by hand.
- Given `up` run by a Claude session with the command line missing, then it installs nothing and tells the session what to ask the person to run.
- Given the command line installed and the person not signed in to the platform, then `up` asks only about the sign-in.
- Given a story running on the computer, then `up` stops, names the story, and says to finish it or hand it back first.
- Given a machine with no sign-in to Claude, then `up` stops after making it, says to run `cloud signin`, and a second `up` after the sign-in carries on from the clone.
- Given `up` run twice on a ready machine, then the second run changes nothing and says it's ready.
- Given an `ANTHROPIC_API_KEY` set on the machine, then `up` stops and says it would be used in place of the subscription, and to remove it.
- Given a commit made on the machine afterwards, then its author is the name and email of the computer's clone.

### CLOUD-4 `cloud open` is the lead's session

`code-kit cloud open` starts Claude Code in the project's clone on the machine, in a tmux session, with permission prompts off, and joins the person's terminal to it. A session already open there is joined, never started twice. Detaching (Ctrl-b, then d) leaves it working. Run where there's no terminal, it starts the session and says how to join it. Where an earlier session ended (CLOUD-7), the new one continues its conversation. It's the lead session because it's the first in that checkout (SESS-2), and its lane agents are its sub-agents with their worktrees on the machine, so every rule code-kit enforces on a computer is enforced there by the same hooks.

**Acceptance**

- Given a ready machine with no session, then `open` starts one, and `code-kit sessions` there shows it as the lead.
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

Two measurements on Sprites set what the watcher is for. A Sprite with a process waiting silently in a tmux session, and nobody attached, was suspended after about four minutes: a 240-second wait took 400, and went on only when something connected. Three Sprites with something happening at least once a minute (two seconds of CPU, a request, or a small Node tick) stayed awake for the nine minutes each was left. So `open` starts a watcher beside the lead's session, and it does two things. Its look each minute is what keeps the machine awake while the session is open, so work that waits quietly isn't frozen. And when no agent is running, the queue isn't merging, and there's been no tool call (DUR-1) and no prompt from the person for `idleMinutes`, it ends the lead's session and itself, and the machine sleeps. What waits on the person stays in its files, and the next `open` continues the conversation and says why the last one ended. `code-kit cloud stop` ends the session at once, from the computer.

**Acceptance**

- Given `idleMinutes` of 30, a finished milestone and nobody typing, then 30 minutes after the last tool call the session is gone from the machine's sessions.
- Given a lane's test run that takes 40 minutes, then the session isn't ended while it runs.
- Given a session ended as idle, then `open` continues its conversation and says it was ended after 30 idle minutes.
- Given `cloud stop` while a lane is working, then it names the lane and the story and asks the person to confirm before it ends them.

### CLOUD-8 The person can see it

`code-kit cloud`, on the computer, shows the machine and its platform; the Claude sign-in (the kind of account and when it ends) and GitHub's (the login and scopes); the sessions open on it and since when; the hours it's been awake this month; its load, memory and disk; code-kit's version there against the computer's; and what's on the machine that isn't on the remote: branches, merges not published, and worktrees with uncommitted files. `--json` gives the same for tools. `next` on the computer names, from the report `cloud` last read (asking the machine would wake it each time the loop looks), as attention, a Claude sign-in that has ended or ends within three days, and a code-kit version there behind the computer's.

The awake hours come from the machine's own uptime, which the spike showed stops counting while a Sprite sleeps. The watcher adds it up, and where the platform restarted the count, `cloud` says since when the figure runs.

**Acceptance**

- Given a lane branch on the machine that was never pushed, then `cloud` lists it under what isn't on the remote.
- Given a Claude sign-in that ends in two days, then `cloud` and `next` say so, and that the person signs in again with `cloud signin`.
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

The adapter's key is `sprites`. It works through the `sprite` command, in the organisation the person's sign-in selects, and never reads its token. Its `needs` are that command, installed by Fly's own installer from sprites.dev (it checks the download against its SHA-256 and puts `sprite` in `~/.local/bin`), and `sprite login`, which opens the person's browser and has to run in a terminal. A project has one Sprite, named from the project's folder and a hash of its remote's address, so a second computer finds the same one. Its `ready` makes the Sprite if there's none, empties the image's global git ignore (it ignores `.env.*`, `build/`, `dist/` and `target/`, which would leave a project's files out of commits made there), and replaces the image's git identity (`Sprite <noreply@sprites.dev>`). `terminal` is `sprite exec --tty`, and `state` lists the platform's own sessions, which are the terminals joined to it. `put` names a full path, since the platform expands no `~` in one. The status the platform reports read `cold` whether the Sprite was awake or not, so it isn't used.

**Acceptance**

- Given a project with no Sprite, then `cloud up` makes one and names it.
- Given two projects, then each has its own Sprite.
- Given a tracked file `build/main.ts` changed by a lane on the Sprite, then its commit includes it.

## What was tried on a Sprite

- A lead (`claude -p` in a tmux session, nobody attached) started the web lane's agent with a worktree. code-kit claimed the lane, gave the agent `.claude/worktrees/lane-web`, and held its write at spec-check, as on a computer.
- The Sprite stayed awake for the nine and a half minutes the agent worked, and was suspended for 160 seconds of the silent wait that followed (CLOUD-7).
- The adapter ran against the real platform: a Sprite made in 1.6 seconds and found again, commands with their exit status, a time limit that stops the command there, a file put, a tmux session that outlives the command that started it, and the Sprite removed.
- The account used is on Fly's trial, which allows three Sprites. A person with more than three projects up needs a card on the account.

The whole flow (`up`, `open`, a story built and merged there, `down`) has run against a stand-in for the platform in `test/hooks.test.mjs`, and not yet with a real project on a real Sprite.

## Open questions

| Question                                                                                                                                                                                                                                                                                                        | Owner  | Blocks                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| A wait on a clock (the hold until Claude's usage limit resets, a parked story) counts as idle, so the session is ended and nothing takes it up again until the person opens it. On a computer the loop resumes by itself. Something has to wake the machine at that time: the computer when it's on, or the hub | Warren | unattended work across a usage limit     |
| On the spike's Sprite a lane agent's two tool calls took eight and a half minutes, with the Sprite awake throughout. The cause isn't known: the model, or the machine                                                                                                                                           | Warren | none; the first real project measures it |
| How many lanes one Sprite carries. Two of code-kit's own mod tests run out of time there, and a project's checks may need a longer `timeoutSeconds`                                                                                                                                                             | Warren | none; the first real project measures it |
| Which memory figure Fly bills while a Sprite is awake: what's in use (about $18 a month if never asleep) or the 8 GB its policy reserves (about $129)? The usage API read zero five and a half hours into the spike                                                                                             | Warren | CLOUD-10's estimate                      |
| How the person sees a web app running on the machine from their own browser. Sprites have an address and port forwarding; neither was tried                                                                                                                                                                     | Warren | reviewing screens built there            |
| Design stories use a design tool on the person's computer, which a session on the machine can't reach. Do they stay on the computer, or does the design step work from exported files only?                                                                                                                     | Warren | design stories on the machine            |
| A project whose checks need Docker (a local Postgres, Supabase's local stack) can't run them on a Sprite. A second adapter, or a hosted database for development?                                                                                                                                               | Warren | those projects                           |
| Claude Code's Remote Control as a second way to reach the lead's session, from a phone or the web. A browser sign-in can join it; a `setup-token` one can't                                                                                                                                                     | Warren | none                                     |
