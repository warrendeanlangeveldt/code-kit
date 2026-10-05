# 03. Approve, review and merge

**Status:** draft
**Outcome:** The person approves, reviews and merges from the pane or band, as their own acts, recorded as such.
**Actors:** the person; the lead (runs reviews it's asked for)
**Depends on:** 02-waiting-band; code-kit's `approve`, `verify` and `merge`

## Requirements

### ACT-1 Approve with a confirmation

Approve… on a request opens a confirmation that shows:

- the approval names;
- the lane, or "any agent";
- that it lasts 60 minutes;
- a reason prefilled from the request ("Approve dayjs for the web lane: npm install dayjs").

The person keeps the reason or types their own, and confirms or cancels. Confirming grants exactly those approvals, for that lane. Each is marked "(approved in the code-kit pane)" after the reason, which the approval log keeps when the change is committed.

- **Errors:** an empty reason isn't accepted. If the grant fails, the band says why and nothing is approved.

**Acceptance**

- Given an open request for `dep-dayjs` for the web lane, when the person confirms with the prefilled reason, then `.claude/approvals/web/dep-dayjs` holds that reason and the pane mark, and the web lane's next `npm install dayjs` runs.
- Given the confirmation, when the person cancels, then nothing is written.

### ACT-2 Only the person

The pane's approvals happen only on the person's press. Nothing an agent does can trigger one: no tool, command or message from an agent reaches the mod's approve action.

**Acceptance**

- Given a lane agent, when it runs `code-kit approve … --via pane`, then the hooks refuse it as they refuse any agent approval.

### ACT-3 Review

Review on a story in review asks the lead to run the review skill on its branch, as a prompt from the mod, and the pane shows the story as being reviewed until the lead reports.

**Acceptance**

- Given ST-4 in review, when the person presses Review, then the lead receives a request to run `/code-kit:review web/st-4`.

### ACT-4 Merge, as the person

Merge on a reviewed story asks for confirmation, then runs `code-kit verify` on the branch, checks included, and merges it into the base only if verify passes and it merges cleanly. The merge commit says it was merged by the person from the pane after verify. If verify fails, nothing merges and the pane shows the problems.

**Acceptance**

- Given `web/st-4` passes verify, when the person confirms Merge, then `main` gains a merge commit for it, and ST-4 leaves the band.
- Given a branch that fails verify, when the person confirms Merge, then `main` is unchanged and the problems are shown.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
