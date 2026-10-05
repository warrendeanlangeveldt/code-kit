# code-kit in the session (a mod)

**Status:** ready
**Updated:** 2026-10-06

## Problem

code-kit enforces a project's rules through shell hooks, and what it knows only reaches the person as text: refusals in the transcript, and `status` or `next` output when someone thinks to run them. While a lead runs several lanes, the person can't see at a glance which lane is building what, what's waiting for them, or why something was refused. Approving takes a typed `! echo … > .claude/approvals/…` command, or, where `!` isn't available, the lead recording the person's words from chat.

## Users

| Actor          | Trying to get done                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The person     | See the lanes and what needs them, and approve, review and merge in a press instead of a typed command                               |
| The lead       | Keep working while the person approves; get a clear answer when something is refused                                                 |
| Lane agents    | Unchanged: the hooks enforce their rules as before                                                                                   |
| Other surfaces | VS Code, `claude -p`, Agent SDK and cloud sessions run the hooks but draw nothing; they keep today's text refusals and `!` approvals |

## Outcome

In the Claude Code terminal or Desktop app, a person running a code-kit project:

- sees a one-line band above the prompt whenever something waits for them, and nothing otherwise;
- opens a Lanes pane (`/lanes`, or from the band) showing every lane, its agent, story, branch and state, and what's ready next;
- approves a request, reviews a branch, or merges a verified one, with a press and a confirmation;
- reads a code-kit refusal as a clear card: what was refused, the rule, why, and what to do.

How anyone will know: a full approval that used to take a typed command takes a press and an Enter, and the approval log records it as given in the pane.

## Constraints

- A Claude Code mod in the code-kit plugin itself, beside the existing settings hooks. Claude Code older than 2.1.287 doesn't load it and runs the hooks as before (checked on 2.1.280).
- No dependencies and no build step, like the rest of code-kit. The mod may import only files inside the plugin and `claude-code`, and reaches files and processes through the mods API, so it gets its facts from the `code-kit` command line.
- Mods aren't sandboxed: the mod runs with the person's permissions, as the hooks already do.

## Non-goals

- Enforcement in the mod: rules stay in the hooks, so CI, SDK sessions and other tools keep them.
- Model calls to display anything: the pane and band never spend usage.
- Editing the config from the pane: lanes, layers and rules change through init and `.claude/code-kit.json`.
- Drawing in VS Code, `claude -p`, SDK or cloud sessions, which Claude Code doesn't support.

## Scope

| Area                    | Spec                               | First release                                                                             | Later              |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| Lanes pane              | `specs/01-lanes-pane.md`           | Lanes, agents, stories, branches, states, ready next; opened by `/lanes` or the band      | Story detail views |
| Waiting band            | `specs/02-waiting-band.md`         | Requests to approve, branches to review, failing finish checks; shown only when non-empty |                    |
| Approve, review, merge  | `specs/03-approve-review-merge.md` | Confirmed approvals with an editable reason; Review asks the lead; Merge after verify     |                    |
| Refusal cards, commands | `specs/04-cards-and-commands.md`   | Refusals drawn as cards; `/lanes`, `/approvals`, `/verify`                                |                    |

**Quality targets:** the band and pane refresh within 2 seconds of a change; nothing in them makes a model call; keyboard-usable, with hotkeys on buttons; readable in light and dark terminals.

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

## Open questions

| Question                                                           | Owner  | Blocks      |
| ------------------------------------------------------------------ | ------ | ----------- |
| Update Claude Code on this Mac to 2.1.287 or later (it's 2.1.280). | Warren | Milestone 2 |
