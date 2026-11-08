# 30. Existing code brought to the standards

**Status:** draft
**Outcome:** An existing codebase moves to the standards and engineering principles the person chose, not only the ones it already follows: every breach recorded as evidence, new code held to the standard at once, and the old code refactored along a pathway the person places in the plan.
**Actors:** the person (adopts each standard, places the conformance milestones); the lead (suggests the standards, runs the audit, plans the pathway, reviews); read-only audit agents; lane agents (fix the breaches); verify
**Depends on:** 22-standards, 18-regression, 17-onboarding

A brownfield project gets a baseline of the layer violations its code already has, and standards inferred from what the code already does (STD-2). Nothing helps it move to the standards it should follow. A pattern only some of the code follows is either written down as the rule, and broken in the files that don't, or left out. The person who wants the code refactored to the standards has to work out what breaks them, plan it and hold new work to it themselves.

## Decisions

| Date       | Decision                                                                              | Why                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 2026-11-08 | Refactor stories go in a conformance milestone of their own, per standard             | The person decides when the refactoring runs against feature work; feature milestones stay features          |
| 2026-11-08 | A story that changes a file with a recorded breach fixes it before it merges          | The code converges as it's worked on, and no change makes a breached file harder to fix later                |
| 2026-11-08 | Breaches are recorded in the baseline, beside the layer violations, and only shrink   | One record of what existing code is excused, with the rule it already had: only the adopting change grows it |
| 2026-11-08 | Refactor stories cite their standard in `**Conforms:**`, not `**Requirements:**`      | A standard isn't a spec's requirement; trace keeps its rules for requirements                                |
| 2026-11-08 | Structure is measured, not guessed: size, import cycles, dead code, environment reads | Evidence the person can check; the audit agents judge what a measure can't (responsibilities, duplication)   |
| 2026-11-08 | A target architecture is a config change, adopted on its branch like a standard       | The layer rules hold new code at once, and their violations are recorded and planned like breaches           |

## In scope

- Suggesting standards the code doesn't follow yet, with how much of it breaks each.
- Auditing the code against each standard adopted, and recording each breach with its evidence.
- Drafting the refactor pathway: the conformance milestones and their stories, in order.
- Holding every branch to the breaches in the files it changes, and each refactor story to its files.
- Showing where the code stands against each standard.
- Measuring the code's structure for the structural standards (single responsibility, no import cycles, no dead code, services behind providers).
- Proposing a target architecture (layers, their rules and lanes), and planning the layer rules' violations, splits and moves.

## Out of scope

- Fixing breaches automatically: lanes refactor, as with any story.
- New hooks for standards code-kit can't check mechanically: an audit and the review judge those (STD-4).

## Data

The baseline, `.claude/code-kit.baseline.json`, gains `standards`: `{ "<standard id>": { "<file>": ["<breach>", …] } }`. A breach is one line of evidence: where in the file, and what breaks the standard ("line 42: the handler queries the database itself").

A refactor story in the plan:

| Field               | Rules                                                          |
| ------------------- | -------------------------------------------------------------- |
| `**Requirements:**` | `none`                                                         |
| `**Conforms:**`     | The standards it brings its files to                           |
| `**Files:**`        | The files it brings to them; none means every file of its lane |
| `**Depends on:**`   | As any story: the pathway sets it                              |

## Requirements

### CONF-1 Standards to move to

`/code-kit:conform` suggests the standards the code already follows (STD-2) and those it should move to: what the project's architecture, decisions and principles ask for that the code doesn't do, and what its stack and size call for that nothing covers. Each comes with how much of the code breaks it, and a pattern the code follows both ways is put to the person as a choice with both counts. The person approves, edits or drops each before anything is written (STD-5).

**Acceptance**

- Given a project with no standards whose architecture says data access goes through repositories, and 12 of 40 modules query the database directly, then conform suggests that standard with "12 of 40 modules break it", and writes nothing until the person approves it.

### CONF-2 Breaches recorded on the branch that adopts the standard

`code-kit conform record <standard> <file> --breach "…"` records a breach of a checked or advice standard the project has; an enforced standard's rule finds its own (the layers' baseline). The lead records what the audit found: read-only agents read the code layer by layer and report each breach with its file and line, and the lead checks a sample. Breaches may be added only on the branch that adopts the standard: one the standards file gains, or tightens (recommended to required, advice to checked), which needs the person's standards approval. verify refuses a branch that records a breach of any other standard, and the commit guard refuses an agent outside the lead committing a baseline that grows.

**Acceptance**

- Given a branch adding PAT-1, when the lead records three breaches of it, then verify accepts the baseline.
- Given PAT-1 already adopted, when a lane records a breach of it, then the commit is refused, and verify says breaches only shrink.
- Given a breach of a standard the project lacks, or of an enforced one, then nothing is recorded and the refusal says why.

### CONF-3 Where the code stands

`code-kit conform` shows each standard with recorded breaches: how many, in how many files, its refactor stories and their states, and the breached files no open story covers. `--json` gives the same. It reports breaches of a standard the file doesn't have, of a file that's gone, and a story conforming to an unknown standard. `code-kit next` says when a project with code has no standards, and when a standard has breaches no story covers.

**Acceptance**

- Given PAT-1 with 3 breaches in 3 files and no refactor story, then conform says so, names them as not planned, and next suggests `code-kit conform plan PAT-1`.
- Given a refactor story naming one of them, then that file is no longer reported as unplanned.

### CONF-4 Refactor stories bring their files to the standard

A refactor story names its standards in `**Conforms:**` and its files in `**Files:**`. Its lane runs `code-kit conform --story <id>` for what to fix, fixes each breach without changing what the code does, and takes it out with `code-kit conform fixed <standard> <file>`. verify refuses the story's branch while any of its files' breaches is still recorded. Behaviour unchanged means the tests that cover the files pass before and after; where none do, the story writes them first, and no test is weakened (REG-2).

**Acceptance**

- Given ST-2 conforming `packages/domain/rules.ts` to PAT-1, when its branch leaves that breach recorded, then verify refuses it, naming the file and the breach.

### CONF-5 A story fixes what it touches

A branch that changes a file the base's baseline records breaking a standard fixes it on that branch, except a split or a move, which is its own story's (CONF-9): verify refuses it while the breach is still recorded, saying how to take it out. `code-kit conform --for <file>` lists a file's breaches, and the lane agents' instructions say to run it before changing a file. A baseline change that only takes entries out excuses nothing new, so any agent may commit it, and verify doesn't count it against the lane's paths. In review, the lead checks each breach taken out is really fixed.

**Acceptance**

- Given `apps/office/src/orders.ts` recorded as breaking PAT-1, when a web lane's branch changes it and leaves the breach, then verify refuses the branch; once the lane fixes it and runs `conform fixed`, its commit passes and verify accepts the branch.

### CONF-6 The refactor pathway

`code-kit conform plan [<standard>…]` drafts the pathway for the plan: a conformance milestone per standard (`## Conformance: PAT-1 …`), required standards first, then by category, structure before detail: architecture, patterns, policies, conventions, principles. Within a milestone, stories go through the layers in dependency order, a layer before every layer that may import it, then by lane and folder, at most five files each, sized by their breaches. Each story depends on the same standard's stories in the layers its layer imports, and a milestone's first story on the last story of the milestone before. Files already in an open refactor story aren't drafted again. The person decides where the milestones go among the others.

**Acceptance**

- Given PAT-1 breaches in the domain layer and in the services layer that imports it, then the domain's story comes first, and the services' story depends on it.
- Given a required CON-2 and a recommended PAT-1, then CON-2's milestone comes first, and PAT-1's first story depends on CON-2's last.

### CONF-7 The structure measured

`code-kit conform measure [--json] [--lines N]` measures the tracked source, tests left out: files over N lines (500 by default), import cycles among the JavaScript and TypeScript files, those files nothing imports (entry points such as pages, routes, scripts and configuration left out), and files that read the environment outside the configuration's own files. The skill suggests the structural standards from it: one responsibility per module, service providers, no import cycles, no dead code, beside one place for each rule and modules by feature, which the audit judges. `code-kit conform record <standard> --measured <large|cycles|unused|env>` records one kind as the standard's breaches, on the branch that adopts it (CONF-2).

**Acceptance**

- Given two files that import each other and a file of 600 lines, then measure reports the cycle with both files and the large file with its line count; `--measured cycles` records a breach for each file of the cycle.

### CONF-8 The target architecture

The skill proposes the layers the code should have, what each may import, and the lanes that own them, as a config draft the person approves (ONB). On the branch that adopts a layer (new, or with a changed rule), `code-kit baseline --write` records the violations from or into it, and verify accepts them; anywhere else the layers' baseline only shrinks. The layer rules' recorded violations are planned like a standard's breaches: `code-kit conform plan layers` (and `conform plan` with none named) drafts a conformance milestone for them, first in the pathway, its stories conforming to `layers`; verify refuses such a story's branch while a violation in its files is still recorded.

**Acceptance**

- Given a branch adding a domain layer that the interface layer may not import, and an interface file importing it, then `baseline --write` records the violation and verify accepts the branch; on a later branch, a new violation is refused.
- Given that violation recorded, then `conform plan` drafts a layer rules story for the file, before any standard's.

### CONF-9 Splits and moves

`conform record … --split "<path>, <path>"` records a breach fixed by splitting the file into those files, and `--move <path>` one fixed by moving it there. Each is a refactor story of its own, its new files in its `**Files:**`, the plan's text saying what to split or move and to point what imports it at the new paths. `conform fixed` takes a split's breach out only once its files exist, and a move's once the file is at its new path and gone from the old one.

**Acceptance**

- Given a breach to be fixed by moving `a.ts` to `b.ts`, then its story names both files, and `conform fixed` is refused while `a.ts` is there or `b.ts` isn't.

## Quality targets

- `code-kit conform` answers in under a second on a project with 10,000 recorded breaches.

## Open questions

| Question                                                                | Owner  | Blocks |
| ----------------------------------------------------------------------- | ------ | ------ |
| Should the pane show each standard's conformance beside the milestones? | Warren | none   |
