// The mission band (docs/specs/14-mission-and-maps.md, MISSION-1 to MISSION-3), the pure parts: the
// goal, what the lead is doing now, the loop's next step, each agent at work with its tool, and a line
// from another tool only when it has something to say. The band draws these above what needs the person.
import { stepLabel } from './loop.mjs';

/**
 * MISSION-1: the milestone being built: the plan's first milestone with a story not done (else its
 * last), with how many of its stories are done: { name, done, total }, or null when the plan has none.
 */
export function goalOf(stories = []) {
  const named = stories.filter((s) => s.milestone);
  if (!named.length) return null;
  const open = named.find((s) => s.state !== 'done') ?? named.at(-1);
  const mine = named.filter((s) => s.milestone === open.milestone);
  return {
    name: open.milestone,
    done: mine.filter((s) => s.state === 'done').length,
    total: mine.length,
  };
}

/** The words for the loop's next step, from `code-kit next --json`. */
export function nextText(step) {
  if (!step) return null;
  if (step.step === 'done') return 'nothing: every story is done';
  if (step.step === 'wait') return `waiting: ${step.why}`;
  const then = (step.then ?? []).map((t) => stepLabel(t));
  const label = ['spec-design', 'init', 'check'].includes(step.step)
    ? `${step.step} (yours to run)`
    : stepLabel(step);
  return `${label}${then.length ? `, then ${then.join(', ')}` : ''}`;
}

/** At most this many agents get a line of their own; the rest are counted. */
const AGENT_LINES = 5;

/**
 * MISSION-1 to MISSION-3: the band's mission rows, or none while nothing is happening (no lead turn,
 * no agent at work, the loop not started). Each row is { kind, mission: true, label, text, ... }:
 * goal; now (with Pause or Resume while the loop runs); next; agents, with one entry per lane at work
 * ({ lane, tool, ago, level }); and a line per adapter fact worth the person's attention.
 */
export function missionLines({
  state,
  loop = null,
  leadBusy = false,
  live = {},
  nextStep = null,
  combined = null,
}) {
  if (state?.kind !== 'ok') return [];
  const working = state.lanes.filter((l) => l.name !== 'lead' && l.active && live[l.name]);
  const loopOn = Boolean(loop?.started) && !['off', 'stopped'].includes(loop?.state);
  if (!leadBusy && !working.length && !loopOn) return [];
  const rows = [];
  const goal = goalOf(state.stories);
  if (goal)
    rows.push({
      kind: 'goal',
      label: 'goal',
      text: `${goal.name} · ${goal.done} of ${goal.total} ${goal.total === 1 ? 'story' : 'stories'} done`,
    });
  const lead = leadBusy
    ? `lead ${live.lead?.tool ? `at work: ${live.lead.tool}` : 'at work'}`
    : 'lead idle';
  const loopWord =
    loop?.state === 'paused'
      ? 'loop paused'
      : loop?.state === 'off'
        ? 'loop off'
        : loop?.state === 'done'
          ? 'milestone done'
          : loopOn
            ? `loop ${loop.autonomy === 'propose' ? 'proposing' : 'on'}${loop.last ? ` · last: ${loop.last}` : ''}`
            : null;
  rows.push({
    kind: 'now',
    label: 'now',
    text: [lead, loopWord].filter(Boolean).join(' · '),
    actions:
      loop?.state === 'paused'
        ? [{ id: 'resume', label: 'Resume' }]
        : loopOn && loop?.state === 'running'
          ? [{ id: 'pause', label: 'Pause' }]
          : [],
  });
  const next = nextText(nextStep);
  if (next && loop?.state !== 'done') rows.push({ kind: 'next', label: 'next', text: next });
  if (working.length)
    rows.push({
      kind: 'agents',
      label: 'agents',
      text: `${working.length} at work`,
      agents: working.slice(0, AGENT_LINES).map((l) => ({
        lane: l.name,
        tool: live[l.name].tool,
        ago: live[l.name].ago,
        level: live[l.name].level ?? null,
      })),
      more: Math.max(0, working.length - AGENT_LINES),
    });
  // MISSION-3: another tool's line only when it isn't zero: edits made before the file was understood.
  const unread = Object.entries(combined ?? {}).filter(([, f]) => f.without > 0);
  if (unread.length)
    rows.push({
      kind: 'facts',
      label: 'context',
      text: unread
        .map(
          ([lane, f]) =>
            `${lane} edited ${f.without} file${f.without === 1 ? '' : 's'} without understanding ${f.without === 1 ? 'it' : 'them'}`,
        )
        .join(' · '),
    });
  return rows.map((r) => ({ actions: [], ...r, mission: true }));
}
