// Designs handed over (docs/specs/24-designs-handed-over.md). An approved design is files in the
// repository, each state's code where the tool gives it and a PNG, named in the design register with a
// hash of each, so a lane builds from what the person approved and the review compares with it. The
// design gate (ONB-2, HAND-6) refuses a screen until the register holds its exported design; this checks
// what the register holds.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readScreens, screenKey } from './plan.mjs';

/** The states a screen has when its spec names none: the ones every screen is asked for. */
export const STATE_WORDS = ['default', 'empty', 'loading', 'error'];

/** A file's sha256, or null when it isn't there. */
export function sha256Of(root, rel) {
  try {
    return createHash('sha256')
      .update(readFileSync(join(root, rel)))
      .digest('hex');
  } catch {
    return null;
  }
}

/** The register's entries: `{ entries }`, or `{ entries: [], error }` when it can't be read. */
export function readRegister(root, config, text = null) {
  const register = config.designGate?.register;
  if (!register) return { entries: [] };
  try {
    const raw = JSON.parse(text ?? readFileSync(join(root, register), 'utf8'));
    return { entries: Array.isArray(raw.screens) ? raw.screens : [] };
  } catch (e) {
    return { entries: [], error: `${register} is missing or invalid (${e.message}).` };
  }
}

/** An entry as JSON with its keys in order, so the same entry written differently compares equal. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

/**
 * HAND-11: the entries of `entries` that none of `olds` (the registers a branch is held against: its
 * base's, the commit it's on, a branch it's merging in) already holds as they are. A branch answers
 * only for the entries it adds or changes; the rest came from elsewhere and were judged there.
 */
export function freshEntries(entries, ...olds) {
  const known = new Set(olds.flat().map(canonical));
  return entries.filter((e) => !known.has(canonical(e)));
}

/** HAND-2: whether an entry's design is files in the repository rather than only in a design tool. */
export const handedOver = (entry) => Array.isArray(entry?.states) && entry.states.length > 0;

/**
 * The tool an entry's design lives in: "paper" from "paper:…" for an entry not handed over yet, or
 * `fallback` when the entry doesn't say.
 */
export const toolOf = (entry, fallback = 'the design tool') =>
  entry?.source?.tool ?? String(entry?.design ?? '').match(/^([a-z][\w-]*):/i)?.[1] ?? fallback;

/**
 * HAND-9: the screens the specs' `## Screens` sections list under exactly `screen`'s name (a heading, a
 * bullet's bold title or a table row's name cell): none, one, or more when the name is ambiguous.
 */
export function screenMatches(root, specs, screen) {
  if (!specs || !screen) return [];
  const name = screenKey(screen);
  return readScreens(root, specs).filter((s) => s.name === name);
}

/** The states one listed screen has: those it lists, or else the default and the state words it mentions. */
const statesOfScreen = (s) =>
  s.states ??
  STATE_WORDS.filter((w) => w === 'default' || new RegExp(`\\b${w}\\b`, 'i').test(s.body));

/**
 * HAND-2: the states the specs' `## Screens` sections give `screen`: its `**States:**` line or States
 * column, or else the usual state words its text mentions (default always). Null when no spec lists the
 * screen, or more than one screen has its name (HAND-9).
 */
export function screenStates(root, specs, screen) {
  const found = screenMatches(root, specs, screen);
  return found.length === 1 ? statesOfScreen(found[0]) : null;
}

/**
 * HAND-2: what's wrong with a register entry, in sentences naming the screen, the state and the file:
 * a design only in a tool, a field missing, a file not there, a hash that isn't the approved one, a
 * state the spec lists with none, or a screen name more than one spec screen has (HAND-9). `specs` is
 * the specs' folder, for the states each screen should have.
 */
export function entryProblems(root, entry, specs = null) {
  const screen = entry.screen ?? entry.file;
  const fix = 'Export it from the design tool with /code-kit:design, as the person approved it.';
  if (!handedOver(entry))
    return [
      `${entry.file}: its approved design (${screen}) is only in ${toolOf(entry)}, not as files a lane can read. Hand it over: /code-kit:design --hand-over.`,
    ];
  const problems = [];
  for (const field of ['screen', 'story', 'approved', 'source'])
    if (!entry[field]) problems.push(`${entry.file}: its register entry has no "${field}".`);
  for (const state of entry.states) {
    const name = state?.name ?? '(unnamed)';
    const where = `${screen}'s ${name} state`;
    if (!state?.image) problems.push(`${where} has no image. ${fix}`);
    if (!state?.code && !state?.why)
      problems.push(`${where} has no code, and no "why" saying the tool gives none. ${fix}`);
    if (!state?.viewport) problems.push(`${where} doesn't say the viewport it was drawn at.`);
    for (const kind of ['image', 'code']) {
      const rel = state?.[kind];
      if (!rel) continue;
      const hash = sha256Of(root, rel);
      if (hash === null) problems.push(`${where}: ${rel} isn't there. ${fix}`);
      else if (!state.sha256?.[kind])
        problems.push(`${where}: ${rel} has no approved hash in the register.`);
      else if (state.sha256[kind] !== hash)
        problems.push(
          `${where}: ${rel} isn't the approved design: its hash differs from the one recorded. An approved design changes only with a new approval.`,
        );
    }
  }
  const listed = entry.screen ? screenMatches(root, specs, entry.screen) : [];
  if (listed.length > 1) {
    const where = listed.map((s) => `"${s.title}" in ${s.file}`).join(', ');
    problems.push(
      `${screen}: more than one screen in the specs has this name (${where}), so which states it needs can't be told. Give each screen a name of its own under ## Screens, and the entry the one it designs.`,
    );
    return problems;
  }
  const wanted = listed.length ? statesOfScreen(listed[0]) : [];
  const have = new Set(entry.states.map((s) => String(s?.name ?? '').toLowerCase()));
  for (const w of wanted)
    if (!have.has(w))
      problems.push(`${screen}'s ${w} state, which the spec lists, has no approved design. ${fix}`);
  return problems;
}

/**
 * HAND-3: the register entries a story's screens are built from: those its own id names, and those of
 * the design stories it depends on. `stories` is the plan's.
 */
export function designsFor(entries, story, stories = []) {
  const s = stories.find((x) => x.id === story);
  const from = new Set([story, ...(s?.dependsOn ?? [])]);
  return entries.filter((e) => from.has(e.story));
}

/** A PNG's size in pixels, from its header: { width, height }, or null when it isn't a PNG. */
export function pngSize(bytes) {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes || bytes.length < 24 || !bytes.subarray(0, 8).equals(png)) return null;
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * HAND-7: whether a screenshot of `size` was taken at `viewport` ("390x844"): its width the viewport's
 * at 1x to 4x, and its height at least the viewport's at the same scale (a full-page screenshot is
 * taller). True when the viewport can't be read.
 */
export function atViewport(size, viewport) {
  const m = String(viewport ?? '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return true;
  const [w, h] = [Number(m[1]), Number(m[2])];
  return [1, 2, 3, 4].some((k) => size.width === w * k && size.height >= h * k);
}

/**
 * HAND-7: the approved states of the screens a branch builds (`files`, the screen files it changed)
 * that the review recorded no screenshot for: [{ entry, state }]. `records` are the branch's evidence
 * records; `current(record)` says whether one still stands for the branch as it is (its file unchanged
 * since).
 */
export function statesWithoutEvidence(entries, files, records, current = () => true) {
  const changed = new Set(files);
  const missing = [];
  for (const entry of entries) {
    if (!changed.has(entry.file) || !handedOver(entry)) continue;
    for (const state of entry.states) {
      const name = String(state?.name ?? '').toLowerCase();
      const seen = records.some(
        (r) => r.file === entry.file && String(r.state).toLowerCase() === name && current(r),
      );
      if (!seen) missing.push({ entry, state });
    }
  }
  return missing;
}
