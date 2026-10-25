# 12. Harness settings

**Status:** draft
**Outcome:** The person sets how the harness behaves (autonomy, which agents run, their models, the hold time) from the pane, and the team shares those settings through the config.
**Actors:** the person (edits); the lead and lanes (never edit)
**Depends on:** 05 to 08

## In scope

- A `harness` section in `.claude/code-kit.json`, validated like the rest of the config.
- A Settings view in the pane that edits it, written as the person's change and logged like any protected edit.

## Data

| Setting                     | Type    | Default      | Rules                                                                                                                    |
| --------------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `autonomy`                  | enum    | `autonomous` | `autonomous`, `propose`, `off` (05)                                                                                      |
| `hold.minutes`              | number  | 2            | 0 switches holding off (06); at most 10 (a held call waits in a process, which Claude Code runs for ten minutes at most) |
| `stall.nudgeMinutes`        | number  | 5            | (05)                                                                                                                     |
| `stall.restartMinutes`      | number  | 10           | Greater than `nudgeMinutes`                                                                                              |
| `stall.maxRestarts`         | integer | 2            |                                                                                                                          |
| `agents.reviewer`           | object  | off          | `{ on, model }`; model an alias (`haiku`, `sonnet`, `opus`) or an id; without one, the session's model                   |
| `agents.lanes.model`        | string  | none         | The lane agents' model, an alias or an id, or `story` for each story's size (23, SCHED-3); without one, the session's    |
| `background.pauseAtPercent` | number  | 80           | Of the plan's 5-hour use (08)                                                                                            |
| `report.on`                 | boolean | `false`      | Agents may draft bug reports for code-kit, which the person sends or discards (15, REPORT-1)                             |

Context Graph's agents have their own `[harness]` section in `.ctx/config.toml`, specified there.

## Requirements

### SET-1 Validated

`code-kit check` validates the `harness` section; an unknown key or a bad value is reported like any config problem, and the harness falls back to the defaults.

### SET-2 Edited in the pane

The Settings view lists each setting with its value and a control (select, number, toggle). A change opens a confirmation naming the setting and its new value, with a reason; on confirm, the config file is written and the change is recorded in the approval log as the person's (approval `kit`, "(changed in the code-kit pane)").

- **Who:** only on the person's press; the hooks refuse an agent's write to the config as today.

**Acceptance**

- Given autonomy `autonomous`, when the person sets `propose` and confirms, then `.claude/code-kit.json` has `"autonomy": "propose"`, the approval log records it, and the loop switches within 2 seconds.

### SET-3 Structure stays with init

Lanes, paths, layers and which paths are protected aren't editable in the pane; the Settings view links to `/code-kit:init` for them. Who decides each approval is a setting (spec 23, WHO-3): the view's Approvals section.

### SET-4 The lane agents' model

With `agents.lanes.model` set, the mod sets that model on each lane agent as it starts (`agent.spawn`), so a cheaper model builds the stories while the lead, the reviewer and the security reviewer keep the session's. A model the lead's call names wins, and so does a model a lane's agent file sets (other than `inherit`). Set to `story`, each lane agent's model follows its story's size instead (spec 23, SCHED-3). `/code-kit:init` asks for it, recommending `story`; `/harness` changes it like any setting.

**Acceptance**

- Given `agents.lanes.model` `sonnet`, when the lead dispatches `core-engineer`, then it starts on Sonnet; when the call names `haiku`, on Haiku; `web-engineer`, whose file sets `model: opus`, on Opus; a reviewer or any agent that isn't a lane's, as Claude Code decides.
- Given no lane model set, lane agents start as Claude Code decides.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
