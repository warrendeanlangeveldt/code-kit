#!/usr/bin/env node
// Stop / SubagentStop: before an actor finishes, run the checks that prove the work rather than
// asking it to. Read-only agents are skipped. Order: ownership audit, layer rules on changed files,
// then each of the project's checks whose files changed; a lane finishes with its work committed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { runChecks } from './lib/checks.mjs';
import { block, start } from './lib/hook.mjs';
import { layerProblems } from './lib/layers.mjs';
import { actorFor, actorRoot } from './lib/rules.mjs';
import { auditProblems, changedFiles } from './lane-audit.mjs';

const { input, project, config, error } = start();
if (input.stop_hook_active) process.exit(0); // already re-prompted once; avoid loops
if (error) block(error);

const root = actorRoot(input, project);
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

const failure = runChecks(config, changed, root, actor);
if (failure) fail(failure.title, failure.output);

// A lane hands back committed work on its own branch; the lead reviews and merges it.
if (actor.kind === 'lane' && changed.length) {
  fail(
    "Commit your work on your branch (stage only your lane's files; the message names the task, what changed and the proof), then finish:",
    changed.join('\n'),
  );
}
process.exit(0);
