# 29. What it costs to run

**Status:** draft
**Outcome:** Every project built with code-kit has a monthly running budget the person set, an architecture costed against it before anything is built, and no infrastructure change that pushes the estimate past the budget without the person seeing options that fit.
**Actors:** the person (sets the budget, picks an option when the design doesn't fit); the lead (costs the design and each change, proposes options); lane agents (cost the infrastructure their stories add); verify and the merge queue
**Depends on:** 17-onboarding, 22-standards, 23-the-team

Projects built with code-kit were designed with hosting that would cost about $1,200 a month, for products that had no users yet. Nobody chose that number. The specs asked for a database, queues, a cache and two environments; the lead picked each service's default production setup (a managed database with a standby, a NAT gateway per zone, containers running all the time), and nothing ever added it up. code-kit checks who writes where, the tests and the approvals, but not what the build will cost each month once it runs.

The fix is the same as for anything else that matters: the person sets the guardrail once, the design is checked against it before it's built, and each change is checked as it lands. The budget is the person's number, in their currency, for whatever providers the project uses. code-kit doesn't know any provider's prices. The lead estimates from the providers' published prices, writes down where each figure came from, and when the design doesn't fit, comes back with options that do.

## Decisions

| Date       | Decision                                                                                       | Why                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-06 | Provider-neutral: a budget, a register of estimated costs, and options when it doesn't fit     | Projects use AWS, Fly, Vercel, Supabase, model APIs and more; a check that knows one provider's prices misses the others |
| 2026-11-06 | Estimates in the repository first; reading real spend from an account is a later story         | Estimates need no credentials and catch the cost before it's built, which is when it's cheap to change                   |
| 2026-11-06 | Over the budget, the lead proposes options that fit, and the person decides                    | The budget is a guardrail the person set; the lead's job is to find designs within it, not to decide it's wrong          |
| 2026-11-06 | Existing projects are asked for a budget the next time init runs, and what's built gets costed | The projects already over budget are the ones that need it most                                                          |

## In scope

- Asking for the budget when a project is specced or set up, per environment, with the expected load.
- Costing the architecture before the plan, and offering options within the budget.
- A cost register in the repository that code-kit reads.
- Requiring a cost entry when a branch changes infrastructure, and stopping for the person when the total passes the budget.
- `code-kit cost`, and `next` naming a missing budget or an estimate over it.

## Out of scope

- Prices: code-kit holds no price list and calls no pricing API. The lead estimates and cites its source.
- Reading actual spend from a cloud or billing account, and setting alarms there (a later story, COST-8).
- Usage-based costs code-kit can't see (model tokens a product spends per user) beyond the estimate the register holds.

## Data

| Entity        | Where                                        | Fields                                                                                                                                                      |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget        | `.claude/code-kit.json` → `cost`             | `currency` (ISO code), `monthly` (environment → amount), `load` (the expected load the estimate assumes, in words), `paths` (globs of infrastructure files) |
| Cost register | `docs/costs.md` (`docs.costs` in the config) | a table: Item, Provider, Environment, Size, Monthly, Basis; one row per paid thing                                                                          |
| Cost change   | (derived: the branch's diff of the register) | environment, total before, total after, budget                                                                                                              |

`cost` is part of the kit's config, so changing the budget is the person's, like any other change to `.claude/code-kit.json`. The register is a document the lead keeps; it's protected under approval `cost` only in that a total over the budget can't be committed without it.

The register's table:

```md
| Item               | Provider | Environment | Size                         | Monthly | Basis                                 |
| ------------------ | -------- | ----------- | ---------------------------- | ------- | ------------------------------------- |
| Postgres           | Supabase | prod        | Pro plan, 8 GB               | 25      | supabase.com/pricing, 2026-11-06      |
| API containers     | Fly      | prod        | 2 × shared-cpu-1x, 512 MB    | 7.80    | fly.io/docs/about/pricing, 2026-11-06 |
| Transactional mail | Resend   | prod        | free tier, under 3,000/month | 0       | resend.com/pricing, 2026-11-06        |
```

Monthly is a number in the budget's currency. An environment column of `all` counts towards every environment's total.

## Requirements

### COST-1 The budget is set at the start

spec-design asks for the running budget with the other constraints (phase 1): how much a month the person will spend on hosting and services, for each environment they'll run (at least production; dev and staging if they'll exist), and the load to plan for (users, requests, data) at launch. A budget of 0 is a real answer: free tiers only. init writes them to `cost` in the config, drafts `cost.paths` from the infrastructure files it finds (Terraform, CDK, Pulumi, Serverless, SST, Docker Compose, Kubernetes manifests, `fly.toml`, `vercel.json`, `render.yaml`, `wrangler.toml`, `supabase/config.toml` and the like), and shows them with the rest of the setup.

**Acceptance**

- Given spec-design on a new idea, then its constraint questions include the monthly budget per environment and the expected load, and the brief records the answers.
- Given init after that, then the config's `cost` holds the currency, each environment's amount and the load, and `cost.paths` lists the project's infrastructure files.
- Given a config whose `cost.monthly` is missing or not a number per environment, then `check` names the problem.

### COST-2 The design fits the budget before it's planned

spec-design's architecture step (phase 5) costs each shape it proposes: every paid service, its provider, size and monthly estimate at the expected load, per environment, with where each price came from. At least one shape fits the budget. When the person's preferred shape doesn't, it says by how much and offers options that do: a smaller size, a free or cheaper tier, a different provider, one environment instead of two, a service the product can do without at launch, or a scope cut, each with what it gives up. The chosen shape's costs become the register, `docs/costs.md`, before any story is planned.

**Acceptance**

- Given a production budget of 100 and a proposed architecture whose estimate is 1,200, then spec-design says it's 1,100 over, offers at least two options under 100 with what each gives up, and doesn't write the plan until the person picks.
- Given the person picks an option, then `docs/costs.md` holds its rows and its totals are within the budget.

### COST-3 code-kit reads the register

`code-kit cost` reads the register and the budget and prints each environment's total against its budget, the rows behind it, and its problems: a row without a number in Monthly, without a Basis, or for an environment the budget doesn't name; a total over the budget; no register while `cost.paths` matches files. `--json` gives the same for tools. `next` shows a missing budget, a missing register, or a total over the budget as attention.

**Acceptance**

- Given a production budget of 100 and rows of 25, 7.80 and 0 for prod, then `cost` prints prod at 32.80 of 100.
- Given a row whose Monthly is `~30`, then `cost` names that row as unreadable.
- Given an `all` row of 10, then it counts in every environment's total.
- Given a total of 140 against 100, then `cost` exits 1 and `next` names the environment and how much it's over.

### COST-4 A change to the infrastructure is costed

A branch that changes a file `cost.paths` matches changes the register too, or verify fails it: the infrastructure changed, so the register says what that costs, even if the answer is a row whose cost didn't move (the Basis says why). The lane agent's instructions and the review say so.

**Acceptance**

- Given a lane branch that changes a Terraform file and not `docs/costs.md`, then verify fails it, naming the file and the register.
- Given the same branch with a register row changed, then verify passes that check.
- Given a project with no `cost` in its config, then verify doesn't check it.

### COST-5 Over the budget, options, and the person decides

A commit that leaves any environment's register total over its budget is refused (the commit hook, as for a weakened standard) unless an approval `cost` is in force. The refusal says the environment, the total, the budget and the gap, and tells the agent to come back with options that fit before asking: a lane hands the lead a change request; the lead asks the person with `code-kit ask` (under vibe, with `--needs payment`), listing each option that fits and what it gives up, and the over-budget one with what it costs. The person's approval is recorded in the approval log with the total it allowed. A later commit that raises the total again needs a new approval. Raising the budget itself is a change to the config: the person's.

**Acceptance**

- Given a budget of 100 and a commit that takes prod's total from 80 to 130, then the commit is refused, saying prod would be 130 of 100, 30 over, and to bring options that fit.
- Given the person's `cost` approval, then the commit goes through and the log records 130 against 100.
- Given a commit that takes the total from 130 down to 90, then it needs no approval.
- Given a lane, then the refusal tells it to hand the lead a change request, not to ask the person.

### COST-6 What's built already gets a budget

For a project set up before this, init's next run asks for the budget (COST-1), and the lead costs what's already deployed or defined in `cost.paths` into the register. When that's over the budget, the lead brings options that fit (COST-2's list) and the person decides, as COST-5. `next` keeps naming the missing budget until it's set.

**Acceptance**

- Given an existing project with infrastructure files and no `cost`, then `next` names the missing budget and init asks for it.
- Given its register over the budget, then the lead's next step is the options, for the person.

### COST-7 The lead keeps the estimate honest

The review of a branch that changes infrastructure checks the register against the change: the size in the code matches the size in the row, and a new paid resource has a row. A row whose Basis is more than 90 days old is named by `cost` as stale, so prices get rechecked.

**Acceptance**

- Given a branch whose code sizes a database larger than its register row, then the review sends it back, naming both.
- Given a row whose Basis is dated 100 days ago, then `cost` names it as stale.

### COST-8 Real spend (later)

With read-only billing access the person grants, code-kit reads each provider's actual monthly spend, shows it beside the estimate, and sets the provider's own budget alert at the budget where the provider has one. Not built in this phase.

## Open questions

| Question                                                                                    | Owner  | Blocks |
| ------------------------------------------------------------------------------------------- | ------ | ------ |
| Should the budget also cap usage-based spend a product incurs per user (model tokens, SMS)? | Warren | none   |
