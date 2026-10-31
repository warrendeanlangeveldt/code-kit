#!/usr/bin/env node
// Durable lanes (spec 26): the event log's writer. PreToolUse records each act's start, PostToolUse
// its end and PostToolUseFailure its failure, and SubagentStop a lane agent handing back, or stopped by
// an API error, and the security reviewer's findings, on the story it reviewed (HUBR-2). It never blocks a call (DUR-2): it runs in the background (`async` in hooks.json), so
// no call waits for it, and a write that fails is said once in the session while the work goes on.
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { apiStopOf, start } from './lib/hook.mjs';
import { actorFor, currentBranch, sessionRoot } from './lib/rules.mjs';
import {
  agentIdOf,
  classify,
  headOf,
  recordEnd,
  recordNote,
  recordStart,
  resultOf,
  securityReviewFor,
  storyOf,
} from './lib/events.mjs';
import { isSecurityReviewer, securityOutcome } from './lib/security.mjs';

const mode = process.argv[2];

/** A path as the repository names it, when it's inside it: real paths compared, so /tmp and /private/tmp agree. */
function inRoot(root, path) {
  if (!path || !isAbsolute(path)) return path;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      try {
        return join(realpathSync(dirname(p)), basename(p));
      } catch {
        return p;
      }
    }
  };
  const rel = relative(real(root), real(path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}
let input = {};
try {
  const begun = start();
  input = begun.input;
  if (begun.error) process.exit(0);
  const { project, config } = begun;
  const root = sessionRoot(input, project) ?? project;
  const actor = actorFor(input, root, config);
  let branch = null;
  try {
    branch = currentBranch(root);
  } catch {
    // not a git repository yet
  }
  const who = actor.kind === 'lane' ? actor.lane : actor.kind === 'lead' ? 'lead' : actor.label;
  const ctx = { session: input.session_id ?? null, agent: input.agent_id ?? null, actor: who };
  if (mode === 'handback' && isSecurityReviewer(input.agent_type)) {
    // HUBR-2: the security review that ran, on the story it was started for, with what it found.
    const review = securityReviewFor(root, input.agent_id ?? null);
    if (review)
      recordNote(root, {
        ...ctx,
        act: review.act,
        story: review.story,
        branch: review.branch,
        kind: 'security-review',
        agentType: input.agent_type,
        result: securityOutcome(input.last_assistant_message) ?? { unread: true },
      });
    process.exit(0);
  }
  if (mode === 'handback') {
    const story = storyOf({ kind: 'handback', target: '', branch }).story;
    // An agent Claude's API stopped (its usage limit) didn't hand back: it stopped, mid-story.
    const error = apiStopOf(input);
    if (actor.kind === 'lane' && story)
      recordNote(root, {
        ...ctx,
        story,
        branch,
        kind: error ? 'stopped' : 'handback',
        head: headOf(root),
        ...(error ? { result: { error } } : {}),
      });
    process.exit(0);
  }
  const { kind, target } = classify(input.tool_name, input.tool_input, config);
  const shown = kind === 'edit' || kind === 'read' ? inRoot(root, target) : target;
  const { story, branch: storyBranch } = storyOf({ kind, target: shown, branch, root });
  const started = ['Agent', 'Task'].includes(input.tool_name)
    ? (input.tool_input?.subagent_type ?? null)
    : null;
  const act = {
    ...ctx,
    act: input.tool_use_id ?? null,
    story,
    kind,
    target: shown,
    branch: storyBranch ?? branch,
    head: headOf(root),
    agentType: started,
  };
  // A security reviewer started in the background: its id, so its findings find this review as it stops.
  const launched = isSecurityReviewer(started) ? agentIdOf(input.tool_response) : null;
  if (mode === 'start') recordStart(root, act);
  else if (mode === 'end')
    recordEnd(root, act, {
      ...resultOf(kind, null, root),
      ...(launched ? { agent: launched } : {}),
    });
  else if (mode === 'fail') recordEnd(root, act, resultOf(kind, input.error ?? 'failed', root));
} catch (e) {
  // DUR-2: once per session, the person hears the log isn't being kept; the call goes on.
  const marker = join(
    tmpdir(),
    `code-kit-events-${String(input.session_id ?? 'session').replace(/[^\w-]/g, '')}`,
  );
  if (!existsSync(marker)) {
    try {
      writeFileSync(marker, String(e?.message ?? e));
    } catch {
      // nowhere to note it
    }
    process.stdout.write(
      JSON.stringify({
        systemMessage: `code-kit couldn't write its event log (${String(e?.message ?? e).split('\n')[0]}), so recovery after a crash falls back to git. Work goes on as before.`,
      }),
    );
  }
}
process.exit(0);
