#!/usr/bin/env node
// UserPromptSubmit (docs/specs/23-the-team.md, SESS-2; docs/specs/31-streams-and-platform.md, STRM-2):
// the person typing `/code-kit:lead [stream]` is their own choice of lead, so it's recorded as the prompt
// arrives. The agent can't run `sessions lead` itself (guard-bash refuses it); the skill only confirms.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { mainCheckoutLead, memberOf, readSession } from './lib/sessions.mjs';
import { hasStreams } from './lib/streams.mjs';
import { projectDir } from './lib/rules.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no input: nothing to do
}
const asked = String(input.prompt ?? '').match(/^\s*\/(?:code-kit:)?lead(?:\s+(\S+))?\s*$/);
const session = input.session_id ?? null;
const project = projectDir();
const { config } = loadConfig(project);
if (!asked || !session || !config) process.exit(0);

const cli = fileURLToPath(new URL('../bin/code-kit.mjs', import.meta.url));
const run = spawnSync(
  process.execPath,
  [cli, 'sessions', 'lead', ...(asked[1] ? [asked[1]] : []), '--session', session],
  { cwd: project, encoding: 'utf8' },
);
const said = (run.status === 0 ? run.stdout : run.stderr).trim();
let note =
  run.status === 0
    ? `code-kit: the person ran /code-kit:lead, so code-kit recorded it as they sent it. ${said}`
    : `code-kit: the person ran /code-kit:lead, and code-kit couldn't record it: ${said}`;
// STRM-2: one lead holds the main checkout; another stream's lead works from a worktree of its own.
const holder = run.status === 0 && hasStreams(config) ? mainCheckoutLead(project) : null;
if (holder && holder.id !== session)
  note += ` The ${holder.stream ?? 'project'} lead (${memberOf(holder)}) holds the main checkout, so lead from a worktree of your own on lead/${readSession(project, session)?.stream ?? 'work'} (EnterWorktree), unless this session already works in one.`;
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note },
  }),
);
