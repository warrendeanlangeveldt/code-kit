// Durable lanes (docs/specs/26-durable-lanes.md): each act recorded before and after it runs (an event
// sandwich), in a log per story, so after a crash the next session can rebuild where each story stands
// (replay), check each act left open against git (reconcile), and brief the fresh agent that carries the
// story on. Replay only reads; nothing here runs an act again.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CODE_KIT, GIT, commandsOf } from './shell.mjs';
import { addedPackages } from './dependencies.mjs';
import { storyOfBranch } from './teamfacts.mjs';
import { globToRegExp } from './glob.mjs';
import { projectWorktrees } from './rules.mjs';
import { readQueue, settle, waiting } from './queue.mjs';
import { sessions } from './sessions.mjs';

export const EVENTS_DIR = '.claude/state/events';
const OPEN_DIR = `${EVENTS_DIR}/.open`;
/** DUR-6: a log past this is trimmed to its first agent event and its last KEEP events. */
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
export const KEEP_EVENTS = 2000;
/** DUR-6: a merged story's log is kept this long after its last event. */
export const KEEP_MERGED_MS = 30 * 24 * 60 * 60_000;
const TARGET_MAX = 300;

// The main checkout, looked up once per root: a hook writes several events, each asking.
const mains = new Map();
const mainOf = (root) => {
  if (!mains.has(root)) mains.set(root, projectWorktrees(root)[0] ?? root);
  return mains.get(root);
};
const logFile = (root, story) => join(mainOf(root), EVENTS_DIR, `${story ?? 'lead'}.jsonl`);
const git = (cwd, ...args) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const out = (r) => (r.status === 0 ? r.stdout.trim() : '');

/** DUR-2: a command as recorded: credentials masked, at most 300 characters. */
export function maskCommand(text) {
  return String(text ?? '')
    .replace(/\b(Bearer|Basic)\s+\S+/g, '$1 ***')
    .replace(
      /\b((?:[\w-]*(?:token|secret|password|passwd|api[_-]?key|auth)[\w-]*)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1***',
    )
    .replace(/(--(?:token|password|key|secret)[= ])\S+/gi, '$1***')
    .replace(/(\/\/[^/\s:@]+:)[^@\s]+@/g, '$1***@')
    .slice(0, TARGET_MAX);
}

const TEST =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:npx\s+|pnpm\s+exec\s+|uv\s+run\s+)?(?:vitest|jest|mocha|pytest|playwright\s+test)\b|python3?\s+-m\s+pytest\b|go\s+test\b|cargo\s+test\b|node\s+--test\b)/;

/**
 * Whether a command can't safely run twice (DUR-4): a migration (it names a file the `migration`
 * approval protects), one the project blocks or restricts, or one in `execution.unrepeatable`.
 */
export function unrepeatable(command, config) {
  const patterns = [
    ...(config.shell?.block ?? []).map((b) => b.pattern),
    ...(config.shell?.restricted ?? []).map((r) => r.pattern),
    ...(config.execution?.unrepeatable ?? []),
  ];
  if (patterns.some((p) => safeTest(p, command))) return true;
  const migrations = (config.protected ?? []).filter((p) => p.approval === 'migration');
  return command
    .split(/\s+/)
    .some((w) => migrations.some((p) => globToRegExp(p.glob).test(w.replace(/^\.\//, ''))));
}
function safeTest(pattern, text) {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/**
 * DUR-1: what a tool call is, as the log records it: { kind, target }. `kind` is edit, read, run, test,
 * commit, install, merge, push, unrepeatable, dispatch, or one of the lead's acts on a story (queue,
 * send-back, release, approve, review).
 */
export function classify(tool, input, config) {
  const i = input ?? {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool))
    return { kind: 'edit', target: String(i.file_path ?? i.notebook_path ?? '') };
  if (['Read', 'Grep', 'Glob'].includes(tool))
    return { kind: 'read', target: String(i.file_path ?? i.path ?? i.pattern ?? '') };
  if (tool === 'Agent' || tool === 'Task') {
    const reviewer = /review/i.test(String(i.subagent_type ?? ''));
    return {
      kind: reviewer ? 'review' : 'dispatch',
      target: String(i.description ?? i.subagent_type ?? '').slice(0, TARGET_MAX),
    };
  }
  if (tool !== 'Bash') return { kind: 'run', target: tool };
  const command = String(i.command ?? '');
  const target = maskCommand(command);
  const parts = commandsOf(command).map((c) => c.text);
  const any = (re) => parts.some((p) => re.test(p));
  const kit = (sub) => new RegExp(String.raw`^${CODE_KIT}\s+${sub}`);
  if (any(kit(String.raw`(?:queue\s+)?merge\b`))) return { kind: 'merge', target };
  if (any(kit(String.raw`queue\s+add\b`))) return { kind: 'queue', target };
  if (any(kit(String.raw`sent-back\b`))) return { kind: 'send-back', target };
  if (any(kit(String.raw`worktrees\s+release\b`))) return { kind: 'release', target };
  if (any(kit(String.raw`approve\b`))) return { kind: 'approve', target };
  if (any(kit(String.raw`publish\b`))) return { kind: 'push', target };
  if (any(kit(String.raw`(?:verify|security)\b.*\s--branch\b`))) return { kind: 'review', target };
  if (any(new RegExp(String.raw`^${GIT}commit(?![\w-])`))) return { kind: 'commit', target };
  if (any(new RegExp(String.raw`^${GIT}push\b`))) return { kind: 'push', target };
  if (any(new RegExp(String.raw`^${GIT}merge(?![\w-])`))) return { kind: 'merge', target };
  if (addedPackages(command).length) return { kind: 'install', target };
  if (unrepeatable(command, config)) return { kind: 'unrepeatable', target };
  const checks = (config.checks ?? []).flatMap((c) => c.run ?? []);
  if (parts.some((p) => TEST.test(p) || checks.includes(p))) return { kind: 'test', target };
  return { kind: 'run', target };
}

/** The story a call belongs to: the branch a lead's act names, a dispatch's story, else the branch it runs on. */
export function storyOf({ kind, target, branch, root }) {
  const named = String(target).match(/\b([a-z][a-z0-9-]*\/st-\d+)\b/i)?.[1];
  if (['merge', 'queue', 'send-back', 'release', 'review', 'push'].includes(kind) && named)
    return { story: storyOfBranch(named), branch: named };
  if (kind === 'merge' && /queue\s+merge/.test(target) && root) {
    const head = waiting(readQueue(root))[0]?.branch;
    if (head) return { story: storyOfBranch(head), branch: head };
  }
  if (kind === 'dispatch' || kind === 'review') {
    const id = String(target).match(/\bST-\d+\b/i)?.[0];
    if (id) return { story: id.toUpperCase(), branch: null };
  }
  return { story: storyOfBranch(branch), branch };
}

/** Appends one event to its story's log (the lead's when it has none), trimming a log grown past MAX_LOG_BYTES. */
export function appendEvent(root, event) {
  const file = logFile(root, event.story);
  mkdirSync(join(mainOf(root), EVENTS_DIR), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  if (statSync(file).size > MAX_LOG_BYTES) trimLog(file);
}

/** DUR-6: keeps the first agent event and the last KEEP_EVENTS, with a line saying how many went. */
export function trimLog(file, keep = KEEP_EVENTS) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= keep + 1) return;
  const last = lines.slice(-keep);
  const found = lines.find((l) => /"kind":"(?:dispatch|agent)"/.test(l));
  const first = found && !last.includes(found) ? [found] : [];
  const note = JSON.stringify({
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: 'trimmed',
    phase: 'note',
    result: { dropped: lines.length - last.length - first.length },
  });
  writeFileSync(file, `${[...first, note, ...last].join('\n')}\n`);
}

/** A story's events, oldest first; [] for none. Unreadable lines are skipped. */
export function readEvents(root, story) {
  try {
    return readFileSync(logFile(root, story), 'utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** The stories with a log. */
export function loggedStories(root) {
  try {
    return readdirSync(join(mainOf(root), EVENTS_DIR))
      .filter((f) => /^ST-\d+\.jsonl$/i.test(f))
      .map((f) => f.replace(/\.jsonl$/, ''));
  } catch {
    return [];
  }
}

const openFile = (root, session, agent) =>
  join(
    mainOf(root),
    OPEN_DIR,
    `${session ?? 'session'}-${agent ?? 'main'}`.replace(/[^\w.-]+/g, '_') + '.json',
  );

/**
 * DUR-1, before a call: closes the same agent's previous act if it never got its end (a failed or
 * refused tool: the agent went on, so it wasn't a crash), then records this one's start.
 */
export function recordStart(root, ctx, now = Date.now()) {
  const pointer = openFile(root, ctx.session, ctx.agent);
  if (existsSync(pointer)) {
    try {
      const prev = JSON.parse(readFileSync(pointer, 'utf8'));
      appendEvent(root, {
        ...base(prev, now),
        phase: 'end',
        result: { ok: null, ended: 'without a result' },
      });
    } catch {
      // a pointer half-written: nothing to close
    }
  }
  const event = { ...base(ctx, now), phase: 'start' };
  appendEvent(root, event);
  mkdirSync(join(mainOf(root), OPEN_DIR), { recursive: true });
  writeFileSync(pointer, JSON.stringify(ctx));
  return event;
}

/** DUR-1, after a call: its end, with what came of it. */
export function recordEnd(root, ctx, result, now = Date.now()) {
  rmSync(openFile(root, ctx.session, ctx.agent), { force: true });
  const event = { ...base(ctx, now), phase: 'end', result };
  appendEvent(root, event);
  return event;
}

/** An event that stands alone: a hand-back, a reconciliation. */
export function recordNote(root, ctx, now = Date.now()) {
  const event = { ...base(ctx, now), phase: 'note', ...(ctx.result ? { result: ctx.result } : {}) };
  appendEvent(root, event);
  return event;
}

function base(ctx, now) {
  return {
    id: randomUUID(),
    at: new Date(now).toISOString(),
    story: ctx.story ?? null,
    act: ctx.act ?? null,
    actor: ctx.actor ?? null,
    agent: ctx.agent ?? null,
    session: ctx.session ?? null,
    kind: ctx.kind,
    target: ctx.target ?? null,
    branch: ctx.branch ?? null,
    head: ctx.head ?? null,
  };
}

/** The commit a checkout is at, short; null outside git. */
export const headOf = (cwd) => out(git(cwd, 'rev-parse', '--short', 'HEAD')) || null;

/** DUR-1: what came of a call, from PostToolUse (`failure` null) or PostToolUseFailure. */
export function resultOf(kind, failure, cwd) {
  if (failure !== null && failure !== undefined) {
    const text = maskCommand(String(failure)).split('\n')[0].slice(0, 200);
    const exit = Number(String(failure).match(/Exit code (\d+)/)?.[1] ?? NaN);
    return {
      ok: false,
      ...(Number.isNaN(exit) ? {} : { exit }),
      error: text,
      ...(kind === 'test' ? { test: 'failed' } : {}),
    };
  }
  return {
    ok: true,
    ...(kind === 'test' ? { test: 'passed' } : {}),
    ...(kind === 'commit' && cwd ? { sha: headOf(cwd) } : {}),
  };
}

// --- replay (DUR-3) -------------------------------------------------------------------------------

const LEAD_PHASE = {
  dispatch: 'dispatched',
  review: 'in review',
  queue: 'queued',
  'send-back': 'sent back',
};

/**
 * A story's state rebuilt from its events, reading only: { phase, branch, lastCommit: { sha, at },
 * lastTest: { target, ok, at }, changed: [paths edited since the last commit], open: [acts with a start
 * and no end, not reconciled], reconciled: [...], recent: [the last ten acts], trimmed }.
 */
export function replay(events) {
  const acts = new Map();
  const state = {
    phase: null,
    branch: null,
    lastCommit: null,
    lastTest: null,
    changed: [],
    open: [],
    reconciled: [],
    recent: [],
    trimmed: 0,
    lastAt: null,
  };
  const changed = new Set();
  for (const e of events) {
    state.lastAt = e.at ?? state.lastAt;
    if (e.branch && /\/st-\d+$/i.test(e.branch)) state.branch = e.branch;
    if (e.kind === 'trimmed') {
      state.trimmed += e.result?.dropped ?? 0;
      continue;
    }
    if (e.kind === 'reconciled') {
      state.reconciled.push(e);
      const act = acts.get(e.target);
      if (act) act.reconciled = e;
      // An interrupted commit that happened is the last commit, as if its end had come.
      if (act?.start?.kind === 'commit' && e.result?.sha) {
        state.lastCommit = { sha: e.result.sha, at: e.at };
        changed.clear();
      }
      continue;
    }
    if (e.kind === 'handback') {
      state.phase = 'handed back';
      continue;
    }
    // Its agent was stopped by Claude's API (its usage limit) mid-story: restarted, it carries on.
    if (e.kind === 'stopped') {
      state.phase = 'stopped';
      continue;
    }
    if (!e.act) continue;
    const act = acts.get(e.act) ?? { start: null, end: null, reconciled: null };
    acts.set(e.act, act);
    if (e.phase === 'start') {
      act.start = e;
      if (e.actor === 'lead' && LEAD_PHASE[e.kind]) state.phase = LEAD_PHASE[e.kind];
      else if (e.actor === 'lead' && e.kind === 'merge') state.phase = 'merging';
      else if (e.actor !== 'lead' && ['edit', 'run', 'test', 'commit', 'install'].includes(e.kind))
        state.phase = 'building';
      continue;
    }
    act.end = e;
    const ok = e.result?.ok === true;
    if (e.kind === 'commit' && ok) {
      state.lastCommit = { sha: e.result.sha ?? e.head, at: e.at };
      changed.clear();
    }
    if (e.kind === 'edit' && ok && e.target) changed.add(e.target);
    if (e.kind === 'test' && e.result?.ok !== null)
      state.lastTest = { target: e.target, ok, at: e.at };
    if (e.actor === 'lead' && e.kind === 'merge' && ok) state.phase = 'merged';
  }
  state.changed = [...changed];
  const all = [...acts.entries()].filter(([, a]) => a.start);
  state.open = all
    .filter(([, a]) => !a.end && !a.reconciled)
    .map(([id, a]) => ({ act: id, ...pick(a.start) }));
  state.recent = all.slice(-10).map(([id, a]) => ({
    act: id,
    ...pick(a.start),
    result: a.end?.result ?? (a.reconciled ? { reconciled: a.reconciled.result } : null),
  }));
  return state;
}
const pick = (e) => ({
  at: e.at,
  kind: e.kind,
  target: e.target,
  actor: e.actor,
  agent: e.agent,
  session: e.session,
  branch: e.branch,
});

// --- reconcile (DUR-4) ----------------------------------------------------------------------------

/** Whether a story is merged: its log says so, or the base contains its branch (merged from the pane). */
export function isMerged(root, state, base) {
  if (state.phase === 'merged') return true;
  return Boolean(
    state.branch &&
    base &&
    git(root, 'rev-parse', '--verify', '--quiet', state.branch).status === 0 &&
    git(root, 'merge-base', '--is-ancestor', state.branch, base).status === 0 &&
    git(root, 'rev-list', '--count', `${base}..${state.branch}`).stdout.trim() === '0',
  );
}

/** Kinds that can safely run again: the fresh agent re-reads and re-runs them. */
const REPEATABLE = new Set(['edit', 'read', 'run', 'test', 'install', 'dispatch', 'review']);

/**
 * Whether an open act's agent has stopped: its session isn't live, a later event from the same agent
 * says it handed back or was stopped by an API error, or it's older than the stall restart (LOOP-3).
 */
export function stopped(act, events, { liveSessions, restartMs, now }) {
  if (act.session && !liveSessions.has(act.session)) return true;
  if (now - Date.parse(act.at) >= restartMs) return true;
  return events.some(
    (e) =>
      ['handback', 'stopped'].includes(e.kind) &&
      e.session === act.session &&
      (e.agent ?? null) === (act.agent ?? null) &&
      Date.parse(e.at) >= Date.parse(act.at),
  );
}

/** The worktree a branch is checked out in, or null. */
function worktreeOf(root, branch) {
  if (!branch) return null;
  const list = out(git(root, 'worktree', 'list', '--porcelain'));
  return (
    list
      .split('\n\n')
      .find((w) => w.includes(`\nbranch refs/heads/${branch}`))
      ?.match(/^worktree (.+)$/m)?.[1] ?? null
  );
}

/**
 * What an open act came to, from git and the worktree: { found: 'done' | 'not done' | 'unknown', how,
 * next }. Reads only.
 */
export function checkAct(root, act, base) {
  const branch = act.branch;
  const tree = worktreeOf(root, branch);
  if (act.kind === 'commit') {
    const after = branch
      ? out(git(root, 'log', '-1', '--format=%h', `--since=${act.at}`, branch))
      : '';
    return after
      ? {
          found: 'done',
          how: `${branch} has a commit made after it started (${after})`,
          next: 'carry on from it',
          sha: after,
        }
      : {
          found: 'not done',
          how: `${branch ?? 'the branch'} has no commit made after it started`,
          next: "the fresh agent commits what's uncommitted",
        };
  }
  if (act.kind === 'merge' && act.actor === 'lead') {
    if (!branch || !base) return unknown('the branch or the base is unknown');
    const merged = git(root, 'merge-base', '--is-ancestor', branch, base).status === 0;
    return merged
      ? {
          found: 'done',
          how: `${base} contains ${branch}'s head`,
          next: 'its queue entry is settled as merged',
        }
      : {
          found: 'not done',
          how: `${base} doesn't contain ${branch}'s head`,
          next: 'it stays at the head of the queue',
        };
  }
  if (act.kind === 'push') {
    const pushed = branch ?? out(git(tree ?? root, 'rev-parse', '--abbrev-ref', 'HEAD'));
    const local = out(git(root, 'rev-parse', pushed));
    const remote = out(git(root, 'rev-parse', `origin/${pushed}`));
    return local && local === remote
      ? { found: 'done', how: `origin/${pushed} is at ${local.slice(0, 7)}`, next: 'nothing' }
      : {
          found: 'not done',
          how: `origin/${pushed} isn't at the local ${pushed}`,
          next: 'the lead pushes again',
        };
  }
  if (act.kind === 'edit' && tree) {
    const rel = act.target?.startsWith(tree) ? act.target.slice(tree.length + 1) : act.target;
    const changed = out(git(tree, 'status', '--porcelain', '--', rel));
    return {
      found: changed ? 'done' : 'not done',
      how: changed ? `${rel} holds uncommitted changes` : `${rel} is as committed`,
      next: 'the fresh agent re-reads it',
    };
  }
  if (REPEATABLE.has(act.kind))
    return {
      found: 'not done',
      how: `${act.kind === 'install' ? 'an install' : 'it'} can safely run again`,
      next: 'the fresh agent runs it again if it needs it',
    };
  return unknown(`git can't say whether ${act.kind === 'unrepeatable' ? 'it' : act.kind} ran`);
}
const unknown = (how) => ({ found: 'unknown', how, next: 'the lead decides' });

/**
 * DUR-4: reconciles every unfinished story's acts left open by an agent that has stopped. What git can
 * settle is recorded as `reconciled` (a merge found done also settles its queue entry); what it can't
 * is returned as unknown, for the lead. Uncommitted work is never touched.
 */
export function reconcileAll(root, config, { base = null, now = Date.now() } = {}) {
  const liveSessions = new Set(
    sessions(root, now)
      .filter((s) => s.live)
      .map((s) => s.id),
  );
  const restartMs = (config.harness?.stall?.restartMinutes ?? 10) * 60_000;
  const reconciled = [];
  const unknowns = [];
  for (const story of loggedStories(root)) {
    const events = readEvents(root, story);
    // A merged story is reconciled too: its own merge may be what was interrupted.
    for (const act of replay(events).open) {
      if (!stopped(act, events, { liveSessions, restartMs, now })) continue;
      const found = checkAct(root, act, base);
      if (found.found === 'unknown') {
        unknowns.push({ story, ...act, ...found });
        continue;
      }
      if (act.kind === 'merge' && found.found === 'done' && act.branch) {
        const entry = readQueue(root).find(
          (e) => e.branch === act.branch && ['waiting', 'merging'].includes(e.state),
        );
        if (entry) settle(root, act.branch, 'merged');
      }
      recordNote(
        root,
        {
          story,
          kind: 'reconciled',
          target: act.act,
          actor: 'code-kit',
          branch: act.branch,
          result: found,
        },
        now,
      );
      reconciled.push({ story, ...act, ...found });
    }
  }
  return { reconciled, unknowns };
}

/** The lead's own reconciliation of an act git couldn't settle: what it found, and how. */
export function recordFinding(root, story, act, found, how, now = Date.now()) {
  const open = replay(readEvents(root, story)).open.find((a) => a.act === act);
  if (!open) return null;
  return recordNote(
    root,
    {
      story,
      kind: 'reconciled',
      target: act,
      actor: 'lead',
      branch: open.branch,
      result: {
        found,
        how,
        next: found === 'done' ? 'carry on from it' : 'run it again if needed',
      },
    },
    now,
  );
}

// --- the hand-over brief (DUR-5) ------------------------------------------------------------------

const ago = (at, now) => {
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60000));
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/**
 * DUR-5: what the log says, for the brief of the agent that carries a story on: the last commit, the
 * tests last run, what changed since the commit, what was reconciled, and the last ten acts. With the
 * stopped agent's report's time, it says which is newer.
 */
export function briefOf(story, state, { now = Date.now(), reportAt = null } = {}) {
  const lines = [`What the log says about ${story}:`];
  if (state.trimmed) lines.push(`- (${state.trimmed} older events were trimmed.)`);
  lines.push(
    state.lastCommit
      ? `- Last commit: ${state.lastCommit.sha} (${ago(state.lastCommit.at, now)}).`
      : '- No commit recorded yet.',
  );
  if (state.lastTest)
    lines.push(
      `- Tests last run: \`${state.lastTest.target}\`, ${state.lastTest.ok ? 'passed' : 'failed'} (${ago(state.lastTest.at, now)}).`,
    );
  if (state.changed.length)
    lines.push(`- Changed since that commit: ${state.changed.join(', ')}. Re-read them first.`);
  for (const r of state.reconciled.slice(-5))
    lines.push(
      `- Reconciled: ${r.result?.found} (${r.result?.how}); ${r.result?.next ?? 'nothing to do'}.`,
    );
  for (const o of state.open)
    lines.push(`- Left open: ${o.kind} \`${o.target}\`, waiting on the lead's reconciliation.`);
  if (state.recent.length) {
    lines.push('- The last acts, oldest first:');
    for (const a of state.recent)
      lines.push(
        `  - ${a.kind} \`${a.target ?? ''}\`: ${a.result ? (a.result.ok === true ? 'ok' : a.result.ok === false ? `failed${a.result.error ? ` (${a.result.error})` : ''}` : a.result.reconciled ? `reconciled ${a.result.reconciled.found}` : 'ended without a result') : 'no result'}`,
      );
  }
  if (reportAt && state.lastAt)
    lines.push(
      Date.parse(state.lastAt) > Date.parse(reportAt)
        ? "- The log's last act came after the report: trust the log where they differ."
        : "- The report is newer than the log's last act.",
    );
  return lines.join('\n');
}

// --- keeping the logs (DUR-6) ---------------------------------------------------------------------

/** Removes the logs of stories merged more than KEEP_MERGED_MS ago; returns the stories removed. */
export function pruneLogs(root, { base = null, now = Date.now() } = {}) {
  const removed = [];
  for (const story of loggedStories(root)) {
    const state = replay(readEvents(root, story));
    if (
      state.lastAt &&
      now - Date.parse(state.lastAt) > KEEP_MERGED_MS &&
      isMerged(root, state, base)
    ) {
      rmSync(logFile(root, story), { force: true });
      removed.push(story);
    }
  }
  return removed;
}
