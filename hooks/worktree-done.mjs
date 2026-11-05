#!/usr/bin/env node
// SubagentStop (LEAN-10): with code-kit making the worktrees (worktree-create.mjs), Claude Code no longer
// takes away an agent's worktree when it changed nothing, nor its branch. This does, as Claude Code would:
// the plain worktree made for the agent that's stopping, where it holds no change and no commit of its
// own. A lane's worktree is never taken: its next story reuses it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { laneTreePath, mainCheckout } from './lib/lanetrees.mjs';
import { WORKTREES_DIR } from './lib/worktrees.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!input.agent_id) process.exit(0);
const main = mainCheckout(input.cwd || process.cwd());
if (!main) process.exit(0);
const name = `agent-${input.agent_id}`;
const dir = join(main, WORKTREES_DIR, name);
if (!existsSync(dir)) process.exit(0);
const { config } = loadConfig(main);
const lanes = Object.keys(config?.lanes ?? {});
if (lanes.some((l) => laneTreePath(main, l) === dir)) process.exit(0);
const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const branch = `worktree-${name}`;
if (git('branch', '--show-current').stdout.trim() !== branch) process.exit(0);
const status = git('status', '--porcelain');
if (status.status !== 0 || status.stdout.trim()) process.exit(0);
// Commits only this branch has: none, or it's work that stays.
const own = git(
  'rev-list',
  '--count',
  branch,
  '--not',
  `--exclude=${branch}`,
  '--branches',
  '--remotes',
);
if (own.status !== 0 || Number(own.stdout.trim()) !== 0) process.exit(0);
spawnSync('git', ['-C', main, 'worktree', 'remove', dir], { encoding: 'utf8' });
spawnSync('git', ['-C', main, 'branch', '-D', branch], { encoding: 'utf8' });
