// Sessions as members of the team (docs/specs/23-the-team.md, SESS-1 to SESS-5). Several Claude Code
// sessions can work one project at once; each is a member, the person and the session, as spec 16 makes
// each developer one. One is the lead session (the loop runs there, dispatches start from it); the rest
// are working sessions, which stay quiet and record an ad hoc task, with the paths it leases, before
// they change code. A session's id is Claude Code's: `session_id` in hooks, `$.session.id()` in the mod,
// `CLAUDE_CODE_SESSION_ID` in every command an agent runs. Kept in the main checkout, one file per session,
// so every session and worktree on the machine reads the same: this is the local provider of SESS-1.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { CLI, projectWorktrees } from './rules.mjs';
import { shortSession } from './laneclaims.mjs';
import { isHandle } from './teamfacts.mjs';

export { shortSession };
export const SESSIONS_DIR = '.claude/state/sessions';
/** A session seen within this is live; one not seen for longer has ended, whether or not it said so. */
export const SESSION_LIVE_MS = 15 * 60_000;
/** Hooks note that a session is still there at most this often. */
const SEEN_EVERY_MS = 60_000;
/** The uncommitted files a session wrote, kept for SESS-5: at most this many. */
const WROTE_KEPT = 500;
/** The file a session edits is noted again at most this often, unless it's another file. */
const EDITING_EVERY_MS = 30_000;
/** The code-kit a session runs, as it starts: the plugin can be updated while other sessions run. */
const KIT_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return null;
  }
})();

const main = (root) => projectWorktrees(root)[0] ?? root;
const dirOf = (root) => join(main(root), SESSIONS_DIR);
const safe = (id) => String(id).replace(/[^\w.-]/g, '_');
const fileOf = (root, id) => join(dirOf(root), `${safe(id)}.json`);

/** The person at this machine by their GitHub login, when code-kit has it cached, or null. */
export function loginHere(root) {
  try {
    const cached = JSON.parse(readFileSync(join(main(root), '.claude/state/whoami.json'), 'utf8'));
    if (isHandle(cached?.login)) return cached.login;
  } catch {
    // not cached
  }
  return null;
}

/** The person at this machine: their GitHub login if code-kit has it cached, or the OS user. */
export function personHere(root) {
  const login = loginHere(root);
  if (login) return login;
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

/** SESS-1: who a claim, approval, question or decision belongs to: `<person>/<short id>`. */
export const memberOf = (record) =>
  record ? `${record.person ?? 'someone'}/${shortSession(record.id)}` : null;

export function readSession(root, id) {
  if (!id) return null;
  try {
    return JSON.parse(readFileSync(fileOf(root, id), 'utf8'));
  } catch {
    return null;
  }
}

function write(root, record) {
  mkdirSync(dirOf(root), { recursive: true });
  writeFileSync(fileOf(root, record.id), `${JSON.stringify(record)}\n`);
  return record;
}

const isLive = (r, now) => !r.ended && now - Date.parse(r.seen ?? r.started) < SESSION_LIVE_MS;

/** Every session the project has seen: [{ ...record, live }], the newest first. */
export function sessions(root, now = Date.now()) {
  let files = [];
  try {
    files = readdirSync(dirOf(root)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .flatMap((f) => {
      try {
        const r = JSON.parse(readFileSync(join(dirOf(root), f), 'utf8'));
        return r?.id ? [{ ...r, live: isLive(r, now) }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(b.started) - Date.parse(a.started));
}

/** SESS-2: the live lead session, or null. */
export const leadSession = (root, now = Date.now()) =>
  sessions(root, now).find((s) => s.live && s.role === 'lead') ?? null;

/**
 * SESS-2: a session starting (or resumed). It's the lead when no other live session is; otherwise a
 * working session. A resumed session keeps the role it had, unless it was the lead and another session
 * has led since. `model` is the model it runs on, when Claude Code says (SessionStart's `model`); the
 * session also keeps its person's GitHub login, when code-kit knows it, and the code-kit it runs.
 */
export function startSession(root, id, now = Date.now(), { model = null } = {}) {
  const at = new Date(now).toISOString();
  const had = readSession(root, id);
  const lead = leadSession(root, now);
  return write(root, {
    id,
    person: had?.person ?? personHere(root),
    login: loginHere(root) ?? had?.login ?? null,
    role: lead && lead.id !== id ? 'working' : 'lead',
    started: had?.started ?? at,
    seen: at,
    ended: null,
    task: had?.task ?? null,
    wrote: had?.wrote ?? [],
    model: model ?? had?.model ?? null,
    codeKit: KIT_VERSION,
    editing: had?.editing ?? null,
  });
}

/**
 * A hook saw the session act: it's still there. A session code-kit hadn't seen starts here. `facts()`
 * gives what's read only when the record is written (the model it runs on now), at most once a minute.
 */
export function seeSession(root, id, now = Date.now(), facts = () => ({})) {
  if (!id) return null;
  const had = readSession(root, id);
  if (!had || had.ended) return startSession(root, id, now, facts());
  // A lead that went quiet past SESSION_LIVE_MS, while another session took the lead, works now.
  const lead = had.role === 'lead' ? leadSession(root, now) : null;
  const demoted = lead && lead.id !== id;
  if (!demoted && now - Date.parse(had.seen) < SEEN_EVERY_MS) return had;
  const { model } = facts();
  return write(root, {
    ...had,
    seen: new Date(now).toISOString(),
    ...(demoted ? { role: 'working' } : {}),
    ...(model ? { model } : {}),
  });
}

/**
 * The file the session last edited, in any of the project's checkouts: { path, at }, for the team
 * provider's presence and the report. `rel` is relative to the checkout it's in.
 */
export function noteEditing(root, id, rel, now = Date.now()) {
  if (!id || !rel) return;
  const had = readSession(root, id) ?? startSession(root, id, now);
  const was = had.editing;
  if (was?.path === rel && now - Date.parse(was.at) < EDITING_EVERY_MS) return;
  write(root, { ...had, editing: { path: rel, at: new Date(now).toISOString() } });
}

/** The session ended: it's no longer live, and leads nothing. Its task stays, stale, for SESS-4. */
export function endSession(root, id, now = Date.now()) {
  const had = readSession(root, id);
  if (!had) return null;
  return write(root, { ...had, ended: new Date(now).toISOString() });
}

/** SESS-2: the person chose this session to lead: it does, and the session that led becomes a working one. */
export function makeLead(root, id, now = Date.now()) {
  for (const s of sessions(root, now))
    if (s.role === 'lead' && s.id !== id) write(root, { ...strip(s), role: 'working' });
  const had = readSession(root, id) ?? startSession(root, id, now);
  return write(root, { ...had, role: 'lead', seen: new Date(now).toISOString(), ended: null });
}

const strip = ({ live: _live, ...r }) => r;

/** SESS-4: the session's task: { title, paths, branch, started }, or null to end it. */
export function setTask(root, id, task, now = Date.now()) {
  const had = readSession(root, id) ?? startSession(root, id, now);
  return write(root, {
    ...had,
    task: task ? { ...task, started: had.task?.started ?? new Date(now).toISOString() } : null,
  });
}

/**
 * SESS-4: `taker` takes over the task of the session `from` (by its id or short id): the task, and its
 * decisions with it (OWN-4), move to the session running the command. { ok, task, from } or { ok: false, why }.
 */
export function takeTask(root, from, taker, now = Date.now()) {
  const source = sessions(root, now).find((s) => s.id === from || shortSession(s.id) === from);
  if (!source?.task) return { ok: false, why: `No session ${from} has a task.` };
  if (source.id === taker) return { ok: false, why: 'That task is already this session’s.' };
  if (source.live)
    return {
      ok: false,
      why: `Session ${shortSession(source.id)} is still working on it; ask it to finish with \`code-kit task done\` first.`,
    };
  write(root, { ...strip(source), task: null });
  const took = setTask(root, taker, source.task, now);
  // OWN-4: the task's decisions come with it.
  write(root, {
    ...took,
    took: [...new Set([...(took.took ?? []), source.id, ...(source.took ?? [])])],
  });
  return { ok: true, task: source.task, from: source };
}

/**
 * SESS-4: why `session` may not write `rel`, because another live session's task leases it, or null.
 * A stale task (its session has ended) leases nothing.
 */
export function taskRefusal(root, session, rel, now = Date.now()) {
  const other = sessions(root, now).find(
    (s) => s.live && s.id !== session && s.task?.paths?.length && matchesAny(rel, s.task.paths),
  );
  if (!other) return null;
  return `${rel} is leased by another session (${memberOf(other)}), working on "${other.task.title}". Leave it to that session, wait until it finishes (\`code-kit task done\` there), or work on something else.`;
}

/** SESS-5: a file a session wrote in a checkout, kept while it may still be uncommitted. */
export function noteWrite(root, id, rel, now = Date.now()) {
  if (!id || !rel) return;
  const had = readSession(root, id) ?? startSession(root, id, now);
  const wrote = [rel, ...(had.wrote ?? []).filter((f) => f !== rel)].slice(0, WROTE_KEPT);
  if (wrote.join('\n') === (had.wrote ?? []).join('\n')) return;
  write(root, { ...had, wrote });
}

/** SESS-5: the sessions, other than `session`, that wrote each of `files`: { file: [record] }. */
export function writersOf(root, files, session = null, now = Date.now()) {
  const all = sessions(root, now).filter((s) => s.id !== session);
  return Object.fromEntries(
    files
      .map((f) => [f, all.filter((s) => (s.wrote ?? []).includes(f))])
      .filter(([, w]) => w.length),
  );
}

/**
 * SESS-4, SESS-5: why this write may not happen because of the sessions working the project, or null.
 * Another live session's task leases the path; or this is a working session's own main agent, which
 * writes in a worktree of its own (the main checkout is every session's) and records its task first.
 * code-kit's state, and paths outside the project, are never held back.
 */
export function sessionWriteProblem({ project, root, rel, actor, session, now = Date.now() }) {
  if (!session || !rel || rel.startsWith('..') || rel.startsWith('.claude/state/')) return null;
  const leased = taskRefusal(project, session, rel, now);
  if (leased) return leased;
  const me = readSession(project, session);
  if (actor?.kind !== 'lead' || me?.role !== 'working') return null;
  if (root === main(project))
    return `this is a working session (another session leads the project), and ${rel} is in the main checkout, which every session shares: your uncommitted files there would block the other sessions' git. Work in a worktree of your own: start the session with \`claude --worktree\`, or move it into one (EnterWorktree), then record your task and go on.`;
  if (!me.task)
    return `this is a working session (another session leads the project): record what you're doing before you change code, so the other sessions see it and leave your files alone:\n  node "${CLI}" task "<what you're doing, in a line>" --touches "<globs of the paths you'll change>"`;
  return null;
}
