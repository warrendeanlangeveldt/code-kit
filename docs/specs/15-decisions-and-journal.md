# 15. Decisions and the journal

The person owns what is built and the rules it's built by; the lead owns delivering it. Only a real decision reaches the person, and when one does it arrives with its lineage: what they asked for, the story and requirements it belongs to, what the agent was doing, what was already settled, why the lead couldn't settle it, and what each answer does. The Journal tab tells the whole build in plain sentences, from the request to now.

## Who owns what

| The person                                                | The lead                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| What to build (the brief, its decisions)                  | Splitting it into stories and handing them out             |
| The rules (`.claude/code-kit.json`, the delegated limits) | Reviewing each lane's work against its requirements        |
| Anything outside the limits they set                      | Sending work back, merging it, approving within the limits |
| How hands-off the loop is                                 | Keeping the build moving between prompts                   |

## Requirements

### SETUP-1 No first merge for the person

Setting up code-kit commits the approved rules straight onto the base branch: the lead may commit on a protected branch only while `.claude/code-kit.json` isn't committed there yet, and only a commit, never a merge, cherry-pick, rebase, revert or am. From then on the committed rules decide who merges. Under autonomy, setup drafts `approvals.delegate` with merges and dependencies delegated, for the person to adjust before approving.

**Acceptance**

- Given a repository whose main has no `.claude/code-kit.json`, when the lead commits on main, then the commit is allowed; when it merges into main, then it's refused.
- Given main with the rules committed, when the lead commits on main, then it's refused.

### DECIDE-1 Lane work is the lead's while the loop runs

While the loop is on (autonomous or propose), a lane's finished work never waits in the band for the person: reviewing and merging it is the lead's. With the loop off the person runs the build, and the band offers Review and Merge as before.

**Acceptance**

- Given a story in review and the loop on, then the band has no Review or Merge.
- Given the same with autonomy off, then the band offers both.

### DECIDE-2 Each decision with its lineage

Each band line that needs the person (a held call, an approval waiting, a stalled agent, the loop's first or repeated step, a merge only they may make, a review with the loop off) says which story it's for: "for ST-4 Booking form (BOOK-1)". As a card it carries:

- **You asked for**: the brief's request and the milestone being built;
- **Story** and **Requirements**: the story, its branch, and each requirement with its title;
- **Happening**: the call that was held, the request's what, or the loop's next step;
- **Already settled**: the journal's events for that story and the approvals in force for its lane, the latest five;
- **Why it is yours**: the rule that refused the call, and why the lead couldn't approve it itself: nothing of that kind delegated, or each delegated limit it missed ("dep-dayjs: fewer than 1000 weekly downloads");
- **Your options**, each with what it does.

Usage, the plan's pause, finish checks and "all done" are notes: labelled "note", never "you", and never a decision.

**Acceptance**

- Given the web lane's `npm install dayjs` held, for ST-4 (BOOK-1), then the band's line reads "for ST-4 Booking form (BOOK-1)", and its card shows the story with its branch, BOOK-1's title, the command, the dispatch from the journal, the refusal's rule with "You haven't let the lead approve these itself.", and Approve with "The held call runs now, and the agent carries on."
- Given only a usage line, then the band says "note", not "you", and offers no Why.

### DECIDE-3 The Decisions tab

`d` in the band ("Why, and what each choice does") opens the Lanes pane on the Decisions tab (2), on the first decision. It lists every decision when there's more than one, shows the selected one as a card, and its options answer exactly as the band's buttons do. With none, it says nothing needs the person.

**Acceptance**

- Given a held call, when the person presses `d` then Refuse on the card, then the call is refused and the band no longer offers Why.

### JOURNAL-1 The build's lineage

`code-kit journal [--json]` reads, from git and the project's records, oldest first: what the person asked for (the brief's title and problem), each decision in the brief's decision log with its reason, the specification (requirements, stories, milestones), the rules switched on, each story handed out (to which lane, or the lead itself), sent back (with the reason) and merged, each approval with who gave it (the person in their own words, or the lead within the limits), and each milestone finished. The request, its decisions, the spec and the switch-on come before the first piece of work, whatever their commit times. The Journal tab (3) draws these with the loop's steps this session and the person's pause and resume, by day, the person's own in yellow, the latest 60.

**Acceptance**

- Given a brief "Groomers lose bookings on paper" whose decision log records "Web only" because groomers use laptops, and a plan, then `code-kit journal --json` opens with the request, then "Decided: Web only, because groomers use laptops.", and includes the specification.
- Given an approval logged by the lead within the delegated rules, then the journal says the lead approved it within the limits the person set; given one from the pane, that the person approved it, in their words.
- Given those events, when the person opens the Journal tab, then they show by day, from the request to the merge.
