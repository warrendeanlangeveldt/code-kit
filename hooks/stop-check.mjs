#!/usr/bin/env node
// Stop / SubagentStop: before an actor finishes, run the checks that prove the work rather than
// asking it to. Read-only agents are skipped. Order: ownership audit, layer rules on changed files,
// then each of the project's checks whose files changed; a lane finishes with its work committed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { runChecks } from './lib/checks.mjs';
import { block, start } from './lib/hook.mjs';
import { layerProblems } from './lib/layers.mjs';
import { actorFor, actorRoot } from './lib/rules.mjs';
import { auditProblems, changedFiles } from './lane-audit.mjs';

const { input, project, config, error } = start();

// Stop hooks share one `stop_hook_active` flag, so another plugin's block would make this check skip
// itself. Instead this hook remembers its own last block per session and agent. The same problem
// reported MAX_REPEATS times in a row means no progress: say so and let the finish through rather than
// loop. A different problem means progress, and counts from one again.
const MAX_REPEATS = 3;
const memory = join(
  project,
  '.claude/state/stop-blocks',
  `${input.session_id ?? 'session'}-${input.agent_id ?? 'main'}`.replace(/[^\w.-]+/g, '_'),
);
const lastBlock = () => {
  try {
    return JSON.parse(readFileSync(memory, 'utf8'));
  } catch {
    return { message: null, count: 0 };
  }
};
const passed = () => {
  rmSync(memory, { force: true });
  process.exit(0);
};
const blockCounted = (message) => {
  const last = lastBlock();
  const count = last.message === message ? last.count + 1 : 1;
  if (count > MAX_REPEATS) passed();
  mkdirSync(join(memory, '..'), { recursive: true });
  writeFileSync(memory, JSON.stringify({ message, count }));
  const final =
    count === MAX_REPEATS
      ? `\n\n(code-kit has reported this ${count} times without progress; it won't block on it again. Tell the lead what is still failing.)`
      : '';
  block(`${message}${final}`);
};

if (error) blockCounted(error);

const root = actorRoot(input, project);
if (!root) passed();
const actor = actorFor(input, root, config);
if (actor.kind === 'readonly') passed();

const fail = (title, out = '') =>
  blockCounted(`${title}\n\n${String(out).split('\n').slice(-60).join('\n')}`.trim());

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
passed();
