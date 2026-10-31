# 21. The hub adapter and what a project reports

**Status:** draft
**Outcome:** A team on code-kit hub installs nothing beyond code-kit, and the hub can show delivery, usage and governance across a team's repositories from facts code-kit already has, without ever receiving code.
**Actors:** each developer's session (code-kit's hooks, CLI and mod); the lead; a team provider (code-kit hub, or GitHub)
**Depends on:** 08-usage, 09-merge-queue, 10-traceability, 15-decisions-and-journal, 16-teams, 17-onboarding, 26-durable-lanes

code-kit already knows, inside each session, what the hub's manager pages need: each story's stage and when it got there (`status`, `timeline`), each requirement's trail (`trace`), who approved what (`journal`, the approval log), what each agent used (spec 08) and the project's rules (`.claude/code-kit.json`). What's missing is a way to hand those facts to a team provider. This spec adds one operation to the provider interface for that, and moves the hub's client into code-kit as an adapter, so a team doesn't install a second plugin.

## In scope

- `report`: a snapshot of a project's facts, sent to the team provider.
- Showing exactly what would be sent, before anything is.
- The hub's client (sign-in, the provider command, the event stream, presence, connect) as an adapter in `hooks/lib/adapters/hub/`.
- Milestone targets in the plan.
- A provider's drift findings holding a branch in the merge queue (HUBR-9).

## Out of scope

- What the hub does with a report (code-kit hub, spec 04).
- Project standards (`docs/standards.md`): spec 22.
- Any change to the GitHub provider's behaviour beyond answering `report` with nothing.

## Data

A report is one JSON document per project, replacing the last one.

| Part            | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project         | repository, base branch, code-kit version, when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Milestone       | name, target date (if the plan gives one), its stories                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Slice           | name, whether it's open, whether it's done, its stories (spec 23, SCHED-2). Added in report version 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Story           | id, title, lane, milestone, requirement ids, depends on, stage, when each stage began, who claimed it; its summary, the paragraph the plan writes under its fields, at most 600 characters cut at a sentence (report version 4); the spec-check report's result on its branch, its worst requirement's status (`done`, `partial`, `missing`, `conflicts`, or `none` with no report), and its place in the merge queue while its branch waits there, 1 merging next (report version 5)                                                                                                                                 |
| Send-back       | story, when, the reason's one line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Requirement     | id, its title (report version 4), its stories, built (paths), tested (test files), the spec-check report's status for it (`done`, `partial`, `missing`, `conflicts`, or `none`)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Spec            | the id the project gives it (the number its `# ` heading starts with, or its file's name), its file, its title (the rest of that heading), its outcome line (its `**Outcome:**`, at most 600 characters cut at a sentence) and its requirements' ids. A file with neither an outcome nor a requirement isn't a spec. Added in report version 5                                                                                                                                                                                                                                                                        |
| Approval        | what (`protected`, `dependency`, `tests`, `merge` and the rest), path or package, who (the person, or the lead within the limits), when, its branch; its approver, the person's GitHub login, when the person gave it and code-kit knew who was at the machine (the approval log records it as the commit is made), and its story, from its branch (report version 5)                                                                                                                                                                                                                                                 |
| Usage           | per story and per kind of agent (lead, lane, reviewer, security reviewer, background): input, output and cache tokens, as spec 08 measures them (it doesn't measure the time); in report version 6, per model too: each row's model as Claude Code names it on the model request (`claude-opus-5-5`), null for usage recorded before                                                                                                                                                                                                                                                                                  |
| Security review | Added in report version 6: each story whose branch needs the security review now (ONB-7, read from git for a branch still at work), or whose security reviewer ran: its story and branch, whether it needs it (null when its branch can't be compared), the kinds of change it needs it for (`sign-in`, `permissions` and the rest of the security rules' kinds), whether the reviewer ran, when it reported, and its result: `pass` (no findings), `findings`, or `unread` (its report had no findings block that reads), with the findings and the blockers counted. Never a finding's text, where it is or its fix |
| Intent          | Added in report version 6: each intent a claim says its story carries out (`team claim <story> --intent <n>`): its number, the story, and the number of that story's open pull request (by its branch) and whether it's a draft, null while it has none                                                                                                                                                                                                                                                                                                                                                               |
| Claim           | Added in report version 6: each claim as the provider last gave it: its story, who holds it, when it was taken, when it was last renewed (`active`: claimed again, its lease grown by a commit, or its branch pushed, whichever is latest), whether it's stale (`team.staleDays` working days since), and its lease's paths. No claim renews on a schedule: a claim holds until it's released, reassigned or its story merges, so its last renewal is what's reported                                                                                                                                                 |
| Rules           | layers, protected paths' approvals, what the lead may approve on the person's behalf, the design gate. In report version 5: each layer's deliverable kind; each lane, with its deliverable kind, the layers its paths fall in, its paths and its exclusions; and the security review's rules: whether the project has the security reviewer, the kinds of change it reviews (`sign-in`, `permissions`, `input`, `personal data`, `encryption`, `payments`, `secrets`, `injection`, `dependencies`, `requirements`) and the ids of the specs' security requirements                                                    |
| Design          | each entry of the design register (spec 24): its screen, its code file, its design story, the date it was approved, the tool it was drawn in, its state (`handed-over`, `in-tool`, or `problems` when a file is missing or changed, or a state the spec lists has no design) and its states' names. Added in report version 5                                                                                                                                                                                                                                                                                         |
| Session         | each session at work on the reporting machine (spec 23, SESS-1): its id, whether it leads or works, its person's GitHub login, the code-kit and the model it runs, when it started, and the file it last edited (by path) and when. Added in report version 5                                                                                                                                                                                                                                                                                                                                                         |
| Standards       | each standard that applies (spec 22): id, title, category, level, how it's applied, layers, the kind of source (spec, decision, threat model, code, organisation), the evidence's counts ("41 of 43"), where it came from (own, inherited, extended, tightened, waived), and its why in one line. Added in report version 2                                                                                                                                                                                                                                                                                           |

A story's stage is one of `planned`, `claimed`, `building`, `review`, `sent-back`, `queued`, `merged`, `done`.

A layer's or lane's deliverable kind is its `label` in the config, or else what its name gives: `schemas`, `contracts` or `api` an "API contract", `web`, `mobile` or `ui` "Screens", `data` or `db` "Data", `domain`, `core`, `services` or `backend` a "Service", `tests` or `qa` "Tests", `design` "Design", `infra` or `platform` "Infrastructure", `docs` "Docs"; any other name, as it's written, capitalised.

Every part added after version 1 is optional, so a report from an older code-kit is still valid; once a part is there, its fields are checked like any other. A provider validates a report against the same allow-list (`SNAPSHOT_SCHEMA` in `hooks/lib/snapshot.mjs`).

Never in a report: file contents, diffs, prompts, an agent's messages (the security reviewer's report included: only its findings counted), the text of specs, requirements, intents or the plan beyond their ids, titles, each spec's outcome line and each story's summary (no acceptance criteria, no requirement bodies, no decisions), a session's task or what it wrote, secrets, environment variables.

The drift check is the provider's own (spec 16), and so is what it blocks: the provider's setting says, and its state tells code-kit (HUBR-9). code-kit's config holds no rule for it, so a report carries none.

## Requirements

### HUBR-1 The provider interface gains `report`

The team provider interface (TEAM-2) gains `report(snapshot)`. The GitHub provider answers it with nothing and keeps nothing: the free team mode has no server to send it to. A command provider receives the snapshot on stdin.

`claim(story, lease, intent)` takes the intent the story carries out, as a number; a provider keeps it on the claim, gives it back on the claim in `state()`, and keeps it through a claim again without one and through a reassignment. A provider that checks drift answers `state()` with what holds a merge and its open findings (HUBR-9).

**Acceptance**

- Given the GitHub provider, when code-kit reports, then nothing is written to the repository or to GitHub.

### HUBR-2 What a report holds

`code-kit team report` builds the snapshot from `status`, `timeline`, `trace`, `journal`, the approval log, spec 08's usage, the config, in report version 5 the specs' headings and outcome lines, the spec-check reports, the merge queue, the design register, the security review's rules and the sessions code-kit records, and in report version 6 the model each model request ran on, the security review each branch needs (ONB-7) and the security reviewer's record in the story's event log, and the claims and open pull requests the team provider last gave, as the Data section lists, and nothing else.

The security reviewer's record is written as it stops (SubagentStop): its findings block counted by grade, on the story whose Agent call started it. A reviewer the lead waits on belongs to the latest such call not yet ended; one run in the background, to the call whose launch named its agent id. A report without a findings block that reads is recorded as `unread`, never as a pass.

The presence the hub's client sends every 30 seconds (HUBR-6) carries, beside each agent's type, tool and branch, what code-kit recorded of the session: the code-kit and the model it runs, when it started, and the file it last edited in the last ten minutes, by path. The model is the one Claude Code's SessionStart names, or else the one its transcript's last reply came from, read at most once a minute.

**Acceptance**

- Given a plan with ST-4 in review since 10:05 after building from 09:12, and an approval of `pnpm add zod` by the lead within the limits, then the report has ST-4 at `review` with both times, and the approval with "the lead, within the limits".
- Given any project, then no field of the report holds a file's contents, a diff or a prompt.
- Given a spec `# 03. Booking` with `**Outcome:** A customer books without calling us.` and BOOK-1, then the report's spec 03 has that title, outcome and requirement, and no requirement's body.
- Given the person's design approval made while code-kit knows kim is at the machine, and the lead's approval of a package within the limits, then the first has kim as its approver and the second none; each has the story its branch is for.
- Given a session started on a model and editing `apps/web/list.tsx`, then the report's session and its presence name the model, code-kit's version, when it started, and that file.
- Given the lead's requests on `claude-opus-5-5` and a lane's on `claude-haiku-5` for ST-4, then the report's usage has a row for each, with its model.
- Given ST-4's branch changing `apps/office/login.tsx`, then before the security reviewer runs the report has ST-4 needing the review for `sign-in`, not run; after a reviewer the lead waited on reports a blocker and a nit, it has ST-4's review run, when, `findings`, 2 findings and 1 blocker, and none of the findings' words. A reviewer run in the background that stopped without a findings block is `unread`.
- Given ST-4 claimed with `--intent 12` and its branch's draft pull request #31 open, then the report's intents hold `{ id: 12, story: ST-4, pull: 31, draft: true }`, and its claims ST-4's holder, when it was taken and last renewed, not stale, and its lease.

### HUBR-3 When it's sent

With a provider that isn't GitHub, code-kit reports on each change to a story's stage, an approval, a send-back or a merge (and from report version 6, a security review that ran or an intent's pull request), and otherwise at most every 10 minutes while a session is open. A report that matches the last one sent isn't sent again. A provider that can't be reached is tried again with the next change; nothing waits on it.

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

### HUBR-9 A drift finding holds a merge

A provider that checks each push for drift has a per-repository setting, "What blocks a merge": a finding against a spec or decision, any finding, or nothing. code-kit's merge queue holds a branch while the provider says it has an open finding at that level, says why, and lets it through once the finding clears. The rule is the provider's; code-kit reads it from the provider's state, through the provider interface, and its config holds none. GitHub's built-in provider checks no drift, so it never holds.

**What the provider exposes.** Its answer to `state()` (for the hub, `POST /v1/repos/<owner>/<name>/state`, and the same state the session's daemon writes to `.claude/state/team.json` after each stream event) carries:

- `mergeHolds`: `"spec-or-decision"`, `"any"` or `"nothing"`, the repository's setting. "Against a spec or decision" is `spec-or-decision`, and it's what a repository that hasn't chosen gets; "Any finding" is `any`; "Nothing" is `nothing`. A state without `mergeHolds` (an older provider) holds nothing.
- `findings`: every open finding on the repository's branches, and only open ones: a finding leaves the list the moment it's resolved. Each is `{ id, branch, conflictsWith, severity, title, text, url, by, story, push, head, checkedBy, at }`:
  - `id`: the finding's number; `branch`: the branch it was found on, as pushed (`web/st-4`);
  - `conflictsWith`: what it's against, starting with its kind: `spec <path>`, `decision <path>`, `branch <name>` or `intent #<n>`;
  - `severity`: `blocker`, `concern` or `note`; `title`: what it is, in a line (null when it has none); `text`: what it found and what to do;
  - `url` (optional): the provider's page where the finding is read and resolved;
  - `by`, `story`, `push`, `head`, `checkedBy`, `at` as the provider records them; code-kit doesn't read them to decide.

**When a finding is open, and when it clears.** The provider resolves a finding, and it leaves `findings`, when:

- the tech lead, or an admin of the repository, resolves it on the provider's page, saying why (the work still stands); the provider records who, when and why;
- a later push's drift check no longer finds it (cleared), or finds it again in other words (the new finding replaces it, and holds in its place);
- the branch merges, or its pull request closes.

Each new finding, each resolution and each change of the setting is an event on the repository's stream, so every session's state on disk is renewed at once.

**How code-kit holds.** A branch is held while `findings` has one whose `branch` is it and either `mergeHolds` is `any`, or `mergeHolds` is `spec-or-decision` and its `conflictsWith` starts with `spec ` or `decision `. Its severity doesn't change that. A held branch keeps its place, and the queue merges the next one that isn't held; a group that lands together (MQ-7) waits whole while any of its branches is held. `queue merge` and `merge <branch>` ask the provider afresh before merging; `queue`, `queue --json` (which the band reads) and `next` use the state as last read. The words, for each held branch: "web/st-4 is held from merging: the drift check found it against the spec docs/specs/03-booking.md (a concern): BOOK-1 changed on main (its url). The tech lead (lead) decides: if the work still stands, resolve the finding on (the provider); otherwise push a fix to web/st-4, and the drift check clears it once a push no longer conflicts. It merges as soon as nothing holds it." `next` names each held branch's finding in its notes, and when only findings hold the queue, its step says so. The band offers no Merge for a held branch, and says it's held by the drift check.

**When the provider can't be reached.** When `state()` came through the fallback, or says it isn't reachable, nothing is held for drift, as claims aren't checked then (TEAM-8): code-kit says "…, so drift findings weren't checked: merges don't wait on them until it answers."

**Acceptance**

- Given the setting "Against a spec or decision" and an open finding on web/st-4 against `spec docs/spec/booking.md`, then `queue` marks web/st-4 held by the drift check and gives the words above; `queue --json` gives it the finding; `next` names it; `queue merge --person` merges nothing and web/st-4 keeps its place; and `merge web/st-4` is refused with the same words.
- Given that setting and a finding against `branch web/st-5` only, then nothing is held; given "Any finding", web/st-4 is held for it.
- Given the finding resolved, then `queue merge` merges web/st-4.
- Given a provider that can't be reached, with an open finding when it was last read, then nothing is held, and `queue` and `next` say drift findings weren't checked.
- Given the GitHub provider, then nothing is held and the provider isn't asked.
