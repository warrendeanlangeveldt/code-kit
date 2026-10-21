# 19. The lead at the helm

**Status:** specified
**Outcome:** The person sets the guardrails and decides only what crosses them: the specs, the architecture, the screens' visual design, weakened tests and product questions the spec doesn't answer. Inside the guardrails the lead runs the team. A lane that needs something it can't do itself asks the lead, never the person. The lead judges each request against the story's requirements, the spec and the project's principles, and approves it, or tells the lane what to use instead.
**Actors:** the person (sets the guardrails, decides what crosses them); the lead (decides inside them); lane agents (ask the lead); the hooks (still judge every call); the mod (shows the person only what's theirs)
**Depends on:** 03-approve-review-merge, 05-lead-loop, 06-hold-and-ask, 15-decisions-and-journal, 17-onboarding

Found running code-kit on a project of 138 stories. The person gave 26 approvals in two days. About 7 protected the spec and the architecture: spec changes, contract changes and designs. The rest were detail: migrations that carried out a spec the person had approved, validator changes, a dependency the plan named, and false alarms. Lanes' requests went straight to the person's band, and the lead's instructions said every new dependency was the person's to approve, so the lead passed requests on instead of deciding them. The person approved by default, which is no check at all.

## In scope

- Who decides what, in the config, with a default that gives the lead everything inside the guardrails (HELM-1).
- Lanes asking the lead, not the person (HELM-2).
- Dependencies judged on whether the story needs them and whether they fit the project (HELM-3).
- The loop handing the lanes' requests to the lead (HELM-4).
- UX decided by the lead from the spec, the screens' visual design by the person (HELM-5).
- The person's band showing only the person's decisions (HELM-6).

## Out of scope

- Changing what the hooks enforce. Every rule still holds; this changes who may grant an approval, and who is asked.
- The lead's own writes to protected files, which already need no approval (the person reviews them in the pull request, and the audit log keeps them).
- Registry facts for ecosystems other than npm. Those packages are judged by the lead alone.

## Data

`approvals.delegate`, as before: `protected` lists the approvals the lead grants, and `dependencies` (an object, empty for the defaults) lets it approve packages. What isn't delegated stays the person's. Spec 23 (WHO-1, WHO-2) makes the lead's split the default when the config has no `approvals.delegate`, and lets `tests` be delegated for lanes' branches.

Each open request in `code-kit requests --json` gains `by`: `lead` when the lead may grant every approval it names, otherwise `person`.

## Requirements

### HELM-1 Who decides what

The person decides what crosses the guardrails: changes to the specs, the contracts and the architecture's rules, the screens' visual design, CI, weakened tests, and product questions the spec doesn't answer. The lead decides everything else. `/code-kit:init` proposes `approvals.delegate` that way: `protected` lists every protected approval except those guarding the specs, contracts, designs and CI, and `dependencies` is on. The person can keep more for themselves, or give the lead more. (Spec 23, WHO-1: with no `approvals.delegate`, this split is the default, and contracts and the architecture's rules are the lead's too.)

**Acceptance**

- Given a project whose protected paths guard specs (`spec`), a contract (`contract`), migrations (`schema`) and validators (`truth`), when init proposes the config, then `approvals.delegate.protected` is `["schema", "truth"]` and `approvals.delegate.dependencies` is `{}`, and init says what the person keeps.

### HELM-2 Lanes ask the lead

A lane refused for something the lead decides is told so, with no `!` command and no mention of the person: hand the lead a change request (what it needs, the story and requirement, and what it checked first) and stop. The call isn't held, and the request doesn't reach the person's band. A lane refused for something the person decides is told the lead brings it to them. The lead's own call that needs only its own approval is refused with the command to approve it, and why it must say what it checked.

**Acceptance**

- Given `approvals.delegate.dependencies` and the web lane running `npm install dayjs`, then the refusal says the install is the lead's decision and what to put in the change request, contains no `!` command, the call isn't held, and `requests --json` lists the request with `by: "lead"`.
- Given `schema` delegated, when the api lane writes a migration, then the refusal says the lead decides, and the request is the lead's.
- Given `contract` not delegated, when a lane writes the contract, then the refusal says the person decides through the lead, and the request is the person's.

### HELM-3 Dependencies judged on merit

The lead approves a package for a story, not by default: `code-kit approve <package> --lane <lane> --delegated --story ST-n --reason "<need, what the project already has, how it fits>"`. Without `--story`, or naming a story the plan doesn't have, nothing is approved. Before approving, the lead checks that the story's requirements need it, that nothing the project already depends on does the job, and that it fits the principles and the lane's layer. When something else fits better, it drops the request with the reason (`code-kit requests drop <n> --reason "…"`) and tells the lane what to use. A package that would break a principle, the architecture or the spec goes to the person as a question, with the lead's recommendation. An npm package must also pass the registry rules in `approvals.delegate.dependencies`; a package from another ecosystem (pip, uv, Poetry, cargo, go, bundler) is judged by the lead alone, since there are no registry facts to check.

**Acceptance**

- Given a delegated approval of `pillow` with no `--story`, then nothing is approved and the error says why.
- Given the api lane's request to `uv add pillow` and `approve pillow --lane api --delegated --story ST-138 --reason "…"`, then it's approved within the delegated rules without reading the npm registry, and the reason in the log names ST-138.
- Given `--story ST-999` that the plan doesn't have, then nothing is approved.

### HELM-4 The loop hands requests to the lead

While a lane waits on a request the lead decides, `code-kit next` returns `decide`, before reviews and dispatches, with the requests' numbers. The loop prompts the lead to run `/code-kit:decide`, which takes each request in turn: approve and resume the lane, answer it with an alternative, or take it to the person when it crosses a guardrail.

**Acceptance**

- Given an open request with `by: "lead"`, then `next --json` returns `decide`, and the loop's prompt names `/code-kit:decide`.
- Given only requests the person decides, then `next` doesn't return `decide`.

### HELM-5 UX is the lead's, the visual design the person's

The lead answers UX questions (flows, states, errors, empty screens, the wording the spec implies) from the spec and the principles the person agreed, and records the answer where the lanes will read it. It asks the person only when the spec and the principles don't settle it. A screen's visual design still needs the person's approval before it's built (ONB-2).

**Acceptance**

- Given a lane asking whether a failed upload keeps the form's values, and a spec principle that no input is lost, then the lead answers from the principle without asking the person.

### HELM-6 The person sees only their own decisions

The band's approvals waiting, held calls and the Decisions tab hold only the person's decisions: requests they decide, the lead's questions, and calls the person must approve. A request the lead decides never shows there. A call is held for the person only when an approval it needs is theirs (this replaces HOLD-5, where the mod approved within the delegated rules without the lead's judgement).

**Acceptance**

- Given one open request by the lead and one by the person, then the band reads "1 approval waiting", for the person's.
- Given `approvals.delegate.dependencies` and a lane's install refused, then the call isn't held and the band doesn't change.

## Quality targets

- No refusal a lane receives tells it to ask the person.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
