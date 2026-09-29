---
name: review
description: The lead's review of a lane's finished branch before it merges. Runs code-kit verify on the branch, checks the work against its story's requirements and acceptance criteria, the spec-check report, the approval log and the tests, and ends with merge or send back. Use when a lane agent or person finishes a story, when the person asks to review a branch or pull request, or runs /code-kit:review [branch, story ID or PR number].
---

# Review a lane's branch

Only the lead reviews. The argument names the branch (`web/st-4`), the story (`ST-4`, whose branch is `<lane>/st-4`) or a pull request number. With none, review every story `code-kit status` shows in review.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs"`. `<base>` is the branch the lanes started from: the lead's branch, or the first protected branch.

## 1. Find the work

- **The branch and its story.** `status --json` lists each story with its branch, its commits ahead of the base, and its worktree, if one is checked out. For a pull request, `gh pr view <n> --json headRefName,baseRefName` gives both.
- **Where to run things.** Use the branch's worktree if it has one. Otherwise check it out in a throwaway worktree: `git worktree add .claude/worktrees/review-st-<n> <branch>`, and remove it when you're done.
- **The spec-check report** is in that worktree, in `.claude/state/spec-check/<branch with / as _>.md`. The state folder isn't committed, so a branch pushed from elsewhere may not have one. Say so, and review against the specs directly.

## 2. Run the rules

From the branch's worktree:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" verify --base <base>
```

`verify` holds a `<lane>/…` branch to that lane's paths, and checks:

- that every protected change is in the approval log, which is append-only;
- new layer violations, and a baseline that grew;
- screens without an approved design;
- committed secrets;
- the project's checks for the changed files.

Any problem it reports means the branch goes back. Don't fix a lane's code yourself; the lead doesn't write lane paths.

## 3. Check the work against the story

Read the story, every requirement it cites, and the full diff (`git diff <base>...<branch>`). Read each changed file in full where the diff alone doesn't show the behaviour. Then, for each requirement:

| Requirement | Acceptance criterion | Built (where) | Test (which) | Verdict |
| ----------- | -------------------- | ------------- | ------------ | ------- |

- **Built end to end:** the behaviour works from the entry point to storage and back, including the errors, permissions and states the spec lists. A mock, stub, hard-coded response, placeholder screen, `TODO` or "coming soon" in shipped code fails the requirement.
- **Tested:** a test proves each acceptance criterion and names the requirement ID. The test would fail if the behaviour were broken; one that asserts nothing, or only asserts a mock, doesn't count.
- **The spec-check report matches:** its table has no row still `missing` or `conflicts` without an answer, and its questions were answered, not guessed.
- **Only the story:** changes beyond the story (refactors elsewhere, other stories' requirements, new dependencies) are called out. They may be fine, but they're the person's call.
- **Contracts respected:** the code uses the contracts as written. A lane that needed a contract change should have asked, not worked around it.

## 4. Verdict

Report the table, `verify`'s result and one of:

- **Merge.** Everything passes. The lead merges the branch into its own branch (`git merge --no-ff <branch>`), sets the story's `**Status:**` to `done` in the plan, and commits. `main` and the other protected branches are merged by a person, through a pull request, after `verify` passes in CI. When the branch is merged, remove its worktree.
- **Send back.** List each problem, where it is, and what "fixed" looks like. Send the list to the same lane agent if it's still running (SendMessage), or dispatch the story again with the list added to the brief. Set the story's status to `in progress`.
- **Ask the person.** When the right answer is a product or scope decision (the spec is silent, or the lane found a real conflict), put the question to the person with your recommendation. Don't merge around it.

Keep the report short: the verdict first, then the table, then the problems.
