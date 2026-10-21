#!/usr/bin/env node
// PostToolUse (Bash) and part of Stop: shell commands can write files without going through the
// path guard, so after each one every uncommitted change in the worktree is checked against the
// same rules (lib/rules.mjs). Anything the actor may not write is reported for revert.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPROVAL_LOG,
  LANE_FILE,
  actorFor,
  actorRoot,
  arrivesWithMerge,
  writeProblem,
} from './lib/rules.mjs';

// The commit hook appends to the approval log and stages it; if that commit then fails, the
// appended lines are left uncommitted. That is the only change to the log that is not a problem.
function appendedOnly(root, rel) {
  const committed = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8' });
  const before = committed.status === 0 ? committed.stdout : '';
  try {
    return readFileSync(join(root, rel), 'utf8').startsWith(before);
  } catch {
    return false; // deleted
  }
}

export function changedFiles(root) {
  const out =
    spawnSync('git', ['-C', root, 'status', '--porcelain', '-uall', '--no-renames'], {
      encoding: 'utf8',
    }).stdout ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((f) => !f.endsWith('/')) // a nested repository or worktree: its changes are its own
    .filter((f) => f !== LANE_FILE);
}

// A read-only agent (a reviewer, a card writer) works in a checkout it shares, usually the lead's,
// whose uncommitted work isn't the agent's. So its shell commands are judged by what each one changed:
// the uncommitted files are noted before the command runs (guard-bash) and compared after it.
const snapshotFile = (id) => join(tmpdir(), 'code-kit-shell', `${id}.json`);
const signature = (root, rel) => {
  try {
    const s = statSync(join(root, rel));
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'gone';
  }
};

/** Notes the uncommitted files and their state before a read-only agent's command runs. */
export function noteBefore(input) {
  const root = actorRoot(input);
  if (!root || !input.tool_use_id) return;
  const before = Object.fromEntries(changedFiles(root).map((rel) => [rel, signature(root, rel)]));
  try {
    mkdirSync(join(tmpdir(), 'code-kit-shell'), { recursive: true });
    writeFileSync(snapshotFile(input.tool_use_id), JSON.stringify(before));
  } catch {
    // without a note, every uncommitted change is judged, as for any actor
  }
}

/** What was noted before the command, taken once; null when nothing was. */
function takeNote(input) {
  if (!input.tool_use_id) return null;
  const file = snapshotFile(input.tool_use_id);
  try {
    const before = JSON.parse(readFileSync(file, 'utf8'));
    rmSync(file, { force: true });
    return before;
  } catch {
    return null;
  }
}

/**
 * SESS-5: the files git said a command's checkout, merge or rebase would overwrite, when it refused for
 * uncommitted work: [] when it didn't.
 */
export function overwrittenFiles(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  const said = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const files = [];
  for (const m of said.matchAll(
    /(?:local changes to the following files|untracked working tree files) would be (?:overwritten|removed) by [\w-]+:\n((?:\t[^\n]+\n?)+)/g,
  ))
    files.push(
      ...m[1]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
  return [...new Set(files)];
}

export function auditProblems(input, config) {
  const root = actorRoot(input);
  if (!root) return [];
  const actor = actorFor(input, root, config);
  const before = actor.kind === 'readonly' ? takeNote(input) : null;
  return (
    changedFiles(root)
      // A read-only agent answers for what its command changed, not for the checkout it shares.
      .filter((rel) => !before || before[rel] !== signature(root, rel))
      .filter((rel) => !(rel === APPROVAL_LOG && appendedOnly(root, rel)))
      // Mid-merge, the incoming branch's changes are its own, not this actor's writes.
      .filter((rel) => !arrivesWithMerge(root, rel))
      .map((rel) => [rel, writeProblem(actor, rel, root, config)])
      .filter(([, problem]) => problem)
      .map(([rel, problem]) => `${rel}: ${problem.split('\n')[0]}`)
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { block, start } = await import('./lib/hook.mjs');
  const { input, project, config, error } = start();
  if (error) process.exit(0); // guard-paths and stop-check report an invalid config
  // SESS-5: git refused because of uncommitted files another session wrote: say whose they are.
  const overwritten = overwrittenFiles(input.tool_response);
  if (overwritten.length) {
    const { memberOf, writersOf } = await import('./lib/sessions.mjs');
    const whose = Object.entries(writersOf(project, overwritten, input.session_id ?? null));
    if (whose.length)
      block(
        `Git refused because of uncommitted files another session wrote in this checkout:\n  ${whose
          .map(
            ([f, w]) =>
              `${f}: ${w.map((s) => `${memberOf(s)}${s.task ? `, working on "${s.task.title}"` : ''}${s.live ? '' : ' (ended)'}`).join('; ')}`,
          )
          .join(
            '\n  ',
          )}\nAsk that session to commit or stash them; don't stash or discard another session's work. Better, work in a worktree of your own, where no other session's files can block you.`,
      );
  }
  const problems = auditProblems(input, config);
  if (problems.length) {
    block(
      `These uncommitted changes break the ownership rules (.claude/code-kit.json). Revert them ` +
        `(git checkout -- <file>, or delete new files) and do the work the permitted way:\n  ${problems.join('\n  ')}`,
    );
  }
  process.exit(0);
}
