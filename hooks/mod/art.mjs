// Panes v2's pictures (docs/specs/11-panes.md, VIEW-2 and VIEW-3): a timeline bar per lane on a
// shared time axis, and a small pixel character per lane agent whose pose shows its state. The
// terminal draws characters as half-block cells (a Raster, repainted in place with $.ui.blit while
// the agent works); Desktop draws them, and the timelines, as SVG. Every state has a glyph too.

// --- the characters (VIEW-3) ---------------------------------------------------------------------

const DEFAULT = 0x01000000;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/**
 * A sprite as a Raster's cells (VIEW-3): two pixels a cell, the upper as the half block's colour and
 * the lower as its background. 6 columns by 3 rows.
 */
export function rasterCells(grid) {
  const words = [];
  for (let y = 0; y < grid.length; y += 2)
    for (let x = 0; x < grid[y].length; x++) {
      const top = grid[y][x];
      const bottom = grid[y + 1]?.[x] ?? null;
      if (top === null && bottom === null) words.push(0x20, DEFAULT, DEFAULT);
      else if (top === null) words.push(0x2584, bottom, DEFAULT);
      else words.push(0x2580, top, bottom ?? DEFAULT);
    }
  const bytes = [];
  for (const w of words)
    bytes.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff);
  return base64(bytes);
}

const hex = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`;

// --- the timelines (VIEW-2) ----------------------------------------------------------------------

/** Each cell kind's glyph and colour: the glyph alone reads in a terminal without colour. */
export const BAR = {
  building: { glyph: '█', color: 'blue' },
  review: { glyph: '▒', color: 'yellow' },
  sentBack: { glyph: '↩', color: 'magenta' },
  approval: { glyph: '◆', color: 'cyan' },
  merged: { glyph: '✓', color: 'green' },
  none: { glyph: ' ', color: undefined },
};

/** Where the shared axis starts: the earliest start among the lanes' stories, at most a day back. */
export function axisStart(times, now) {
  const starts = times.map((t) => t.started).filter((t) => t !== null && t !== undefined);
  return starts.length ? Math.max(Math.min(...starts), now - 24 * 3600000) : now - 3600000;
}

/**
 * A story's bar as `width` cells from `start` to `now` (VIEW-2): building from its start, in review
 * from its last commit once finished, ending at its merge or now; its send-backs, approvals and
 * merge marked where they fell. [kind], a kind of BAR's.
 */
export function barCells(t, { start, now, width }) {
  const span = Math.max(1, now - start) / width;
  const finished =
    ['review', 'in review', 'queued', 'done'].includes(t.state) && t.lastCommit !== null;
  const end = t.merged ?? now;
  const cells = [];
  for (let i = 0; i < width; i++) {
    const mid = start + (i + 0.5) * span;
    if (t.started === null || mid < t.started || mid > end + span / 2) cells.push('none');
    else if (finished && mid >= t.lastCommit) cells.push('review');
    else cells.push('building');
  }
  const mark = (at, kind) => {
    if (at === null || at === undefined || at < start || at > now) return;
    cells[Math.min(width - 1, Math.floor((at - start) / span))] = kind;
  };
  for (const at of t.sentBack ?? []) mark(at, 'sentBack');
  for (const a of t.approvals ?? []) mark(a.at, 'approval');
  mark(t.merged, 'merged');
  return cells;
}

/** Runs of the same kind, to draw as one Text each: [{ kind, n }]. */
export function runs(cells) {
  const out = [];
  for (const kind of cells) {
    if (out.at(-1)?.kind === kind) out.at(-1).n += 1;
    else out.push({ kind, n: 1 });
  }
  return out;
}

/** The bars as SVG for Desktop: a row per lane, the same kinds and colours. */
export function timelineSvg(rows, { width = 480, rowHeight = 10 } = {}) {
  const FILL = {
    building: '#4aa3ff',
    review: '#e0c040',
    sentBack: '#d070e0',
    approval: '#40c8c8',
    merged: '#5cc85c',
  };
  const cell = width / Math.max(1, rows[0]?.cells.length ?? 1);
  const rects = rows
    .flatMap((r, y) =>
      r.cells.map((k, x) =>
        k === 'none'
          ? ''
          : `<rect x="${(x * cell).toFixed(1)}" y="${y * (rowHeight + 4)}" width="${cell.toFixed(1)}" height="${rowHeight}" fill="${FILL[k]}"/>`,
      ),
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rows.length * (rowHeight + 4)}" shape-rendering="crispEdges">${rects}</svg>`;
}
