#!/usr/bin/env node
// SessionStart and SessionEnd (docs/specs/23-the-team.md): a session starting is recorded as a member
// of the team, the lead session when no other live session leads (SESS-2), and the worktrees done with
// are pruned (docs/specs/20-lean-lead.md, LEAN-8) and the acts a stopped agent left open reconciled
// (docs/specs/26-durable-lanes.md, DUR-4); as it ends, it leads nothing more, and the lanes its
// agents had claimed are free again (SCHED-1). Its task stays, stale (SESS-4).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { releaseSession } from './lib/laneclaims.mjs';
import { endSession, startSession } from './lib/sessions.mjs';
import { projectDir } from './lib/rules.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no input: nothing to do
}
const project = projectDir();
const { config } = loadConfig(project);
const session = input.session_id ?? null;
if (config && session && process.argv[2] === 'start') {
  startSession(project, session);
  // LEAN-8: the worktrees left done with since the last session go, in the background: a project with
  // many of them never holds up a session's start.
  const cli = fileURLToPath(new URL('../bin/code-kit.mjs', import.meta.url));
  spawn(process.execPath, [cli, 'worktrees', 'prune', '--quiet'], {
    cwd: project,
    detached: true,
    stdio: 'ignore',
  }).unref();
  // DUR-4: what an agent left open when the last session stopped is checked against git, in the background.
  spawn(process.execPath, [cli, 'reconcile'], {
    cwd: project,
    detached: true,
    stdio: 'ignore',
  }).unref();
}
if (config && session && process.argv[2] === 'end') {
  endSession(project, session);
  releaseSession(project, session);
}
