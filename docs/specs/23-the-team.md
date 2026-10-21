# 23. The team

**Status:** draft
**Outcome:** The person is the product owner, the main session is the technical lead, and its lane agents are the team. The lead decides everything technical without asking, the person is asked only about product and about what has production, cost or strategy implications, and several sessions can work one project at once without one session's decisions, prompts or files landing in another's.
**Actors:** the person (product owner); each session's lead; lane agents (answer to their session's lead); the loop (keeps the stories moving, and asks the lead for work when the team is idle); the hooks (judge every call)
**Depends on:** 05-lead-loop, 06-hold-and-ask, 09-merge-queue, 12-settings, 15-decisions-and-journal, 16-teams, 19-lead-at-the-helm

Three problems showed up running code-kit on real projects.

The person was still asked technical questions. Spec 19 gives the lead everything inside the guardrails, but only where `/code-kit:init` wrote `approvals.delegate`: a project without it sends every dependency and protected change to the person, merges wait for the person's press, and a weakened test is always the person's.

Decisions leaked and piled up. A developer with several sessions open in one project was asked, in every session, questions another session's lead had raised, and an answer given in the wrong session went to the wrong lead. Another person had 60 decision cards, each saying Claude Code had refused one of the lead's calls, although the lead had found another way each time.

Sessions and lanes collided. One person ran four sessions in one checkout of a brownfield project (an audit, checking merged changes, an integration's readiness, an API's error handling), each able to start its own lanes. With the loop on, build prompts went to whichever session took the loop first, and two agents of the same lane ran at once on overlapping files.

The fix treats each session as a member of the team, as spec 16 treats each developer: a decision belongs to the conversation that raised it, a lane runs one story at a time across the whole project, and what sessions share is facts (claims, leases, the merge queue), never questions.

## Decisions

| Date       | Decision                                                                                                             | Why                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | Merging into the base branch is the lead's                                                                           | Merging isn't releasing: the project's pipelines decide what reaches production                                     |
| 2026-10-21 | The lead approves a weakened test on a lane's branch; on its own branch the person does                              | The lead reviews lanes' work against the requirements; nobody reviews the lead's own stories but the person         |
| 2026-10-21 | A decision is answered only in the session that raised it                                                            | The question's context is that session's conversation; another session's lead would answer without it               |
| 2026-10-21 | One agent per lane at a time, across every session in the project                                                    | Parallel work in one lane conflicts in its worktrees and at merge; the plan's graph is for running different lanes  |
| 2026-10-21 | Slices set priority, not a gate: a lane builds the open slice's stories first, and takes later work when it has none | Lanes don't sit idle, and the feature in progress still finishes first                                              |
| 2026-10-21 | One open slice to start with, to be evaluated                                                                        | The simplest setting that shows whether slices cut merge conflicts                                                  |
| 2026-10-21 | No chat rooms in the mod: several Claude Code sessions stay the way to work in parallel                              | Claude Code's sessions already have the transcript, permissions, commands and compaction; code-kit coordinates them |

## In scope

- Who decides what, by default, and editing it in the Settings tab.
- Sessions as team members: their identity, the lead session, working sessions, ad hoc tasks and their leases.
- One agent per lane across the project, and slices.
- Decisions owned by the session that raised them, kept in one store the CLI reads.

## Out of scope

- Chat rooms or a second conversation inside the mod.
- Changing what the hooks enforce: every rule still holds; this changes who grants an approval, who is asked, and in which session.
- Locking contracts between slices. With one open slice there's nothing to lock; it comes back if the limit is raised.

## Data

| Entity      | Where                              | Fields                                                                                                                                                                                            |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session     | `.claude/state/sessions/<id>.json` | id, short id (first 8 characters), person (GitHub login, or the OS user without one), role (`lead` or `working`), started, last seen, task                                                        |
| Member      | (derived)                          | `<person>/<short id>`: who a claim, lease, approval, question or decision belongs to                                                                                                              |
| Ad hoc task | the session's file                 | title, branch, paths it leases, started; null for a session that only reads                                                                                                                       |
| Lane claim  | `.claude/state/lanes.json`         | lane, story, member, agent's tool call id, since; one per lane                                                                                                                                    |
| Decision    | the questions and requests logs    | id, member, kind (`approve`, `answer`), subject (a story or task), what, context (what was being done, why it's needed), options with what each does, blocks, count, opened, closed `{ at, how }` |
| Slice       | the plan                           | a story's `**Slice:** <name>`; a slice is open from its first dispatch until every story in it is merged                                                                                          |

A decision isn't kept twice: the lead's questions (`.claude/state/questions.jsonl`) and the approvals a refusal asks for (`.claude/state/requests.jsonl`) each record the session that raised them, and `code-kit decisions` reads both as one list. All of it lives in the main checkout's `.claude/state`, which every session and worktree on the machine reads, as approvals and questions do today. A session's id is Claude Code's: `session_id` in hooks, `$.session.id()` in the mod, and `CLAUDE_CODE_SESSION_ID` in every command an agent runs, which is how the CLI knows the session calling it.

## Requirements

### WHO-1 Technical decisions are the lead's by default

With no `approvals.delegate` in the config, the lead decides:

- new dependencies, within the registry rules (`approvals.delegate.dependencies`' defaults);
- every protected approval except `spec`, `design`, `ci` and `kit`;
- merges into the base branch;
- weakened tests on a lane's branch (WHO-2).

The person decides product questions the spec doesn't answer, the specs, the screens' visual design, CI and the pipelines, the kit itself, weakening the standards, and anything with production, cost or strategy implications. A dependency that fails the registry rules (a licence outside the list, install scripts) or is a paid service's SDK goes to the person as a question with the lead's recommendation, not as an approval. A config that sets `approvals.delegate` keeps exactly what it says.

**Acceptance**

- Given a config with no `approvals.delegate` and the web lane running `npm install dayjs`, then the refusal tells the lane to ask the lead, the call isn't held, and the person's band doesn't change.
- Given the same config and a reviewed branch at the head of the merge queue under `autonomous`, then the loop asks the lead to merge it, and the band has no Merge for the person.
- Given a config whose `approvals.delegate` omits `merge`, then merges stay the person's, as before.

### WHO-2 Weakened tests

`tests` can be delegated, and is by default. The lead approves a weakened test on a lane's branch after reviewing it, with what was weakened and why (`code-kit approve tests --lane <lane> --delegated --story ST-n --reason "…"`); the approval log records it as the lead's. On the lead's own branches, a weakened test is still the person's.

**Acceptance**

- Given the api lane's commit removing a test case, when the lead approves `tests` for the api lane with a reason naming the story, then the commit goes through and the log says "approved by the lead within the delegated rules".
- Given the same weakening on `lead/st-9`, then the lead's own approval is refused, and the person's is needed.

### WHO-3 Approvals in the Settings tab

The Settings tab gains an Approvals section, the person's to change: each protected approval with who decides it (the lead or you), dependencies (the lead within the registry rules, or you) with the registry rules, merges, and weakened tests. A change is confirmed with a reason, written to `approvals.delegate`, and logged as the person's (`kit`, "(changed in the code-kit pane)"), as SET-2 does. The hooks refuse an agent's change to it, as today. This amends SET-3: lanes, paths, layers and which paths are protected stay with init; who decides them is a setting.

**Acceptance**

- Given the Approvals section, when the person moves `schema` to "you" and confirms with a reason, then `approvals.delegate.protected` no longer lists `schema`, the approval log has the change, and a lane's next migration is held for the person.

### WHO-4 The loop asks the lead

The loop puts to the lead what spec 05 put to the person, except the person's own choices. A step the lead didn't take is asked again, up to three times, then shown as a note. A lane stalled past its restarts is the lead's to re-brief, split or hand back; the person sees a note, not a decision. `autonomy: propose` still asks the person before each step, because the person chose it, and the first-time question of how hands-off the loop is stays theirs.

**Acceptance**

- Given a lane stalled past `stall.maxRestarts`, then the loop prompts the lead with the story, the restarts and what the agent last did, and the person's Decisions tab doesn't change.

### SESS-1 A session is a member of the team

Every claim, lease, approval given, question, decision and ad hoc task records its member: the person and the session. `code-kit who` says which session the caller is, and a refusal about another member's work names the session and its task ("ST-14 is claimed by your session 7f3a91c2, _checking the API's errors_"). Sessions on one machine coordinate through the main checkout's state, as a local provider; across machines, the team provider carries the same claims and leases (spec 16).

**Acceptance**

- Given two sessions in one checkout, when the second claims a story the first has claimed, then it's refused, naming the first session and its task.

### SESS-2 One lead session

A project has at most one lead session: the one the loop runs in, the plan's dispatches start from, and the band's mission rows describe. A session started when no other is live becomes the lead. A session started while another is live is a working session, and becomes the lead only when the person chooses Lead from here (or `/code-kit:lead`). When the lead session ends, no other takes it over by itself: the next session to start, or the person's choice, does. This replaces LOOP-10's lease, which went to whichever session acted first.

**Acceptance**

- Given a lead session and a second session opened in the same project, then the second is a working session, the loop never prompts it, and its band reads "the lead is in another session".
- Given the lead session closed and a working session still open, then the loop doesn't run until the person chooses Lead from here, or starts a new session.

### SESS-3 Working sessions stay quiet

A working session's band shows only its own: its refusals and held calls, its lead's questions, its task. It gets no loop prompts, no other session's decisions, dialogs or notifications. The hooks apply in full.

### SESS-4 Ad hoc tasks

A working session that changes code records its task first: `code-kit task "<title>" --touches <globs>`. The task leases those paths for the session, as a story's claim does (TEAM-5), and shows in every session's Team pane and in the lead's band as a fact. A working session's first write with no task is refused, with the command to record one. `code-kit task done` ends it and its lease; a task whose session has ended is shown as stale, and `code-kit task take <id>` moves it, with its decisions, to the session running the command.

**Acceptance**

- Given a working session with the task "Integration readiness" leasing `src/integrations/**`, when the lead's api lane writes `src/integrations/client.ts`, then it's refused, naming the session and its task.

### SESS-5 Working sessions write in their own worktree

The lead session may write in the main checkout. A working session's write to project files in the main checkout is refused, saying to move the session to a worktree (Claude Code's `--worktree`, or a worktree it creates). A session that only reads stays in the main checkout. When a git operation in a worktree is blocked by another session's uncommitted files, the refusal names that session.

### SCHED-1 One agent per lane, across the project

A lane runs one story at a time across every session in the project. `code-kit next` offers at most one story per lane, and none for a lane already claimed. Starting a lane agent records its lane claim; a hook on the Agent tool refuses a second agent for a claimed lane, naming the story and the session running it. The claim ends when the agent finishes (its story handed to review, or handed back) or its session ends. The dispatch skill's exception for stories touching disjoint folders goes.

**Acceptance**

- Given ST-3 and ST-4 both ready for the web lane, then `next --json` offers ST-3 only.
- Given the web lane running ST-3 in one session, when another session starts a web agent for ST-7, then it's refused, naming ST-3 and the first session.
- Given ST-3's agent finished and ST-3 in review, then the web lane is free and `next` offers ST-4.

### SCHED-2 Slices

A story may belong to a slice (`**Slice:** <name>`): a feature that can be shown working, built across lanes. `harness.slices.open` (default 1) is how many slices are in focus. For each free lane, `next` offers, in order: a ready story in an open slice; a ready story in the next slice in plan order, opening it if fewer than `slices.open` are open; any other ready story, marked as ahead of its slice. A slice closes when every story in it is merged. The Lanes pane and `status` show each story's slice, and `report` carries it.

**Acceptance**

- Given the open slice "Book a class" with an api story ready, and the web lane free with nothing ready in that slice, then `next` offers the web lane the next slice's ready story, marked ahead of its slice, and still offers the api story first to the api lane.

### OWN-1 A decision belongs to the session that raised it

Every decision is written to the decisions store with its member and its context: what was being done, why it's needed, and what each answer does. It's shown, asked and answered only in that session. Other sessions show a count ("2 decisions in session 7f3a91c2"), and can't answer them. Its answer goes to that session's lead. `code-kit decisions [--json] [--all]` lists the caller's (or every session's), and the mod draws from it instead of assembling decisions itself.

**Acceptance**

- Given a question the lead asked in session A, then session B's band and dialogs don't show it, its Decisions tab shows "1 decision in session A", and answering in A sends the answer to A's lead.

### OWN-2 Only what's holding something up

A decision is something only the person can settle, that's holding work up now. A call Claude Code's own permission check refused is shown in the Lanes pane's activity, not as a decision; the agent is told to find another way or ask the lead, and the lead asks the person (`code-kit ask`, quoting the refusal) only when there's no other way. This replaces PERM-1.

**Acceptance**

- Given 60 calls refused by Claude Code's auto mode in one session, each followed by the lead finding another way, then the Decisions tab is empty.

### OWN-3 One decision per subject

The same decision raised again for the same subject (the same approval for the same lane and story, the same question) is one decision with a count.

### OWN-4 Every decision ends

A decision closes when it's answered or when its cause goes: the call went through, the request was granted, the agent finished, the story merged, the task was done. A decision whose session has ended stays with its story or task, and comes back when the session is resumed or the task is taken over (SESS-4). Nothing waits forever, and nothing moves to another session's lead by itself.

### OWN-5 Interruptions are rationed

Claude Code's question dialog and the system notification are only for a decision that's blocking work, owned by this session, one at a time, each asked once.

**Acceptance**

- Given four sessions and one blocking question in session C, then only session C shows a dialog or raises a notification.

## Replaces

- LOOP-10's lease taken by whichever session acts first (SESS-2).
- PERM-1 (OWN-2).
- DECIDE-2 to DECIDE-4 and CARD-8 where they assemble decisions in the mod (OWN-1 to OWN-5); a decision card still shows its lineage.
- HELM-1's default, which needed init to write it (WHO-1); `tests` never delegated (WHO-2).
- The dispatch skill's "unless two stories touch disjoint folders" (SCHED-1).

## Open questions

| Question                                                                               | Owner  | Blocks  |
| -------------------------------------------------------------------------------------- | ------ | ------- |
| Does one open slice cut merge conflicts and send-backs? To be measured on a real build | Warren | SCHED-2 |
