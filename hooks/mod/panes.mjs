// The full views the pane opens over its panels (docs/specs/27-the-mod-redesigned.md, UI-6): a story's
// drill-down (VIEW-7), the Trail (TRAIL-1, spec 10's map), the Code map (MAP-1 to MAP-5), the
// decisions with their lineage (DECIDE-2) and the Journal (JOURNAL-1), and a lane's acts and liveness,
// as pure functions of what the mod already holds.
import { trailRows as trailRowsDrawn, trailSvg } from './trail.mjs';
import {
  MAP_LEGEND,
  PROJECT,
  cardOf,
  glowByFolder,
  mapRows as codeRows,
  mapStoryOf,
  mapSvg,
  neighboursOf,
} from './codemap.mjs';
import { ago, shownState, tokens } from './view.mjs';

/** A lane's stories in plan order. */
export const laneStories = (lane, state) =>
  (state?.stories ?? []).filter((s) => s.lane === lane.name);

/** The story Enter opens on a lane: the one it's on, else its next not done, else its last done. */
export function storyToOpen(lane, state) {
  if (lane.story) return lane.story;
  const own = laneStories(lane, state);
  return own.find((s) => s.state !== 'done') ?? own.at(-1) ?? null;
}

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
    // WATCH-1: the lane agent's own transcript, in the main view.
    acts.push({ id: 'watch', label: 'Watch', hotkey: 'w' });
    acts.push({ id: 'nudge', label: 'Nudge', hotkey: 'n' });
    acts.push({ id: 'stop', label: 'Stop', hotkey: 'x' });
  }
  return acts;
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
  {
    story,
    review,
    tokens: usedTokens,
    outlier,
    steps,
    actions,
    file,
    now,
    understanding = null,
    columns = 100,
  },
  els,
  on,
) {
  const { Box, Text, Button, Code } = els;
  // UI-13: words wrap rather than spill, unless they say otherwise.
  const text = (value, style = {}) => Text({ wrap: 'wrap', ...style, children: [value] });
  /** A path that fits on a button: its last parts, where the whole won't. */
  const fitPath = (path, room) => {
    if (path.length <= room) return path;
    const tail = path.split('/').slice(-2).join('/');
    return tail.length + 2 <= room ? `…/${tail}` : `…/${path.split('/').pop()}`;
  };
  const section = (key, title, children) =>
    Box({ key, flexDirection: 'column', children: [text(title, { bold: true }), ...children] });
  const d = story.data;
  const head = Box({
    key: 'story-head',
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
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
                label: `${fitPath(f.path, columns - 12)} +${f.added} -${f.removed}`,
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

  // JOIN-2 to JOIN-4: what the adapters know: the lane's edits without understanding and the files
  // still unread, its cards owed, and the rules on the story's files; each file opens in the
  // adapter's own view.
  const opener = (d.adapters ?? []).find((a) => a.open) ?? null;
  const openFile = (path, key) =>
    opener
      ? Button({ key, label: path, plain: true, onPress: () => on.onOpenIn(opener, path) })
      : text(path);
  const combined = [];
  if (understanding?.withoutUnderstanding.length)
    combined.push(
      section(
        'story-understanding',
        `Edited without understanding (${understanding.withoutUnderstanding.length})`,
        understanding.withoutUnderstanding.map((e, i) =>
          Box({
            key: `unread-${i}`,
            flexDirection: 'row',
            columnGap: 2,
            children: [
              openFile(e.path, `unread-file-${i}`),
              text(e.unread.length ? `still unread: ${e.unread.join(', ')}` : '', { color: 'red' }),
            ],
          }),
        ),
      ),
    );
  if (understanding?.cardsOwed.length)
    combined.push(
      section(
        'story-cards',
        `Cards owed (${understanding.cardsOwed.length})`,
        understanding.cardsOwed.map((c, i) => openFile(c, `owed-${i}`)),
      ),
    );
  const rules = new Map();
  for (const a of d.adapters ?? [])
    for (const [path, f] of Object.entries(a.files ?? {}))
      for (const r of f.rules ?? []) {
        const entry = rules.get(r.id) ?? { ...r, paths: [] };
        entry.paths.push(path);
        rules.set(r.id, entry);
      }
  if (rules.size)
    combined.push(
      section(
        'story-rules',
        `Rules on its files (${rules.size})`,
        [...rules.values()]
          .sort((a, b) => Number(a.proposed) - Number(b.proposed))
          .map((r) =>
            Box({
              key: `rule-${r.id}`,
              children: [
                text(
                  `${r.proposed ? 'proposed' : 'agreed  '}  ${r.id}  ${r.text}  (${r.paths.length} file${r.paths.length === 1 ? '' : 's'})`,
                  { ...(r.proposed ? { dimColor: true } : {}), wrap: 'truncate-end' },
                ),
              ],
            }),
          ),
      ),
    );
  const viewIn =
    opener && shown
      ? Button({
          key: 'story-open-in',
          label: `View ${shown.path} in ${opener.name}`,
          hotkey: 'v',
          plain: true,
          onPress: () => on.onOpenIn(opener, shown.path),
        })
      : null;

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      head,
      acts,
      requirements,
      findings,
      verify,
      ...combined,
      usage,
      recent,
      diff,
      viewIn,
    ].filter(Boolean),
  });
}

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

/** The engine's limit on a Select's options. */
export const SELECT_MAX = 64;

/**
 * TRACE-2: the requirements the picker offers: those in the selected one's spec, at most SELECT_MAX,
 * a window around the selected one when the spec has more.
 */
export function pickerOf(requirements, selected) {
  const same = requirements.filter((r) => r.file === selected.file);
  if (same.length <= SELECT_MAX) return same;
  const at = same.findIndex((r) => r.id === selected.id);
  const start = Math.max(0, Math.min(at - SELECT_MAX / 2, same.length - SELECT_MAX));
  return same.slice(start, start + SELECT_MAX);
}

/**
 * The Map tab (TRACE-1 to TRACE-4): a row per spec, a cell per requirement, a legend, and the
 * selected requirement's stories and tests. `status` is `code-kit status --json`'s.
 */
export function mapTab(
  status,
  selectedId,
  { Box, Text, Button, Select, Svg },
  on,
  trail = null,
  { surface = 'terminal', columns = 100 } = {},
) {
  // UI-13: words wrap rather than spill, unless they say otherwise.
  const text = (value, style = {}) => Text({ wrap: 'wrap', ...style, children: [value] });
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
          text(label(row.spec).padEnd(width), { dimColor: true, wrap: 'truncate-end' }),
          Box({
            flexDirection: 'row',
            flexWrap: 'wrap',
            flexShrink: 1,
            children: row.requirements.map((r) => {
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
          }),
        ],
      }),
    ),
  });
  const keys = Box({
    key: 'map-keys',
    flexDirection: 'row',
    columnGap: 1,
    flexWrap: 'wrap',
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
        // A Select holds at most 64 options: the selected requirement's own spec, around it.
        options: pickerOf(requirements, selected).map((r) => ({
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
      // TRAIL-1: the code its stories changed, once the trail is read.
      ...(() => {
        const row = trail?.requirements?.find((r) => r.id === selected.id);
        if (!row) return [];
        return row.files.length
          ? [
              text(`Code its stories changed (${row.files.length})`, { bold: true }),
              Box({
                key: 'map-files',
                children: [
                  text(
                    `  ${row.files
                      .slice(0, 6)
                      .map((f) => f.split('/').pop())
                      .join(', ')}${row.files.length > 6 ? ', …' : ''}`,
                    { dimColor: true, wrap: 'truncate-end' },
                  ),
                ],
              }),
            ]
          : [text('No code changed for it yet.', { dimColor: true })];
      })(),
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
  // TRAIL-1: the selected requirement's spec as a trail: each requirement to its stories, the code
  // they changed and the tests that name it, a gap where any link is missing.
  const spec = selected.file;
  const trailRows = (trail?.requirements ?? []).filter(
    (r) =>
      r.spec === spec?.split('/').pop() && requirements.find((q) => q.id === r.id)?.file === spec,
  );
  const TONE = {
    req: {},
    selected: { bold: true, color: 'cyan' },
    dim: { dimColor: true },
    done: { color: 'green' },
    moving: { color: 'blue' },
    waiting: { color: 'red' },
    gap: { color: 'red' },
    test: { color: 'green' },
  };
  const flow =
    surface && surface !== 'terminal' && Svg
      ? Svg({
          source: trailSvg(trailRows, { selected: selected.id }),
          alt: `${label(spec)}'s trail: each requirement to its stories, code and tests`,
        })
      : Box({
          key: 'trail-flow',
          flexDirection: 'column',
          children: trailRowsDrawn(trailRows, { selected: selected.id, width: columns }).map(
            (runs, i) =>
              Box({
                key: `trail-${trailRows[i].id}`,
                flexDirection: 'row',
                // The links keep their places; the last (the test that names it) is cut to fit.
                children: runs.map((r, j) =>
                  j === runs.length - 1
                    ? Box({
                        flexShrink: 1,
                        children: [
                          text(r.text, { ...(TONE[r.style] ?? {}), wrap: 'truncate-end' }),
                        ],
                      })
                    : text(r.text, { ...(TONE[r.style] ?? {}), wrap: undefined }),
                ),
              }),
          ),
        });
  // The flow's columns need the room: in a narrower pane the detail below gives the same links.
  const flowFits = surface !== 'terminal' || columns >= 64;
  const trailBox =
    trailRows.length && flowFits
      ? [
          Box({
            key: 'trail',
            flexDirection: 'column',
            children: [text(`Trail · ${label(spec)}`, { bold: true }), flow],
          }),
        ]
      : [];
  return [legend, grid, keys, ...trailBox, detail];
}

/** A tint darkened toward the terminal's ground, for a glowing box's fill: `share` of the tint kept. */
const shade = (hex, share) => {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return undefined;
  const c = (v) => Math.round(((n >> v) & 0xff) * share + 14 * (1 - share));
  return `#${[16, 8, 0].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
};

/** A code map run's text style: its lane's tint where it glows, a fill inside a glowing box. */
function runStyle(r, tints) {
  const tint = r.lane ? (tints[r.lane] ?? '#5fb3b3') : null;
  if (tint && (r.style === 'fill-read' || r.style === 'fill-edit'))
    return {
      backgroundColor: shade(tint, r.style === 'fill-edit' ? 0.45 : 0.28),
      color: 'white',
      ...(r.style === 'fill-edit' ? { bold: true } : {}),
    };
  if (tint && (r.style === 'reading' || r.style === 'editing'))
    return { color: tint, bold: r.style === 'editing' };
  return RUN_STYLE[r.style] ?? {};
}

/** The colour each style of the code map's runs takes, the lane's tint where it glows. */
const RUN_STYLE = {
  dim: { dimColor: true },
  node: {},
  selected: { color: 'cyan', bold: true },
  ok: { color: 'green' },
  warn: { color: 'yellow' },
};

/**
 * MAP-1 to MAP-4: the Code map tab: the stories to choose from, the story's files by layer with their
 * imports (glowing where a lane reads or edits them), and the selected file's card and neighbours.
 * `view` holds { state, codeMap, ui, glow, art, surface, columns }; `on` holds onMapStory(id),
 * onMapFile(path), onOpenFile(path).
 */
export function codeTab(view, { Box, Text, Button, Svg }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const { state, ui = {}, codeMap: map = null, art = null } = view;
  let glow = view.glow ?? {};
  const storyId = mapStoryOf(state, ui.selected, ui.mapStory);
  const project = { id: PROJECT, title: 'Whole project' };
  const choices = [
    project,
    ...(state?.stories ?? []).filter(
      (s) => s.id === storyId || ['in progress', 'review', 'sent back'].includes(s.state),
    ),
  ];
  const picker = Box({
    key: 'map-stories',
    flexDirection: 'row',
    columnGap: 1,
    flexWrap: 'wrap',
    children: choices.map((s) =>
      Button({
        key: `map-story-${s.id}`,
        // The story's title where the pane has room for it; its id alone in a narrow one.
        label: s.id === PROJECT ? s.title : view.columns >= 90 ? `${s.id} ${s.title}` : s.id,
        ...(s.id === storyId ? { variant: 'primary' } : { plain: true }),
        onPress: () => on.onMapStory(s.id),
      }),
    ),
  });
  if (!storyId) return [text('No story to map yet: the plan has none open.', { dimColor: true })];
  if (!map || map.story?.id !== storyId)
    return [
      picker,
      text(storyId === PROJECT ? "Reading the project's code…" : `Reading ${storyId}'s code…`, {
        dimColor: true,
      }),
    ];
  if (!map.files.length)
    return [
      picker,
      text(
        storyId === PROJECT
          ? 'The project has no code yet.'
          : `${storyId} hasn't changed any code yet. Whole project shows the code that's there.`,
        { dimColor: true },
      ),
    ];
  // MAP-5: on the project map, a file at work glows on its folder.
  if (storyId === PROJECT)
    glow = glowByFolder(
      glow,
      map.files.map((f) => f.path),
    );
  const selected = map.files.some((f) => f.path === ui.mapFile) ? ui.mapFile : map.files[0].path;
  // The lanes' tints are RGB numbers (the characters' colours); text and SVG take them as hex.
  const tints = Object.fromEntries(
    Object.entries(art?.tints ?? {}).map(([lane, rgb]) => [
      lane,
      typeof rgb === 'number' ? `#${rgb.toString(16).padStart(6, '0')}` : rgb,
    ]),
  );
  const width = Math.max(40, (view.columns ?? 100) - 4);
  const drawing =
    view.surface !== 'terminal' && Svg
      ? Svg({
          source: mapSvg(map, { glow, selected, tints, width }),
          alt: `${storyId}'s code: ${map.files.length} files by layer`,
          isInteractive: true,
        })
      : Box({
          key: 'code-map',
          flexDirection: 'column',
          // UI-13: a drawing wider than the pane is cut at its edge, not spilled past it.
          overflow: 'hidden',
          children: codeRows(map, { glow, selected, width }).map((runs, y) =>
            Box({
              key: `code-row-${y}`,
              flexDirection: 'row',
              children: runs.map((r) => text(r.text, runStyle(r, tints))),
            }),
          ),
        });
  const at = map.files.findIndex((f) => f.path === selected);
  const file = map.files[at];
  const card = cardOf(file);
  const near = neighboursOf(map, selected);
  const short = (p) => p.split('/').pop();
  const detail = Box({
    key: 'code-file',
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: 'gray',
    paddingX: 1,
    children: [
      text(selected, { bold: true, wrap: 'wrap' }),
      text(`${file.layer}${file.lane ? ` · ${file.lane} lane` : ''}`, {
        dimColor: true,
        wrap: 'wrap',
      }),
      ...(card
        ? [
            text(
              card.state === 'missing'
                ? 'No why written yet: Context Graph keeps one as a card once it is.'
                : card.text,
              card.state === 'current' ? {} : { color: 'yellow' },
            ),
            ...(card.state === 'stale'
              ? [
                  text('The file changed since its why was written.', {
                    dimColor: true,
                    wrap: 'wrap',
                  }),
                ]
              : []),
          ]
        : []),
      ...(near.imports.length
        ? [text(`imports ${near.imports.map(short).join(', ')}`, { dimColor: true, wrap: 'wrap' })]
        : []),
      ...(near.importers.length
        ? [
            text(`imported by ${near.importers.map(short).join(', ')}`, {
              dimColor: true,
              wrap: 'wrap',
            }),
          ]
        : []),
    ],
  });
  const keys = Box({
    key: 'code-keys',
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Button({
        key: 'code-next',
        label: 'Next file',
        hotkey: 'j',
        plain: true,
        onPress: () => on.onMapFile(map.files[(at + 1) % map.files.length].path),
      }),
      Button({
        key: 'code-prev',
        label: 'Previous',
        hotkey: 'k',
        plain: true,
        onPress: () => on.onMapFile(map.files[(at - 1 + map.files.length) % map.files.length].path),
      }),
      ...(map.open
        ? [
            Button({
              key: 'code-open',
              label: 'Open in Context Graph',
              hotkey: 'o',
              plain: true,
              onPress: () => on.onOpenFile(selected),
            }),
          ]
        : []),
    ],
  });
  const legend = Box({
    key: 'code-legend',
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: MAP_LEGEND.map((l) =>
      text(l.text, {
        wrap: 'wrap',
        ...(l.style === 'glow'
          ? { color: tints[file.lane] ?? 'cyan' }
          : (RUN_STYLE[l.style] ?? {})),
      }),
    ),
  });
  return [picker, drawing, legend, detail, keys];
}

/** CARD-9: how many decision cards the list shows at once, around the selected one. */
const CARDS_SHOWN = 5;

/**
 * DECIDE-3, CARD-9: the Decisions tab: how many decisions need the person, by kind; then each as a short
 * card (its kind, a one-line headline, and who or what it's for), a few at a time around the selected
 * one, with j and k to move; then the selected one in full, with its lineage (what they asked for, the
 * story and requirements, what was happening, what's settled, why it needs them) and its options, each
 * saying what it does. `on`: onDecision(i), onNeed(id, line).
 */
export function decisionsTab(cards, ui, { Box, Text, Button }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!cards.length) return [];
  const at = Math.min(ui.decision ?? 0, cards.length - 1);
  const card = cards[at];
  const row = (label, value, style = {}) =>
    Box({
      key: `decision-${label}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        text(label.padEnd(15), { dimColor: true }),
        text(value, { wrap: 'wrap', ...style }),
      ],
    });
  const kinds = new Map();
  for (const c of cards) kinds.set(c.tag, (kinds.get(c.tag) ?? 0) + 1);
  const from = Math.max(0, Math.min(at - Math.floor(CARDS_SHOWN / 2), cards.length - CARDS_SHOWN));
  const shown = cards.slice(from, from + CARDS_SHOWN);
  const list = Box({
    key: 'decision-list',
    flexDirection: 'column',
    children: [
      ...(from > 0 ? [text(`  ↑ ${from} more`, { key: 'decision-above', dimColor: true })] : []),
      ...shown.map((c, n) => {
        const i = from + n;
        return Box({
          key: `decision-item-${i}`,
          flexDirection: 'column',
          borderStyle: 'round',
          borderColor: i === at ? 'yellow' : 'gray',
          paddingX: 1,
          children: [
            // UI-7: its kind in sentence case, pressed to choose it; then the headline, cut to fit.
            Box({
              key: `decision-head-${i}`,
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Button({
                  key: `decision-pick-${i}`,
                  label: c.tag,
                  plain: true,
                  ...(i === at ? {} : { dimColor: true }),
                  onPress: () => on.onDecision(i),
                }),
                Box({
                  flexShrink: 1,
                  children: [text(c.headline, { bold: i === at, wrap: 'truncate-end' })],
                }),
              ],
            }),
            ...(c.sub ? [text(c.sub, { dimColor: true, wrap: 'truncate-end' })] : []),
          ],
        });
      }),
      ...(from + CARDS_SHOWN < cards.length
        ? [
            text(`  ↓ ${cards.length - from - CARDS_SHOWN} more`, {
              key: 'decision-below',
              dimColor: true,
            }),
          ]
        : []),
    ],
  });
  const keys = Box({
    key: 'decision-keys',
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Button({
        key: 'decision-next',
        label: 'Next',
        hotkey: 'j',
        plain: true,
        onPress: () => on.onDecision(Math.min(at + 1, cards.length - 1)),
      }),
      Button({
        key: 'decision-prev',
        label: 'Previous',
        hotkey: 'k',
        plain: true,
        onPress: () => on.onDecision(Math.max(at - 1, 0)),
      }),
      text(`${at + 1} of ${cards.length}`, { dimColor: true }),
    ],
  });
  const detail = Box({
    key: 'decision-card',
    flexDirection: 'column',
    borderStyle: 'double',
    borderColor: 'yellow',
    paddingX: 1,
    rowGap: 0,
    children: [
      text(
        card.kind === 'brief'
          ? 'An open question in your brief'
          : card.kind === 'question'
            ? 'A question from the lead'
            : card.headline,
        { bold: true, wrap: 'wrap' },
      ),
      ...(card.details ?? []).map((d) =>
        row(d.label, d.value, d.label === 'Question' ? { bold: true } : {}),
      ),
      ...(card.asked ? [row('You asked for', card.asked)] : []),
      ...(card.story
        ? [
            row(
              'Story',
              `${card.story.id} ${card.story.title}${card.story.branch ? ` · ${card.story.branch}` : ''}`,
            ),
          ]
        : []),
      ...(card.requirements.length
        ? [
            row(
              'Requirements',
              card.requirements.map((r) => `${r.id}${r.title ? ` ${r.title}` : ''}`).join('; '),
            ),
          ]
        : []),
      ...(card.doing ? [row('Happening', card.doing)] : []),
      ...(card.settled.length
        ? [
            text('Already settled', { dimColor: true }),
            ...card.settled.map((line, i) =>
              Box({
                key: `decision-settled-${i}`,
                children: [text(`  · ${line}`, { wrap: 'wrap' })],
              }),
            ),
          ]
        : []),
      ...(card.why ? [row('Why it is yours', card.why, { color: 'yellow' })] : []),
      text('Your options', { dimColor: true }),
      ...card.options.map((o) =>
        Box({
          key: `decision-option-${o.id}`,
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: `decide-${o.id}`,
              label: o.label,
              ...(o.hotkey ? { hotkey: o.hotkey } : {}),
              variant: 'primary',
              onPress: () => on.onNeed(o.act ?? o.id, o.line ?? card.line),
            }),
            ...(o.effect ? [text(o.effect, { dimColor: true, wrap: 'wrap' })] : []),
          ],
        }),
      ),
    ],
  });
  return [
    text(
      `${cards.length} decision${cards.length === 1 ? '' : 's'} need${cards.length === 1 ? 's' : ''} you. Everything else is the lead's.`,
      { bold: true, wrap: 'wrap' },
    ),
    Box({
      key: 'decision-kinds',
      children: [
        text(
          [...kinds]
            .map(([tag, n]) => `${n} ${tag}${n === 1 || tag.endsWith('brief') ? '' : 's'}`)
            .join(' · '),
          { dimColor: true, wrap: 'wrap' },
        ),
      ],
    }),
    ...(cards.length > 1 ? [list, keys] : []),
    detail,
  ];
}

const JOURNAL_GLYPH = {
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

/**
 * JOURNAL-1: the Journal tab: the build's lineage, newest last, each event with its time and a glyph,
 * your own approvals and choices marked. The latest 60 are drawn.
 */
export function journalTab(events, { Box, Text }, now = Date.now()) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!events.length) return [];
  const shown = events.slice(-60);
  const day = (at) => new Date(at).toISOString().slice(0, 10);
  const time = (at) => new Date(at).toISOString().slice(11, 16);
  const rows = [];
  let lastDay = null;
  shown.forEach((e, i) => {
    if (day(e.at) !== lastDay) {
      lastDay = day(e.at);
      rows.push(
        Box({ key: `journal-day-${i}`, children: [text(lastDay, { bold: true, dimColor: true })] }),
      );
    }
    const yours = e.who === 'person' || e.kind === 'request';
    rows.push(
      Box({
        key: `journal-${i}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          text(time(e.at), { dimColor: true }),
          text(JOURNAL_GLYPH[e.kind] ?? '·', {
            color: yours
              ? 'yellow'
              : e.kind === 'merge' || e.kind === 'milestone'
                ? 'green'
                : e.kind === 'sentBack'
                  ? 'magenta'
                  : undefined,
          }),
          text(e.text, { wrap: 'wrap', ...(yours ? { color: 'yellow' } : {}) }),
        ],
      }),
    );
  });
  return [
    text(
      `From your request to now: ${events.length} event${events.length === 1 ? '' : 's'}${events.length > shown.length ? `, the latest ${shown.length} shown` : ''}. Yours are in yellow.`,
      { dimColor: true, wrap: 'wrap' },
    ),
    Box({ key: 'journal', flexDirection: 'column', children: rows }),
  ];
}
