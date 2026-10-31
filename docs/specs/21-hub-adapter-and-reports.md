# 21. The hub adapter and what a project reports

**Status:** draft
**Outcome:** A team on code-kit hub installs nothing beyond code-kit, and the hub can show delivery, usage and governance across a team's repositories from facts code-kit already has, without ever receiving code.
**Actors:** each developer's session (code-kit's hooks, CLI and mod); the lead; a team provider (code-kit hub, or GitHub)
**Depends on:** 08-usage, 09-merge-queue, 10-traceability, 15-decisions-and-journal, 16-teams

code-kit already knows, inside each session, what the hub's manager pages need: each story's stage and when it got there (`status`, `timeline`), each requirement's trail (`trace`), who approved what (`journal`, the approval log), what each agent used (spec 08) and the project's rules (`.claude/code-kit.json`). What's missing is a way to hand those facts to a team provider. This spec adds one operation to the provider interface for that, and moves the hub's client into code-kit as an adapter, so a team doesn't install a second plugin.

## In scope

- `report`: a snapshot of a project's facts, sent to the team provider.
- Showing exactly what would be sent, before anything is.
- The hub's client (sign-in, the provider command, the event stream, presence, connect) as an adapter in `hooks/lib/adapters/hub/`.
- Milestone targets in the plan.

## Out of scope

- What the hub does with a report (code-kit hub, spec 04).
- Project standards (`docs/standards.md`): spec 22.
- Any change to the GitHub provider's behaviour beyond answering `report` with nothing.

## Data

A report is one JSON document per project, replacing the last one.

| Part        | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project     | repository, base branch, code-kit version, when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Milestone   | name, target date (if the plan gives one), its stories                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Slice       | name, whether it's open, whether it's done, its stories (spec 23, SCHED-2). Added in report version 3                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Story       | id, title, lane, milestone, requirement ids, depends on, stage, when each stage began, who claimed it; its summary, the paragraph the plan writes under its fields, at most 600 characters cut at a sentence (report version 4); the spec-check report's result on its branch, its worst requirement's status (`done`, `partial`, `missing`, `conflicts`, or `none` with no report), and its place in the merge queue while its branch waits there, 1 merging next (report version 5)                                                                              |
| Send-back   | story, when, the reason's one line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Requirement | id, its title (report version 4), its stories, built (paths), tested (test files), the spec-check report's status for it (`done`, `partial`, `missing`, `conflicts`, or `none`)                                                                                                                                                                                                                                                                                                                                                                                    |
| Spec        | the id the project gives it (the number its `# ` heading starts with, or its file's name), its file, its title (the rest of that heading), its outcome line (its `**Outcome:**`, at most 600 characters cut at a sentence) and its requirements' ids. A file with neither an outcome nor a requirement isn't a spec. Added in report version 5                                                                                                                                                                                                                     |
| Approval    | what (`protected`, `dependency`, `tests`, `merge` and the rest), path or package, who (the person, or the lead within the limits), when, its branch; its approver, the person's GitHub login, when the person gave it and code-kit knew who was at the machine (the approval log records it as the commit is made), and its story, from its branch (report version 5)                                                                                                                                                                                              |
| Usage       | per story and per kind of agent (lead, lane, reviewer, security reviewer, background): input, output and cache tokens, as spec 08 measures them (it measures neither the model nor the time)                                                                                                                                                                                                                                                                                                                                                                       |
| Rules       | layers, protected paths' approvals, what the lead may approve on the person's behalf, the design gate. In report version 5: each layer's deliverable kind; each lane, with its deliverable kind, the layers its paths fall in, its paths and its exclusions; and the security review's rules: whether the project has the security reviewer, the kinds of change it reviews (`sign-in`, `permissions`, `input`, `personal data`, `encryption`, `payments`, `secrets`, `injection`, `dependencies`, `requirements`) and the ids of the specs' security requirements |
| Design      | each entry of the design register (spec 24): its screen, its code file, its design story, the date it was approved, the tool it was drawn in, its state (`handed-over`, `in-tool`, or `problems` when a file is missing or changed, or a state the spec lists has no design) and its states' names. Added in report version 5                                                                                                                                                                                                                                      |
| Session     | each session at work on the reporting machine (spec 23, SESS-1): its id, whether it leads or works, its person's GitHub login, the code-kit and the model it runs, when it started, and the file it last edited (by path) and when. Added in report version 5                                                                                                                                                                                                                                                                                                      |
| Standards   | each standard that applies (spec 22): id, title, category, level, how it's applied, layers, the kind of source (spec, decision, threat model, code, organisation), the evidence's counts ("41 of 43"), where it came from (own, inherited, extended, tightened, waived), and its why in one line. Added in report version 2                                                                                                                                                                                                                                        |

A story's stage is one of `planned`, `claimed`, `building`, `review`, `sent-back`, `queued`, `merged`, `done`.

A layer's or lane's deliverable kind is its `label` in the config, or else what its name gives: `schemas`, `contracts` or `api` an "API contract", `web`, `mobile` or `ui` "Screens", `data` or `db` "Data", `domain`, `core`, `services` or `backend` a "Service", `tests` or `qa` "Tests", `design` "Design", `infra` or `platform` "Infrastructure", `docs` "Docs"; any other name, as it's written, capitalised.

Every part added after version 1 is optional, so a report from an older code-kit is still valid; once a part is there, its fields are checked like any other. A provider validates a report against the same allow-list (`SNAPSHOT_SCHEMA` in `hooks/lib/snapshot.mjs`).

Never in a report: file contents, diffs, prompts, an agent's messages, the text of specs, requirements or the plan beyond their ids, titles, each spec's outcome line and each story's summary (no acceptance criteria, no requirement bodies, no decisions), a session's task or what it wrote, secrets, environment variables.

The drift check is the provider's own (spec 16): code-kit's config holds no rule for what drift blocks, so a report carries none.

## Requirements

### HUBR-1 The provider interface gains `report`

The team provider interface (TEAM-2) gains `report(snapshot)`. The GitHub provider answers it with nothing and keeps nothing: the free team mode has no server to send it to. A command provider receives the snapshot on stdin.

**Acceptance**

- Given the GitHub provider, when code-kit reports, then nothing is written to the repository or to GitHub.

### HUBR-2 What a report holds

`code-kit team report` builds the snapshot from `status`, `timeline`, `trace`, `journal`, the approval log, spec 08's usage, the config, and in report version 5 the specs' headings and outcome lines, the spec-check reports, the merge queue, the design register, the security review's rules and the sessions code-kit records, as the Data section lists, and nothing else.

The presence the hub's client sends every 30 seconds (HUBR-6) carries, beside each agent's type, tool and branch, what code-kit recorded of the session: the code-kit and the model it runs, when it started, and the file it last edited in the last ten minutes, by path. The model is the one Claude Code's SessionStart names, or else the one its transcript's last reply came from, read at most once a minute.

**Acceptance**

- Given a plan with ST-4 in review since 10:05 after building from 09:12, and an approval of `pnpm add zod` by the lead within the limits, then the report has ST-4 at `review` with both times, and the approval with "the lead, within the limits".
- Given any project, then no field of the report holds a file's contents, a diff or a prompt.
- Given a spec `# 03. Booking` with `**Outcome:** A customer books without calling us.` and BOOK-1, then the report's spec 03 has that title, outcome and requirement, and no requirement's body.
- Given the person's design approval made while code-kit knows kim is at the machine, and the lead's approval of a package within the limits, then the first has kim as its approver and the second none; each has the story its branch is for.
- Given a session started on a model and editing `apps/web/list.tsx`, then the report's session and its presence name the model, code-kit's version, when it started, and that file.

### HUBR-3 When it's sent

With a provider that isn't GitHub, code-kit reports on each change to a story's stage, an approval, a send-back or a merge, and otherwise at most every 10 minutes while a session is open. A report that matches the last one sent isn't sent again. A provider that can't be reached is tried again with the next change; nothing waits on it.

### HUBR-4 Seeing what's sent, and turning it off

`code-kit team report --dry-run` prints exactly what would be sent. `team.report: false` in the config stops reports; the hub's pages then say the repository doesn't report, and show only what the hub sees itself.

### HUBR-5 Milestone targets

A milestone heading in the plan may be followed by `**Target:** 2026-11-30`. The plan reader keeps it with the milestone, and the report carries it.

**Acceptance**

- Given "## Milestone 2: Payments" followed by "**Target:** 2026-11-30", then the report's milestone "Payments" has the target 2026-11-30.

### HUBR-6 The hub's client is an adapter in code-kit

The hub's client lives in `hooks/lib/adapters/hub/`: signing a machine in through GitHub's device flow, the provider command, the session's daemon (the event stream and the team's state on disk), presence (sent by the mod every 30 seconds, by agent type, tool name and branch), and connecting a repository (`code-kit team provider signin|status|connect`, which `/code-kit:team-init` runs when the config names a hub; connect also adds the hub's MCP server to the project's `.mcp.json`). `team.provider: { "hub": "<the hub's address>" }` chooses it, with GitHub as its fallback. Code-kit's own SessionStart and SessionEnd hooks hold the session's link. Nothing in the core names the hub: it finds the adapter through the adapters' registry. The separate code-kit-hub plugin is retired; a repository already on it is moved to the adapter by setting `team.provider` to the hub's address and running `code-kit team provider connect`.

**Acceptance**

- Given a repository whose config names the hub, when a session starts, then code-kit's own hooks start the daemon, and the Team pane shows the hub as live; no other plugin is installed.
- Given the hub unreachable, then claims go through GitHub, as TEAM-8 says.

### HUBR-7 Intents with the hub don't need Discussions

With the hub as the provider, intents are kept by the hub, and team-init doesn't ask for Discussions or an Intents category. A team may still mirror intents to Discussions (`team.intents` set); the hub then posts each intent there too.

**Acceptance**

- Given the hub as provider and a repository without Discussions, then team-init reports nothing to set up for intents, and `code-kit intend` records the intent.

### HUBR-8 In preview, the adapter stays out of sight

Until the hub takes customers, nothing in code-kit points anyone to it: the README, `/code-kit:team-init` and `code-kit next` don't mention it, and the release notes say only that a hosted provider adapter is in preview. It runs only for a repository whose config names a hub, set by hand.

**Acceptance**

- Given a project without `team.provider.hub`, then team-init offers only the GitHub provider, and nothing code-kit prints names the hub.
