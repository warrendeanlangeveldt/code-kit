// Panes v2 (docs/specs/11-panes.md): the Lanes pane's frame. A counts header, tabs, what needs the
// person, the tab's body and the keys, as pure functions of what the mod already holds. The Lanes
// tab's body is view.mjs's lanesPane; the Queue and Usage tabs reuse its sections.
import {
  NOT_CODE_KIT,
  STATE_COLOR,
  ago,
  lanesPane,
  loopSection,
  queueSection,
  shownState,
  tokens,
  usageSection,
} from './view.mjs';

export const TABS = [
  { id: 'lanes', label: 'Lanes', hotkey: '1' },
  { id: 'queue', label: 'Queue', hotkey: '2' },
  { id: 'usage', label: 'Usage', hotkey: '3' },
  { id: 'map', label: 'Map', hotkey: '4' },
];

/** The pane's own state, kept by the mod between draws. */
export const DEFAULT_UI = { tab: 'lanes', selected: null, filter: null, search: '', cell: null };

/** The glyph each state carries besides its colour (spec 11's quality target). */
const GLYPH = {
  building: '●',
  'in review': '◐',
  queued: '◆',
  'sent back': '↩',
  blocked: '■',
  ready: '○',
  merged: '✓',
};

/**
 * VIEW-1: the stories counted by state, in the order a build moves through them, only those there
 * are: [{ state, n, glyph }]. Lanes give building, in review, queued, sent back and blocked; the plan
 * gives ready and merged.
 */
export function countsOf(state, queue = []) {
  if (state?.kind !== 'ok') return [];
  const lanes = state.lanes.map((l) => shownState(l, queue));
  const n = (s) => lanes.filter((x) => x === s).length;
  const counts = [
    ['building', n('building')],
    ['in review', n('in review')],
    ['queued', n('queued')],
    ['sent back', n('sent back')],
    ['blocked', n('blocked')],
    ['ready', state.ready.length],
    ['merged', (state.stories ?? []).filter((s) => s.state === 'done').length],
  ];
  return counts.filter(([, k]) => k > 0).map(([s, k]) => ({ state: s, n: k, glyph: GLYPH[s] }));
}

/** VIEW-6's letters for the band's actions, as the needs-you strip draws them. */
const LETTER = {
  approve: 'a',
  approveHeld: 'a',
  review: 'r',
  merge: 'm',
  mergeQueue: 'm',
  go: 'g',
  pause: 'p',
  resume: 'p',
};

/** The selected lane's own acts (VIEW-6), as its state allows them: [{ id, label, hotkey }]. */
export function laneActions(lane, { queue = [], held = [], requests = [] } = {}) {
  if (!lane) return [];
  const acts = [];
  const asked = [...held, ...requests].some((r) => (r.lane ?? 'lead') === lane.name);
  if (asked) acts.push({ id: 'approve', label: 'Approve', hotkey: 'a' });
  const state = shownState(lane, queue);
  if (state === 'in review') {
    acts.push({ id: 'review', label: 'Review', hotkey: 'r' });
    acts.push({ id: 'sendBack', label: 'Send back', hotkey: 's' });
  }
  const head = queue.find((e) => ['waiting', 'merging'].includes(e.state));
  if (head && head.branch === lane.branch) acts.push({ id: 'merge', label: 'Merge', hotkey: 'm' });
  if (lane.active && lane.agent) {
    acts.push({ id: 'nudge', label: 'Nudge', hotkey: 'n' });
    acts.push({ id: 'stop', label: 'Stop', hotkey: 'x' });
  }
  return acts;
}

/**
 * The Lanes pane (spec 11). `view` holds what to draw: { state, usage, plan, loop, needs, live,
 * held, requests, ui, placement }; `needs` are the band's lines (VIEW-5). `on` acts: onTab(id),
 * onFilter(state), onMove(step), onNeed(id, line), onLane(id, lane), onSearch(text).
 */
export function lanesFrame(view, els, on) {
  const { Box, Text, Button, Input } = els;
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const { state, ui = DEFAULT_UI, loop = null, plan = null } = view;
  if (!state || state.kind === 'none') return text(NOT_CODE_KIT, { dimColor: true });
  if (state.kind === 'invalid')
    return text('The config is invalid: run code-kit check.', { color: 'red' });
  const queue = loop?.queue ?? [];

  // VIEW-1: the counts, each a filter; the loop's state and the plan's use.
  const loopWord =
    loop?.state === 'off'
      ? 'loop off'
      : loop?.state === 'paused'
        ? 'loop paused'
        : loop?.state === 'done'
          ? 'milestone done'
          : 'loop on';
  const header = Box({
    key: 'header',
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      ...countsOf(state, queue).map((c) =>
        Button({
          key: `count-${c.state}`,
          label: `${c.glyph} ${c.n} ${c.state}`,
          plain: true,
          ...(ui.filter && ui.filter !== c.state ? { dimColor: true } : {}),
          onPress: () => on.onFilter(c.state),
        }),
      ),
      text(loopWord, { color: loop?.state === 'paused' ? 'yellow' : 'green' }),
      ...(plan?.percent != null
        ? [
            text(`plan ${plan.percent}%`, {
              color: plan.paused ? 'red' : undefined,
              dimColor: !plan.paused,
            }),
          ]
        : []),
    ],
  });

  // VIEW-5: what waits on the person, pinned at the top with VIEW-6's letters.
  const used = new Set();
  const needs = (view.needs ?? []).map((line) => {
    const actions = line.actions.filter((a) => a.id !== 'lanes');
    return Box({
      key: `need-${line.kind}`,
      flexDirection: 'row',
      columnGap: 2,
      children: [
        text('!', { color: 'yellow', bold: true }),
        text(line.text, { bold: true }),
        ...actions.map((a) => {
          const letter = LETTER[a.id] && !used.has(LETTER[a.id]) ? LETTER[a.id] : undefined;
          if (letter) used.add(letter);
          return Button({
            key: `need-${a.id}`,
            label: a.label,
            ...(letter ? { hotkey: letter } : {}),
            variant: 'primary',
            onPress: () => on.onNeed(a.id, line),
          });
        }),
      ],
    });
  });

  // VIEW-8: inline, the header, what needs the person and one line per lane.
  if (view.placement === 'inline')
    return Box({
      flexDirection: 'column',
      children: [
        header,
        ...needs,
        ...state.lanes.map((l) => {
          const live = view.live?.[l.name];
          const s = shownState(l, queue);
          return Box({
            key: `lane-${l.name}`,
            flexDirection: 'row',
            columnGap: 1,
            children: [
              text(l.name, { bold: true }),
              text(s, STATE_COLOR[s] ? { color: STATE_COLOR[s] } : { dimColor: true }),
              ...(l.story ? [text(l.story.id, { dimColor: true })] : []),
              ...(live
                ? [
                    text(`${live.tool} · ${live.ago}`, {
                      wrap: 'truncate-end',
                      ...(live.level === 'stalled'
                        ? { color: 'red' }
                        : live.level === 'quiet'
                          ? { color: 'yellow' }
                          : { dimColor: true }),
                    }),
                  ]
                : []),
            ],
          });
        }),
      ],
    });

  // VIEW-6: the tabs, on 1 to 4.
  const tabs = Box({
    key: 'tabs',
    flexDirection: 'row',
    columnGap: 1,
    children: TABS.map((t) =>
      Button({
        key: `tab-${t.id}`,
        label: t.label,
        hotkey: t.hotkey,
        ...(ui.tab === t.id ? { variant: 'primary' } : { dimColor: true }),
        onPress: () => on.onTab(t.id),
      }),
    ),
  });

  // VIEW-7: a story's drill-down takes the tabs' place; Back (b, or Escape) returns.
  if (ui.story && view.story)
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        header,
        ...(needs.length ? [Box({ key: 'needs', flexDirection: 'column', children: needs })] : []),
        storyPane(view.story, els, on.story),
      ],
    });

  const selected = state.lanes.find((l) => l.name === ui.selected) ?? null;
  const body =
    ui.tab === 'map'
      ? mapTab(view.status, ui.cell, els, on)
      : ui.tab === 'queue'
        ? queueSection(loop, text, Box)
        : ui.tab === 'usage'
          ? usageSection(view.usage, plan, text, Box)
          : [
              lanesPane(state, els, view.usage, plan, loop, {
                filter: ui.filter,
                search: ui.search,
                selected: ui.selected,
                live: view.live ?? {},
                art: view.art ?? null,
              }),
              ...loopSection(loop, text, Box),
            ];
  const empty =
    ui.tab === 'queue'
      ? 'The merge queue is empty.'
      : ui.tab === 'usage'
        ? 'No usage measured yet this session.'
        : null;

  // VIEW-6: j/k move between lanes; the selected lane's acts; f filters.
  const keys =
    ui.tab === 'lanes'
      ? [
          Box({
            key: 'keys',
            flexDirection: 'row',
            columnGap: 1,
            flexWrap: 'wrap',
            children: [
              ...(selected?.story
                ? [
                    Button({
                      key: 'open-story',
                      label: `Open ${selected.story.id}`,
                      hotkey: 'o',
                      variant: 'primary',
                      autoFocus: true,
                      onPress: () => on.onOpen(selected),
                    }),
                  ]
                : []),
              Button({
                key: 'lane-next',
                label: 'Next lane',
                hotkey: 'j',
                plain: true,
                onPress: () => on.onMove(1),
              }),
              Button({
                key: 'lane-prev',
                label: 'Previous',
                hotkey: 'k',
                plain: true,
                onPress: () => on.onMove(-1),
              }),
              ...(selected
                ? laneActions(selected, { queue, held: view.held, requests: view.requests }).map(
                    (a) =>
                      Button({
                        key: `act-${a.id}`,
                        label: `${a.label} ${selected.name}`,
                        hotkey: used.has(a.hotkey) ? undefined : a.hotkey,
                        plain: true,
                        onPress: () => on.onLane(a.id, selected),
                      }),
                  )
                : []),
              ...(!used.has('p') && loop?.state !== 'off' && loop?.state !== 'done'
                ? [
                    Button({
                      key: 'loop-toggle',
                      label: loop?.state === 'paused' ? 'Resume loop' : 'Pause loop',
                      hotkey: 'p',
                      plain: true,
                      onPress: () => on.onNeed(loop?.state === 'paused' ? 'resume' : 'pause', null),
                    }),
                  ]
                : []),
            ],
          }),
          Input({
            key: 'filter',
            label: 'Filter (f)',
            value: ui.search,
            submitLabel: 'Filter',
            onInput: (v) => on.onSearch(v),
            onSubmit: (v) => on.onSearch(v),
          }),
          Button({
            key: 'filter-focus',
            label: 'Filter',
            hotkey: 'f',
            plain: true,
            dimColor: true,
            onPress: () => on.onFocusSearch(),
          }),
        ]
      : [];

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      header,
      ...(needs.length ? [Box({ key: 'needs', flexDirection: 'column', children: needs })] : []),
      tabs,
      ...(body.length ? body : [text(empty, { dimColor: true })]),
      ...keys,
    ],
  });
}

/** A tool call as the liveness column reads it (VIEW-4): "Bash npm test", "Edit apps/web/a.ts". */
export function toolLine(call) {
  const tool = call?.tool ?? 'tool';
  const what =
    call?.command ?? call?.file_path ?? call?.path ?? call?.pattern ?? call?.description ?? '';
  const short = String(what).split('\n')[0].replace(/\s+/g, ' ').trim();
  return short ? `${tool} ${short.length > 40 ? `${short.slice(0, 39)}…` : short}` : tool;
}

/** A lane's liveness (VIEW-4): quiet past the nudge time, stalled past the restart time or flagged. */
export function liveLevel(quietMs, stall, { flagged = false, running = false } = {}) {
  if (flagged) return 'stalled';
  if (running) return null;
  if (quietMs >= stall.restartMinutes * 60000) return 'stalled';
  if (quietMs >= stall.nudgeMinutes * 60000) return 'quiet';
  return null;
}

export const SENDBACK_ID = 'code-kit-sendback';

/** VIEW-6's send back: the branch and story, and the person's reason, which the lane's fix reads. */
export function sendBackPane(
  pending,
  { Box, Text, Input, Button },
  { onInput, onSubmit, onCancel },
) {
  if (!pending) return Text({ dimColor: true, children: ['Nothing to send back.'] });
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Text({ bold: true, children: [`Send ${pending.branch} back to the ${pending.lane} lane`] }),
      Text({
        children: [
          `${pending.story} goes back for its fix, with your reason; the loop dispatches the fix.`,
        ],
      }),
      Input({
        key: 'sendback-reason',
        label: 'Reason',
        value: pending.reason,
        submitLabel: 'Send back',
        autoFocus: true,
        onInput,
        onSubmit,
      }),
      ...(pending.error ? [Text({ color: 'red', children: [pending.error] })] : []),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({
            key: 'sendback-confirm',
            label: 'Send back',
            onPress: () => onSubmit(pending.reason),
          }),
          Button({ key: 'sendback-cancel', label: 'Cancel', onPress: onCancel }),
        ],
      }),
    ],
  });
}

/**
 * A unified diff split per file, each as the hunks the Code element draws (its `---`/`+++` pair and
 * `@@` hunks, without git's `diff --git` and index lines): [{ path, source }]. Files without hunks
 * (binary, a mode change) are left out.
 */
export function fileDiffs(text) {
  const out = [];
  for (const part of String(text ?? '')
    .split(/^diff --git /m)
    .slice(1)) {
    const lines = part.split('\n');
    const from = lines.findIndex((l) => l.startsWith('--- '));
    if (from < 0 || !lines.slice(from).some((l) => l.startsWith('@@'))) continue;
    const plus = lines.find((l) => l.startsWith('+++ '))?.slice(4) ?? '';
    const minus = lines[from].slice(4);
    const path = (plus === '/dev/null' ? minus : plus).replace(/^[ab]\//, '');
    out.push({ path, source: lines.slice(from).join('\n').replace(/\n+$/, '\n') });
  }
  return out;
}

const SPEC_CHECK_COLOR = { done: 'green', partial: 'yellow', missing: 'red', conflicts: 'red' };
const SEVERITY_TITLE = { blocker: 'Blockers', concern: 'Concerns', nit: 'Nits' };

/**
 * VIEW-7 and REVW-5: a story's drill-down. `story` is { id, data, error }, data being `code-kit
 * story --json`'s; `review` the reviewer's for its branch; `tokens` its usage; `steps` the loop's for
 * it; `actions` the lane's acts. `on`: onBack(), onFile(path), onAct(id).
 */
export function storyPane(
  { story, review, tokens: usedTokens, outlier, steps, actions, file, now },
  els,
  on,
) {
  const { Box, Text, Button, Code } = els;
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const section = (key, title, children) =>
    Box({ key, flexDirection: 'column', children: [text(title, { bold: true }), ...children] });
  const d = story.data;
  const head = Box({
    key: 'story-head',
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Button({
        key: 'story-back',
        label: 'Back',
        hotkey: 'b',
        plain: true,
        dimColor: true,
        onPress: on.onBack,
      }),
      text(d ? `${d.id} ${d.title}` : story.id, { bold: true }),
      ...(d
        ? [text(`${d.lane} · ${d.state}${d.branch ? ` · ${d.branch}` : ''}`, { dimColor: true })]
        : []),
    ],
  });
  if (story.error)
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [head, text(story.error, { color: 'red' })],
    });
  if (!d)
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [head, text('Reading the story…', { dimColor: true })],
    });

  const checked = new Map((d.specCheck?.rows ?? []).map((r) => [r.requirement, r]));
  const requirements = section(
    'story-requirements',
    `Requirements${d.specCheck ? '' : ' (no spec-check report yet)'}`,
    d.requirements.length
      ? d.requirements.map((r) => {
          const c = checked.get(r.id);
          return Box({
            key: `req-${r.id}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              text(r.id),
              text(r.title, { wrap: 'truncate-end' }),
              text(`plan: ${r.state}`, { dimColor: true }),
              ...(c
                ? [text(`spec-check: ${c.status}`, { color: SPEC_CHECK_COLOR[c.status] })]
                : []),
              ...(c?.where ? [text(c.where, { dimColor: true, wrap: 'truncate-end' })] : []),
              ...(r.tests.length ? [text(`${r.tests.length} test(s)`, { dimColor: true })] : []),
            ],
          });
        })
      : [text('It names no requirement.', { dimColor: true })],
  );

  const findings = review
    ? section(
        'story-findings',
        review.state === 'done'
          ? `Review of ${review.head.slice(0, 7)}`
          : review.state === 'running'
            ? 'Review running'
            : `Review ${review.state}: ${review.why ?? review.error ?? ''}`,
        ['blocker', 'concern', 'nit'].flatMap((s) => {
          const of = review.findings.filter((f) => f.severity === s);
          if (!of.length) return [];
          return [
            text(SEVERITY_TITLE[s], {
              color: s === 'blocker' ? 'red' : s === 'concern' ? 'yellow' : undefined,
            }),
            ...of.map((f, i) =>
              Button({
                key: `finding-${s}-${i}`,
                label: `${f.where ? `${f.where}  ` : ''}${f.text}${f.rule ? ` (${f.rule})` : ''}`,
                plain: true,
                // REVW-5: the finding's place is a way into the diff.
                onPress: () => f.where && on.onFile(f.where.split(':')[0]),
              }),
            ),
          ];
        }),
      )
    : null;

  const problems = d.verify
    ? Object.entries(d.verify.problems).flatMap(([group, list]) =>
        list.map((p) => `${group}: ${p}`),
      )
    : [];
  const verify = d.verify
    ? section(
        'story-verify',
        'verify (without checks)',
        problems.length
          ? problems.map((p, i) =>
              text(p, { key: `problem-${i}`, color: 'red', wrap: 'truncate-end' }),
            )
          : [text('No problems.', { color: 'green' })],
      )
    : null;

  const diffs = fileDiffs(d.diff?.text);
  const shown = diffs.find((f) => f.path === file) ?? diffs[0] ?? null;
  const diff = d.diff
    ? section(
        'story-diff',
        `Diff against ${d.base} · ${d.diff.files.length} file(s)${d.diff.truncated ? ' (cut short)' : ''}`,
        [
          Box({
            key: 'diff-files',
            flexDirection: 'row',
            columnGap: 2,
            flexWrap: 'wrap',
            children: d.diff.files.map((f, i) =>
              Button({
                key: `file-${i}`,
                label: `${f.path} +${f.added} -${f.removed}`,
                plain: true,
                ...(shown?.path === f.path ? {} : { dimColor: true }),
                onPress: () => on.onFile(f.path),
              }),
            ),
          }),
          ...(shown
            ? [
                Code({
                  key: 'diff-code',
                  source: shown.source,
                  format: 'diff',
                  path: shown.path,
                  wrap: 'truncate-end',
                }),
              ]
            : []),
        ],
      )
    : null;

  const usage = usedTokens
    ? text(
        `Used ${tokens(usedTokens)} tokens this session${outlier ? `, ${outlier}× the usual` : ''}`,
        {
          ...(outlier ? { color: 'yellow' } : { dimColor: true }),
        },
      )
    : null;
  const recent = steps.length
    ? section(
        'story-steps',
        'Loop steps',
        steps
          .slice(-6)
          .reverse()
          .map((s, i) =>
            text(`${ago(now - s.at)}  ${s.kind}  ${s.target}`, {
              key: `sstep-${i}`,
              dimColor: true,
            }),
          ),
      )
    : null;
  const acts = actions.length
    ? Box({
        key: 'story-acts',
        flexDirection: 'row',
        columnGap: 2,
        children: actions.map((a) =>
          Button({
            key: `story-${a.id}`,
            label: a.label,
            hotkey: a.hotkey,
            variant: 'primary',
            onPress: () => on.onAct(a.id),
          }),
        ),
      })
    : null;

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [head, acts, requirements, findings, verify, usage, recent, diff].filter(Boolean),
  });
}

/** VIEW-6: the person's Escape on an open story goes back to the lanes instead of closing the pane. */
export const closeGoesBack = (e, paneId, ui) =>
  e.id === paneId && e.origin?.kind === 'person' && Boolean(ui.story);

// --- the traceability map (spec 10) ------------------------------------------------------------

/** Each cell state's glyph, colour and words (TRACE-1, TRACE-4: the glyph reads without colour). */
export const CELL = {
  tested: { glyph: '■', color: 'green', words: 'done and tested' },
  done: { glyph: '□', color: 'green', words: 'done, untested' },
  'in progress': { glyph: '◐', color: 'blue', words: 'in progress' },
  todo: { glyph: '○', color: undefined, words: 'todo' },
  'no story': { glyph: '✗', color: 'red', words: 'without a story' },
  removed: { glyph: '·', color: undefined, words: 'removed' },
};

/** A requirement's cell state: status's state, with done split by whether a test names it. */
export const cellOf = (r) => (r.state === 'done' ? (r.tests?.length ? 'tested' : 'done') : r.state);

/** The requirements by spec, in the specs' order: [{ spec, requirements }]. */
export function mapRows(requirements = []) {
  const rows = [];
  for (const r of requirements) {
    let row = rows.find((x) => x.spec === r.file);
    if (!row) rows.push((row = { spec: r.file, requirements: [] }));
    row.requirements.push(r);
  }
  return rows;
}

/** TRACE-1's legend: the count of each cell state there is. */
export function mapLegend(requirements = []) {
  return Object.entries(CELL)
    .map(([state, c]) => ({
      state,
      ...c,
      n: requirements.filter((r) => cellOf(r) === state).length,
    }))
    .filter((c) => c.n > 0);
}

/** The cell `step` places from `id` in reading order, or the first row of the next spec (`rows`). */
export function moveCell(requirements, id, step, { rows = false } = {}) {
  if (!requirements.length) return null;
  const at = Math.max(
    0,
    requirements.findIndex((r) => r.id === id),
  );
  if (!rows) return requirements[(at + step + requirements.length) % requirements.length].id;
  const specs = mapRows(requirements);
  const row = specs.findIndex((s) => s.requirements.some((r) => r.id === requirements[at].id));
  return specs[(row + step + specs.length) % specs.length].requirements[0].id;
}

/**
 * The Map tab (TRACE-1 to TRACE-4): a row per spec, a cell per requirement, a legend, and the
 * selected requirement's stories and tests. `status` is `code-kit status --json`'s.
 */
export function mapTab(status, selectedId, { Box, Text, Button, Select }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const requirements = status?.requirements ?? [];
  if (!requirements.length)
    return [
      text('No requirements in the specs yet: the map fills as spec-design writes them.', {
        dimColor: true,
      }),
    ];
  const selected = requirements.find((r) => r.id === selectedId) ?? requirements[0];
  const rows = mapRows(requirements);
  const label = (spec) => spec.split('/').pop().replace(/\.md$/, '');
  const width = Math.max(...rows.map((r) => label(r.spec).length));
  const legend = Box({
    key: 'map-legend',
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: mapLegend(requirements).map((c) =>
      text(`${c.glyph} ${c.n} ${c.words}`, c.color ? { color: c.color } : { dimColor: true }),
    ),
  });
  const grid = Box({
    key: 'map-grid',
    flexDirection: 'column',
    children: rows.map((row) =>
      Box({
        key: `map-row-${label(row.spec)}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(label(row.spec).padEnd(width), { dimColor: true }),
          ...row.requirements.map((r) => {
            const c = CELL[cellOf(r)];
            // Keyed by its Box: a Text keeps no key of its own.
            return Box({
              key: `cell-${r.id}`,
              children: [
                text(c.glyph, {
                  ...(c.color ? { color: c.color } : { dimColor: cellOf(r) === 'removed' }),
                  ...(r.id === selected.id ? { inverse: true, bold: true } : {}),
                }),
              ],
            });
          }),
        ],
      }),
    ),
  });
  const keys = Box({
    key: 'map-keys',
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Button({
        key: 'cell-prev',
        label: 'Previous',
        hotkey: 'h',
        plain: true,
        onPress: () => on.onCell(moveCell(requirements, selected.id, -1)),
      }),
      Button({
        key: 'cell-next',
        label: 'Next',
        hotkey: 'l',
        plain: true,
        onPress: () => on.onCell(moveCell(requirements, selected.id, 1)),
      }),
      Button({
        key: 'row-next',
        label: 'Next spec',
        hotkey: 'j',
        plain: true,
        onPress: () => on.onCell(moveCell(requirements, selected.id, 1, { rows: true })),
      }),
      Button({
        key: 'row-prev',
        label: 'Previous spec',
        hotkey: 'k',
        plain: true,
        onPress: () => on.onCell(moveCell(requirements, selected.id, -1, { rows: true })),
      }),
    ],
  });
  // TRACE-2: the selected requirement, its stories with their states and branches, and its tests.
  const stories = (status.stories ?? []).filter((s) => selected.stories?.includes(s.id));
  const detail = Box({
    key: 'map-detail',
    flexDirection: 'column',
    children: [
      Select({
        key: 'map-select',
        label: 'Requirement',
        value: selected.id,
        options: requirements.map((r) => ({
          value: r.id,
          label: `${CELL[cellOf(r)].glyph} ${r.id} ${r.title}`,
        })),
        onSelect: (id) => on.onCell(id),
      }),
      text(`${selected.id} ${selected.title}`, { bold: true }),
      text(`${selected.file} · ${CELL[cellOf(selected)].words}`, { dimColor: true }),
      ...(stories.length
        ? stories.map((s) =>
            text(
              `${s.id} ${s.title} · ${s.lane} · ${s.state}${s.branchExists ? ` · ${s.branch}` : ''}`,
              { key: `map-story-${s.id}` },
            ),
          )
        : [text('No story delivers it yet: a gap in the plan.', { color: 'red' })]),
      ...(selected.tests?.length
        ? [
            text('Tests that name it', { bold: true }),
            ...selected.tests.map((t, i) =>
              text(`  ${t}`, { key: `map-test-${i}`, dimColor: true }),
            ),
          ]
        : [text('No test names it.', { dimColor: true })]),
    ],
  });
  return [legend, grid, keys, detail];
}
