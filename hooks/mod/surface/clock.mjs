// An agent's elapsed clock (UI-12, VIEW-4), as a surface module: it ticks on the surface's own frame
// clock while its agent works, so the pane isn't redrawn every second. Still otherwise.

/** How long, as a clock reads it: 45s, 2:05, 1h 12m. */
export function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const running = new WeakMap();

export default function Clock(props, surface) {
  const { ms = 0, running: on = false, motion = 'while-active', color = null } = props ?? {};
  const rec = running.get(surface) ?? { base: null, ticks: 0, stop: null };
  running.set(surface, rec);
  if (rec.base !== ms) {
    rec.base = ms;
    rec.ticks = 0;
  }
  const tick = on && motion !== 'off';
  if (tick && !rec.stop)
    rec.stop = surface.every(1000, () => {
      rec.ticks += 1;
      surface.setState({ ticks: rec.ticks });
    });
  if (!tick && rec.stop) {
    rec.stop();
    rec.stop = null;
  }
  const { Text } = surface.elements;
  return Text({
    ...(color ? { color } : { dimColor: true }),
    children: [elapsed(rec.base + rec.ticks * 1000)],
  });
}
