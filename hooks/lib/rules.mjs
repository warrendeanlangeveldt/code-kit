// Who may write where, from the project's config. Shared by every hook.
//
// Actors:
// - a lane agent (its agent_type is a lane's "agent") writes only that lane's paths;
// - any other subagent (research, planning, review) is read-only;
// - the main session in a worktree with a .lane file acts as that lane (a person running a lane);
// - the main session otherwise is the lead, who writes the lead's paths and delegates the rest.
// Protected paths are recorded in the approval log whenever they are committed; only the lead may
// write them without a person's approval.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { globToRegExp, matchesAny } from './glob.mjs';

export const APPROVAL_LOG = '.claude/approval-log.jsonl';
export const APPROVALS_DIR = '.claude/approvals';
export const APPROVAL_MINUTES = 60;
const NEVER_WRITABLE = [`${APPROVALS_DIR}/**`, APPROVAL_LOG];

export const approvalHowTo = (name) =>
  `  ! echo "<what you are approving>" > ${APPROVALS_DIR}/${name}\n` +
  `(a person runs it; the reason is recorded in ${APPROVAL_LOG}, and it allows these edits for ${APPROVAL_MINUTES} minutes)`;

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
  const laneFile = join(root, '.lane');
  if (existsSync(laneFile)) {
    const lane = readFileSync(laneFile, 'utf8').trim();
    return { kind: 'lane', lane, label: `${lane} lane worktree` };
  }
  return { kind: 'lead', label: 'lead session' };
}

function ownedPaths(actor, config) {
  if (actor.kind === 'lead') return config.lead.paths;
  if (actor.kind === 'lane') return config.lanes[actor.lane]?.paths ?? [];
  return [];
}

/** The approval in force for `name`: { reason, grantedAt } while fresh and explained, else null. */
export function approval(root, name) {
  const file = join(root, APPROVALS_DIR, name);
  if (!existsSync(file)) return null;
  const { mtimeMs } = statSync(file);
  if (Date.now() - mtimeMs >= APPROVAL_MINUTES * 60_000) return null;
  const reason = readFileSync(file, 'utf8').trim();
  return reason ? { reason, grantedAt: new Date(mtimeMs).toISOString() } : null;
}

/** The protected entry a repo-relative path falls under, or undefined. The log and state are not. */
export function protectedEntry(rel, config) {
  if (rel === APPROVAL_LOG || matchesAny(rel, ['.claude/state/**'])) return undefined;
  return config.protected.find((p) => globToRegExp(p.glob).test(rel));
}

const SECRETS = (rel) =>
  /(^|\/)\.env(\.|$)/.test(rel) ||
  /(^|\/)secrets?\//.test(rel) ||
  /\.(pem|p8|p12|keystore|jks)$/.test(rel);

/** Why `actor` may not write `rel` (relative to worktree `root`), or null if allowed. */
export function writeProblem(actor, rel, root, config) {
  if (rel.startsWith('..'))
    return outsideAllowed(actor, rel, root, config) ? null : `${rel} is outside the repository.`;
  if (SECRETS(rel))
    return `${rel} may hold secrets. Secrets never go in files an agent writes; use the secret store.`;
  if (rel === APPROVAL_LOG)
    return `${rel} is the approval audit log. Only the commit hook appends to it; nobody edits it.`;
  if (matchesAny(rel, NEVER_WRITABLE))
    return `${rel} is an approval. Only a person creates approvals, with a \`!\` shell command.`;
  const guarded = protectedEntry(rel, config);
  // The lead writes protected files without an approval: the person reviews them in the pull request,
  // and every committed change is in the audit log. Anyone else needs a person's approval as well.
  if (guarded && actor.kind !== 'lead' && !approval(root, guarded.approval)) {
    return `${rel} is ${guarded.why} and needs a person's approval. Ask the lead (a person) to run\n${approvalHowTo(guarded.approval)}`;
  }
  if (actor.kind === 'readonly') return `${actor.label} is read-only; it may not write ${rel}.`;
  if (matchesAny(rel, config.anyActor)) return null;
  const excluded = actor.kind === 'lane' ? config.lanes[actor.lane]?.exclude : [];
  if (!matchesAny(rel, ownedPaths(actor, config)) || matchesAny(rel, excluded))
    return ownershipProblem(actor, rel, config);
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

export function ownerOf(rel, config) {
  for (const [lane, { paths, exclude, agent }] of Object.entries(config.lanes)) {
    if (matchesAny(rel, paths) && !matchesAny(rel, exclude)) return `${lane} lane / ${agent}`;
  }
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
function screenProblem(rel, root, config) {
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
