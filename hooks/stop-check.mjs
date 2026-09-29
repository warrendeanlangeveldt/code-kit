#!/usr/bin/env node
// Stop / SubagentStop: before an actor finishes, run the checks that prove the work rather than
// asking it to. Read-only agents are skipped. Order: ownership audit, layer rules on changed files,
// then each of the project's checks whose files changed; a lane finishes with its work committed.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { globToRegExp, matchesAny } from './lib/glob.mjs';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { block, start } from './lib/hook.mjs';
import { layerProblems } from './lib/layers.mjs';
import { actorFor, sessionRoot } from './lib/rules.mjs';
import { auditProblems, changedFiles } from './lane-audit.mjs';

const { input, project, config, error } = start();
if (input.stop_hook_active) process.exit(0); // already re-prompted once; avoid loops
if (error) block(error);

const root = sessionRoot(input, project);
if (!root) process.exit(0);
const actor = actorFor(input, root, config);
if (actor.kind === 'readonly') process.exit(0);

const fail = (title, out = '') =>
  block(`${title}\n\n${String(out).split('\n').slice(-60).join('\n')}`.trim());

const audit = auditProblems({ ...input, cwd: root }, config);
if (audit.length)
  fail('Uncommitted changes break the ownership rules; revert them:', audit.join('\n'));

const changed = changedFiles(root);
const baseline = loadBaseline(project);
const layers = changed
  .filter((f) => existsSync(join(root, f)))
  .flatMap((f) =>
    newProblems(f, layerProblems(f, readFileSync(join(root, f), 'utf8'), config), baseline),
  );
if (layers.length)
  fail('Imports break the layer rules (.claude/code-kit.json › layers):', layers.join('\n'));

/** The directories a check runs in: each changed one matching `each`, or the worktree. */
function directories(check, files) {
  if (!check.each) return [root];
  const depth = check.each.split('/').length;
  const dirs = files
    .map((f) => f.split('/').slice(0, depth).join('/'))
    .filter((d) => globToRegExp(check.each).test(d));
  return [...new Set(dirs)].map((d) => join(root, d));
}

function runCheck(check, files) {
  if (check.owners && !(actor.kind === 'lead' || check.owners.includes(actor.lane))) {
    fail(`The ${actor.label} changed ${check.name} files it does not own:`, files.join('\n'));
  }
  for (const cwd of directories(check, files)) {
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
          fail(
            `${check.name}: \`${command}\` is not installed${where}. Install it so the check can run.`,
          );
        return; // not installed yet (fresh clone): the check can't run
      }
      if (res.error || res.status === null)
        fail(
          `${check.name}: \`${command}\` did not finish${where} (${res.error?.code ?? res.signal}).`,
        );
      if (res.status !== 0)
        fail(`${check.name}: \`${command}\` fails${where}. Fix it:`, res.stdout + res.stderr);
    }
  }
}

for (const check of config.checks) {
  const files = changed.filter((f) => matchesAny(f, check.files) && !matchesAny(f, check.exclude));
  if (files.length) runCheck(check, files);
}

// A lane hands back committed work on its own branch; the lead reviews and merges it.
if (actor.kind === 'lane' && changed.length) {
  fail(
    "Commit your work on your branch (stage only your lane's files; the message names the task, what changed and the proof), then finish:",
    changed.join('\n'),
  );
}
process.exit(0);
