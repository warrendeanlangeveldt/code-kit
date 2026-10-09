# 06. Hold and ask

**Status:** draft
**Outcome:** When an agent's call needs the person's approval and the person is there, the call waits while the band asks, and goes ahead on Approve, instead of stopping the agent.
**Actors:** lane agents and the lead (their calls are held); the person (answers); the hooks (still judge every call)
**Depends on:** 02-waiting-band, 03-approve-review-merge, 12-settings

## In scope

- Holding three kinds of call that a person's approval would allow: installing a new package, writing or committing a protected file, and a lane editing the kit (`.claude/`).
- Asking in the band, with Approve and Refuse on keys, and the reason prefilled as in ACT-1.
- Letting the same call go through once approved; refusing it as today after the hold time (default 2 minutes) or on Refuse.

## Later

- Holding Context Graph's person acts (ratify with a commit, drop) proposed by an agent, with Context Graph's harness.

## Data

| Entity    | Field  | Type      | Required | Rules                                                            |
| --------- | ------ | --------- | -------- | ---------------------------------------------------------------- |
| Held call | id     | string    | yes      | The tool call's id                                               |
| Held call | agent  | string    | yes      | The agent or lane whose call it is                               |
| Held call | names  | list      | yes      | The approvals that would allow it (`dep-dayjs`, `design`, `kit`) |
| Held call | what   | string    | yes      | The command or file                                              |
| Held call | since  | timestamp | yes      |                                                                  |
| Held call | answer | enum      | no       | `approved`, `refused`, `timed out`                               |

## States

`held` → `approved` (the person approves; the approval is written and the call runs) | `refused` (the person refuses, or the hold time passes; the refusal goes through as today, recorded as a request).

## Requirements

### HOLD-1 Only what a person's approval would allow

A call is held only when code-kit would refuse it for want of an approval the person can give: a new package (`dep-…`), a protected path (its approval), or a lane's kit edit (`kit`). Everything else is judged by the hooks exactly as today: a rule nobody may break (force-push, another lane's files, the approval log) is refused at once.

**Acceptance**

- Given a lane running `npm install dayjs` without an approval, when the person is present, then the call is held and the band asks.
- Given a lane running `git push --force`, then it's refused at once, unheld.

### HOLD-2 Asked in the band

A held call shows in the band as "web wants to install dayjs · 1 Approve · 2 Refuse · 1:53", with a countdown. Approve opens ACT-1's confirmation with the reason prefilled; Enter confirms. Several held calls show as a count with the oldest first.

**Acceptance**

- Given a held install, when the band draws, then it names the agent, the package and the time left, with Approve on 1.

### HOLD-3 The same call goes through

On Approve, the approval is written exactly as `code-kit approve … --via pane` writes it, and the held call continues and runs; the agent sees its normal result, not a refusal.

- **Errors:** if writing the approval fails, the call is refused with the reason, and the band says nothing was approved.

**Acceptance**

- Given a held `npm install dayjs`, when the person approves, then the install runs, the agent continues, and no change request is written.

### HOLD-4 Refused after the hold time

With no answer within the hold time (12; default 2 minutes), or on Refuse, the call is refused with the hooks' own message, and the request is recorded (BAND-1) for the band to keep showing.

**Acceptance**

- Given a held call and no answer for 2 minutes, then the agent receives code-kit's refusal and the band shows the open request.

### HOLD-5 Delegated rules first

With autonomy `autonomous` and `approvals.delegate` covering the approval, the lead's delegated rules decide first, without asking: within them, approved and logged as delegated; outside them, held and asked.

**Acceptance**

- Given `approvals.delegate.dependencies` and a well-used MIT package, when a lane installs it, then it's approved within the delegated rules and runs, without asking.

### HOLD-6 Not held where nobody can answer

In a session with no surface to ask on (`claude -p`, the SDK) or with hold switched off (12), calls are refused as today.

## Quality targets

- A call that isn't held is delayed by under 50 ms.

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
