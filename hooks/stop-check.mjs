#!/usr/bin/env node
// Stop / SubagentStop: before an actor finishes, run the checks that prove the work rather than
// asking it to. Read-only agents are skipped. Order: ownership audit, layer rules on changed files,
// then each of the project's checks whose files changed; a lane finishes with its work committed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBaseline, newProblems } from './lib/baseline.mjs';
import { runChecks } from './lib/checks.mjs';
import { block, start } from './lib/hook.mjs';
import { brokenLayerRule, layerProblems } from './lib/layers.mjs';
import { noteFor } from './lib/standards.mjs';
import { actorFor, actorRoot, currentBranch, reportPath } from './lib/rules.mjs';
import { storyOfBranch } from './lib/teamfacts.mjs';
import { releaseLane } from './lib/laneclaims.mjs';
import { auditProblems, changedFiles } from './lane-audit.mjs';

const { input, project, config, error } = start();

// SCHED-1: a lane agent whose finish goes through frees its lane for the next story. A refused finish
// (exit 2) keeps it: the agent carries on.
const finishingLane =
  input.agent_id && config
    ? Object.entries(config.lanes).find(([, l]) => l.agent === input.agent_type)?.[0]
    : null;
if (finishingLane)
  process.on('exit', (code) => {
    if (code === 0) releaseLane(project, finishingLane, { session: input.session_id ?? null });
  });

// Stop hooks share one `stop_hook_active` flag, so another plugin's block would make this check skip
// itself. Instead this hook remembers its own last block per session and agent. The same problem
// reported MAX_REPEATS times in a row means no progress: say so and let the finish through rather than
// loop. A different problem means progress, and counts from one again.
const MAX_REPEATS = 3;
// LEAN-1: the most a lane's hand-back holds.
const HAND_BACK_LINES = 10;
const HAND_BACK_CHARS = 1200;
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
  // Also what `code-kit stops` shows the person: whose finish was refused, when, and why.
  writeFileSync(
    memory,
    JSON.stringify({
      message,
      count,
      session: input.session_id ?? null,
      agent: input.agent_id ?? null,
      agentType: input.agent_type ?? null,
      at: new Date().toISOString(),
    }),
  );
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
  fail(
    `Imports break the layer rules (.claude/code-kit.json › layers):${noteFor(root, config, layers.map(brokenLayerRule))}`,
    layers.join('\n'),
  );

const { failure } = runChecks(config, changed, root, actor);
if (failure)
  fail(
    `${failure.title}${noteFor(root, config, { kind: 'check', name: failure.check })}`,
    failure.output,
  );

// A lane hands back committed work on its own branch; the lead reviews and merges it.
if (actor.kind === 'lane' && changed.length) {
  fail(
    "Commit your work on your branch (stage only your lane's files; the message names the task, what changed and the proof), then finish:",
    changed.join('\n'),
  );
}

// LEAN-1: the lead's context gets a short hand-back; the detail waits in a file it reads when it reviews.
if (actor.kind === 'lane' && storyOfBranch(currentBranch(root))) {
  const report = reportPath(root);
  // Written in the lane's worktree, or by its absolute path in the main checkout: either is found.
  if (!existsSync(join(root, report)) && !existsSync(join(project, report)))
    blockCounted(
      `Write your full report to ${report} before you finish: what you did and why, the spec section, the commands you ran with their output, what's left, and anything you need decided (with the choices, and any text you'd have pasted, such as a migration you can't write yet). Then finish with a short hand-back of at most ten lines: the story and branch, done or blocked, any decision the lead must make, and that report's path. Don't paste output or code into the hand-back; the lead reads the file when it reviews.`,
    );
  // The hand-back is what reaches the lead's context: a few lines, the detail left in the report.
  const handBack = String(input.last_assistant_message ?? '').trim();
  const lines = handBack.split('\n').filter((l) => l.trim()).length;
  if (lines > HAND_BACK_LINES || handBack.length > HAND_BACK_CHARS)
    blockCounted(
      `Your hand-back is ${lines} lines and ${handBack.length} characters, and all of it goes into the lead's context. Finish again with at most ${HAND_BACK_LINES} short lines: the story and branch, done or blocked, any decision the lead must make, and ${report}. Don't restate the report: the lead reads it when it reviews.`,
    );
}
passed();
