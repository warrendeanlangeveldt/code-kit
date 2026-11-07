// A fresh checkout of the project, for checks that mustn't run in anyone's worktree: the merge queue's
// verify of a branch merged with the base as it is now (MQ-1), and the fix check's tree with the fix
// taken out (REG-1). It's a temporary worktree with its own copy of the installs (node_modules and
// the like): a link back to a worktree's installs resolves outside the checkout, which path-sensitive
// tools refuse, and an install run in it would rewrite the worktree's own.
// MQ-9: the checkout is kept between runs, one per project and use, with its installs: copying a
// project's installs in and deleting them again on every merge is millions of files each time, which
// keeps the machine's file-change tracking and search indexing busy. Each run checks out the tree it
// needs, and installs again only where its manifests and lockfiles differ from the ones the kept
// installs were made for. The folder's name ends in .noindex, which Spotlight leaves alone. The OS
// empties old files out of its temporary folder and leaves the folders and links, so a run counts the
// kept installs' files, and copies them again when any have gone.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { isDependencyFile } from './dependencies.mjs';

/** Where the kept checkouts live: in the temporary folder, out of Spotlight's index. */
export const CHECKOUTS_DIR = join(tmpdir(), 'code-kit-checkouts.noindex');

// The folders an install puts beside the code, which a fresh checkout lacks.
const INSTALLS = new Set(['node_modules', '.venv', 'venv']);

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

/** The installs git ignores in `root`, repo-relative, outermost only. */
export function installsOf(root) {
  try {
    return git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory')
      .split('\n')
      .map((l) => l.replace(/\/$/, ''))
      .filter((l) => l && INSTALLS.has(basename(l)));
  } catch {
    return [];
  }
}

/**
 * Copies `root`'s installs into `dir`, each where it sits in `root`, keeping the symlinks inside them
 * as they are. A copy-on-write clone where the filesystem has one (APFS, btrfs, XFS), so it's quick
 * and takes no room; a plain copy elsewhere. What can't be copied is left out, and the check that
 * needs it says what it couldn't run.
 */
export function copyInstalls(root, dir) {
  const clone = platform() === 'darwin' ? ['-c', '-R'] : ['-R', '--reflink=auto'];
  for (const rel of installsOf(root)) {
    const to = join(dir, rel);
    if (!existsSync(dirname(to)) || existsSync(to)) continue;
    const from = join(root, rel);
    const cloned = spawnSync('cp', [...clone, from, to], { stdio: 'ignore' });
    if (cloned.status !== 0) {
      rmSync(to, { recursive: true, force: true, maxRetries: 3 });
      spawnSync('cp', ['-R', from, to], { stdio: 'ignore' });
    }
  }
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The kept checkout for `root` and this use (`prefix`), the project's main checkout's. */
export function keptCheckoutOf(root, prefix) {
  let main = root;
  try {
    main = dirname(real(resolve(root, git(root, 'rev-parse', '--git-common-dir').trim())));
  } catch {
    // not a repository: its own folder names it
  }
  const id = createHash('sha256').update(real(main)).digest('hex').slice(0, 10);
  return join(CHECKOUTS_DIR, `${basename(main)}-${id}-${prefix.replace(/^code-kit-|-$/g, '')}`);
}

/** The manifests and lockfiles the installs in a kept checkout were made for, by content hash. */
const stampOf = (dir) => `${dir}.installs.json`;
function dependencyHashes(dir) {
  const hashes = {};
  for (const f of trackedDependencies(dir)) {
    try {
      hashes[f] = createHash('sha256')
        .update(readFileSync(join(dir, f)))
        .digest('hex');
    } catch {
      hashes[f] = null;
    }
  }
  return hashes;
}

// The files in a kept checkout's installs, and how many there were when they were made. Tools' caches
// come and go on their own, so they don't count. A folder that can't be read counts as empty.
const countOf = (dir) => `${dir}.installs.count`;
function installedFiles(dir) {
  let files = 0;
  for (const rel of installsOf(dir)) {
    try {
      for (const e of readdirSync(join(dir, rel), { recursive: true, withFileTypes: true }))
        if (e.isFile() && !/[\\/]\.cache(?:[\\/]|$)/.test(e.parentPath)) files++;
    } catch {
      // gone while being read: fewer files, so it's copied again
    }
  }
  return files;
}
const recordInstalled = (dir) => writeFileSync(countOf(dir), String(installedFiles(dir)));
/** Whether a kept checkout's installs have lost files, or lost the records of what they were made for. */
const hollow = (dir) =>
  !existsSync(stampOf(dir)) || !(installedFiles(dir) >= Number(readFileSafe(countOf(dir)) || NaN));

/** Takes the kept checkout's lock for this process, or false while another live process holds it. */
function lock(slot) {
  const file = `${slot}.lock`;
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch {
      const pid = Number(readFileSafe(file));
      let alive = false;
      try {
        alive = pid > 0 && process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (alive) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}
const readFileSafe = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

/** Whether `dir` is one of `root`'s worktrees now. */
const isWorktreeOf = (root, dir) => {
  try {
    return git(root, 'worktree', 'list', '--porcelain')
      .split('\n')
      .some((l) => l.startsWith('worktree ') && real(l.slice(9)) === real(dir));
  } catch {
    return false;
  }
};

/**
 * A worktree of `ref` (detached), with `merge` merged into it when given, and installs that were made
 * for a tree: the project's kept checkout for this use (MQ-9), its installs kept from its last run, or
 * where another run holds that one, a temporary worktree. Installs are copied from `installsFrom` only
 * into a checkout that has none (null copies none). `{ dir, remove }`; a merge that conflicts throws a
 * `conflict` error after putting things back. `remove` never throws: it frees the kept checkout, or
 * takes the temporary one away, leaving a folder that won't go to the OS.
 */
export function freshCheckout(
  root,
  ref,
  { merge = null, installsFrom = root, prefix = 'code-kit-' } = {},
) {
  // Named in the project, not in the kept checkout, where HEAD is the last run's.
  ref = git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim();
  const slot = keptCheckoutOf(root, prefix);
  mkdirSync(CHECKOUTS_DIR, { recursive: true });
  const unlock = lock(slot);
  let dir;
  let remove;
  if (unlock) {
    dir = slot;
    let ready = false;
    if (existsSync(dir) && isWorktreeOf(root, dir)) {
      try {
        // What the last run left (a merge, files a check wrote) goes; the installs stay.
        git(dir, 'reset', '--hard', '--quiet');
        git(dir, 'checkout', '--quiet', '--force', '--detach', ref);
        git(dir, 'clean', '-ffdxq', ...[...INSTALLS].flatMap((i) => ['-e', i]));
        ready = true;
      } catch {
        ready = false;
      }
    }
    if (!ready) {
      try {
        git(root, 'worktree', 'remove', '--force', dir);
      } catch {
        // not registered, or already gone
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(stampOf(dir), { force: true });
      git(root, 'worktree', 'prune');
      git(root, 'worktree', 'add', '--quiet', '--detach', dir, ref);
    }
    remove = () => {
      try {
        git(dir, 'merge', '--abort');
      } catch {
        // no merge in progress
      }
      unlock();
    };
  } else {
    dir = mkdtempSync(join(CHECKOUTS_DIR, prefix));
    rmSync(dir, { recursive: true });
    git(root, 'worktree', 'add', '--quiet', '--detach', dir, ref);
    remove = () => {
      try {
        git(root, 'worktree', 'remove', '--force', dir);
      } catch {
        // git leaves it when a process still writes there; the folder goes, and git prunes its record
      }
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        git(root, 'worktree', 'prune');
      } catch {
        // the OS clears its temporary folder
      }
    };
  }
  if (merge) {
    const merged = spawnSync(
      'git',
      [
        '-C',
        dir,
        '-c',
        'user.name=code-kit',
        '-c',
        'user.email=code-kit@localhost',
        'merge',
        '--no-ff',
        '--no-edit',
        '--quiet',
        merge,
      ],
      { encoding: 'utf8' },
    );
    if (merged.status !== 0) {
      const why = `${merged.stdout ?? ''}${merged.stderr ?? ''}`.trim();
      remove();
      throw Object.assign(new Error(why || 'the merge conflicts'), { conflict: true });
    }
  }
  // MQ-9: the OS took files out of the kept installs: they can't be trusted, so they're copied again.
  // What they're copied from may be behind the base by now, so the stamp names nothing, and the
  // project's install runs over the copy for this tree.
  const emptied = installsFrom && dir === slot && installsOf(dir).length > 0 && hollow(dir);
  if (emptied)
    for (const rel of installsOf(dir)) rmSync(join(dir, rel), { recursive: true, force: true });
  if (installsFrom && !installsOf(dir).length) {
    copyInstalls(installsFrom, dir);
    // The copied installs were made for installsFrom's manifests and lockfiles.
    if (dir === slot) {
      writeFileSync(stampOf(dir), JSON.stringify(emptied ? {} : dependencyHashes(installsFrom)));
      recordInstalled(dir);
    }
  }
  return { dir, remove };
}

/** The manifests and lockfiles git tracks in `d`. */
function trackedDependencies(d) {
  try {
    return git(d, 'ls-files')
      .split('\n')
      .filter((f) => f && isDependencyFile(f));
  } catch {
    return [];
  }
}

/**
 * The manifests and lockfiles tracked in either checkout whose content differs between the two working
 * trees: where installs copied from `from` may not match the code in `dir`.
 */
export function dependencyDifferences(from, dir) {
  // A kept checkout's installs were made for the files its stamp records, whatever `from` holds now.
  const stamp = readFileSafe(stampOf(dir));
  if (stamp) {
    let made = {};
    try {
      made = JSON.parse(stamp);
    } catch {
      made = {};
    }
    const now = dependencyHashes(dir);
    return [...new Set([...Object.keys(made), ...Object.keys(now)])]
      .filter((f) => (made[f] ?? null) !== (now[f] ?? null))
      .sort();
  }
  const tracked = trackedDependencies;
  const read = (d, f) => {
    try {
      return readFileSync(join(d, f), 'utf8');
    } catch {
      return null;
    }
  };
  return [...new Set([...tracked(from), ...tracked(dir)])]
    .filter((f) => read(from, f) !== read(dir, f))
    .sort();
}

// The install each lockfile at the top of a checkout calls for, run without changing the lockfile, and
// the manifests and lockfiles of its ecosystem, whose changes it installs.
const JS = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
];
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const INSTALLERS = [
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile --prefer-offline', JS],
  ['package-lock.json', 'npm ci --prefer-offline --no-audit --no-fund', JS],
  ['npm-shrinkwrap.json', 'npm ci --prefer-offline --no-audit --no-fund', JS],
  ['yarn.lock', 'yarn install --frozen-lockfile', JS],
  ['bun.lock', 'bun install --frozen-lockfile', [...JS, 'bun.lock']],
  ['bun.lockb', 'bun install --frozen-lockfile', [...JS, 'bun.lockb']],
  ['uv.lock', 'uv sync --frozen', ['pyproject.toml', 'uv.lock']],
];

/**
 * MQ-1: makes the installs in the fresh checkout `dir` match its tree. Installs copied from `from` match
 * only while their manifests and lockfiles are the same: where they differ (the base gained a workspace
 * package since they were installed), the project's install runs in `dir`, never in `from`: `prepare`
 * where the project sets one, else the install its lockfile calls for, when the files that differ are
 * that lockfile's ecosystem's. `{ differ, copied, lockfile, command, failed }`: `differ`, the files that
 * differ; `copied`, whether any installs were copied in; `lockfile`, whether a lockfile code-kit knows
 * is there; `command`, the install run (null when none was needed or none is known); `failed`,
 * { missing, output } when it didn't succeed.
 */
export function matchInstalls(dir, from, { prepare = null, timeout = 900000 } = {}) {
  const differ = dependencyDifferences(from, dir);
  const copied = installsOf(dir).length > 0;
  // Each file that differs is installed by the nearest lockfile of its ecosystem at or above its folder
  // (a service in a subfolder with its own lockfile, a workspace package under the top one's), run there.
  const installs = [];
  for (const f of differ) {
    for (let folder = dirname(f); ; folder = dirname(folder)) {
      const found = INSTALLERS.find(
        ([lock, , files]) => files.includes(basename(f)) && existsSync(join(dir, folder, lock)),
      );
      if (found) {
        const run = folder === '.' ? found[1] : `(cd ${shellQuote(folder)} && ${found[1]})`;
        if (!installs.includes(run)) installs.push(run);
        break;
      }
      if (folder === '.') break;
    }
  }
  const present = INSTALLERS.some(([lock]) => existsSync(join(dir, lock))) || installs.length > 0;
  const command = differ.length ? (prepare ?? (installs.join(' && ') || null)) : null;
  const facts = { differ, copied, lockfile: present };
  if (!command) return { ...facts, command: null, failed: null };
  const res = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout });
  const stamp = stampOf(dir);
  if (res.status === 0) {
    // A kept checkout's installs now match this tree.
    if (existsSync(stamp)) {
      writeFileSync(stamp, JSON.stringify(dependencyHashes(dir)));
      recordInstalled(dir);
    }
    return { ...facts, command, failed: null };
  }
  // What a failed install left can't be trusted: the next run copies the installs afresh.
  if (existsSync(stamp)) {
    rmSync(stamp, { force: true });
    for (const rel of installsOf(dir)) rmSync(join(dir, rel), { recursive: true, force: true });
  }
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
  return {
    ...facts,
    command,
    failed: {
      missing: res.status === 127,
      output: output || (res.error ? String(res.error.code ?? res.error.message) : ''),
    },
  };
}
