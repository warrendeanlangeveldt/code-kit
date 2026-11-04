// LEAN-10: one worktree per lane, reused by each story the lane builds, with its installs. Claude Code makes
// a worktree for every agent it starts with `isolation: "worktree"`, and a project's installs in each are
// gigabytes; a lane runs one story at a time (SCHED-1), so one worktree per lane is enough. code-kit's
// WorktreeCreate hook gives a lane agent its lane's worktree instead of a new one. The hook is told only
// the worktree's name, not whose it is, so guard-agent notes the lane as the agent starts (PreToolUse),
// and the hook takes the note: one lane agent starts at a time, so the note is never another's.
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { WORKTREES_DIR, keepAsPatch } from './worktrees.mjs';

/** The lane whose agent starts next, noted by guard-agent for the WorktreeCreate hook. */
export const NEXT_FILE = '.claude/state/lane-worktree-next.json';
/** How long a note waits for its worktree: Claude Code makes it within a second or two of the call. */
export const NEXT_MS = 20_000;

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The project's main checkout, from any folder in it or its worktrees. */
export function mainCheckout(dir) {
  const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return common.status === 0 ? dirname(common.stdout.trim()) : null;
}

/** A lane's worktree: `.claude/worktrees/lane-<lane>` in the main checkout. */
export const laneTreePath = (main, lane) => join(main, WORKTREES_DIR, `lane-${lane}`);

/** The note, while it's fresh: { lane, story, at }, or null. */
export function nextLane(main, now = Date.now()) {
  try {
    const n = JSON.parse(readFileSync(join(main, NEXT_FILE), 'utf8'));
    return now - Date.parse(n.at) < NEXT_MS ? n : null;
  } catch {
    return null;
  }
}

/**
 * Notes the lane whose agent starts next, unless another agent's note is still waiting for its worktree:
 * true when noted. Made only where there's none, so of two agents started at once only one is noted.
 */
export function noteNextLane(main, { lane, story }, now = Date.now()) {
  const file = join(main, NEXT_FILE);
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, JSON.stringify({ lane, story, at: new Date(now).toISOString() }));
      closeSync(fd);
      return true;
    } catch {
      if (nextLane(main, now)) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

/** Takes back a note whose agent didn't start. */
export const dropNextLane = (main) => rmSync(join(main, NEXT_FILE), { force: true });

/** Takes the note: the lane whose agent this worktree is for, or null. */
export function takeNextLane(main, now = Date.now()) {
  const n = nextLane(main, now);
  rmSync(join(main, NEXT_FILE), { force: true });
  return n;
}

const registered = (main, dir) =>
  git(main, 'worktree', 'list', '--porcelain')
    .stdout.split('\n')
    .some((l) => l.startsWith('worktree ') && real(l.slice(9)) === real(dir));

/**
 * Copies the files `.worktreeinclude` names (ignored files such as `.env`) from the main checkout into a
 * new worktree, as Claude Code does for the worktrees it makes itself, which a WorktreeCreate hook replaces.
 */
export function copyIncluded(main, dir) {
  if (!existsSync(join(main, '.worktreeinclude'))) return;
  const files = git(
    main,
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-from=.worktreeinclude',
  ).stdout.split('\n');
  for (const f of files.filter(Boolean)) {
    if (existsSync(join(dir, f))) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), readFileSync(join(main, f)));
  }
}

/**
 * The lane's worktree, ready for its next agent: made the first time; after that, the same folder with its
 * installs, its last story's records kept as a patch (an adapter's anyActor files, which a tool writes at
 * each turn's end) and put back, and HEAD detached at the main checkout's, so the agent makes or switches
 * to its story's branch as its brief says. Null where the last agent left work uncommitted: the agent then
 * gets a worktree of its own, as before, and the lane's stays as it was.
 */
export function laneTree(main, lane, config, now = Date.now()) {
  const dir = laneTreePath(main, lane);
  const head = git(main, 'rev-parse', 'HEAD').stdout.trim();
  if (!existsSync(dir) || !registered(main, dir)) {
    rmSync(dir, { recursive: true, force: true });
    git(main, 'worktree', 'prune');
    if (git(main, 'worktree', 'add', '--quiet', '--detach', dir, head).status !== 0) return null;
    copyIncluded(main, dir);
    return dir;
  }
  const status = git(dir, 'status', '--porcelain');
  if (status.status !== 0) return null;
  const lines = status.stdout.split('\n').filter(Boolean);
  const records = (l) =>
    l
      .slice(3)
      .split(' -> ')
      .every((f) => matchesAny(f.replace(/^"|"$/g, ''), config?.anyActor ?? []));
  if (lines.some((l) => !records(l))) return null;
  if (lines.length) {
    const branch = git(dir, 'branch', '--show-current').stdout.trim() || null;
    keepAsPatch(main, { path: dir, branch: branch ?? `lane-${lane}` }, now);
    git(dir, 'reset', '--hard', '--quiet');
    git(dir, 'clean', '-fdq');
  }
  if (git(dir, 'switch', '--quiet', '--detach', head).status !== 0) return null;
  return dir;
}

/**
 * The worktree Claude Code would make itself: `.claude/worktrees/<name>` on a new branch
 * `worktree-<name>`, from the remote's default branch where there is one, else HEAD.
 */
export function plainTree(main, name) {
  const dir = join(main, WORKTREES_DIR, name);
  const remote = git(main, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD');
  const from = remote.status === 0 ? remote.stdout.trim() : 'HEAD';
  const made = git(main, 'worktree', 'add', '--quiet', '-b', `worktree-${name}`, dir, from);
  if (made.status !== 0) return null;
  copyIncluded(main, dir);
  return dir;
}
