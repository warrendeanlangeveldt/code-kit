// The lane agents' characters, redrawn (docs/specs/27-the-mod-redesigned.md, UI-11): 8 by 8
// pixels, each lane its own shape as well as its tint so lanes read apart without colour, the lead's
// crowned. A pose is the agent's state or the kind of work it's doing; a move is a one-off at an
// event. Every frame is composed from layers (a head by shape, a face, a body, a prop), so each
// shape gets every pose. Pure: the mod draws the grids as half-block cells or SVG.

/** Pixels a side: four terminal rows of half-blocks, eight columns. */
export const SIZE = 8;

/**
 * Each head, rows 0 to 3, the face in columns 1 to 5 (row 0 what's on top of it): H the tint, D its
 * shade, K gold.
 */
const HEADS = {
  crown: ['.K.K.K..', '.KKKKK..', '.HHHHH..', '.HHHHH..'],
  antenna: ['...K....', '.HHHHH..', '.HHHHH..', '.HHHHH..'],
  cat: ['.D...D..', '.DHHHD..', '.HHHHH..', '.HHHHH..'],
  cap: ['.DDDD...', '.DDDDDD.', '.HHHHH..', '.HHHHH..'],
  bunny: ['..D.D...', '..D.D...', '.HHHHH..', '.HHHHH..'],
  bolts: ['........', '.HHHHH..', 'DHHHHHD.', '.DDDDD..'],
  wizard: ['...D....', 'DDDDDDD.', '.HHHHH..', '.HHHHH..'],
};
/** The lanes' shapes, tints and marks: six shapes first, then a mark on each, so lanes differ without colour. */
const SHAPES = ['antenna', 'cat', 'cap', 'bunny', 'bolts', 'wizard'];
const MARKS = [null, 'glasses', 'scarf', 'belt'];
const TINTS = [0x4aa3ff, 0x5cc85c, 0xd070e0, 0x40c8c8, 0xff9a40, 0xff6070];
const LEAD_TINT = 0xd8a840;

/** A name's own number (FNV-1a), so a lane's look comes from its name, not its place. */
function hashOf(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Every lane's character (UI-11), for whatever lanes the project's config has: each look (a shape,
 * then a mark) chosen from the lane's name and kept apart from the lanes before it in the config, so
 * a lane added later never changes another's. Six lanes get six shapes; more get marks as well, up to
 * 24 apart; past that, looks repeat and the tint still tells them apart.
 */
export function charactersOf(lanes) {
  const out = { lead: { shape: 'crown', mark: null, tint: LEAD_TINT } };
  const looks = new Set();
  const tints = new Set();
  const all = SHAPES.length * MARKS.length;
  for (const lane of [...new Set(lanes)].filter((l) => l !== 'lead')) {
    const h = hashOf(lane);
    // Probe a mark at a time, every shape before the next mark, starting at the name's own shape.
    let look = null;
    for (let i = 0; i < all && look === null; i++) {
      const mark = Math.floor(i / SHAPES.length);
      const shape = (h + i) % SHAPES.length;
      const id = mark * SHAPES.length + shape;
      if (!looks.has(id)) look = id;
    }
    if (look === null) look = h % all;
    looks.add(look);
    if (tints.size >= TINTS.length) tints.clear();
    let tint = (h >>> 8) % TINTS.length;
    for (let i = 0; i < TINTS.length && tints.has(tint); i++) tint = (tint + 1) % TINTS.length;
    tints.add(tint);
    out[lane] = {
      shape: SHAPES[look % SHAPES.length],
      mark: MARKS[Math.floor(look / SHAPES.length)],
      tint: TINTS[tint],
    };
  }
  return out;
}

/** One lane's character, among the project's lanes. */
export function characterOf(lane, lanes) {
  return charactersOf(lanes.includes(lane) ? lanes : [...lanes, lane])[lane];
}

/** The body, rows 4 to 7: a neck, arms out in columns 1 and 5, legs. */
const BODY = ['..DDD...', '.HHHHH..', '..HHH...', '..H.H...'];
const BODY_TOP = 4;

/** Each pose and move: its frames, how long each shows, and whether it loops. */
export const POSES = {
  writing: { frames: 4, ms: 220, loop: true, glyph: '✎', words: 'writing' },
  running: { frames: 4, ms: 180, loop: true, glyph: '⚙', words: 'running' },
  reading: { frames: 4, ms: 320, loop: true, glyph: '◉', words: 'reading' },
  thinking: { frames: 4, ms: 360, loop: true, glyph: '…', words: 'thinking' },
  waiting: { frames: 1, ms: 0, loop: false, glyph: '?', words: 'waiting on you' },
  quiet: { frames: 1, ms: 0, loop: false, glyph: '…', words: 'quiet' },
  stalled: { frames: 1, ms: 0, loop: false, glyph: '✗', words: 'stalled' },
  resting: { frames: 1, ms: 0, loop: false, glyph: '·', words: 'resting' },
  arriving: { frames: 4, ms: 250, loop: false, glyph: '↓', words: 'arriving' },
  'handed-back': { frames: 4, ms: 250, loop: false, glyph: '↑', words: 'handed back' },
  'sent-back': { frames: 4, ms: 250, loop: false, glyph: '↺', words: 'sent back' },
  merged: { frames: 4, ms: 250, loop: false, glyph: '✓', words: 'merged' },
};
export const WORK = ['writing', 'running', 'reading', 'thinking'];
export const STILL = ['waiting', 'quiet', 'stalled', 'resting'];
export const MOVES = ['arriving', 'handed-back', 'sent-back', 'merged'];

/** The kind of work an agent's current tool is (UI-11): no tool is a model turn, thinking. */
export function workOf(tool) {
  if (!tool) return 'thinking';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'writing';
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/.test(tool)) return 'reading';
  return 'running';
}

const blank = () => Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
function paint(grid, rows, { top = 0, dx = 0, dy = 0 } = {}) {
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const y = top + r + dy;
      const x = c + dx;
      if (ch !== '.' && y >= 0 && y < SIZE && x >= 0 && x < SIZE) grid[y][x] = ch;
    }),
  );
}
const put = (grid, points, ch) => {
  for (const [y, x] of points) if (y >= 0 && y < SIZE && x >= 0 && x < SIZE) grid[y][x] = ch;
};
const clear = (grid, points) => put(grid, points, '.');

/** The eyes and mouth: where the eyes look, and the face's mood. Eyes sit in columns 2 and 4. */
function face(grid, kind, dx = 0, dy = 0) {
  const at = (points) => points.map(([y, x]) => [y + dy, x + dx]);
  const eyes = {
    open: [
      [2, 2],
      [2, 4],
    ],
    down: [
      [3, 2],
      [3, 4],
    ],
    up: [
      [2, 1],
      [2, 3],
    ],
    scan: [
      [3, 3],
      [3, 5],
    ],
  };
  if (kind === 'closed') return put(grid, at(eyes.down), 'L');
  if (kind === 'crossed') return put(grid, at(eyes.open), 'X');
  put(grid, at(eyes[kind] ?? eyes.open), 'E');
  if (kind === 'happy') put(grid, at([[3, 3]]), 'E');
  if (kind === 'oops') {
    put(grid, at([[3, 3]]), 'E');
    put(grid, at([[1, 6]]), 'B');
  }
}

/** A lane's mark, worn in every pose: glasses round the eyes, a scarf at the neck, a belt. */
function wear(grid, mark, mood, dx = 0, dy = 0) {
  const at = (points) => points.map(([y, x]) => [y + dy, x + dx]);
  const eyes = mood === 'down' || mood === 'scan' || mood === 'closed' ? 3 : 2;
  if (mark === 'glasses') put(grid, at([1, 3, 5].map((x) => [eyes, x])), 'P');
  if (mark === 'scarf') put(grid, at([1, 2, 3, 4, 5].map((x) => [4, x])), 'S');
  if (mark === 'belt') put(grid, at([2, 3, 4].map((x) => [6, x])), 'P');
}

/** A frame as a grid of letters, before colour. Props sit in columns 6 and 7. */
function compose({ shape, mark = null }, pose, frame) {
  const g = blank();
  const head = HEADS[shape] ?? HEADS.antenna;
  const whole = (dx, dy, mood, body = BODY) => {
    paint(g, head, { dx, dy });
    paint(g, body, { top: BODY_TOP, dx, dy });
    face(g, mood, dx, dy);
    wear(g, mark, mood, dx, dy);
  };
  const f = frame % (POSES[pose]?.frames ?? 1);
  switch (pose) {
    case 'writing': {
      // At a sheet of paper on the right, the pencil moving and a line filling.
      whole(0, 0, 'down');
      paint(g, ['WW', 'WW'], { top: 6, dx: 6 });
      put(g, [[5, [6, 7, 7, 6][f]]], 'K');
      put(
        g,
        [
          [6, 6],
          [6, 7],
        ].slice(0, [0, 0, 1, 2][f]),
        'E',
      );
      break;
    }
    case 'running': {
      // Turning a crank on the right, its bar spinning a quarter a frame, bobbing as it works.
      whole(0, f % 2, 'open');
      const spin = [
        ['.P.', '.K.', '.P.'],
        ['..P', '.K.', 'P..'],
        ['...', 'PKP', '...'],
        ['P..', '.K.', '..P'],
      ];
      paint(g, spin[f], { top: 4, dx: 5 });
      break;
    }
    case 'reading': {
      // A book held open, eyes down, a page turning.
      whole(0, 0, f === 1 ? 'scan' : 'down');
      paint(g, ['WWDWW', 'WWDWW'], { top: 5, dx: 1 });
      if (f === 2)
        put(
          g,
          [
            [4, 4],
            [4, 5],
          ],
          'W',
        );
      if (f === 3)
        put(
          g,
          [
            [4, 1],
            [4, 2],
          ],
          'W',
        );
      break;
    }
    case 'thinking': {
      // A hand to the chin, eyes up, a thought rising.
      whole(0, 0, 'up');
      put(g, [[4, 5]], 'H');
      if (f >= 1) put(g, [[2, 6]], 'S');
      if (f >= 2) put(g, [[1, 7]], 'S');
      if (f >= 3)
        put(
          g,
          [
            [0, 6],
            [0, 7],
          ],
          'S',
        );
      break;
    }
    case 'waiting': {
      // A hand raised.
      whole(0, 0, 'open');
      clear(g, [[5, 5]]);
      put(
        g,
        [1, 2, 3, 4].map((y) => [y, 6]),
        'H',
      );
      break;
    }
    case 'quiet': {
      // Still, looking on, a trailing pair of dots.
      whole(0, 0, 'open');
      put(
        g,
        [
          [1, 6],
          [1, 7],
        ],
        'S',
      );
      break;
    }
    case 'stalled': {
      // Slumped: the head dropped and tilted, eyes crossed.
      paint(g, BODY, { top: BODY_TOP });
      paint(g, head, { dx: 1, dy: 1 });
      face(g, 'crossed', 1, 1);
      wear(g, mark, 'open', 1, 1);
      break;
    }
    case 'resting': {
      // Asleep: eyes shut, and a z rising.
      whole(0, 0, 'closed');
      put(
        g,
        [
          [2, 6],
          [0, 7],
        ],
        'S',
      );
      break;
    }
    case 'arriving': {
      // Dropping into the lane.
      whole(0, [-6, -3, -1, 0][f], 'open');
      if (f < 2)
        put(
          g,
          [
            [0, 0],
            [0, 6],
          ],
          'S',
        );
      break;
    }
    case 'handed-back': {
      // Holding the work up and away to the lead.
      whole(0, 0, f === 3 ? 'happy' : 'open');
      const paper = [
        [
          [5, 6],
          [5, 7],
        ],
        [
          [3, 6],
          [3, 7],
        ],
        [[1, 7]],
        [],
      ][f];
      put(g, paper, 'W');
      break;
    }
    case 'sent-back': {
      // A stumble backwards.
      whole([0, -1, -2, -1][f], [0, 0, 1, 0][f], 'oops');
      break;
    }
    case 'merged': {
      // A cheer: arms up, a jump, sparkles.
      const up = [0, -1, -1, 0][f];
      const body = BODY.map((r, i) => (i === 1 ? '..HHH...' : r));
      whole(0, up, 'happy', body);
      put(
        g,
        [
          [4 + up, 0],
          [3 + up, 0],
          [4 + up, 6],
          [3 + up, 6],
        ],
        'H',
      );
      put(
        g,
        f % 2
          ? [
              [0, 0],
              [1, 7],
            ]
          : [
              [1, 0],
              [0, 7],
            ],
        'K',
      );
      break;
    }
    default:
      whole(0, 0, 'open');
  }
  return g;
}

const shade = (rgb, by) =>
  (Math.round(((rgb >> 16) & 0xff) * by) << 16) |
  (Math.round(((rgb >> 8) & 0xff) * by) << 8) |
  Math.round((rgb & 0xff) * by);

/**
 * A pose's frame as a grid of colours (null for none), SIZE by SIZE. Resting is drawn dimmed. With
 * motion off, a loop shows its first frame and a move its last.
 */
export function characterFrame(pose, frame, character, { motion = 'while-active' } = {}) {
  const { tint } = character;
  const spec = POSES[pose] ?? POSES.resting;
  const f = motion === 'off' ? (spec.loop ? 0 : spec.frames - 1) : frame;
  const letters = compose(character, POSES[pose] ? pose : 'resting', f);
  const body = pose === 'resting' ? shade(tint, 0.5) : tint;
  const colour = {
    H: body,
    D: shade(body, 0.65),
    E: 0x1a1a1a,
    W: 0xf2f2f2,
    P: 0x9aa4ae,
    K: 0xffcc00,
    X: 0xff3b3b,
    L: 0x6a6a6a,
    S: 0xcfd8e0,
    B: 0x7cc4ff,
  };
  return letters.map((r) => r.map((c) => colour[c] ?? null));
}

/** The frames of a pose, in order: one for a still pose. */
export function characterFrames(pose, character, options) {
  const n = POSES[pose]?.frames ?? 1;
  return Array.from({ length: n }, (_, f) => characterFrame(pose, f, character, options));
}

const hex = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`;
const rects = (grid, scale) =>
  grid
    .flatMap((row, y) =>
      row.map((c, x) =>
        c === null
          ? ''
          : `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${hex(c)}"/>`,
      ),
    )
    .join('');

/** The SVG for one pose on Desktop: a loop repeats, a move plays once and holds its last frame. */
export function characterSvg(pose, character, { scale = 3, motion = 'while-active' } = {}) {
  const spec = POSES[pose] ?? POSES.resting;
  const frames =
    motion === 'off'
      ? [characterFrame(pose, 0, character, { motion })]
      : characterFrames(pose, character);
  const px = SIZE * scale;
  const dur = (spec.ms * frames.length) / 1000;
  const groups = frames.map((g, f) => {
    if (frames.length === 1) return `<g>${rects(g, scale)}</g>`;
    const values = frames.map((_, i) => (i === f ? 'visible' : 'hidden')).join(';');
    const repeat = spec.loop ? ' repeatCount="indefinite"' : ' fill="freeze"';
    return `<g visibility="${f ? 'hidden' : 'visible'}"><animate attributeName="visibility" values="${values}" dur="${dur}s"${repeat} calcMode="discrete"/>${rects(g, scale)}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">${groups.join('')}</svg>`;
}

/** The sheet (UI-11): every lane in every pose and move, the lead first. */
export function sheet(lanes) {
  const names = ['lead', ...lanes.filter((l) => l !== 'lead')];
  const characters = charactersOf(names);
  return {
    poses: [...WORK, ...STILL, ...MOVES],
    rows: names.map((lane) => ({ lane, ...characters[lane] })),
  };
}
