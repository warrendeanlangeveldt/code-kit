# 17. Onboarding in the right order

**Status:** specified
**Outcome:** From an idea to the first line of code, everything the build relies on is in place first: each lane agent comes with the skills it works by, every screen is designed and approved before it's built, and a companion tool the person has installed is set up before the coding loop starts.
**Actors:** the person; the lead (spec-design, init, design, next and the loop); lane agents
**Depends on:** 05-lead-loop, 13-combined

Found by running code-kit from a fresh idea: init wrote the lane agents but only wrote their skills when asked; a web and a mobile lane were set up, but nothing was designed before their code was written; and Context Graph was installed, but the loop started building before its init could run.

## Requirements

### ONB-1 Skills come with the agents

spec-design writes, in the architecture, a recipe for each layer's common addition (a screen, an endpoint, a migration, a domain service): the steps, in order, with the files they touch. init drafts a project skill for each recipe alongside the lane agents, lists each on every lane agent whose paths it touches, and shows them in the same approval; once approved, it writes them with the agents. For brownfield code without recipes in its docs, init proposes recipes from the patterns the code already follows. `code-kit next` says when a lane agent names a skill that doesn't exist.

**Acceptance**

- Given a lane agent listing `new-screen` under **Skills to use** and no `.claude/skills/new-screen/SKILL.md`, then `next` says under attention that web-engineer names a skill that doesn't exist: new-screen.

### ONB-2 Design before code

When the product has a presentation layer (web, mobile, desktop), spec-design lists each area's screens in its spec and plans a design story for each area, `**Lane:** design`, with every story that builds those screens depending on it. init switches on the design gate for every lane that owns screens: a register of approved designs (`design/register.json`, protected by the `design` approval, which stays the person's), the screen files' globs, and how to get a design approved. `code-kit next` gives `design` for a ready design story, before dispatching anything else; the loop prompts the lead with it; `/code-kit:design <story>` designs the story's screens in the project's design tool, from the spec's own content, shows them to the person, and once they approve, adds each screen to the register. Until then, a lane writing that screen is refused, saying how to get its design approved.

**Acceptance**

- Given a ready design story ST-2 (`**Lane:** design`) and a ready web story ST-3 depending on it, then `next` gives `design` with ST-2, and ST-3 isn't dispatchable until ST-2 is done.
- Given ready design and API stories, then `next` gives `design` with ST-2, then dispatching the API story.
- Given `**Lane:** design`, then the plan has no gap for an unknown lane.

### ONB-3 Companions set up before the loop

When init finds a companion tool installed but not set up in the project (Context Graph, whose `/context-graph:init` is available), it records it in the draft config (`"adapters": { "context-graph": true }`) and, once the person approves, runs that tool's setup before reporting. `code-kit next` gives `setup` with the companion's setup skill whenever the config wants a companion that isn't set up yet, before any review, dispatch, design or lead step; the loop prompts the lead to run it. The core never names the tool: each adapter says what its setup is.

**Acceptance**

- Given `"adapters": { "context-graph": true }`, a plan with ready stories and no `.ctx/`, then `next` gives `setup` with `context-graph:init` and says why; once `.ctx/` exists, it gives `dispatch`.
- Given the loop running and `next` giving `setup`, then the lead is prompted to run `/context-graph:init`.

### ONB-4 A QA lane proves the journeys

Each lane writes and runs the unit tests for its own code. When the product has screens, or journeys that cross lanes, spec-design adds a `qa` lane with a `test-engineer` agent that owns the end-to-end suites (Playwright for web, Maestro or Detox for mobile), and plans a test story per main journey, depending on the screen and service stories it goes through. init sets the lane up even when the docs forgot it, with a check that runs the suites when they change. The review of a story runs the end-to-end suites covering its requirements, and a broken journey fails it.

### ONB-5 An older setup is told what it's missing

The config records the version of init's setup (`"setup": 2`). A project set up before (no `setup`, or a lower one) gets a line under `next`'s attention naming what re-running init adds: project skills with each lane agent, designs approved before screens are built, a QA lane, and companions set up before coding. Re-running init adds whichever are missing, shows the difference first, and sets `setup` to 2.

**Acceptance**

- Given a config without `setup`, then `next` says the setup predates what init now sets up, and to re-run `/code-kit:init`; given `"setup": 2`, it doesn't.
- Given `"setup": 9`, then the config is invalid, saying it must be from 1 to 2.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
