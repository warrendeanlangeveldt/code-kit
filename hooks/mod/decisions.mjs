// Decisions (docs/specs/15-decisions-and-journal.md, DECIDE-2 and DECIDE-3), the pure parts: what reaches
// the person, each with its lineage. The band's "you" lines say what needs them; a decision card says why:
// what they asked for, the story and requirements it belongs to, what the agent was doing, what was already
// settled, why the lead couldn't settle this itself, and each option with what happens next.
import { askWords } from './view.mjs';

/** The kinds of band line that are the person's to decide; the rest are notes. */
export const DECISION_KINDS = new Set([
  'held',
  'approvals',
  'stalled',
  'proposal',
  'queue',
  'review',
  'notice',
  'teamStale',
  'teamCollision',
  'teamIntent',
  'teamReview',
  'teamDrift',
  'question',
  'brief',
  'denied',
  'report',
]);

/** What each answer does, in the person's words. */
const EFFECT = {
  approveHeld: 'The held call runs now, and the agent carries on.',
  refuseHeld: 'The agent is told no and has to find another way; the lead hears why.',
  approve: "You confirm it with your reason; it's logged, and the agent can go ahead.",
  resumeStall: 'The lead dispatches the story again, with the same brief, on the same branch.',
  lanes: 'Opens the Lanes pane, to look before deciding.',
  go: 'The lead is asked to take this step now.',
  keepGoing: 'The build keeps moving between your prompts. You can pause it any time.',
  askEach: 'Each step waits here for your Go.',
  loopOff: 'Nothing happens between your prompts; you drive the build.',
  mergeQueue: "It's verified against main as it is now and merged; after that the lead merges.",
  review: 'The lead reviews it against its requirements now.',
  merge: "It's verified and merged now, by you.",
  dismiss: 'Clears this message.',
  keepClaim: 'Your claim stays, and its clock starts again.',
  releaseClaim: 'Anyone may claim the story now, and your lease on its files ends.',
  agreeIntent:
    'The issue closes as agreed, with your words; then put it in the specs or decisions so every agent builds on it.',
  dropIntent: 'The issue closes as dropped, and the team carries on as agreed before.',
  team: 'Opens the Team tab: who is building what, and what changed since you last looked.',
  openDecision: 'Opens it here, with what each answer does.',
  dropRequest: "Nobody needs it any more: it stops waiting, and nothing's approved.",
  answer: 'Type your answer; the lead is told it and carries on.',
  answerBrief: "Type your answer; the lead records it in the brief's decisions and builds on it.",
  laterBrief: 'It waits; it comes back next session.',
  runDenied:
    'Puts it in your prompt after !, so you run it yourself; press Enter to run it, then Done it.',
  deniedDone: 'The lead is told you ran it, or allowed it, and carries on.',
  deniedNo: "The lead is told you won't run it now, and carries on with other work.",
  sendReport:
    "Files it on code-kit's GitHub under your account (a comment instead, if it's filed already).",
  discardReport: "It's not sent, and goes.",
};

/**
 * CARD-8: one card per decision. A band line can stand for several (approvals waiting, held calls, the
 * lead's questions, the brief's, Claude Code's refusals, reports); each becomes its own line here, with
 * the decision it's about, so each card's options answer that one.
 */
function eachDecision(line) {
  if (line.kind === 'approvals' && line.asks?.length > 1)
    return line.asks.map((a) => ({
      ...line,
      text: `Approve ${askWords(a.request, a.files)}`,
      request: a.request,
      files: a.files,
    }));
  if (line.kind === 'approvals')
    return [{ ...line, text: `Approve ${askWords(line.request, line.files)}` }];
  if (line.kind === 'held' && line.calls?.length > 1)
    return line.calls.map((c) => ({ ...line, text: c.text, held: c.held }));
  if (line.kind === 'question')
    return (line.questions ?? [line.question]).map((q) => ({
      ...line,
      text: q.question,
      question: q,
    }));
  if (line.kind === 'brief')
    return (line.briefs ?? [line.brief]).map((b) => ({
      ...line,
      text: `From your brief: ${b.question}`,
      brief: b,
    }));
  if (line.kind === 'denied')
    return (line.denials ?? [line.denial]).map((d) => ({
      ...line,
      text: `Claude Code refused ${d.who}'s ${d.what}`,
      denial: d,
      actions: [
        ...(d.command ? [{ id: 'runDenied', label: 'Put it in the prompt' }] : []),
        { id: 'deniedDone', label: 'Done it' },
        { id: 'deniedNo', label: 'Not now' },
      ],
    }));
  if (line.kind === 'report')
    return (line.reports ?? [line.report]).map((r) => ({ ...line, text: r.title, report: r }));
  return [line];
}

/** A card's options: the line's own actions, or, for the kinds a card answers differently, its own. */
function optionsOf(line) {
  if (line.kind === 'approvals')
    return [
      { id: 'approve', label: 'Approve…' },
      { id: 'dropRequest', label: 'Not needed' },
    ];
  // ASK-2: each of the lead's options answers it at once; any answer can be typed instead.
  if (line.kind === 'question')
    return [
      ...line.question.options.map((o, i) => ({
        id: `answerWith-${i}`,
        act: 'answerWith',
        label: o.label,
        effect: o.effect,
        line: { ...line, choice: o.label },
      })),
      { id: 'answer', label: line.question.options.length ? 'Something else…' : 'Answer…' },
    ];
  if (line.kind === 'brief')
    return [
      { id: 'answerBrief', label: 'Answer…' },
      { id: 'laterBrief', label: 'Later' },
    ];
  if (line.kind === 'report')
    return [
      { id: 'sendReport', label: 'Send' },
      { id: 'discardReport', label: 'Discard' },
    ];
  return line.actions;
}

/** Why a line needs the person, when the line itself doesn't say. */
function whyOf(line, check) {
  if (line.kind === 'held') {
    const c = line.held;
    const rule = c.refusal ? firstSentence(c.refusal) : 'It needs an approval only you can give.';
    const limits = limitsWhy(c.outside);
    return limits ? `${rule} ${limits}` : rule;
  }
  if (line.kind === 'approvals')
    return line.request?.why ?? 'It needs an approval only you can give.';
  if (line.kind === 'stalled')
    return `The lead restarted it ${line.stall.count - 1} time${line.stall.count === 2 ? '' : 's'} and it stalled again, so it stopped trying.`;
  if (line.kind === 'proposal' && line.proposal?.first)
    return "You haven't chosen yet how much the lead does between your prompts.";
  if (line.kind === 'proposal' && line.proposal?.repeated)
    return `The lead was asked to do this ${line.proposal.repeated} times and it's still the next step, so something stopped it.`;
  if (line.kind === 'proposal') return 'You asked to approve each step before the lead takes it.';
  if (line.kind === 'queue')
    return check?.firstMerge
      ? 'The loop is off, so merging is yours. main has no rules committed yet: code-kit queue rules puts them there.'
      : "Your rules don't let the lead merge into main, so merges are yours.";
  if (line.kind === 'review') return 'The loop is off, so reviewing finished work is yours.';
  if (line.kind === 'teamStale')
    return "It's your claim: nobody else can build it while you hold it, and the tech lead may hand it on.";
  if (line.kind === 'teamCollision')
    return `Your agents and ${line.other.by}'s are changing the same files; whoever merges second resolves the conflict. Agree who goes first.`;
  if (line.kind === 'teamIntent' && line.intent && /touches yours/.test(line.text))
    return 'It changes what you own or are building: read it before your agents build further on the old way.';
  if (line.kind === 'teamIntent')
    return "You're the tech lead: a change of direction is agreed or dropped by you, and until then everyone builds on what was agreed.";
  if (line.kind === 'teamReview') return "It's in a lane you own, so its review is yours.";
  if (line.kind === 'teamDrift')
    return "The team's drift check found your work building on something that has since changed, or heading into someone else's: settle it before it merges.";
  if (line.kind === 'question')
    return (
      line.question.why ??
      "The lead can't settle this itself: it's yours to decide, and the lead builds on your answer."
    );
  if (line.kind === 'brief')
    return `It's an open question in ${line.brief.path}: what gets built depends on your answer.`;
  if (line.kind === 'denied')
    return `Claude Code's own permission check refused it${line.denial.reason ? ` (${line.denial.reason})` : ''}, which code-kit can't approve past: only you can run it or allow it.`;
  if (line.kind === 'report')
    return "code-kit got in an agent's way. It's sent under your GitHub account to a public repository, so read what it says first.";
  return null;
}

/** A refusal's first sentence: what the rule is, without the instructions meant for the agent. */
const firstSentence = (text) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;

/**
 * Why the lead couldn't approve it itself, from `code-kit approve --delegated`'s refusal: nothing
 * delegated, or the delegated rules each name it missed ("dep-x: fewer than 1000 weekly downloads").
 */
export function limitsWhy(outside) {
  if (!outside) return null;
  if (/delegates no approvals/.test(outside))
    return "You haven't let the lead approve these itself.";
  const misses = outside
    .split('\n')
    .filter((l) => /^\s{2}\S/.test(l))
    .map((l) => l.trim());
  return misses.length
    ? `It's outside the limits you set for the lead: ${misses.join('; ')}.`
    : null;
}

/** The story a line belongs to: the held call's or request's lane's story, the stalled story, the queued branch's. */
function storyOf(line, state) {
  const stories = state?.stories ?? [];
  const lane = line.held?.lane ?? line.request?.lane ?? line.stall?.lane ?? null;
  if (line.question?.story) return stories.find((s) => s.id === line.question.story) ?? null;
  if (line.story) return stories.find((s) => s.id === line.story.id) ?? line.story;
  if (line.stall?.story) return stories.find((s) => s.id === line.stall.story) ?? null;
  if (line.branch) return stories.find((s) => s.branch === line.branch) ?? null;
  if (lane) {
    const row = state?.lanes?.find((l) => l.name === lane);
    if (row?.story) return stories.find((s) => s.id === row.story.id) ?? row.story;
  }
  return null;
}

/**
 * DECIDE-2: a card for each line that needs the person, in the band's order: { id, kind, title, asked,
 * story, requirements, doing, settled, why, options }. `context`: { state, status (for requirement
 * titles), check, goal (the milestone), request (what the person asked for), journal (events),
 * inForce (approvals in force) }.
 */
export function decisionCards(lines, context = {}) {
  const { state, status, check, goal = null, request = null, journal = [], inForce = [] } = context;
  const titles = new Map((status?.requirements ?? []).map((r) => [r.id, r.title]));
  return lines
    .filter((l) => DECISION_KINDS.has(l.kind) && !l.mission)
    .flatMap((source) => eachDecision(source).map((line) => ({ source, line })))
    .map(({ source, line }, i) => {
      const story = storyOf(line, state);
      const lane = line.held?.lane ?? line.request?.lane ?? line.stall?.lane ?? story?.lane ?? null;
      const settled = [
        ...journal.filter((e) => story && e.story === story.id).map((e) => e.text),
        ...inForce
          .filter((a) => !lane || !a.lane || a.lane === lane)
          .slice(0, 3)
          .map(
            (a) =>
              `${a.name} is approved${a.lane ? ` for the ${a.lane} lane` : ''}${a.reason ? `: ${a.reason}` : ''}`,
          ),
      ].slice(-5);
      return {
        id: `${line.kind}-${i}`,
        kind: line.kind,
        line,
        // The band line it came from: one line can stand for several decisions (CARD-8).
        source,
        title: line.text,
        asked: [request, goal].filter(Boolean).join(' · ') || null,
        story: story
          ? { id: story.id, title: story.title ?? '', branch: story.branch ?? null }
          : null,
        requirements: (story?.requirements ?? []).map((id) => ({
          id,
          title: titles.get(id) ?? '',
        })),
        doing:
          line.held?.command ??
          (line.request ? askWords(line.request, line.files ?? [line.request.what]) : null) ??
          (line.proposal?.label ? `Next step: ${line.proposal.label}` : null) ??
          (line.intent
            ? `Intent #${line.intent.id}: ${line.intent.about}${line.intent.touches.length ? ` (touches ${line.intent.touches.join(', ')})` : ''}`
            : null) ??
          (line.pull ? `Pull request #${line.pull.number} on ${line.pull.branch}` : null) ??
          (line.question?.blocks ? `${line.question.story} waits on your answer.` : null) ??
          (line.denial ? (line.denial.command ?? line.denial.what) : null) ??
          (line.report ? line.report.body : null),
        settled,
        why: whyOf(line, check),
        options: optionsOf(line).map((a) => ({
          ...a,
          effect: a.effect ?? EFFECT[a.act ?? a.id] ?? null,
        })),
      };
    });
}

/** The band's short context for a decision line: "for ST-23 The original panel (ORIG-3)". */
export function contextOf(card) {
  if (!card.story) return null;
  const reqs = card.requirements.map((r) => r.id).join(', ');
  return `for ${card.story.id} ${card.story.title}${reqs ? ` (${reqs})` : ''}`;
}
