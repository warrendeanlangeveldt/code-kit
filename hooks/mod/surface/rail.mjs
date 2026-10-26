// The rail from the lead to the lanes it dispatched (UI-12), as a surface module: a dot travels along
// it while the lead's turn runs; still, it's a plain line.

const running = new WeakMap();

/** The rail as text: a line `width` long, the dot at `at` (none when null), an arrow at the end. */
export function railText(width, at) {
  const n = Math.max(2, width - 1);
  const cells = Array.from({ length: n }, () => '─');
  if (at !== null) cells[at % n] = '•';
  return `${cells.join('')}▸`;
}

export default function Rail(props, surface) {
  const { width = 12, running: on = false, motion = 'while-active' } = props ?? {};
  const rec = running.get(surface) ?? { at: 0, stop: null };
  running.set(surface, rec);
  const move = on && motion !== 'off';
  if (move && !rec.stop)
    rec.stop = surface.every(120, () => {
      rec.at += 1;
      surface.setState({ at: rec.at });
    });
  if (!move && rec.stop) {
    rec.stop();
    rec.stop = null;
  }
  const { Text } = surface.elements;
  return Text({
    ...(on ? { color: 'yellow' } : { dimColor: true }),
    children: [railText(width, on ? rec.at : null)],
  });
}
