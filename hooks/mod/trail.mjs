// The trail (docs/specs/14-mission-and-maps.md, TRAIL-1), drawn: each requirement of a spec flowing to
// the stories that deliver it, the code they changed and the tests that name it, with a gap where any
// link is missing. Box-drawing text in the terminal, an SVG elsewhere. Its data is `code-kit trail`.

/** A story's state as the trail colours it: done, moving (in progress or review), or waiting. */
export const storyTone = (state) =>
  state === 'done'
    ? 'done'
    : ['in progress', 'review', 'sent back'].includes(state)
      ? 'moving'
      : 'waiting';

const GLYPH = { done: '✓', moving: '●', waiting: '■' };

const fit = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s.padEnd(n));
const short = (p) => p.split('/').pop();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * TRAIL-1 in the terminal: one row per requirement, as runs [{ text, style }]. Consecutive
 * requirements delivered by the same stories meet at one story node (┬ … ┘). Styles: req, selected,
 * dim, done, moving, waiting, gap (red), test (green).
 */
export function trailRows(rows, { selected = null, width = 100 } = {}) {
  const titleW = Math.max(14, Math.min(34, width - 70));
  const key = (r) => r.stories.map((s) => s.id).join(' ');
  return rows.map((r, i) => {
    const runs = [];
    const add = (text, style) => runs.push({ text, style });
    add(r.id.padEnd(9), r.id === selected ? 'selected' : 'req');
    add(fit(r.title, titleW), r.id === selected ? 'selected' : 'dim');
    const same = i > 0 && key(rows[i - 1]) === key(r) && r.stories.length > 0;
    const next = i < rows.length - 1 && key(rows[i + 1]) === key(r) && r.stories.length > 0;
    if (!r.stories.length) {
      add(' ╌╌╌ ', 'gap');
      add(fit('no story', 16), 'gap');
    } else if (same) {
      add(next ? ' ───┤' : ' ───┘', 'dim');
      add(''.padEnd(16), 'dim');
    } else {
      add(next ? ' ───┬ ' : ' ──── ', 'dim');
      const tone = r.stories.every((s) => s.state === 'done')
        ? 'done'
        : r.stories.some((s) => storyTone(s.state) === 'moving')
          ? 'moving'
          : 'waiting';
      add(fit(`${GLYPH[tone]} ${r.stories.map((s) => s.id).join(' ')}`, 15), tone);
    }
    if (r.files.length) {
      add(' ─── ', 'dim');
      add(fit(plural(r.files.length, 'file', 'files'), 9), 'dim');
    } else {
      add(' ╌╌╌ ', 'gap');
      add(fit('no code', 9), 'gap');
    }
    if (r.tests.length) {
      add(' ─── ', 'dim');
      add(`✓ ${short(r.tests[0])}${r.tests.length > 1 ? ` +${r.tests.length - 1}` : ''}`, 'test');
    } else {
      add(' ╌╌╌ ', 'gap');
      add('no test names it', 'gap');
    }
    return runs;
  });
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const COLOR = {
  done: '#78c98a',
  moving: '#8fb8ff',
  waiting: '#e06a6a',
  dim: '#6e8286',
  fg: '#cfd9da',
  line: '#3b4c50',
  gap: '#e06a6a',
  test: '#78c98a',
};

/**
 * TRAIL-1 on the remote surfaces: the flow as an SVG: requirements on the left, curves meeting at each
 * story, then the files and the test that names it; a gap drawn dashed in red.
 */
export function trailSvg(rows, { selected = null } = {}) {
  const rowH = 30;
  const W = 820;
  const H = rows.length * rowH + 44;
  const X = { req: 12, story: 300, files: 430, test: 640 };
  const parts = [];
  for (const [label, x] of [
    ['requirement', X.req],
    ['story', X.story],
    ['code', X.files],
    ['test that names it', X.test],
  ])
    parts.push(`<text x="${x}" y="16" fill="${COLOR.dim}" font-size="11">${esc(label)}</text>`);
  const storyY = {};
  rows.forEach((r, i) => {
    const y = 38 + i * rowH;
    const key = r.stories.map((s) => s.id).join(' ');
    if (key && storyY[key] === undefined) storyY[key] = y;
    const sy = key ? storyY[key] : y;
    const sel = r.id === selected;
    parts.push(
      `<text x="${X.req}" y="${y + 4}" fill="${sel ? '#8fb8ff' : COLOR.fg}" font-size="12"${sel ? ' font-weight="700"' : ''}>${esc(r.id)}</text>`,
    );
    parts.push(
      `<text x="${X.req + 70}" y="${y + 4}" fill="${COLOR.dim}" font-size="11">${esc(r.title.length > 26 ? `${r.title.slice(0, 25)}…` : r.title)}</text>`,
    );
    if (key) {
      parts.push(
        `<path d="M${X.story - 50},${y} C${X.story - 25},${y} ${X.story - 25},${sy} ${X.story - 6},${sy}" fill="none" stroke="${COLOR.line}"/>`,
      );
      if (sy === y) {
        const tone = r.stories.every((s) => s.state === 'done')
          ? 'done'
          : r.stories.some((s) => storyTone(s.state) === 'moving')
            ? 'moving'
            : 'waiting';
        parts.push(`<circle cx="${X.story + 3}" cy="${y}" r="4" fill="${COLOR[tone]}"/>`);
        parts.push(
          `<text x="${X.story + 13}" y="${y + 4}" fill="${COLOR.fg}" font-size="12">${esc(key)}</text>`,
        );
      }
      parts.push(
        `<path d="M${X.story + 80},${sy} C${X.files - 30},${sy} ${X.files - 30},${y} ${X.files - 6},${y}" fill="none" stroke="${r.files.length ? COLOR.line : COLOR.gap}"${r.files.length ? '' : ' stroke-dasharray="3 3"'}/>`,
      );
    } else {
      parts.push(
        `<line x1="${X.story - 50}" y1="${y}" x2="${X.story - 6}" y2="${y}" stroke="${COLOR.gap}" stroke-dasharray="3 3"/>`,
      );
      parts.push(
        `<text x="${X.story}" y="${y + 4}" fill="${COLOR.gap}" font-size="11">no story</text>`,
      );
    }
    const files = r.files.map(short).join(', ');
    parts.push(
      `<text x="${X.files}" y="${y + 4}" fill="${r.files.length ? COLOR.dim : COLOR.gap}" font-size="11">${esc(r.files.length ? (files.length > 30 ? `${files.slice(0, 29)}…` : files) : 'no code yet')}</text>`,
    );
    parts.push(
      `<line x1="${X.test - 18}" y1="${y}" x2="${X.test - 6}" y2="${y}" stroke="${r.tests.length ? COLOR.test : COLOR.gap}"${r.tests.length ? '' : ' stroke-dasharray="3 3"'}/>`,
    );
    parts.push(
      `<text x="${X.test}" y="${y + 4}" fill="${r.tests.length ? COLOR.test : COLOR.gap}" font-size="11">${esc(r.tests.length ? `✓ ${short(r.tests[0])}${r.tests.length > 1 ? ` +${r.tests.length - 1}` : ''}` : 'no test names it yet')}</text>`,
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, monospace">${parts.join('')}</svg>`;
}
