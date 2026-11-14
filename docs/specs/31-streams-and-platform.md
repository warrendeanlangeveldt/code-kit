# 31. Streams and the platform

**Status:** draft
**Outcome:** One product in one repository can be built by several squads at once: each stream has its own lead, plan and lane agents and never waits on another's, the code they share sits in a core that one owner keeps, and code-kit notices when a stream's code would serve every stream better as part of that core.
**Actors:** the person (product owner; decides what the streams are); each stream's lead (one session each); the platform lead (owns core, decides promotions); lane agents (answer to their stream's lead); the loop (runs per stream); the hooks (judge every call)
**Depends on:** 23-the-team, 22-standards, 09-merge-queue, 17-onboarding, 30-conforming-code

A product with separate product lines (two offerings for different users, built on one platform, in one repository) was built with code-kit by two sessions: one meant for each line. They fought over the lead, because a project has one lead (SESS-2), and only the lead runs the loop and dispatches. The working session could take one story at a time and nothing more. The lead's loop offered the next ready story from the whole plan, so a lead meant for one line was handed the other's stories. And the lanes were technical (the API, the web app, the shared types), one agent each across the project (SCHED-1), so a story on one line held the API lane while the other line's API story waited.

The lanes being technical isn't the mistake. Each product line needs the API, the web app and the types, and the code is one codebase. What was missing is the second axis: the product line. Team Topologies calls it a stream-aligned team, with a platform team owning what the streams build on. In the code it's a modular monolith: per technical layer, a shared core and a module per stream.

```
            api            web            types
core        api core       web core       types core     the platform stream's
stream A    api / A        web / A        types / A      stream A's lanes
stream B    api / B        web / B        types / B      stream B's lanes
```

A stream's lanes own its modules, so two streams never share a lane. A module may use core and its own stream's modules, never another stream's. Core is the only code both streams depend on, so it has one owner. When the same capability shows up in two streams' modules, it belongs in core: DRY and single responsibility applied across the product, not only inside a module.

## Terms

| Term     | Meaning                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- |
| stream   | A squad and the product line it builds: its own lead session, lanes, plan and specs               |
| platform | The stream that owns core. Optional: without one, core's lanes are shared by the streams (STRM-6) |
| module   | A stream's own code in one technical layer                                                        |
| core     | The code in a layer that belongs to no stream: what the streams share                             |
| slice    | As in SCHED-2: one feature built across lanes. A slice is inside one stream                       |

"Vertical" isn't used: it's a business word for a market segment, and engineers use it for what code-kit calls a slice.

## Decisions

| Date       | Decision                                                                                                         | Why                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-14 | A project without `streams` is one stream holding every lane, and works as today                                 | Most projects have one product line; the model scales without making them carry it                                     |
| 2026-11-14 | One lead per stream, not per project                                                                             | Each squad runs its own build; one lead for two squads made them fight over it                                         |
| 2026-11-14 | A stream's lanes are its own; SCHED-1 holds per lane, so streams never wait on each other's lanes                | The squads build different product lines; only core is shared                                                          |
| 2026-11-14 | A module never imports another stream's module; core never imports a module                                      | A dependency between streams is a capability the platform should own, not a shortcut either stream takes               |
| 2026-11-14 | Core has one owner: the platform stream, or, without one, core's lanes taken in turns by the streams             | Core is where two streams can collide; one owner keeps it coherent                                                     |
| 2026-11-14 | A module's code is promoted to core on its second real use, by the platform lead's decision, never automatically | Promoting on a guess builds a core around one stream's needs; moving code under a running build is the platform's call |
| 2026-11-14 | The seams are scaffolded at setup only when the brief names separate product lines or platform capability        | Seams guessed in a product that never splits make each feature cross lines the product doesn't follow                  |
| 2026-11-14 | The merge queue, the approval log, the standards, the checks and the base branch stay project-wide               | It's one codebase and one deployable: every stream's tests prove every merge                                           |

## In scope

- Streams in the config, a lead per stream, the loop and `next` limited to the lead's stream, a plan per stream.
- Modules and core in the layer rules, and the refusals that keep the streams apart.
- Core's ownership: a platform stream, or shared core lanes taken in turns.
- Change requests from a stream to core.
- The setup question, and adding streams to a project that started as one.
- Promotion: noticing module code that belongs in core, proposing it, and moving it as platform work.

## Out of scope

- Several repositories. A stream is a part of one repository; a product in several repositories is several projects (spec 16 covers teams across machines).
- Separate deployables per stream. The base branch and its pipelines stay one.
- Moving a project's existing code into modules by itself: that's a conformance pathway the person places in the plan (spec 30).

## Data

| Entity       | Where                                    | Fields                                                                                                                                                                         |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stream       | `.claude/code-kit.json` `streams.<name>` | `{ label?, lanes, plan, specs?, platform? }`: its lanes (names under `lanes`), its plan file, the spec files it builds, and whether it owns core                               |
| Layer        | `layers[]`                               | today's `{ name, paths, mayImport, … }`, plus `stream?`: a layer with a stream is that stream's module; one without is core                                                    |
| Session      | `.claude/state/sessions/<id>.json`       | today's fields, plus `stream`: the stream it leads or works in; null in a project without streams                                                                              |
| Lane claim   | `.claude/state/lanes/<lane>.json`        | unchanged                                                                                                                                                                      |
| Lane turn    | `.claude/state/lane-turns.json`          | for each core lane the streams share, the stream it last ran a story for (STRM-6)                                                                                              |
| Core request | `.claude/state/core-requests.jsonl`      | id (`C-n`), stream, session, story, what, why, and the platform's decision `{ at, by, how: accepted \| declined, story, reason }` (STRM-7)                                     |
| Promotion    | `.claude/state/promotions.jsonl`         | id, what (the code: files and symbols), where it is (each stream's copy or user), evidence (the signals, PROM-1), raised, decided `{ at, by, how: promoted \| rejected, why }` |

A clone is found by tokens, not text: each file's code is read as tokens with names and literals masked (comments, strings and whitespace out), so a copy with renamed variables still matches, and matching runs of at least `harness.promote.tokens` tokens (default 60) are found by hashing every window of them. It reads JavaScript, TypeScript and Python, as the layer rules do, with no dependencies.

## Requirements

### STRM-1 Streams in the config

`streams` names the project's streams, each with its lanes, its plan (a file or folder inside `docs.plan`) and its specs. A lane belongs to at most one stream; `code-kit check` refuses a lane in two streams. A lane in no stream is a core lane the streams share (STRM-6); with a platform stream, every lane must be in a stream. A project without `streams` is one stream holding every lane, and nothing changes for it. `code-kit streams [--json]` lists each stream, its lanes, its lead session and what it's building.

**Acceptance**

- Given a config without `streams`, then every command and hook behaves as before this spec.
- Given the lane `api-a` listed in streams `a` and `b`, then `check` refuses the config, naming the lane and both streams.

### STRM-2 One lead per stream

A stream has at most one lead session. `/code-kit:lead <stream>` gives the person `code-kit sessions lead <stream>`, which makes the session its stream's lead (choosing it is the person's act, as SESS-2's Lead from here is). A session started while another lead is live is a working session until the person names its stream. A lead with no stream of its own leads every stream that has none, so one session alone still leads the whole project. One lead may write in the main checkout; every other stream's lead works in a worktree on its own lead branch (`lead/<stream>`), whose plan and spec changes reach the base through the merge queue like any branch (SESS-5). A working session belongs to one stream, and its task leases paths in it.

**Acceptance**

- Given stream `a`'s lead live, when another session runs `/code-kit:lead b`, then both are leads, each of its own stream, and neither's band says the lead is elsewhere.
- Given stream `b`'s lead in the main checkout's other session, when it writes a project file there while `a`'s lead holds the main checkout, then it's refused, saying to move to its worktree.

### STRM-3 The loop and `next` run per stream

A stream's lead gets only its stream's work: `next` offers its stream's ready stories to its stream's lanes, the loop prompts it only for those, and its band's mission rows describe its stream. A decision is still owned by the session that raised it (OWN-1). `status` and the trail read every stream, each under its own heading.

**Acceptance**

- Given a story ready in each stream, then stream `a`'s lead is offered `a`'s story only, and `b`'s lead `b`'s.

### STRM-4 A plan per stream

Each stream's stories are in its own plan file (`streams.<name>.plan`), which only its lead writes. Story ids are unique across the project; a story may depend on another stream's story, and waits for it as on any other. `code-kit check` refuses an id used in two plans.

**Acceptance**

- Given stream `b`'s lead editing stream `a`'s plan, then it's refused, naming `a`'s lead session.
- Given `b`'s ST-9 depending on `a`'s ST-4, then ST-9 isn't offered until ST-4 is done.

### STRM-5 Modules and core

A layer with `stream` is a module of that stream; one without is core. On top of each layer's `mayImport`: a module may import core and its own stream's modules, never another stream's; core never imports a module. The refusal says what to do instead: use core's version if there is one, or put in a change request to the platform (STRM-7) to promote what it needs (PROM-3). It never suggests copying the code.

**Acceptance**

- Given `a`'s module importing `b`'s module, then the edit is refused, naming both streams and saying to ask the platform to promote what's needed.
- Given a core file importing `a`'s module, then the edit is refused.
- Given `a`'s module importing core, then it passes.

### STRM-6 Who owns core

A stream with `platform: true` owns core: core's lanes are its lanes, and its lead dispatches them. Without a platform stream, core's lanes are shared: one agent at a time across the project, as SCHED-1 says, and when more than one stream has a core story ready, the lane takes them in turns, so a stream with many core stories doesn't hold it. A shared core lane's claim names the stream it's running for.

**Acceptance**

- Given no platform stream, a core story ready in each of `a` and `b`, and `a`'s last on the core lane, then `next` offers the core lane `b`'s story.
- Given a platform stream, then a stream's lead isn't offered core stories, and starting a core lane's agent from it is refused, naming the platform's lead.

### STRM-7 Change requests to core

A stream's lane that needs core changed writes a change request, as for anything outside its paths. With a platform stream, the request is the platform lead's decision, raised in its session; the stream's story waits on it as on any decision it's blocked by. Without one, it's the requesting stream's lead's, and the change goes through the shared core lane.

**Acceptance**

- Given a platform stream, when `a`'s api lane hands back a change request for a core file, then the decision is in the platform lead's session, and `a`'s story shows as waiting on it.

### STRM-8 What stays project-wide

One merge queue merges every stream's branches onto one base, and each batch runs the whole project's checks and every stream's tests. The approval log, the standards and the design register are the project's. A stream's lead approves within its stream's paths; an approval for core is the platform lead's, or, without one, the requesting stream's lead's.

**Acceptance**

- Given `a`'s branch changing a core file that `b`'s tests use, when `b`'s tests fail on the merged tree, then the batch fails and `a`'s branch is sent back, naming `b`'s failing tests.

### STRM-9 The setup question

`/code-kit:spec-design` and `/code-kit:init` ask once whether the product has, or plans, separate product lines, or is platform capability others will build on. Yes: they draft the streams, lay the code out with a core and a module per stream from the start, write the layer rules that keep the streams apart, and give the platform stream (when the person wants one). No: one stream and a plain layout, as today. A project that started as one stream adds streams by running `/code-kit:init` again: it drafts the streams and lanes, and, where the code isn't yet split into core and modules, a conformance pathway (spec 30) whose stories move it, layer by layer, without stopping the build.

**Acceptance**

- Given a brief naming two product lines on a shared platform, then init's draft has two streams, a module layer per stream in each technical layer, and core layers without a stream.
- Given a brief with one product line, then init's draft has no `streams`.

### STRM-10 Each lead sees its own stream

In the code-kit mod, a session that leads a stream (or works in one) sees that stream's build: the Build panel's milestone and bar count its stories and requirements, the Lanes panel draws its lanes and the shared core lanes, what's ready is its own, and the Trail is its requirements'. Each panel's name says the stream ("Lanes: play"), and so does the band's build line. The rest of the project is a line per other stream (its lead and what its lanes are on) and one for the shared core lanes (what each is on, and whose turn it was last). The stream's stories core holds, and what its lead has to decide for core, are a line each. A session that leads nothing sees the whole project, and offers each other stream to lead from here, with who leads it now; choosing one makes the session that stream's lead. The Code map labels each layer core or its stream's module.

**Acceptance**

- Given a session leading `a`, then its Lanes panel draws `a`'s lanes and the shared core lanes, not `b`'s, and a line says who leads `b` and what its lanes are on.
- Given a working session in a project with streams, then the band offers **Lead `a`** and **Lead `b`**, and pressing one makes the session that stream's lead.
- Given a project with streams, then the Code map's columns say core, or the stream whose module the layer is.

### PROM-1 Signals that module code belongs in core

code-kit records a promotion candidate when it sees:

1. a clone across streams: code in one stream's module that matches code in another's (see Data);
2. a refused import of another stream's module (STRM-5): the stream asked for a capability the other has;
3. a copy: a lane's act that copies files from another stream's module, or into the project from outside it, named in the event log (spec 26);
4. a clone of core: new module code that matches code core already has;
5. a requirement that matches one another stream already meets: spec-check, reading a story's requirements, finds another stream's requirement it repeats.

Generic code that only one stream uses is not a candidate, however general it looks.

**Acceptance**

- Given a function in `a`'s module and a copy with renamed variables in `b`'s, then `code-kit promote --json` lists one candidate naming both files and the signal.
- Given generic code in `a`'s module and nothing like it in `b`, then there's no candidate.

### PROM-2 Candidates are seen where they're decided

`code-kit promote [--json]` lists the open candidates, each with its evidence and how many streams it touches. The lead's review of a branch notes any it adds: "this repeats core's X: use it" for a clone of core, "this matches `b`'s X: proposed for core" for a clone across streams. `next` offers the platform lead (or, without one, each stream's lead in turn) to decide open candidates when no story waits on them.

**Acceptance**

- Given a branch that adds a clone of core code, then its review lists it as a finding naming core's file.

### PROM-3 A promotion is platform work

The platform lead decides each candidate. Promoted: it becomes a story in the platform's plan (`**Promotes:** <id>`) that moves the code into core, switches each stream's module to it, and proves it with tests every stream that uses it runs; where it's large, it's a conformance pathway (spec 30), lower layers first. Rejected: the reason is kept, and the same code isn't proposed again until its evidence changes (a third stream, a new copy).

**Acceptance**

- Given a candidate promoted, then the platform's plan gains a story naming it, and the candidate closes when that story merges.
- Given a candidate rejected, when the same clone is found again, then no candidate is raised.

### PROM-4 Core stays core

A promotion that would make core depend on a stream's concepts (import a module, or name a stream's types) is refused at review, with what to move with it or what to leave behind. With `harness.promote.coreClones` at `refuse`, verify refuses a branch whose module code repeats core's, not only notes it for the review; a standard can name that rule as checked (spec 22).

**Acceptance**

- Given a promotion story whose moved code imports `a`'s module, then the review sends it back, naming the import.

## Replaces

- SESS-2's one lead per project, with one lead per stream (STRM-2). A project without streams has one stream, so one lead, as before.
- SCHED-1's one agent per lane across the project stays, now with lanes per stream; for core lanes the streams share, the turn-taking of STRM-6 is added.

## Open questions

| Question                                                                                                           | Owner  | Blocks         |
| ------------------------------------------------------------------------------------------------------------------ | ------ | -------------- |
| Is 60 tokens the right length for a clone? To be measured on a real build: candidates raised against promoted      | Warren | PROM-1         |
| Should a stream's lead be able to take the platform lead's role for one decision while the platform has none live? | Warren | STRM-7, PROM-3 |
