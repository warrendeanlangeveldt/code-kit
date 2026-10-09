# code-kit in the session: a continuous engineering harness

**Status:** scoped
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

Built plugin by plugin: spikes first, then code-kit's harness and panes, then Context Graph's, then the view that joins them. v1's areas (specs 01–04) stand as built.

| Area                    | Spec                                   | First release                                                                                            | Later                   |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| Lead loop               | `specs/05-lead-loop.md`                | Dispatch what's ready, nudge and restart stalled lanes, prompt reviews and merges; autonomous by default |                         |
| Hold and ask            | `specs/06-hold-and-ask.md`             | A call needing approval is held and asked about for 2 minutes, then refused as today                     |                         |
| Reviewer agent          | `specs/07-reviewer.md`                 | A background reviewer per finished branch, findings graded nit, concern or blocker                       | Reviewers per lane type |
| Usage per lane          | `specs/08-usage.md`                    | Tokens per lane, story and background agent; background agents pause near the plan's limit               |                         |
| Merge queue             | `specs/09-merge-queue.md`              | Reviewed branches merge in order; a conflicting one goes back to its lane                                |                         |
| Traceability map        | `specs/10-traceability.md`             | Requirements by stories and tests, as a live map                                                         |                         |
| Panes v2                | `specs/11-panes.md`                    | Counts header, timeline per lane, liveness, keyboard model, drill-down with diff and spec-check          |                         |
| Harness settings        | `specs/12-settings.md`                 | Autonomy, agents, models, hold time, editable in the pane as the person's change                         |                         |
| Combined lane view      | `specs/13-combined.md`                 | Each lane's card debt, rules and understanding, when Context Graph is installed                          |                         |
| Context Graph's harness | Context Graph `docs/specs/04-…` onward | Card writer, curator, read-assist, side questions, graph explorer, its panes and settings                |                         |

**Milestones:** M3 spikes (the riskiest assumptions); M4 code-kit's harness (05–12); M5 Context Graph's harness; M6 the combined lane view.

**Quality targets:**

- The panes and band reflect a change within 2 seconds; animation stays smooth with the cell graphics' in-place repaint.
- The mods' tool-call hooks add under 50 ms to a call they don't hold.
- Background agents never block the lead or lanes, and pause when the plan's 5-hour usage passes 80%.
- Every action has a key; colours come from theme keys, so light, dark and colour-blind themes read correctly.
- The panes work docked (110 columns or more) and inline (narrower), in the terminal, VS Code's terminal and Desktop.

## Riskiest assumptions

| #   | Assumption                                                                                             | Check                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| A   | A mod can tell the lead is idle and prompt it without breaking a turn in progress.                     | Spike: prompt on `turn.complete`, and while a turn runs.                               |
| B   | A mod can hold a call the hooks would refuse, record the approval, and let the same call through.      | Spike against code-kit's hooks; fallback: refuse, then re-run the call after approval. |
| C   | Background agents run alongside the lead without blocking it, and their usage is measurable per agent. | Spike: a cheap agent and its `turn.step` usage.                                        |
| D   | Each agent's last activity is visible, so stalls can be detected.                                      | Same spike: `tool.call` carries `agentId`.                                             |
| E   | Cell graphics and live regions look right in the person's VS Code terminal.                            | The probe pane.                                                                        |

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
| 2026-10-09 | Build plugin by plugin: spikes, code-kit's harness and panes, Context Graph's, then the combined view; spec both now. | The person's order. | The loop first across both. Panes first. |
| 2026-10-09 | A lane agent with no tool call for 5 minutes is messaged; at 10 it's restarted with the same brief, at most twice, then flagged. One waiting on a held call never counts as stalled. | Recovers without false alarms on long steps. | Flag only. 2 and 5 minutes. |
| 2026-10-09 | Background agents pause when the plan's 5-hour usage passes 80%, and resume below it; no daily caps. | Usage follows the plan, which is what limits the person. | Daily caps per agent. Both. |
| 2026-10-09 | The harness settings live in the project config (code-kit's `harness` section, Context Graph's `[harness]`), shared and protected. | The team shares one setup, reviewed like the rest. | Per machine. Both. |
| 2026-10-09 | The merge queue merges in the order branches passed review; one that no longer merges cleanly goes back to its lane. | The lane that wrote it resolves it. | The lead resolving conflicts in lane files. |
| 2026-10-09 | Drawing works in VS Code's integrated terminal (it runs the terminal surface); only the VS Code extension's chat panel, `-p`, the SDK and cloud sessions draw nothing. | Seen in use. | v1's assumption that VS Code draws nothing. |

## Open questions

| Question                                                                                    | Owner  | Blocks      |
| ------------------------------------------------------------------------------------------- | ------ | ----------- |
| What Raster and Client regions look like in the person's VS Code terminal (the probe pane). | Warren | Pane design |
