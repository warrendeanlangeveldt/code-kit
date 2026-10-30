// The merge queue (docs/specs/09-merge-queue.md): branches that passed the lead's review, merged one at
// a time in the order they passed, each verified against the base as it is then. Kept in the main
// checkout, beside the requests and reviews, so every worktree and a restarted session see the same.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';
import { GIT, commandsOf } from './shell.mjs';
import { storyOfBranch } from './teamfacts.mjs';

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

/**
 * MQ-1: the head being merged by a running `queue merge` (process `pid`), in its place; `null` puts it
 * back to waiting, in its place too.
 */
export function markMerging(root, branch, pid, now = Date.now()) {
  writeQueue(
    root,
    readQueue(root).map((e) => {
      if (e.branch !== branch || !['waiting', 'merging'].includes(e.state)) return e;
      const { pid: _pid, ...rest } = e;
      return pid
        ? { ...rest, state: 'merging', pid, at: new Date(now).toISOString() }
        : { ...rest, state: 'waiting' };
    }),
  );
}

/** Whether `entry` is being merged now: marked merging by a process still running. */
export function mergingNow(entry) {
  if (entry?.state !== 'merging' || !entry.pid) return false;
  try {
    process.kill(entry.pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The branch merged last, for a send-back's reason ("conflicts with main after web/st-4"). */
export function lastMerged(entries) {
  return [...entries].reverse().find((e) => e.state === 'merged')?.branch ?? null;
}

/** A ref as a local branch's name: `origin/web/st-4` → `web/st-4`; others as they are. */
const local = (ref) => ref.replace(/^[\w.-]+\/(?=[^/]+\/[^/]+$)/, '');

/**
 * MQ-5: the story branches `cmd` merges with git, each with the branch it lands on: the one a
 * `git switch` or `git checkout` earlier in the command moves to, else `branch`, the one checked out.
 * [{ story: 'web/st-4', into: 'lead/next' }].
 */
export function storyMerges(cmd, branch) {
  const found = [];
  let on = branch;
  const switches = new RegExp(
    String.raw`^${GIT}(?:switch|checkout)\s+((?:-\S+\s+)*)([^\s-]\S*)\s*$`,
  );
  const merges = new RegExp(String.raw`^${GIT}merge(?![\w-])(.*)$`);
  for (const { text, code } of commandsOf(cmd)) {
    const moved = code.match(switches);
    if (moved) {
      on = moved[2];
      continue;
    }
    const merged = code.match(merges);
    if (!merged) continue;
    // Its words as written, found in the masked code, so quoted text (a message) never reads as a branch.
    const from = code.length - merged[1].length;
    for (const w of merged[1].matchAll(/\S+/g)) {
      if (w[0].startsWith('-') || /["']/.test(w[0])) continue;
      const ref = local(text.slice(from + w.index, from + w.index + w[0].length));
      if (storyOfBranch(ref)) found.push({ story: ref, into: on });
    }
  }
  return found;
}
