---
name: spec-design
description: Turn an idea into a buildable specification by working it through with the person. Frames the problem, explores options, asks the questions that decide scope and behaviour, and writes the brief, specs, architecture, principles and plan that code-kit init and spec-check work from. Use when someone starts a new product or feature with an idea rather than a spec, wants to ideate or shape requirements, or runs /code-kit:spec-design [idea or docs path]. Also use to resume or extend specs it wrote earlier.
---

# Spec design

The argument is either the idea itself, in a sentence or a paragraph, or the path to the docs folder to write to (default `docs/`). If `.claude/code-kit.json` exists, use its `docs.specs`, `docs.principles` and `docs.plan` paths instead of the defaults.

The job is to think the idea through **with** the person, not for them. You propose, question and push back; they decide. Every decision ends up in a document, so the build never depends on a conversation nobody can read later.

The output is what the rest of code-kit runs on:

| File                      | Holds                                                                                                                            | Used by                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `docs/brief.md`           | Problem, users, outcomes, scope, non-goals, the decision log and the open questions (`${CLAUDE_PLUGIN_ROOT}/templates/brief.md`) | Everyone; where a resumed session starts  |
| `docs/specs/NN-<area>.md` | One capability area each, with numbered requirements (`${CLAUDE_PLUGIN_ROOT}/templates/spec.md`)                                 | `spec-check`, lane agents                 |
| `docs/architecture.md`    | Components, layers and which way they depend, contracts, integrations, quality targets                                           | `init` (layers, lanes, protected paths)   |
| `docs/principles.md`      | Engineering rules, what counts as a contract, the definition of done, commands                                                   | `init` (checks, shell rules), lane agents |
| `docs/plan.md`            | Milestones, stories that cite requirement IDs, the work split into lanes, sequencing                                             | `init` (lanes), the lead delegating work  |

## Which situation

- **A new idea, no docs** → all phases, from 1.
- **Docs this skill wrote earlier** (`docs/brief.md` exists) → **Resume**: read every file in full, then start from the brief's open questions and the phase its `Status` line names. Say where you're picking up.
- **An existing codebase, a new feature** → phases 1–4 and 6 for the feature, and phase 5 only where the feature changes the architecture. Read the code first (entry points, the modules the feature touches, existing docs and the code-kit config). Existing layers, contracts and conventions are constraints, not suggestions. Write the feature's spec next to the others and add its stories to the existing plan.

Say which one applies before you start.

## How to ask

The questions are the skill. Ask well:

- **Only what the person can answer.** Look up anything the repository, the docs or a quick search can tell you, and state what you found instead of asking.
- **Few at a time.** Up to four questions per round, most decisive first: a question whose answer changes the shape of everything else comes before any detail. Use the AskUserQuestion tool for choices, with 2–4 concrete options, your recommendation first and marked, and a line on what each option costs. Ask open questions in plain text.
- **Say why it matters.** One clause per question on what the answer changes: scope, a data model, a permission, a dependency, the cost.
- **Offer a default.** When you have a sensible default, state it, so "yes" is a complete answer.
- **Push back.** Name contradictions, scope creep, risky assumptions, and requirements that can't be tested. Suggest the smaller version that still delivers the outcome.
- **Never fill a gap by guessing.** An unanswered question goes into the brief's open questions with its owner and what it blocks. It doesn't quietly become a requirement.

After each round, summarise what was decided in a few lines, append it to the decision log, and move on.

## 1. Frame

Get the problem straight before any solution:

- **Problem:** what's wrong or missing today, for whom, and how they cope now.
- **Users:** each kind of user or actor, including admins, other systems and scheduled jobs, and what each is trying to get done.
- **Outcome:** what's different when this works, and how anyone will know. Prefer something observable ("a new customer books without calling us") over a feature list.
- **Why now, and constraints:** deadline, budget, team, required platforms and technology, regulation and data residency, existing systems it must fit.
- **Non-goals:** what this deliberately won't do. Ask for them; they are as useful as the goals.

Write `docs/brief.md` as soon as the frame is agreed, with `Status: framed`, and keep it current from then on.

## 2. Explore

Before narrowing, widen:

- Sketch **two or three different shapes** of solution: different scopes, workflows or build-versus-buy choices, not the same idea three times. For each: how it works in a paragraph, what it's good at, what it costs, the biggest risk.
- Walk through the **main journey** of each kind of user, step by step, for the shape you recommend. Journeys expose missing capabilities faster than feature lists.
- List the **riskiest assumptions**: things that, if wrong, sink the idea. Say how each could be checked cheaply.
- **Recommend** one shape and say why. The person chooses.

Record the choice and the rejected options, with why, in the decision log. `Status: explored`.

## 3. Shape the scope

- Break the chosen shape into **capability areas**, for example accounts, booking, payments, notifications, admin. Each becomes one spec file.
- For each area, agree what's in the **first release** and what's later. The first release must be a complete, working slice end to end, with nothing mocked or stubbed and no placeholder screens. If it's too big, cut capability, not quality.
- Agree **quality targets** that change the build: expected scale, response times, availability, security and privacy, accessibility, supported devices and languages.

Write the scope into the brief. `Status: scoped`.

## 4. Specify

Write one spec per capability area from `${CLAUDE_PLUGIN_ROOT}/templates/spec.md`. Work through the areas one at a time, with a round of questions per area.

Each requirement gets an ID (`<AREA>-<n>`, for example `BOOK-4`) and its own heading, `### BOOK-4 Short name`, which is how `code-kit status` finds it. `ST` is reserved for stories. Every requirement must be testable: someone reading it can say whether the code does it. For every area, work through:

- **Behaviour:** what each actor can do, step by step, including what the system does in response.
- **Data:** the entities, their fields, types, which are required, uniqueness, and who owns the data.
- **States:** the lifecycle of anything that changes state, with the allowed transitions and what triggers each.
- **Rules:** validation, calculations, limits and business rules, with real values rather than "reasonable".
- **Permissions:** who can see and do what, including other users' data.
- **Errors and edge cases:** invalid input, duplicates, concurrency, partial failure, timeouts, an external service being down, empty and very large data.
- **Events and integrations:** what other parts of the system or external services are told, and what they send back.
- **Acceptance criteria:** Given / When / Then for the main path and for each important error.

A spec answers what and why, not how: no framework, file or function names unless the person requires them. Anything still undecided goes in the spec's open questions and the brief's, never into a requirement. `Status: specified`.

## 5. Architecture, principles and plan

These are what `/code-kit:init` turns into enforced rules, so be concrete.

- **`docs/architecture.md`:**
  - the components (apps, services, packages, jobs) and what each is for;
  - the **layers**, the folders each will live in, and which layers each may depend on (for example `ui → application → domain`, with adapters implementing the domain's ports);
  - what each layer must not use, for example no database client in the domain;
  - the **contracts** (API schemas, events, database schema) and who may change them;
  - external services and how each is isolated;
  - how the quality targets from phase 3 are met.
    Propose the architecture from the specs and constraints, explain the choices, and ask about the ones that matter. Record each in the decision log.
- **`docs/principles.md`:** the engineering rules; what counts as a contract; the definition of done (tests, checks, reviews, end-to-end working features); the test, lint, typecheck and database commands once they're known; and which commands only CI or a person may run, such as deploys.
- **`docs/plan.md`**, from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
  - the **work split**: lanes (for example web, api, data), the paths each will own, the agent name for it and the command that proves its work, so work can run in parallel without overlap;
  - milestones, each a usable increment;
  - stories, each small enough for one lane to finish on one branch. Each story is a `### ST-<n> Title` heading with `**Lane:**`, `**Requirements:**` (the IDs it delivers, or `none` for a spike or a foundation that delivers none), `**Depends on:**` and `**Status:** todo` lines. `code-kit status` and the dispatch skill read them. A story that needs two lanes is two stories, with a dependency between them;
  - sequencing: contracts and shared foundations first, as the lead's own stories (`**Lane:** lead`, built by the lead rather than dispatched), then work that can run in parallel.

`Status: planned`.

## 6. Check it's buildable

Before handing over, review everything once, as a sceptical engineer about to build it:

- every journey step maps to a requirement, and every requirement to a story;
- every requirement is testable and has acceptance criteria where it matters;
- data, states, permissions and errors are covered for every area;
- no requirement contradicts another, the constraints or a non-goal;
- nothing is left as "TBD" outside the open-questions lists.

Fix what you can. Put the rest to the person as a last round of questions. Then give them:

1. what was written, file by file, in one line each;
2. the open questions that still block building, with who owns each;
3. the next steps:
   - `/code-kit:init docs/` turns the architecture, principles and plan into enforced lanes and layers. If the project already runs code-kit, `/code-kit:init` updates it.
   - `/code-kit:dispatch next` starts the ready stories on their lanes. Each lane spec-checks its story against these specs before writing code.
   - `/code-kit:review` checks each finished branch against its requirements before it merges.
   - `/code-kit:status` shows where the build stands against the spec.
   - Or just `/code-kit:next`, which picks each of these in turn.

`Status: ready` once no open question blocks the first milestone.

## Keep it current

A spec is the source of truth while it's being built. When a decision changes, re-run this skill: update the spec, the brief's decision log and the plan together, and keep requirement IDs stable (mark a dropped requirement `Removed` rather than reusing its number). If the project enforces code-kit and the specs are protected paths, the change goes through the approval log like any other.
