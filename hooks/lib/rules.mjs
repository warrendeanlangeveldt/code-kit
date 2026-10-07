// Who may write where, from the project's config. Shared by every hook.
//
// Actors:
// - a lane agent (its agent_type is a lane's "agent") writes only that lane's paths;
// - any other subagent (research, planning, review) is read-only;
// - the main session in a worktree with a .lane file acts as that lane (a person running a lane);
// - the main session otherwise is the lead, who writes the lead's paths and delegates the rest.
// Protected paths are recorded in the approval log whenever they are committed; only the lead may
// write them without a person's approval.
//
// Approvals live in the project's main checkout, so a lane working in its own worktree sees the ones a
// person gives at the lead's terminal. One for a lane (`<lane>/<name>`) serves that lane only; one
// without a lane serves every actor. A person gives one with a `!` shell command, or, where the config
// sets `approvals.lead` (a person on a phone has no `!`), by saying so in chat for the lead to record
// with `code-kit approve`.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPENDENCY_APPROVAL, isDependencyFile } from './dependencies.mjs';
import { globToRegExp, matchesAny } from './glob.mjs';

export const APPROVAL_LOG = '.claude/approval-log.jsonl';
export const APPROVALS_DIR = '.claude/approvals';
export const APPROVAL_MINUTES = 60;
// A dependency approval lasts until the lane commits the install it allows (the story may resume
// hours later), and at most a week, so a forgotten one doesn't linger.
export const DEPENDENCY_APPROVAL_DAYS = 7;

/** How long an approval named `name` lasts, in minutes. */
export const approvalMinutes = (name) =>
  String(name).startsWith(DEPENDENCY_APPROVAL)
    ? DEPENDENCY_APPROVAL_DAYS * 24 * 60
    : APPROVAL_MINUTES;

/** How long approvals for `names` last, in words. */
export function approvalLifetime(names) {
  const list = [names].flat();
  return list.every((n) => String(n).startsWith(DEPENDENCY_APPROVAL))
    ? `until the install is committed, at most ${DEPENDENCY_APPROVAL_DAYS} days`
    : `for ${APPROVAL_MINUTES} minutes`;
}
// Marks a worktree as a lane's, for a person running that lane; the lead creates it, and it is never work.
export const LANE_FILE = '.lane';
const NEVER_WRITABLE = [`${APPROVALS_DIR}/**`, APPROVAL_LOG];
export const CLI = fileURLToPath(new URL('../../bin/code-kit.mjs', import.meta.url));
// Marks an approval the lead recorded from chat, so the log shows how it was given.
export const RELAYED = '(given in chat, recorded by the lead)';
/** Marks an approval the person gave with a button in the code-kit pane (the mod). */
export const PANE = '(approved in the code-kit pane)';
/** Refusals a person's approval would allow, for the mod's band and `code-kit requests`. */
export const REQUESTS_FILE = '.claude/state/requests.jsonl';

/** The command the lead runs to record approvals a person gave in chat. */
/** Marks an approval the lead granted on its own, within `approvals.delegate`; `rule` names the rule. */
export const delegatedMark = (rule) => `(approved by the lead within the delegated rules: ${rule})`;

/** The command the lead runs to approve `names` itself, within the delegated rules. */
export const delegateCommand = (names, lane) =>
  `node "${CLI}" approve ${[names].flat().join(' ')}${lane ? ` --lane ${lane}` : ''} --delegated --reason "<why, for this story>"`;

export const relayCommand = (names, lane) =>
  `node "${CLI}" approve ${[names].flat().join(' ')}${lane ? ` --lane ${lane}` : ''} --reason "<the person's words>"`;

/**
 * The commands a person runs to approve `names` for `actor`, and what that allows. For a lane the
 * approval is that lane's; the folder is created here so the command works as written. With
 * `approvals.lead` on, the lead may record it instead, once the person approves in chat.
 */
export function approvalHowTo(names, actor, root, allows = 'these edits', config) {
  const dir = approvalsDir(root);
  const scoped = actor?.kind === 'lane' ? join(dir, actor.lane) : dir;
  try {
    mkdirSync(scoped, { recursive: true });
  } catch {
    // the command then fails visibly for the person, which says the same thing
  }
  const shown = relativeTo(projectDir(), scoped);
  const where = shown.startsWith('..') ? scoped : shown;
  const lines = [names].flat().map((n) => `  ! echo "<what you are approving>" > ${where}/${n}`);
  const whom = actor?.kind === 'lane' ? `the ${actor.lane} lane` : 'any agent';
  const relay = config?.approvals?.lead
    ? `\nOr, if the person approves in chat (no \`!\` on a phone), the lead records their words:\n  ${relayCommand(names, actor?.kind === 'lane' ? actor.lane : undefined)}`
    : '';
  const delegated = config?.approvals?.delegate
    ? `\nOr the lead approves it itself, if it's within the project's delegated rules (the command refuses anything outside them):\n  ${delegateCommand(names, actor?.kind === 'lane' ? actor.lane : undefined)}`
    : '';
  return (
    `${lines.join('\n')}\n` +
    `(a person runs it; the reason is recorded in ${APPROVAL_LOG}, and it allows ${allows} for ${whom}, ${approvalLifetime(names)})${relay}${delegated}`
  );
}

/** Records approvals a person gave in chat: the same files a `!` command writes, marked as relayed. */
export function grantApprovals(root, names, lane, reason, marks = {}) {
  const dir = lane ? join(approvalsDir(root), lane) : approvalsDir(root);
  mkdirSync(dir, { recursive: true });
  return names.map((name) => {
    const file = join(dir, name);
    writeFileSync(file, `${reason.trim()} ${marks[name] ?? RELAYED}\n`);
    return file;
  });
}

/** `path` with symlinks resolved, even if it doesn't exist yet (macOS /var → /private/var). */
export function realPath(path) {
  let dir = resolve(path);
  const rest = [];
  while (!existsSync(dir)) {
    rest.unshift(dir.slice(dirname(dir).length + 1));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

/** The session's project: the folder Claude Code was opened in. */
export const projectDir = () => realPath(process.env.CLAUDE_PROJECT_DIR || process.cwd());

/** The git worktree that contains `path` (walking up to an existing directory), or null. */
export function worktreeRoot(path) {
  let dir = resolve(path);
  while (!existsSync(dir)) dir = dirname(dir);
  if (statSync(dir).isFile()) dir = dirname(dir);
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return realPath(top.trim());
  } catch {
    return null;
  }
}

/** The project's worktrees: the main checkout plus any `git worktree add` or agent worktrees. */
export function projectWorktrees(project = projectDir()) {
  try {
    return execFileSync('git', ['-C', project, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => realPath(l.slice('worktree '.length)));
  } catch {
    return [project];
  }
}

/** The worktree of this project that the session's cwd is in, or null when it is elsewhere. */
export function sessionRoot(input, project = projectDir()) {
  const root = worktreeRoot(input.cwd || project);
  return root && projectWorktrees(project).includes(root) ? root : null;
}

/**
 * The checkout whose changes are this actor's own. A subagent works where its cwd is (often its own
 * worktree). The main session owns the checkout it was opened in, even when its shell has wandered
 * into an agent's worktree, whose in-progress edits are that agent's, not the lead's.
 */
export function actorRoot(input, project = projectDir()) {
  if (input.agent_type) return sessionRoot(input, project);
  return worktreeRoot(project) ?? project;
}

export const relativeTo = (root, path) =>
  relative(realPath(root), realPath(resolve(root, path)))
    .split('\\')
    .join('/');

export function currentBranch(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Who is acting: { kind: 'lead' | 'lane' | 'readonly', lane?, label }. */
export function actorFor(input, root, config) {
  const agent = input.agent_type;
  if (agent) {
    const lane = Object.keys(config.lanes).find((l) => config.lanes[l].agent === agent);
    return lane
      ? { kind: 'lane', lane, label: `${agent} (${lane} lane)` }
      : { kind: 'readonly', label: agent };
  }
  const laneFile = join(root, LANE_FILE);
  if (existsSync(laneFile)) {
    const lane = readFileSync(laneFile, 'utf8').trim();
    return { kind: 'lane', lane, label: `${lane} lane worktree` };
  }
  return { kind: 'lead', label: 'lead session' };
}

/** Where approvals live: the main checkout's approvals folder, shared by all of its worktrees. */
const approvalDirs = new Map();
export function approvalsDir(root) {
  if (!approvalDirs.has(root))
    approvalDirs.set(root, join(projectWorktrees(root)[0] ?? root, APPROVALS_DIR));
  return approvalDirs.get(root);
}

function ownedPaths(actor, config) {
  if (actor.kind === 'lead') return config.lead.paths;
  if (actor.kind === 'lane') return config.lanes[actor.lane]?.paths ?? [];
  return [];
}

/** Whether `rel` is the actor's own to write: its paths, or the paths any actor may write. */
export function owns(actor, rel, config) {
  if (actor.kind === 'readonly') return false;
  if (matchesAny(rel, config.anyActor)) return true;
  const excluded = actor.kind === 'lane' ? config.lanes[actor.lane]?.exclude : [];
  return matchesAny(rel, ownedPaths(actor, config)) && !matchesAny(rel, excluded);
}

/** An approval file's { reason, grantedAt } while fresh and explained, else null. */
function inForce(file) {
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const { mtimeMs } = statSync(file);
  if (Date.now() - mtimeMs >= approvalMinutes(basename(file)) * 60_000) return null;
  const reason = readFileSync(file, 'utf8').trim();
  return reason ? { reason, grantedAt: new Date(mtimeMs).toISOString() } : null;
}

/** The approval in force for `name` and `actor` (the actor's lane's own, or one for everyone), or null. */
export function approval(root, name, actor) {
  const dir = approvalsDir(root);
  const lane = actor?.kind === 'lane' ? inForce(join(dir, actor.lane, name)) : null;
  return lane ?? inForce(join(dir, name));
}

/** Uses up the approval in force for `name` and `actor`: a dependency approval, once its install is committed. */
export function useApproval(root, name, actor) {
  const dir = approvalsDir(root);
  for (const file of [
    ...(actor?.kind === 'lane' ? [join(dir, actor.lane, name)] : []),
    join(dir, name),
  ])
    if (inForce(file)) return rmSync(file, { force: true });
}

const requestsFile = (root) => join(projectWorktrees(root)[0] ?? root, REQUESTS_FILE);
const sameRequest = (a, b) =>
  a.actor === b.actor &&
  a.what === b.what &&
  [...a.names].sort().join() === [...b.names].sort().join();

/** Every request recorded, oldest first; unreadable lines are skipped. */
export function readRequests(root) {
  try {
    return readFileSync(requestsFile(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Records that `actor` was refused something the approvals `names` would allow, once: the same
 * actor, names and command or file within the approval lifetime count as one request. Recording
 * never changes the refusal, so any failure here is ignored.
 */
export function recordRequest(root, actor, names, what, why, now = Date.now()) {
  try {
    const request = {
      at: new Date(now).toISOString(),
      actor: actor?.label ?? 'unknown',
      ...(actor?.kind === 'lane' ? { lane: actor.lane } : {}),
      names: [names].flat(),
      what: String(what).slice(0, 200),
      why: String(why).slice(0, 300),
    };
    const fresh = readRequests(root).filter(
      (r) => now - Date.parse(r.at) < APPROVAL_MINUTES * 60_000,
    );
    if (fresh.some((r) => sameRequest(r, request))) return;
    const file = requestsFile(root);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(request)}\n`);
  } catch {
    // the refusal stands either way
  }
}

/** Requests from the last 60 minutes that an approval in force doesn't yet answer, newest first. */
export function openRequests(root, now = Date.now()) {
  const open = [];
  for (const r of readRequests(root).reverse()) {
    if (now - Date.parse(r.at) >= APPROVAL_MINUTES * 60_000) continue;
    if (open.some((o) => sameRequest(o, r))) continue;
    const actor = r.lane ? { kind: 'lane', lane: r.lane } : { kind: 'lead' };
    if (r.names.every((n) => approval(root, n, actor))) continue;
    open.push(r);
  }
  return open;
}

/** Approvals in force now: [{ name, lane?, reason, grantedAt, minutesLeft }]. */
export function approvalsInForce(root, now = Date.now()) {
  const dir = approvalsDir(root);
  const found = [];
  const look = (folder, lane) => {
    let names = [];
    try {
      names = readdirSync(folder);
    } catch {
      return;
    }
    for (const name of names) {
      const file = join(folder, name);
      if (statSync(file).isDirectory()) {
        if (!lane) look(file, name);
        continue;
      }
      const a = inForce(file);
      if (!a) continue;
      const left = approvalMinutes(name) - (now - Date.parse(a.grantedAt)) / 60_000;
      found.push({
        name,
        ...(lane ? { lane } : {}),
        ...a,
        minutesLeft: Math.max(0, Math.floor(left)),
      });
    }
  };
  look(dir);
  return found;
}

/** The dependency approvals in force for `actor`: [{ name, reason, grantedAt }]. */
export function dependencyGrants(root, actor) {
  if (actor?.kind === 'readonly') return [];
  const dir = approvalsDir(root);
  const names = (d) => {
    try {
      return readdirSync(d).filter((n) => n.startsWith(DEPENDENCY_APPROVAL));
    } catch {
      return [];
    }
  };
  const scoped = actor?.kind === 'lane' ? names(join(dir, actor.lane)) : [];
  return [...new Set([...scoped, ...names(dir)])]
    .map((name) => ({ name, ...approval(root, name, actor) }))
    .filter((g) => g.reason);
}

/**
 * During a merge, whether `rel` is exactly as the incoming branch (MERGE_HEAD) has it: then its change
 * arrives with that branch's history, approvals and audit-log entries, not from the actor concluding
 * the merge. `staged` compares what will be committed; otherwise the working tree. A file both sides
 * delete counts too. verify still holds the branch to its rules afterwards.
 */
export function arrivesWithMerge(root, rel, { staged = false } = {}) {
  const run = (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  if (run('rev-parse', '--verify', '--quiet', 'MERGE_HEAD') === null) return false;
  const incoming = run('rev-parse', '--verify', '--quiet', `MERGE_HEAD:${rel}`);
  const mine = staged
    ? run('rev-parse', '--verify', '--quiet', `:${rel}`)
    : existsSync(join(root, rel))
      ? run('hash-object', '--', rel)
      : null;
  return incoming === mine;
}

/**
 * Whether a dependency approval lets `actor` change `rel`: a manifest or lockfile no other lane owns,
 * changed while the actor has a dependency approval in force. Installing a package rewrites them.
 */
export function dependencyChange(actor, rel, root, config) {
  if (!isDependencyFile(rel) || actor.kind === 'readonly') return false;
  const owner = laneOf(rel, config);
  if (owner && !(actor.kind === 'lane' && owner === actor.lane)) return false;
  return dependencyGrants(root, actor).length > 0;
}

/** The protected entry a repo-relative path falls under, or undefined. The log and state are not. */
export function protectedEntry(rel, config) {
  if (rel === APPROVAL_LOG || matchesAny(rel, ['.claude/state/**'])) return undefined;
  return config.protected.find((p) => globToRegExp(p.glob).test(rel));
}

export const SECRETS = (rel) =>
  /(^|\/)\.env(\.|$)/.test(rel) ||
  /(^|\/)secrets?\//.test(rel) ||
  /\.(pem|p8|p12|keystore|jks)$/.test(rel);

/** Why `actor` may not write `rel` (relative to worktree `root`), or null if allowed. */
export function writeProblem(actor, rel, root, config) {
  const approvals = approvalsDir(root);
  const target = realPath(resolve(root, rel));
  if (target === approvals || target.startsWith(`${approvals}/`))
    return `${rel} is an approval. Only a person creates approvals, with a \`!\` shell command.`;
  if (rel.startsWith('..'))
    return outsideAllowed(actor, rel, root, config) ? null : `${rel} is outside the repository.`;
  if (SECRETS(rel))
    return `${rel} may hold secrets. Secrets never go in files an agent writes; use the secret store.`;
  if (rel === APPROVAL_LOG)
    return `${rel} is the approval audit log. Only the commit hook appends to it; nobody edits it.`;
  if (matchesAny(rel, NEVER_WRITABLE))
    return `${rel} is an approval. Only a person creates approvals, with a \`!\` shell command.`;
  // A package a person approved may change the manifests and lockfiles its install rewrites.
  if (dependencyChange(actor, rel, root, config)) return null;
  const guarded = protectedEntry(rel, config);
  // The lead writes protected files without an approval: the person reviews them in the pull request,
  // and every committed change is in the audit log. Anyone else needs a person's approval as well.
  if (guarded && actor.kind !== 'lead' && !approval(root, guarded.approval, actor)) {
    recordRequest(root, actor, guarded.approval, rel, guarded.why);
    return `${rel} is ${guarded.why} and needs a person's approval. Ask the lead (a person) to run\n${approvalHowTo(guarded.approval, actor, root, undefined, config)}`;
  }
  if (actor.kind === 'readonly') return `${actor.label} is read-only; it may not write ${rel}.`;
  if (matchesAny(rel, config.anyActor)) return null;
  if (!owns(actor, rel, config)) return ownershipProblem(actor, rel, config);
  const specs = actor.kind === 'lane' && config.docs?.specs;
  return (specs && specCheckProblem(rel, root)) || screenProblem(rel, root, config);
}

function outsideAllowed(actor, rel, root, config) {
  if (actor.kind !== 'lead') return false;
  const target = resolve(root, rel);
  return config.lead.outside.some((g) =>
    globToRegExp(resolve(root, g.replace(/^~(?=\/)/, homedir()))).test(target),
  );
}

function ownershipProblem(actor, rel, config) {
  const owner = ownerOf(rel, config);
  const where = owner ? ` (owned by the ${owner}).` : '.';
  const next =
    actor.kind === 'lead'
      ? `\nDelegate it: use the ${owner ?? 'matching'} agent, ideally in its own worktree.`
      : `\nWrite a short change request for the lead instead, and stop.`;
  return `The ${actor.label} may not write ${rel}${where}${next}`;
}

/** The lane whose paths hold `rel`, or null. */
export function laneOf(rel, config) {
  return (
    Object.entries(config.lanes).find(
      ([, { paths, exclude }]) => matchesAny(rel, paths) && !matchesAny(rel, exclude),
    )?.[0] ?? null
  );
}

/** Who reviews a change to a file any agent may write: the lane an anyActor entry names, else the lead. Null for other files. */
export function reviewerOf(rel, config) {
  if (!matchesAny(rel, config.anyActor)) return null;
  const named = (config.anyActorReviewers ?? []).find((e) => matchesAny(rel, [e.glob]));
  return named?.reviewer ?? 'lead';
}

export function ownerOf(rel, config) {
  const lane = laneOf(rel, config);
  if (lane) return `${lane} lane / ${config.lanes[lane].agent}`;
  return matchesAny(rel, config.lead.paths) ? 'lead' : null;
}

// Lane work starts with the spec-check skill: its report for the branch must exist first.
export function specCheckPath(root) {
  return `.claude/state/spec-check/${currentBranch(root).replace(/[^\w.-]+/g, '_')}.md`;
}

function specCheckProblem(rel, root) {
  let report;
  try {
    report = specCheckPath(root);
  } catch {
    return null; // not a git worktree: nothing to key the report on
  }
  if (rel === report) return null;
  const file = join(root, report);
  if (existsSync(file) && /\|\s*Requirement\s*\|/i.test(readFileSync(file, 'utf8'))) return null;
  return `Run the spec-check skill before writing code on this branch. Save its report (the requirement table, questions and recommendation) to ${report}, then continue.`;
}

// Screens are designed first: a screen file can be written once the register lists it.
export function screenProblem(rel, root, config) {
  const gate = config.designGate;
  if (!gate) return null;
  const isScreen = gate.screens.some(
    (s) => globToRegExp(s.glob).test(rel) && !(s.not && new RegExp(s.not).test(rel)),
  );
  if (!isScreen) return null;
  let screens;
  try {
    screens = JSON.parse(readFileSync(join(root, gate.register), 'utf8')).screens ?? [];
  } catch {
    return `${gate.register} is missing or invalid, so no screen can be built yet.`;
  }
  if (screens.some((s) => s.file === rel)) return null;
  return `${rel} is a screen, and its design is not approved yet.\n${gate.howTo}\nOnce a person approves it, the lead adds { "file": "${rel}", ... } to ${gate.register}.`;
}
