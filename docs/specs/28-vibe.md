# 28. Vibe

**Status:** specified
**Outcome:** Once the spec is done and code-kit is set up, the person can hand the whole build to the lead: it makes every product and project decision itself and builds everything, stopping only for what nobody else can give (an account with a service provider, a key from one, a payment, an act outside the repository).
**Actors:** the person, the lead
**Depends on:** 05-lead-loop, 19-lead-at-the-helm, 23-the-team

`autonomous` keeps the loop moving, but the guardrails stay the person's: the specs, the screens' designs, CI, the kit, the standards, a weakened test on the lead's own branch, a package beyond the registry's rules, pushes and the product questions the spec leaves open. On a build the person wants done without them, each of those stops the work until they come back. Vibe is the fourth answer to init's question of how hands-off the build is.

## Decisions

| Date       | Decision                                                            | Why                                                                                                   |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-11-05 | Vibe is a value of `harness.autonomy`, chosen after setup           | It answers the same question (how hands-off), and the first spec is still shaped with the person      |
| 2026-11-05 | The lead pushes the base too                                        | A push that deploys needs accounts the project already has; one that needs a new account stops anyway |
| 2026-11-05 | `code-kit ask` under vibe needs `--needs`                           | The person is asked only for what the lead can't give, and the CLI holds the lead to it               |
| 2026-11-05 | The project's own `shell.block` rules, and the person's acts, stand | Those are the project's guardrails and the person's controls, not decisions to delegate               |

## Requirements

### VIBE-1 Vibe hands every decision to the lead

`"harness": { "autonomy": "vibe" }` runs the loop as `autonomous` does, and makes the lead the product owner: its instructions (CLAUDE.md) say every decision is its own, and to stop only for what the person alone can give.

### VIBE-2 Every approval is the lead's

Under vibe, whatever `approvals.delegate` says, the lead approves with `--delegated`: every protected approval (the specs, the designs, CI, the kit and the standards included), weakening a standard, a weakened test on any branch, merges into the base and pushes to the remote's (never by force), and packages: within the registry's rules, or beyond them on its judgement, the approval recording which rules the package breaks. A lane asks the lead for all of these.

### VIBE-3 The lead answers its own questions

Under vibe the brief's open questions are the lead's, not the person's: `next` keeps them out of the person's Decisions tab and tells the lead to settle each and record it in the decision log. spec-design, spec-check, design, review and decide answer from the brief, the specs and the principles, and record each product decision with why.

### VIBE-4 The person is asked only for what nobody else can give

Under vibe, `code-kit ask` refuses a question without `--needs account|key|payment|outside`, saying the decision is the lead's to make and record. With it, the question waits for the person as any other, and the lead builds everything else meanwhile.

### VIBE-5 What stays the person's

The person's own acts (pausing the loop, choosing the lead session, changing the harness settings, discarding a worktree's changes, sending a report), the project's `shell.block` rules (those marked `person` among them), and the hooks' rules on where each agent writes stay as they are.
