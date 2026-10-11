// Whether the person has paused the lead loop (spec 05, LOOP-6), kept beside the merge queue so other
// tools sharing the project can hold their own background work while it's paused. The mod records it
// through the CLI; a session that starts begins unpaused.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const LOOP_FILE = '.claude/state/loop.json';

const loopFile = (root) => join(projectWorktrees(root)[0] ?? root, LOOP_FILE);

/** { paused, at }: not paused when nothing was recorded. */
export function readLoop(root) {
  try {
    const state = JSON.parse(readFileSync(loopFile(root), 'utf8'));
    return { paused: state?.paused === true, at: state?.at ?? null };
  } catch {
    return { paused: false, at: null };
  }
}

export function writeLoop(root, paused, now = Date.now()) {
  const file = loopFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ paused, at: new Date(now).toISOString() })}\n`);
}
