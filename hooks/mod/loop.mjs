// The lead loop (spec 05), the pure parts: what to prompt the lead with for a step `code-kit next`
// reports, and what a quiet lane agent is due. The mod watches and prompts; the lead acts, with the
// existing skills, and the hooks judge every call as before.

/** The steps the loop hands the lead; the rest (spec-design, init, check) wait for the person. */
const LEAD_STEPS = new Set([
  'reconcile',
  'instructions',
  'decide',
  'dispatch',
  'review',
  'lead',
  'merge',
  'rules',
  'design',
  'setup',
  'update',
]);

/** The steps that name stories, which an agent already at work on one shouldn't be asked to start again. */
const STORY_STEPS = new Set(['dispatch', 'review', 'lead', 'design']);
const AT_WORK = new Set(['pending', 'running', 'waiting']);

/**
 * LOOP-9: the stories agents are at work on now, by the task each was started with: a lane agent is
 * started as "ST-12 booking form", a reviewer as "Review web/st-12". `code-kit next` reads only the
 * branches, so it can't tell a branch still being built, or already under review, from one waiting.
 */
export function storiesInFlight(agents) {
  const ids = new Set();
  for (const a of agents ?? []) {
    if (!AT_WORK.has(a.status)) continue;
    const text = `${a.description ?? ''}`;
    for (const m of text.matchAll(/\bST-(\d+)\b/gi)) ids.add(`ST-${m[1]}`);
    for (const m of text.matchAll(/\b[\w-]+\/st-(\d+)\b/gi)) ids.add(`ST-${m[1]}`);
  }
  return ids;
}

/**
 * LOOP-9: the step from `code-kit next`, without the stories already in flight. A step left with none
 * gives way to the next one `next` listed; with nothing left, the loop waits, saying for what, until an
 * agent finishes (which moves the project on).
 */
export function withoutInFlight(step, inFlight, parked = new Map()) {
  if (!step || (!inFlight?.size && !parked?.size)) return step;
  const chain = [step, ...(step.then ?? [])].map(({ then: _then, ...s }) => s);
  const kept = [];
  const busy = [];
  for (const s of chain) {
    if (!STORY_STEPS.has(s.step)) {
      kept.push(s);
      continue;
    }
    const ids = (s.args ?? '').split(/\s+/).filter(Boolean);
    const held = (id) => inFlight?.has(id.toUpperCase()) || parked?.has(id.toUpperCase());
    const free = ids.filter((id) => !held(id));
    busy.push(...ids.filter(held));
    if (free.length) kept.push({ ...s, args: free.join(' ') });
  }
  if (kept.length) return { ...kept[0], ...(kept.length > 1 ? { then: kept.slice(1) } : {}) };
  const names = [...new Set(busy.map((id) => id.toUpperCase()))];
  const working = names.filter((id) => inFlight?.has(id));
  // LOOP-13: what each parked story waits on, as the lead said.
  const waits = names
    .filter((id) => !inFlight?.has(id))
    .map(
      (id) =>
        `${id} waits${parked.get(id)?.on?.length ? ` on ${parked.get(id).on.join(', ')}` : ''}`,
    );
  return {
    step: 'wait',
    why: [
      working.length
        ? `${working.join(', ')} ${working.length === 1 ? 'is' : 'are'} still with ${working.length === 1 ? 'its agent' : 'their agents'}`
        : null,
      ...waits,
    ]
      .filter(Boolean)
      .join('; ')
      .concat('; the loop goes on when one moves'),
    inFlight: names,
  };
}

/** LOOP-13: how long a parked story waits with nothing it waits on moving, before the lead is asked again. */
export const PARK_MS = 30 * 60_000;

/**
 * LOOP-13: the stories to watch while `id` is parked: itself, the stories the lead said it waits on,
 * and the stories that depend on it and aren't done (a pair the lead merges together).
 */
export function parkWatch(id, on = [], stories = []) {
  const dependents = stories
    .filter((s) => (s.dependsOn ?? []).includes(id) && s.state !== 'done')
    .map((s) => s.id);
  return [...new Set([id, ...on, ...dependents])];
}

/**
 * LOOP-13: where the watched stories stand, as one string. The parked story itself (the first) counts
 * its state, its branch's commit and whether an agent is at work on it; each story it waits on counts its
 * state alone, so the commits of a story still being built don't wake the one waiting for it to finish.
 * A parked story wakes when this changes.
 */
export function storiesSignature(ids, stories = [], heads = new Map(), inFlight = new Set()) {
  return ids
    .map((id, i) => {
      const s = stories.find((x) => x.id === id);
      if (i > 0) return `${id}:${s?.state ?? '?'}`;
      return `${id}:${s?.state ?? '?'}:${s?.branch ? (heads.get(s.branch) ?? '') : ''}:${inFlight.has(id) ? 'busy' : ''}`;
    })
    .join('|');
}

/** The story ids a step names, upper-cased: `review ST-158 ST-172` gives ST-158 and ST-172. */
export const stepStories = (step) =>
  STORY_STEPS.has(step?.stepKind ?? step?.kind ?? step?.step)
    ? String(step?.target ?? step?.args ?? '')
        .split(/\s+/)
        .filter((id) => /^ST-\d+$/i.test(id))
        .map((id) => id.toUpperCase())
    : [];

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
      ? `Merge ${ids[0]}, next in the merge queue: run node "${cli}" queue merge --delegated. It verifies the branch against the base as it is now, and sends it back to its lane if it conflicts or fails; a branch that moved after its review leaves the queue for you to review again.`
      : null;
  // SETUP-2: the base has no rules yet; the lead puts the approved ones there, then merges as usual.
  if (step.step === 'rules')
    return `Put code-kit's approved rules onto ${ids[0] ?? 'the base'}: run node "${cli}" queue rules. It commits the rules as committed on this branch, without switching branches; after it, merge the queue as usual.`;
  // ONB-8: code-kit's instructions brought up to date, then committed like any change to the kit.
  if (step.step === 'instructions') {
    const how =
      step.args === 'merge'
        ? `Run node "${cli}" instructions to see which files, then merge each one: replace its old code-kit part with what node "${cli}" instructions show lead (CLAUDE.md) or show lane (an agent file) prints, and keep every line the project wrote itself outside the markers, under a heading of its own. Then run node "${cli}" instructions --write for the rest.`
        : `Run node "${cli}" instructions --write.`;
    return `${step.why ?? "code-kit's instructions are behind."} ${how} Commit the change on a branch and merge it like your own stories, so new lane agents start with the current rules.`;
  }
  // DUR-4: an act an agent left open that git can't settle: the lead finds out, and records it.
  if (step.step === 'reconcile') {
    const acts = step.acts ?? [];
    if (!acts.length) return null;
    const each = acts
      .map(
        (a) =>
          `${a.story}: ${a.kind} \`${a.target}\` (act ${a.act}); see node "${cli}" replay ${a.story}`,
      )
      .join('; ');
    return `${step.why ?? 'An agent stopped mid-act.'} For each, check what happened (${each}). Never run it again just to be sure. Record what you found with node "${cli}" reconcile <story> --act <act> --found done|not-done --how "<how you know>". If finding out needs something you don't decide, such as a migration the person approves, ask them with code-kit ask.`;
  }
  // HELM-4: a lane waits on the lead's decision; the decide skill takes each request on its merits.
  if (step.step === 'decide')
    return ids.length
      ? `${step.why ?? 'A lane waits on your decision.'} Run /code-kit:decide ${ids.join(' ')}.`
      : null;
  // ONB-3: a companion set up before any coding.
  if (step.step === 'setup')
    return ids.length
      ? `Before any code is written, set up ${ids[0].split(':')[0]}: run /${ids[0]}. ${step.why ?? ''}`.trim()
      : null;
  // ONB-6: an older setup brought up to date before the next story; init shows the person the diff.
  if (step.step === 'update')
    return `Before the next story, bring code-kit's setup up to date: run /code-kit:init. ${step.why ?? ''}`.trim();
  // ONB-2: the screens designed, and approved by the person, before they're built.
  if (step.step === 'design')
    return ids.length
      ? `Design ${ids.join(', ')} before any of their screens are built: run /code-kit:design ${ids.join(' ')}.`
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
    {
      reconcile: 'Reconcile',
      decide: 'Decide requests',
      instructions: 'Update the instructions',
      dispatch: 'Dispatch',
      review: 'Review',
      lead: 'Build',
      merge: 'Merge',
      rules: 'Rules onto',
      design: 'Design',
      setup: 'Set up',
      update: 'Update the setup',
    }[step.step] ?? step.step;
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
export function restartPrompt({ type, id, story, minutes, cli = 'code-kit' }) {
  return `${type} (agent ${id}) on ${story} has made no tool call for ${minutes} minutes. Stop it with TaskStop, then dispatch ${story} again with the same brief on the same branch, adding what node "${cli}" replay ${story} --brief prints (DUR-5: its last commit, tests and what it left open): /code-kit:dispatch ${story}`;
}

/**
 * WHO-4: a lane stalled past its restarts is the lead's to sort out, not the person's: what it tried,
 * and the lead's three ways on (a narrower brief, smaller stories, or the story handed back).
 */
export function stalledPrompt({ type, id, lane, story, restarts, last = null }) {
  return `${type} (agent ${id}) on ${story} has stalled again after ${restarts} restart${restarts === 1 ? '' : 's'}${last ? `; its last call was ${last}` : ''}. Stop it with TaskStop, read its report and what it committed on its branch, then decide: dispatch ${story} again with a brief that names what it got stuck on, split ${story} into smaller stories in the plan, or hand it back to the ${lane} lane's queue with the reason. Ask the person only if the story needs a product decision.`;
}

/** The message a quiet agent gets (LOOP-3). */
export const nudgeText = (minutes) =>
  `No tool call for ${minutes} minutes: report where you are, or carry on.`;

/** LOOP-11: what a lead turn left the build at, as the loop reads the lead's reply. */
export const OUTCOMES = new Set(['done', 'started', 'needs-person', 'blocked', 'waiting']);
const ANSWER_SHOWN = 4000;

/**
 * LOOP-11: the side call that reads the lead's last reply before the loop prompts it again: over the
 * lead's own conversation (so it knows the whole exchange), with the reply itself for a call that
 * can't fork. `prompt` is the loop's own prompt for that turn, or null when the person started it.
 */
export function outcomePrompt({ prompt = null, answer = '' }) {
  const reply = String(answer ?? '').trim();
  const shown =
    reply.length > ANSWER_SHOWN ? `${reply.slice(0, ANSWER_SHOWN)}\n[… cut short]` : reply;
  return [
    prompt
      ? `code-kit's lead loop prompted you: "${prompt}"`
      : "The person prompted you, and code-kit's lead loop is about to prompt you with the build's next step.",
    `Your reply ended your turn. It read:\n"""\n${shown}\n"""`,
    'Say where that reply left things, so the loop knows whether to prompt you again. Answer with one JSON object and nothing else:',
    '{"outcome": "done" | "started" | "needs-person" | "blocked" | "waiting", "question": "…", "options": [{"label": "…", "effect": "…"}], "reason": "…", "waits": [{"story": "ST-n", "on": ["ST-n"], "why": "…"}]}',
    '- done: you finished what was asked, or there was nothing to do.',
    '- started: you started work that carries on without you, such as lane agents.',
    "- needs-person: you asked the person something, or wait on their answer, approval or feedback before you go on. question: what you wait on, as one question; options: 2 to 4 answers they could give (a label of at most five words, and what it does), or [] when it's theirs to put in words.",
    "- waiting: the step isn't due yet for some or all of its stories: they wait on other work still going (a lane building a story they merge with, a rebuild, a check running). waits: one entry per story that waits, with the stories it waits on (their ST ids, [] when it's other work) and why, in a few words. Use this, not done, when you said a story can't be taken yet.",
    "- blocked: you didn't take the step, for a reason no answer from the person settles now and no work in flight will change. reason: why, in a sentence.",
  ].join('\n');
}

/**
 * LOOP-11: the side call's answer: { outcome, question, options: [{ label, effect }], reason }, or
 * null when it isn't one (the loop then goes on as before).
 */
export function readOutcome(text) {
  const raw = String(text ?? '');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || !OUTCOMES.has(parsed.outcome)) return null;
  const words = (s, n) =>
    typeof s === 'string' && s.trim() ? s.replace(/\s+/g, ' ').trim().slice(0, n) : null;
  const options = (Array.isArray(parsed.options) ? parsed.options : [])
    .map((o) => ({ label: words(o?.label, 40), effect: words(o?.effect, 200) }))
    .filter((o) => o.label)
    .slice(0, 4);
  const story = (v) =>
    typeof v === 'string' && /^ST-\d+$/i.test(v.trim()) ? v.trim().toUpperCase() : null;
  const waits = (Array.isArray(parsed.waits) ? parsed.waits : [])
    .map((w) => ({
      story: story(w?.story),
      on: (Array.isArray(w?.on) ? w.on : []).map(story).filter(Boolean),
      why: words(w?.why, 200),
    }))
    .filter((w) => w.story);
  return {
    outcome: parsed.outcome,
    question: words(parsed.question, 400),
    options: options.length >= 2 ? options : [],
    reason: words(parsed.reason, 300),
    waits,
  };
}

/**
 * LOOP-12: a design is made with the person, so the loop hands a design story to the lead once; while
 * the stories `next` names have all been handed over, it leaves them to the person and the lead.
 */
export const designHandedOver = (step, handed) =>
  step?.step === 'design' &&
  (step.args ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .every((id) => handed.has(id));

/** LOOP-11: the lead's prompt with the person's answer to what it waited on. */
export const answeredPrompt = (question, answer) => {
  const said = /[.!?]$/.test(answer) ? answer : `${answer}.`;
  return question
    ? `The person answered what you asked ("${question}"): ${said} Carry on with it.`
    : `The person says: ${said} Carry on with it.`;
};

export { agentFileModel } from '../lib/schedule.mjs';

/**
 * SET-4: the model to start a lane agent on, or null to leave the spawn as it is: a model the lead's
 * call names wins, then the lane agent file's own (other than `inherit`), then `harness.agents.lanes.model`.
 * Set to `story` (SCHED-3), it's the model `next` gave the story, `story`, or null where it gave none.
 */
export function laneModel({
  type,
  model = null,
  lanes = {},
  setting = null,
  fileModel = null,
  story = null,
}) {
  if (model || !setting) return null;
  if (!Object.values(lanes).some((l) => l.agent === type)) return null;
  if (fileModel && fileModel !== 'inherit') return null;
  return setting === 'story' ? story : setting;
}

/** LEAN-3: compacting a context below this share of its window isn't worth the summary it costs. */
export const COMPACT_FLOOR = 25;

/**
 * LEAN-3: the milestones every story of which is done, in the plan's order. A milestone with no stories
 * isn't one.
 */
export function milestonesDone(stories = []) {
  const by = new Map();
  for (const s of stories) {
    if (!s.milestone) continue;
    by.set(s.milestone, [...(by.get(s.milestone) ?? []), s]);
  }
  return [...by].filter(([, list]) => list.every((s) => s.state === 'done')).map(([m]) => m);
}

/** LEAN-3, LEAN-4: what the lead's summary keeps when its context is compacted, after a milestone or not. */
export const compactInstructions = (milestone = null) =>
  [
    milestone
      ? `${milestone} is done; the build goes on with the next milestone.`
      : "The lead's context is compacted between turns; the build goes on.",
    'Keep: the milestone just finished, in a line; every story in flight now, with its lane, its branch and where it stands (building, in review, in the merge queue, waiting and on what); the decisions and questions waiting on the person; what the person decided or asked for in this session that still applies; and the rules and preferences they set.',
    "Drop: the finished stories' details, lane reports and hand-backs, command output, diffs and file contents. Each is in git, the plan or the lanes' report files, to read again when it's needed.",
  ].join('\n');

/** LEAN-5: the context a model request carried: what it sent, read from the cache, and wrote to it. */
export const requestContext = (usage) =>
  (usage?.input_tokens ?? 0) +
  (usage?.cache_read_input_tokens ?? 0) +
  (usage?.cache_creation_input_tokens ?? 0);

/** LEAN-5: what a lane agent past its context limit is told. */
export const wrapUpText = (limit) =>
  `Your context is past ${Math.round(limit / 1000)}k tokens, and every step from here rereads all of it. Finish the step you're on, commit your work, write your report, and hand back now. The lead carries the story on with a fresh agent that reads your report.`;

/** LEAN-5, LEAN-6: the lead's prompt to carry a story on with a fresh agent once its agent handed back at the limit. */
export function continuePrompt({ type, story, branch, cli = 'code-kit' }) {
  return `${type} handed ${story} back at its context limit, with its work committed${branch ? ` on ${branch}` : ''}. Carry the story on with a fresh agent: run node "${cli}" worktrees release ${branch ?? '<branch>'} (it keeps the commits and moves the report to the main checkout), then dispatch ${story} again with the same brief, adding "Read your earlier report first: .claude/state/reports/${(branch ?? '<branch>').replace(/[^\w.-]+/g, '_')}.md in the main checkout" and what node "${cli}" replay ${story} --brief prints: /code-kit:dispatch ${story}`;
}
