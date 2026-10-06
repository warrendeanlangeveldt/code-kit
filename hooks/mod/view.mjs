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

// --- the band, and the person's acts -----------------------------------------------------------

export const APPROVE_ID = 'code-kit-approve';
export const RESULT_ID = 'code-kit-result';

/** An approval name as a person reads it: a dependency approval by its package. */
export function approvalLabel(name) {
  return name.startsWith('dep-') ? name.slice(4).replaceAll('+', '/') : name;
}

/** A command as a person reads it: the part before its pipes, redirects and chained commands. */
export function commandItself(command) {
  return String(command)
    .split(/\s+(?:\d?>>?&?\d*|\|\|?|&&|;)(?:\s|$)/)[0]
    .trim();
}

/** The reason an Approve… confirmation starts with (ACT-1). */
export function prefilledReason(request) {
  return `Approve ${request.names.map(approvalLabel).join(', ')} for ${
    request.lane ? `the ${request.lane} lane` : 'any agent'
  }: ${commandItself(request.what)}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The band's lines (BAND-2): one per kind of thing waiting, each with its actions, and none when
 * nothing waits. `reviewing` holds the stories the person has asked the lead to review (ACT-3);
 * `notice` is why the person's last act failed, until they dismiss it.
 */
export function bandLines({ state, requests, stops, reviewing = new Set(), notice = null }) {
  const lines = [];
  if (notice)
    lines.push({ kind: 'notice', text: notice, actions: [{ id: 'dismiss', label: 'Dismiss' }] });
  if (!state || state.kind !== 'ok') return lines;
  const open = requests?.open ?? [];
  if (open.length)
    lines.push({
      kind: 'approvals',
      text: `${plural(open.length, 'approval', 'approvals')} waiting`,
      request: open[0],
      actions: [{ id: 'approve', label: 'Approve…' }],
    });
  const inReview = state.lanes.filter((l) => l.state === 'in review').map((l) => l.story);
  if (inReview.length) {
    const [story] = inReview;
    const ids = inReview.map((s) => s.id).join(', ');
    lines.push(
      reviewing.has(story.id)
        ? { kind: 'review', text: `${story.id} being reviewed`, story, actions: [] }
        : {
            kind: 'review',
            text: `${ids} ready for review`,
            story,
            actions: [
              { id: 'review', label: 'Review' },
              { id: 'merge', label: 'Merge' },
            ],
          },
    );
  }
  if (stops?.length)
    lines.push({
      kind: 'finish',
      text: `Finish check failing: ${stops[0].title}${stops.length > 1 ? ` (and ${stops.length - 1} more)` : ''}`,
      actions: [{ id: 'lanes', label: 'Lanes' }],
    });
  // BAND-4: a digit for every action, in the order they're drawn.
  let digit = 0;
  for (const line of lines)
    for (const action of line.actions) action.hotkey = digit < 9 ? String(++digit) : undefined;
  return lines;
}

/** The band, drawn with the elements `$.ui.resolve(e)` returned; `onAction(id, line)` acts. */
export function band(lines, { Box, Text, Button }, onAction) {
  const COLOR = { notice: 'red', approvals: 'yellow', review: 'blue', finish: 'red' };
  return Box({
    flexDirection: 'column',
    children: lines.map((line) =>
      Box({
        key: `band-${line.kind}`,
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Text({ color: COLOR[line.kind], children: ['code-kit'] }),
          Text({ children: [line.text] }),
          ...line.actions.map((a) =>
            Button({
              key: `band-${a.id}`,
              label: a.hotkey ? `${a.hotkey} ${a.label}` : a.label,
              hotkey: a.hotkey,
              onPress: () => onAction(a.id, line),
            }),
          ),
        ],
      }),
    ),
  });
}

/** The Approve… confirmation (ACT-1): what it grants, to whom, for how long, and the reason. */
export function approvePane(
  approving,
  { Box, Text, Input, Button },
  { onInput, onSubmit, onCancel },
) {
  const { request, reason, error } = approving;
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Text({ bold: true, children: [`Approve ${request.names.join(', ')}`] }),
      Text({
        children: [
          `For ${request.lane ? `the ${request.lane} lane` : 'any agent'}, for 60 minutes. Asked for: ${request.what}`,
        ],
      }),
      Input({
        key: 'approve-reason',
        label: 'Reason',
        value: reason,
        submitLabel: 'Approve',
        autoFocus: true,
        onInput,
        onSubmit,
      }),
      ...(error ? [Text({ color: 'red', children: [error] })] : []),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'approve-confirm', label: 'Approve', onPress: () => onSubmit(reason) }),
          Button({ key: 'approve-cancel', label: 'Cancel', onPress: onCancel }),
        ],
      }),
    ],
  });
}

/** What a merge (or another act run through the CLI) reported. */
export function resultPane(result, { Box, Text }) {
  if (!result) return Text({ dimColor: true, children: ['Nothing to show.'] });
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Text({ bold: true, color: result.ok ? 'green' : 'red', children: [result.title] }),
      Text({ children: [result.text.slice(-9000) || '(no output)'] }),
    ],
  });
}

// --- refusal cards and the commands ------------------------------------------------------------

const APPROVAL_LINE =
  /^\s*! echo "<what you are approving>" > .*?\.claude\/approvals\/(?:([^/\s]+)\/)?([^/\s]+)\s*$/gm;

/**
 * A code-kit refusal read back from the text its hooks print (CARD-1): what was refused, the rule and
 * why, what to do, and the approval that would allow it, if any. Null for text it doesn't recognise,
 * which Claude Code then draws as it would.
 */
export function refusalCard(raw) {
  const at = typeof raw === 'string' ? raw.indexOf('Blocked: ') : -1;
  if (at < 0) return null;
  const text = raw.slice(at + 'Blocked: '.length).trim();
  const [first, ...rest] = text.split('\n');
  const approvals = [...text.matchAll(APPROVAL_LINE)];
  const command = text.match(/^Command: (.+)$/m)?.[1] ?? null;
  const request = (what) =>
    approvals.length
      ? { names: approvals.map((m) => m[2]), lane: approvals[0][1] ?? null, what }
      : null;
  let m = first.match(/^The (.+?) may not write (\S+?)(?: \(owned by the (.+)\))?\.$/);
  if (m)
    return {
      kind: 'write',
      title: `Write refused: ${m[2]}`,
      why: m[3] ? `It's owned by the ${m[3]}, not the ${m[1]}.` : `Nobody may write it.`,
      todo: rest.find((l) => l.trim()) ?? '',
      request: null,
      raw: text,
    };
  m = first.match(/^(\S+) is (.+) and needs a person's approval\./);
  if (m)
    return {
      kind: 'approval',
      title: `Approval needed: ${m[1]}`,
      why: `It's ${m[2]}.`,
      todo: 'A person approves it, here or with the `!` command, for 60 minutes.',
      request: request(`write ${m[1]}`),
      raw: text,
    };
  m = first.match(/^a new dependency \((.+?)\) needs a person's approval\./);
  if (m)
    return {
      kind: 'dependency',
      title: `Install refused: ${m[1]}`,
      why: "A new dependency needs a person's approval.",
      todo: 'A person approves it, here or with the `!` command, for 60 minutes.',
      request: request(command ?? `install ${m[1]}`),
      raw: text,
    };
  if (command)
    return {
      kind: 'command',
      title: 'Command refused',
      why: first,
      todo: rest.filter((l) => l.trim() && !l.startsWith('Command: ')).join(' '),
      command,
      request: request(command),
      raw: text,
    };
  return null;
}

/** A refusal card (CARD-1), with Approve… where an approval would allow it and the raw text a press away. */
export function refusalView(card, expanded, { Box, Text, Button }, { onApprove, onToggle }) {
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    paddingX: 1,
    children: [
      Text({ bold: true, color: 'red', children: [card.title] }),
      Text({ children: [card.why] }),
      ...(card.command ? [Text({ dimColor: true, children: [card.command] })] : []),
      ...(card.todo ? [Text({ dimColor: true, children: [card.todo] })] : []),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          ...(card.request
            ? [Button({ key: 'card-approve', label: 'Approve…', onPress: onApprove })]
            : []),
          Button({
            key: 'card-raw',
            label: expanded ? 'Hide the text' : 'Show the text',
            plain: true,
            onPress: onToggle,
          }),
        ],
      }),
      ...(expanded ? [Text({ dimColor: true, children: [card.raw] })] : []),
    ],
  });
}

/** `/approvals` (CARD-2): the open requests and the approvals in force, from `requests --json`. */
export function approvalsText(requests) {
  const open = requests?.open ?? [];
  const inForce = requests?.inForce ?? [];
  const lines = [
    open.length ? `${plural(open.length, 'request', 'requests')} waiting:` : 'No requests waiting.',
    ...open.map(
      (r) =>
        `  ${r.names.map(approvalLabel).join(', ')} for ${r.lane ? `the ${r.lane} lane` : 'any agent'}: ${r.what}`,
    ),
    inForce.length
      ? `${plural(inForce.length, 'approval', 'approvals')} in force:`
      : 'No approvals in force.',
    ...inForce.map(
      (a) =>
        `  ${approvalLabel(a.name)} for ${a.lane ? `the ${a.lane} lane` : 'any agent'}, ${a.minutesLeft} min left: ${a.reason}`,
    ),
  ];
  return lines.join('\n');
}
