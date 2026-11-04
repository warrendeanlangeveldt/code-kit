// The merge queue (docs/specs/09-merge-queue.md): branches that passed the lead's review, merged one at
// a time in the order they passed, each verified against the base as it is then. Kept in the main
// checkout, beside the requests and reviews, so every worktree and a restarted session see the same.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  const entries = readQueue(root).map((e) => {
    if (e.branch !== branch || !['waiting', 'merging'].includes(e.state)) return e;
    // The merge that settled it is over: its process no longer marks the entry.
    const { pid: _pid, ...rest } = e;
    return { ...rest, state, at: new Date(now).toISOString(), ...(reason ? { reason } : {}) };
  });
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

/**
 * MQ-7: what the queue merges next. A branch queued `with` others merges only together with them, once
 * each is queued too: verified as one tree, merged one after another. Until then it waits, and the
 * queue goes on with the next. HUBR-9: a branch the team provider's drift findings hold (`drift`,
 * Map(branch → findings), from `driftHolds`) waits too, with its group, until they clear. MQ-8: so does
 * a branch whose story the lead holds (`deferred`, Map(branch → hold), from `activeDeferrals`). `{ head,
 * partners, held, drifting, deferred }`: `head` null when nothing can merge yet; `held` lists each
 * waiting branch with the partners it still needs queued; `drifting` each one waiting on findings,
 * with them; `deferred` each one whose group holds a held story, with that hold.
 */
export function nextToMerge(entries, drift = new Map(), deferredBy = new Map()) {
  const queue = waiting(entries);
  const queued = new Set(queue.map((e) => e.branch));
  // A partner already merged on its own is no longer waited for.
  const merged = new Set(entries.filter((e) => e.state === 'merged').map((e) => e.branch));
  const groupOf = (e) => {
    const group = new Set([e.branch]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of queue)
        if (
          !group.has(x.branch) &&
          ((x.with ?? []).some((b) => group.has(b)) ||
            [...group].some((b) =>
              (queue.find((y) => y.branch === b)?.with ?? []).includes(x.branch),
            ))
        ) {
          group.add(x.branch);
          grew = true;
        }
    }
    return group;
  };
  const held = [];
  const drifting = [];
  const deferred = [];
  let head = null;
  let partners = [];
  for (const e of queue) {
    const group = groupOf(e);
    // A group lands as one, so a finding on any of its branches holds them all.
    const findings = [...group].flatMap((b) => drift.get(b) ?? []);
    if (findings.length) drifting.push({ branch: e.branch, findings });
    const hold = [...group].map((b) => deferredBy.get(b)).find(Boolean);
    if (hold) deferred.push({ branch: e.branch, hold });
    if (head || hold) continue;
    const missing = [...group]
      .flatMap((b) => queue.find((y) => y.branch === b)?.with ?? [])
      .filter((b) => !queued.has(b) && !merged.has(b));
    if (missing.length) {
      held.push({ branch: e.branch, missing: [...new Set(missing)] });
      continue;
    }
    if (findings.length) continue;
    head = e;
    partners = queue.filter((x) => x.branch !== e.branch && group.has(x.branch));
  }
  return { head, partners, held, drifting, deferred };
}

export const PAUSE_FILE = '.claude/state/merge-queue-paused.json';

const pauseFile = (root) => join(projectWorktrees(root)[0] ?? root, PAUSE_FILE);

/**
 * MQ-8: the lead's deliberate pause of the whole queue, { reason, at, session } or null: while it's
 * paused, the queue merges nothing and nothing offers a merge; branches are still queued.
 */
export function queuePause(root) {
  try {
    const p = JSON.parse(readFileSync(pauseFile(root), 'utf8'));
    return p && typeof p.reason === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** MQ-8: pauses the queue with why; a pause already in force takes the new reason. */
export function pauseQueue(root, reason, session = null, now = Date.now()) {
  const file = pauseFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const pause = { reason, at: new Date(now).toISOString(), ...(session ? { session } : {}) };
  writeFileSync(file, `${JSON.stringify(pause, null, 2)}\n`);
  return pause;
}

/** MQ-8: lets the queue merge again; the pause it ended, or null when it wasn't paused. */
export function resumeQueue(root) {
  const was = queuePause(root);
  if (was) rmSync(pauseFile(root), { force: true });
  return was;
}

/** MQ-7: a queued branch's partners, which it merges together with. */
export function setPartners(root, branch, partners) {
  writeQueue(
    root,
    readQueue(root).map((e) =>
      e.branch === branch && ['waiting', 'merging'].includes(e.state)
        ? { ...e, with: [...new Set([...(e.with ?? []), ...partners])] }
        : e,
    ),
  );
}

/** The branch merged last, for a send-back's reason ("conflicts with main after web/st-4"). */
export function lastMerged(entries) {
  return [...entries].reverse().find((e) => e.state === 'merged')?.branch ?? null;
}

/** A ref as a local branch's name: `origin/web/st-4` → `web/st-4`; others as they are. */
const local = (ref) => ref.replace(/^[\w.-]+\/(?=[^/]+\/[^/]+$)/, '');

/**
 * Each git command in `cmd`, with the branch it acts on: the one a `git switch` or `git checkout` earlier
 * in the command moves to (`-c`, `-b` and the like: the branch it makes), else `branch`, the one checked
 * out. [{ text, code, on, moved }], `moved` where a switch or a `cd` took it off `branch`. With `at`, a
 * `cd` in the command, or a command's own `git -C dir`, moves to another checkout: `at.branchAt(dir)` is
 * the branch checked out there, null where nothing lands on a branch of this project (another
 * repository, a detached HEAD), or undefined where there's no such folder; a worktree the command adds is
 * on the branch it names, or none with --detach.
 */
export function gitSteps(cmd, branch, at = null) {
  const steps = [];
  let on = branch;
  let moved = false;
  let cwd = at?.cwd ?? null;
  const vars = new Map();
  const added = new Map();
  const switches = new RegExp(
    String.raw`^${GIT}(?:switch|checkout)\s+((?:-(?!-\s)\S+\s+)*)([^\s-]\S*)\s*$`,
  );
  const creates = new RegExp(
    String.raw`^${GIT}(?:switch\s+(?:-\S+\s+)*(?:-[cC]|--create|--force-create)|checkout\s+(?:-\S+\s+)*-[bB])\s+([^\s-]\S*)`,
  );
  const detaches = new RegExp(String.raw`^${GIT}(?:switch|checkout)\s+(?:-\S+\s+)*--detach\b`);
  const worktreeAdd = new RegExp(String.raw`^${GIT}worktree\s+add\s+(.*)$`);
  const expand = (w) =>
    w
      .replace(/^["']|["']$/g, '')
      .replace(/\$\{?(\w+)\}?/g, (m, n) => (vars.has(n) ? vars.get(n) : m));
  const branchIn = (dir) => (added.has(dir) ? added.get(dir) : at.branchAt(dir));
  for (const { text, code } of commandsOf(cmd)) {
    const assigned = text.match(/^\s*(\w+)=("[^"]*"|'[^']*'|[^\s;&|]+)\s*$/);
    if (assigned) {
      vars.set(assigned[1], expand(assigned[2]));
      continue;
    }
    const cd = at && text.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*$/);
    if (cd) {
      const dir = expand(cd[1]);
      if (/\$/.test(dir)) continue; // a variable it can't read: the branch stays the one it knows
      cwd = resolve(cwd, dir);
      // A folder that isn't there leaves the shell where it was (`cd x; git merge …` merges here).
      const there = branchIn(cwd);
      if (there !== undefined) [on, moved] = [there, true];
      continue;
    }
    if (!/^git\b/.test(code)) continue;
    // `git -C dir …` acts there, for that command alone.
    const elsewhere = at && text.match(/^git\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
    const there =
      elsewhere && !/\$/.test(expand(elsewhere[1]))
        ? branchIn(resolve(cwd, expand(elsewhere[1])))
        : undefined;
    const here = there === undefined ? on : there;
    const made = code.match(creates);
    const switched = !made && code.match(switches);
    if (code.match(detaches)) {
      if (there === undefined) [on, moved] = [null, true];
      continue;
    }
    if (made || switched) {
      if (there === undefined) [on, moved] = [(made ?? switched)[made ? 1 : 2], true];
      continue;
    }
    const add = at && text.match(worktreeAdd);
    if (add) {
      // git worktree add [-b <new>] [--detach] <path> [<commit-ish>]
      const words = add[1].trim().split(/\s+/);
      let name = null;
      let detach = false;
      const rest = [];
      for (let i = 0; i < words.length; i++) {
        if (words[i] === '-b' || words[i] === '-B') name = words[++i];
        else if (words[i] === '--detach') detach = true;
        else if (!words[i].startsWith('-')) rest.push(words[i]);
      }
      if (rest[0])
        added.set(resolve(cwd, expand(rest[0])), detach ? null : (name ?? rest[1] ?? null));
      continue;
    }
    steps.push({ text, code, on: here, moved: moved || there !== undefined });
  }
  return steps;
}

/** What `cmd` writes to a branch's history with git (a commit, merge, rebase, cherry-pick, revert or am), each with the branch it lands on. */
export function historyWrites(cmd, branch, at = null) {
  const writes = new RegExp(
    String.raw`^${GIT}(commit|merge|cherry-pick|rebase|revert|am)(?![\w-])`,
  );
  return gitSteps(cmd, branch, at)
    .filter((s) => writes.test(s.code))
    .map(({ code, on, moved }) => ({ verb: code.match(writes)[1], on, moved }));
}

/**
 * MQ-5: the story branches `cmd` merges with git, each with the branch it lands on (see gitSteps).
 * [{ story: 'web/st-4', into: 'lead/next' }]. A merge that lands on no branch is left out: nobody's
 * branch takes the story.
 */
export function storyMerges(cmd, branch, at = null) {
  const found = [];
  const merges = new RegExp(String.raw`^${GIT}merge(?![\w-])(.*)$`);
  for (const { text, code, on } of gitSteps(cmd, branch, at)) {
    const merged = code.match(merges);
    if (!merged || on === null) continue;
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
