// The lane agents' characters, redrawn (docs/specs/27-the-mod-redesigned.md, UI-11): 12 by 12
// pixels, each lane its own shape as well as its tint so lanes read apart without colour, the lead's
// crowned. A pose is the agent's state or the kind of work it's doing; a move is a one-off at an
// event. Every frame is composed from layers (a head by shape, a face, a body, a prop), so each
// shape gets every pose. Pure: the mod draws the grids as half-block cells or SVG.

const SIZE = 12;

/** Each head, rows 0 to 6: H the tint, D its shade, K gold, P grey metal. */
const HEADS = {
  crown: [
    '...K.KK.K...',
    '...KKKKKK...',
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
  ],
  antenna: [
    '......K.....',
    '......D.....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
  ],
  cat: [
    '............',
    '...D....D...',
    '...HD..DH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
  ],
  cap: [
    '............',
    '...DDDDDD...',
    '...DDDDDDDD.',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
  ],
  bunny: [
    '....D..D....',
    '....D..D....',
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
  ],
  bolts: [
    '............',
    '............',
    '...HHHHHH...',
    '..DHHHHHHD..',
    '..DHHHHHHD..',
    '...HHHHHH...',
    '...DDDDDD...',
  ],
  wizard: [
    '.....DD.....',
    '....DDDD....',
    '..DDDDDDDD..',
    '...HHHHHH...',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
  ],
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

/** The body, rows 7 to 11, arms in columns 3 and 8. */
const BODY = ['....DDDD....', '...HHHHHH...', '...HHHHHH...', '....H..H....', '...HH..HH...'];

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

/** The eyes and mouth: where the eyes look, and the face's mood. */
function face(grid, kind, dx = 0, dy = 0) {
  const at = (points) => points.map(([y, x]) => [y + dy, x + dx]);
  const eyes = {
    open: [
      [4, 4],
      [4, 7],
    ],
    down: [
      [5, 4],
      [5, 7],
    ],
    up: [
      [3, 4],
      [3, 7],
    ],
    scan: [
      [5, 5],
      [5, 8],
    ],
  };
  if (kind === 'closed') return put(grid, at(eyes.open), 'L');
  if (kind === 'crossed') return put(grid, at(eyes.open), 'X');
  put(grid, at(eyes[kind] ?? eyes.open), 'E');
  if (kind === 'happy')
    put(
      grid,
      at([
        [5, 5],
        [5, 6],
      ]),
      'E',
    );
  if (kind === 'oops') {
    put(grid, at([[5, 6]]), 'E');
    put(grid, at([[3, 9]]), 'B');
  }
}

/** A lane's mark, worn in every pose: glasses round the eyes, a scarf at the neck, a belt. */
function wear(grid, mark, mood, dx = 0, dy = 0) {
  const at = (points) => points.map(([y, x]) => [y + dy, x + dx]);
  const eyes = mood === 'down' || mood === 'scan' ? 5 : mood === 'up' ? 3 : 4;
  if (mark === 'glasses')
    put(
      grid,
      at([
        [eyes, 3],
        [eyes, 5],
        [eyes, 6],
        [eyes, 8],
      ]),
      'P',
    );
  if (mark === 'scarf') put(grid, at([3, 4, 5, 6, 7, 8].map((x) => [7, x])), 'S');
  if (mark === 'belt') put(grid, at([4, 5, 6, 7].map((x) => [9, x])), 'P');
}

/** A frame as a grid of letters, before colour. */
function compose({ shape, mark = null }, pose, frame) {
  const g = blank();
  const head = HEADS[shape] ?? HEADS.antenna;
  const whole = (dx, dy, mood, body = BODY) => {
    paint(g, head, { dx, dy });
    paint(g, body, { top: 7, dx, dy });
    face(g, mood, dx, dy);
    wear(g, mark, mood, dx, dy);
  };
  const f = frame % (POSES[pose]?.frames ?? 1);
  switch (pose) {
    case 'writing': {
      // At a sheet of paper on the right, the pencil moving and the lines filling.
      whole(0, 0, 'down');
      put(g, [[8, 9]], 'H');
      paint(g, ['WWW', 'WWW'], { top: 10, dx: 9 });
      const tip = [9, 10, 11, 10][f];
      put(g, [[9, tip]], 'K');
      put(g, [[8, Math.min(11, tip + 1)]], 'P');
      put(
        g,
        [
          [10, 9],
          [10, 10],
          [10, 11],
        ].slice(0, f),
        'E',
      );
      break;
    }
    case 'running': {
      // Turning a crank on the left, its bar spinning a quarter a frame, bobbing as it works.
      const bob = f % 2;
      whole(0, bob, 'open');
      const spin = [
        ['.P.', '.K.', '.P.'],
        ['..P', '.K.', 'P..'],
        ['...', 'PKP', '...'],
        ['P..', '.K.', '..P'],
      ];
      paint(g, spin[f], { top: 7 });
      break;
    }
    case 'reading': {
      // A book held open, eyes down, a page turning.
      whole(0, 0, f === 1 ? 'scan' : 'down');
      paint(g, ['WWWDDWWW', 'WWWDDWWW'], { top: 8, dx: 2 });
      if (f === 2)
        put(
          g,
          [
            [7, 7],
            [7, 8],
          ],
          'W',
        );
      if (f === 3)
        put(
          g,
          [
            [7, 3],
            [7, 4],
          ],
          'W',
        );
      break;
    }
    case 'thinking': {
      // A hand to the chin, eyes up, a thought rising.
      whole(0, 0, 'up');
      clear(g, [[9, 8]]);
      put(
        g,
        [
          [8, 9],
          [7, 9],
          [6, 8],
        ],
        'H',
      );
      if (f >= 1) put(g, [[5, 10]], 'S');
      if (f >= 2) put(g, [[3, 11]], 'S');
      if (f >= 3) paint(g, ['SSS', 'SSS'], { top: 0, dx: 9 });
      break;
    }
    case 'waiting': {
      // A raised hand.
      whole(0, 0, 'open');
      clear(g, [[9, 8]]);
      put(
        g,
        [
          [8, 9],
          [7, 9],
          [6, 9],
          [5, 9],
          [4, 9],
        ],
        'H',
      );
      break;
    }
    case 'quiet': {
      // Still, looking on, a trailing ellipsis.
      whole(0, 0, 'open');
      put(
        g,
        [
          [1, 9],
          [1, 10],
          [1, 11],
        ],
        'S',
      );
      break;
    }
    case 'stalled': {
      // Slumped: the head dropped and tilted, eyes crossed.
      paint(g, BODY, { top: 7 });
      paint(g, head, { dx: 1, dy: 1 });
      face(g, 'crossed', 1, 1);
      wear(g, mark, 'open', 1, 1);
      break;
    }
    case 'resting': {
      // Eyes closed, a Z.
      whole(0, 0, 'closed');
      paint(g, ['SSS', '.S.', 'SSS'], { top: 0, dx: 9 });
      break;
    }
    case 'arriving': {
      // Dropping into the lane.
      whole(0, [-8, -4, -1, 0][f], 'open');
      if (f < 2)
        put(
          g,
          [
            [0, 2],
            [0, 9],
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
          [8, 9],
          [8, 10],
        ],
        [
          [6, 10],
          [6, 11],
        ],
        [[4, 11]],
        [],
      ][f];
      if (f < 2) put(g, [[8, 9]], 'H');
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
      const up = [0, -2, -1, 0][f];
      const body = BODY.map((r, i) => (i === 1 || i === 2 ? '....HHHH....' : r));
      whole(0, up, 'happy', body);
      put(
        g,
        [
          [7 + up, 2],
          [6 + up, 2],
          [5 + up, 2],
          [7 + up, 9],
          [6 + up, 9],
          [5 + up, 9],
        ],
        'H',
      );
      put(
        g,
        f % 2
          ? [
              [0, 1],
              [2, 11],
            ]
          : [
              [1, 0],
              [0, 10],
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
 * A pose's frame as a grid of colours (null for none), 12 by 12. Resting is drawn dimmed. With
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
