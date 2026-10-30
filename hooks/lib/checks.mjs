// The project's checks (config.checks): each runs when files matching it changed. Shared by the stop
// hook (before an agent finishes) and `code-kit verify` (in CI, for a branch's changes).
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globToRegExp, matchesAny } from './glob.mjs';

/** How much of a check's output is kept to show: its end, where test runners put the failures. */
const OUTPUT_KEPT = 256 * 1024;

/**
 * Runs a check's command with its output going to a file rather than a buffer, so a long run's output
 * (a thousand tests' worth) never stops it: the exit code decides. `{ status, signal, error, output }`,
 * the output's last OUTPUT_KEPT bytes.
 */
function runCommand(command, cwd, timeout) {
  const dir = mkdtempSync(join(tmpdir(), 'code-kit-check-'));
  const file = join(dir, 'output');
  const fd = openSync(file, 'w+');
  try {
    const res = spawnSync(command, { cwd, shell: true, timeout, stdio: ['ignore', fd, fd] });
    const size = fstatSync(fd).size;
    const length = Math.min(size, OUTPUT_KEPT);
    const tail = Buffer.alloc(length);
    readSync(fd, tail, 0, length, size - length);
    return {
      status: res.status,
      signal: res.signal,
      error: res.error,
      output: `${size > length ? '…\n' : ''}${tail.toString('utf8')}`,
    };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The directories a check runs in: each changed one matching `each` that still exists, or the worktree. */
function directories(check, files, root) {
  if (!check.each) return [root];
  const depth = check.each.split('/').length;
  const dirs = files
    .map((f) => f.split('/').slice(0, depth).join('/'))
    .filter((d) => globToRegExp(check.each).test(d));
  return [...new Set(dirs)].map((d) => join(root, d)).filter((d) => existsSync(d));
}

/**
 * The first failure as { check, title, output }, or null. `actor` decides `owners`; the lead always may. A
 * command that isn't installed skips the rest of the check, unless `ifMissing` is "fail", and is
 * added to `skipped` as { check, command, where }, so a pass never hides a check that didn't run.
 */
function runCheck(check, files, root, actor, skipped) {
  if (check.owners && !(actor.kind === 'lead' || check.owners.includes(actor.lane))) {
    return {
      check: check.name,
      title: `The ${actor.label} changed ${check.name} files it does not own:`,
      output: files.join('\n'),
    };
  }
  for (const cwd of directories(check, files, root)) {
    for (const command of check.run) {
      const res = runCommand(command, cwd, (check.timeoutSeconds ?? 240) * 1000);
      const where = cwd === root ? '' : ` in ${cwd.slice(root.length + 1)}`;
      if (res.status === 127) {
        if (check.ifMissing === 'fail')
          return {
            check: check.name,
            title: `${check.name}: \`${command}\` is not installed${where}. Install it so the check can run.`,
          };
        skipped.push({ check: check.name, command, where: where.replace(/^ in /, '') || null });
        return null; // not installed yet (fresh clone): the check can't run
      }
      // #62: a check that ran out of time didn't fail; it's marked so a merge can try it again.
      if (res.error || res.status === null)
        return {
          check: check.name,
          timedOut: res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM',
          title: `${check.name}: \`${command}\` did not finish${where} (${res.error?.code ?? res.signal}) within ${check.timeoutSeconds ?? 240} seconds; \`timeoutSeconds\` on the check gives it longer.`,
        };
      if (res.status !== 0)
        return {
          check: check.name,
          title: `${check.name}: \`${command}\` fails${where}. Fix it:`,
          output: res.output,
        };
    }
  }
  return null;
}

/**
 * Runs every check whose files changed, in order: { failure, skipped }, where `failure` is the first
 * failure or null, and `skipped` lists the checks that couldn't run because a tool isn't installed.
 */
export function runChecks(config, changed, root, actor) {
  const skipped = [];
  for (const check of config.checks) {
    const files = changed.filter(
      (f) => matchesAny(f, check.files) && !matchesAny(f, check.exclude),
    );
    if (!files.length) continue;
    const failure = runCheck(check, files, root, actor, skipped);
    if (failure) return { failure, skipped };
  }
  return { failure: null, skipped };
}

/** A skipped check in a sentence: "typecheck (`tsc` isn't installed in apps/web)". */
export const skippedLine = (s) =>
  `${s.check} (\`${s.command}\` isn't installed${s.where ? ` in ${s.where}` : ''})`;
