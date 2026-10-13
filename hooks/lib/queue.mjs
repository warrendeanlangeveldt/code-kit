// The merge queue (docs/specs/09-merge-queue.md): branches that passed the lead's review, merged one at
// a time in the order they passed, each verified against the base as it is then. Kept in the main
// checkout, beside the requests and reviews, so every worktree and a restarted session see the same.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const QUEUE_FILE = '.claude/state/merge-queue.json';
/** Merged and sent-back entries kept for the pane, newest last. */
const DONE_KEPT = 20;

const queueFile = (root) => join(projectWorktrees(root)[0] ?? root, QUEUE_FILE);

/**
 * The queue's entries: [{ branch, commit, passed, state, at?, reason? }], waiting ones in merge order.
 * `commit` is the one the lead's review passed; entries queued before 0.13.0 have none.
 */
export function readQueue(root) {
  try {
    const entries = JSON.parse(readFileSync(queueFile(root), 'utf8'));
    return Array.isArray(entries) ? entries.filter((e) => e && typeof e.branch === 'string') : [];
  } catch {
    return [];
  }
}

function writeQueue(root, entries) {
  const done = entries.filter((e) => !['waiting', 'merging'].includes(e.state));
  const kept = [
    ...done.slice(-DONE_KEPT),
    ...entries.filter((e) => ['waiting', 'merging'].includes(e.state)),
  ];
  const file = queueFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
}

/** The branches still to merge, in order (MQ-1). */
export const waiting = (entries) => entries.filter((e) => ['waiting', 'merging'].includes(e.state));

/**
 * Adds a branch the lead's review passed at `commit`, at the back; a branch already waiting keeps its
 * place, with the commit its latest review passed.
 */
export function enqueue(root, branch, commit, now = Date.now()) {
  const entries = readQueue(root);
  const queued = waiting(entries).find((e) => e.branch === branch);
  if (queued) {
    if (queued.commit === commit) return false;
    writeQueue(
      root,
      entries.map((e) =>
        e === queued ? { ...e, commit, passed: new Date(now).toISOString() } : e,
      ),
    );
    return 'updated';
  }
  writeQueue(root, [
    ...entries.filter((e) => e.branch !== branch),
    { branch, commit, passed: new Date(now).toISOString(), state: 'waiting' },
  ]);
  return true;
}

/** Takes a waiting branch out of the queue. */
export function dequeue(root, branch) {
  const entries = readQueue(root);
  if (!waiting(entries).some((e) => e.branch === branch)) return false;
  writeQueue(
    root,
    entries.filter((e) => !(e.branch === branch && ['waiting', 'merging'].includes(e.state))),
  );
  return true;
}

/**
 * Sets a waiting branch's state: merging, merged, sent back (with why), moved (it changed after its
 * review, so it's reviewed again), or waiting again.
 */
export function settle(root, branch, state, reason = null, now = Date.now()) {
  const entries = readQueue(root).map((e) =>
    e.branch === branch && ['waiting', 'merging'].includes(e.state)
      ? { ...e, state, at: new Date(now).toISOString(), ...(reason ? { reason } : {}) }
      : e,
  );
  // Merged and sent-back entries move behind the waiting ones' history, in the order they settled.
  const settled = entries.filter((e) => e.branch === branch && e.state === state);
  writeQueue(root, [...entries.filter((e) => !settled.includes(e)), ...settled]);
}

/** The branch merged last, for a send-back's reason ("conflicts with main after web/st-4"). */
export function lastMerged(entries) {
  return [...entries].reverse().find((e) => e.state === 'merged')?.branch ?? null;
}
