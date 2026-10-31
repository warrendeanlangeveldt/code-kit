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
    seeSession(project, input.session_id, Date.now(), () => ({ model: modelOf(input) }));
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
  const entry = lastAssistant(path);
  return entry?.isApiErrorMessage ? (entry.error ?? 'unknown') : null;
}

/**
 * The model the session runs on: the one SessionStart names, or the one its transcript's last reply
 * came from (Claude Code writes it on each), or null. Never a lane agent's: that's the session's lead.
 */
export function modelOf(input) {
  if (typeof input?.model === 'string' && input.model) return input.model.slice(0, 120);
  // A reply Claude Code made up itself (an error, a cut-off turn) names `<synthetic>`: not a model.
  const named = (e) =>
    !e.isApiErrorMessage && typeof e.message?.model === 'string' && /^[^<\s]/.test(e.message.model);
  return lastAssistant(input?.transcript_path, named)?.message.model.slice(0, 120) ?? null;
}

/** The last of the model's entries in a transcript's end that `keep` accepts, or null. */
function lastAssistant(path, keep = () => true) {
  if (!path) return null;
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    // The last of the model's entries: what Claude Code adds after it (a hook's note) says nothing.
    return (
      buffer
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
        .find((e) => e?.type === 'assistant' && keep(e)) ?? null
    );
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
