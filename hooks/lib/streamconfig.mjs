// The config's streams checked (docs/specs/31-streams-and-platform.md, STRM-1, STRM-4, STRM-5), on their
// own so the config's loader reads them without the rest of the stream model.
export const CORE = 'core';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** STRM-1, STRM-4, STRM-5: what's wrong with the config's streams, in its words. */
export function streamProblems(c) {
  if (c.streams === undefined) {
    const tagged = (Array.isArray(c.layers) ? c.layers : []).filter((l) => l?.stream !== undefined);
    return tagged.length
      ? [
          `layers ${tagged.map((l) => `"${l.name}"`).join(', ')} name a stream, but there's no "streams"`,
        ]
      : [];
  }
  if (!isObj(c.streams) || !Object.keys(c.streams).length)
    return ['"streams" must name each stream: { "<name>": { "lanes", "plan" } }'];
  const p = [];
  const lanes = Object.keys(isObj(c.lanes) ? c.lanes : {});
  const owner = new Map();
  const plans = [];
  for (const [name, s] of Object.entries(c.streams)) {
    const at = `streams.${name}`;
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name === CORE) {
      p.push(`${at}: a stream's name is short and lower-case, and isn't "${CORE}"`);
      continue;
    }
    if (!isObj(s)) {
      p.push(`${at} must be an object`);
      continue;
    }
    if (!Array.isArray(s.lanes) || !s.lanes.every((l) => typeof l === 'string'))
      p.push(`${at}.lanes must list the stream's lanes`);
    for (const l of Array.isArray(s.lanes) ? s.lanes : []) {
      if (!lanes.includes(l)) p.push(`${at}.lanes names an unknown lane "${l}"`);
      else if (owner.has(l))
        p.push(
          `the lane "${l}" is in two streams, ${owner.get(l)} and ${name}: a lane is one stream's`,
        );
      else owner.set(l, name);
    }
    if (typeof s.plan !== 'string' || !s.plan)
      p.push(`${at}.plan must be the stream's plan file (or folder)`);
    else {
      const under = c.docs?.plan;
      if (under && !(s.plan === under || s.plan.startsWith(`${under.replace(/\/$/, '')}/`)))
        p.push(`${at}.plan must be inside docs.plan (${under}), where code-kit reads the stories`);
      plans.push([name, s.plan]);
    }
    if (
      s.specs !== undefined &&
      !(Array.isArray(s.specs) && s.specs.every((x) => typeof x === 'string'))
    )
      p.push(`${at}.specs must list the spec files the stream builds`);
    if (s.platform !== undefined && typeof s.platform !== 'boolean')
      p.push(`${at}.platform must be true or false`);
    if (s.label !== undefined && (typeof s.label !== 'string' || s.label.length > 60))
      p.push(`${at}.label must be a short name, at most 60 characters`);
  }
  for (const [a, pa] of plans)
    for (const [b, pb] of plans)
      if (a < b && (pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)))
        p.push(`streams ${a} and ${b} share a plan (${pa}, ${pb}): each stream's plan is its own`);
  const platforms = Object.entries(c.streams).filter(([, s]) => s?.platform === true);
  if (platforms.length > 1)
    p.push(
      `only one stream owns core, but ${platforms.map(([n]) => n).join(' and ')} are platform`,
    );
  if (platforms.length === 1) {
    const loose = lanes.filter((l) => !owner.has(l));
    if (loose.length)
      p.push(
        `${loose.map((l) => `"${l}"`).join(', ')} ${loose.length === 1 ? 'is' : 'are'} in no stream; with a platform stream (${platforms[0][0]}), core's lanes are its: list ${loose.length === 1 ? 'it' : 'them'} under a stream`,
      );
  }
  for (const [i, l] of (Array.isArray(c.layers) ? c.layers : []).entries())
    if (l?.stream !== undefined && !Object.hasOwn(c.streams, l.stream))
      p.push(`layers[${i}].stream names an unknown stream "${l.stream}"`);
  return p;
}
