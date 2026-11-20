# 32. Checks on a runner

**Status:** draft
**Outcome:** A project can have the merge queue's checks, and the fix check's, run on a cloud machine the person owns in place of their computer, with the same answer each time, nothing left running when a run ends, and what it costs in view.
**Actors:** the person (chooses a runner, signs in to its platform, sets its budget); the merge queue and the fix check (run their commands there); the lead (reads where a merge's checks ran, and what the machine is doing)
**Depends on:** 09-merge-queue, 18-regression, 29-running-cost

One Mac running several code-kit projects sat at a load of 32 on 28 cores (the spike, `docs/spikes/cloud-lanes.md`). The Claude sessions used under one core between them. The rest was commands: the test suites, simulations and browser tests the agents run, and code-kit's own checks of every merged tree, which two projects' merge queues were running when the sample was taken. Each story merges by itself, so each one costs a full run of the project's checks on the person's computer, in every project at once.

Those checks are commands run in a fresh checkout, whose exit status is read (MQ-1, REG-1). They need no Claude session and no sign-in to Claude, so they can run on another machine while everything else stays where it is. The spike ran code-kit's own suite on a Fly Sprite: 7 minutes 9 seconds on 8 cores, with a command back in about a second whether the machine had been awake or asleep. At the published rate, ten minutes flat out on 8 cores is about 5 cents, and a sleeping Sprite bills its disk, about 7 cents a month for the 3.4 GB that one held.

This spec gives the checks a runner: the place their commands run, which is the person's computer unless the config names another. It takes the queue's and the fix check's load off the computer. The commands a lane agent runs while it works stay where the lane is, and move only when the lane does, which is a later spec. The sample didn't measure how the load splits between the two, so how much this relieves by itself won't be known until it runs in a real project.

## Decisions

| Date       | Decision                                                                                                         | Why                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-20 | One seam in the core, with each platform as an adapter under `hooks/lib/adapters/`, or a command                 | The core never names another tool, and the team provider already works this way                                                                                                                       |
| 2026-11-20 | The tree goes straight from the computer to the machine as a git bundle, never through the remote                | The merged tree exists only on the computer until it merges. The machine then needs no GitHub sign-in, and the spike's push test left a token for all the person's repositories on the machine's disk |
| 2026-11-20 | The machine is the person's own, found through their own sign-in; the config names the platform, not the account | The project's source goes nowhere that isn't the person's, and a team shares one config                                                                                                               |
| 2026-11-20 | The machine keeps its clones and makes its own installs                                                          | Installs made on macOS for Apple's chips don't run on Linux on x86, and keeping them between runs is what the queue's kept checkout does on the computer (`hooks/lib/checkout.mjs`)                   |
| 2026-11-20 | Only commands run on the machine; ownership, layers, approvals and standards are still checked on the computer   | Those rules read the approval log and `.claude/state`, which never leave the computer                                                                                                                 |
| 2026-11-20 | A runner that can't be reached holds the merge, unless the config says to fall back to the computer              | Two of code-kit's own tests pass on the Mac and run out of time on a Sprite. A check can differ between machines, so the queue's answer has to come from one place unless the project says otherwise  |
| 2026-11-20 | This is part of code-kit, free. Lanes on cloud machines come later, with the hub                                 | Checks need no credential beyond the platform's own and nothing shared between machines. A lane elsewhere needs its claim and its questions to cross machines, which the hub carries                  |

## In scope

- `runner` in the config, and what `check` says about it.
- The runner interface, the built-in `local` runner, and a command runner.
- Getting a checkout's tree onto the machine, and its installs made there.
- Running the merge queue's checks and the fix check's on it.
- What happens when it can't be reached.
- `code-kit runner`: what the machine is doing, what its runs took, and removing it.
- A Sprites adapter.
- The runner's line in the cost register.

## Out of scope

- Lanes on cloud machines: a Claude session started on the machine, on its lane's branch. A later spec, with the hub; it extends this interface with starting a session.
- A lane's finishing checks (the stop hook's) and the commands an agent runs itself. They run in the lane's worktree, wherever that is.
- The project's CI on GitHub (spec 25).
- Prices. code-kit holds none (spec 29); it counts the seconds its runs took.
- Any sign-in to Claude or to GitHub on the machine. Checks need neither.

## Data

| Entity  | Where                                 | Fields                                                                                                                                              |
| ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner  | `.claude/code-kit.json` → `runner`    | `"local"` (the default), `{ "command": "<command>" }`, or `{ "<adapter>": { its options } }`; with `prepare` (a command) and `fallback` (`"local"`) |
| Check   | `.claude/code-kit.json` → `checks[]`  | gains `local` (true keeps the check on the computer)                                                                                                |
| Machine | the platform, in the person's account | its name (from the project), a clone for each use (`merge`, `fix`) with its installs, what its installs were made for, the `prepare` it last ran    |
| Run     | `.claude/state/runner.jsonl`          | when, the use, the check, the command, where it ran (`local` or the machine), seconds, exit status or `timed out`                                   |

Two examples:

```json
"runner": { "sprites": {}, "prepare": "npm install -g pnpm" }
```

```json
"runner": { "command": "node tools/runner.mjs", "fallback": "local" }
```

## Requirements

### RUN-1 The config says where checks run

`runner` is absent or `"local"` (the checks run on the computer, as they do now), a command, or one adapter's key with its options. `prepare` is a command run on a machine once when it's new, and again when the command changes: the tools the project's checks need that the platform's image lacks. `fallback: "local"` is RUN-6's. A check with `local: true` always runs on the computer, for one that needs what the machine can't give (the spike's Sprite has no Docker). `check` names a `runner` that's none of these, two adapters in one, and options an adapter doesn't take.

**Acceptance**

- Given no `runner`, then every check runs as it does today and nothing else in this spec applies.
- Given `"runner": { "sprites": {}, "docker": {} }`, then `check` says a project has one runner.
- Given `"runner": { "sprites": {} }` and a check with `local: true`, then that check runs on the computer and the others on the machine.

### RUN-2 The runner interface

The core reaches a runner through one module, which gives five operations and never names a platform:

| Operation | Given                                            | Answers                                                                   |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `ready`   | nothing                                          | The project's machine, made if it wasn't there, with `prepare` run on it  |
| `put`     | a file on the computer, and where it goes        | Whether it arrived                                                        |
| `run`     | a command, the folder to run it in, a time limit | The exit status, whether it ran out of time, and the end of its output    |
| `state`   | nothing                                          | The machine, what's open on it and since when, and how much disk it holds |
| `release` | nothing                                          | Whether the machine was removed                                           |

A command runner is called as `<command> <operation>` with the input as JSON on stdin and answers JSON, as the team's command provider is (TEAM-2). An adapter says its key, the options it takes, and the five operations. `local` is no machine: its checks run as they do now, and `state` and `release` say there's nothing to show or remove.

**Acceptance**

- Given a command runner whose `run` answers `{ "status": 1, "output": "…" }`, then the check fails with that output, as it would have on the computer.
- Given a command runner that exits non-zero or doesn't answer JSON, then the runner counts as unreachable (RUN-6), with the first line it printed as the reason.

### RUN-3 The tree gets there without the remote

Before a run, code-kit takes the tree of its own checkout as it stands, with whatever code-kit changed in it since the last commit (the fix check takes the fix out between runs), and makes it a commit. It asks the machine which commits its clone holds, bundles what the machine lacks, puts the bundle there and checks that commit out in the clone for this use. Nothing is pushed to the remote, and the machine holds no GitHub credential. A clone that's busy with another run of the same use isn't waited for: the run gets a clone of its own, which is removed after.

**Acceptance**

- Given a machine with no clone, then the first run sends the whole history, and the clone is at the commit sent.
- Given a second merge two commits later, then the bundle holds those commits' objects and not the history.
- Given the fix check, which reverts the fix's code in its checkout between two runs, then the second run on the machine sees the tree without the fix.
- Given a tree the machine is already at, then nothing is sent.

### RUN-4 The machine's installs are its own

Installs are never copied from the computer. In a clone on the machine, the project's install runs when the tree's manifests or lockfiles differ from the ones the clone's installs were made for: `regression.prepare` where the project sets it, else the install its lockfile calls for, as MQ-1 has it on the computer. An install that fails says nothing against the branch, which keeps its place in the queue, and the message names the machine and shows the end of the install's output.

**Acceptance**

- Given a new clone of a project with a `pnpm-lock.yaml`, then `pnpm install --frozen-lockfile` runs there before the first check.
- Given a second merge that changes no manifest or lockfile, then no install runs.
- Given an install that fails on the machine, then nothing is merged, the branch stays at the head of the queue, and the message says the install failed on the runner.

### RUN-5 Checks run there, and the result says so

For the queue's verify of a merged tree and for every run the fix check makes, each command of each check that isn't `local` runs on the machine, in the folder it would have run in on the computer, with the check's `timeoutSeconds`. The exit status decides. The last 256 KB of output comes back. A command that isn't installed (exit 127, or pnpm's word for it) is a skipped check or a failure by `ifMissing`, and one that runs out of time leaves the branch in its place, both as they are today. Which checks apply, and the folders an `each` check runs in, are still worked out on the computer from the changed files. The merge's result, and `verify`'s, say where the checks ran.

**Acceptance**

- Given a merged tree whose test check fails on the machine, then the branch is sent back with the check's name and its output, as it is today.
- Given a check that passes there, then the merge says its checks ran on the runner, naming it.
- Given a check whose command runs past `timeoutSeconds` on the machine, then the command is stopped there, and the branch keeps its place.
- Given a branch that breaks a layer rule and passes its checks, then it's refused for the layer rule, which was checked on the computer.

### RUN-6 When the runner can't be reached

A runner is unreachable when its platform's command isn't installed, the person isn't signed in to it, or an operation fails or runs past its own limit. That says nothing against the branch: nothing is merged, the branch keeps its place, and the message says what was tried, what the platform answered, and what to do (install its command line, sign in, or set `fallback`). With `fallback: "local"` the checks run on the computer instead, and the result says they did and why.

**Acceptance**

- Given `"runner": { "sprites": {} }` and no `sprite` command on the computer, then a merge stops with the branch in its place, saying the command isn't installed and where to get it.
- Given the same with `fallback: "local"`, then the checks run on the computer and the merge says the runner couldn't be reached.
- Given a runner unreachable at one merge and back at the next, then the next merge runs there with nothing to reset.

### RUN-7 Nothing is left running, and the person can see

A run belongs to the process that started it. When that process ends, or the computer sleeps or loses its connection, the command stops on the machine too, so a machine is never held awake by a run nobody is waiting for. code-kit starts nothing on the machine that outlives a run.

`code-kit runner` shows the runner the config names, the machine, what's open on it and since when (the platform's sessions, code-kit's or not), its disk, and the runs this month by use: how many, their seconds in all, and how many failed or timed out. `--json` gives the same for tools. `code-kit runner release` removes the machine with its clones and installs; the next run makes another. `next` names, as attention, anything open on the machine for more than 30 minutes that isn't a run of code-kit's, since that's what keeps a machine billing.

**Acceptance**

- Given a merge whose process is killed while a check runs, then the check's command is gone from the machine.
- Given a console session someone left open on the machine two hours ago, then `runner` lists it with its age, and `next` names it.
- Given 14 merges this month whose checks took 5,400 seconds on the machine, then `runner` says so.
- Given `runner release`, then the machine is gone, and `runner` says there's none.

### RUN-8 The Sprites adapter

The adapter's key is `sprites`. It works through the `sprite` command the person installed and signed in to, in the organisation that sign-in selects, and never reads its token. A project has one Sprite per computer, named from the project's folder and the same hash the queue's kept checkout is named by. Its `ready` makes the Sprite if there's none, empties the image's global git ignore (it ignores `.env.*`, `build/`, `dist/` and `target/`, which would hide a project's files from git there), sets git's name and email to code-kit's own, and runs `prepare`. Its `run` is one `sprite exec` without a terminal, which the spike showed ends on the Sprite when the caller goes away. Its `state` lists the Sprite's sessions; the status the platform reports read `cold` whether the Sprite was awake or not, so it isn't used.

**Acceptance**

- Given a project with no Sprite, then the first merge makes one, and the merge's result names it.
- Given a second project on the same computer, then it has its own Sprite.
- Given a tracked file named `build/main.ts` in the project, then it's in the clone on the Sprite.
- Given a `prepare` that was changed in the config, then it runs again before the next run.

### RUN-9 The runner is in the cost register

A runner is a paid thing, so spec 29 applies to it. `code-kit cost` names a project with a `runner` other than `local` and no row for it in the register as a problem. The lead estimates the row from the platform's published prices and the seconds `runner` reports, and says in its Basis which it used. Reading the platform's own meter is COST-8's.

**Acceptance**

- Given `"runner": { "sprites": {} }`, a budget, and no register row for the runner, then `cost` names the missing row.
- Given a row for it, then it counts in the total as any other row does.

## Open questions

| Question                                                                                                                                                                               | Owner  | Blocks                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| Is a bundle of only what the machine lacks quick for a large repository? The spike cloned from GitHub and didn't try a bundle                                                          | Warren | RUN-3                          |
| Which memory figure Fly bills while a Sprite is awake: what's in use, or the 8 GB its policy reserves? The usage API read zero five and a half hours after the spike's Sprite was made | Warren | RUN-9's estimate               |
| Why two of code-kit's own mod tests run out of time on a Sprite: its cores, or its newer Claude Code                                                                                   | Warren | code-kit using a runner itself |
| Should a lane's finishing checks run on the runner too? Each lane would need its own clone and installs there                                                                          | Warren | none                           |
| Does a project whose checks need Docker with published ports get a second adapter (a Fly Machine, a Daytona sandbox), or keep those checks `local`?                                    | Warren | none                           |
