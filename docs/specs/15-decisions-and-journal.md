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

### SETUP-2 A project set up before SETUP-1

A project whose base has no rules committed (set up before setup committed them there) doesn't wait on the person either. With a branch in the merge queue, `code-kit next` gives the lead the `rules` step, and `code-kit queue rules` commits the rules as committed on the lead's branch (the ones the person approved, with their baseline) onto the base, without switching branches or touching uncommitted work. Only the lead may run it, only while the base has no rules, and not while the base is checked out somewhere. From then on the queue merges under the base's rules. Stories waiting on branches in the queue are reported as waiting for the merge, not as a broken plan.

**Acceptance**

- Given the rules committed on lead/st-1 but not on main, and lead/st-1 queued, then `next` gives the lead `rules` for main; a lane running `code-kit queue rules` is refused; the lead's run commits only `.claude/code-kit.json` onto main, leaves the lead on its branch with its uncommitted files, and says so; run again, it says main already has them; then `next` gives `merge`, and the lead's delegated merge goes through.
- Given the same under autonomy, then the band doesn't ask the person to merge; with the loop off, it offers Merge, and the card says `code-kit queue rules` puts the rules onto main.

### DECIDE-1 Lane work is the lead's while the loop runs

While the loop is on (autonomous or propose), a lane's finished work never waits in the band for the person: reviewing and merging it is the lead's. With the loop off the person runs the build, and the band offers Review and Merge as before.

**Acceptance**

- Given a story in review and the loop on, then the band has no Review or Merge.
- Given the same with autonomy off, then the band offers both.

### DECIDE-2 Each decision with its lineage

Each band line that needs the person (a held call, an approval waiting, a stalled agent, the loop's first or repeated step, a merge only they may make, a review with the loop off, the lead's questions and the brief's, a call Claude Code refused, a report to send) says which story it's for: "for ST-4 Booking form (BOOK-1)". As a card it carries:

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

### DECIDE-4 A choice is asked in Claude Code's own dialog

A decision settled by choosing (the loop's first offer of how hands-off it is, a step under `propose`, a step still next after two prompts or one the lead didn't take, a lane stalled past its restarts, a stale claim of the person's, and a question from the lead with two to four answers) is asked in Claude Code's own question dialog, while the lead is idle and nothing is typed in the prompt, one at a time. Each answer acts as its button does; words typed under Other answer a question from the lead as the person's own. A decision with one choice offers Not now beside it. Each is asked once a session: dismissed, it stays in the band and the Decisions tab. What needs a reason or words typed (an approval, a send-back, a setting, a question with no answers offered) stays in the pane, and a turn the person stopped, or a reply with no question in it, opens no dialog. Nothing is asked in a session another one runs the loop for (LOOP-10), nor where nobody can be asked (`claude -p`).

**Acceptance**

- Given the loop's first offer, when the dialog is answered Keep going, then autonomy is recorded as the person's choice and the step is taken.
- Given the lead's question with two answers, when the person picks one, or types their own words, then it's recorded and sent to the lead; dismissed, it waits in the band and isn't asked again.
- Given an approval waiting, then no dialog opens for it.

### ASK-1 The lead asks through code-kit

What the lead can't settle itself and only the person can (a product choice, an account or key only they can create, wording or a design only they can sign off, whether something stays private) is asked with `code-kit ask "<question>" [--story ST-n] [--blocks] [--why "…"] [--option "Label: what it does"]…`, so it waits in their Decisions tab instead of scrolling away in the chat. The same open question is asked once. Only the lead asks: a lane writes the question for the lead. `code-kit ask` lists them; `ask withdraw <id> --reason …` takes back one settled another way. They're kept in `.claude/state/questions.jsonl` in the main checkout.

**Acceptance**

- Given a lane running `code-kit ask`, then it's refused, told to write the question for the lead.
- Given the lead asking "Which weather provider?" with two options, each with what it does, then `ask --json` lists it open with both.

### ASK-2 The person answers

The band says "The lead asks: …" (or how many), with Answer…, which opens the question as a card: why it's theirs, its story, and each of the lead's options with what it does, plus Something else… for their own words. An option, or their words, is recorded (`ask answer <id> … --via pane`, which the hooks refuse from every agent) and sent to the lead as a prompt: "The person answered Q-1 (…): …. Carry on with it." When the person answers in chat, the lead records it with `ask answer <id> "<their words>"`, marked as given in chat. An answered question can't be answered again.

**Acceptance**

- Given Q-1 with the option Bureau of Meteorology, when the person presses it, then the answer is recorded with `--via pane` and the lead is prompted with it.
- Given a question without options, when the person types their answer, then it's recorded and sent the same way; an empty answer isn't.

### ASK-3 Waiting on you

A question asked with `--blocks` holds its story: `code-kit status` reads it `waiting on you` (with the question), the stories that depend on it are blocked, and `next` neither dispatches nor reviews it; with nothing else to do it says the build waits on the person and on which question, and `attention` names it. The Lanes pane shows the lane `waiting on you`, its character waiting. Answered, the story carries on where it was.

**Acceptance**

- Given ST-1 with a blocking question and ST-2 depending on it, then ST-1 is `waiting on you`, ST-2 is `blocked`, and `next` gives `wait`; once answered, ST-1 is `ready` again.

### ASK-4 The brief's open questions

The brief's open questions (its `## Open questions` table) are the person's decisions too: `next --json` lists them as `brief`, the band says how many, and each is a card with Answer… (sent to the lead, which records it in the brief's decision log and takes it out of the open questions) and Later (it waits until the next session).

**Acceptance**

- Given a brief with two open questions, then the band says "2 open questions in your brief", Later puts the first off, and answering the second prompts the lead to record it in the brief.

### ASK-5 Ask about it before answering

A question can be terse ("Product domain (for the inbound email address…)"). Its card says what it is plainly: "An open question in your brief" or "A question from the lead", then the question itself, and for the brief's, who decides and what it holds up, from the brief table's Owner and Blocks columns. A question the brief leaves to the lead alone (Owner: Lead) isn't the person's, and doesn't show. What they asked for is the brief's first sentence, and approvals in force show only on approvals and held calls. The answer box has **Ask about it**, as the Approve pane does (ACT-5): answered there by a side call over the lead's conversation with the question's facts, never added to it.

**Acceptance**

- Given the brief's "Product domain" question, owned by the product owner and holding up CAP-1, then its card shows the question, Product owner and CAP-1 (M2), and no unrelated approval; asking "What is this for?" in the answer box answers there, and the lead gets no prompt.
- Given a brief question owned by Lead, then `next --json` doesn't list it.

### PERM-1 What Claude Code itself refused

A call Claude Code's own permission check refuses (its auto mode, a deny rule), which code-kit can't approve past, waits in the band for the person: "Claude Code refused the lead's `pnpm db:generate`", with Put it in the prompt (a shell command goes in the prompt after `!`, for them to run), Done it (the lead is told they ran it or allowed it) and Not now (the lead is told to carry on with other work and not get round it). The card says what Claude Code said. A refused call that later goes through, the same tool from the same agent (for a shell command, the same command), no longer waits: it was retried or allowed, and nothing is left for the person to do.

**Acceptance**

- Given Claude Code refusing the lead's `pnpm db:generate && pnpm db:migrate`, then the band names it; Put it in the prompt fills `! pnpm db:generate && pnpm db:migrate`; Done it prompts the lead and clears it.
- Given Claude Code refusing the lead's `pnpm db:generate` and `pnpm db:migrate`, when `pnpm db:generate` then runs, then only `pnpm db:migrate` still waits; another command running clears neither.

### REPORT-1 Agents draft reports for code-kit

With `harness.report.on` (off unless the person turns it on, in init or `/harness`), an agent that code-kit got in the way of (a refusal that shouldn't have happened, a crash, a pane showing the wrong thing) drafts a report: `code-kit report "<title>" --what … [--expected …] [--command …] [--refusal …] [--rule …]`. The same bug still waiting is drafted once. With it off, the agent is told to tell the person instead.

### REPORT-2 Only code-kit's facts

A draft holds code-kit's own facts: what happened, what was expected, the command and what code-kit said, the rule, code-kit's version, Node's and the system's, and a fingerprint. Every checkout's folder (as written and as the system resolves it) becomes `<project>`, the home folder `~`, and email addresses `<email>`, and each part is cut short. The person reads the exact text before anything is sent.

**Acceptance**

- Given a report naming a file in the project and an email address, then the draft has `<project>/…` and `<email>`, and neither the folder nor the address.

### REPORT-3 The person sends it, or not

A draft waits in the band ("A bug report for code-kit to send: …") and as a card showing its full text, with Send and Discard. Send (`code-kit report send <id>`, which the hooks refuse from every agent) files it with the person's own `gh` on code-kit's repository; one already filed with the same fingerprint gets a comment instead of a second issue. Without `gh` signed in, nothing is sent and they get the new-issue link with the draft filled in.

**Acceptance**

- Given no `gh`, then nothing is sent, the draft stays, and the link is given.
- Given `gh`, then the first send creates an issue on code-kit's repository, and the same bug sent again comments on it.

### JOURNAL-1 The build's lineage

`code-kit journal [--json]` reads, from git and the project's records, oldest first: what the person asked for (the brief's title and problem), each decision in the brief's decision log with its reason, the specification (requirements, stories, milestones), the rules switched on, each story handed out (to which lane, or the lead itself), sent back (with the reason) and merged, each approval with who gave it (the person in their own words, or the lead within the limits), and each milestone finished. The request, its decisions, the spec and the switch-on come before the first piece of work, whatever their commit times. The Journal tab (3) draws these with the loop's steps this session and the person's pause and resume, by day, the person's own in yellow, the latest 60.

**Acceptance**

- Given a brief "Groomers lose bookings on paper" whose decision log records "Web only" because groomers use laptops, and a plan, then `code-kit journal --json` opens with the request, then "Decided: Web only, because groomers use laptops.", and includes the specification.
- Given an approval logged by the lead within the delegated rules, then the journal says the lead approved it within the limits the person set; given one from the pane, that the person approved it, in their words.
- Given those events, when the person opens the Journal tab, then they show by day, from the request to the merge.

### NOTIFY-1 Told when something new needs you

When a decision that needs the person's act appears (an approval, a held call, the lead's question or the brief's, the lead waiting on them, a stalled lane, a call Claude Code refused, a step to approve, a merge that's theirs), the session that runs the loop raises a system notification through the person's own notification channel (`$.ui.notify`, Claude Code 2.1.301 or later): "code-kit: the lead asks you", with what it asks and its story. Each decision is notified once; several at one look are one notification. What was waiting when the session first looked isn't news, and notices and reports aren't notified. `harness.notify.on` (default on) turns it off. On an older Claude Code nothing is raised.

**Acceptance**

- Given an approval waiting when the session starts, then nothing is notified; when the lead then asks a question, then one notification "code-kit: the lead asks you" is raised, and none again for it.
- Given `notify.on` false, then a new question raises nothing.
