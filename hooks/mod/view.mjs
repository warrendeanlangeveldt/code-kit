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
 *   sent back  a review sent the branch back, and the lane hasn't committed its fix yet;
 *   blocked    the lane's next story waits on another;
 *   idle       none of these.
 * `status` can't tell a finished branch from one still being built, so the agent at work decides.
 */
function laneRow(name, agent, stories, atWork) {
  const own = stories.filter((s) => s.lane === name);
  const active = Boolean(agent && atWork.has(agent));
  const story = own.find((s) => ['in progress', 'review', 'sent back'].includes(s.state));
  if (story?.state === 'sent back')
    return { name, agent, active, story, branch: story.branch, state: 'sent back' };
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
 *   { kind: 'ok', lanes, ready, planGaps, stories }  a row per lane, what's ready, the plan's gaps (or
 *                                                     null), and each story's id, lane and state
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
  return {
    kind: 'ok',
    lanes,
    ready,
    planGaps: status ? (status.problems ?? []).length : null,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      lane: s.lane,
      state: s.state,
      branch: s.branch ?? null,
      worktree: s.worktree ?? null,
      requirements: s.requirements ?? [],
    })),
  };
}

const STATE_COLOR = {
  building: 'blue',
  'in review': 'yellow',
  'sent back': 'magenta',
  blocked: 'red',
  idle: undefined,
};

/**
 * The Lanes pane's body, drawn with the elements `$.ui.resolve(e)` returned; `usage` is
 * usageSummary's, `plan` planOf's (USE-2), either null before there is any.
 */
export function lanesPane(state, { Box, Text }, usage = null, plan = null, loop = null) {
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
            ...(loop?.laneNotes?.[l.name]
              ? [
                  text(loop.laneNotes[l.name], {
                    color: loop.laneNotes[l.name] === 'stalled' ? 'red' : 'yellow',
                  }),
                ]
              : []),
            ...(usage?.lanes[l.name]
              ? [text(tokens(usage.lanes[l.name]), { dimColor: true })]
              : []),
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
      ...usageSection(usage, plan, text, Box),
      ...reviewsSection(loop, text, Box),
      ...loopSection(loop, text, Box),
    ],
  });
}

/** How long ago, as a person reads it: now, 40s ago, 12m ago, 2h ago. */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** REVW-1: each branch's background review, running with its clock, or what it found. */
function reviewsSection(loop, text, Box) {
  const reviews = loop?.reviews ?? [];
  if (!reviews.length) return [];
  const said = (r) =>
    r.state === 'running'
      ? `running ${ago(loop.now - r.startedAt).replace(' ago', '')}`
      : r.state === 'done'
        ? `done · ${r.summary}`
        : r.state === 'skipped'
          ? `skipped: ${r.why}`
          : `failed: ${r.error}`;
  return [
    Box({
      flexDirection: 'column',
      children: [
        text('Reviews', { bold: true }),
        ...reviews.map((r) =>
          Box({
            key: `review-${r.branch}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              text(r.branch),
              text(said(r), {
                color: r.blockers ? 'red' : r.state === 'running' ? 'blue' : undefined,
                dimColor: r.state === 'skipped',
              }),
            ],
          }),
        ),
      ],
    }),
  ];
}

/** The loop's record (spec 05): its state and its latest steps, newest first. */
function loopSection(loop, text, Box) {
  if (!loop || (!loop.steps?.length && loop.state !== 'paused')) return [];
  const steps = [...(loop.steps ?? [])].reverse().slice(0, 8);
  return [
    Box({
      flexDirection: 'column',
      children: [
        text(`Loop · ${loop.state === 'paused' ? 'paused' : loop.autonomy}`, { bold: true }),
        ...steps.map((s, i) =>
          Box({
            key: `step-${i}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              text(ago(loop.now - s.at).padEnd(8), { dimColor: true }),
              text(s.kind.padEnd(8)),
              text(s.target, { wrap: 'truncate-end' }),
            ],
          }),
        ),
      ],
    }),
  ];
}

/** USE-2: the plan's 5-hour use as a bar, each story's tokens, and the background agents' share. */
function usageSection(usage, plan, text, Box) {
  const lines = [];
  if (plan?.percent != null)
    lines.push(
      Box({
        key: 'usage-plan',
        flexDirection: 'row',
        columnGap: 2,
        children: [
          text('Plan'),
          text(planBar(plan.percent), { color: plan.paused ? 'red' : 'green' }),
          text(`${plan.percent}% of the 5-hour window`, { dimColor: true }),
          ...(plan.paused ? [text('background agents paused', { color: 'red' })] : []),
        ],
      }),
    );
  if (usage?.total) {
    const flagged = new Map(usage.outliers.map((o) => [o.id, o.ratio]));
    for (const [id, n] of Object.entries(usage.stories).sort((a, b) => b[1] - a[1]))
      lines.push(
        Box({
          key: `usage-${id}`,
          flexDirection: 'row',
          columnGap: 2,
          children: [
            text(id),
            text(tokens(n), { dimColor: true }),
            ...(flagged.has(id)
              ? [text(`${flagged.get(id)}× the usual`, { color: 'yellow' })]
              : []),
          ],
        }),
      );
    if (usage.background)
      lines.push(
        text(
          `Background agents  ${tokens(usage.background)} (${Math.round((usage.background / usage.total) * 100)}%)`,
          { dimColor: true },
        ),
      );
    lines.push(text(`This session  ${tokens(usage.total)} tokens`, { dimColor: true }));
  }
  return lines.length
    ? [Box({ flexDirection: 'column', children: [text('Usage', { bold: true }), ...lines] })]
    : [];
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

/** What a held call would do, as a person reads it (HOLD-2): "install dayjs", "commit docs/brief.md". */
export function heldVerb(call) {
  if (call.kind === 'dependency') return `install ${call.names.map(approvalLabel).join(', ')}`;
  if (call.kind === 'kit') return 'change the .claude kit';
  return call.what;
}

/** Minutes and seconds left, as 1:53. */
export function timeLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const sameAsk = (a, b) =>
  a.names.join(',') === b.names.join(',') && (a.lane ?? null) === (b.lane ?? null);

/**
 * The band's lines (BAND-2): one per kind of thing waiting, each with its actions, and none when
 * nothing waits. `reviewing` holds the stories the person has asked the lead to review (ACT-3);
 * `notice` is why the person's last act failed, until they dismiss it. `usage` (usageSummary's) flags
 * outliers (USE-3), and `plan` (planOf's) says when background agents are paused (USE-4).
 */
export function bandLines({
  state,
  requests,
  stops,
  reviewing = new Set(),
  notice = null,
  usage = null,
  plan = null,
  held = [],
  now = 0,
  loop = null,
}) {
  const lines = [];
  if (notice)
    lines.push({ kind: 'notice', text: notice, actions: [{ id: 'dismiss', label: 'Dismiss' }] });
  if (!state || state.kind !== 'ok') return lines;
  // HOLD-2: calls held for the person, oldest first, with the time left on the oldest.
  if (held.length) {
    const [call] = [...held].sort((a, b) => a.since - b.since);
    const left = timeLeft(call.since + call.minutes * 60000 - now);
    lines.push({
      kind: 'held',
      text: `${held.length > 1 ? `${held.length} calls held: ` : ''}${call.who} wants to ${heldVerb(call)} · ${left}`,
      held: call,
      actions: [
        { id: 'approveHeld', label: 'Approve' },
        { id: 'refuseHeld', label: 'Refuse' },
      ],
    });
  }
  // LOOP-3: a lane stalled past its restarts waits for the person.
  for (const f of loop?.flagged ?? [])
    lines.push({
      kind: 'stalled',
      text: `${f.lane} stalled ${f.count} times on ${f.story}`,
      stall: f,
      actions: [
        { id: 'lanes', label: 'Lanes' },
        { id: 'resumeStall', label: 'Resume' },
      ],
    });
  // LOOP-5: under autonomy propose, each step waits for Go.
  if (loop?.proposal)
    lines.push({
      kind: 'proposal',
      text: `${loop.proposal.label}?`,
      actions: [{ id: 'go', label: 'Go' }],
    });
  // A held call's request is asked on its own line above, not again here.
  const open = (requests?.open ?? []).filter((r) => !held.some((h) => sameAsk(h, r)));
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
  if (usage?.outliers.length) {
    const [top] = usage.outliers;
    const more = usage.outliers.length - 1;
    lines.push({
      kind: 'usage',
      text: `${top.id} has used ${top.ratio}× the usual${more ? ` (and ${more} more)` : ''}`,
      actions: [{ id: 'lanes', label: 'Lanes' }],
    });
  }
  if (plan?.paused)
    lines.push({
      kind: 'paused',
      text: `background agents paused: plan at ${plan.percent}%`,
      actions: [],
    });
  // LOOP-7: the milestone is done; LOOP-6: the loop's own state, with Pause or Resume.
  if (loop?.state === 'done')
    lines.push({
      kind: 'done',
      text: `Milestone done: ${plural(loop.doneCount, 'story', 'stories')} merged`,
      actions: [{ id: 'dismissDone', label: 'Dismiss' }],
    });
  else if (loop?.state === 'paused')
    lines.push({ kind: 'loop', text: 'loop paused', actions: [{ id: 'resume', label: 'Resume' }] });
  else if (loop?.state === 'running' && loop.started)
    lines.push({
      kind: 'loop',
      text: `loop on${loop.last ? ` · last: ${loop.last}` : ''}`,
      actions: [{ id: 'pause', label: 'Pause' }],
    });
  // BAND-4: a digit for every action, in the order they're drawn.
  let digit = 0;
  for (const line of lines)
    for (const action of line.actions) action.hotkey = digit < 9 ? String(++digit) : undefined;
  return lines;
}

/** The band, drawn with the elements `$.ui.resolve(e)` returned; `onAction(id, line)` acts. */
export function band(lines, { Box, Text, Button }, onAction) {
  const COLOR = {
    notice: 'red',
    held: 'yellow',
    stalled: 'red',
    proposal: 'cyan',
    loop: 'green',
    done: 'green',
    approvals: 'yellow',
    review: 'blue',
    finish: 'red',
    usage: 'yellow',
    paused: 'yellow',
  };
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
          `For ${request.lane ? `the ${request.lane} lane` : 'any agent'}, ${request.names.every((n) => n.startsWith('dep-')) ? 'until the install is committed (at most 7 days)' : 'for 60 minutes'}. Asked for: ${request.what}`,
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
  m = first.match(/^(\S+) is (.+); committing it needs a person's approval in force\./);
  if (m)
    return {
      kind: 'approval',
      title: `Commit refused: ${m[1]}`,
      why: `It's ${m[2]}.`,
      todo: 'A person approves it, here or with the `!` command, for 60 minutes.',
      request: request(`commit ${m[1]}`),
      raw: text,
    };
  if (/^the \.claude kit is changed only by the lead or with a person's approval\./.test(first))
    return {
      kind: 'kit',
      title: 'Kit edit refused',
      why: "The .claude kit is changed only by the lead or with a person's approval.",
      todo: 'A person approves it, here or with the `!` command, for 60 minutes.',
      request: request('change the .claude kit'),
      raw: text,
    };
  m = first.match(/^a new dependency \((.+?)\) needs a person's approval\./);
  if (m)
    return {
      kind: 'dependency',
      title: `Install refused: ${m[1]}`,
      why: "A new dependency needs a person's approval.",
      todo: 'A person approves it, here or with the `!` command, until the install is committed (at most 7 days).',
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

// --- the harness settings (SET-2) --------------------------------------------------------------

export const SETTINGS_ID = 'code-kit-settings';
const CHOICES = {
  autonomy: ['autonomous', 'propose', 'off'],
  'agents.reviewer.model': ['', 'haiku', 'sonnet', 'opus'],
};
const shown = (v) =>
  v === null || v === '' ? "the session's" : v === true ? 'on' : v === false ? 'off' : String(v);

/**
 * The Settings view: each setting from `code-kit settings --json` with a control, and, once one is
 * changed, a confirmation asking the person's reason before anything is written.
 */
export function settingsView(rows, pending, { Box, Text, Select, Input, Button }, handlers) {
  const control = (r) => {
    const listed = CHOICES[r.key] ?? (typeof r.default === 'boolean' ? [true, false] : null);
    // A value the list doesn't name (a model given by its id) is still shown, as the one chosen.
    const choices =
      listed && !listed.map(String).includes(String(r.value ?? '')) ? [...listed, r.value] : listed;
    if (choices)
      return Select({
        key: `set-${r.key}`,
        label: '',
        value: String(r.value ?? ''),
        options: choices.map((c) => ({ value: String(c), label: shown(c) })),
        onSelect: (v) => handlers.onChoose(r.key, v === '' ? 'null' : v),
      });
    return Input({
      key: `set-${r.key}`,
      label: '',
      value: String(r.value),
      submitLabel: 'Set',
      onSubmit: (v) => handlers.onChoose(r.key, v.trim()),
    });
  };
  const rowsView = rows.map((r) =>
    Box({
      key: `setting-${r.key}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Box({ width: 28, children: [Text({ bold: true, children: [r.key] })] }),
            control(r),
            ...(r.value !== r.default
              ? [Text({ dimColor: true, children: [`default ${shown(r.default)}`] })]
              : []),
          ],
        }),
        Text({ dimColor: true, children: [`  ${r.about}`] }),
      ],
    }),
  );
  const confirm = pending
    ? [
        Box({
          key: 'settings-confirm',
          flexDirection: 'column',
          borderStyle: 'round',
          paddingX: 1,
          children: [
            Text({
              bold: true,
              children: [
                `Set ${pending.key} to ${shown(pending.value === 'null' ? null : pending.value)}?`,
              ],
            }),
            Text({
              dimColor: true,
              children: [
                'It goes into .claude/code-kit.json, and the approval log keeps your reason.',
              ],
            }),
            Input({
              key: 'settings-reason',
              label: 'Reason',
              value: pending.reason,
              submitLabel: 'Change it',
              autoFocus: true,
              onInput: handlers.onReason,
              onSubmit: handlers.onConfirm,
            }),
            ...(pending.error ? [Text({ color: 'red', children: [pending.error] })] : []),
            Box({
              flexDirection: 'row',
              columnGap: 2,
              children: [
                Button({
                  key: 'settings-ok',
                  label: 'Change it',
                  onPress: () => handlers.onConfirm(pending.reason),
                }),
                Button({ key: 'settings-cancel', label: 'Cancel', onPress: handlers.onCancel }),
              ],
            }),
          ],
        }),
      ]
    : [];
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Text({ bold: true, color: 'cyan', children: ['HARNESS SETTINGS'] }),
      ...confirm,
      Box({ flexDirection: 'column', children: rowsView }),
      Text({
        dimColor: true,
        children: ['Lanes, paths, layers and protected paths change through /code-kit:init.'],
      }),
    ],
  });
}

// --- usage per lane (USE-1 to USE-4) -----------------------------------------------------------

const STORY_ID = /\bST-\d+\b/;

/** A model request's tokens: input (cache writes included), output and cache reads. */
export function tokensOf(usage) {
  return {
    input: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
    output: usage?.output_tokens ?? 0,
    cache: usage?.cache_read_input_tokens ?? 0,
  };
}

/**
 * Whom a model request is for (USE-1): the lead when no agent made it; a lane's agent by its type,
 * on the story its brief names or else the story its lane is on; any other agent is background.
 * `agent` is the `$.agent.list()` entry, or null when the list no longer has it.
 */
export function attribution(agentId, agent, check, state) {
  const laneStory = (name) => state?.lanes?.find((l) => l.name === name)?.story?.id ?? null;
  if (!agentId) return { key: 'lead', lane: LEAD, story: laneStory(LEAD), background: false };
  const lane = Object.entries(check?.lanes ?? {}).find(([, l]) => l.agent === agent?.type)?.[0];
  const named = agent?.description?.match(STORY_ID)?.[0] ?? null;
  if (!lane) return { key: agentId, lane: null, story: named, background: true };
  return { key: agentId, lane, story: named ?? laneStory(lane), background: false };
}

/** The ledger with one request added: entries by agent and story, their tokens summed. */
export function withUsage(ledger, who, usage) {
  const id = `${who.key}|${who.story ?? ''}`;
  const t = tokensOf(usage);
  const was = ledger[id] ?? { ...who, input: 0, output: 0, cache: 0 };
  return {
    ...ledger,
    [id]: {
      ...was,
      input: was.input + t.input,
      output: was.output + t.output,
      cache: was.cache + t.cache,
    },
  };
}

const total = (e) => e.input + e.output + e.cache;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The stories finished: done, or their lane's branch waiting for review. */
export function finishedStories(state) {
  if (state?.kind !== 'ok') return new Set();
  return new Set([
    ...(state.stories ?? []).filter((s) => s.state === 'done').map((s) => s.id),
    ...state.lanes.filter((l) => l.state === 'in review').map((l) => l.story.id),
  ]);
}

/**
 * The session's usage rolled up (USE-1, USE-2): tokens per lane, per story and for the background
 * agents, and the outliers (USE-3), stories past three times the median of the finished ones once
 * at least three have finished.
 */
export function usageSummary(ledger, finished = new Set()) {
  const lanes = {};
  const stories = {};
  let background = 0;
  let all = 0;
  for (const e of Object.values(ledger ?? {})) {
    const n = total(e);
    all += n;
    if (e.background) background += n;
    else lanes[e.lane] = (lanes[e.lane] ?? 0) + n;
    if (e.story) stories[e.story] = (stories[e.story] ?? 0) + n;
  }
  const done = Object.entries(stories).filter(([id]) => finished.has(id));
  const usual = done.length >= 3 ? median(done.map(([, n]) => n)) : null;
  const outliers = usual
    ? Object.entries(stories)
        .filter(([, n]) => n > 3 * usual)
        .map(([id, n]) => ({ id, ratio: Math.round((n / usual) * 10) / 10 }))
        .sort((a, b) => b.ratio - a.ratio)
    : [];
  return { lanes, stories, background, total: all, outliers };
}

/** The plan's 5-hour use from the session's limits (null off a subscription), and the pause (USE-4). */
export function planOf(rateLimits, pauseAtPercent = 80) {
  const percent = (rateLimits ?? []).find((r) => r.kind === 'five_hour')?.percentUsed ?? null;
  return { percent, paused: percent !== null && percent > pauseAtPercent };
}

/** Tokens as a person reads them: 950, 12k, 1.4M. */
export function tokens(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** The plan's use as a bar of ten cells. */
export function planBar(percent) {
  const full = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${'█'.repeat(full)}${'░'.repeat(10 - full)}`;
}
