# 25. What CI costs

**Status:** draft
**Outcome:** A project built with code-kit runs its full CI once per release instead of once per story, no job runs for hours unnoticed, and the person can see what the project spends on GitHub Actions.
**Actors:** the person (approves CI changes, decides when to release); the lead (cuts the release branch on the person's word); the merge queue (checks each story before it merges); GitHub Actions
**Depends on:** 03-approve-review-merge, 09-merge-queue, 17-onboarding

Three private projects built with code-kit used about 5,400 minutes of GitHub Actions in one week. At that rate GitHub Pro's 3,000 included minutes a month last four days, and GitHub then stopped starting jobs at all.

- **One project ran its full CI on every push to `main`:** 61 runs in a week, about 80 minutes each. It ran lint, typecheck, unit tests and two integration suites, all of which had already run in the story's pull request and in the merge queue.
- **Another project's jobs had no time limit.** A backend job ran for 290 minutes before someone cancelled it, and a Playwright step failed after almost two hours.
- **code-kit's own workflow ran each project's checks again.** Its template ran `verify` with the checks, so in one project the code-kit job took 32 minutes a pull request, repeating the test suite.
- **A third project ran two end-to-end suites on every pull request** from every lane branch.

Each story is its own branch, pull request and merge, so whatever CI does per pull request or per merge happens once per story. code-kit's merge queue already runs the project's checks locally before a story merges (spec 09), so the base branch only receives commits whose checks passed. Running the full suite again on GitHub at each merge repeats that work. It belongs at the point where a version is about to ship.

## Decisions

| Date       | Decision                                                                              | Why                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2026-10-25 | The full suite runs on a release branch cut from the base, not on every merge into it | The merge queue already checked each merge; a release is where the whole build has to be proven once more         |
| 2026-10-25 | code-kit's own workflow checks the rules only, by default                             | The checks ran in the merge queue; a pull request made outside Claude Code has its checks run at the next release |
| 2026-10-25 | Changes to a project's existing CI are proposed by init, and the person approves them | CI is protected (approval `ci`): it decides what reaches production                                               |

## In scope

- code-kit's workflow template: what it runs, its time limit and its concurrency.
- Checking a project's existing workflows for what costs most, and proposing the fix.
- Cutting a release branch.
- A report of the project's Actions minutes.

## Out of scope

- Editing a project's workflows without the person: init proposes, the person approves.
- Self-hosted runners and caching strategies: they change the price of a minute, not how many are spent.

## Data

| Entity         | Where                      | Fields                                                                                                        |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| CI finding     | (derived from the files)   | workflow file, kind (`every-merge`, `every-pr`, `no-timeout`, `no-concurrency`, `code-kit-checks`), what, fix |
| Release branch | git                        | `release/<version>`, cut from the base's head                                                                 |
| Usage          | GitHub's API, through `gh` | per workflow over the last days: runs, minutes, cancelled, failed                                             |

## Requirements

### CIC-1 code-kit's workflow checks the rules, briefly

The template's job runs `verify --no-checks` on each pull request: ownership, layers, approvals, the design gate and the standards, which take seconds. It sets `timeout-minutes: 10`, and `concurrency` with `cancel-in-progress` for the pull request's branch, so a new push stops the run it replaces. init asks whether people open pull requests from outside Claude Code and want those proven at once; only then does it write the job with the checks.

**Acceptance**

- Given init writing the workflow, then it runs `verify --no-checks`, with a 10-minute limit and cancel-in-progress.
- Given the template, then its verify step carries `--no-checks`, which init removes only when the person asks for checks on every pull request.

### CIC-2 What a project's CI spends, checked

`code-kit ci check` reads `.github/workflows/` and lists what multiplies the cost with code-kit's way of working, with the fix for each:

- `every-merge`: a workflow that runs on every push to the base branch. Run it on `release/**` instead.
- `every-pr`: a workflow with jobs over 10 minutes (from its recent runs, or its test and build steps) on every pull request. Run it on `release/**` instead, keeping a fast check on pull requests if the project wants one.
- `no-timeout`: a job without `timeout-minutes`, so a hung test runs up to GitHub's six hours.
- `no-concurrency`: a workflow on pull requests without `cancel-in-progress`, so every push runs to the end.
- `code-kit-checks`: code-kit's own workflow, written before this, running `verify` with the checks. Add `--no-checks`.

init runs it when it sets CI up, and shows the person the changes it proposes; they're applied only as the person approves them (approval `ci`). `next` mentions them as attention, with the count and the files.

**Acceptance**

- Given a workflow with `on: push: branches: [main]` and no `timeout-minutes`, then `ci check` lists `every-merge` and `no-timeout` for it, each with its fix.
- Given a workflow on `push: branches: ['release/**']` with timeouts and concurrency, then it lists nothing for it.

### CIC-3 A release is a branch

When the person decides to release, the lead runs `code-kit release <version>`. It cuts `release/<version>` from the base's head as committed (no checkout, so the work in progress stays where it is) and pushes it, refusing when that branch already exists here or on the remote. The project's full CI then runs once, on that branch. The command says the branch, the commit and the stories merged since the last release branch. Releasing stays the person's decision: the lead skill never cuts one unasked.

**Acceptance**

- Given the base at commit `abc1234` with ST-4 and ST-7 merged since `release/0.3.0`, when the lead runs `code-kit release 0.4.0`, then `release/0.4.0` points at `abc1234`, is pushed, and the output names ST-4 and ST-7.
- Given `release/0.4.0` already exists, then it's refused, naming the commit it's on.

### CIC-4 What the project spends

`code-kit ci usage [--days 7]` lists the project's GitHub Actions runs over the last days by workflow and trigger: runs, minutes, and how many were cancelled or failed, with the total. Minutes are the runs' wall-clock time, said as such: GitHub bills each job, rounded up, and its billing API needs a scope `gh` doesn't ask for. A run that GitHub refused to start for billing is said plainly, since the project's CI then isn't running at all.

**Acceptance**

- Given 61 pushes to `main` at about 26 minutes each in a week, then `ci usage` lists the workflow's push runs with their minutes and the total.
- Given the latest run refused for the account's spending limit, then `ci usage` says GitHub isn't starting jobs, and why.

## Open questions

| Question                                                                                                                                   | Owner  | Blocks |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ |
| Should the merge queue run a project's slow suites (integration, end-to-end) locally before a merge, once CI no longer runs them per merge | Warren | none   |
