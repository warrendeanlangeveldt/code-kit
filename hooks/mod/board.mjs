// The mod, redesigned (docs/specs/27-the-mod-redesigned.md): one pane of panels, no tabs. Build (is the
// build moving?), Needs you (what needs me?), Lanes (where is each story? is it what I asked for? is it
// built right?), Queue and Log, each with a status line first and no room taken when it has nothing to
// say; the full views opened from a story or a command; three layouts. Pure functions from what the
// mod already holds to elements, so they're tested with node at every width (UI-13).
import { SIZE, charactersOf, characterFrame, characterSvg, POSES, workOf } from './characters.mjs';
import { BAR, rasterCells, runs, timelineSvg } from './art.mjs';
import { goalOf } from './mission.mjs';
import { CELL, cellOf, laneActions, laneStories, storyToOpen } from './panes.mjs';
import { NOT_CODE_KIT, ago, askWords, shownState, tokens } from './view.mjs';

const LEAD = 'lead';

/**
 * The pane's own state, kept by the mod between draws: the full view open over the panels (null, or
 * story, trail, code, journal, usage, decision, characters), what's selected ({ kind: 'need' | 'lane',
 * id }), the need open in its place, the filter, and the full views' own.
 */
export const BOARD_UI = {
  view: null,
  sel: null,
  need: 0,
  search: '',
  filtering: false,
  cell: null,
  file: null,
  mapStory: null,
  mapFile: null,
  decision: 0,
};

// --- UI-7: one table of words, colours and glyphs ---------------------------------------------------

/** Each state's word, colour and glyph, used by every panel and view: the glyph reads without colour. */
export const STATE = {
  building: { word: 'building', color: 'blue', glyph: '●' },
  working: { word: 'working', color: 'green', glyph: '▶' },
  orchestrating: { word: 'orchestrating', color: 'yellow', glyph: '◆' },
  'in review': { word: 'in review', color: 'yellow', glyph: '◐' },
  queued: { word: 'queued', color: 'cyan', glyph: '◇' },
  waiting: { word: 'waiting', color: 'cyan', glyph: '◇' },
  merging: { word: 'merging', color: 'cyan', glyph: '◈' },
  merged: { word: 'merged', color: 'green', glyph: '✓' },
  'sent back': { word: 'sent back', color: 'magenta', glyph: '↩' },
  'waiting on you': { word: 'waiting on you', color: 'cyan', glyph: '?' },
  blocked: { word: 'blocked', color: 'red', glyph: '■' },
  stalled: { word: 'stalled', color: 'red', glyph: '✗' },
  quiet: { word: 'quiet', color: 'yellow', glyph: '…' },
  ready: { word: 'ready', color: 'green', glyph: '○' },
  todo: { word: 'to do', color: undefined, glyph: '○' },
  idle: { word: 'resting', color: undefined, glyph: '·' },
  dispatched: { word: 'started', color: 'blue', glyph: '→' },
};
/** A story's plan state as the table names it: done is merged, review in review, in progress building. */
const STORY_STATE = { done: 'merged', review: 'in review', 'in progress': 'building' };
const styleOf = (state) =>
  STATE[state]?.color ? { color: STATE[state].color } : { dimColor: true };
const wordOf = (state) => STATE[state]?.word ?? state;
const glyphOf = (state) => STATE[state]?.glyph ?? '·';

/**
 * LANES-3: a lane's stories as cards (id and state, title, requirements, and what it waits on or its
 * branch), wrapping, then its agent and the paths it owns. `detail` is { agent, owns, stories }.
 */
export function laneDetail(detail, { Box, Text }) {
  const text = (value, style = {}) => Text({ ...style, children: [String(value)] });
  const cards = detail.stories.map((s) => {
    const state = STORY_STATE[s.state] ?? s.state;
    const done = s.state === 'done';
    return Box({
      key: `card-${s.id}`,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: STATE[state]?.color ?? 'gray',
      ...(done ? { borderDimColor: true } : {}),
      paddingX: 1,
      width: 30,
      flexShrink: 1,
      children: [
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            text(s.id, { bold: true, dimColor: done }),
            text(`${glyphOf(state)} ${wordOf(state)}`, styleOf(state)),
          ],
        }),
        text(s.title, { wrap: 'truncate-end', dimColor: done }),
        ...(s.requirements?.length
          ? [text(s.requirements.join(' '), { dimColor: true, wrap: 'truncate-end' })]
          : []),
        ...(s.state === 'blocked' && s.waitingOn?.length
          ? [text(`waits on ${s.waitingOn.join(', ')}`, { color: 'red', wrap: 'truncate-end' })]
          : s.branch && !done
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
      children: cards.length
        ? cards
        : [text('No stories in the plan for this lane.', { dimColor: true })],
    }),
    Box({
      key: 'lane-owns',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
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

// --- UI-2: the build counted in requirements tested ------------------------------------------------

/** The four kinds of requirement the Build bar counts, in the order it fills. */
export const PROGRESS = [
  { id: 'tested', cell: 'tested', word: 'tested' },
  { id: 'untested', cell: 'done', word: 'untested' },
  { id: 'moving', cell: 'in progress', word: 'in progress' },
  { id: 'todo', cell: 'todo', word: 'todo' },
];
const kindOfCell = (cell) =>
  cell === 'tested'
    ? 'tested'
    : cell === 'done'
      ? 'untested'
      : cell === 'in progress'
        ? 'moving'
        : 'todo';

/**
 * UI-2: the milestone being built and its requirements by kind, from status's requirements and stories:
 * { name, total, tested, untested, moving, todo, ids }, the milestone's requirements being those its
 * stories cite. With no milestones in the plan, every requirement counts ({ name: null }). Null when
 * the specs name no requirement.
 */
export function buildProgress(state, status) {
  const requirements = (status?.requirements ?? []).filter((r) => r.state !== 'removed');
  if (!requirements.length) return null;
  const goal = goalOf(state?.stories ?? []);
  const inMilestone = goal
    ? new Set(
        (state.stories ?? [])
          .filter((s) => s.milestone === goal.name)
          .flatMap((s) => s.requirements ?? []),
      )
    : null;
  const mine = inMilestone ? requirements.filter((r) => inMilestone.has(r.id)) : requirements;
  const out = { name: goal?.name ?? null, total: mine.length, ids: {} };
  for (const p of PROGRESS) {
    const ids = mine.filter((r) => kindOfCell(cellOf(r)) === p.id).map((r) => r.id);
    out[p.id] = ids.length;
    out.ids[p.id] = ids;
  }
  return out;
}

/** The Build bar as runs [{ kind, glyph, color, n }], `width` cells shared by the kinds there are. */
export function buildBar(progress, width) {
  if (!progress?.total) return [];
  const runs = [];
  let used = 0;
  const kinds = PROGRESS.filter((p) => progress[p.id] > 0);
  kinds.forEach((p, i) => {
    const n =
      i === kinds.length - 1
        ? width - used
        : Math.max(1, Math.round((progress[p.id] / progress.total) * width));
    used += n;
    runs.push({ kind: p.id, glyph: CELL[p.cell].glyph, color: CELL[p.cell].color, n });
  });
  return runs.filter((r) => r.n > 0);
}

/** The Build panel's words: "Milestone 3: Booking · 9 of 14 tested · 3 untested". */
export function buildWords(progress) {
  if (!progress) return null;
  const head = progress.name ? `${progress.name} · ` : '';
  return `${head}${progress.tested} of ${progress.total} tested${progress.untested ? ` · ${progress.untested} untested` : ''}`;
}

/** The Build panel's state in a word or two, from the loop and whether anything is at work. */
export function buildState(loop, { atWork = 0, leadBusy = false } = {}) {
  if (loop?.state === 'paused') return 'paused';
  // LOOP-14: nothing moves until Claude's usage limit resets.
  if (loop?.limited) return 'usage limit';
  if (loop?.state === 'done' || loop?.state === 'stopped') return 'milestone done';
  if (loop?.state === 'elsewhere') return 'led elsewhere';
  if (loop?.state === 'unled') return 'no lead';
  if (atWork || leadBusy) return 'moving';
  if (loop?.state === 'off') return 'loop off';
  return 'still';
}

// --- UI-3: what needs the person, most urgent first -----------------------------------------------

/** How urgent each kind of line is (UI-3): a held call first, notes last. */
const URGENCY = [
  'notice',
  'limited',
  'held',
  'question',
  'waiting',
  'proposal',
  'approvals',
  'queue',
  'review',
  'stalled',
  'stuck',
  'designing',
  'brief',
  'report',
  'worktree',
];
const NOTES = new Set(['usage', 'paused', 'finish', 'done', 'teamDown', 'elsewhere', 'loop']);

/** What a line is, in a word or two, for the Needs you panel. */
const NEED_WORD = {
  notice: 'failed',
  limited: 'usage limit',
  held: 'held call',
  question: 'question',
  waiting: 'the lead waits',
  proposal: 'next step',
  approvals: 'approval',
  queue: 'merge',
  review: 'review',
  stalled: 'stalled',
  stuck: 'stuck',
  designing: 'design',
  brief: 'brief',
  report: 'bug report',
  worktree: 'worktree',
  task: 'your task',
};

/**
 * UI-3, UI-8: the band's lines that need the person or tell them something (the mission rows aside),
 * most urgent first, every action numbered again in that order, so a digit presses the same button in
 * the band and the pane. Team lines (spec 16) sit with the decisions; notes come last.
 */
export function needsOf(lines = []) {
  const rank = (l) => {
    if (l.kind === 'task') return -1;
    const at = URGENCY.indexOf(l.kind);
    if (at >= 0) return at;
    return NOTES.has(l.kind) ? URGENCY.length + 1 : URGENCY.length;
  };
  const sorted = lines
    .filter((l) => !l.mission)
    .flatMap(eachOwn)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map(({ l }) => ({ ...l, actions: l.actions.map((a) => ({ ...a })) }));
  let digit = 0;
  for (const line of sorted)
    for (const a of line.actions) a.hotkey = digit < 9 ? String(++digit) : undefined;
  return sorted;
}
/**
 * UI-3: a line the band counts as several (two approvals, three held calls, two questions) is one
 * line each, so each is chosen, answered and counted on its own.
 */
function eachOwn(line) {
  if (line.kind === 'approvals' && line.asks?.length > 1)
    return line.asks.map((ask) => ({
      ...line,
      text: `Approve ${askWords(ask.request, ask.files)}`,
      request: ask.request,
      files: ask.files,
      asks: [ask],
    }));
  if (line.kind === 'held' && line.calls?.length > 1)
    return line.calls.map((c) => ({ ...line, text: c.text, held: c.held, calls: [c] }));
  if (line.kind === 'question' && line.questions?.length > 1)
    return line.questions.map((q) => ({
      ...line,
      text: `The lead asks: ${q.question}`,
      question: q,
      questions: [q],
    }));
  if (line.kind === 'brief' && line.briefs?.length > 1)
    return line.briefs.map((b) => ({
      ...line,
      text: `An open question in your brief: ${b.question}`,
      brief: b,
      briefs: [b],
    }));
  return [line];
}
const isNote = (l) => NOTES.has(l.kind);
const needWord = (l) => (isNote(l) ? 'note' : (NEED_WORD[l.kind] ?? 'team'));

// --- UI-4: the lanes, each story with its trail and map -------------------------------------------

/** A story's trail in miniature: a cell per requirement it cites, coloured as in the Trail. */
export function trailCells(story, status) {
  const byId = new Map((status?.requirements ?? []).map((r) => [r.id, r]));
  return (story?.requirements ?? []).map((id) => {
    const r = byId.get(id);
    const cell = r ? cellOf(r) : 'todo';
    return { id, cell, glyph: CELL[cell]?.glyph ?? '○', color: CELL[cell]?.color };
  });
}

/**
 * A story's map in miniature (UI-4): a chip per layer its changed files are in. Red while the lane has
 * a refusal unresolved there (a layer rule, or a write it may not make), amber where a changed file's
 * card isn't written or is out of date. `map` is `code-kit map <story> --json`; `trouble` is
 * { refused: [{ layer, path }], owed: [path] }.
 */
export function mapChips(map, trouble = {}) {
  const files = map?.files ?? [];
  const refused = trouble.refused ?? [];
  const owed = new Set(trouble.owed ?? []);
  const layers = [...(map?.layers ?? [])];
  for (const r of refused) if (r.layer && !layers.includes(r.layer)) layers.push(r.layer);
  const chips = layers.map((layer) => {
    const mine = files.filter((f) => f.layer === layer);
    const red = refused.some((r) => r.layer === layer);
    const amber = mine.some(
      (f) =>
        owed.has(f.path) ||
        Object.values(f.adapters ?? {}).some((a) => a?.card && a.card.state !== 'current'),
    );
    return { layer, tone: red ? 'red' : amber ? 'amber' : null, files: mine.length };
  });
  // A refusal whose layer isn't known (a write to a path no layer names) is still red.
  if (refused.some((r) => !r.layer)) chips.push({ layer: 'refused', tone: 'red', files: 0 });
  return chips;
}

/**
 * Where each lane stands: the lanes at work (the lead's first), and the rest, resting. A lane named in
 * `notes` (the loop's note on it: nudged, stalled, a call Claude Code refused; or a move it's playing)
 * is shown as a card, so it's seen.
 */
export function lanesAtWork(state, queue = [], notes = {}) {
  const atWork = [];
  const resting = [];
  for (const l of state?.lanes ?? []) {
    const s = shownState(l, queue);
    if (l.active || !['idle', 'blocked'].includes(s) || notes[l.name]) atWork.push(l);
    else resting.push(l);
  }
  return { atWork, resting };
}

/** A lane's character pose (UI-11): the kind of work while its agent works, else its state. */
export function poseFor(lane, { live = null, waiting = false, stalled = false, queue = [] } = {}) {
  if (stalled || live?.level === 'stalled') return 'stalled';
  if (waiting || shownState(lane, queue) === 'waiting on you') return 'waiting';
  if (live?.level === 'quiet') return 'quiet';
  if (lane.active) return workOf(live?.tool ? String(live.tool).split(' ')[0] : null);
  return 'resting';
}

// --- UI-10: the layouts ------------------------------------------------------------------------------

/** The layout for the space the pane has: inline above the prompt, docked, or wide. */
export const layoutOf = (placement, columns) =>
  placement === 'inline' ? 'inline' : columns >= 110 ? 'wide' : 'docked';

/** The rows a lane card takes: its five lines of words (the character's four beside them), and its border. */
export const CARD_ROWS = 7;
/** The columns a lane card takes where cards sit side by side: its character, its words, its frame. */
export const CARD_COLUMNS = 44;
/** The fewest columns a card is drawn in. */
export const CARD_MIN = 40;

/** Whether the lanes are drawn as cards, or as swimlanes on the time axis (UI-4). */
export function lanesAs(cards, { columns, rows }) {
  if (!cards) return 'cards';
  // A card needs its character and a line of words beside it; narrower, a line each.
  if (columns < CARD_MIN) return 'swimlanes';
  const across = Math.max(1, Math.floor(columns / CARD_COLUMNS));
  return Math.ceil(cards / across) * CARD_ROWS <= rows ? 'cards' : 'swimlanes';
}

// --- UI-5: the log -----------------------------------------------------------------------------------

const LOG_GLYPH = {
  request: '✦',
  decision: '◆',
  spec: '▤',
  setup: '⚙',
  dispatch: '→',
  sentBack: '↩',
  merge: '✓',
  approval: '✔',
  milestone: '★',
  loop: '·',
};
const LOG_STATE = { dispatch: 'dispatched', sentBack: 'sent back', merge: 'merged' };

/** The time of day, as the Log shows it: 14:02. */
const clockOf = (at) => new Date(at).toISOString().slice(11, 16);

/**
 * UI-5: the build's latest events, newest last, one line each: { at, time, glyph, color, text, yours }.
 * A story's dispatch, send-back and merge read "ST-4 merged · web"; the rest keep their own words.
 */
export function logLines(events = [], stories = [], most = 5) {
  const laneOf = new Map(stories.map((s) => [s.id, s.lane]));
  return events.slice(-most).map((e) => {
    const yours = e.who === 'person' || e.kind === 'request';
    const state = LOG_STATE[e.kind];
    const lane = e.story ? laneOf.get(e.story) : null;
    const text =
      state && e.story
        ? `${e.story} ${wordOf(state)}${lane ? ` · ${lane}` : ''}`
        : String(e.text ?? '').replace(/\.$/, '');
    return {
      at: e.at,
      time: clockOf(e.at),
      glyph: LOG_GLYPH[e.kind] ?? '·',
      color: yours ? 'yellow' : state ? STATE[state]?.color : undefined,
      text,
      yours,
    };
  });
}

// --- UI-8: the keys -----------------------------------------------------------------------------------

/** The letters a story's acts are pressed with, shown on their buttons (UI-8). */
export const ACT_KEY = {
  approve: 'a',
  review: 'r',
  sendBack: 's',
  merge: 'm',
  watch: 'w',
  nudge: 'n',
  stop: 'x',
};

/** UI-6: whether the person's Escape goes back from a full view to the panels, rather than closing. */
export const escapeGoesBack = (e, paneId, ui) =>
  e.id === paneId && e.origin?.kind === 'person' && Boolean(ui?.view);

/** The selection's order: what needs the person, then the lanes at work, then the resting ones. */
export function selectable(needs, lanes) {
  return [
    ...needs.map((_, i) => ({ kind: 'need', id: String(i) })),
    ...lanes.map((l) => ({ kind: 'lane', id: l.name })),
  ];
}

/** The selection `step` places on from `sel` (j and k), wrapping. */
export function moveSelection(order, sel, step) {
  if (!order.length) return null;
  const at = order.findIndex((o) => o.kind === sel?.kind && o.id === sel?.id);
  if (at < 0) return order[step > 0 ? 0 : order.length - 1];
  return order[(at + step + order.length) % order.length];
}

/**
 * UI-8: the keys that work for what's selected, as the pane's last line lists them:
 * [{ key, label }]. A story's own acts, then the pane's.
 */
export function keysFor(sel, { acts = [], view = null, loop = null, story = false } = {}) {
  if (view)
    return [
      ...(view === 'trail' ? [{ key: '←→', label: 'requirement' }] : []),
      { key: 'esc', label: 'back' },
    ];
  const keys = [
    { key: 'j', label: 'down' },
    { key: 'k', label: 'up' },
  ];
  if (sel) keys.push({ key: '⏎', label: 'open' });
  if (sel?.kind === 'lane' && story) {
    keys.push({ key: 't', label: 'trail' }, { key: 'c', label: 'map' });
    for (const a of acts) if (ACT_KEY[a.id]) keys.push({ key: ACT_KEY[a.id], label: a.label });
  }
  if (loop && !['off', 'done', 'stopped', 'elsewhere', 'unled'].includes(loop.state))
    keys.push({ key: 'p', label: loop.state === 'paused' ? 'resume' : 'pause' });
  keys.push({ key: 'f', label: 'filter' }, { key: 'l', label: 'journal' });
  keys.push({ key: 'esc', label: 'close' });
  return keys;
}

// --- drawing ------------------------------------------------------------------------------------------

/**
 * The pane (UI-1 to UI-13). `view` holds what to draw: { state, status, loop (with its queue), needs
 * (needsOf's), live, art: { surface, motion, poses, moves, faulted }, maps, trouble, journal, now,
 * placement, columns, rows, ui, held, requests, leadBusy }, and the full views' own data. `on` acts.
 */
export function board(view, els, on) {
  const { Box, Text, Button } = els;
  const text = (value, style = {}) => Text({ ...style, children: [String(value)] });
  const { state } = view;
  if (!state || state.kind === 'none') return text(NOT_CODE_KIT, { dimColor: true });
  if (state.kind === 'invalid')
    return text('The config is invalid: run code-kit check.', { color: 'red' });
  const ui = view.ui ?? {};
  const columns = Math.max(20, view.columns ?? 80);
  const layout = layoutOf(view.placement, columns);
  const loop = view.loop ?? null;
  const queue = loop?.queue ?? [];
  const needs = view.needs ?? [];
  const decisions = needs.filter((l) => !isNote(l));
  // A lane playing a move (a cheer at its merge) keeps its card while it plays.
  const { atWork, resting } = lanesAtWork(state, queue, {
    ...(loop?.laneNotes ?? {}),
    ...(view.art?.moves ?? {}),
  });
  const needle = (ui.search ?? '').trim().toLowerCase();
  const matches = (l) =>
    !needle ||
    [l.name, l.agent, l.story?.id, l.story?.title, l.branch]
      .filter(Boolean)
      .some((s) => s.toLowerCase().includes(needle));
  const progress = buildProgress(state, view.status);
  const looks = charactersOf(state.lanes.map((l) => l.name));
  const motion = view.art?.motion ?? 'while-active';
  const surface = view.art?.surface ?? 'terminal';
  const sel = ui.sel ?? null;
  const selectedLane = sel?.kind === 'lane' ? state.lanes.find((l) => l.name === sel.id) : null;

  // A status line (UI-1): the panel's name, its state in a word or two, a count at the right.
  const statusLine = (key, name, word, count, color) =>
    Box({
      key: `status-${key}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        text(name, { bold: true }),
        text('·', { dimColor: true }),
        Box({
          flexGrow: 1,
          flexShrink: 1,
          children: [text(word, { wrap: 'truncate-end', ...(color ? { color } : {}) })],
        }),
        ...(count !== null && count !== undefined ? [text(count, { dimColor: true })] : []),
      ],
    });

  // --- the character, on each surface (UI-11, UI-12) ---
  const still = (name, pose) => {
    const grid = characterFrame(pose, 0, looks[name], { motion: 'off' });
    if (surface === 'terminal' && els.Raster)
      return els.Raster({
        key: `char-${name}`,
        columns: SIZE,
        rows: SIZE / 2,
        cells: rasterCells(grid),
      });
    if (els.Svg)
      return els.Svg({
        key: `char-${name}`,
        source: characterSvg(pose, looks[name], { motion: 'off' }),
        alt: `${name}: ${POSES[pose]?.words ?? pose}`,
        width: SIZE * 3,
        height: SIZE * 3,
      });
    return text(POSES[pose]?.glyph ?? '·');
  };
  const character = (name, pose) => {
    const move = view.art?.moves?.[name] ?? null;
    const faulted = view.art?.faulted?.[surface];
    if (surface === 'terminal' && els.Client && !faulted)
      return els.Client({
        key: `char-${name}`,
        module: './surface/character.mjs',
        props: { look: looks[name], pose, move, motion },
        width: SIZE,
        height: SIZE / 2,
      });
    if (surface === 'desktop' && els.Svg && motion !== 'off' && !faulted)
      return els.Svg({
        key: `char-${name}-${move?.key ?? pose}`,
        source: characterSvg(move ? move.kind : pose, looks[name]),
        alt: `${name}: ${POSES[move?.kind ?? pose]?.words ?? pose}`,
        width: SIZE * 3,
        height: SIZE * 3,
      });
    return still(name, pose);
  };
  const clock = (name, live, running) => {
    if (!live) return [];
    const ms = Math.max(0, (view.now ?? 0) - (live.at ?? view.now ?? 0));
    const color = live.level === 'stalled' ? 'red' : live.level === 'quiet' ? 'yellow' : null;
    if (['terminal', 'desktop'].includes(surface) && els.Client && !view.art?.faulted?.[surface])
      return [
        els.Client({
          key: `clock-${name}`,
          module: './surface/clock.mjs',
          props: { ms, running, motion, color },
        }),
      ];
    return [text(live.ago, color ? { color } : { dimColor: true })];
  };

  // --- Build (UI-2) ---
  const barWidth = Math.max(8, Math.min(40, columns - 30));
  const fresh = new Set(view.art?.fresh ?? []);
  const bar = (width = barWidth) =>
    Box({
      key: 'build-bar',
      flexDirection: 'row',
      flexShrink: 0,
      children: buildBar(progress, width).map((r, i) =>
        text(r.glyph.repeat(r.n), {
          key: `bar-${i}`,
          ...(r.color ? { color: r.color } : { dimColor: true }),
          ...(r.kind === 'tested' && progress.ids.tested.some((id) => fresh.has(id))
            ? { bold: true, inverse: true }
            : {}),
        }),
      ),
    });
  const counts = () =>
    PROGRESS.filter((p) => progress?.[p.id])
      .map((p) => `${CELL[p.cell].glyph} ${progress[p.id]} ${p.word}`)
      .join('  ');
  const atWorkCount = atWork.filter((l) => l.active && l.name !== LEAD).length;
  const loopWord = buildState(loop, { atWork: atWorkCount, leadBusy: view.leadBusy });
  const pauseButton =
    loop && ['running', 'paused'].includes(loop.state)
      ? [
          Button({
            key: 'loop-toggle',
            label: loop.state === 'paused' ? 'Resume' : 'Pause',
            hotkey: 'p',
            plain: true,
            onPress: () => on.onNeed(loop.state === 'paused' ? 'resume' : 'pause', null),
          }),
        ]
      : [];
  const buildPanel = Box({
    key: 'panel-build',
    flexDirection: 'column',
    children: [
      statusLine(
        'build',
        'Build',
        loopWord,
        progress ? `${progress.tested}/${progress.total}` : null,
        loopWord === 'moving'
          ? 'green'
          : ['paused', 'usage limit'].includes(loopWord)
            ? 'yellow'
            : undefined,
      ),
      ...(progress
        ? [
            text(buildWords(progress), { wrap: 'truncate-end' }),
            Box({
              key: 'build-progress',
              flexDirection: 'row',
              columnGap: 2,
              children: [
                bar(),
                Box({
                  flexShrink: 1,
                  children: [text(counts(), { dimColor: true, wrap: 'truncate-end' })],
                }),
              ],
            }),
          ]
        : [text('No requirements in the specs yet.', { dimColor: true })]),
      ...(state.planGaps
        ? [
            text(`The plan has ${state.planGaps} gap(s): run code-kit status.`, {
              color: 'yellow',
              wrap: 'truncate-end',
            }),
          ]
        : []),
      Box({
        key: 'build-loop',
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(
            loop?.state === 'off' ? 'loop off' : loop?.state === 'paused' ? 'loop paused' : 'loop',
            { dimColor: true },
          ),
          Box({
            flexGrow: 1,
            flexShrink: 1,
            children: [
              text(loop?.nextText ? `next: ${loop.nextText}` : 'nothing next', {
                wrap: 'truncate-end',
                ...(loop?.nextText ? { color: 'cyan' } : { dimColor: true }),
              }),
            ],
          }),
          ...pauseButton,
        ],
      }),
    ],
  });

  // --- Needs you (UI-3) ---
  const openAt = Math.min(
    Math.max(0, sel?.kind === 'need' ? Number(sel.id) : (ui.need ?? 0)),
    Math.max(0, needs.length - 1),
  );
  const buttonsOf = (line) =>
    line.actions.map((a) =>
      Button({
        key: `need-${a.id}`,
        label: a.hotkey ? `${a.hotkey} ${a.label}` : a.label,
        ...(a.hotkey ? { hotkey: a.hotkey } : {}),
        variant: isNote(line) ? undefined : 'primary',
        onPress: () => on.onNeed(a.id, line),
      }),
    );
  const needsPanel = needs.length
    ? Box({
        key: 'panel-needs',
        flexDirection: 'column',
        children: [
          statusLine(
            'needs',
            'Needs you',
            decisions.length ? `${decisions.length} waiting` : 'notes only',
            needs.length,
            decisions.length ? 'yellow' : undefined,
          ),
          ...needs.map((line, i) => {
            const chosen = sel?.kind === 'need' && Number(sel.id) === i;
            if (i === openAt)
              return Box({
                key: `need-open`,
                flexDirection: 'column',
                borderStyle: 'round',
                borderColor: isNote(line) ? 'gray' : 'yellow',
                paddingX: 1,
                children: [
                  Box({
                    flexDirection: 'row',
                    columnGap: 1,
                    children: [
                      text(needWord(line), {
                        color: isNote(line) ? undefined : 'yellow',
                        dimColor: isNote(line),
                      }),
                      Box({
                        flexShrink: 1,
                        children: [text(line.text, { bold: true, wrap: 'wrap' })],
                      }),
                    ],
                  }),
                  ...(line.context
                    ? [text(line.context, { dimColor: true, wrap: 'truncate-end' })]
                    : []),
                  Box({
                    key: 'need-buttons',
                    flexDirection: 'row',
                    columnGap: 1,
                    flexWrap: 'wrap',
                    children: [
                      ...buttonsOf(line),
                      ...(isNote(line)
                        ? []
                        : [
                            Button({
                              key: 'need-why',
                              label: 'Why…',
                              plain: true,
                              ...(chosen ? { autoFocus: true } : {}),
                              onPress: () => on.onDecide(i, line),
                            }),
                          ]),
                    ],
                  }),
                ],
              });
            // One line each: what it is (pressed to open it in its place), then its words, cut to fit.
            return Box({
              key: `need-row-${i}`,
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Button({
                  key: `need-line-${i}`,
                  label: `${chosen ? '›' : ' '} ${needWord(line)}`,
                  plain: true,
                  ...(isNote(line) ? { dimColor: true } : {}),
                  onPress: () => on.onSelect({ kind: 'need', id: String(i) }),
                }),
                Box({
                  flexShrink: 1,
                  children: [
                    text(line.text, {
                      wrap: 'truncate-end',
                      ...(isNote(line) ? { dimColor: true } : {}),
                    }),
                  ],
                }),
              ],
            });
          }),
        ],
      })
    : null;

  // --- Queue and Log's rows, counted before the Lanes (UI-5) ---
  const open = queue.filter((e) => ['waiting', 'merging'].includes(e.state));
  const settled = queue
    .filter((e) => !['waiting', 'merging'].includes(e.state))
    .slice(-2)
    .reverse();
  const log = logLines(view.journal ?? [], state.stories ?? [], layout === 'wide' ? 8 : 5);

  // --- Lanes (UI-4) ---
  const asking = new Set([
    ...(view.held ?? []).map((c) => c.lane ?? LEAD),
    ...(view.requests ?? []).map((r) => r.lane ?? LEAD),
  ]);
  const stalledLanes = new Set((loop?.flagged ?? []).map((f) => f.lane));
  const poseOfLane = (l) =>
    view.art?.poses?.[l.name] ??
    poseFor(l, {
      live: view.live?.[l.name],
      waiting: asking.has(l.name),
      stalled: stalledLanes.has(l.name),
      queue,
    });
  const storyOf = (l) => l.story ?? storyToOpen(l, state);
  // A cell per requirement, as many as there's room for, then how many more.
  const cells = (story, room) => {
    const all = trailCells(story, view.status);
    const shown = all.length > room ? all.slice(0, Math.max(1, room - 3)) : all;
    return [
      ...shown.map((c, i) =>
        text(c.glyph, { key: `cell-${i}`, ...(c.color ? { color: c.color } : { dimColor: true }) }),
      ),
      ...(shown.length < all.length
        ? [text(`+${all.length - shown.length}`, { dimColor: true })]
        : []),
    ];
  };
  const cardRoom = Math.max(4, (layout === 'docked' ? columns : CARD_COLUMNS) - (SIZE + 7));
  const chips = (l, story) =>
    mapChips(view.maps?.[story?.id], view.trouble?.[l.name]).map((c, i) =>
      text(c.layer, {
        key: `chip-${i}`,
        ...(c.tone === 'red'
          ? { color: 'red', bold: true }
          : c.tone === 'amber'
            ? { color: 'yellow' }
            : { dimColor: true }),
      }),
    );
  // What else a card says beside its state: the branch, its background review (REVW-1), the loop's
  // note on the lane (nudged, restarted, stalled, refused by Claude Code; OWN-2) and another tool's
  // facts above zero (JOIN-2).
  const reviewWords = (r) =>
    r.state === 'running'
      ? `review running ${ago((view.now ?? 0) - r.startedAt).replace(' ago', '')}`
      : r.state === 'done'
        ? `review done · ${r.summary}`
        : r.state === 'skipped'
          ? `review skipped: ${r.why}`
          : `review failed: ${r.error}`;
  const notesOf = (l) => {
    const notes = [];
    const review = l.branch ? (loop?.reviews ?? []).find((r) => r.branch === l.branch) : null;
    if (review)
      notes.push({
        text: reviewWords(review),
        color: review.blockers ? 'red' : review.state === 'running' ? 'blue' : undefined,
      });
    const note = loop?.laneNotes?.[l.name];
    if (note) notes.push({ text: note, color: note === 'stalled' ? 'red' : 'yellow' });
    const facts = view.combined?.[l.name];
    if (facts?.without)
      notes.push({ text: `${facts.without} edited without understanding`, color: 'red' });
    if (facts?.owed)
      notes.push({
        text: `${facts.owed} card${facts.owed === 1 ? '' : 's'} owed`,
        color: 'yellow',
      });
    if (!notes.length && (l.branch || l.agent))
      notes.push({ text: [l.branch, l.agent].filter(Boolean).join(' · ') });
    return notes;
  };
  const actsOf = (l) =>
    laneActions(l, { queue, held: view.held ?? [], requests: view.requests ?? [] });
  const card = (l) => {
    const s = shownState(l, queue);
    const chosen = selectedLane?.name === l.name;
    // A lane at work on no story shows none; a selected resting lane shows the story Enter opens.
    const story = l.story ?? (chosen ? storyOf(l) : null);
    const live = view.live?.[l.name];
    const acts = chosen ? actsOf(l) : [];
    const storyText = story
      ? `${story.id} ${story.title ?? ''}`.trim()
      : l.name === LEAD
        ? 'the main session'
        : 'no story';
    const rows = [
      Box({
        key: 'card-head',
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(l.name, { bold: true, ...(chosen ? { color: 'cyan' } : {}) }),
          Box({
            flexGrow: 1,
            flexShrink: 1,
            children: [text(storyText, { wrap: 'truncate-end', dimColor: !story })],
          }),
          // USE-1: the lane's tokens this session.
          ...(view.usage?.lanes?.[l.name]
            ? [text(tokens(view.usage.lanes[l.name]), { dimColor: true })]
            : []),
        ],
      }),
      Box({
        key: 'card-state',
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(`${glyphOf(s)} ${wordOf(s)}`, styleOf(s)),
          ...notesOf(l).map((n, i) =>
            Box({
              key: `note-${i}`,
              flexShrink: 1,
              children: [
                text(n.text, {
                  wrap: 'truncate-end',
                  ...(n.color ? { color: n.color } : { dimColor: true }),
                }),
              ],
            }),
          ),
        ],
      }),
      Box({
        key: 'card-live',
        flexDirection: 'row',
        columnGap: 1,
        children: live
          ? [
              Box({
                flexShrink: 1,
                children: [
                  text(live.tool, {
                    wrap: 'truncate-end',
                    ...(live.level === 'stalled'
                      ? { color: 'red' }
                      : live.level === 'quiet'
                        ? { color: 'yellow' }
                        : { dimColor: true }),
                  }),
                ],
              }),
              ...clock(l.name, live, Boolean(l.active) && live.ago === 'now'),
            ]
          : [text(l.active ? 'at work' : ' ', { dimColor: true })],
      }),
      Box({
        key: 'card-trail',
        flexDirection: 'row',
        children: story ? cells(story, cardRoom) : [],
      }),
      Box({
        key: 'card-map',
        flexDirection: 'row',
        columnGap: 1,
        flexWrap: 'wrap',
        children: story ? chips(l, story) : [],
      }),
    ];
    // VIEW-2: the selected lane's story on the shared time axis.
    const timeline = view.art?.bars?.[l.name];
    if (chosen && timeline)
      rows.push(
        surface !== 'terminal' && els.Svg
          ? els.Svg({
              key: `bar-${l.name}`,
              source: timelineSvg([{ cells: timeline.slice(-cardRoom) }], {
                width: Math.min(timeline.length, cardRoom) * 6,
              }),
              alt: `${l.name}'s timeline`,
            })
          : Box({
              key: `bar-${l.name}`,
              flexDirection: 'row',
              children: runs(timeline.slice(-cardRoom)).map((r, i) =>
                text(BAR[r.kind].glyph.repeat(r.n), {
                  key: `run-${i}`,
                  ...(BAR[r.kind].color ? { color: BAR[r.kind].color } : { dimColor: true }),
                }),
              ),
            }),
      );
    // LANES-3: the selected lane's stories as cards, then its agent and what it owns.
    if (chosen)
      rows.push(
        ...laneDetail(
          {
            agent: l.agent ?? null,
            owns: view.paths?.[l.name] ?? [],
            stories: laneStories(l, state),
          },
          els,
        ),
      );
    if (chosen)
      rows.push(
        Box({
          key: 'card-acts',
          flexDirection: 'row',
          columnGap: 1,
          flexWrap: 'wrap',
          children: [
            ...(story
              ? [
                  Button({
                    key: 'open-story',
                    label: 'Open',
                    autoFocus: true,
                    variant: 'primary',
                    onPress: () => on.onOpen({ ...l, story }),
                  }),
                  Button({
                    key: 'open-trail',
                    label: 'Trail t',
                    hotkey: 't',
                    plain: true,
                    onPress: () => on.onView('trail', { lane: l, story }),
                  }),
                  Button({
                    key: 'open-map',
                    label: 'Map c',
                    hotkey: 'c',
                    plain: true,
                    onPress: () => on.onView('code', { lane: l, story }),
                  }),
                ]
              : []),
            ...acts.map((a) =>
              Button({
                key: `act-${a.id}`,
                // Drawn as "w: Watch": the hotkey shows once, before the word.
                label: a.label,
                ...(ACT_KEY[a.id] ? { hotkey: ACT_KEY[a.id] } : {}),
                plain: true,
                onPress: () => on.onLane(a.id, l),
              }),
            ),
          ],
        }),
      );
    return Box({
      key: `card-${l.name}`,
      flexDirection: 'row',
      columnGap: 1,
      borderStyle: 'round',
      borderColor: chosen ? 'cyan' : (STATE[s]?.color ?? 'gray'),
      ...(s === 'idle' && !chosen ? { borderDimColor: true } : {}),
      paddingX: 1,
      width: layout === 'docked' ? '100%' : CARD_COLUMNS,
      flexShrink: 1,
      children: [
        character(l.name, poseOfLane(l)),
        Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: rows }),
      ],
    });
  };
  const swimlane = (l) => {
    const s = shownState(l, queue);
    const chosen = selectedLane?.name === l.name;
    const story = l.story ?? (chosen ? storyOf(l) : null);
    const pose = poseOfLane(l);
    const barCells = view.art?.bars?.[l.name] ?? null;
    return Box({
      key: `lane-${l.name}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        text(POSES[pose]?.glyph ?? '·', {
          color: `#${looks[l.name].tint.toString(16).padStart(6, '0')}`,
        }),
        text(l.name, { bold: true, ...(chosen ? { color: 'cyan' } : {}) }),
        text(columns >= 60 ? `${glyphOf(s)} ${wordOf(s)}` : glyphOf(s), styleOf(s)),
        Box({
          flexGrow: 1,
          flexShrink: 1,
          children: [
            text(story ? `${story.id} ${story.title ?? ''}` : wordOf(s), {
              wrap: 'truncate-end',
              dimColor: !story,
            }),
          ],
        }),
        ...(story ? cells(story, Math.max(1, Math.floor((columns - 40) / 2))) : []),
        // VIEW-2: the time axis, its latest part, where there's room for it.
        ...(barCells && columns >= 90
          ? runs(barCells.slice(-(columns - 70))).map((r, i) =>
              text(BAR[r.kind].glyph.repeat(r.n), {
                key: `run-${i}`,
                ...(BAR[r.kind].color ? { color: BAR[r.kind].color } : { dimColor: true }),
              }),
            )
          : []),
      ],
    });
  };
  const shownLanes = [...atWork, ...resting].filter(matches);
  const cardLanes = atWork
    .filter(matches)
    .concat(selectedLane && !atWork.includes(selectedLane) ? [selectedLane] : []);
  const restingShown = resting.filter((l) => matches(l) && l !== selectedLane);
  // The rows the cards have: the pane's, less what the other panels and the keys take, and the
  // gaps between them; in the wide layout, the Lanes column's, under Build.
  const buildRows = (progress ? 4 : 3) + (state.planGaps ? 1 : 0);
  const needsRows = needs.length ? 1 + 4 + (needs[openAt]?.context ? 1 : 0) + needs.length - 1 : 0;
  const queueRows = open.length ? 1 + open.length + settled.length : 0;
  const logRows = 1 + log.length;
  const panels = 3 + (needs.length ? 1 : 0) + (open.length ? 1 : 0);
  const others =
    layout === 'wide'
      ? buildRows + 1 + 2
      : buildRows + needsRows + queueRows + logRows + 1 + panels;
  const lanesOwn =
    1 +
    (restingShown.length ? 1 : 0) +
    (state.ready.length ? 1 : 0) +
    (view.leadBusy ? 1 : 0) +
    (ui.filtering || needle ? 1 : 0);
  const lanesRoom = (view.rows ?? 40) - others - lanesOwn;
  const lanesColumns = layout === 'wide' ? Math.floor(columns * 0.6) : columns;
  const as = lanesAs(cardLanes.length, { columns: lanesColumns, rows: lanesRoom });
  const lead = state.lanes.find((l) => l.name === LEAD);
  const dispatched = atWork.filter((l) => l.name !== LEAD && l.active);
  const rail =
    view.leadBusy && dispatched.length && as === 'cards'
      ? [
          Box({
            key: 'rail',
            flexDirection: 'row',
            columnGap: 1,
            children: [
              text('lead', { dimColor: true }),
              ...(['terminal', 'desktop'].includes(surface) && els.Client
                ? [
                    els.Client({
                      key: 'rail',
                      module: './surface/rail.mjs',
                      props: { width: 12, running: true, motion },
                    }),
                  ]
                : [text('───────────▸', { color: 'yellow' })]),
              Box({
                flexShrink: 1,
                children: [
                  text(dispatched.map((l) => l.name).join(' · '), { wrap: 'truncate-end' }),
                ],
              }),
            ],
          }),
        ]
      : [];
  const lanesPanel = Box({
    key: 'panel-lanes',
    flexDirection: 'column',
    children: [
      statusLine(
        'lanes',
        'Lanes',
        atWork.length
          ? `${atWork.length} at work${needle ? ` · filter "${ui.search}"` : ''}`
          : 'all resting',
        state.lanes.length,
        atWork.length ? 'green' : undefined,
      ),
      ...(ui.filtering || needle
        ? [
            Box({
              key: 'filter-row',
              flexDirection: 'row',
              columnGap: 1,
              children: [
                text('filter', { dimColor: true }),
                els.Input({
                  key: 'filter',
                  label: '',
                  value: ui.search ?? '',
                  placeholder: 'lane, agent or story',
                  submitLabel: 'Filter',
                  onInput: (v) => on.onSearch(v),
                  onSubmit: (v) => on.onSearch(v),
                }),
              ],
            }),
          ]
        : []),
      ...rail,
      ...(as === 'cards'
        ? [
            Box({
              key: 'cards',
              flexDirection: layout === 'docked' ? 'column' : 'row',
              flexWrap: 'wrap',
              columnGap: 1,
              children: cardLanes.map(card),
            }),
          ]
        : [
            Box({
              key: 'swimlanes',
              flexDirection: 'column',
              children: cardLanes.map(swimlane),
            }),
          ]),
      ...(restingShown.length
        ? [
            Box({
              key: 'resting',
              flexDirection: 'row',
              columnGap: 1,
              children: [
                text('resting:', { dimColor: true }),
                Box({
                  flexShrink: 1,
                  children: [
                    text(restingShown.map((l) => l.name).join(', '), {
                      dimColor: true,
                      wrap: 'truncate-end',
                    }),
                  ],
                }),
              ],
            }),
          ]
        : []),
      ...(!shownLanes.length ? [text('No lane matches the filter.', { dimColor: true })] : []),
      // PANE-3: what's ready to start, the lead's own named as such.
      ...(state.ready.length
        ? [
            text(
              `ready: ${state.ready.map((r) => `${r.id}${r.lane === LEAD ? " (the lead's own)" : r.lane ? ` (${r.lane})` : ''}`).join(', ')}`,
              { dimColor: true, wrap: 'truncate-end' },
            ),
          ]
        : []),
    ],
  });

  // --- Queue and Log (UI-5) ---
  const storyOfBranch = (branch) =>
    (state.stories ?? []).find((s) => s.branch === branch)?.id ?? '';
  const queuePanel = open.length
    ? Box({
        key: 'panel-queue',
        flexDirection: 'column',
        children: [
          statusLine(
            'queue',
            'Queue',
            open.some((e) => e.state === 'merging') ? 'merging' : 'waiting',
            open.length,
            'cyan',
          ),
          ...open.map((e, i) =>
            Box({
              key: `queue-${e.branch}-${e.state}`,
              flexDirection: 'row',
              columnGap: 1,
              children: [
                text(`${i + 1}.`, { dimColor: true }),
                Box({ flexShrink: 1, children: [text(e.branch, { wrap: 'truncate-end' })] }),
                text(storyOfBranch(e.branch), { dimColor: true }),
                ...(e.commit && columns >= 40
                  ? [text(String(e.commit).slice(0, 7), { dimColor: true })]
                  : []),
                text(`${glyphOf(e.state)} ${wordOf(e.state)}`, styleOf(e.state)),
              ],
            }),
          ),
          // MQ-4: what it merged or sent back lately, and why.
          ...settled.map((e) =>
            Box({
              key: `queue-${e.branch}-${e.state}`,
              flexDirection: 'row',
              columnGap: 1,
              children: [
                text('·', { dimColor: true }),
                Box({
                  flexShrink: 1,
                  children: [text(e.branch, { dimColor: true, wrap: 'truncate-end' })],
                }),
                text(`${glyphOf(e.state)} ${wordOf(e.state)}`, styleOf(e.state)),
                ...(e.reason
                  ? [
                      Box({
                        flexShrink: 1,
                        children: [text(e.reason, { dimColor: true, wrap: 'truncate-end' })],
                      }),
                    ]
                  : []),
              ],
            }),
          ),
        ],
      })
    : null;
  const logPanel = Box({
    key: 'panel-log',
    flexDirection: 'column',
    children: [
      statusLine(
        'log',
        'Log',
        log.length ? ago((view.now ?? 0) - log.at(-1).at) : 'nothing yet',
        (view.journal ?? []).length,
      ),
      ...log.map((e, i) =>
        Box({
          key: `log-${i}`,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(e.time, { dimColor: true }),
            text(e.glyph, e.color ? { color: e.color } : { dimColor: true }),
            Box({
              flexShrink: 1,
              children: [
                text(e.text, { wrap: 'truncate-end', ...(e.yours ? { color: 'yellow' } : {}) }),
              ],
            }),
          ],
        }),
      ),
    ],
  });

  // --- the keys, on the last line (UI-8) ---
  const keys = keysFor(sel, {
    acts: selectedLane ? actsOf(selectedLane) : [],
    loop,
    story: Boolean(selectedLane && storyOf(selectedLane)),
  });
  // A key the pane answers itself is a Button, drawn as its hotkey and word; the rest are words alike.
  const bound = {
    j: ['move-next', () => on.onMove(1)],
    k: ['move-prev', () => on.onMove(-1)],
    f: ['filter-focus', () => on.onFocusSearch()],
    l: ['open-journal', () => on.onView('journal')],
  };
  const keysLine = Box({
    key: 'keys',
    flexDirection: 'row',
    columnGap: 1,
    flexWrap: 'wrap',
    children: keys.flatMap((k, i) => [
      ...(i ? [text('·', { key: `keys-dot-${i}`, dimColor: true })] : []),
      bound[k.key]
        ? Button({
            key: bound[k.key][0],
            label: k.label,
            hotkey: k.key,
            plain: true,
            dimColor: true,
            onPress: bound[k.key][1],
          })
        : text(`${k.key}: ${k.label}`, { key: `keys-${k.key}`, dimColor: true }),
    ]),
  });

  // --- the layouts (UI-10) ---
  if (layout === 'inline') {
    const first = needs[0];
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          key: 'inline-build',
          flexDirection: 'row',
          columnGap: 1,
          children: [
            ...(progress ? [bar(Math.max(6, Math.min(20, columns - 30)))] : []),
            Box({
              flexShrink: 1,
              children: [
                text(
                  `${progress ? `${progress.tested}/${progress.total} tested · ` : ''}${loopWord}`,
                  { wrap: 'truncate-end', dimColor: true },
                ),
              ],
            }),
          ],
        }),
        Box({
          key: 'inline-lanes',
          flexDirection: 'row',
          columnGap: 1,
          // A cell per lane coloured by its state, named where the names fit.
          children: state.lanes.map((l) => {
            const s = shownState(l, queue);
            const named = state.lanes.reduce((n, x) => n + x.name.length + 2, 0) <= columns;
            return text(named ? `${glyphOf(s)}${l.name}` : glyphOf(s), {
              key: `inline-${l.name}`,
              ...styleOf(s),
            });
          }),
        }),
        ...(first
          ? [
              Box({
                key: 'inline-need',
                flexDirection: 'row',
                columnGap: 1,
                children: [
                  Box({
                    flexShrink: 1,
                    children: [
                      text(
                        `${first.text}${needs.length > 1 ? ` · ${needs.length - 1} more` : ''}`,
                        {
                          wrap: 'truncate-end',
                          bold: !isNote(first),
                        },
                      ),
                    ],
                  }),
                  ...buttonsOf(first),
                ],
              }),
            ]
          : []),
      ],
    });
  }
  if (layout === 'wide')
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        buildPanel,
        Box({
          key: 'wide',
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Box({ key: 'left', flexDirection: 'column', width: '60%', children: [lanesPanel] }),
            Box({
              key: 'right',
              flexDirection: 'column',
              flexGrow: 1,
              flexShrink: 1,
              rowGap: 1,
              children: [needsPanel, queuePanel, logPanel].filter(Boolean),
            }),
          ],
        }),
        keysLine,
      ],
    });
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [buildPanel, needsPanel, lanesPanel, queuePanel, logPanel, keysLine].filter(Boolean),
  });
}

/**
 * UI-9: the band above the prompt, at most three lines: the most urgent item with its buttons and how
 * many more wait; while the build moves and nothing needs the person, one line (the milestone's bar,
 * the loop and the agents at work); with nothing happening and nothing waiting, nothing (null).
 */
export function bandOf(view, els, onAction) {
  const { Box, Text, Button } = els;
  const text = (value, style = {}) => Text({ ...style, children: [String(value)] });
  // A working session's own task heads its band (SESS-4); it isn't a decision.
  const task = (view.needs ?? []).find((l) => l.kind === 'task') ?? null;
  const needs = (view.needs ?? []).filter((l) => l.kind !== 'task');
  const decisions = needs.filter((l) => !isNote(l));
  const columns = Math.max(20, view.columns ?? 80);
  const taskLine = task
    ? [
        Box({
          key: 'band-task',
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text('task', { dimColor: true }),
            Box({ flexShrink: 1, children: [text(task.text, { wrap: 'truncate-end' })] }),
          ],
        }),
      ]
    : [];
  if (needs.length) {
    const [first] = decisions.length ? decisions : needs;
    const more = (decisions.length ? decisions.length : needs.length) - 1;
    // At most three lines: the task, the most urgent item, and its buttons with how many more wait.
    return Box({
      flexDirection: 'column',
      children: [
        ...taskLine,
        Box({
          key: 'band-first',
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(needWord(first), { color: isNote(first) ? undefined : 'yellow' }),
            Box({
              flexShrink: 1,
              children: [text(first.text, { wrap: 'truncate-end', bold: true })],
            }),
            ...(first.context
              ? [
                  Box({
                    flexShrink: 2,
                    children: [text(first.context, { dimColor: true, wrap: 'truncate-end' })],
                  }),
                ]
              : []),
          ],
        }),
        Box({
          key: 'band-more',
          flexDirection: 'row',
          columnGap: 1,
          // Narrow, the buttons wrap rather than spill.
          ...(columns < 60 ? { flexWrap: 'wrap' } : {}),
          children: [
            ...first.actions.map((a) =>
              Button({
                key: `band-${a.id}`,
                label: a.hotkey ? `${a.hotkey} ${a.label}` : a.label,
                ...(a.hotkey ? { hotkey: a.hotkey } : {}),
                onPress: () => onAction(a.id, first),
              }),
            ),
            ...(isNote(first)
              ? []
              : [
                  Button({
                    key: 'band-decide',
                    label: columns < 60 ? 'Why…' : 'Why, and what each choice does',
                    hotkey: 'd',
                    plain: true,
                    onPress: () => onAction('decide', first),
                  }),
                ]),
            ...(more > 0
              ? [
                  Box({
                    flexShrink: 1,
                    children: [
                      text(`${more} more waiting · /lanes`, {
                        dimColor: true,
                        wrap: 'truncate-end',
                      }),
                    ],
                  }),
                ]
              : []),
          ],
        }),
      ],
    });
  }
  if (task) return Box({ flexDirection: 'column', children: taskLine });
  const state = view.state;
  if (state?.kind !== 'ok') return null;
  const queue = view.loop?.queue ?? [];
  const working = state.lanes.filter((l) => l.active && l.name !== LEAD).length;
  const progress = buildProgress(state, view.status);
  const word = buildState(view.loop, { atWork: working, leadBusy: view.leadBusy });
  // A paused loop is said too, with Resume: the build won't move until the person says.
  if (word !== 'moving' && word !== 'paused') return null;
  const toggle = ['running', 'paused'].includes(view.loop?.state)
    ? view.loop.state === 'paused'
      ? { id: 'resume', label: 'Resume' }
      : { id: 'pause', label: 'Pause' }
    : null;
  const width = Math.max(6, Math.min(24, columns - 50));
  const runs = buildBar(progress, width);
  return Box({
    key: 'band-line',
    flexDirection: 'row',
    columnGap: 1,
    children: [
      ...(progress?.name ? [text(progress.name, { dimColor: true })] : []),
      ...(runs.length
        ? [
            Box({
              key: 'band-bar',
              flexDirection: 'row',
              flexShrink: 0,
              children: runs.map((r, i) =>
                text(r.glyph.repeat(r.n), {
                  key: `band-bar-${i}`,
                  ...(r.color ? { color: r.color } : { dimColor: true }),
                }),
              ),
            }),
            text(`${progress.tested}/${progress.total}`, { dimColor: true }),
          ]
        : []),
      Box({
        flexShrink: 1,
        children: [
          text(
            `${word === 'paused' ? 'loop paused' : word}${working ? ` · ${working} agent${working === 1 ? '' : 's'} at work` : view.leadBusy ? ' · the lead is at work' : ''}`,
            { wrap: 'truncate-end', color: word === 'moving' ? 'green' : 'yellow' },
          ),
        ],
      }),
      ...(toggle
        ? [
            Button({
              key: `band-${toggle.id}`,
              label: toggle.label,
              plain: true,
              onPress: () => onAction(toggle.id, null),
            }),
          ]
        : []),
    ],
  });
}

/** The character sheet (UI-11): every lane of the project in every pose and move. */
export function sheetView(lanes, els, { surface = 'terminal', motion = 'while-active' } = {}) {
  const { Box, Text } = els;
  const text = (value, style = {}) => Text({ ...style, children: [String(value)] });
  const names = [LEAD, ...lanes.filter((l) => l !== LEAD)];
  const looks = charactersOf(names);
  const poses = Object.keys(POSES);
  const draw = (name, pose) => {
    if (surface === 'terminal' && els.Client)
      return els.Client({
        key: `sheet-${name}-${pose}`,
        module: './surface/character.mjs',
        props: {
          look: looks[name],
          pose: POSES[pose].loop || POSES[pose].frames === 1 ? pose : 'resting',
          move: POSES[pose].loop || POSES[pose].frames === 1 ? null : { kind: pose, key: pose },
          motion,
        },
        width: 12,
        height: 6,
      });
    if (els.Svg)
      return els.Svg({
        key: `sheet-${name}-${pose}`,
        source: characterSvg(pose, looks[name], { motion }),
        alt: `${name}: ${POSES[pose].words}`,
        width: SIZE * 3,
        height: SIZE * 3,
      });
    return text(POSES[pose].glyph);
  };
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      text(
        "Each lane's character, in every pose and move. A lane's look comes from its name; past six lanes each also wears a mark.",
        { dimColor: true, wrap: 'wrap' },
      ),
      ...names.map((name) =>
        Box({
          key: `sheet-${name}`,
          flexDirection: 'column',
          children: [
            text(
              `${name} · ${looks[name].shape}${looks[name].mark ? ` · ${looks[name].mark}` : ''}`,
              { bold: true },
            ),
            Box({
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: 2,
              children: poses.map((pose) =>
                Box({
                  key: `sheet-${name}-${pose}-cell`,
                  flexDirection: 'column',
                  children: [draw(name, pose), text(POSES[pose].words, { dimColor: true })],
                }),
              ),
            }),
          ],
        }),
      ),
    ],
  });
}

/** A full view over the pane (UI-6): its name and how to go back, the view, and its keys. */
export function viewFrame(
  title,
  body,
  els,
  on,
  keys = [{ key: 'esc', label: 'back' }],
  { head = true } = {},
) {
  const { Box, Text } = els;
  const text = (value, style = {}) => Text({ ...style, children: [String(value)] });
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      ...(head ? [viewHead(title, els, on)] : []),
      ...(Array.isArray(body) ? body : [body]),
      text(keys.map((k) => `${k.key}: ${k.label}`).join(' · '), { dimColor: true }),
    ],
  });
}

/** A full view's first line: Back, and the view's name. */
function viewHead(title, { Box, Text, Button }, on) {
  return Box({
    key: 'view-head',
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Button({ key: 'view-back', label: '‹ Back', plain: true, onPress: () => on.onBack() }),
      Text({ bold: true, children: [String(title)] }),
    ],
  });
}
