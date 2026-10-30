# 18. Regression

**Status:** specified
**Outcome:** A change that fixes one thing doesn't quietly break another. A fix comes with a test that proves its bug. Tests can't be weakened to get to green. The tests of the code a change reaches run with it. The features a change could affect are named, with the lineage that links them, and the QA lane walks them in a real browser. Each requirement has scenarios a machine runs, and a branch doesn't merge while one it reaches fails. Main stays green, and while it isn't, no new work starts.
**Actors:** the person; the lead (review, the loop, the merge queue); lane agents; the QA lane, in build mode (`test-engineer`, which writes the scenarios) and check mode (`qa-check`); the project's deploy pipeline
**Depends on:** 03-approve-review-merge, 07-reviewer, 09-merge-queue, 10-traceability, 14-mission-and-maps, 17-onboarding

Found by running code-kit on a codebase under continuous development. Agents fixed issues, and their checks passed, yet other things broke. A fix in shared code ran the shared tests but not the tests of the code importing it. The review compared the branch with its own story and nothing else. A fix with no test could come back, and nothing stopped an agent from deleting or skipping a test to get to green. Each pull request was checked on its own, but nobody checked that main still worked as a whole, or that the features people use still worked. The same codebase then grew a suite of API scenarios, one file per scenario, each citing a requirement, run against a shared staging environment after each deploy. It caught regressions, but only once they had merged and deployed.

## In scope

- Fixes that prove their bug, and tests that can't be weakened without the person (REG-1, REG-2).
- Checks that reach the code depending on a change (REG-3).
- Main kept green, with new work stopped while it isn't (REG-4).
- A feature map, the lineage from a change up to the features it could affect, and a Features tab (FEAT-1 to FEAT-3).
- The QA lane's check mode: the affected features walked in a real browser, through an adapter (QA-1 to QA-4).
- Scenario suites: requirement-level scenarios in the project's own format and runner, written by the QA lane, run against wherever the person says, gating merges when the target runs the branch, and never weakened without the person (SCN-1 to SCN-7); and, for a project without a suite, a spec for building one (SCN-8).
- An older setup told what's new (REG-5).

## Out of scope

- Visual diffs of screenshots, and performance or load testing.
- Check mode running the app anywhere but a local, throwaway environment. It never touches a shared or production system.
- Shipping a scenario runner. code-kit runs the project's runner through a contract (SCN-1), and gives a project without one a spec to build it (SCN-8); the format, the runner, its identities and its credentials are the project's.
- Choosing where scenarios run. The targets are the person's, in the config, a kit file every change to which they approve.
- Hosted browsers. The browser runs on the machine the lane runs on.

## Data

### The feature map, `docs/features.md` (`docs.features`)

```markdown
## F-1 Book an appointment

**Who:** a client
**Requirements:** BOOK-1, BOOK-2, PAY-3
**Entry:** /book, /book/:id/confirm
**Code:** apps/web/src/booking/**, packages/api/src/bookings/**

### Scenarios

- **Books the first free slot.** Given a signed-in client with no bookings, when they pick the first free slot and confirm, then the confirmation shows the slot and the booking is in My bookings.
- **A taken slot can't be booked twice.** Given a slot another client just booked, when they confirm it, then they're told it's gone and offered the next free one.
```

| Field        | Required | Rules                                                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| Heading      | yes      | `## F-<n> <name>`: a feature in the person's words, as a user would name it. IDs are unique, never reused |
| Who          | yes      | the kind of user                                                                                          |
| Requirements | no       | IDs from the specs. An unknown ID is a gap in `status`                                                    |
| Entry        | no       | where a user starts it: routes for web, screens for mobile                                                |
| Code         | no       | globs. A file matching one belongs to the feature directly, even with no story naming it                  |
| Scenarios    | yes      | one bullet each: a bold name, then given, when, then. A feature without scenarios is a gap                |

### Config

| Key                  | Default                                                                                                          | What it is                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs.features`      | `docs/features.md`                                                                                               | The feature map                                                                                                                            |
| `tests[]`            | The usual conventions: `*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `tests/`, `e2e/`, `*_test.go`, `test_*.py` | Which files are tests                                                                                                                      |
| `regression.prepare` | none                                                                                                             | Run in the temporary worktree before a fix's tests, such as `npm ci`. Without it, the checkout's installs are linked in                    |
| `app.start`          | none                                                                                                             | Starts the app. It's given `PORT`, a free port, and `app.env`                                                                              |
| `app.url`            | `http://localhost:{port}`                                                                                        | Where the app answers once it's up. Only `localhost`, `127.0.0.1`, `[::1]` or a `.localhost` or `.test` name is accepted                   |
| `app.seed`           | none                                                                                                             | Puts the scenarios' starting data in place, run before each feature                                                                        |
| `app.env`            | `{}`                                                                                                             | Environment for `start` and `seed`: a throwaway database, test keys. Values that look like live or production keys make the config invalid |
| `app.readySeconds`   | 90                                                                                                               | How long the app has to answer at `app.url`                                                                                                |
| `harness.redMinutes` | 60                                                                                                               | How long main may be red before the band puts **Revert** first                                                                             |

### Scenario suites (`scenarios`)

```json
"scenarios": {
  "files": ["apps/api/tests/scenarios/*/*.yaml"],
  "list": "cd apps/api && uv run python -m tests.scenarios.inventory",
  "run": "cd apps/api && uv run python -m tests.scenarios.run",
  "targets": {
    "local": { "serves": "branch", "start": "pnpm --filter api dev:scenarios", "url": "http://localhost:{port}" },
    "staging": { "serves": "base", "url": "https://api.staging.example.com" }
  },
  "gate": { "target": "local", "tags": ["read_only", "writes"] }
}
```

| Key                           | Required | What it is                                                                                                                                                                                                                                                           |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`                       | yes      | Globs naming the scenario files. They're the QA lane's paths, and count as tests for REG-2                                                                                                                                                                           |
| `list`                        | yes      | Prints every scenario as JSON, offline, with no target: `[{ id, requirement, expect: "pass" \| "known_broken", strength, tags, file }]`. `strength` is the number of assertions. Run on the branch and on the base for SCN-4                                         |
| `run`                         | yes      | Runs the scenarios whose ids it's given, one per line on stdin, against `CODE_KIT_TARGET_URL`, and prints `[{ id, outcome: "passed" \| "failed" \| "error" \| "skipped", step?, detail?, reason? }]`. Credentials come from its own environment, never from code-kit |
| `targets.<name>.serves`       | yes      | `branch`: the target runs the code of the branch being checked. `base`: it runs whatever was last deployed from the base, like a shared staging                                                                                                                      |
| `targets.<name>.start`        | no       | For a `branch` target: run in the branch's worktree with `PORT`, a free port, and stopped after the run. Without it, `url` must already serve the branch                                                                                                             |
| `targets.<name>.url`          | yes      | Where the target answers. `{port}` is `start`'s port; `{branch}` is the branch name made safe for a host name, for a preview deploy per branch                                                                                                                       |
| `targets.<name>.readySeconds` | no       | How long the target has to answer at `url` (default 120)                                                                                                                                                                                                             |
| `gate.target`                 | no       | The target merges are gated on. It must be a `branch` target; a `base` target there makes the config invalid, since it would pass branches it never ran. Without `gate`, nothing is gated before merge, and the review says so                                       |
| `gate.tags`                   | no       | Only scenarios with one of these tags run at the gate (default: all). The rest run after deploy and in `health`                                                                                                                                                      |

### State

- `.claude/state/health.json`: the latest full run on the base. It records the commit, the time, and the result of each check and feature, as passed, failed or couldn't run, with the first failure's output.
- `.claude/state/qa.jsonl`: one line per walk. Each line has the branch or base and commit, the feature, the scenario, the result (passed, failed, or couldn't run), the step it failed at, what was expected, what was seen, and its screenshots.
- `.claude/state/qa/<run>/`: the screenshots of a walk. These are only ever written by check mode, and nothing else in the repository is.
- `.claude/state/scenarios.jsonl`: one line per scenario run: the target, the branch or base and its commit, each scenario's expected and actual outcome, and the verdict (SCN-3).

## Requirements

### REG-1 A fix proves its bug

A story that fixes something says so in the plan, with an optional fifth line: `**Fixes:** <what was broken, and where it was seen>`. A branch named `<lane>/fix-…` counts too. `verify` on such a branch takes the test files it added or changed. It runs them against the branch's code with every change outside the tests taken back to the base. This happens in a temporary worktree, using the checks whose `files` match those tests, with a missing tool counted as a failure. The checkout's installs (`node_modules`, `.venv`, `venv`, wherever git ignores them) are linked into the worktree, and `regression.prepare` runs there first when it's set. The tests must pass in that worktree as the branch has them, and fail once the fix is taken back. A test that doesn't pass in a fresh checkout, or one no check runs, is a problem that says so. `verify --no-checks` still proves a fix, because CI's own steps don't do this; the story drill-down, which runs no checks, doesn't.

The failure on the base must be the bug showing, not the test being unable to run. If a user can hit the bug, a test can hit it through the code that's already there, and that test fails on an assertion. A test that fails only because it can't compile, or can't find what it calls, proves only that the fix added something. `verify` recognises that kind of failure from the test runner's output ("Cannot find module", "is not a function", "does not provide an export named", TypeScript's missing-name errors, and others an adapter adds). If that's the only kind of failure, `verify` asks for a test that goes through the existing entry point. When it can't tell what kind of failure it was, the failure counts, and the review report says so.

A fix that adds or changes no test, or whose tests also pass without the fix, has a problem under `regression`: its tests don't prove the bug, so it can come back. The review sends it back like a failing test. A test story the QA lane is given to lock in a failure (QA-3) is held to the same rule.

**Acceptance**

- Given a plan story with `**Fixes:** double booking`, whose branch changes `src/booking.ts` and adds `src/booking.test.ts`, and that test fails with the base's `src/booking.ts`, then `verify` reports no regression problem.
- Given the same, but the test passes with the base's `src/booking.ts`, then `verify` says the fix's tests pass without the fix, so they don't prove the bug, and names the test file.
- Given a fix branch whose new test fails on the base only with `booking.cancelSlot is not a function`, a function the fix adds, then `verify` says the test fails without the fix only because it calls what the fix adds, and asks for a test through the existing entry point.
- Given a fix branch that changes no test file, then `verify` says the fix comes with no test that proves it.
- Given a story with no `**Fixes:**` line on a branch not named `fix-…`, then `verify` doesn't run the fix check.

### REG-2 Tests aren't weakened without the person

`verify` compares each test file a branch changes with the base. It flags each of these:

- a deleted test file;
- an added skip or focus marker (`.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `test.fixme(`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled`, and others an adapter adds);
- fewer test cases in a file than on the base;
- fewer assertions in a file whose cases are all still there;
- a changed snapshot (`__snapshots__/**`, `*.snap`).

The commit hook refuses a commit that weakens a test, by a lane or the lead, unless the person's `tests` approval is in force: "<file> is a weakened test (it adds a skip or focus marker (…)); committing it needs a person's approval in force". The refusal is recorded as a request and held in the band like any other approval a person can give, so it waits in the Decisions tab as "Approve a weakened test", with what was weakened. **Approve** writes the approval and the held commit runs. The commit logs each weakened file in the approval log, with the reason and what was weakened, and uses the approval up. Spec 23 (WHO-2) replaces the last part: on a lane's branch, where tests are delegated (the default), the lead approves it after its review with `code-kit approve tests --lane <lane> --delegated --story ST-n`, and the refusal says so; on the lead's own branches it's still the person's.

`verify` then judges the branch as a whole, including commits made outside Claude Code: each weakening is a problem under `tests` unless the branch's approval log records the person's `tests` approval for that file. A test moved or renamed with the same cases isn't flagged, and neither is a case renamed in place. Both judge against the base: a test the branch added itself since it left the base isn't the base's to lose, so the commit hook doesn't refuse moving its cases on or deleting it.

**Acceptance**

- Given a lane committing `it.skip(` in `src/booking.test.ts`, then the commit is refused, held for the person with the `tests` approval, and listed as an open request; the lead is refused the same way.
- Given the person's `tests` approval for that lane, then the commit goes through, logged with the reason and what was weakened, and the approval is used up.
- Given a branch that cut a test case outside Claude Code, then `verify` names the file and the case gone, and says a weakened test needs the person's `tests` approval.
- Given a branch that rewrites `__snapshots__/a.snap`, then `verify` says it rewrites a snapshot.
- Given the same, with the person's `tests` approval logged for that file, then `verify` passes it.
- Given a branch that moves `src/a.test.ts` to `src/a/a.test.ts` with the same cases, then nothing is flagged.
- Given a branch that added `src/held.test.ts` in an earlier commit, when a commit deletes it, then the commit isn't refused.
- Given `code-kit approve tests --delegated`, then it's refused: weakening a test is the person's to allow.

### REG-3 Checks reach the code that depends on a change

A check runs when a file it matches changed, and also when a file it matches imports a changed file, directly or through others. The import graph is the one `graph` and the layers already use. With `each`, the importing files' folders run too. The stop hook and `verify` both reach this far. A check that fails only because of the reach says which import led to it. `checks[].reach: false` keeps a check to the changed files alone.

**Acceptance**

- Given `packages/shared/src/date.ts` changed, `apps/web/src/booking.ts` importing it, and a check on `apps/web/**`, then that check runs. Its failure says `apps/web/src/booking.ts` imports `packages/shared/src/date.ts`.
- Given the same, with `"reach": false` on that check, then it doesn't run.
- Given a change no other file imports, then the same checks run as before.

### REG-4 Main stays green

`code-kit health [--scripted] [--json]` runs every check on the base's head in full, not only for changed files. It also runs the QA lane's scripted suites, and check mode's walks of every feature (QA-2). It records the result in `.claude/state/health.json`. `--scripted` leaves the walks out, because they need an agent.

Health runs in two places:

- **The loop:** when the base's head has no health record, after a merge or when the loop starts, `next` gives `health`, and the loop prompts the lead to run it, walks included.
- **CI:** init writes a workflow step that runs `code-kit health --scripted` on every push to the base. This covers merges made outside Claude Code: a pull request merged on GitHub, or a hotfix pushed directly. When `gh` is available, `next` reads CI's result for the base's head, and a failing run counts as red, like a red health record.

When the base is red:

- `next` gives `fix-main` before any dispatch, design or lead story.
- Work in flight carries on through review, but merges wait, except for a branch whose story fixes the failure.
- The band reads "main is red since web/st-12 merged: booking tests fail". It names the merges since the last green run, from the journal, with **Why**.

Main is fixed forward by default: the lead plans a fix story in the lane that owns the failing code at once, with no approval needed. That story is held to REG-1.

Undoing the merge is the person's choice:

- **Revert** shows in the band only for a merge that reverts cleanly. It runs `code-kit revert <merge>`, which the lead may run only with the person's approval.
- A reverted story goes back to its lane with the failure, so the work isn't lost. It comes back as a fix held to REG-1.
- When main has been red for `harness.redMinutes` (60 unless set) and the fix hasn't turned it green, the band reads "main has been red for 60 minutes" and puts **Revert** first. Parallel lanes don't wait behind one slow fix.

When the next health run passes, the hold lifts.

**Acceptance**

- Given a base head with no health record, then `next` gives `health`.
- Given a red health record for the base's head and a ready story, then `next` gives `fix-main`, naming the failing check and the merges since the last green run, and doesn't dispatch the story.
- Given the same and a branch at the head of the merge queue that doesn't fix it, then its merge waits, saying main is red.
- Given a later green record, then `next` dispatches the ready story.
- Given a green health record but CI failing `code-kit health --scripted` on the base's head, then `next` gives `fix-main`, naming CI's run.
- Given main red for 61 minutes with `harness.redMinutes` unset, and the merge that turned it red reverting cleanly, then the band says main has been red for 60 minutes, with **Revert** first.
- Given the lead running `code-kit revert` without the person's approval, then it's refused: undoing a merge is the person's choice.

### FEAT-1 The feature map

The map is the list of what the product does for its users, in their words, with the requirements and code behind each feature.

- **Greenfield:** spec-design writes it from the main journeys it already walks, one feature per journey. Each step of a journey becomes a scenario.
- **Brownfield:** init drafts it from what the code shows: the routes and screens, the existing end-to-end tests and their names, and the specs if there are any. It shows the draft to the person, who corrects it. It's the lead's file, like the plan.

`code-kit status` reads it. Its gaps are the same kind as the plan's: a feature citing an unknown requirement, a feature with no scenarios, and a screen route that no feature's `**Entry:**` covers.

**Acceptance**

- Given `docs/features.md` with F-1 citing BOOK-9, and no spec defining BOOK-9, then `status` lists the gap.
- Given F-2 with no scenarios, then `status` says F-2 has no scenarios to walk.
- Given no `docs/features.md` in a project whose lanes own screens, then `next` says the feature map is missing under attention.

### FEAT-2 Impact: from a change up to the features

`code-kit impact [--branch name] [--base ref] [--json]` traces a branch's changes upwards:

1. It starts from the changed files.
2. It adds every file that imports them, directly or through others.
3. It finds the stories whose commits touched any of those files, with the same matching `storyFiles` uses.
4. From the stories, it gets their requirements.
5. From the requirements, it gets the features that cite them.

A file matching a feature's `**Code:**` goes straight to that feature. Each affected feature comes with the shortest path that links it, and the scenarios to walk.

**Acceptance**

- Given a branch changing `packages/shared/src/date.ts`, imported by `apps/web/src/booking.ts`, which ST-12 (BOOK-2) changed, and F-1 citing BOOK-2, then `impact` lists F-1 with `date.ts ← booking.ts ← ST-12 (BOOK-2) → F-1 Book an appointment` and F-1's scenarios.
- Given a change no feature's lineage reaches, then `impact` says no feature is affected, and why: no story or feature code leads to it.
- Given `--json`, then each feature has `{ id, name, path: [...], scenarios: [...] }`.

### FEAT-3 The Features tab

The code-kit pane has a Features tab. Each feature shows:

- its requirements' states, from the trail;
- its last walk on the base and on each open branch, with the result, when it ran, and the commit;
- for the selected branch, whether it's affected, highlighted.

Selecting a feature shows its lineage (`impact`'s paths), its scenarios with each one's last result, and the screenshots of a failed walk.

**Acceptance**

- Given web/st-12 affecting F-1 and F-3, then the tab highlights F-1 and F-3 when web/st-12 is selected.
- Given F-1's last walk on the base failing at "confirm", then F-1 shows failed with the step, and its drill-down shows the screenshots.

### QA-1 Check mode

The QA lane has two modes:

- **Build** is its `test-engineer` agent, as now: it writes and fixes the scripted suites on its own `qa/…` branch.
- **Check** is a second agent file for the same lane, `.claude/agents/qa-check.md`. init writes it beside `test-engineer`, with the same skills and the feature map. The hooks tell agents apart by their type, so check mode needs its own type, and one that owns no paths.

In check mode, the agent:

- reads, but never writes the repository;
- may run only `app.start`, `app.seed` and read-only commands with Bash;
- uses the browser through the browser adapter (QA-4);
- records each walk with `code-kit qa record`, which writes `qa.jsonl` and its screenshots folder.

The hooks hold it to this as they hold the security reviewer.

**Acceptance**

- Given the `qa-check` agent writing `apps/web/src/booking.ts`, then it's refused: check mode only reads, and a failure it finds goes back to the branch's lane.
- Given the `qa-check` agent running `npm run dev` that isn't `app.start`, then it's refused, naming `app.start`.
- Given the `qa-check` agent running `code-kit qa record`, then the walk is recorded.

### QA-2 What check mode walks, and when

- **In review:** after `verify` passes, the review runs check mode on the features `impact` names for the branch. The app is started from the branch's worktree on a free port and seeded before each feature. For each scenario, check mode walks the given, when and then in the browser, with a screenshot at each then. Scenarios already covered by a scripted suite the review ran are still walked: the scripts prove what they check, and the walk proves what a user sees.
- **In `health`:** check mode walks every feature on the base.

A scenario check mode couldn't run, because the app didn't start or a step had no element to act on, is recorded as couldn't run with the reason. It's never recorded as passed.

**Acceptance**

- Given web/st-12 affecting F-1 with two scenarios, then its review records two walks of F-1 on web/st-12's commit, each with screenshots.
- Given `app.start` not answering within `app.readySeconds`, then each scenario is recorded as couldn't run, saying the app didn't start, and the review says so.
- Given no feature affected, then the review runs no walks, and says why.

### QA-3 What a failure does

- **Reproduced:** a scenario that fails twice at the same step, from a fresh seed each time. In review, this fails the review like a failing test. The branch goes back to its lane with the scenario, the step, what was expected, what was seen, and the screenshots. The lead also plans a `qa` story to lock it in: a scripted test of that scenario, held to REG-1, so the failure is then caught by a test every time, not by a walk. In `health`, a reproduced failure makes the base red (REG-4).
- **Not reproduced:** a scenario that fails once and then passes. It goes to the Decisions tab as a `qa` decision, with both walks' screenshots, and **Send back** or **Not a bug**.
- **Judgement:** something check mode thinks is wrong but no scenario says (it looks broken, the wording is wrong, it's slow). This also goes to the Decisions tab as a `qa` decision, with the same choices. None of these block on their own.

**Acceptance**

- Given F-1's "Books the first free slot" failing twice at "confirm" on web/st-12, then web/st-12 is sent back with the scenario, the step and the screenshots, and the plan gains a `qa` story citing F-1's requirements with `**Fixes:**` naming the scenario.
- Given a scenario that fails once and passes on the second walk, then the branch isn't sent back, and the Decisions tab has a `qa` card with both walks.

### QA-4 The browser goes through an adapter

The core never names a browser tool. A browser adapter in `hooks/lib/adapters/` says:

- whether the tool is available;
- which tools the `qa-check` agent may use;
- how it keeps each walk isolated: a fresh profile, headless, with no saved sign-ins.

The default adapter drives Playwright's MCP server. Whichever adapter is used:

- it never uses the person's own browser profile or sessions;
- it never opens a URL outside `app.url`'s host, so a scenario that leaves for a third party ends there and is recorded as couldn't run, with the reason.

Without an available browser adapter, check mode runs the scripted suites only. `next` says once, under attention, what to install.

**Acceptance**

- Given no browser adapter available, then the review runs the scripted suites, records no walks, and `next` names what to install.
- Given a scenario step that would open `https://accounts.example.com`, then the walk stops there, recorded as couldn't run, outside `app.url`.

### SCN-1 The suite is the project's; the rules are code-kit's

code-kit runs no scenario itself. It knows a project's suite through `scenarios.list` and `scenarios.run` (Config), which are usually thin wrappers over the project's own runner: one prints what the scenarios are, the other runs some and prints what happened. Any format and any runner fits: HTTP calls, a browser, a command line. The core never names one.

Every scenario cites one requirement. `status` and the Trail tab show each requirement's scenarios beside its tests, and a requirement with neither is a gap. A requirement no scenario can check, such as one only a person sees on screen, says so in its spec with `**Scenarios:** none, <why>`, and isn't a gap.

**Acceptance**

- Given `list` printing a scenario citing BOOK-9 and no spec defining BOOK-9, then `status` lists the gap.
- Given BOOK-2 with no scenario and no `**Scenarios:** none` line, then `status` lists BOOK-2 as having no scenario.
- Given `list` failing or printing something that isn't the shape above, then `verify` says the suite can't be read, with `list`'s output, and that's a problem, not a pass.

### SCN-2 The QA lane writes them, before the code

Scenarios are written by the QA lane's `test-engineer` (build mode), not by the lane building the feature, so the code isn't graded by its own author. `scenarios.files` are the QA lane's paths. A lane building a feature may change a scenario file only to promote it from `known_broken` to `pass` (SCN-4); any other change is refused, and goes to the QA lane as a change request.

When a spec is ready, the plan gains a `qa` story per spec, "Scenarios for <spec>", with no dependency on the build stories, so it's dispatched alongside them. Its brief lists the spec's requirements and their acceptance criteria. Its agent writes scenarios that assert the behaviour the spec describes, the happy path, permissions, tenancy and each error the spec lists, in the project's format. A scenario skill (`.claude/skills/scenarios/SKILL.md`), which init drafts from the project's own guide to writing one, teaches it the format. Its branch is held to `list` reading every file it adds.

A scenario for a requirement whose stories aren't all done is expected to fail. It isn't written as `known_broken`. code-kit derives it from the plan (SCN-3), so `known_broken` keeps one meaning: a defect in something that's built, with the defect described.

**Acceptance**

- Given the web lane changing `apps/api/tests/scenarios/02-booking/BOOK-3.my-bookings.yaml` to add a step, then it's refused, naming the QA lane.
- Given the web lane changing only that file's `expect` from `known_broken` to `pass`, as `list` shows, then it's allowed.
- Given spec 02 ready, then `next` dispatches "Scenarios for 02-booking" to the QA lane alongside its build stories.
- Given a new scenario `list` doesn't read, then the QA branch's `verify` says so.

### SCN-3 What a run means

Each scenario's outcome is judged against what's expected of it:

| Expected                                                                                      | Outcome | Verdict                                                      |
| --------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `pass`                                                                                        | passed  | holds                                                        |
| `pass`                                                                                        | failed  | **regression**                                               |
| `known_broken`                                                                                | failed  | still broken                                                 |
| `known_broken`                                                                                | passed  | **newly fixed**: promote it to `pass`                        |
| not built yet (its requirement's stories aren't all done, and this branch doesn't deliver it) | failed  | not built yet                                                |
| not built yet                                                                                 | passed  | holds                                                        |
| any                                                                                           | error   | **proved nothing**: it couldn't set up, or couldn't clean up |
| any                                                                                           | skipped | skipped, with the runner's reason, never counted as passed   |

A failure is run once more before it counts. Failing both times is a regression. Failing once and then passing is **flaky**: it doesn't block, but goes to the Decisions tab as a `qa` decision with both runs' details, and three flaky runs of one scenario in a week make it a problem the QA lane is given a story to fix. Retrying until it passes is never the rule.

Every run is recorded in `.claude/state/scenarios.jsonl`.

**Acceptance**

- Given BOOK-3.my-bookings expected `pass` and failing twice, then the verdict is regression.
- Given BOOK-5.reschedule expected `known_broken` and passing, then the verdict is newly fixed, naming the id to promote.
- Given BOOK-4's only story still in progress and BOOK-4.cancel failing on another branch, then the verdict is not built yet, and it doesn't block.
- Given a scenario failing, then passing on the second run, then the verdict is flaky and the Decisions tab has a `qa` card.
- Given `run` reporting a scenario as error, then the verdict is proved nothing.

### SCN-4 The gate before merge

When the config has `gate`, every merge code-kit makes (`merge`, `queue merge`, and the review's **Merge**) runs the gate after `verify` passes. It starts the gate target from the branch's worktree, waits for `url` to answer, and runs the scenarios that:

- cite a requirement of the branch's story, or one `impact` (FEAT-2) reaches from the branch's changes, and
- carry one of `gate.tags`.

The merge is refused, and the branch goes back to its lane, on a regression, on a newly fixed scenario the branch didn't promote, on a proved-nothing error, or on a scenario of the branch's own story's requirements that didn't pass. That last one is the story's acceptance: the scenarios the QA lane wrote from the spec pass on the branch that delivers it. A fix story (REG-1) whose requirement has a `known_broken` scenario must promote it.

The target is stopped after the run, whatever happened. A target that doesn't answer within `readySeconds` refuses the merge, saying the scenarios couldn't run; it never lets it through. The merge commit records the target, how many scenarios held, and each verdict that wasn't holds. Runs against one target are one at a time.

Without `gate`, nothing runs before merge. The review says "No scenario gate: scenarios run after deploy only", so a pass is never read as more than it is.

**Acceptance**

- Given web/st-12 (BOOK-2) and BOOK-3.my-bookings, which `impact` reaches, regressing on the local target, then the merge is refused, the branch is sent back with the scenario, its step and its detail, and main is unchanged.
- Given web/st-12's own BOOK-2.create failing, then the merge is refused: the story's scenarios must pass.
- Given a fix branch whose requirement's BOOK-5.reschedule passes but is still `known_broken`, then the merge is refused, naming the id to promote.
- Given `gate.target` naming a `base` target, then the config is invalid, saying a target that doesn't run the branch can't gate it.
- Given the gate target not answering within its `readySeconds`, then the merge is refused, saying the scenarios couldn't run.
- Given no `gate`, then the review says scenarios run after deploy only.

### SCN-5 After deploy, and in health

`code-kit scenarios run --target <name> [--ids …] [--commit sha]` runs the suite, or some of it, against any target, and records it. On a `base` target, `--commit` names the commit deployed there. The project's deploy pipeline runs it after each deploy, and on a schedule; init writes those steps when a `base` target exists.

A regression or a proved-nothing error on a `base` target makes the base red, as a failing health run does (REG-4): `next` gives `fix-main`, merges wait, and the band names the scenario and the merges since its last pass. A newly fixed scenario there gives the QA lane a story to promote it. `health` runs the full suite on the gate target, when there is one.

**Acceptance**

- Given `scenarios run --target staging --commit abc1234` with BOOK-3.my-bookings regressing, then the base is red, `next` gives `fix-main` naming BOOK-3.my-bookings and the merges since it last passed on staging.
- Given the next run on staging passing it, then the hold lifts.
- Given BOOK-5.reschedule newly fixed on staging, then the plan gains a `qa` story to promote it.

### SCN-6 Scenarios aren't weakened without the person

`list` is run on the base and on the branch, and the difference is judged by id, so moving or renaming a file is never flagged. It flags:

- a scenario that's gone;
- `pass` demoted to `known_broken`;
- a scenario moved to another requirement;
- lower `strength`;
- tags changed so the gate no longer runs it.

Each is a weakened test under REG-2: the commit hook refuses it unless the person's `tests` approval is in force, holds it in the band with what was weakened, and `verify` flags any the approval log doesn't show approved. Adding scenarios, adding assertions and promoting to `pass` are never flagged.

**Acceptance**

- Given a branch deleting BOOK-3.my-bookings, then the commit is refused and held for the person's `tests` approval, and `verify` names BOOK-3.my-bookings as gone.
- Given BOOK-3.my-bookings's strength going from 6 to 4, then it's flagged as fewer assertions.
- Given BOOK-3.my-bookings moved to a new folder with the same id, then nothing is flagged.
- Given BOOK-3.my-bookings's tags changed from `read_only` to `llm`, with `gate.tags` `[read_only, writes]`, then it's flagged: the gate no longer runs it.

### SCN-7 When one fails, someone says why

A regression at the gate or after deploy starts the QA lane's `qa-check` agent (check mode, read-only), as the reviewer agent is started. It reads the scenario, the run's detail, and the diff since the scenario last held, and writes which change most likely broke it, citing the files and lines. That goes into the send-back, or into `fix-main`'s story, beside the scenario's own detail. It never edits code or scenarios.

**Acceptance**

- Given BOOK-3.my-bookings regressing on web/st-12, then the send-back carries `qa-check`'s explanation naming the changed files it points to.
- Given `qa-check` writing a scenario file, then it's refused: check mode only reads.

### SCN-8 A project without a suite is given a spec for one

A project whose specs have requirements, but whose config has no `scenarios`, has nothing to run them with. Before the first "Scenarios for <spec>" story, `next` gives `scenario-runner`: spec-design writes `docs/specs/NN-scenario-runner.md` from `templates/scenario-runner.md`, with the person, in the project's own stack. It's then planned and built like any spec, by the QA lane.

The template fixes what code-kit relies on, and leaves the rest to the project:

- **Fixed: the contract.** `list` and `run` print the JSON of SCN-1. `run` reads the ids on stdin and the target from `CODE_KIT_TARGET_URL`.
- **Fixed: the safety rules.** Credentials only come from the environment or CI's secrets, never from the repository or a scenario file. Every scenario carries one safety tag, and only side-effect-free ones (reads, and writes the run cleans up) run unless a run opts in to the others, such as real email, payments or model calls. A target outside the config's hosts is refused. Cleanup always runs, even after a failure, and deletes only what the run created, pinned to a value captured in that run. An offline mode, which `list` uses, reads and checks every scenario with no network.
- **Fixed: the outcomes.** Each scenario passes, fails, errors (it couldn't set up or clean up) or is skipped with a reason, and each failure names its step and what was expected and seen.
- **The project's: everything else.** The scenario format, the language and test framework, what scenarios call (an HTTP API, a browser, a command line), and how test identities and data are set up. Questions for each of these are in the template, for spec-design to ask.

The runner's engine is a protected path (approval `tests`) in the config init drafts, since every scenario depends on it; the scenario files stay the QA lane's. Its own tests run as an ordinary check. The runner spec's last story writes `scenarios` into the config, so the contract is in place once it merges, and SCN-1 to SCN-7 apply from then.

**Acceptance**

- Given a ready spec and no `scenarios` in the config, then `next` gives `scenario-runner` before any "Scenarios for <spec>" story.
- Given spec-design run for it, then it writes a runner spec from the template, asking the format, the stack, what the scenarios call and how identities are set up, with the contract and safety rules as requirements.
- Given the runner's last story merged, then the config has `scenarios`, `list` reads, and `next` dispatches "Scenarios for <spec>".
- Given a project with `scenarios` already set, then `next` never gives `scenario-runner`.

### REG-5 An older setup is told what's new

The setup version goes to 4. A project on an older setup gets ONB-5's attention line naming what re-running init adds:

- the feature map;
- the app's start, seed and environment for check mode;
- the `qa-check` agent;
- the test globs;
- the scenario suite: if the project has one, its `scenarios` config, the scenario skill drafted from the project's own guide, and the after-deploy steps for a `base` target. init asks where scenarios may run, and whether one of those places runs a branch, for the gate.

Re-running init drafts them, shows the person the difference, and sets `setup` to 4. Until then, REG-1 to REG-4 still apply, and check mode and the scenario gate are skipped, saying what's missing.

**Acceptance**

- Given `"setup": 3`, then `next` names the feature map and check mode as what init now adds.
- Given `"setup": 4` and no `app.start`, then the review says check mode can't run without `app.start`.

## Delivery order

1. REG-1 and REG-2: the most return for the least, and with no new setup.
2. FEAT-1 and FEAT-2: the feature map and `impact`.
3. REG-3: checks that reach importers.
4. SCN-1, SCN-3, SCN-6 and SCN-8: the contract, the verdicts, the weakening rules, and the spec for a project with no suite to build one.
5. SCN-5 with REG-4: scenarios after deploy and main kept green. A project whose only target is a shared staging is fully served from here.
6. SCN-2, SCN-4 and SCN-7: the QA lane writing them first, the gate for a branch target, and the explanation.
7. QA-1 to QA-4, then FEAT-3.
8. REG-5.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
