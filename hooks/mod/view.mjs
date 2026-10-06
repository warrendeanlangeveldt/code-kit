// What the code-kit mod shows, as pure functions of the CLI's JSON: the mod's hooks run the CLI and
// pass its output here, and pass the elements `$.ui.resolve` gives them. Nothing here touches the mods
// API, files or processes, so it is tested with node as well as with `claude plugin test`.

export const PANE_ID = 'code-kit-lanes';
export const NOT_CODE_KIT = "This project doesn't use code-kit.";
const LEAD = 'lead';

/** A CLI run's stdout as JSON, or null when it printed none. */
export function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** The agent statuses that mean an agent is at work in the session now. */
const AT_WORK = new Set(['pending', 'running', 'waiting']);

/** The subagent types at work, from `$.agent.list()`. */
export function agentsAtWork(agents) {
  return new Set((agents ?? []).filter((a) => AT_WORK.has(a.status)).map((a) => a.type));
}

/** The stories `code-kit next --json` says can start now: dispatched to lanes, or the lead's own. */
export function readyFrom(next) {
  if (!next) return [];
  const steps = [next, ...(next.then ?? [])].filter((s) => ['dispatch', 'lead'].includes(s.step));
  return [...new Set(steps.flatMap((s) => (s.args ?? '').split(/\s+/).filter(Boolean)))];
}

/**
 * One lane's row (PANE-2): the story it's on, its branch and its state.
 *   building   a branch for the story and, if it has commits, the lane's agent still at work on it;
 *   in review  commits on the branch (status's `review`) and the agent no longer at work;
 *   blocked    the lane's next story waits on another;
 *   idle       none of these.
 * `status` can't tell a finished branch from one still being built, so the agent at work decides.
 */
function laneRow(name, agent, stories, atWork) {
  const own = stories.filter((s) => s.lane === name);
  const active = Boolean(agent && atWork.has(agent));
  const story = own.find((s) => ['in progress', 'review'].includes(s.state));
  if (story) {
    const state = story.state === 'review' && !active ? 'in review' : 'building';
    return { name, agent, active, story, branch: story.branch, state };
  }
  const waiting = own.find((s) => ['blocked', 'ready', 'todo'].includes(s.state));
  if (waiting?.state === 'blocked')
    return { name, agent, active, story: waiting, branch: null, state: 'blocked' };
  return { name, agent, active, story: null, branch: null, state: 'idle' };
}

/**
 * Where the project stands, from `code-kit check --json` and, when the config is valid, `status
 * --json` and `next --json` (each null when the config names no plan, or the run failed), and the
 * subagent types at work:
 *   { kind: 'none' }                             no .claude/code-kit.json
 *   { kind: 'invalid', problems }                a config that doesn't validate
 *   { kind: 'ok', lanes, ready, planGaps }       a row per lane, what's ready, the plan's gaps (or null)
 */
export function projectState(check, status, next = null, atWork = new Set()) {
  if (!check || check.exists === false) return { kind: 'none' };
  if (!check.valid) return { kind: 'invalid', problems: check.problems ?? [] };
  const stories = status?.stories ?? [];
  const lanes = [
    laneRow(LEAD, null, stories, atWork),
    ...Object.entries(check.lanes ?? {}).map(([name, l]) =>
      laneRow(name, l.agent, stories, atWork),
    ),
  ];
  const ready = readyFrom(next).map((id) => {
    const story = stories.find((s) => s.id === id);
    return { id, title: story?.title ?? '', lane: story?.lane ?? null };
  });
  return { kind: 'ok', lanes, ready, planGaps: status ? (status.problems ?? []).length : null };
}

const STATE_COLOR = { building: 'blue', 'in review': 'yellow', blocked: 'red', idle: undefined };

/** The Lanes pane's body, drawn with the elements `$.ui.resolve(e)` returned. */
export function lanesPane(state, { Box, Text }) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!state || state.kind === 'none') return text(NOT_CODE_KIT, { dimColor: true });
  if (state.kind === 'invalid')
    return text('The config is invalid: run code-kit check.', { color: 'red' });
  const width = Math.max(...state.lanes.map((l) => l.name.length));
  const rows = state.lanes.map((l) =>
    Box({
      key: `lane-${l.name}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            text(l.active ? '●' : ' ', { color: 'green' }),
            text(l.name.padEnd(width), { bold: true }),
            text(l.state.padEnd(9), STATE_COLOR[l.state] ? { color: STATE_COLOR[l.state] } : {}),
            text(l.agent ?? 'the main session', { dimColor: true }),
          ],
        }),
        ...(l.story
          ? [
              text(
                `    ${l.story.id} ${l.story.title}${l.branch ? ` · ${l.branch}` : ''}${
                  l.state === 'blocked' ? ` · waits on ${l.story.waitingOn.join(', ')}` : ''
                }`,
                { dimColor: true, wrap: 'truncate-end' },
              ),
            ]
          : []),
      ],
    }),
  );
  const notes = [];
  if (state.planGaps)
    notes.push(
      text(`The plan has ${state.planGaps} gap(s): run code-kit status.`, { color: 'yellow' }),
    );
  const ready = state.ready.length
    ? [
        text('Ready', { bold: true }),
        ...state.ready.map((r) =>
          Box({
            key: `ready-${r.id}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              text(r.id),
              text(r.title, { wrap: 'truncate-end' }),
              text(r.lane === LEAD ? "the lead's own" : (r.lane ?? ''), { dimColor: true }),
            ],
          }),
        ),
      ]
    : [text('Nothing is ready to start.', { dimColor: true })];
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      ...notes,
      Box({ flexDirection: 'column', children: rows }),
      Box({ flexDirection: 'column', children: ready }),
    ],
  });
}
