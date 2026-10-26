// The mission (docs/specs/14-mission-and-maps.md, MISSION-1): the milestone being built, and the words
// for the loop's next step. The Build panel and the band's one line draw them (spec 27, UI-2 and UI-9).
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
