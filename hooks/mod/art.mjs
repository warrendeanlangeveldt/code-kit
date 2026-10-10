// Panes v2's pictures (docs/specs/11-panes.md, VIEW-2 and VIEW-3): a timeline bar per lane on a
// shared time axis, and a small pixel character per lane agent whose pose shows its state. The
// terminal draws characters as half-block cells (a Raster, repainted in place with $.ui.blit while
// the agent works); Desktop draws them, and the timelines, as SVG. Every state has a glyph too.

// --- the characters (VIEW-3) ---------------------------------------------------------------------

/** Each pose, 6 by 6 pixels: H the lane's tint, E eyes, X stalled eyes, L closed eyes, C a crown. */
const POSES = {
  working: [
    ['..HH..', '.HEEH.', '..HH..', '.HHHH.', 'H.HH.H', '.H..H.'],
    ['..HH..', '.HEEH.', '..HH..', 'HHHHHH', '..HH..', '..HH..'],
  ],
  waiting: [['..HH.H', '.HEEHH', '..HH..', '.HHH..', '..HH..', '.H..H.']],
  quiet: [['......', '..HH..', '.HLLH.', '..HH..', '.HHHH.', '.H..H.']],
  stalled: [['..HH..', '.HXXH.', '..HH..', '.HHHH.', '..HH..', '.H..H.']],
  done: [['H.HH.H', 'HHEEHH', '..HH..', '..HH..', '..HH..', '.H..H.']],
  idle: [['......', '..HH..', '.HLLH.', '..HH..', '.HHHH.', '.H..H.']],
};
/** What a pose reads as without its picture, and in words. */
export const POSE_GLYPH = {
  working: '⚙',
  waiting: '?',
  quiet: '…',
  stalled: '✗',
  done: '✓',
  idle: '·',
};

/** Each lane's tint, fixed by its place in the config so the person learns them; the lead's is gold. */
const TINTS = [0x4aa3ff, 0x5cc85c, 0xd070e0, 0x40c8c8, 0xff9a40, 0xff6070, 0xa0a0ff];
export function tintOf(lane, lanes) {
  if (lane === 'lead') return 0xd8a840;
  const i = lanes.filter((l) => l !== 'lead').indexOf(lane);
  return TINTS[(i < 0 ? 0 : i) % TINTS.length];
}

const dim = (rgb) =>
  (((rgb >> 16) & 0xff) >> 1) * 0x10000 + (((rgb >> 8) & 0xff) >> 1) * 0x100 + ((rgb & 0xff) >> 1);

/** The pose's frame as a grid of colours (null for none), the lead crowned. */
export function sprite(pose, frame, tint, { lead = false } = {}) {
  const frames = POSES[pose] ?? POSES.idle;
  const rows = frames[frame % frames.length].map((r) => [...r]);
  if (lead) rows[0] = [...'C.CC.C'];
  const body = pose === 'quiet' || pose === 'idle' ? dim(tint) : tint;
  const colour = { H: body, E: 0x202020, X: 0xff3030, L: 0x707070, C: 0xffcc00 };
  return rows.map((r) => r.map((c) => colour[c] ?? null));
}

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

/** A sprite as SVG for Desktop, the working pose's frames alternating (SMIL), 4 px a pixel. */
export function spriteSvg(pose, tint, { lead = false } = {}) {
  const frames = (POSES[pose] ?? POSES.idle).map((_, f) => sprite(pose, f, tint, { lead }));
  const rects = (grid) =>
    grid
      .flatMap((row, y) =>
        row.map((c, x) =>
          c === null
            ? ''
            : `<rect x="${x * 4}" y="${y * 4}" width="4" height="4" fill="${hex(c)}"/>`,
        ),
      )
      .join('');
  const groups = frames.map((g, f) =>
    frames.length > 1
      ? `<g visibility="${f ? 'hidden' : 'visible'}"><animate attributeName="visibility" values="${f ? 'hidden;visible' : 'visible;hidden'}" dur="0.8s" repeatCount="indefinite" calcMode="discrete"/>${rects(g)}</g>`
      : `<g>${rects(g)}</g>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" shape-rendering="crispEdges">${groups.join('')}</svg>`;
}

/**
 * A lane's pose (VIEW-3): stalled when flagged or quiet past the restart time, waiting while a call
 * of its is held or its request is open, working while its agent is at work, quiet when it has
 * gone quiet, done once its branch is finished, idle otherwise.
 */
export function poseOf(
  lane,
  { live = null, waiting = false, flagged = false, shown = lane.state } = {},
) {
  if (flagged || live?.level === 'stalled') return 'stalled';
  if (waiting) return 'waiting';
  if (live?.level === 'quiet') return 'quiet';
  if (lane.active) return 'working';
  if (['in review', 'queued'].includes(shown)) return 'done';
  return 'idle';
}

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
