// SessionStart and SessionEnd (code-kit spec 21, HUBR-6): when the team's provider is a hosted one, its
// adapter holds the session's live link (the event stream and the team's state on disk) from start to
// end, and the session reports the project's facts once as it starts (HUBR-3). Nothing happens in a
// project whose team works through GitHub, or that has no team.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerAdapterOf } from './lib/adapters/index.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no input: nothing to start
}
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const session = String(input.session_id ?? 'session').replace(/[^\w-]/g, '');
let raw = null;
try {
  raw = JSON.parse(readFileSync(join(root, '.claude', 'code-kit.json'), 'utf8'));
} catch {
  // not a code-kit project
}
const hosted = providerAdapterOf(raw?.team?.provider);
if (hosted && !hosted.problem) {
  const { adapter, url } = hosted;
  if (process.argv[2] === 'start') {
    // The link lives as long as the Claude Code process that started this hook.
    let watch = process.ppid;
    try {
      watch =
        Number(
          execFileSync('ps', ['-o', 'ppid=', '-p', String(process.ppid)], {
            encoding: 'utf8',
          }).trim(),
        ) || process.ppid;
    } catch {
      // the hook's own parent, then
    }
    adapter.session.start(root, session, watch, url);
    // The project's facts as the session starts, in the background: the session doesn't wait on it.
    if (raw.team.report !== false)
      spawn(
        process.execPath,
        [
          join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'code-kit.mjs'),
          'team',
          'pulse',
          '--session',
          session,
        ],
        { cwd: root, detached: true, stdio: 'ignore' },
      ).unref();
  }
  if (process.argv[2] === 'end') adapter.session.end(root, session);
}
