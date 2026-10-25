// What the code-kit mod shows, as pure functions of the CLI's JSON: the mod's hooks run the CLI and
// pass its output here, and pass the elements `$.ui.resolve` gives them. Nothing here touches the mods
// API, files or processes, so it is tested with node as well as with `claude plugin test`.

export const PANE_ID = 'code-kit-lanes';
export const NOT_CODE_KIT = "This project doesn't use code-kit.";
const LEAD = 'lead';

/** A CLI run's stdout as JSON, or null when it printed none. */
import { BAR, POSE_GLYPH, rasterCells, runs, sprite, spriteSvg, timelineSvg } from './art.mjs';
import { missionLines, nextText } from './mission.mjs';
import { teamLines } from './teamview.mjs';

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
 *   waiting on you  the lane's story waits on the person's answer (ASK-3);
 *   blocked    the lane's next story waits on another;
 *   idle       none of these.
 * `status` can't tell a finished branch from one still being built, so the agent at work decides.
 */
function laneRow(name, agent, stories, atWork) {
  const own = stories.filter((s) => s.lane === name);
  const active = Boolean(agent && atWork.has(agent));
  const story = own.find((s) =>
    ['in progress', 'review', 'sent back', 'waiting on you'].includes(s.state),
  );
  if (story?.state === 'waiting on you')
    return { name, agent, active, story, branch: story.branch, state: 'waiting on you' };
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
      waitingOn: s.waitingOn ?? [],
      // LOOP-13: a parked story watches the stories building on it.
      dependsOn: s.dependsOn ?? [],
      milestone: s.milestone ?? null,
    })),
  };
}

export const STATE_COLOR = {
  building: 'blue',
  working: 'green',
  orchestrating: 'yellow',
  'in review': 'yellow',
  'sent back': 'magenta',
  'waiting on you': 'cyan',
  blocked: 'red',
  idle: undefined,
};

/**
 * A lane's state as the pane shows it: `queued` while its branch waits in the merge queue (MQ-4), and
 * `working` while its agent (or the lead, mid-turn) is at work on nothing the plan names.
 */
export function shownState(lane, queue = []) {
  // LANES-2: the lead mid-turn is orchestrating unless it builds its own story; between turns, a story
  // of its own that waits on another is the story's state, not the lead's.
  if (lane.name === LEAD && lane.active && lane.state !== 'building') return 'orchestrating';
  if (lane.name === LEAD && lane.state === 'blocked') return 'idle';
  if (lane.state === 'idle' && lane.active) return 'working';
  const waiting = queue.some(
    (e) => e.branch === lane.branch && ['waiting', 'merging'].includes(e.state),
  );
  return lane.branch && waiting ? 'queued' : lane.state;
}

// Delivery stages are derived only from CodeKit's actual story/queue state. These
// indicate workflow position, NOT test success, policy approval or release readiness.
// In particular, a story in review may still fail its acceptance criteria.
export const LANE_PHASES = ['Plan', 'Build', 'Review', 'Queue', 'Merge'];
export function lanePhase(state) {
  const phase = {
    ready: 0,
    blocked: 0,
    'waiting on you': 0,
    building: 1,
    working: 1,
    orchestrating: 1,
    'sent back': 1,
    'in review': 2,
    queued: 3,
    merged: 4,
  };
  return Object.hasOwn(phase, state) ? phase[state] : null;
}

/**
 * The Lanes tab's body, drawn with the elements `$.ui.resolve(e)` returned; `usage` is
 * usageSummary's, `plan` planOf's (USE-2), either null before there is any. `lanesOf` narrows and
 * marks the rows (VIEW-1, VIEW-6): { filter, search, selected }, and `live` is each lane's last tool
 * call (VIEW-4): { [lane]: { tool, ago, level } }, level null, 'quiet' or 'stalled'.
 */
export function lanesPane(
  state,
  els,
  usage = null,
  plan = null,
  loop = null,
  {
    filter = null,
    search = '',
    selected = null,
    live = {},
    art = null,
    combined = null,
    detail = null,
    columns = 80,
  } = {},
) {
  const { Box, Text } = els;
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!state || state.kind === 'none') return text(NOT_CODE_KIT, { dimColor: true });
  if (state.kind === 'invalid')
    return text('The config is invalid: run code-kit check.', { color: 'red' });
  const width = Math.max(...state.lanes.map((l) => l.name.length));
  // VIEW-3: the lane's character: half-block cells in the terminal, SVG on Desktop, its glyph elsewhere.
  const character = (l) => {
    const pose = art.poses[l.name] ?? 'idle';
    const lead = l.name === LEAD;
    if (art.surface === 'terminal' && els.Raster)
      return els.Raster({
        key: `char-${l.name}`,
        columns: 6,
        rows: 3,
        cells: rasterCells(sprite(pose, art.frame, art.tints[l.name], { lead })),
      });
    if (els.Svg)
      return els.Svg({
        source: spriteSvg(pose, art.tints[l.name], { lead }),
        alt: `${l.name}: ${pose}`,
        width: 24,
        height: 24,
        ...(pose === 'working' ? { isInteractive: true } : {}),
      });
    return text(POSE_GLYPH[pose]);
  };
  // VIEW-2: the lane's story on the shared time axis.
  const bar = (l) => {
    const cells = art?.bars?.[l.name];
    if (!cells) return [];
    if (art.surface !== 'terminal' && els.Svg)
      return [
        els.Svg({
          source: timelineSvg([{ cells, active: l.active }], { width: art.svgWidth ?? 480 }),
          alt: `${l.name}'s timeline`,
        }),
      ];
    return [
      Box({
        key: `bar-${l.name}`,
        flexDirection: 'row',
        children: [
          text('    '),
          ...runs(cells).map((run) =>
            text(
              BAR[run.kind].glyph.repeat(run.n),
              BAR[run.kind].color ? { color: BAR[run.kind].color } : {},
            ),
          ),
        ],
      }),
    ];
  };
  const inQueue = new Set(
    (loop?.queue ?? [])
      .filter((e) => ['waiting', 'merging'].includes(e.state))
      .map((e) => e.branch),
  );
  // MQ-4: a branch in the merge queue is shown as queued, not as waiting for review.
  const queued = (l) => Boolean(l.branch && inQueue.has(l.branch));
  const needle = search.trim().toLowerCase();
  const shown = state.lanes.filter(
    (l) =>
      (!filter || shownState(l, loop?.queue) === filter) &&
      (!needle ||
        [l.name, l.agent, l.story?.id, l.story?.title, l.branch]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(needle))),
  );
  const LIVE = { quiet: 'yellow', stalled: 'red' };
  // LANES-2: fixed columns that never wrap: name, state, then the story (and the agent's current tool
  // beneath it), then tokens; another tool's facts only when they aren't zero.
  const STATE_WIDTH = 13;
  // Flightdeck-inspired presentation lives inside the *existing* Lanes tab.
  // Preserve the dense original rows when the terminal / inline pane is narrow.
  const detailedCards = Boolean(art && columns >= 92);
  const rows = shown.map((l) => {
    const s = shownState(l, loop?.queue);
    const facts = combined?.[l.name];
    const chips = [
      ...(facts?.without
        ? [text(`${facts.without} edited without understanding`, { color: 'red' })]
        : []),
      ...(facts?.owed
        ? [text(`${facts.owed} card${facts.owed === 1 ? '' : 's'} owed`, { color: 'yellow' })]
        : []),
      ...(loop?.laneNotes?.[l.name]
        ? [
            text(loop.laneNotes[l.name], {
              color: loop.laneNotes[l.name] === 'stalled' ? 'red' : 'yellow',
            }),
          ]
        : []),
    ];
    const story = l.story
      ? `${l.story.id} ${l.story.title}${
          l.story.state === 'blocked' && l.story.waitingOn?.length
            ? ` · waits on ${l.story.waitingOn.join(', ')}`
            : l.branch
              ? ` · ${l.branch}`
              : ''
        }${l.story.slice ? ` · slice ${l.story.slice}` : ''}`
      : l.name === LEAD
        ? 'the main session'
        : (l.agent ?? '');
    const lines = [
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(l.name === selected ? '›' : l.active ? '●' : ' ', {
            color: l.name === selected ? 'cyan' : 'green',
          }),
          text(l.name.padEnd(width), {
            bold: true,
            ...(l.name === selected ? { color: 'cyan' } : {}),
          }),
          text(
            s.padEnd(STATE_WIDTH),
            s === 'queued'
              ? { color: 'cyan' }
              : STATE_COLOR[s]
                ? { color: STATE_COLOR[s] }
                : { dimColor: true },
          ),
          Box({
            flexGrow: 1,
            flexShrink: 1,
            children: [text(story, { wrap: 'truncate-end', dimColor: !l.story })],
          }),
          ...chips,
          ...(usage?.lanes[l.name]
            ? [text(tokens(usage.lanes[l.name]).padStart(6), { dimColor: true })]
            : []),
        ],
      }),
      // VIEW-4: what its agent is doing now, and since when, beneath the story.
      ...(live[l.name]
        ? [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [
                text(''.padEnd(width + STATE_WIDTH + 3)),
                text(`${live[l.name].tool} · ${live[l.name].ago}`, {
                  wrap: 'truncate-end',
                  ...(LIVE[live[l.name].level]
                    ? { color: LIVE[live[l.name].level] }
                    : { dimColor: true }),
                }),
              ],
            }),
          ]
        : []),
      ...bar(l),
      // LANES-3: the selected lane's stories as cards, then what it owns.
      ...(l.name === selected && detail ? laneDetail(detail, els, width) : []),
    ];
    if (detailedCards) {
      const phase = lanePhase(s);
      const statusColour = s === 'queued' ? 'cyan' : STATE_COLOR[s] ?? 'gray';
      const lastAction = live[l.name];
      // Stages show where the story is, not that tests have passed.
      const phaseRail =
        phase === null || !l.story
          ? []
          : [
              Box({
                key: `flow-${l.name}`,
                flexDirection: 'row',
                flexWrap: 'wrap',
                columnGap: 1,
                children: LANE_PHASES.map((label, index) =>
                  text(
                    `${index < phase ? '■' : index === phase ? '◆' : '·'} ${label}`,
                    index === phase
                      ? { color: statusColour, bold: true }
                      : index < phase
                        ? { color: 'green' }
                        : { dimColor: true },
                  ),
                ),
              }),
            ];
      return Box({
        key: `lane-${l.name}`,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: l.name === selected ? 'cyan' : l.active ? statusColour : 'gray',
        paddingX: 1,
        children: [
          Box({
            key: `lane-heading-${l.name}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              character(l),
              Box({
                flexDirection: 'column',
                flexGrow: 1,
                flexShrink: 1,
                children: [
                  Box({
                    flexDirection: 'row',
                    columnGap: 2,
                    flexWrap: 'wrap',
                    children: [
                      text(`${l.name === selected ? '› ' : ''}${l.name}`, {
                        bold: true,
                        ...(l.name === selected ? { color: 'cyan' } : {}),
                      }),
                      text(s, { color: statusColour }),
                      ...(usage?.lanes[l.name]
                        ? [text(tokens(usage.lanes[l.name]), { dimColor: true })]
                        : []),
                    ],
                  }),
                  text(story, { wrap: 'truncate-end', dimColor: !l.story }),
                ],
              }),
            ],
          }),
          ...(lastAction
            ? [
                text(`↳ ${lastAction.tool} · ${lastAction.ago}`, {
                  wrap: 'truncate-end',
                  ...(LIVE[lastAction.level]
                    ? { color: LIVE[lastAction.level] }
                    : { dimColor: true }),
                }),
              ]
            : []),
          ...phaseRail,
          ...bar(l),
          ...(chips.length
            ? [Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: chips })]
            : []),
          ...(l.name === selected && detail ? laneDetail(detail, els, 0) : []),
        ],
      });
    }
    return art
      ? Box({
          key: `lane-${l.name}`,
          flexDirection: 'row',
          columnGap: 1,
          children: [character(l), Box({ flexDirection: 'column', flexGrow: 1, children: lines })],
        })
      : Box({ key: `lane-${l.name}`, flexDirection: 'column', children: lines });
  });
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
      ...loopCard(loop, els),
      ...notes,
      Box({
        flexDirection: 'column',
        children: rows.length ? rows : [text('No lane matches the filter.', { dimColor: true })],
      }),
      Box({ flexDirection: 'column', children: ready }),
      ...reviewsSection(loop, text, Box),
    ],
  });
}

const CARD_STATE = {
  done: { label: 'merged', color: 'gray' },
  review: { label: 'in review', color: 'yellow' },
  'in progress': { label: 'building', color: 'blue' },
  'sent back': { label: 'sent back', color: 'magenta' },
  'waiting on you': { label: 'waiting on you', color: 'cyan' },
  blocked: { label: 'blocked', color: 'red' },
  ready: { label: 'ready', color: 'green' },
  todo: { label: 'to do', color: 'gray' },
};

/**
 * LANES-3: a lane's stories as cards (id and state, title, requirements, and what it waits on or its
 * branch), wrapping across the pane, then its agent and the paths it owns. `detail` is { agent, owns,
 * stories }.
 */
export function laneDetail(detail, { Box, Text }, indent = 0) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const cards = detail.stories.map((s) => {
    const st = CARD_STATE[s.state] ?? { label: s.state, color: 'gray' };
    return Box({
      key: `card-${s.id}`,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: st.color,
      ...(s.state === 'done' ? { borderDimColor: true } : {}),
      paddingX: 1,
      width: 30,
      children: [
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            text(s.id, { bold: true, dimColor: s.state === 'done' }),
            text(st.label, { color: st.color }),
          ],
        }),
        text(s.title, { wrap: 'truncate-end', dimColor: s.state === 'done' }),
        ...(s.requirements?.length
          ? [text(s.requirements.join(' '), { dimColor: true, wrap: 'truncate-end' })]
          : []),
        ...(s.state === 'blocked' && s.waitingOn?.length
          ? [text(`waits on ${s.waitingOn.join(', ')}`, { color: 'red', wrap: 'truncate-end' })]
          : s.branch && s.state !== 'done'
            ? [text(s.branch, { dimColor: true, wrap: 'truncate-end' })]
            : []),
      ],
    });
  });
  return [
    Box({
      key: 'lane-cards',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 1,
      marginLeft: Math.min(indent + 2, 8),
      children: cards.length
        ? cards
        : [text('No stories in the plan for this lane.', { dimColor: true })],
    }),
    Box({
      key: 'lane-owns',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      marginLeft: Math.min(indent + 2, 8),
      children: [
        ...(detail.agent ? [text('agent', { dimColor: true }), text(detail.agent)] : []),
        text('owns', { dimColor: true }),
        ...(detail.owns.length
          ? detail.owns.map((p) => text(p, { color: 'cyan' }))
          : [text('nothing yet', { dimColor: true })]),
      ],
    }),
  ];
}

/**
 * LANES-1: the loop as a card at the top of the Lanes tab: its mode, then the steps it took, the one
 * running and the one it takes next. None while the loop is off and has taken no step.
 */
export function loopCard(loop, { Box, Text }) {
  if (!loop || (loop.state === 'off' && !loop.steps?.length)) return [];
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const mode =
    loop.state === 'paused'
      ? { word: 'paused', color: 'yellow' }
      : loop.state === 'off'
        ? { word: 'off', color: 'gray' }
        : loop.state === 'done' || loop.state === 'stopped'
          ? { word: 'milestone done', color: 'green' }
          : {
              word:
                loop.autonomy === 'propose'
                  ? 'asks before each step'
                  : 'acts while the lead is idle',
              color: 'green',
            };
  // The step running now has its own chip; the ones before it are what the loop did.
  const steps = [...(loop.steps ?? [])].slice(0, loop.current ? -1 : undefined).slice(-4);
  const chip = (key, value, color, extra = {}) =>
    Box({
      key,
      borderStyle: 'single',
      borderColor: color,
      paddingX: 1,
      children: [text(value, { wrap: 'truncate-end', ...extra })],
    });
  return [
    Box({
      key: 'loop-card',
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'gray',
      paddingX: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            text('loop', { bold: true, color: 'yellow' }),
            text(mode.word, { color: mode.color }),
          ],
        }),
        Box({
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 1,
          children: [
            ...steps.map((s, i) =>
              chip(
                `loop-step-${i}`,
                `${ago(loop.now - s.at).replace(' ago', '')} ${s.kind} ${s.target}`,
                'gray',
                { dimColor: true },
              ),
            ),
            ...(loop.nextText
              ? [chip('loop-next', `next: ${loop.nextText}`, 'cyan', { color: 'cyan' })]
              : []),
          ],
        }),
      ],
    }),
  ];
}

/** How long ago, as a person reads it: now, 40s ago, 12m ago, 2h ago. */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** MQ-4: the merge queue in order, then what it merged or sent back lately. */
export function queueSection(loop, text, Box) {
  const entries = loop?.queue ?? [];
  if (!entries.length) return [];
  const open = entries.filter((e) => ['waiting', 'merging'].includes(e.state));
  const settled = entries
    .filter((e) => !['waiting', 'merging'].includes(e.state))
    .slice(-3)
    .reverse();
  const row = (e, label, style = {}) => {
    const colour = e.state === 'merged' ? 'green' : e.state === 'sent back' ? 'magenta' : 'cyan';
    return Box({
      key: `queue-${e.branch}-${e.state}`,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: colour,
      paddingX: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          flexWrap: 'wrap',
          children: [
            text(label.padEnd(3), { dimColor: true }),
            text(e.branch, { bold: true }),
            text(e.state, style),
          ],
        }),
        // The queue pins the SHA that passed review. Do not imply release CI
        // succeeded here: it is a separate gate with separate evidence.
        ...(e.commit ? [text(`reviewed SHA ${e.commit.slice(0, 12)}`, { dimColor: true })] : []),
        ...(e.reason ? [text(e.reason, { dimColor: true, wrap: 'wrap' })] : []),
      ],
    });
  };
  return [
    Box({
      flexDirection: 'column',
      children: [
        text('Merge queue', { bold: true }),
        ...open.map((e, i) => row(e, `${i + 1}.`, { color: 'cyan' })),
        ...settled.map((e) => row(e, '·', { color: e.state === 'merged' ? 'green' : 'magenta' })),
      ],
    }),
  ];
}

/** REVW-1: each branch's background review, running with its clock, or what it found. */
export function reviewsSection(loop, text, Box) {
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

/** USE-2: the plan's 5-hour use as a bar, each story's tokens, and the background agents' share. */
export function usageSection(usage, plan, text, Box) {
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
    const stories = Object.entries(usage.stories).sort((a, b) => b[1] - a[1]);
    const busiest = Math.max(1, ...stories.map(([, n]) => n));
    // Relative comparison, not a model quota or context window percentage.
    // Every lane's exact token count remains visible beside its bar.
    for (const [id, n] of stories) {
      const filled = Math.min(12, Math.max(0, Math.round((n / busiest) * 12)));
      lines.push(
        Box({
          key: `usage-${id}`,
          flexDirection: 'row',
          columnGap: 2,
          flexWrap: 'wrap',
          children: [
            text(id, { bold: true }),
            text(`${'█'.repeat(filled)}${'░'.repeat(12 - filled)}`, { color: 'cyan' }),
            text(tokens(n), { dimColor: true }),
            ...(flagged.has(id)
              ? [text(`${flagged.get(id)}× the usual`, { color: 'yellow' })]
              : []),
          ],
        }),
      );
    }
    lines.push(text('Bars relative to the highest-token story in this session.', { dimColor: true }));
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
/**
 * CARD-2: open requests as the decisions they are: one per approval and lane, with every file (or
 * command) it was asked for, newest first. Approving it covers them all.
 */
export function approvalAsks(open) {
  const asks = new Map();
  for (const r of open ?? []) {
    const key = `${[...r.names].sort().join(',')}|${r.lane ?? r.actor}`;
    const ask = asks.get(key) ?? { request: r, files: [] };
    if (!ask.files.includes(r.what)) ask.files.push(r.what);
    asks.set(key, ask);
  }
  return [...asks.values()];
}

/** What an approval decision covers, in a line: "contract for the platform lane: a.ts, b.ts (2 files)". */
export function askWords(request, files = [request?.what]) {
  const who = request.lane ? `the ${request.lane} lane` : request.actor;
  const list =
    files.length > 4
      ? `${files.slice(0, 4).join(', ')} and ${files.length - 4} more`
      : files.join(', ');
  return `${request.names.map(approvalLabel).join(', ')} for ${who}: ${list}${files.length > 1 ? ` (${files.length} files)` : ''}`;
}

export function approvalLabel(name) {
  // REG-2: the person's approval to weaken a test.
  if (name === 'tests') return 'a weakened test';
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
  queue = [],
  check = null,
  leadBusy = false,
  live = {},
  nextStep = null,
  combined = null,
  team = null,
  questions = [],
  brief = [],
  reports = [],
  worktrees = [],
  working = false,
  task = null,
  elsewhere = [],
}) {
  const lines = [];
  // MISSION-1: the goal, now, next and the agents at work, above what needs the person. SESS-3: a working
  // session's band holds only its own: no mission, queue, reviews or team.
  const mission = working ? [] : missionLines({ state, loop, leadBusy, live, nextStep, combined });
  lines.push(...mission);
  // SESS-4: a working session's task, or that it records one before changing code.
  if (working)
    lines.push({
      kind: 'task',
      text: task
        ? `your task: ${task.title}${task.paths?.length ? ` · leasing ${task.paths.join(', ')}` : ''}`
        : 'a working session: record your task before changing code (code-kit task "…" --touches …)',
      actions: [],
    });
  if (notice)
    lines.push({ kind: 'notice', text: notice, actions: [{ id: 'dismiss', label: 'Dismiss' }] });
  if (!state || state.kind !== 'ok') return lines;
  // HOLD-2: calls held for the person, oldest first, with the time left on the oldest.
  if (held.length) {
    const calls = [...held].sort((a, b) => a.since - b.since);
    const [call] = calls;
    const left = timeLeft(call.since + call.minutes * 60000 - now);
    lines.push({
      kind: 'held',
      text: `${held.length > 1 ? `${held.length} calls held: ` : ''}${call.who} wants to ${heldVerb(call)} · ${left}`,
      held: call,
      // CARD-8: each held call is its own decision in the Decisions tab.
      calls: calls.map((c) => ({
        held: c,
        text: `${c.who} wants to ${heldVerb(c)} · ${timeLeft(c.since + c.minutes * 60000 - now)}`,
      })),
      actions: [
        { id: 'approveHeld', label: 'Approve' },
        { id: 'refuseHeld', label: 'Refuse' },
      ],
    });
  }
  // OWN-2: a call Claude Code's own permission check refused is the Lanes pane's activity, not a
  // decision: the agent finds another way, or the lead asks the person (`code-kit ask`).
  // LOOP-3, WHO-4: a lane stalled past its restarts is the lead's to sort out; the person sees a note.
  for (const f of loop?.flagged ?? [])
    lines.push({
      kind: 'stalled',
      text: `${f.lane} stalled ${f.count} times on ${f.story}: the lead decides how it goes on`,
      stall: f,
      actions: [{ id: 'lanes', label: 'Lanes' }],
    });
  // LOOP-5: under autonomy propose, each step waits for Go.
  if (loop?.proposal?.first)
    // The first time, the person chooses how hands-off the loop is (until then nothing is taken on its own).
    lines.push({
      kind: 'proposal',
      text: `code-kit can keep the build moving between your prompts. Next: ${loop.proposal.label}.`,
      proposal: loop.proposal,
      actions: [
        { id: 'keepGoing', label: 'Keep going' },
        { id: 'askEach', label: 'Ask each time' },
        { id: 'loopOff', label: 'Off' },
      ],
    });
  else if (loop?.proposal?.repeated)
    // LOOP-8, WHO-4: a step the lead was asked for three times and didn't take is a note, not a decision.
    lines.push({
      kind: 'stuck',
      text: `${loop.proposal.label}: still next after ${loop.proposal.repeated} prompts to the lead`,
      proposal: loop.proposal,
      actions: [{ id: 'go', label: 'Ask again' }],
    });
  else if (loop?.proposal)
    lines.push({
      kind: 'proposal',
      text: `${loop.proposal.label}?`,
      proposal: loop.proposal,
      actions: [{ id: 'go', label: 'Go' }],
    });
  // LOOP-11, LOOP-12: what the loop read in the lead's reply holds it until the person says.
  const waitingLine = waitingOf(loop?.waiting);
  if (waitingLine) lines.push(waitingLine);
  // A held call's request is asked on its own line above, not again here.
  // CARD-2: counted as decisions, not files: one approval for a lane covers every file it was asked for.
  const asks = approvalAsks((requests?.open ?? []).filter((r) => !held.some((h) => sameAsk(h, r))));
  if (asks.length)
    lines.push({
      kind: 'approvals',
      text: `${plural(asks.length, 'approval', 'approvals')} waiting`,
      request: asks[0].request,
      files: asks[0].files,
      // CARD-8: each approval is its own decision in the Decisions tab.
      asks,
      actions: [{ id: 'approve', label: 'Approve…' }],
    });
  // ASK-2: what the lead asked the person and couldn't settle itself.
  if (questions.length)
    lines.push({
      kind: 'question',
      text: `${questions.length > 1 ? `${questions.length} questions from the lead: ` : 'The lead asks: '}${questions[0].question}`,
      question: questions[0],
      questions,
      actions: [{ id: 'openDecision', label: 'Answer…' }],
    });
  // ASK-4: the brief's open questions, the person's to answer.
  if (brief.length && !working)
    lines.push({
      kind: 'brief',
      text: `${plural(brief.length, 'open question', 'open questions')} in your brief: ${brief[0].question}`,
      brief: brief[0],
      briefs: brief,
      actions: [{ id: 'openDecision', label: 'Answer…' }],
    });
  // DECIDE-1: reviewing a lane's work is the lead's. Only with the loop off, where the person runs the
  // build themselves, does a finished story wait in the band for their Review or Merge; otherwise the
  // loop prompts the lead (or, under propose, offers the step with Go).
  const loopOff = (check?.harness?.autonomy ?? 'autonomous') === 'off';
  const inReview = loopOff
    ? state.lanes.filter((l) => l.state === 'in review').map((l) => l.story)
    : [];
  if (inReview.length && !working) {
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
  // MQ-2: where the lead doesn't merge, the head of the queue waits for the person's Merge.
  const next = queue.find((e) => ['waiting', 'merging'].includes(e.state));
  const autonomous = (check?.harness?.autonomy ?? 'autonomous') === 'autonomous';
  // SETUP-2: with no rules on the base yet, the lead puts them there first and then merges.
  const leadMerges = autonomous && (check?.delegatesMerge || check?.firstMerge);
  if (next && !leadMerges && !working)
    lines.push({
      kind: 'queue',
      text: `${next.branch} is next to merge`,
      branch: next.branch,
      actions: [{ id: 'mergeQueue', label: 'Merge' }],
    });
  // TEAM-7, TEAM-9: what of the team needs this person.
  if (!working) lines.push(...teamLines(team, check?.lanes ?? {}));
  // REPORT-3: a bug report for code-kit an agent drafted, for the person to read and send, or not.
  if (reports.length && !working)
    lines.push({
      kind: 'report',
      text: `${reports.length > 1 ? `${reports.length} bug reports for code-kit to send: ` : 'A bug report for code-kit to send: '}${reports[0].title}`,
      report: reports[0],
      reports,
      actions: [
        { id: 'openDecision', label: 'Read it' },
        { id: 'discardReport', label: 'Discard' },
      ],
    });
  // LEAN-8: a merged worktree that still holds uncommitted changes: the person keeps it, or discards them.
  if (worktrees.length && !working)
    lines.push({
      kind: 'worktree',
      text: `${worktrees.length > 1 ? `${worktrees.length} merged worktrees still hold changes: ` : 'A merged worktree still holds changes: '}${worktrees[0].branch}`,
      worktree: worktrees[0],
      worktrees,
      actions: [{ id: 'openDecision', label: 'Look…' }],
    });
  // LOOP-7: the milestone is done; LOOP-6: the loop's own state, with Pause or Resume.
  if (loop?.state === 'done')
    lines.push({
      kind: 'done',
      text: `Milestone done: ${plural(loop.doneCount, 'story', 'stories')} merged`,
      actions: [{ id: 'dismissDone', label: 'Dismiss' }],
    });
  // With the mission rows drawn, the loop's state and its Pause or Resume are on the `now` row.
  else if (mission.length) {
    // nothing more
  } else if (loop?.state === 'elsewhere' || loop?.state === 'unled')
    // SESS-2: another session leads the project, or none does; this one never prompts its lead.
    lines.push({
      kind: 'loop',
      text:
        loop.state === 'elsewhere'
          ? 'the lead is in another session'
          : 'no session leads the project: the loop waits for one',
      actions: [{ id: 'leadHere', label: 'Lead from here' }],
    });
  else if (loop?.state === 'paused')
    lines.push({ kind: 'loop', text: 'loop paused', actions: [{ id: 'resume', label: 'Resume' }] });
  else if (loop?.state === 'running' && loop.started)
    lines.push({
      kind: 'loop',
      text: `loop on${loop.last ? ` · last: ${loop.last}` : ''}`,
      actions: [{ id: 'pause', label: 'Pause' }],
    });
  // OWN-1: another session's decisions are answered there: here, only how many.
  for (const e of elsewhere)
    lines.push({
      kind: 'elsewhere',
      text: `${plural(e.count, 'decision', 'decisions')} in session ${e.member}, answered there`,
      actions: [],
    });
  // BAND-4: a digit for every action, in the order they're drawn.
  let digit = 0;
  for (const line of lines)
    for (const action of line.actions) action.hotkey = digit < 9 ? String(++digit) : undefined;
  return lines;
}

/**
 * LOOP-11, LOOP-12: the band's line for what the loop waits on, or null: the lead waiting on the
 * person (its question, when the reply asked one), a turn the person stopped, a step the lead didn't
 * take, or design stories left to the person and the lead.
 */
export function waitingOf(waiting) {
  if (!waiting) return null;
  if (waiting.kind === 'person')
    return {
      kind: 'waiting',
      text: waiting.question
        ? `The lead waits on you: ${waiting.question}`
        : `The lead waits on you${waiting.reason ? `: ${waiting.reason}` : ''}`,
      waiting,
      actions: waiting.question
        ? [{ id: 'openDecision', label: 'Answer…' }]
        : [{ id: 'carryOn', label: 'Carry on' }],
    };
  if (waiting.kind === 'stopped')
    return {
      kind: 'waiting',
      text: "You stopped the lead's turn: the loop waits for you",
      waiting,
      actions: [{ id: 'carryOn', label: 'Carry on' }],
    };
  // WHO-4: a step the lead said it couldn't take is a note: the loop asks again once the project moves.
  if (waiting.kind === 'blocked')
    return {
      kind: 'stuck',
      text: `${waiting.label}: the lead didn't take it${waiting.reason ? `: ${waiting.reason}` : ''}`,
      waiting,
      actions: [{ id: 'askAgain', label: 'Ask again' }],
    };
  if (waiting.kind === 'design')
    return {
      kind: 'designing',
      text: `${waiting.label}: with you and the lead, so the loop doesn't prompt it again`,
      waiting,
      actions: [{ id: 'askAgain', label: 'Ask the lead' }],
    };
  return null;
}

/** The band, drawn with the elements `$.ui.resolve(e)` returned; `onAction(id, line)` acts. */
export function band(lines, { Box, Text, Button }, onAction) {
  const COLOR = {
    notice: 'red',
    held: 'yellow',
    queue: 'blue',
    stalled: 'red',
    proposal: 'cyan',
    waiting: 'cyan',
    designing: 'blue',
    loop: 'green',
    done: 'green',
    approvals: 'yellow',
    review: 'blue',
    finish: 'red',
    usage: 'yellow',
    paused: 'yellow',
    facts: 'yellow',
    question: 'cyan',
    brief: 'cyan',
    report: 'magenta',
    stuck: 'yellow',
  };
  const LIVE = { quiet: 'yellow', stalled: 'red' };
  const LABEL = 8;
  // Two lines can share a kind or an action (two drift findings, each with Team): the second and later
  // get a number, so every row and button keeps its own key.
  const counter = () => {
    const seen = new Map();
    return (key) => {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n === 1 ? key : `${key}-${n}`;
    };
  };
  const uniqueButton = counter();
  const uniqueRow = counter();
  const buttons = (line) =>
    line.actions.map((a) =>
      Button({
        key: uniqueButton(`band-${a.id}`),
        label: a.hotkey ? `${a.hotkey} ${a.label}` : a.label,
        hotkey: a.hotkey,
        onPress: () => onAction(a.id, line),
      }),
    );
  // MISSION-2: what waits on the person is labelled "you", once, above its first line.
  let saidYou = false;
  const rows = lines.map((line) => {
    if (line.kind === 'agents')
      return Box({
        key: 'band-agents',
        flexDirection: 'column',
        children: [
          ...line.agents.map((a) =>
            Box({
              key: `band-agent-${a.lane}`,
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({
                  dimColor: true,
                  children: [(a === line.agents[0] ? line.label : '').padEnd(LABEL)],
                }),
                Text({ color: a.level ? LIVE[a.level] : 'green', children: ['●'] }),
                Text({ bold: true, children: [a.lane.padEnd(8)] }),
                Text({ wrap: 'truncate-end', children: [a.tool] }),
                Text({ dimColor: true, children: [a.ago] }),
              ],
            }),
          ),
          ...(line.more
            ? [Text({ dimColor: true, children: [`${''.padEnd(LABEL)}  and ${line.more} more`] })]
            : []),
        ],
      });
    // DECIDE-3: what needs the person is labelled "you", once; notes (usage, the plan's pause) are "note".
    const note = NOTE_KINDS.has(line.kind);
    const label = line.mission ? line.label : note ? 'note' : saidYou ? '' : 'you';
    if (!line.mission && !note) saidYou = true;
    return Box({
      key: uniqueRow(`band-${line.kind}`),
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({
          ...(line.mission ? { dimColor: true } : { color: COLOR[line.kind] ?? 'yellow' }),
          children: [label.padEnd(LABEL)],
        }),
        Text({
          wrap: 'truncate-end',
          ...(line.kind === 'facts' ? { color: COLOR.facts } : {}),
          children: [line.text],
        }),
        // DECIDE-2: which story it's for, so it isn't a fragment.
        ...(line.context
          ? [Text({ dimColor: true, wrap: 'truncate-end', children: [line.context] })]
          : []),
        ...buttons(line),
      ],
    });
  });
  // DECIDE-3: one key opens the decisions as cards, each with its lineage and what each choice does.
  const first = lines.find((l) => !l.mission && !NOTE_KINDS.has(l.kind));
  if (first)
    rows.push(
      Box({
        key: 'band-why',
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ children: [''.padEnd(LABEL)] }),
          Button({
            key: 'band-decide',
            label: 'Why, and what each choice does',
            hotkey: 'd',
            plain: true,
            onPress: () => onAction('decide', first),
          }),
        ],
      }),
    );
  return Box({ flexDirection: 'column', children: rows });
}

/** Band lines that inform rather than ask: they never need the person's answer. */
const NOTE_KINDS = new Set(['usage', 'paused', 'finish', 'done', 'teamDown']);

/** The Approve… confirmation (ACT-1): what it grants, to whom, for how long, and the reason. */
export function approvePane(
  approving,
  { Box, Text, Input, Button, Markdown },
  { onInput, onSubmit, onCancel, onAskInput, onAsk },
) {
  const { request, reason, error } = approving;
  const aside = approving.aside ?? { thread: [], draft: '' };
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
      // ACT-5: an aside about this approval, answered here and never in the lead's conversation.
      ...asideNodes(
        aside,
        { Text, Input, Markdown },
        { onAskInput, onAsk },
        'What is it for, and what does approving it let happen?',
      ),
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

/**
 * ACT-5: an aside in a pane: each question asked and its answer (or that it's being asked, or why there
 * is none), then the box to ask the next.
 */
function asideNodes(aside, { Text, Input, Markdown }, { onAskInput, onAsk }, placeholder) {
  return [
    ...aside.thread.flatMap((turn, i) => [
      Text({ key: `aside-q-${i}`, color: 'cyan', children: [`You: ${turn.question}`] }),
      turn.pending
        ? Text({ key: `aside-a-${i}`, dimColor: true, children: ['Asking…'] })
        : turn.error
          ? Text({ key: `aside-a-${i}`, color: 'red', children: [turn.error] })
          : Markdown
            ? Markdown({ key: `aside-a-${i}`, text: turn.answer })
            : Text({ key: `aside-a-${i}`, children: [turn.answer] }),
    ]),
    ...(onAsk
      ? [
          Input({
            key: 'ask-about',
            label: 'Ask about it',
            value: aside.draft,
            placeholder,
            submitLabel: 'Ask',
            onInput: onAskInput,
            onSubmit: onAsk,
          }),
        ]
      : []),
  ];
}

/**
 * ASK-5: the side call's prompt for a question about one of the person's decisions (a question from the
 * lead, or one open in their brief): what code-kit knows of it, the aside so far, and their question.
 */
export function questionAsidePrompt({ q, thread = [], question }) {
  return [
    "The person is deciding how to answer a question in code-kit's Decisions pane, and asks you about it first. Answer in a few short sentences, in plain words: what the question means, why it matters for the build, what the choices are and what each leads to, and what you'd recommend if you know enough to. Use what you know from this conversation, the project's docs you've read, and the facts below. If you don't know, say so; don't guess. This answer goes to that pane, not into the conversation: don't act on it.",
    '',
    q.kind === 'brief'
      ? `An open question in ${q.path}:`
      : q.kind === 'lead'
        ? 'What the lead asked in its last reply, and waits on:'
        : `A question the lead asked (${q.id}):`,
    `- ${q.question}`,
    ...(q.owner ? [`- who decides: ${q.owner}`] : []),
    ...(q.kind === 'brief' && q.blocks ? [`- what it holds up: ${q.blocks}`] : []),
    ...(q.story ? [`- story: ${q.story}`] : []),
    ...(q.why ? [`- why the lead can't settle it: ${q.why}`] : []),
    ...(q.options?.length
      ? [
          `- the lead's options: ${q.options.map((o) => `${o.label}${o.effect ? ` (${o.effect})` : ''}`).join('; ')}`,
        ]
      : []),
    ...(thread.length
      ? [
          '',
          'Asked so far:',
          ...thread.flatMap((t) => [`Q: ${t.question}`, `A: ${t.answer ?? t.error ?? ''}`]),
        ]
      : []),
    '',
    `Question: ${question}`,
  ].join('\n');
}

/**
 * ACT-5: the side call's prompt for a question about an approval: what code-kit knows of the request (the
 * names, the lane, what was refused and why, its story, the limits it missed), the aside so far, and the
 * question. It answers in the pane, never in the conversation, and acts on nothing.
 */
export function approvalAsidePrompt({ request, story = null, thread = [], question }) {
  return [
    "The person is deciding whether to approve something code-kit stopped, and asks you about it in code-kit's approval pane. Answer in a few short sentences, in plain words: what it is, why it's needed for the work, what approving it lets happen, and anything risky about it. Use what you know from this conversation and the facts below. If you don't know, say so; don't guess. This answer goes to that pane, not into the conversation: don't act on it, and don't change your plans because of it.",
    '',
    'The approval:',
    `- approvals asked for: ${request.names.join(', ')}`,
    `- for: ${request.lane ? `the ${request.lane} lane` : (request.actor ?? 'an agent')}`,
    `- what was refused: ${request.what}`,
    ...(request.why ? [`- why code-kit refused it: ${request.why}`] : []),
    ...(story
      ? [
          `- story: ${story.id} ${story.title ?? ''}${story.requirements?.length ? ` (${story.requirements.join(', ')})` : ''}`,
        ]
      : []),
    ...(thread.length
      ? [
          '',
          'Asked so far:',
          ...thread.flatMap((t) => [`Q: ${t.question}`, `A: ${t.answer ?? t.error ?? ''}`]),
        ]
      : []),
    '',
    `Question: ${question}`,
  ].join('\n');
}

export const ANSWER_ID = 'code-kit-answer';

/** ASK-2, ASK-4: the person's answer to the lead's question, or to one in their brief, typed. */
export function answerPane(
  answering,
  { Box, Text, Input, Button, Markdown },
  { onInput, onSubmit, onCancel, onAskInput, onAsk },
) {
  const { kind, question, text, error } = answering;
  const aside = answering.aside ?? { thread: [], draft: '' };
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Text({ bold: true, children: [question] }),
      Text({
        dimColor: true,
        children: [
          kind === 'brief'
            ? `An open question in ${answering.path}. The lead records your answer in the brief's decisions and builds on it.`
            : kind === 'lead'
              ? 'From the lead, which waits on it. Your answer is sent to the lead.'
              : `${answering.id}, from the lead${answering.story ? `, for ${answering.story}` : ''}. Your answer is recorded and sent to the lead.`,
        ],
      }),
      ...(kind === 'brief' && (answering.owner || answering.blocks)
        ? [
            Text({
              dimColor: true,
              children: [
                [
                  answering.owner && `Who decides: ${answering.owner}`,
                  answering.blocks && `Holds up: ${answering.blocks}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ],
            }),
          ]
        : []),
      // ASK-5: not sure what it means? Ask, here, before answering.
      ...asideNodes(
        aside,
        { Text, Input, Markdown },
        { onAskInput, onAsk },
        'What does it mean, and what would you suggest?',
      ),
      Input({
        key: 'answer-text',
        label: 'Answer',
        value: text,
        submitLabel: 'Answer',
        autoFocus: true,
        onInput,
        onSubmit,
      }),
      ...(error ? [Text({ color: 'red', children: [error] })] : []),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'answer-confirm', label: 'Answer', onPress: () => onSubmit(text) }),
          Button({ key: 'answer-cancel', label: 'Cancel', onPress: onCancel }),
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
const LEAD_LINE =
  /^\s*Decided by the lead: node "[^"]*" approve (.+?)(?: --lane (\S+))? --delegated\b/m;

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
  // HELM-2: what the lead decides carries its own approve command, never a person's `!` lines.
  const byLead = text.match(LEAD_LINE);
  const request = (what) =>
    byLead
      ? {
          names: byLead[1].split(/\s+/),
          lane: byLead[2] ?? null,
          what,
          by: 'lead',
        }
      : approvals.length
        ? { names: approvals.map((m) => m[2]), lane: approvals[0][1] ?? null, what, by: 'person' }
        : null;
  const todoFor = (lasts) =>
    byLead
      ? 'The lead decides it on its merits: it approves it, or tells the lane what to use instead.'
      : `A person approves it, here or with the \`!\` command, ${lasts}.`;
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
  m = first.match(/^(\S+) is (.+) and needs (?:a person's|the lead's) approval\./);
  if (m)
    return {
      kind: 'approval',
      title: `Approval needed: ${m[1]}`,
      why: `It's ${m[2]}.`,
      todo: todoFor('for 60 minutes'),
      request: request(`write ${m[1]}`),
      raw: text,
    };
  m = first.match(
    /^(\S+) is (.+); committing it needs (?:a person's|the lead's) approval in force\./,
  );
  if (m)
    return {
      kind: 'approval',
      title: `Commit refused: ${m[1]}`,
      why: `It's ${m[2]}.`,
      todo: todoFor('for 60 minutes'),
      request: request(`commit ${m[1]}`),
      raw: text,
    };
  if (/^the \.claude kit is changed only by the lead or with a person's approval\./.test(first))
    return {
      kind: 'kit',
      title: 'Kit edit refused',
      why: "The .claude kit is changed only by the lead or with a person's approval.",
      todo: todoFor('for 60 minutes'),
      request: request('change the .claude kit'),
      raw: text,
    };
  m = first.match(
    /^a new dependency \((.+?)\) (?:needs a person's approval|is the lead's decision)\./,
  );
  if (m)
    return {
      kind: 'dependency',
      title: `Install refused: ${m[1]}`,
      why: byLead
        ? "A new dependency is the lead's decision."
        : "A new dependency needs a person's approval.",
      todo: todoFor('until the install is committed (at most 7 days)'),
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
  const history = requests?.history ?? [];
  const asks = approvalAsks(open);
  const lines = [
    asks.length
      ? `${plural(asks.length, 'approval', 'approvals')} waiting:`
      : 'No requests waiting.',
    ...asks.map((a) => `  ${askWords(a.request, a.files)}`),
    inForce.length
      ? `${plural(inForce.length, 'approval', 'approvals')} in force:`
      : 'No approvals in force.',
    ...inForce.map(
      (a) =>
        `  ${approvalLabel(a.name)} for ${a.lane ? `the ${a.lane} lane` : 'any agent'}, ${a.minutesLeft} min left: ${a.reason}`,
    ),
    // CARD-6: what was given, newest first, whether or not its branch has merged.
    history.length ? 'Approvals given, newest first:' : 'No approvals given yet.',
    ...history
      .slice(0, 20)
      .map(
        (h) =>
          `  ${new Date(h.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}  ${approvalLabel(h.name)} for ${h.lane ? `the ${h.lane} lane` : 'any agent'}, by ${h.by}${h.files.length ? ` (${h.files.length} file${h.files.length === 1 ? '' : 's'})` : ''}: ${h.reason}`,
      ),
  ];
  return lines.join('\n');
}

// --- the harness settings (SET-2) --------------------------------------------------------------

export const SETTINGS_ID = 'code-kit-settings';
const CHOICES = {
  autonomy: ['autonomous', 'propose', 'off'],
  'agents.reviewer.model': ['', 'haiku', 'sonnet', 'opus'],
  'agents.lanes.model': ['', 'story', 'haiku', 'sonnet', 'opus'],
  'compact.milestone': ['ask', 'auto', 'off'],
};
const shown = (v) =>
  v === null || v === ''
    ? "the session's"
    : v === true
      ? 'on'
      : v === false
        ? 'off'
        : v === 'lead'
          ? 'the lead'
          : v === 'person'
            ? 'you'
            : v === 'story'
              ? "each story's size"
              : String(v);

/**
 * The Settings view: each setting from `code-kit settings --json` with a control, and, once one is
 * changed, a confirmation asking the person's reason before anything is written.
 */
export function settingsView(rows, pending, { Box, Text, Select, Input, Button }, handlers) {
  const control = (r) => {
    const listed =
      r.choices ?? CHOICES[r.key] ?? (typeof r.default === 'boolean' ? [true, false] : null);
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
  const rowView = (r) =>
    Box({
      key: `setting-${r.key}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Box({
              width: 34,
              children: [
                Text({
                  bold: true,
                  children: [r.section === 'Approvals' ? r.key.replace(/^approvals\./, '') : r.key],
                }),
              ],
            }),
            control(r),
            ...(r.value !== r.default
              ? [Text({ dimColor: true, children: [`default ${shown(r.default)}`] })]
              : []),
            ...(r.key === 'autonomy' && r.set === false
              ? [
                  Text({
                    color: 'yellow',
                    children: ['not chosen yet: the loop asks before its first step'],
                  }),
                ]
              : []),
          ],
        }),
        Text({ dimColor: true, children: [`  ${r.about}`] }),
      ],
    });
  // WHO-3: the harness, then who decides each approval.
  const section = (name) => rows.filter((r) => (r.section ?? 'Harness') === name);
  const approvals = section('Approvals');
  const rowsView = [
    ...section('Harness').map(rowView),
    ...(approvals.length
      ? [
          Text({ key: 'approvals-heading', bold: true, color: 'cyan', children: ['APPROVALS'] }),
          Text({
            key: 'approvals-about',
            dimColor: true,
            children: [
              "Who decides what a lane can't do on its own. The lead decides what's technical; you keep product, design, CI and the kit.",
            ],
          }),
          ...approvals.map(rowView),
        ]
      : []),
  ];
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
        children: [
          'Lanes, paths, layers and which paths are protected change through /code-kit:init.',
        ],
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

/**
 * HUBR-2: the ledger as a report carries it: [{ story, kind, input, output, cache }], each entry's kind
 * (lead, lane, reviewer, security-reviewer or background) from who made it and `typeOf(key)`, the agent's
 * type. Tokens only: no prompt, no message.
 */
export function usageForReport(ledger, typeOf = () => null) {
  return Object.fromEntries(
    Object.entries(ledger).map(([id, e]) => {
      const type = e.key === 'lead' ? null : typeOf(e.key);
      const kind =
        e.key === 'lead'
          ? 'lead'
          : e.lane
            ? 'lane'
            : type === 'security-reviewer'
              ? 'security-reviewer'
              : /(^|:)reviewer$/.test(type ?? '')
                ? 'reviewer'
                : 'background';
      return [
        id,
        { story: e.story ?? null, kind, input: e.input, output: e.output, cache: e.cache },
      ];
    }),
  );
}

/**
 * HUBR-6: an agent's presence, by tool name and the branch its lane works on (never what it reads or
 * writes): { type, tool, branch, at }.
 */
export function presenceOf({ agentId, type, tool, lane, lanes, at }) {
  const branch = lane ? (lanes?.find((l) => l.name === lane)?.branch ?? null) : null;
  return { type: agentId ? (type ?? null) : 'lead', tool: tool ?? null, branch, at };
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
