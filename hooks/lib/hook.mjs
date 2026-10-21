// What every hook starts with: the tool call from stdin, the project and its config.
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { projectDir } from './rules.mjs';
import { seeSession } from './sessions.mjs';

/** Exit 2 with a message: Claude Code blocks the call and shows Claude the reason. */
export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** The hook input, project and config; exits quietly when the project does not use the kit. */
export function start() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const project = projectDir();
  const { config, error } = loadConfig(project);
  if (!config && !error) process.exit(0);
  // SESS-1: the session acting is still there; one code-kit hadn't seen starts here.
  try {
    seeSession(project, input.session_id);
  } catch {
    // a read-only checkout: the session goes unrecorded
  }
  return { input, project, config, error };
}
