// The project's worktrees, and taking away the ones that are done (docs/specs/20-lean-lead.md, LEAN-6 and
// LEAN-8). Every lane agent works in a worktree of its own, each with its own install, so a project that
// merges a few stories a day gains a gigabyte or more of checkouts a day unless they go as their work
// merges. A worktree goes once its branch's own commits are merged and it holds nothing uncommitted, and
// no agent is still at work in it; one that's merged but still holds changes is the person's to decide,
// and what it held is kept as a patch. code-kit's own leftovers go too: a temporary merge checkout an
// interrupted merge left, a worktree whose folder is gone, and folders under .claude/worktrees git no
// longer knows.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pruneLogs, readEvents, stopped } from './events.mjs';
import { sessions } from './sessions.mjs';
import { laneClaims } from './laneclaims.mjs';
import { storyOfBranch } from './teamfacts.mjs';
import { CHECKOUTS_DIR } from './checkout.mjs';
import { matchesAny } from './glob.mjs';

export const WORKTREES_DIR = '.claude/worktrees';
export const DISCARDED_DIR = '.claude/state/discarded';
/** A temporary merge checkout this old belongs to a merge that didn't finish. */
export const TEMP_MERGE_MS = 30 * 60_000;
const TEMP_MERGE = /^code-kit-merge-/;
// A temporary checkout made beside the kept ones while another run holds the kept one.
const TEMP_CHECKOUT = /^code-kit-(merge|fix)-/;

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
/** The folder this process runs in, or null when it has gone. */
const cwdNow = () => {
  try {
    return real(process.cwd());
  } catch {
    return null;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * The base branch's refs a worktree's branch is merged into: the first protected branch here and on its
 * remote, each that exists. A local base can fall weeks behind the remote's where the base only moves
 * through pull requests, so a branch merged into either counts as merged.
 */
export function baseRefs(root, config) {
  const name = config.branches?.protected?.[0];
  if (!name) return [];
  return [name, `origin/${name}`].filter(
    (r) => git(root, 'rev-parse', '--verify', '--quiet', r).status === 0,
  );
}

/**
 * Whether the branch has commits of its own: a branch made from the base for an agent just dispatched
 * is contained in the base too, but its work hasn't started, let alone merged (code-kit issue #61).
 */
function hasOwnCommits(root, branch) {
  const log = git(root, 'reflog', 'show', '--format=%gs', `refs/heads/${branch}`);
  if (log.status !== 0 || !log.stdout.trim()) return true; // no reflog: judged by the base alone
  return log.stdout
    .trim()
    .split('\n')
    .some((l) => !/^branch: Created from /.test(l));
}

/**
 * LEAN-6: each worktree but the main checkout: { path, branch, story, merged, clean, changes, report,
 * kind, missing, locked: { reason, pid, live } | null, agentAtWork, here }. `here`: this command runs in
 * it (`cwd`, the process's own folder unless given), so taking it away would leave the shell nowhere. `kind` is `agent` (under
 * .claude/worktrees), `merge` (a temporary merge checkout) or `other` (one the person made). `clean` and
 * `changes` are null where they weren't read: an unmerged worktree stays whatever it holds (cleanOf reads it).
 */
export function worktrees(root, config, now = Date.now(), cwd = cwdNow()) {
  const list = git(root, 'worktree', 'list', '--porcelain');
  if (list.status !== 0) return [];
  const main = list.stdout.split('\n\n')[0];
  const mainPath = /^worktree (.+)$/m.exec(main)?.[1] ?? root;
  const from = baseRefs(root, config);
  const claims = laneClaims(mainPath, now).filter((c) => !c.stale);
  const agents = real(join(mainPath, WORKTREES_DIR));
  const temp = real(tmpdir());
  return list.stdout
    .split('\n\n')
    .filter(Boolean)
    .slice(1)
    .map((block) => {
      const path = /^worktree (.+)$/m.exec(block)?.[1];
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
      const lockLine = /^locked(?: (.*))?$/m.exec(block);
      const pid = Number(/\bpid (\d+)/.exec(lockLine?.[1] ?? '')?.[1]) || null;
      const missing = !existsSync(path);
      const where = real(path);
      const here = Boolean(cwd && (cwd === where || cwd.startsWith(`${where}/`)));
      const kind = where.startsWith(`${agents}/`)
        ? // LEAN-10: a lane's own worktree, reused by each of its stories (lanetrees.mjs).
          /^lane-/.test(basename(path))
          ? 'lane'
          : 'agent'
        : // MQ-9: code-kit's kept checkout, reused by each merge with its installs.
          where.startsWith(`${real(CHECKOUTS_DIR)}/`) && !TEMP_CHECKOUT.test(basename(path))
          ? 'kept'
          : where.startsWith(`${temp}/`) && TEMP_MERGE.test(basename(path))
            ? 'merge'
            : 'other';
      const story = branch ? storyOfBranch(branch) : null;
      const merged = Boolean(
        branch &&
        from.some(
          (ref) =>
            spawnSync('git', ['merge-base', '--is-ancestor', branch, ref], { cwd: root }).status ===
            0,
        ) &&
        hasOwnCommits(root, branch),
      );
      // Read only where it decides anything: an unmerged worktree stays whatever it holds.
      const status =
        missing || (!merged && kind !== 'other') ? null : git(path, 'status', '--porcelain');
      // LEAN-9: a tool's own records (an adapter's anyActor files, written at each turn's end) are no
      // one's work in progress: they're kept as a patch when the worktree goes, and don't keep it.
      const lines = status?.status === 0 ? status.stdout.split('\n').filter(Boolean) : null;
      const recordsOnly = (l) =>
        l
          .slice(3)
          .split(' -> ')
          .every((f) => matchesAny(f.replace(/^"|"$/g, ''), config?.anyActor ?? []));
      const changes = lines ? lines.filter((l) => !recordsOnly(l)).length : null;
      const records = lines ? lines.filter(recordsOnly).length : 0;
      const lane = branch?.includes('/') ? branch.split('/')[0] : null;
      const report = branch ? `.claude/state/reports/${branch.replace(/[^\w.-]+/g, '_')}.md` : null;
      return {
        path,
        branch,
        story,
        kind,
        missing,
        merged,
        clean: changes === null ? null : changes === 0 && records === 0,
        changes,
        records,
        // What it holds, as git status words it: the first ten.
        files: status?.status === 0 ? status.stdout.split('\n').filter(Boolean).slice(0, 10) : [],
        report: report && !missing && existsSync(join(path, report)) ? report : null,
        locked: lockLine
          ? { reason: lockLine[1] ?? null, pid, live: pid ? alive(pid) : true }
          : null,
        // A lane's agent still holds its claim on this story: it may yet commit here.
        agentAtWork: Boolean(
          lane && claims.some((c) => c.lane === lane && (c.story ?? null) === (story ?? c.story)),
        ),
        age: missing ? null : now - statSync(path).mtimeMs,
        here,
      };
    });
}

/** LEAN-6: how recently a lane agent's act counts as it still being at work on a story. */
export const BUSY_MS = 3 * 60_000;

/**
 * LEAN-6: whether a lane agent is still at work on a worktree's story, by the story's event log (spec
 * 26): its lane's last act is still open (and its agent hasn't stopped), or came within BUSY_MS, with no
 * hand-back or stop after it. Releasing
 * a worktree under a running agent takes its git away mid-step. Only the branch's own lane counts: the
 * lead's helpers (a reviewer, a security reviewer) act on the story too, but never commit on its branch.
 */
export function agentBusy(root, w, config = {}, now = Date.now()) {
  if (!w.story || !w.branch?.includes('/')) return false;
  const lane = w.branch.split('/')[0];
  const events = readEvents(root, w.story);
  const last = events.filter((e) => e.actor === lane && e.agent).at(-1);
  if (!last || ['handback', 'stopped'].includes(last.kind)) return false;
  if (last.phase !== 'start') return now - Date.parse(last.at) < BUSY_MS;
  // An act still open: its agent is at work, unless it was stopped mid-call and the act left open for good.
  // That's settled as reconcile settles it: code-kit reconciled the act, or its session ended, it handed
  // back, or it's older than the stall restart (DUR-4, LOOP-3).
  if (last.act && events.some((e) => e.kind === 'reconciled' && e.target === last.act))
    return false;
  const liveSessions = new Set(
    sessions(root, now)
      .filter((s) => s.live)
      .map((s) => s.id),
  );
  const restartMs = (config.harness?.stall?.restartMinutes ?? 10) * 60_000;
  return !stopped(last, events, { liveSessions, restartMs, now });
}

/** Whether a worktree holds nothing uncommitted, read now where worktrees() didn't. */
export function cleanOf(w) {
  if (w.clean !== null) return w.clean;
  if (w.missing) return true;
  const status = git(w.path, 'status', '--porcelain');
  return status.status === 0 && !status.stdout.trim();
}

/** Why a worktree stays, in words, or null when it's done with and can go. */
export function keptBecause(w) {
  if (w.missing) return null;
  if (w.kind === 'merge') return w.age < TEMP_MERGE_MS ? 'a merge may be using it now' : null;
  if (w.kind === 'lane')
    return `it's the ${basename(w.path).slice(5)} lane's worktree, kept with its installs for the lane's next story`;
  if (w.kind === 'kept')
    return "it's code-kit's own checkout for merges and fix checks, kept with its installs so each one doesn't copy them again";
  if (w.kind === 'other') return "it isn't one code-kit made; release it by name if it's done";
  // A merge run from inside a lane's worktree mustn't take away the folder its own shell is in.
  if (w.here)
    return 'this command runs in it; it goes at the next merge or `code-kit worktrees prune` run from elsewhere';
  if (w.locked && !w.locked.pid)
    return `it's locked${w.locked.reason ? ` (${w.locked.reason})` : ''}`;
  if (!w.branch) return 'it has no branch checked out';
  if (!w.merged) return "its branch isn't merged";
  if (w.agentAtWork) return "its lane's agent is still at work on it";
  if (!w.clean && w.changes > 0)
    return `it's merged, but holds ${w.changes} uncommitted change${w.changes === 1 ? '' : 's'}`;
  return null;
}

/** Folders under .claude/worktrees that no worktree is registered at: what a removal left behind. */
export function strayFolders(root, list) {
  const dir = join(root, WORKTREES_DIR);
  let names = [];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const known = new Set(list.map((w) => real(w.path)));
  return names
    .map((n) => join(dir, n))
    .filter((p) => !known.has(real(p)) && !existsSync(join(p, '.git')));
}

/**
 * A worktree's report moved to the main checkout, so the next agent on its story still reads it, and its
 * spec-check report, so that agent can carry on writing code on the branch (#55).
 */
function keepReport(root, w) {
  const keep = (rel) => {
    if (!rel || !existsSync(join(w.path, rel))) return;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(w.path, rel), join(root, rel));
  };
  keep(w.report);
  if (w.branch) keep(`.claude/state/spec-check/${w.branch.replace(/[^\w.-]+/g, '_')}.md`);
}

/**
 * Removes one worktree, its report kept and its branch left. A lock held by Claude Code for an agent
 * that has finished (its lane's claim on the story ended) doesn't keep it: `force` removes it anyway.
 */
export function removeWorktree(root, w, { force = false } = {}) {
  if (w.missing) return { ok: true };
  // LEAN-10: a lane's worktree stays for its next story: it only lets go of the branch.
  if (w.kind === 'lane') {
    keepReport(root, w);
    const freed = git(w.path, 'switch', '--quiet', '--detach');
    return freed.status === 0 ? { ok: true } : { ok: false, why: freed.stderr.trim() };
  }
  keepReport(root, w);
  const locked = Boolean(w.locked);
  const args = [
    'worktree',
    'remove',
    ...(force || locked ? ['--force'] : []),
    ...(locked ? ['--force'] : []),
    w.path,
  ];
  const removed = git(root, ...args);
  return removed.status === 0 ? { ok: true } : { ok: false, why: removed.stderr.trim() };
}

/**
 * LEAN-8: takes away every worktree that's done with (keptBecause is null), git's records of worktrees
 * whose folders are gone, and the stray folders. Returns { removed: [label], kept: [{ label, why }] }.
 */
export function pruneWorktrees(root, config, now = Date.now()) {
  const list = worktrees(root, config, now);
  const removed = [];
  const kept = [];
  for (const w of list) {
    const label = w.branch ?? w.path;
    const why = keptBecause(w);
    // LEAN-10: a lane's worktree stays; once its story is merged and it holds nothing, it lets go of the
    // branch, so the branch can be checked out elsewhere and the lane's next agent starts clean.
    if (w.kind === 'lane' && w.branch && w.merged && w.changes === 0 && !w.agentAtWork && !w.here) {
      if (w.records > 0) {
        keepAsPatch(root, w, now);
        git(w.path, 'reset', '--hard', '--quiet');
      }
      keepReport(root, w);
      git(w.path, 'switch', '--quiet', '--detach');
    }
    if (why) {
      kept.push({
        label,
        why,
        branch: w.branch,
        changes: w.changes,
        kind: w.kind,
        here: w.here,
        merged: w.merged,
      });
      continue;
    }
    if (w.missing) continue;
    // LEAN-9: a tool's records it holds are kept as a patch first, as a discard keeps what it held.
    const patch = w.records > 0 ? keepAsPatch(root, w, now) : null;
    const r = removeWorktree(root, w, { force: w.kind === 'merge' || Boolean(patch) });
    if (r.ok)
      removed.push(
        `${label}${w.report ? ` (its report kept at ${w.report})` : ''}${patch ? ` (the tool records it held kept as ${patch})` : ''}`,
      );
    else
      kept.push({
        label,
        why: `git wouldn't remove it: ${r.why.split('\n')[0]}`,
        branch: w.branch,
      });
  }
  if (list.some((w) => w.missing)) {
    git(root, 'worktree', 'prune');
    for (const w of list.filter((x) => x.missing))
      removed.push(`${w.branch ?? w.path} (its folder was gone)`);
  }
  for (const p of strayFolders(root, list)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(`${p.slice(root.length + 1)} (left behind, not a worktree)`);
  }
  // DUR-6: the event logs of stories merged more than 30 days ago go with them.
  for (const base of baseRefs(root, config))
    for (const story of pruneLogs(root, { base, now })) removed.push(`${story}'s event log`);
  return { removed, kept };
}

/** What a worktree holds uncommitted, kept as a patch under .claude/state/discarded: its path there. */
export function keepAsPatch(root, w, now) {
  git(w.path, 'add', '-A');
  const diff = spawnSync('git', ['-C', w.path, 'diff', '--cached', '--binary', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const patch = join(
    DISCARDED_DIR,
    `${(w.branch ?? basename(w.path)).replace(/[^\w.-]+/g, '_')}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.patch`,
  );
  mkdirSync(join(root, DISCARDED_DIR), { recursive: true });
  writeFileSync(join(root, patch), diff.stdout ?? '');
  return patch;
}

/**
 * LEAN-8: the person discards a merged worktree that still holds changes. What it held is kept first,
 * as a patch under .claude/state/discarded, with the files nobody had added; then it goes.
 */
export function discardWorktree(root, config, branch, now = Date.now()) {
  const w = worktrees(root, config, now).find((x) => x.branch === branch || x.path === branch);
  if (!w) return { ok: false, why: `No worktree has ${branch} checked out.` };
  if (!w.merged)
    return {
      ok: false,
      why: `${branch} isn't merged, so its worktree is work in progress: release it once it's committed.`,
    };
  if (w.agentAtWork)
    return {
      ok: false,
      why: `The ${branch.split('/')[0]} lane's agent is still at work on ${branch}.`,
    };
  const patch = w.clean ? null : keepAsPatch(root, w, now);
  const r = removeWorktree(root, w, { force: true });
  if (!r.ok) return { ok: false, why: `git wouldn't remove it: ${r.why.split('\n')[0]}` };
  return { ok: true, patch, report: w.report };
}
