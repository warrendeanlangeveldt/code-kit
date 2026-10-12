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
};

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
    .map((line, i) => {
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
          (line.pull ? `Pull request #${line.pull.number} on ${line.pull.branch}` : null),
        settled,
        why: whyOf(line, check),
        options: line.actions.map((a) => ({ ...a, effect: EFFECT[a.id] ?? null })),
      };
    });
}

/** The band's short context for a decision line: "for ST-23 The original panel (ORIG-3)". */
export function contextOf(card) {
  if (!card.story) return null;
  const reqs = card.requirements.map((r) => r.id).join(', ');
  return `for ${card.story.id} ${card.story.title}${reqs ? ` (${reqs})` : ''}`;
}
