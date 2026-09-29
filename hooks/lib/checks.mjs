// The project's checks (config.checks): each runs when files matching it changed. Shared by the stop
// hook (before an agent finishes) and `code-kit verify` (in CI, for a branch's changes).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp, matchesAny } from './glob.mjs';

/** The directories a check runs in: each changed one matching `each` that still exists, or the worktree. */
function directories(check, files, root) {
  if (!check.each) return [root];
  const depth = check.each.split('/').length;
  const dirs = files
    .map((f) => f.split('/').slice(0, depth).join('/'))
    .filter((d) => globToRegExp(check.each).test(d));
  return [...new Set(dirs)].map((d) => join(root, d)).filter((d) => existsSync(d));
}

/** The first failure as { title, output }, or null. `actor` decides `owners`; the lead always may. */
function runCheck(check, files, root, actor) {
  if (check.owners && !(actor.kind === 'lead' || check.owners.includes(actor.lane))) {
    return {
      title: `The ${actor.label} changed ${check.name} files it does not own:`,
      output: files.join('\n'),
    };
  }
  for (const cwd of directories(check, files, root)) {
    for (const command of check.run) {
      const res = spawnSync(command, {
        cwd,
        shell: true,
        encoding: 'utf8',
        timeout: (check.timeoutSeconds ?? 240) * 1000,
      });
      const where = cwd === root ? '' : ` in ${cwd.slice(root.length + 1)}`;
      if (res.status === 127) {
        if (check.ifMissing === 'fail')
          return {
            title: `${check.name}: \`${command}\` is not installed${where}. Install it so the check can run.`,
          };
        return null; // not installed yet (fresh clone): the check can't run
      }
      if (res.error || res.status === null)
        return {
          title: `${check.name}: \`${command}\` did not finish${where} (${res.error?.code ?? res.signal}).`,
        };
      if (res.status !== 0)
        return {
          title: `${check.name}: \`${command}\` fails${where}. Fix it:`,
          output: res.stdout + res.stderr,
        };
    }
  }
  return null;
}

/** Runs every check whose files changed, in order; the first failure, or null when all pass. */
export function runChecks(config, changed, root, actor) {
  for (const check of config.checks) {
    const files = changed.filter(
      (f) => matchesAny(f, check.files) && !matchesAny(f, check.exclude),
    );
    if (!files.length) continue;
    const failure = runCheck(check, files, root, actor);
    if (failure) return failure;
  }
  return null;
}
