# 17. Onboarding in the right order

**Status:** specified
**Outcome:** From an idea to the first line of code, everything the build relies on is in place first: each lane agent comes with the skills it works by, every screen is designed and approved before it's built, every sensitive change is reviewed by an adversary, and a companion tool the person has installed is set up before the coding loop starts.
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

The config records the version of init's setup (`"setup": 3`). A project set up before (no `setup`, or a lower one) gets a line under `next`'s attention naming what re-running init adds: project skills with each lane agent, designs approved before screens are built, a QA lane, a security reviewer, and companions set up before coding. Re-running init adds whichever are missing, shows the difference first, and sets `setup` to 3.

**Acceptance**

- Given a config without `setup`, then `next` says the setup predates what init now sets up, and to re-run `/code-kit:init`; given `"setup": 3`, it doesn't.
- Given `"setup": 9`, then the config is invalid, saying it must be from 1 to 3.

### ONB-6 The gaps stop new work until init fills them

For a setup older than init's, `code-kit next` works out what it's missing from the config, the plan and the code, and names it. A lane owns screens when its name or agent says so (web, mobile, desktop, admin) or it holds screen files (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.swift`, `.dart`, outside tests). When a lane owns screens, the setup may be missing three things: the design gate; design stories before the screen stories not yet started; and a QA lane. Work already started goes on, through review and the merge queue. No new story is dispatched, designed or built by the lead until init has added what's missing. Once nothing is in flight, `next` gives `update`, and the loop prompts the lead to re-run `/code-kit:init`, which shows the person the difference first.

**Acceptance**

- Given a config without `setup`, no design gate, no QA lane, and a ready web story with no design story before it, then `next` gives `update`, naming the design gate for mobile and web, the story planned with no design, and the QA lane, and says the ready stories wait until init has added them.
- Given the same and a story on its branch, then that story is reviewed, and nothing new is dispatched after it.
- Given `"setup": 3`, then `next` doesn't give `update`.

### ONB-7 An adversary reviews every sensitive change

Security is a reviewer, not a lane: it owns no paths and checks everyone's work. spec-design gives each area's spec a short threat model (what in it is sensitive, such as personal data, children's data, credentials or money; who might attack it; and where its trust boundaries are) and security requirements, numbered like any other requirement under `## Security requirements`, which stories cite. init writes a read-only `security-reviewer` agent beside the lane agents, in the same approval, whenever the product handles sign-in, personal data, payments, input from outside or secrets; it can be left out only for a product with none of them, such as a static site or a local tool with no accounts. The agent has no lane and no paths, and only reads: Read, Grep, Glob, and Bash for commands that change nothing (`git diff`, `git log`, the project's audit commands). It attacks the change as an adversary would, against the spec's threat model, and grades each finding blocker, concern (should fix) or nit (a note), with where, the attack and the fix; a finding without a concrete attack path isn't reported. `code-kit security` says whether a branch's changes need it, and why: sign-in, permissions, input from outside, personal data, encryption, payments, secrets, queries or commands built from strings, new dependencies, or a security requirement the story cites; tests and docs don't count. The review of such a story runs the security reviewer on the branch's diff with the story's specs and threat model, and a blocker fails the review like a failing test: the branch goes back to its lane with the finding. A setup older than 3 is missing the security reviewer until init adds it.

**Acceptance**

- Given a branch that adds a sign-in handler reading `req.body`, then `code-kit security` says it needs the security review, naming sign-in and input from outside with the file, and to run the security-reviewer agent.
- Given a branch that changes `package.json`, then it needs the security review for its dependencies.
- Given a story citing a requirement from its spec's `## Security requirements`, then its branch needs the security review, naming that requirement, even when the code alone wouldn't.
- Given a branch that changes only a stylesheet and a test, then `code-kit security` says it needs none.
- Given a branch that needs it and no `.claude/agents/security-reviewer.md`, then `code-kit security` says to re-run `/code-kit:init` to add the agent.
- Given a config older than 3 with no `.claude/agents/security-reviewer.md`, then `next` gives `update`, naming the security reviewer, even when no lane owns screens.

### ONB-8 code-kit's instructions keep up with code-kit

The parts of a project's instructions that are code-kit's own, the lead's section of CLAUDE.md and each lane agent's `Always:` rules, are rendered from code-kit's templates and the config, and kept between markers (`<!-- code-kit:begin vN -->` … `<!-- code-kit:end -->`). `code-kit instructions` says where each stands: current; stale (from an older code-kit, or a config that has changed since, such as what the lead may approve); written before the markers; or missing. `--write` rewrites the marked ones and adds missing ones, and never overwrites one written before the markers: an older init often tailored those by hand, so the lead merges each once, keeping the project's own lines outside the markers. `show lead` and `show lane` print the parts. While any is stale or unmerged, `next` gives `instructions` before any other step, and the loop prompts the lead to bring them up to date and merge the change; a newer code-kit's rules reach the agents only this way. Init writes code-kit's parts with the same command. Only the lead may run `--write`.

**Acceptance**

- Given CLAUDE.md and an agent file as an older init wrote them, then `instructions` calls them unmerged, `next` gives `instructions` with `merge`, and `--write` leaves them as they are.
- Given both merged from `show lead` and `show lane`, then both are current, and the lane rules say a new dependency needs the lead's approval.
- Given `approvals.lead` turned on, then the lead's section is stale, and `--write` brings it up to date, leaving the project's own lines around it.
- Given a lane running `code-kit instructions --write`, then it's refused.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
