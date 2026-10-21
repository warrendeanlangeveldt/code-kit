# 22. Project standards

**Status:** draft
**Outcome:** Every agent on a project builds to the same engineering standards, which the person chose at the start from what the specs or the code already say, and code-kit applies each standard as firmly as it can: refusing what it can check, reviewing what it can't, and telling agents the rest.
**Actors:** the person (approves the standards); the lead (suggests them, reviews against them); lane agents (receive them); a team provider (may supply an organisation's standards to inherit)
**Depends on:** 17-onboarding (the instructions code-kit keeps current), 19-lead-at-the-helm, 07-reviewer

Today a project's engineering rules live in `docs/principles.md` as prose, and every lane agent is told to follow the whole file. The rules aren't named, so nothing can say which one a change broke; they aren't graded, so "prefer composition" and "never log a card number" weigh the same; and nothing says which ones code-kit can actually enforce. This spec gives a project a short list of named standards, each with how it's applied, suggested by the lead and approved by the person at init.

## Decisions

| Date       | Decision                                                                                                                                                                        | Why                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 2026-10-21 | The engineering rules in `docs/principles.md` move into standards at the next init; principles keeps the definition of done, the commands and the privacy and residency targets | One place for rules agents are held to, each named and graded |

## In scope

- `docs/standards.md`: the project's standards, one per heading, in five categories.
- Suggesting them at init: from the specs, architecture and threat model for a new project, or from the code for an existing one.
- Applying each one: enforced by code-kit's hooks, checked by the reviewer, or given to agents as advice.
- Each agent receiving only the standards for its own layer, one line each.
- A seam for standards inherited from an organisation, through the team provider.

## Out of scope

- An organisation's standards repository, its library, seeding and waivers: code-kit hub (hub spec 03).
- Writing new hooks for standards code-kit can't already check: a standard is `enforced` only where an existing rule (layers, protected paths, the project's checks) enforces it.

## Data

| Field       | Rules                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| id          | Category prefix and a number: `PRI-` principles, `PAT-` patterns, `ARC-` architecture, `CON-` conventions, `POL-` policies |
| title       | One sentence an agent can act on: "Data access goes through repositories"                                                  |
| level       | `required` or `recommended`                                                                                                |
| applied     | `enforced` (code-kit refuses), `checked` (the reviewer looks for it), `advice` (agents are told)                           |
| layers      | The layers it applies to, or all                                                                                           |
| why         | One or two sentences                                                                                                       |
| source      | Where it came from: a spec, a decision, the threat model, or the code (with its evidence: "41 of 43 modules")              |
| enforced by | For `enforced`: the rule that does it (a layer rule, a protected path, a check command)                                    |

The five categories:

- **Principles:** judgement, such as single responsibility or YAGNI. Only review can catch these; never `enforced`.
- **Patterns:** how a kind of problem is solved here, such as repositories for data access, or CQRS for bookings.
- **Architecture:** what may depend on what, and where things live.
- **Conventions:** naming, layout, formatting, tests' shape.
- **Policies:** what must or must never happen, such as secrets from the environment, or no personal data in logs.

## Requirements

### STD-1 The standards file

`docs/standards.md` (or `docs.standards` in the config) holds the project's standards as `### <id> <title>` headings, each followed by its fields. `code-kit standards [--json]` reads it and reports problems: a duplicate id, an unknown category, a `principles` standard marked `enforced`, or an `enforced` standard whose `enforced by` names no rule the config has.

**Acceptance**

- Given `### PRI-2 One reason to change` with `applied: enforced`, then `code-kit standards` reports that a principle can't be enforced, only checked or advised.
- Given `### ARC-2 Domain code doesn't import infrastructure` with `enforced by: layers (domain may not import infrastructure)` and that layer rule in the config, then it reports nothing.

### STD-2 Suggested at init, approved by the person

`/code-kit:init` gains a standards step after the layers. With specs, the lead suggests standards from the architecture, the principles, the threat model and the decision log, each citing its source. With no specs but code, the lead infers them from the code: layering and import directions from the import graph, naming and layout, the data-access pattern, the formatter and linter configs, the tests' shape. Each inferred standard carries its evidence and starts as `recommended`; a pattern the code follows inconsistently (such as 3 of 5 services through repositories) is put to the person as a choice, not guessed. The person approves, edits or drops each before the file is written: standards are guardrails, and guardrails are the person's.

**Acceptance**

- Given a project whose threat model says card numbers are never stored, then init suggests a `POL-` standard saying so, citing the threat model, and writes nothing until the person approves it.
- Given a project with no specs where 41 of 43 modules reach the database through `*Repository` classes, then init suggests "Data access goes through repositories" as `recommended`, with "41 of 43 modules" as its evidence, and names the 2 that don't.
- Given 3 of 5 services using repositories and 2 calling the database directly, then init asks the person which way the project goes, with both counts.

### STD-3 Each agent receives its layer's standards

The lane agent rules code-kit keeps current (ONB-8) gain the standards that apply to the lane's layers, one line each: `PAT-1 Data access goes through repositories (required, checked)`. The lead's section lists every standard by id and title. Advice stays one line; the why and the evidence stay in the file, for an agent to read when it needs them.

**Acceptance**

- Given an api lane in the `application` layer and ARC-5 for the `web` layer only, then the api lane's rules don't mention ARC-5.

### STD-4 Applied as firmly as code-kit can

- `enforced`: the rule named in `enforced by` already refuses the change; the refusal names the standard's id.
- `checked`: the reviewer and the lead's review check each changed file against the checked standards for its layer, and a breach of a `required` one is a blocker naming the id.
- `advice`: agents are told; a breach is at most a nit.

**Acceptance**

- Given ARC-2 enforced by a layer rule, when a lane imports infrastructure from domain code, then the refusal names ARC-2.
- Given PAT-1 required and checked, when a lane's branch queries the database from a handler, then the review sends it back citing PAT-1.

### STD-5 Changing the standards is the person's

`docs/standards.md` is protected with the `standards` approval. Adding a `recommended` standard may be delegated to the lead (`approvals.delegate.protected`); removing one, or weakening a `required` one, is always the person's.

### STD-6 Inherited from an organisation

The team provider interface gains `standards()`: an organisation's standards, if the provider has any (the GitHub provider has none). Inherited standards apply as if they were in the file, marked inherited. The project's file may extend one (add layers or detail) or tighten it (recommended to required, advice to checked); it may not weaken a required one without a waiver the provider confirms. `code-kit standards` shows inherited and own standards together, and says which waiver allows each weakening.

`standards()` answers `{ standards, waivers, version }`: each standard with this spec's fields (`id`, `title`, `level`, `applied`, `layers`, `why`, `source`, `enforcedBy`, and an `owner` and `version` if the provider keeps them), and each waiver as `{ standard, paths, expires, reason, approvedBy }`, `paths` empty when it covers the whole project. A hosted provider answers it at `GET /v1/repos/<owner>/<name>/standards`; one that doesn't keep standards answers none. A waiver for some paths leaves the standard in full everywhere else. code-kit keeps the last answer in `.claude/state/standards-inherited.json`, read again every ten minutes while a session runs, so the hooks and instructions don't wait on the network.

**Acceptance**

- Given an inherited required ARC-2 and a project file marking ARC-2 `recommended`, with no waiver from the provider, then `code-kit standards` reports that ARC-2 can't be weakened without a waiver, and ARC-2 applies as required.
