# 01. Lanes pane

**Status:** draft
**Outcome:** The person sees, in one pane, every lane, who's building what, on which branch, and what's ready next.
**Actors:** the person
**Depends on:** code-kit's `status` and `next`

## In scope

- A pane titled "Lanes", opened by `/lanes` or the band's Lanes button, closed with Escape.
- One row per lane, the lead's own stories, and the stories that are ready.

## Data

| Entity   | Field   | Type   | Rules                                                                            |
| -------- | ------- | ------ | -------------------------------------------------------------------------------- |
| Lane row | lane    | string | From the config's lanes, plus `lead`                                             |
| Lane row | agent   | string | The lane's agent name                                                            |
| Lane row | story   | string | The story in progress or in review for that lane, with its title; none when idle |
| Lane row | branch  | string | `<lane>/st-<n>` for that story                                                   |
| Lane row | state   | enum   | `idle`, `building`, `in review`, `blocked`                                       |
| Lane row | active  | bool   | A subagent of that lane's type is running in this session now                    |
| Ready    | stories | list   | Stories `code-kit next` would dispatch or hand to the lead, with their lane      |

## Requirements

### PANE-1 Open and close

`/lanes` opens the Lanes pane, focused. The band's Lanes button does the same. Escape or `/lanes` again closes it.

**Acceptance**

- Given a code-kit project, when the person types `/lanes`, then a pane titled "Lanes" opens within 1 second.
- Given the pane is open, when the person presses Escape, then it closes.
- Given a folder without `.claude/code-kit.json`, when the person types `/lanes`, then it says "This project doesn't use code-kit." and opens nothing.

### PANE-2 A row per lane

The pane shows one row per lane in the config, plus `lead`, each with its agent, the story it's on and its title, the branch, and the state:

- `building`: the story has a branch and isn't done, and, once the branch has commits, the lane's agent is still at work in this session;
- `in review`: `status` puts it in review (commits beyond its base) and the lane's agent is no longer at work. `status` alone can't tell a finished branch from one still being built, so the agent decides;
- `blocked`: its next story waits on another;
- `idle`: none of these.

A lane whose agent is running in this session right now is marked active.

**Acceptance**

- Given lanes web and api, with web's story ST-4 in progress on `web/st-4`, when the pane opens, then the web row shows `web-engineer`, ST-4 with its title, `web/st-4` and `building`, and the api row shows `idle`.
- Given the web lane's agent is running, when the pane draws, then the web row is marked active; when the agent finishes, the mark goes within 2 seconds.

### PANE-3 What's ready

Below the lanes, the pane lists the stories that are ready, as `code-kit next` reports them, each with its lane. Lead stories are labelled as the lead's own.

**Acceptance**

- Given `next` reports ST-6 and ST-7 ready for the lead and ST-9 for core, when the pane opens, then it lists all three with their lanes, and ST-6 and ST-7 as the lead's.

### PANE-4 Stays current

The pane refreshes within 2 seconds of a commit, a branch change, a subagent starting or finishing, or a plan change, and otherwise no more than once every 10 seconds. It never makes a model call.

**Acceptance**

- Given the pane is open, when a lane commits on its branch, then that lane's state updates within 2 seconds.

### PANE-5 Plans and configs it can't read

When the plan has gaps or the config is invalid, the pane says so in one line, with the command that shows more (`code-kit status` or `code-kit check`), and shows what it can.

**Acceptance**

- Given an invalid config, when the pane opens, then it shows "The config is invalid: run code-kit check." and no lane rows.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
