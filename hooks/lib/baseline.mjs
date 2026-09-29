// Brownfield code already breaks some layer rules. The baseline records those violations when the kit
// is adopted, so only new ones block; it only ever shrinks (`code-kit baseline` rewrites it from the
// code as it is, and the lead commits it like any other kit change).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BASELINE_FILE = '.claude/code-kit.baseline.json';

/** { layers: { file: [problem, ...] } }; empty when there is no baseline. */
export function loadBaseline(projectDir) {
  const file = join(projectDir, BASELINE_FILE);
  if (!existsSync(file)) return { layers: {} };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { layers: raw.layers ?? {} };
  } catch {
    return { layers: {} }; // an unreadable baseline excuses nothing
  }
}

/** The problems in `rel` that the baseline doesn't already record. */
export const newProblems = (rel, problems, baseline) =>
  problems.filter((p) => !(baseline.layers[rel] ?? []).includes(p));
