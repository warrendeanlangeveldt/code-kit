// Brownfield code already breaks some layer rules. The baseline records those violations when the kit
// is adopted, so only new ones block; it only ever shrinks (`code-kit baseline` rewrites it from the
// code as it is, and the lead commits it like any other kit change). It also holds each standard's
// breaches the code had when the standard was adopted (spec 30), which `code-kit conform` keeps.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { breachesOf } from './conform.mjs';
import { LANGUAGES, languageOf } from './layers.mjs';

export const BASELINE_FILE = '.claude/code-kit.baseline.json';

/**
 * The languages a baseline's layer violations were taken for. One taken before code-kit read Python, or
 * none at all (a project set up then), was taken for JavaScript and TypeScript alone: a language it
 * wasn't taken for is held to the rules once `code-kit baseline --write` records its violations.
 */
export const languagesOf = (raw) => (Array.isArray(raw?.languages) ? raw.languages : ['js']);

/**
 * { layers: { file: [problem, ...] }, standards: { id: { file: [breach, ...] } }, languages }; empty
 * when there is no baseline.
 */
export function loadBaseline(projectDir) {
  const file = join(projectDir, BASELINE_FILE);
  if (!existsSync(file)) return { layers: {}, standards: {}, languages: languagesOf(null) };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { layers: raw.layers ?? {}, standards: breachesOf(raw), languages: languagesOf(raw) };
  } catch {
    return { layers: {}, standards: {}, languages: LANGUAGES }; // an unreadable baseline excuses nothing
  }
}

/** The baseline written back with what changed; what it held otherwise is kept as it was. */
export function writeBaseline(projectDir, { layers, standards, languages }) {
  const file = join(projectDir, BASELINE_FILE);
  let raw = {};
  try {
    raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    raw = {};
  }
  const body = { ...raw, recordedAt: new Date().toISOString() };
  if (layers) body.layers = layers;
  if (languages) body.languages = languages;
  if (standards) {
    if (Object.keys(standards).length) body.standards = standards;
    else delete body.standards;
  }
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Whether a change to the baseline only takes entries out (a layer violation fixed, a standard's breach
 * fixed, CONF-5): such a change excuses nothing new, so any agent may commit it. Unreadable text on
 * either side isn't.
 */
export function baselineShrinks(beforeText, afterText) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return false;
  }
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  const { recordedAt: _a, layers: la, standards: _sa, ...restAfter } = after;
  const { recordedAt: _b, layers: lb, standards: _sb, ...restBefore } = before;
  if (JSON.stringify(restAfter) !== JSON.stringify(restBefore)) return false;
  for (const [f, problems] of Object.entries(la ?? {}))
    if (!Array.isArray(problems) || problems.some((p) => !(lb?.[f] ?? []).includes(p)))
      return false;
  const was = breachesOf(before);
  for (const [id, files] of Object.entries(breachesOf(after)))
    for (const [f, list] of Object.entries(files))
      if (list.some((b) => !(was[id]?.[f] ?? []).includes(b))) return false;
  return true;
}

/**
 * The problems in `rel` that the baseline doesn't already record. A file in a language the baseline
 * wasn't taken for has none yet: its old violations were never recorded, so the rules hold it once
 * `code-kit baseline --write` records them.
 */
export const newProblems = (rel, problems, baseline) =>
  !(baseline.languages ?? LANGUAGES).includes(languageOf(rel))
    ? []
    : problems.filter((p) => !(baseline.layers[rel] ?? []).includes(p));
