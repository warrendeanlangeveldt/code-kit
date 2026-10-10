// The harness's settings (docs/specs/12-settings.md): the `harness` section of .claude/code-kit.json,
// what the mod's loop, hold, reviewer and usage read. Defaults fill what the section leaves out; a value
// out of range is a config problem like any other.

export const AUTONOMY = ['autonomous', 'propose', 'off'];
export const MODELS = ['haiku', 'sonnet', 'opus'];

/** Each setting by its dotted key: its default, and why a value is wrong (or null when it's right). */
export const SETTINGS = {
  autonomy: {
    default: 'autonomous',
    problem: (v) => (AUTONOMY.includes(v) ? null : `must be one of ${AUTONOMY.join(', ')}`),
    about: 'How the lead loop acts: on its own, by proposing each step, or not at all',
  },
  'hold.minutes': {
    default: 2,
    problem: (v) =>
      Number.isFinite(v) && v >= 0 && v <= 10
        ? null
        : 'must be a number of minutes from 0 (off) to 10',
    about: 'How long a call waiting on your approval is held before it is refused',
  },
  'stall.nudgeMinutes': {
    default: 5,
    problem: (v) =>
      Number.isFinite(v) && v >= 1 ? null : 'must be a number of minutes, at least 1',
    about: 'Minutes without a tool call before a lane agent is nudged',
  },
  'stall.restartMinutes': {
    default: 10,
    problem: (v) =>
      Number.isFinite(v) && v >= 1 ? null : 'must be a number of minutes, at least 1',
    about: 'Minutes without a tool call before a lane agent is restarted',
  },
  'stall.maxRestarts': {
    default: 2,
    problem: (v) =>
      Number.isInteger(v) && v >= 0 && v <= 10 ? null : 'must be a whole number from 0 to 10',
    about: 'Restarts on one story before the lane is flagged for you',
  },
  'agents.reviewer.on': {
    default: false,
    problem: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
    about: 'A background reviewer for each finished branch',
  },
  'agents.reviewer.model': {
    default: null,
    problem: (v) =>
      v === null || (typeof v === 'string' && v.length > 0)
        ? null
        : `must be a model (${MODELS.join(', ')}, or an id), or null for the session's`,
    about: "The reviewer's model; none means the session's",
  },
  'background.pauseAtPercent': {
    default: 80,
    problem: (v) =>
      Number.isFinite(v) && v > 0 && v <= 100 ? null : 'must be a percentage from 1 to 100',
    about: "The plan's 5-hour use at which background agents pause",
  },
};

const get = (obj, key) =>
  key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const set = (obj, key, value) => {
  const parts = key.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
  o[parts.at(-1)] = value;
  return obj;
};

/** Every key the section holds, as dotted keys: `stall.nudgeMinutes`, `agents.reviewer.on`… */
function keysOf(obj, prefix = '') {
  return Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) && !(`${prefix}${k}` in SETTINGS)
      ? keysOf(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

/** The settings in force: the section's values over the defaults, as a nested object. A value that's
 * wrong (reported by `harnessProblems`) gives way to the default. */
export function harnessSettings(section) {
  const out = {};
  for (const [key, s] of Object.entries(SETTINGS)) {
    const v = section && typeof section === 'object' ? get(section, key) : undefined;
    set(out, key, v === undefined || s.problem(v) ? s.default : v);
  }
  return out;
}

/** The section's problems, in the config's words. */
export function harnessProblems(section) {
  if (section === undefined) return [];
  if (!section || typeof section !== 'object' || Array.isArray(section))
    return ['"harness" must be an object'];
  const p = [];
  for (const key of keysOf(section)) {
    if (!(key in SETTINGS)) {
      p.push(
        `"harness.${key}" isn't a harness setting (they are ${Object.keys(SETTINGS).join(', ')})`,
      );
      continue;
    }
    const why = SETTINGS[key].problem(get(section, key));
    if (why) p.push(`"harness.${key}" ${why}`);
  }
  const h = harnessSettings(section);
  if (h.stall.restartMinutes <= h.stall.nudgeMinutes)
    p.push('"harness.stall.restartMinutes" must be more than "harness.stall.nudgeMinutes"');
  return p;
}

/** A value typed on the command line, as the setting's type: numbers, true and false, null, or text. */
export function parseSetting(key, text) {
  const d = SETTINGS[key]?.default;
  if (text === 'null') return null;
  if (typeof d === 'boolean' || text === 'true' || text === 'false')
    return text === 'true' ? true : text === 'false' ? false : text;
  if (typeof d === 'number' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** The raw config with one harness setting changed (a copy). */
export function withSetting(raw, key, value) {
  const copy = structuredClone(raw);
  copy.harness = set(copy.harness ?? {}, key, value);
  return copy;
}

export { get as settingOf };
