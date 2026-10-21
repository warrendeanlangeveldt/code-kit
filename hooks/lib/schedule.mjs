// What starts next, lane by lane (docs/specs/23-the-team.md, SCHED-1 and SCHED-2), the pure parts. A lane
// runs one story at a time; the plan's graph is for running different lanes at once. Slices (a story's
// `**Slice:** <name>`, a feature that can be shown working across lanes) set the order, not a gate: a free
// lane takes a ready story in an open slice first, then one in the next slice while fewer than
// `harness.slices.open` are open, then any story outside a slice, and only then one ahead of its slice.

/** States a story is in once its work has started: its slice is open from then until all of it is done. */
const STARTED = new Set(['in progress', 'review', 'sent back', 'waiting on you', 'done']);

/** Each slice in plan order: [{ name, stories, open, done }]. */
export function slicesOf(stories) {
  const byName = new Map();
  for (const s of stories) {
    if (!s.slice) continue;
    if (!byName.has(s.slice)) byName.set(s.slice, []);
    byName.get(s.slice).push(s);
  }
  return [...byName].map(([name, own]) => {
    const done = own.every((s) => s.state === 'done');
    return {
      name,
      stories: own.map((s) => s.id),
      done,
      open: !done && own.some((s) => STARTED.has(s.state)),
    };
  });
}

/**
 * SCHED-1, SCHED-2: at most one story for each free lane. `fixes` (sent back, which go first in their
 * lane) and `ready` are story ids; `busy` the lanes running a story now. Returns { pick, ahead, waiting,
 * opened }: the ids to dispatch, those of them ahead of their slice ([{ id, slice }]), the ready or sent-back
 * ids left for a lane's next turn, and the slices a pick opens.
 */
export function pickPerLane(stories, { fixes = [], ready = [], busy = new Set(), open = 1 } = {}) {
  const order = new Map(stories.map((s, i) => [s.id, i]));
  const byId = new Map(stories.map((s) => [s.id, s]));
  const slices = slicesOf(stories);
  const opened = new Set(slices.filter((s) => s.open).map((s) => s.name));
  const startOrder = [];
  let room = Math.max(0, open - opened.size);
  // The next slice in plan order that isn't open or done: the one a free lane may open.
  const nextSlice = () => slices.find((s) => !s.done && !opened.has(s.name))?.name ?? null;
  const rank = (id) => {
    const slice = byId.get(id)?.slice ?? null;
    if (slice && opened.has(slice)) return 0;
    if (slice && room > 0 && slice === nextSlice()) return 1;
    return slice ? 3 : 2;
  };
  const candidates = [...new Set([...fixes, ...ready])].filter((id) => byId.get(id)?.lane);
  const lanes = [...new Set(candidates.map((id) => byId.get(id).lane))].sort(
    (a, b) =>
      Math.min(...candidates.filter((id) => byId.get(id).lane === a).map((id) => order.get(id))) -
      Math.min(...candidates.filter((id) => byId.get(id).lane === b).map((id) => order.get(id))),
  );
  const pick = [];
  const ahead = [];
  // Lanes with something in an open slice choose first, so the feature in progress is never passed over.
  const firstRank = (lane) =>
    Math.min(...candidates.filter((id) => byId.get(id).lane === lane).map(rank));
  for (const lane of [...lanes].sort((a, b) => firstRank(a) - firstRank(b))) {
    if (busy.has(lane)) continue;
    const own = candidates.filter((id) => byId.get(id).lane === lane);
    const fix = own.find((id) => fixes.includes(id));
    const chosen =
      fix ??
      [...own].sort((a, b) => rank(a) - rank(b) || order.get(a) - order.get(b)).find(Boolean);
    if (!chosen) continue;
    const r = fix ? null : rank(chosen);
    const slice = byId.get(chosen).slice ?? null;
    if (r === 1) {
      opened.add(slice);
      startOrder.push(slice);
      room -= 1;
    }
    if (r === 3) ahead.push({ id: chosen, slice });
    pick.push(chosen);
  }
  pick.sort((a, b) => order.get(a) - order.get(b));
  return {
    pick,
    ahead,
    waiting: candidates.filter((id) => !pick.includes(id)),
    opened: startOrder,
  };
}
