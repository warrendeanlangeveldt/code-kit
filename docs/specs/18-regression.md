# 18. Regression

**Status:** specified
**Outcome:** A change that fixes one thing doesn't quietly break another. A fix comes with a test that proves its bug. Tests can't be weakened to get to green. The tests of the code a change reaches run with it. The features a change could affect are named, with the lineage that links them, and the QA lane walks them in a real browser. Main stays green, and while it isn't, no new work starts.
**Actors:** the person; the lead (review, the loop, the merge queue); lane agents; the QA lane, in build mode (`test-engineer`) and check mode (`qa-check`)
**Depends on:** 03-approve-review-merge, 07-reviewer, 09-merge-queue, 10-traceability, 14-mission-and-maps, 17-onboarding

Found by running code-kit on a codebase under continuous development. Agents fixed issues, and their checks passed, yet other things broke. A fix in shared code ran the shared tests but not the tests of the code importing it. The review compared the branch with its own story and nothing else. A fix with no test could come back, and nothing stopped an agent from deleting or skipping a test to get to green. Each pull request was checked on its own, but nobody checked that main still worked as a whole, or that the features people use still worked.

## In scope

- Fixes that prove their bug, and tests that can't be weakened without the person (REG-1, REG-2).
- Checks that reach the code depending on a change (REG-3).
- Main kept green, with new work stopped while it isn't (REG-4).
- A feature map, the lineage from a change up to the features it could affect, and a Features tab (FEAT-1 to FEAT-3).
- The QA lane's check mode: the affected features walked in a real browser, through an adapter (QA-1 to QA-4).
- An older setup told what's new (REG-5).

## Out of scope

- Visual diffs of screenshots, and performance or load testing.
- Running the app against anything but a local, throwaway environment. Check mode never touches a shared or production system.
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

| Key                  | Default                                                                                             | What it is                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs.features`      | `docs/features.md`                                                                                  | The feature map                                                                                                                            |
| `tests[]`            | `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/test/**`, `**/tests/**`, `e2e/**`, `**/e2e/**` | Which files are tests                                                                                                                      |
| `regression.prepare` | none                                                                                                | Run once in a temporary worktree before its checks, such as `npm ci`                                                                       |
| `app.start`          | none                                                                                                | Starts the app. It's given `PORT`, a free port, and `app.env`                                                                              |
| `app.url`            | `http://localhost:{port}`                                                                           | Where the app answers once it's up. Only `localhost`, `127.0.0.1`, `[::1]` or a `.localhost` or `.test` name is accepted                   |
| `app.seed`           | none                                                                                                | Puts the scenarios' starting data in place, run before each feature                                                                        |
| `app.env`            | `{}`                                                                                                | Environment for `start` and `seed`: a throwaway database, test keys. Values that look like live or production keys make the config invalid |
| `app.readySeconds`   | 90                                                                                                  | How long the app has to answer at `app.url`                                                                                                |

### State

- `.claude/state/health.json`: the latest full run on the base. It records the commit, the time, and the result of each check and feature, as passed, failed or couldn't run, with the first failure's output.
- `.claude/state/qa.jsonl`: one line per walk. Each line has the branch or base and commit, the feature, the scenario, the result (passed, failed, or couldn't run), the step it failed at, what was expected, what was seen, and its screenshots.
- `.claude/state/qa/<run>/`: the screenshots of a walk. These are only ever written by check mode, and nothing else in the repository is.

## Requirements

### REG-1 A fix proves its bug

A story that fixes something says so in the plan, with an optional fifth line: `**Fixes:** <what was broken, and where it was seen>`. A branch named `<lane>/fix-…` counts too. `verify` on such a branch takes the test files it added or changed. It runs them against the branch's code with every change outside the tests taken back to the base. This happens in a temporary worktree, after `regression.prepare`, using the checks whose `files` match those tests. The tests must fail there and pass on the branch. A fix that adds or changes no test, or whose tests also pass without the fix, has a problem under `regression`: its tests don't prove the bug, so it can come back. The review sends it back like a failing test. A test story the QA lane is given to lock in a failure (QA-3) is held to the same rule.

**Acceptance**

- Given a plan story with `**Fixes:** double booking`, whose branch changes `src/booking.ts` and adds `src/booking.test.ts`, and that test fails with the base's `src/booking.ts`, then `verify` reports no regression problem.
- Given the same, but the test passes with the base's `src/booking.ts`, then `verify` says the fix's tests pass without the fix, so they don't prove the bug, and names the test file.
- Given a fix branch that changes no test file, then `verify` says the fix comes with no test that proves it.
- Given a story with no `**Fixes:**` line on a branch not named `fix-…`, then `verify` doesn't run the fix check.

### REG-2 Tests aren't weakened without the person

`verify` compares each test file a branch changes with the base. It flags each of these:

- a deleted test file;
- an added skip or focus marker (`.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `test.fixme(`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled`, and others an adapter adds);
- fewer test cases in a file than on the base;
- fewer assertions in a test that still exists;
- a changed snapshot (`__snapshots__/**`, `*.snap`).

Each is a problem under `tests` unless the approval log records the person's `tests` approval for that file on this branch. The lead can't delegate it, and an agent can't give it. The Decisions tab shows each one as a `tests` decision, with the lines removed, the story, and the agent's reason, if it gave one. **Allow** records the approval, and **Send back** returns the branch with the finding. A test moved or renamed with the same cases isn't flagged.

**Acceptance**

- Given a branch that adds `it.skip(` to `src/booking.test.ts`, then `verify` names the file and the skipped test, and says a weakened test needs the person's `tests` approval.
- Given the same, with the person's `tests` approval logged for that file, then `verify` passes it.
- Given a branch that moves `src/a.test.ts` to `src/a/a.test.ts` with the same cases, then nothing is flagged.
- Given `code-kit approve tests --delegated`, then it's refused: weakening a test is the person's to allow.

### REG-3 Checks reach the code that depends on a change

A check runs when a file it matches changed, and also when a file it matches imports a changed file, directly or through others. The import graph is the one `graph` and the layers already use. With `each`, the importing files' folders run too. The stop hook and `verify` both reach this far. A check that fails only because of the reach says which import led to it. `checks[].reach: false` keeps a check to the changed files alone.

**Acceptance**

- Given `packages/shared/src/date.ts` changed, `apps/web/src/booking.ts` importing it, and a check on `apps/web/**`, then that check runs. Its failure says `apps/web/src/booking.ts` imports `packages/shared/src/date.ts`.
- Given the same, with `"reach": false` on that check, then it doesn't run.
- Given a change no other file imports, then the same checks run as before.

### REG-4 Main stays green

`code-kit health [--json]` runs every check on the base's head in full, not only for changed files. It also runs the QA lane's scripted suites, and it records the result in `.claude/state/health.json`. When the base's head has no health record, after a merge or when the loop starts, `next` gives `health`, and the loop prompts the lead to run it.

When the base is red:

- `next` gives `fix-main` before any dispatch, design or lead story.
- Work in flight carries on through review, but merges wait, except for a branch whose story fixes the failure.
- The band reads "main is red since web/st-12 merged: booking tests fail". It names the merges since the last green run, from the journal, with **Why**.

The lead plans a fix story in the lane that owns the failing code. That story is held to REG-1. If the person would rather undo the merge, that's their act: **Revert** in the band runs `code-kit revert <merge>`, which the lead may do only with the person's approval. When the next health run passes, the hold lifts.

**Acceptance**

- Given a base head with no health record, then `next` gives `health`.
- Given a red health record for the base's head and a ready story, then `next` gives `fix-main`, naming the failing check and the merges since the last green run, and doesn't dispatch the story.
- Given the same and a branch at the head of the merge queue that doesn't fix it, then its merge waits, saying main is red.
- Given a later green record, then `next` dispatches the ready story.

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

### REG-5 An older setup is told what's new

The setup version goes to 4. A project on an older setup gets ONB-5's attention line naming what re-running init adds:

- the feature map;
- the app's start, seed and environment for check mode;
- the `qa-check` agent;
- the test globs.

Re-running init drafts them, shows the person the difference, and sets `setup` to 4. Until then, REG-1 to REG-4 still apply, and check mode is skipped, saying what's missing.

**Acceptance**

- Given `"setup": 3`, then `next` names the feature map and check mode as what init now adds.
- Given `"setup": 4` and no `app.start`, then the review says check mode can't run without `app.start`.

## Delivery order

1. REG-1 and REG-2: the most return for the least, and with no new setup.
2. FEAT-1 and FEAT-2: the feature map and `impact`.
3. REG-3: checks that reach importers.
4. QA-1 to QA-4, then FEAT-3.
5. REG-4 and REG-5.

## Open questions

| Question                                                                                                                                                        | Owner         | Blocks |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| Does a fix's test that fails on the base only because it can't compile there (it calls a function the fix adds) prove the bug, or must it fail on an assertion? | Product owner | REG-1  |
| Should `health` also run in CI on every push to main, from a workflow init writes, or only in the loop?                                                         | Product owner | REG-4  |
| Should **Revert** be in the band at all, or should a red main always be fixed forward?                                                                          | Product owner | REG-4  |
