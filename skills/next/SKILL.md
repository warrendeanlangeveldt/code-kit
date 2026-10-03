---
name: next
description: The one command for code-kit. Reads where the project stands (a blank folder, a spec being shaped, a ready spec, existing code, a draft config, stories ready, finished or being built) and runs the right skill in the right order, carrying on until something needs the person. Use when the person runs /code-kit:next, asks "what now?" or "what's next?", wants to start a project with code-kit without knowing which skill to use, or comes back to a project mid-build.
---

# Next step

The argument, if given, is passed to the first skill that runs. From a blank folder, that's the idea itself: `/code-kit:next a booking app for mobile dog groomers`.

## 1. Read the state

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" next --json
```

It returns `step`, `why`, `args`, `then` (steps that can follow straight after) and `attention` (things the person should know). The order it applies:

| State                                                      | Step                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Invalid config                                             | `check`, then fix the config                              |
| No config, a draft waiting                                 | `init`, to show it for approval                           |
| No config, a spec still being shaped (brief not `ready`)   | `spec-design`, resuming                                   |
| No config, a ready spec                                    | `init <docs folder>`                                      |
| No config, existing code or docs                           | `init`                                                    |
| Nothing at all                                             | `spec-design`                                             |
| Config, but no specs, plan or stories                      | `spec-design`                                             |
| Stories finished on their branches                         | `review`, then `dispatch` what's ready                    |
| Stories ready                                              | `dispatch`                                                |
| Stories being built, nothing else can start                | wait                                                      |
| Ready stories with gaps in the plan, or a dependency cycle | `spec-design`, to fix the plan                            |
| Every story done                                           | done: `status`, then `spec-design` for the next milestone |

Tell the person in one or two lines what you found and what you're about to run, with anything under `attention`. If `attention` says the folder isn't a git repository, run `git init` before init (spec-design doesn't need one).

## 2. Run it

Run the named skill with the Skill tool: `code-kit:<step>`, with `args` (and the person's argument, if they gave one). Follow that skill in full. This skill only chooses; it never does a step's work itself.

- **`wait`:** say which stories are being built and on which branches, then stop. When a lane agent finishes, its notification arrives in this session; run this skill again then. If a story has been in progress with no agent running (the session ended, or the agent stopped without committing), dispatch it again.
- **`done`:** give the `status` summary in a few lines, then offer to run spec-design for the next milestone or feature.

## 3. Keep going until the person is needed

After a step finishes, run `next --json` again and carry on with the new step, without asking, as long as nothing needs the person. Stop and hand over when:

- a skill asks the person questions (spec-design's rounds, spec-check's blocking questions, review's scope questions);
- something needs the person's approval (init's draft, an approval for a protected path). If the config has `approvals.lead`, ask for it in chat: when they approve in their own message, record it with the `code-kit approve` command the refusal names (their words as the reason) and carry on;
- a person has to act: merge a pull request to a protected branch, add a CI secret;
- the step is `wait` or `done`;
- the same step comes back twice in a row with nothing changed. Report what's stuck instead of looping.

When you stop, end with one line saying what happens next and who does it, e.g. "Next: you approve the draft config, then I dispatch ST-1 to ST-4."
