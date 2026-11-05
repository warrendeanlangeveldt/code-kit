#!/usr/bin/env node
// WorktreeCreate (LEAN-10): the worktree Claude Code makes for an agent started with isolation, or for a
// worktree session. A lane agent gets its lane's worktree, reused with its installs (lib/lanetrees.mjs);
// everything else gets the worktree Claude Code would have made. The path goes on stdout, nothing else.
import { readFileSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import { laneTree, mainCheckout, plainTree, takeNextLane } from './lib/lanetrees.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // no input: a plain worktree
}
const main = mainCheckout(input.cwd || process.cwd());
if (!main) {
  process.stderr.write('code-kit: not in a git repository, so no worktree was made.\n');
  process.exit(1);
}
const name = String(input.name || `worktree-${Date.now()}`).replace(/[^\w./-]+/g, '-');
let dir = null;
try {
  const { config } = loadConfig(main);
  const next = config ? takeNextLane(main) : null;
  if (next?.lane && config.lanes[next.lane]) dir = laneTree(main, next.lane, config);
} catch {
  // the lane's worktree couldn't be readied: a plain one
}
dir ??= plainTree(main, name);
if (!dir) {
  process.stderr.write(`code-kit: git couldn't make the worktree ${name}.\n`);
  process.exit(1);
}
process.stdout.write(`${dir}\n`);
