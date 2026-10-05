# 02. Waiting band

**Status:** draft
**Outcome:** Whenever something waits for the person, a band above the prompt says what, and offers the action; otherwise there's nothing.
**Actors:** the person; the hooks (record what was refused for want of an approval)
**Depends on:** 03-approve-review-merge

## In scope

- Approval requests: what the hooks refused for want of a person's approval.
- Branches waiting for review.
- A finish check that keeps failing.

## Data

| Entity  | Field | Type      | Rules                                                         |
| ------- | ----- | --------- | ------------------------------------------------------------- |
| Request | at    | timestamp |                                                               |
| Request | actor | string    | The agent or lane refused                                     |
| Request | lane  | string    | When a lane was refused                                       |
| Request | names | list      | The approvals that would allow it, e.g. `dep-dayjs`, `design` |
| Request | what  | string    | The refused command or file, up to 200 characters             |
| Request | why   | string    | The rule's reason from the refusal                            |

Requests are written by the hooks to `.claude/state/requests.jsonl` in the main checkout, one per refusal that a person's approval would have allowed. A request is open until an approval for all its names is in force, or 60 minutes have passed.

## Requirements

### BAND-1 Requests are recorded

Every refusal that a person's approval would allow (a new dependency, a protected path, the kit) records a request. Recording never changes the refusal.

**Acceptance**

- Given a lane refused for `npm install dayjs`, when the refusal happens, then `requests.jsonl` gains one request with the lane, `dep-dayjs`, the command and the reason.
- Given the same refusal three times in a minute, when they happen, then there's one open request, not three.

### BAND-2 Shown only when something waits

The band shows one line per kind of thing waiting, with a count, and is absent when nothing waits:

- open requests ("2 approvals waiting");
- stories in review ("ST-4 ready for review");
- a finish check that failed on the last stop ("Finish check failing: tests").

Each line has its action: Approve…, Review, Merge, or Lanes.

**Acceptance**

- Given no open requests, nothing in review and no failing finish check, when the prompt draws, then there's no band.
- Given one open request, when the prompt draws, then the band reads "1 approval waiting" with an Approve… button.

### BAND-3 Clears itself

A line leaves the band as soon as its cause goes: the approval is given, the story is merged or sent back, the finish check passes.

**Acceptance**

- Given an open request for `dep-dayjs` for the web lane, when the person approves it, then the band's line goes within 2 seconds.

### BAND-4 Keyboard

Every action on the band has a digit hotkey, so the person can act without the mouse.

**Acceptance**

- Given the band shows Approve… as 1, when the person types 1 in an empty prompt, then the approval confirmation opens.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
