#!/usr/bin/env node
// SessionStart and SessionEnd (docs/specs/23-the-team.md): what a session holds in the project ends
// with it. As it ends, the lanes its agents had claimed are free again (SCHED-1).
import { readFileSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import { releaseSession } from './lib/laneclaims.mjs';
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
if (config && session && process.argv[2] === 'end') releaseSession(project, session);
