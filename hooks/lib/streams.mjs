// Streams and the platform (docs/specs/31-streams-and-platform.md, STRM-1 to STRM-8). A stream is a squad
// and the product line it builds: its own lead session, lanes, plan and specs. The code is one codebase:
// per technical layer, a core and a module per stream. A layer with `stream` is that stream's module; one
// without is core. A lane in no stream is a core lane the streams share, taken in turns; a stream with
// `platform: true` owns core instead. A project without `streams` is one stream holding every lane.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { layerOf } from './layers.mjs';
import { laneOf, projectWorktrees } from './rules.mjs';
import { CORE } from './streamconfig.mjs';

export { CORE, streamProblems } from './streamconfig.mjs';

export const TURNS_FILE = '.claude/state/lane-turns.json';
export const CORE_REQUESTS_FILE = '.claude/state/core-requests.jsonl';

const mainOf = (root) => projectWorktrees(root)[0] ?? root;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** STRM-1: the project's streams, in the config's order: [{ name, label, lanes, plan, specs, platform }]. */
export function streamsOf(config) {
  if (!isObj(config?.streams)) return [];
  return Object.entries(config.streams).map(([name, s]) => ({
    name,
    label: s?.label ?? name,
    lanes: Array.isArray(s?.lanes) ? s.lanes : [],
    plan: s?.plan ?? null,
    specs: Array.isArray(s?.specs) ? s.specs : [],
    platform: s?.platform === true,
  }));
}

/** Whether the project is built as streams: false for one without `streams`, which works as before. */
export const hasStreams = (config) => streamsOf(config).length > 0;

/** STRM-6: the stream that owns core, or null. */
export const platformOf = (config) => streamsOf(config).find((s) => s.platform) ?? null;

/** The stream a lane belongs to, or null: a core lane the streams share, or a project without streams. */
export const streamOfLane = (config, lane) =>
  streamsOf(config).find((s) => s.lanes.includes(lane))?.name ?? null;

/** STRM-6: the lanes the streams share (core's, with no platform stream): every lane in no stream. */
export function sharedLanes(config) {
  if (!hasStreams(config)) return [];
  return Object.keys(config.lanes ?? {}).filter((lane) => !streamOfLane(config, lane));
}

/** The stream whose plan holds the plan file `file`, or null. */
export function streamOfPlanFile(config, file) {
  if (!file) return null;
  return (
    streamsOf(config).find(
      (s) => s.plan && (file === s.plan || file.startsWith(`${s.plan.replace(/\/$/, '')}/`)),
    )?.name ?? null
  );
}

/**
 * The stream a story belongs to: its lane's, or, for the lead's own stories, design stories and a shared
 * core lane's, the stream whose plan holds it. Null in a project without streams.
 */
export const streamOfStory = (config, story) =>
  streamOfLane(config, story?.lane) ?? streamOfPlanFile(config, story?.file);

/**
 * STRM-5: whose code a repository path is: a stream's name, `core`, or null outside every layer and lane.
 * A layer says first (a module of a stream, or core); a file in no layer is its lane's stream's, or core's
 * when its lane is shared.
 */
export function ownerStreamOf(config, rel) {
  if (!hasStreams(config)) return null;
  const layer = layerOf(rel, config.layers ?? []);
  if (layer) return layer.stream ?? CORE;
  const lane = laneOf(rel, config);
  if (!lane) return null;
  return streamOfLane(config, lane) ?? CORE;
}

/** STRM-4: story ids in more than one plan file: [{ id, files }]. */
export function duplicateStories(stories) {
  const files = new Map();
  for (const s of stories) files.set(s.id, [...(files.get(s.id) ?? []), s.file]);
  return [...files]
    .filter(([, f]) => new Set(f).size > 1)
    .map(([id, f]) => ({ id, files: [...new Set(f)] }));
}

/** STRM-4: the stream whose plan `rel` is, when it isn't `stream`'s own: its name, or null. */
export function otherStreamsPlan(config, rel, stream) {
  const owner = streamOfPlanFile(config, rel);
  return owner && owner !== stream ? owner : null;
}

/** STRM-4: whether a stream's own lead may write `rel`: the spec files of other streams stay theirs. */
export function otherStreamsSpec(config, rel, stream) {
  const owner = streamsOf(config).find((s) => s.specs.length && matchesAny(rel, s.specs));
  return owner && owner.name !== stream ? owner.name : null;
}

// STRM-6: whose turn a shared core lane is: the stream it last ran a story for.
function readTurns(root) {
  try {
    const t = JSON.parse(readFileSync(join(mainOf(root), TURNS_FILE), 'utf8'));
    return isObj(t) ? t : {};
  } catch {
    return {};
  }
}

/** STRM-6: the stream a shared lane last ran a story for, or null. */
export const lastTurn = (root, lane) => readTurns(root)[lane] ?? null;

/** STRM-6: a shared lane started a story for `stream`. */
export function recordTurn(root, lane, stream) {
  if (!stream) return;
  const file = join(mainOf(root), TURNS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...readTurns(root), [lane]: stream })}\n`);
}

/**
 * STRM-6: the shared lanes `stream` gives way on: those it ran last, while another stream has a story
 * waiting for them. `waiting` is [{ lane, stream }], every stream's ready and sent-back stories.
 */
export function lanesToGiveWay(root, config, stream, waiting) {
  if (!stream) return [];
  return sharedLanes(config).filter(
    (lane) =>
      lastTurn(root, lane) === stream &&
      waiting.some((w) => w.lane === lane && w.stream && w.stream !== stream),
  );
}

// STRM-7: what a stream asks of core, with a platform stream: the platform lead decides each.
function readCoreLog(root) {
  try {
    return readFileSync(join(mainOf(root), CORE_REQUESTS_FILE), 'utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function appendCore(root, record) {
  const file = join(mainOf(root), CORE_REQUESTS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/** STRM-7: every change request to core: [{ id, at, stream, session, story, what, why, state, decided }]. */
export function coreRequests(root) {
  const byId = new Map();
  for (const r of readCoreLog(root)) {
    if (r.kind === 'ask') byId.set(r.id, { ...r, state: 'open', decided: null });
    const had = byId.get(r.id);
    if (r.kind === 'decide' && had)
      byId.set(r.id, {
        ...had,
        state: r.how,
        decided: { at: r.at, by: r.by ?? null, story: r.story ?? null, reason: r.reason ?? null },
      });
  }
  return [...byId.values()];
}

/** STRM-7: a stream's lead asks core for what its story needs. The same open ask is asked once. */
export function askCore(
  root,
  { stream, session = null, story = null, what, why = null },
  now = Date.now(),
) {
  const text = String(what ?? '').trim();
  if (!text) return { ok: false, why: 'Say what the story needs from core.' };
  const open = coreRequests(root).find(
    (r) => r.state === 'open' && r.what === text && (r.story ?? null) === (story ?? null),
  );
  if (open) return { ok: true, request: open, existed: true };
  const id = `C-${readCoreLog(root).filter((r) => r.kind === 'ask').length + 1}`;
  appendCore(root, {
    kind: 'ask',
    id,
    at: new Date(now).toISOString(),
    stream,
    session,
    story,
    what: text,
    why: why?.trim() || null,
  });
  return { ok: true, request: coreRequests(root).find((r) => r.id === id), existed: false };
}

/**
 * STRM-7: the platform lead's decision on a change request: `accepted` with the platform story that
 * builds it (the asking story waits for that story), or `declined` with why.
 */
export function decideCore(
  root,
  id,
  { how, story = null, reason = null, by = null },
  now = Date.now(),
) {
  const r = coreRequests(root).find((x) => x.id === id);
  if (!r)
    return { ok: false, why: `There's no change request ${id} to core. code-kit core lists them.` };
  if (r.state !== 'open') return { ok: false, why: `${id} was ${r.state} already.` };
  if (how === 'accepted' && !/^ST-\d+$/.test(story ?? ''))
    return { ok: false, why: 'Name the platform story that builds it: --story ST-n.' };
  if (how === 'declined' && !reason?.trim())
    return {
      ok: false,
      why: 'Say why it is declined, with --reason, so the asking lead can plan around it.',
    };
  appendCore(root, { kind: 'decide', id, at: new Date(now).toISOString(), how, story, reason, by });
  return { ok: true, request: coreRequests(root).find((x) => x.id === id) };
}

/**
 * STRM-7: the stories a change request to core holds: Map(story → why), each open request's story, and
 * each accepted one's until the platform story that builds it is done.
 */
export function heldByCore(root, stories) {
  const done = new Set(stories.filter((s) => s.state === 'done').map((s) => s.id));
  const held = new Map();
  for (const r of coreRequests(root)) {
    if (!r.story || done.has(r.story)) continue;
    if (r.state === 'open')
      held.set(r.story, `${r.story} waits on the platform's decision on ${r.id} (${r.what})`);
    else if (r.state === 'accepted' && r.decided?.story && !done.has(r.decided.story))
      held.set(
        r.story,
        `${r.story} waits for ${r.decided.story}, the platform's story for ${r.id} (${r.what})`,
      );
  }
  return held;
}
