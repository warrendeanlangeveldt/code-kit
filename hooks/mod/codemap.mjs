// The code map (docs/specs/14-mission-and-maps.md, MAP-1 to MAP-4), the pure parts: what an agent's
// tool call touches, which files glow and for whom, the map laid out by layer, and the drawing of it:
// box-drawing text for the terminal, an SVG elsewhere. Its data is `code-kit map <story> --json`.

/** Calls that read a file, and calls that change one. */
const READS = new Set(['Read', 'NotebookRead']);
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * MAP-2: the repository path a tool call reads or edits, and which: { path, verb } or null. Paths in
 * an agent's worktree (`.claude/worktrees/<id>/…`) are the same repository path.
 */
export function touchOf(call, cwd = '') {
  const verb = READS.has(call?.tool) ? 'read' : EDITS.has(call?.tool) ? 'edit' : null;
  const raw = call?.file_path ?? call?.notebook_path ?? call?.path;
  if (!verb || typeof raw !== 'string') return null;
  let path = raw;
  const tree = path.match(/\/\.claude\/worktrees\/[^/]+\/(.+)$/);
  if (tree) path = tree[1];
  else if (cwd && path.startsWith(`${cwd}/`)) path = path.slice(cwd.length + 1);
  return path.startsWith('/') ? null : { path, verb };
}

/** How long a touched file glows after the call. */
export const GLOW_MS = 20000;

/** MAP-2: the files glowing now: { [path]: { lane, verb } }, the latest touch of each winning. */
export function glowOf(touches, now, windowMs = GLOW_MS) {
  const out = {};
  for (const t of [...touches].sort((a, b) => a.at - b.at))
    if (now - t.at <= windowMs) out[t.path] = { lane: t.lane, verb: t.verb };
  return out;
}

/** A file's card as another tool knows it: current, stale or missing, or null when none says. */
export function cardOf(file) {
  for (const facts of Object.values(file.adapters ?? {})) if (facts?.card) return facts.card;
  return null;
}

/** The name a node shows: the file's name, and its folder when another file shares the name. */
const nameOf = (path, all) => {
  const base = path.split('/').pop();
  const twins = all.filter((p) => p.split('/').pop() === base);
  if (twins.length < 2) return base;
  const parts = path.split('/');
  return parts.slice(-2).join('/');
};

const NODE_H = 4;
const ROW_GAP = 1;
const COL_GAP = 6;
const GUTTER = 3;

/**
 * MAP-1: the map laid out in character cells: a column per layer (in the map's order), its files
 * stacked; { columns: [{ layer, x, width }], nodes: { [path]: { x, y, w, h, name, layer } }, width,
 * height }. `width` is the room there is; columns share it, each between 16 and 30 cells.
 */
export function layout(map, width = 100) {
  const layers = map.layers.filter((l) => map.files.some((f) => f.layer === l));
  const n = Math.max(1, layers.length);
  const colW = Math.max(16, Math.min(30, Math.floor((width - COL_GAP * (n - 1)) / n)));
  const all = map.files.map((f) => f.path);
  // A gutter of GUTTER cells left of each column carries the imports between files of one layer.
  const columns = layers.map((layer, i) => ({
    layer,
    x: GUTTER + i * (colW + COL_GAP),
    width: colW,
  }));
  const nodes = {};
  let height = 2;
  for (const c of columns) {
    const files = map.files.filter((f) => f.layer === c.layer);
    files.forEach((f, j) => {
      const y = 2 + j * (NODE_H + ROW_GAP);
      nodes[f.path] = { x: c.x, y, w: colW, h: NODE_H, name: nameOf(f.path, all), layer: c.layer };
      height = Math.max(height, y + NODE_H);
    });
  }
  return { columns, nodes, width: columns.length ? columns.at(-1).x + colW : 0, height };
}

/** The words under a node's name: what's happening to it, or its card. */
function statusOf(path, file, glow) {
  const g = glow[path];
  if (g)
    return {
      text: `${g.lane} ${g.verb === 'edit' ? 'editing' : 'reading'}`,
      style: g.verb === 'edit' ? 'editing' : 'reading',
      lane: g.lane,
    };
  const card = cardOf(file);
  if (!card) return { text: '', style: 'dim' };
  // A card is the file's why: what it's for, what it relies on, what it must keep true.
  if (card.state === 'current') return { text: '✓ why written', style: 'ok', card: 'current' };
  if (card.state === 'stale') return { text: 'why out of date', style: 'warn', card: 'stale' };
  return { text: 'no why yet', style: 'warn', card: 'missing' };
}

const fit = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/**
 * MAP-1 to MAP-3 in the terminal: the map as rows of styled runs, [[{ text, style, lane? }]]. Styles:
 * dim (layer names, edges), node, selected, reading and editing (a glowing box's border, with the
 * lane), fill-read and fill-edit (its inside, filled with the lane's colour), ok, warn. Edges are
 * drawn between neighbouring columns; the others are named in the selected file's detail.
 */
export function mapRows(map, { glow = {}, selected = null, width = 100 } = {}) {
  const L = layout(map, width);
  if (!L.columns.length) return [];
  const W = L.width;
  const grid = Array.from({ length: L.height }, () =>
    Array.from({ length: W }, () => ({ ch: ' ', style: 'dim' })),
  );
  const put = (x, y, ch, style, lane) => {
    if (y < 0 || y >= L.height || x < 0 || x >= W) return;
    grid[y][x] = { ch, style, ...(lane ? { lane } : {}) };
  };
  for (const c of L.columns) {
    const label = fit(c.layer, c.width);
    [...label].forEach((ch, i) => put(c.x + i, 0, ch, 'dim'));
  }
  // Edges first, so the boxes draw over their ends: from the importer's side to the imported's.
  const byPath = Object.fromEntries(map.files.map((f) => [f.path, f]));
  const colOf = (p) => L.columns.findIndex((c) => c.layer === L.nodes[p].layer);
  const joints = new Map();
  const line = (x, y, dir) => {
    const key = `${x},${y}`;
    const had = joints.get(key) ?? new Set();
    for (const d of dir) had.add(d);
    joints.set(key, had);
  };
  for (const f of map.files)
    for (const target of f.imports) {
      if (!L.nodes[target]) continue;
      const a = L.nodes[f.path];
      const b = L.nodes[target];
      const ca = colOf(f.path);
      const cb = colOf(target);
      // MAP-1: within one layer, a bracket in the column's gutter joins the two files.
      if (ca === cb) {
        const x = a.x - 2;
        const ya = a.y + 1;
        const yb = b.y + 1;
        line(a.x - 1, ya, 'we');
        line(x, ya, yb > ya ? 'es' : 'ne');
        for (let y = Math.min(ya, yb) + 1; y < Math.max(ya, yb); y++) line(x, y, 'ns');
        line(x, yb, yb > ya ? 'ne' : 'es');
        line(b.x - 1, yb, 'we');
        continue;
      }
      if (Math.abs(ca - cb) !== 1) continue;
      const left = ca < cb ? a : b;
      const right = ca < cb ? b : a;
      const ya = left.y + 1;
      const yb = right.y + 1;
      const x0 = left.x + left.w;
      const x1 = right.x - 1;
      const mid = x0 + Math.floor((x1 - x0) / 2);
      for (let x = x0; x <= mid; x++)
        line(x, ya, x === mid ? (yb === ya ? 'we' : yb > ya ? 'ws' : 'wn') : 'we');
      for (let y = Math.min(ya, yb) + 1; y < Math.max(ya, yb); y++) line(mid, y, 'ns');
      if (yb !== ya) line(mid, yb, yb > ya ? 'ne' : 'se');
      for (let x = mid + 1; x <= x1; x++) line(x, yb, 'we');
    }
  const JOINT = {
    we: '─',
    ns: '│',
    ne: '└',
    es: '┌',
    sw: '┐',
    nw: '┘',
    nes: '├',
    nsw: '┤',
    esw: '┬',
    new: '┴',
    nesw: '┼',
  };
  for (const [key, dirs] of joints) {
    const [x, y] = key.split(',').map(Number);
    const k = ['n', 'e', 's', 'w'].filter((d) => dirs.has(d)).join('');
    put(x, y, JOINT[k] ?? '─', 'dim');
  }
  for (const [path, node] of Object.entries(L.nodes)) {
    const file = byPath[path];
    const status = statusOf(path, file, glow);
    const box = path === selected ? 'selected' : glow[path] ? status.style : 'node';
    const lane = glow[path]?.lane;
    const { x, y, w } = node;
    const edge =
      glow[path]?.verb === 'edit' ? ['┏', '┓', '┗', '┛', '━', '┃'] : ['╭', '╮', '╰', '╯', '─', '│'];
    put(x, y, edge[0], box, lane);
    put(x + w - 1, y, edge[1], box, lane);
    put(x, y + 3, edge[2], box, lane);
    put(x + w - 1, y + 3, edge[3], box, lane);
    for (let i = 1; i < w - 1; i++) {
      put(x + i, y, edge[4], box, lane);
      put(x + i, y + 3, edge[4], box, lane);
    }
    // MAP-2: a glowing file fills with its lane's colour, its name and status written over it.
    const fill = lane ? `fill-${glow[path].verb}` : null;
    for (const row of [1, 2]) {
      put(x, y + row, edge[5], box, lane);
      put(x + w - 1, y + row, edge[5], box, lane);
      for (let i = 1; i < w - 1; i++) put(x + i, y + row, ' ', fill ?? 'node', lane);
    }
    [...fit(node.name, w - 4)].forEach((ch, i) =>
      put(x + 2 + i, y + 1, ch, fill ?? (path === selected ? 'selected' : 'node'), lane),
    );
    [...fit(status.text, w - 4)].forEach((ch, i) =>
      put(x + 2 + i, y + 2, ch, fill ?? status.style, status.lane ?? lane),
    );
  }
  // Runs: neighbouring cells of one style (and lane) as one piece of text.
  return grid.map((row) => {
    const runs = [];
    for (const cell of row) {
      const last = runs.at(-1);
      if (last && last.style === cell.style && last.lane === cell.lane) last.text += cell.ch;
      else
        runs.push({ text: cell.ch, style: cell.style, ...(cell.lane ? { lane: cell.lane } : {}) });
    }
    return runs;
  });
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/**
 * MAP-1 to MAP-3 on the remote surfaces: the map as an SVG, every import drawn, glowing files pulsing
 * in their lane's colour. `tints` gives each lane's colour; `selected` is outlined.
 */
export function mapSvg(map, { glow = {}, selected = null, tints = {}, width = 100 } = {}) {
  const L = layout(map, width);
  const CW = 7.2;
  const RH = 16;
  const W = Math.max(200, Math.round(L.width * CW) + 20);
  const H = Math.round(L.height * RH) + 20;
  const box = (p) => {
    const n = L.nodes[p];
    return { x: 10 + n.x * CW, y: 10 + n.y * RH, w: n.w * CW, h: 3 * RH };
  };
  const parts = [];
  for (const c of L.columns)
    parts.push(
      `<text x="${10 + c.x * CW}" y="${10 + RH * 0.8}" fill="#7f8c8d" font-size="11">${esc(c.layer)}</text>`,
    );
  for (const f of map.files)
    for (const target of f.imports) {
      if (!L.nodes[target]) continue;
      const a = box(f.path);
      const b = box(target);
      const fromRight = a.x > b.x;
      const x1 = fromRight ? a.x : a.x + a.w;
      const x2 = fromRight ? b.x + b.w : b.x;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      const live = glow[f.path] || glow[target];
      const color = live ? (tints[(glow[f.path] ?? glow[target]).lane] ?? '#5fb3b3') : '#3b4c50';
      parts.push(
        `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${live ? 1.6 : 1}"/>`,
      );
    }
  const byPath = Object.fromEntries(map.files.map((f) => [f.path, f]));
  for (const [path, node] of Object.entries(L.nodes)) {
    const b = box(path);
    const status = statusOf(path, byPath[path], glow);
    const g = glow[path];
    const tint = g ? (tints[g.lane] ?? '#5fb3b3') : null;
    if (tint)
      parts.push(
        `<rect x="${b.x - 4}" y="${b.y - 4}" width="${b.w + 8}" height="${b.h + 8}" rx="6" fill="${tint}" opacity="${g.verb === 'edit' ? 0.4 : 0.22}"><animate attributeName="opacity" values="${g.verb === 'edit' ? '0.4;0.15;0.4' : '0.22;0.08;0.22'}" dur="1.2s" repeatCount="indefinite"/></rect>`,
      );
    const stroke =
      path === selected
        ? '#8fb8ff'
        : status.style === 'ok'
          ? '#78c98a'
          : status.style === 'warn'
            ? '#e3b450'
            : '#3b4c50';
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="${path === selected ? '#1d3a52' : '#0f1618'}" stroke="${stroke}"${status.card === 'missing' ? ' stroke-dasharray="4 3"' : ''}/>`,
    );
    parts.push(
      `<text x="${b.x + 8}" y="${b.y + 18}" fill="#cfd9da" font-size="12">${esc(fit(node.name, node.w - 2))}</text>`,
    );
    const color =
      tint ?? (status.style === 'ok' ? '#78c98a' : status.style === 'warn' ? '#e3b450' : '#6e8286');
    parts.push(
      `<text x="${b.x + 8}" y="${b.y + 36}" fill="${color}" font-size="11">${esc(status.text)}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, monospace">${parts.join('')}</svg>`;
}

/** MAP-3: the selected file's neighbours in the story: what it imports and what imports it. */
export function neighboursOf(map, path) {
  const file = map.files.find((f) => f.path === path);
  return {
    imports: file?.imports ?? [],
    importers: map.files.filter((f) => f.imports.includes(path)).map((f) => f.path),
  };
}

/** The story the code map opens on: the one asked for, else the selected lane's, else one at work. */
export function mapStoryOf(state, selectedLane, asked = null) {
  if (asked) return asked;
  const lane = state?.lanes?.find((l) => l.name === selectedLane);
  if (lane?.story) return lane.story.id;
  const busy = state?.lanes?.find((l) => l.story && ['building', 'in review'].includes(l.state));
  return busy?.story.id ?? state?.stories?.find((s) => s.state !== 'done')?.id ?? null;
}

/** MAP-2, MAP-3: the map's legend: what the colours and words mean, a card being the file's why. */
export const MAP_LEGEND = [
  { text: '■ a lane at work', style: 'glow' },
  { text: '✓ why written', style: 'ok' },
  { text: 'why out of date', style: 'warn' },
  { text: 'no why yet', style: 'warn' },
  { text: "a file's why is its card, kept in git by Context Graph", style: 'dim' },
];
