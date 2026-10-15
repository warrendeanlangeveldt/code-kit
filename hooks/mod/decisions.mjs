// Decisions (docs/specs/15-decisions-and-journal.md, DECIDE-2 and DECIDE-3), the pure parts: what reaches
// the person, each with its lineage. The band's "you" lines say what needs them; a decision card says why:
// what they asked for, the story and requirements it belongs to, what the agent was doing, what was already
// settled, why the lead couldn't settle this itself, and each option with what happens next.
import { approvalLabel, askWords, commandItself } from './view.mjs';

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
  'waiting',
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
  answerLead: 'The lead is told your answer and carries on.',
  answerLeadText: 'Type your answer; the lead is told it and carries on.',
  askAgain: 'The lead is asked to take this step again now.',
  carryOn: 'The loop goes on with whatever is next.',
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
  // LOOP-11: what the lead waits on, read from its reply: its answers, or the person's own words.
  if (line.kind === 'waiting' && line.waiting.kind === 'person' && line.waiting.question)
    return [
      ...line.waiting.options.map((o, i) => ({
        id: `answerLead-${i}`,
        act: 'answerLead',
        label: o.label,
        effect: o.effect,
        line: { ...line, choice: o.label },
      })),
      { id: 'answerLeadText', label: line.waiting.options.length ? 'Something else…' : 'Answer…' },
    ];
  return line.actions;
}

/** A kind of decision as its card's tag says it. */
const TAG = {
  held: 'held call',
  approvals: 'approval',
  stalled: 'stalled',
  proposal: 'next step',
  queue: 'merge',
  review: 'review',
  notice: 'notice',
  question: 'question',
  brief: 'your brief',
  denied: 'refused',
  report: 'bug report',
  waiting: 'the lead',
};

/** At most `n` characters on one line, cut with an ellipsis. */
const clip = (text, n) => {
  const one = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Names as a person reads them, at most three, then how many more. */
const someNames = (names) => {
  const shown = names.slice(0, 3).map(approvalLabel).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
};

/**
 * CARD-9: a decision's headline and the line under it, short enough for a card in a list:
 * { tag, headline, sub }.
 */
function headlineOf(line, story) {
  const forStory = story ? ` · ${story.id}` : '';
  if (line.kind === 'approvals') {
    const who = line.request.lane ? `the ${line.request.lane} lane` : line.request.actor;
    return {
      headline: `Approve ${someNames(line.request.names)}`,
      sub: `for ${who}${forStory} · ${clip(commandItself(line.files?.[0] ?? line.request.what), 70)}`,
    };
  }
  if (line.kind === 'held')
    return {
      headline: `${line.held.who} wants to ${line.text.replace(/^.*? wants to /, '').replace(/ · \d+:\d+$/, '')}`,
      sub: `held${forStory} · ${line.text.match(/\d+:\d+$/)?.[0] ?? ''} left`,
    };
  if (line.kind === 'question')
    return {
      headline: line.question.question,
      sub: `from the lead${forStory}${line.question.blocks ? ', which waits on it' : ''}`,
    };
  if (line.kind === 'brief')
    return {
      headline: line.brief.question,
      sub: `open in ${line.brief.path}${line.brief.blocks ? ` · holds up ${line.brief.blocks}` : ''}`,
    };
  if (line.kind === 'denied')
    return {
      headline: `Claude Code refused ${line.denial.who}'s call`,
      sub: clip(line.denial.command ?? line.denial.what, 80),
    };
  if (line.kind === 'report')
    return { headline: line.report.title, sub: "drafted by an agent, for code-kit's GitHub" };
  if (line.kind === 'waiting' && line.waiting.question)
    return { headline: line.waiting.question, sub: 'from the lead, which waits on it' };
  return { headline: line.text, sub: story ? `${story.id} ${story.title ?? ''}` : '' };
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
    return `It's an open question in ${line.brief.path}, left for you: what gets built depends on your answer. Not sure what it means? Ask about it when you answer.`;
  if (line.kind === 'denied')
    return `Claude Code's own permission check refused it${line.denial.reason ? ` (${line.denial.reason})` : ''}, which code-kit can't approve past: only you can run it or allow it.`;
  if (line.kind === 'waiting' && line.waiting.kind === 'person')
    return "The lead's last reply waits on you, so the loop doesn't prompt it again until you answer, here or in the chat.";
  if (line.kind === 'waiting' && line.waiting.kind === 'stopped')
    return 'You stopped the lead mid-turn, so the loop leaves the lead to you until you say.';
  if (line.kind === 'waiting' && line.waiting.kind === 'blocked')
    return "The lead was asked to take this step and didn't, so the loop won't ask again until you say.";
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
      // Approvals in force bear on an approval or a held call, not on a question about the product.
      const aboutApprovals = ['held', 'approvals', 'stalled'].includes(line.kind);
      const settled = [
        ...journal.filter((e) => story && e.story === story.id).map((e) => e.text),
        ...(aboutApprovals ? inForce : [])
          .filter((a) => !lane || !a.lane || a.lane === lane)
          .slice(0, 3)
          .map(
            (a) =>
              `${a.name} is approved${a.lane ? ` for the ${a.lane} lane` : ''}${a.reason ? `: ${a.reason}` : ''}`,
          ),
      ].slice(-5);
      const { headline, sub } = headlineOf(line, story);
      return {
        id: `${line.kind}-${i}`,
        kind: line.kind,
        tag: TAG[line.kind] ?? 'decision',
        headline: clip(headline, 100),
        sub,
        line,
        // The band line it came from: one line can stand for several decisions (CARD-8).
        source,
        title: line.text,
        // CARD-9: what they asked for in a line (the brief's title, not its whole problem).
        asked:
          [request && clip(firstSentence(request), 140), goal].filter(Boolean).join(' · ') || null,
        // The question itself, and the brief's own columns for it (who decides, what it holds up).
        details: [
          ...(line.kind === 'brief'
            ? [
                { label: 'Question', value: line.brief.question },
                ...(line.brief.owner ? [{ label: 'Who decides', value: line.brief.owner }] : []),
                ...(line.brief.blocks ? [{ label: 'Holds up', value: line.brief.blocks }] : []),
              ]
            : []),
          ...(line.kind === 'question'
            ? [{ label: 'Question', value: line.question.question }]
            : []),
        ],
        story: story
          ? { id: story.id, title: story.title ?? '', branch: story.branch ?? null }
          : null,
        requirements: (story?.requirements ?? []).map((id) => ({
          id,
          title: titles.get(id) ?? '',
        })),
        doing:
          line.held?.command ??
          (line.request
            ? clip(
                askWords(
                  line.request,
                  (line.files ?? [line.request.what]).map((f) => commandItself(f)),
                ),
                300,
              )
            : null) ??
          (line.proposal?.label ? `Next step: ${line.proposal.label}` : null) ??
          (line.intent
            ? `Intent #${line.intent.id}: ${line.intent.about}${line.intent.touches.length ? ` (touches ${line.intent.touches.join(', ')})` : ''}`
            : null) ??
          (line.pull ? `Pull request #${line.pull.number} on ${line.pull.branch}` : null) ??
          (line.question?.blocks ? `${line.question.story} waits on your answer.` : null) ??
          (line.waiting?.label ? `The loop's last step: ${line.waiting.label}` : null) ??
          (line.denial ? clip(line.denial.command ?? line.denial.what, 400) : null) ??
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

/** DECIDE-4: the kinds of decision settled with a choice, asked in Claude Code's own question dialog. */
export const NATIVE_KINDS = new Set(['proposal', 'stalled', 'teamStale', 'question', 'waiting']);

/** One sentence ended as a question asks. */
const asked = (text, question) => `${String(text).replace(/[.\s]+$/, '')}. ${question}`;

/**
 * DECIDE-4: a decision card as Claude Code's question dialog asks it: { key, question, header, options:
 * [{ label, act, line }], typed }, or null for one that needs the pane (a reason to give, an answer to
 * type with no choices offered). An option without `act` leaves the decision where it is; `typed` names
 * the act that takes the person's own words, typed under the dialog's Other.
 */
export function nativeChoice(card) {
  if (!NATIVE_KINDS.has(card.kind)) return null;
  const line = card.line;
  const w = line.waiting;
  // What the person stopped, or a reply waiting on them with no question in it, is theirs to pick up
  // in the chat: no dialog over what they're about to type.
  if (card.kind === 'waiting' && !(w?.kind === 'person' && w.question) && w?.kind !== 'blocked')
    return null;
  const options = card.options
    .filter((o) => !o.label.endsWith('…'))
    .slice(0, 4)
    .map((o) => ({ label: o.label, act: o.act ?? o.id, line: o.line ?? line }));
  if (!options.length) return null;
  if (options.length === 1) options.push({ label: 'Not now', act: null, line });
  const question =
    card.kind === 'proposal' && line.proposal?.first
      ? asked(line.text, 'How much should it do on its own?')
      : card.kind === 'proposal' && line.proposal?.repeated
        ? `${card.why} ${line.text}`
        : card.kind === 'stalled'
          ? asked(`${line.text}. ${card.why}`, 'Restart it?')
          : card.kind === 'teamStale'
            ? asked(line.text, 'Keep your claim?')
            : card.kind === 'waiting' && w.kind === 'blocked'
              ? asked(line.text, 'Ask the lead again?')
              : card.headline;
  return {
    key: `${card.kind}:${card.headline}:${options.map((o) => o.label).join('|')}`,
    question: /\?$/.test(question) ? question : `${question}?`,
    header: card.tag.slice(0, 12),
    options,
    typed:
      card.kind === 'question' ? 'answerTyped' : card.kind === 'waiting' ? 'answerLeadTyped' : null,
  };
}
