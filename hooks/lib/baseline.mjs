// Brownfield code already breaks some layer rules. The baseline records those violations when the kit
// is adopted, so only new ones block; it only ever shrinks (`code-kit baseline` rewrites it from the
// code as it is, and the lead commits it like any other kit change). It also holds each standard's
// breaches the code had when the standard was adopted (spec 30), which `code-kit conform` keeps.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { breachesOf } from './conform.mjs';

export const BASELINE_FILE = '.claude/code-kit.baseline.json';

/**
 * { layers: { file: [problem, ...] }, standards: { id: { file: [breach, ...] } } }; empty when there is
 * no baseline.
 */
export function loadBaseline(projectDir) {
  const file = join(projectDir, BASELINE_FILE);
  if (!existsSync(file)) return { layers: {}, standards: {} };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { layers: raw.layers ?? {}, standards: breachesOf(raw) };
  } catch {
    return { layers: {}, standards: {} }; // an unreadable baseline excuses nothing
  }
}

/** The baseline written back with what changed; what it held otherwise is kept as it was. */
export function writeBaseline(projectDir, { layers, standards }) {
  const file = join(projectDir, BASELINE_FILE);
  let raw = {};
  try {
    raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    raw = {};
  }
  const body = { ...raw, recordedAt: new Date().toISOString() };
  if (layers) body.layers = layers;
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

/** The problems in `rel` that the baseline doesn't already record. */
export const newProblems = (rel, problems, baseline) =>
  problems.filter((p) => !(baseline.layers[rel] ?? []).includes(p));
