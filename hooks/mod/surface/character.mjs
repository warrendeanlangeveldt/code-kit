// A lane's character (docs/specs/27-the-mod-redesigned.md, UI-11 and UI-12), as a surface module: it
// runs on the surface's own frame clock, so only it redraws while it moves. A pose that loops (the
// kind of work) plays while its agent works; a move (arriving, handed back, sent back, merged) plays
// once, then the pose shows. Still poses, and `motion: off`, start no timer at all.
import { POSES, characterFrame } from '../characters.mjs';

const hex = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`;

/** Each instance's timer and frame, by its surface (the same object across its calls). */
const running = new WeakMap();

/** A character's grid as half-block rows, two pixels a cell: a run of cells sharing colours is one Text. */
export function halfBlocks(grid, { Box, Text }) {
  const rows = [];
  for (let y = 0; y < grid.length; y += 2) {
    const runs = [];
    for (let x = 0; x < grid[y].length; x++) {
      const top = grid[y][x];
      const bottom = grid[y + 1]?.[x] ?? null;
      const cell =
        top === null && bottom === null
          ? { ch: ' ' }
          : top === null
            ? { ch: '▄', color: hex(bottom) }
            : { ch: '▀', color: hex(top), ...(bottom === null ? {} : { bg: hex(bottom) }) };
      const last = runs.at(-1);
      if (last && last.color === cell.color && last.bg === cell.bg) last.text += cell.ch;
      else runs.push({ text: cell.ch, color: cell.color, bg: cell.bg });
    }
    rows.push(
      Box({
        key: `row-${y}`,
        flexDirection: 'row',
        children: runs.map((r, i) =>
          Text({
            key: `run-${i}`,
            ...(r.color ? { color: r.color } : {}),
            ...(r.bg ? { backgroundColor: r.bg } : {}),
            children: [r.text],
          }),
        ),
      }),
    );
  }
  return Box({ flexDirection: 'column', children: rows });
}

export default function Character(props, surface) {
  const { look, pose = 'resting', move = null, motion = 'while-active' } = props ?? {};
  const rec = running.get(surface) ?? { seq: null, f: 0, stop: null, played: null };
  running.set(surface, rec);
  const moving = motion !== 'off';
  const playing = moving && move && rec.played !== move.key ? move : null;
  const shown = playing ? playing.kind : pose;
  const spec = POSES[shown] ?? POSES.resting;
  const animate = moving && spec.frames > 1 && (playing || spec.loop);
  const seq = animate ? `${playing ? `move:${move.key}` : 'pose'}:${shown}` : null;
  if (seq !== rec.seq) {
    rec.stop?.();
    rec.stop = null;
    rec.f = 0;
    rec.seq = seq;
    if (animate)
      rec.stop = surface.every(spec.ms, () => {
        rec.f += 1;
        if (!spec.loop && rec.f >= spec.frames) {
          // The move has played: hold its last frame no longer, show the pose.
          rec.played = move.key;
          rec.f = spec.frames - 1;
          rec.stop?.();
          rec.stop = null;
          rec.seq = null;
        }
        surface.setState({ tick: (surface.state?.tick ?? 0) + 1 });
      });
  }
  const frame = animate ? rec.f % spec.frames : 0;
  return halfBlocks(characterFrame(shown, frame, look, { motion }), surface.elements);
}
