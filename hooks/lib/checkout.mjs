// A fresh checkout of the project, for checks that mustn't run in anyone's worktree: the merge queue's
// verify of a branch merged with the base as it is now (MQ-1), and the fix check's tree with the fix
// taken out (REG-1). It's a temporary worktree with its own copy of the installs (node_modules and
// the like): a link back to a worktree's installs resolves outside the checkout, which path-sensitive
// tools refuse, and an install run in it would rewrite the worktree's own.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { isDependencyFile } from './dependencies.mjs';

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

/**
 * A temporary worktree of `ref` (detached), with `merge` merged into it when given, and the installs
 * of `installsFrom` copied in. `{ dir, remove }`; a merge that conflicts throws a `conflict` error
 * after removing what it made. `remove` never throws: a folder that won't go is left to the OS.
 */
export function freshCheckout(
  root,
  ref,
  { merge = null, installsFrom = root, prefix = 'code-kit-' } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  rmSync(dir, { recursive: true });
  git(root, 'worktree', 'add', '--quiet', '--detach', dir, ref);
  const remove = () => {
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
  copyInstalls(installsFrom, dir);
  return { dir, remove };
}

/**
 * The manifests and lockfiles tracked in either checkout whose content differs between the two working
 * trees: where installs copied from `from` may not match the code in `dir`.
 */
export function dependencyDifferences(from, dir) {
  const tracked = (d) => {
    try {
      return git(d, 'ls-files')
        .split('\n')
        .filter((f) => f && isDependencyFile(f));
    } catch {
      return [];
    }
  };
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
  const present = INSTALLERS.filter(([lock]) => existsSync(join(dir, lock)));
  const known = present.find(([, , files]) => differ.some((f) => files.includes(basename(f))));
  const command = differ.length ? (prepare ?? known?.[1] ?? null) : null;
  const facts = { differ, copied, lockfile: present.length > 0 };
  if (!command) return { ...facts, command: null, failed: null };
  const res = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout });
  if (res.status === 0) return { ...facts, command, failed: null };
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
