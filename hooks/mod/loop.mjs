// The lead loop (spec 05), the pure parts: what to prompt the lead with for a step `code-kit next`
// reports, and what a quiet lane agent is due. The mod watches and prompts; the lead acts, with the
// existing skills, and the hooks judge every call as before.

/** The steps the loop hands the lead; the rest (spec-design, init, check) wait for the person. */
const LEAD_STEPS = new Set(['dispatch', 'review', 'lead', 'merge']);

/**
 * The prompt for a step from `code-kit next --json` (LOOP-1), or null when it isn't the lead's to
 * take. Every ready story is named: the dispatch skill decides how many lanes go (LOOP-2). A prompt
 * names the skill rather than starting with it: Claude Code refuses a mod's prompt that begins with
 * `/`, which would run a command as the person.
 */
export function leadPrompt(step, { cli = 'code-kit' } = {}) {
  if (!step || !LEAD_STEPS.has(step.step)) return null;
  const ids = (step.args ?? '').split(/\s+/).filter(Boolean);
  // MQ-2: the head of the merge queue, where the lead merges within the delegated rules.
  if (step.step === 'merge')
    return ids.length
      ? `Merge ${ids[0]}, next in the merge queue: run node "${cli}" queue merge --delegated. It verifies the branch against the base as it is now, and sends it back to its lane if it conflicts or fails.`
      : null;
  if (step.step === 'dispatch')
    return ids.length
      ? `Dispatch ${ids.join(', ')}: run /code-kit:dispatch ${ids.join(' ')}.`
      : null;
  // The review skill takes one story, or none for every story in review.
  if (step.step === 'review')
    return ids.length === 1
      ? `Review ${ids[0]}: run /code-kit:review ${ids[0]}.`
      : `Review ${ids.join(', ')}: run /code-kit:review.`;
  if (!ids.length) return null;
  const branches = ids.map((id) => `lead/${id.toLowerCase()}`).join(', ');
  return `Build ${ids.join(', ')} yourself: ${ids.length === 1 ? "it is the lead's own story" : "they are the lead's own stories"}. Work on ${branches}, then review ${ids.length === 1 ? 'it' : 'them'} like any branch.`;
}

/** A step's identity: the loop never submits the same step twice while the project stands still. */
export const stepKey = (step) => `${step.step}:${step.args ?? ''}`;

/** The band's words for a step (LOOP-5): "Dispatch ST-7, ST-9". */
export function stepLabel(step) {
  const ids = (step.args ?? '').split(/\s+/).filter(Boolean).join(', ');
  const verb =
    { dispatch: 'Dispatch', review: 'Review', lead: 'Build', merge: 'Merge' }[step.step] ??
    step.step;
  return ids ? `${verb} ${ids}` : verb;
}

/**
 * What a lane agent with no tool call for `quietMs` is due (LOOP-3): 'nudge' at stall.nudgeMinutes,
 * 'restart' at stall.restartMinutes, 'flag' once its story has been restarted stall.maxRestarts
 * times, or null. `agent` holds what was done already: { nudged, stopped }.
 */
export function stallDue(quietMs, agent, restarts, stall) {
  const minutes = quietMs / 60000;
  if (minutes >= stall.restartMinutes && !agent.stopped)
    return restarts >= stall.maxRestarts ? 'flag' : 'restart';
  if (minutes >= stall.nudgeMinutes && !agent.nudged) return 'nudge';
  return null;
}

/** The lead's prompt to stop a stalled agent and dispatch its story again (LOOP-3). */
export function restartPrompt({ type, id, story, minutes }) {
  return `${type} (agent ${id}) on ${story} has made no tool call for ${minutes} minutes. Stop it with TaskStop, then dispatch ${story} again with the same brief on the same branch: /code-kit:dispatch ${story}`;
}

/** The message a quiet agent gets (LOOP-3). */
export const nudgeText = (minutes) =>
  `No tool call for ${minutes} minutes: report where you are, or carry on.`;
