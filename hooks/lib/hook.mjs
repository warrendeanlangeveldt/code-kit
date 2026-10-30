// What every hook starts with: the tool call from stdin, the project and its config.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
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

/** The most of a transcript's end read for its last entry. */
const TAIL_BYTES = 64 * 1024;

/**
 * The API error a stopping turn ended on ('rate_limit', 'overloaded', …), from the last entry of its
 * transcript (a lane agent's own, or the session's), or null when it ended as it meant to. A turn cut
 * off by Claude's usage limit stops too, but nothing it was doing is finished.
 */
export function apiStopOf(input) {
  // A lane agent's own transcript: the session's ends where the lead is, not where the agent stopped.
  const path = input?.agent_id ? input.agent_transcript_path : input?.transcript_path;
  if (!path) return null;
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    // The last of the model's entries: what Claude Code adds after it (a hook's note) says nothing.
    const entry = buffer
      .toString('utf8')
      .split('\n')
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((e) => e?.type === 'assistant');
    return entry?.isApiErrorMessage ? (entry.error ?? 'unknown') : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
