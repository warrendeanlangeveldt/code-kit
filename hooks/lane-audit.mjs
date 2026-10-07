#!/usr/bin/env node
// PostToolUse (Bash) and part of Stop: shell commands can write files without going through the
// path guard, so after each one every uncommitted change in the worktree is checked against the
// same rules (lib/rules.mjs). Anything the actor may not write is reported for revert.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  APPROVAL_LOG,
  LANE_FILE,
  actorFor,
  actorRoot,
  arrivesWithMerge,
  writeProblem,
} from './lib/rules.mjs';

// The commit hook appends to the approval log and stages it; if that commit then fails, the
// appended lines are left uncommitted. That is the only change to the log that is not a problem.
function appendedOnly(root, rel) {
  const committed = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8' });
  const before = committed.status === 0 ? committed.stdout : '';
  try {
    return readFileSync(join(root, rel), 'utf8').startsWith(before);
  } catch {
    return false; // deleted
  }
}

export function changedFiles(root) {
  const out =
    spawnSync('git', ['-C', root, 'status', '--porcelain', '-uall', '--no-renames'], {
      encoding: 'utf8',
    }).stdout ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((f) => !f.endsWith('/')) // a nested repository or worktree: its changes are its own
    .filter((f) => f !== LANE_FILE);
}

export function auditProblems(input, config) {
  const root = actorRoot(input);
  if (!root) return [];
  const actor = actorFor(input, root, config);
  return (
    changedFiles(root)
      .filter((rel) => !(rel === APPROVAL_LOG && appendedOnly(root, rel)))
      // Mid-merge, the incoming branch's changes are its own, not this actor's writes.
      .filter((rel) => !arrivesWithMerge(root, rel))
      .map((rel) => [rel, writeProblem(actor, rel, root, config)])
      .filter(([, problem]) => problem)
      .map(([rel, problem]) => `${rel}: ${problem.split('\n')[0]}`)
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { block, start } = await import('./lib/hook.mjs');
  const { input, config, error } = start();
  if (error) process.exit(0); // guard-paths and stop-check report an invalid config
  const problems = auditProblems(input, config);
  if (problems.length) {
    block(
      `These uncommitted changes break the ownership rules (.claude/code-kit.json). Revert them ` +
        `(git checkout -- <file>, or delete new files) and do the work the permitted way:\n  ${problems.join('\n  ')}`,
    );
  }
  process.exit(0);
}
