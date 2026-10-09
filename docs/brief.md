# code-kit in the session: a continuous engineering harness

**Status:** framed
**Updated:** 2026-10-09

## Problem

The first mod (v1, released in 0.4) shows code-kit in the session: a Lanes pane, a waiting band, approve, review and merge buttons, and refusal cards. It shows and acts on a press, but the work between presses still waits on someone:

- **Dispatch waits for someone.** A lane finishes and its branch sits until the person or the lead remembers to review it. A ready story waits to be dispatched. A lane agent that stalls stays stalled.
- **Refusals stop the work.** An install or a protected edit is refused and the agent stops, even when the person is right there and would approve in a second.
- **Nothing is measured.** No one sees what a lane costs, or whether every requirement is built and tested, until someone runs `status`.
- **The panes are plain text rows.** They have no sense of time, no drill-down and no keyboard model, and they show less than other mods do with the same platform.

Context Graph has the same gap: owed cards interrupt the lead at turn end, proposals only appear if someone looks, and an edit refused for unread imports leaves the agent to work out what to read.

Claude Code mods can do what shell hooks can't. They live for the whole session, keep state, run timers, start and message agents, hold a tool call open while they ask the person, and draw rich panes. That's enough to run the loop between presses.

## Users

| Actor             | Trying to get done                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| The person        | Watch a build run itself, answer only what needs them, and steer: autonomy, agents, budgets                        |
| The lead          | Keep the build moving: dispatch what's ready, review what's finished, merge what passes, without being re-prompted |
| Lane agents       | Unchanged rules; wait for an answer instead of stopping when a person is there to approve                          |
| Background agents | New: a reviewer, a card writer and a curator, each started by the mod within the project's opt-in and budget       |
| Other surfaces    | `claude -p`, the Agent SDK, cloud sessions and CI run the hooks only, as today; Sidequest keeps its own supervisor |

## Outcome

In one ordinary Claude Code session (terminal, VS Code's terminal, or Desktop), a milestone goes from stories ready to merged with the person only answering what the band asks: no typed commands, no re-prompting the lead, every changed file carded, and every branch reviewed before it merges.

How anyone will know: the session's history shows dispatch, review and merge happening without the person typing a prompt, and the person's only inputs are band answers.

## Constraints

- **Two mods that cooperate.** Each plugin keeps its own mod and works alone; when both are installed they share views and signals.
- **Enforcement stays in the hooks**, so CI, SDK sessions and other tools keep every rule. A mod may hold a call and ask, but never allows what a hook refuses.
- **The lead acts.** The mod prompts the lead to dispatch, review and merge with the existing skills; it doesn't brief lane agents itself.
- **Claude Code 2.1.287 or later** draws mods; older versions skip them and run the hooks.
- **No dependencies, no build step** in code-kit; Context Graph keeps its build. A mod imports only files inside its plugin and `claude-code`, and gets its facts from its plugin's command line.
- **Usage is the person's subscription.** Background agents and model calls are opt-in, with a model and a budget per agent.

## Non-goals

- Enforcement in mods.
- Unattended, phone-driven running: that's Sidequest's, through its SDK supervisor.
- Anything outside Claude Code: no web dashboard or separate app.
- Editing lanes, paths, layers or protected paths from a pane: those change through init, which shows the diff and ownership moves first.

## Scope

To be shaped (phase 3).

## Decision log

| Date       | Decision                                                                                                                                     | Why                                                                                                   | Rejected, and why                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2026-10-06 | Present code-kit through a Claude Code mod; keep enforcement in the shell hooks.                                                             | Hooks also run in CI, SDK sessions and other tools; a mod only shows and acts.                        | Moving enforcement into the mod: it wouldn't run where Claude Code can't draw. |
| 2026-10-06 | Buttons are added as a way to approve; `!` commands and chat approvals stay, and every approval records how it was given.                    | Buttons don't exist where Claude Code can't draw, or on a phone.                                      | Buttons replacing `!`. Buttons only for low-risk approvals.                    |
| 2026-10-06 | A band above the prompt appears only when something waits for the person; the Lanes pane opens on demand (`/lanes` or the band).             | Visible when it matters, quiet otherwise.                                                             | A pane that opens itself (needs 144 columns, intrusive). Nothing until asked.  |
| 2026-10-06 | code-kit and Context Graph each have their own pane, and each links to the other when both are installed.                                    | Each plugin works alone, as with their adapters.                                                      | One shared pane with tabs, which couples the plugins.                          |
| 2026-10-06 | Approve opens a confirmation showing what, for which lane, for 60 minutes, with a reason prefilled for the person to keep or rewrite.        | Hard to approve by accident; the reason in the log is the person's.                                   | One press.                                                                     |
| 2026-10-06 | Finished branches get Review (asks the lead to run the review skill) and Merge (the person's own act: verify, then merge only if it passes). | The person can finish a story from the pane.                                                          | Review only. Showing only.                                                     |
| 2026-10-06 | The mod ships inside the code-kit plugin.                                                                                                    | Claude Code 2.1.280 skipped the mod and still ran the settings hooks, so older versions keep working. | A separate plugin: a second install for the same tool.                         |

| 2026-10-09 | Grow the mods into a continuous harness: the lead loop, background agents, ask instead of refuse, cost, merge queue, traceability, card writer, curator, read-assist, side questions, graph explorer, a combined lane view, and richer panes. | Mods can run the loop between presses, which hooks can't. | Better panes only. |
| 2026-10-09 | The harness runs inside an interactive session; Sidequest keeps its SDK supervisor for unattended work and gains these mods in its sessions. | One clear role each; no duplicated supervisor. | Replacing Sidequest's supervisor: mods only run in an open session. Designing without regard to Sidequest: two lead loops that drift. |
| 2026-10-09 | The lead loop is autonomous by default: it dispatches, restarts and sequences on its own, and merges only where `approvals.delegate.merge` allows (the hooks enforce that). | Continuous by default; the delegated rules already bound merging. | Always propose (not continuous). Propose by default with levels (the person preferred autonomy). |
| 2026-10-09 | Background agents are off until the project turns each on, with its own model and a daily budget, pausing near the plan's limit. | No surprise usage. | On by default with cheap models. Manual only. |
| 2026-10-09 | Two mods that cooperate, each plugin standalone. | Keeps both products separately installable and publishable. | A third harness plugin (another install). Merging the plugins. |
| 2026-10-09 | The lead carries out the loop's actions: the mod prompts it when idle. | Dispatch and review keep their skills, briefs and spec-checks. | The mod spawning lane agents itself (duplicates dispatch, bypasses the lead). |
| 2026-10-09 | A call that needs the person's approval is held and asked about for 2 minutes, then refused as today. | Answer in place when present; never hang a lane. | 10 minutes. Until answered. |
| 2026-10-09 | Success: a milestone from ready to merged in one session, the person only answering the band. | Observable, end to end. | Time to merge. Count of interventions. |
| 2026-10-09 | The pane may edit the harness settings (autonomy, agents, models, budgets, hold time) and the delegation rules, written as the person's change; lanes, paths, layers and protected paths still change through init. | Settings a person flips mid-session; structure needs init's diff and ownership review. | No config editing at all (the person asked what could be edited). |
| 2026-10-09 | Drawing works in VS Code's integrated terminal (it runs the terminal surface); only the VS Code extension's chat panel, `-p`, the SDK and cloud sessions draw nothing. | Seen in use. | v1's assumption that VS Code draws nothing. |

## Open questions

| Question                                                                                    | Owner  | Blocks      |
| ------------------------------------------------------------------------------------------- | ------ | ----------- |
| What Raster and Client regions look like in the person's VS Code terminal (the probe pane). | Warren | Pane design |
