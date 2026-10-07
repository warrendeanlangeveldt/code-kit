// The rules for a branch's changes as a whole, for CI and the lead's review: the hooks only see work
// done in Claude Code sessions, so a person's commits or another tool would otherwise go unchecked.
// Everything is judged from git (base...HEAD), except the checks, which run in the checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_FILE, loadBaseline, newProblems } from './baseline.mjs';
import { runChecks } from './checks.mjs';
import { CONFIG_FILE } from './config.mjs';
import { isDependencyFile } from './dependencies.mjs';
import { matchesAny } from './glob.mjs';
import { layerProblems } from './layers.mjs';
import {
  APPROVAL_LOG,
  SECRETS,
  laneOf,
  ownerOf,
  owns,
  protectedEntry,
  screenProblem,
} from './rules.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

/** A file's content at `ref`, or null when it doesn't exist there. */
function showAt(root, ref, rel) {
  try {
    return git(root, 'show', `${ref}:${rel}`);
  } catch {
    return null;
  }
}

/** The lane a branch belongs to by its name (`<lane>/<story>`), or null. */
export function laneOfBranch(branch, config) {
  const lane = branch?.split('/')[0];
  if (lane === 'lead') return 'lead';
  return lane && config.lanes[lane] ? lane : null;
}

/** What verify holds a branch to, in words: a lane's paths, or the lead's. */
export const heldTo = (lane) => (lane === 'lead' ? "the lead's paths" : `the ${lane} lane`);

/**
 * Files changed by commits made on the branch itself (first parents, merges left out): on the lead's
 * branch, what the lead wrote, as distinct from lane work it merged in after review.
 */
function directChanges(root, from) {
  const out = git(
    root,
    'log',
    '--first-parent',
    '--no-merges',
    '--format=',
    '--name-only',
    `${from}..HEAD`,
  );
  return new Set(out.split('\n').filter(Boolean));
}

/** Files changed on this branch since it left `base`. */
export function branchChanges(root, base) {
  return git(root, 'diff', '--name-only', '--no-renames', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean);
}

/**
 * The lines added to the log between `before` and `after`, or null if any earlier line was changed,
 * removed or reordered. Every earlier line must still be there, in order; new lines may sit between
 * them, because `merge=union` (see the README) puts a branch's own entries before the ones the base
 * gained after the branch left it.
 */
export function addedLogLines(before, after) {
  const old = before.split('\n').filter(Boolean);
  const added = [];
  let i = 0;
  for (const line of after.split('\n').filter(Boolean)) {
    if (i < old.length && line === old[i]) i++;
    else added.push(line);
  }
  return i === old.length ? added : null;
}

/** Entries appended to the approval log since commit `from`, plus problems if it was rewritten. */
function logEntries(root, base) {
  const before = showAt(root, base, APPROVAL_LOG) ?? '';
  const after = showAt(root, 'HEAD', APPROVAL_LOG) ?? '';
  const added = addedLogLines(before, after);
  if (added === null)
    return {
      entries: [],
      problems: [`${APPROVAL_LOG} was edited, not appended to; it is append-only.`],
    };
  const entries = [];
  const problems = [];
  for (const line of added) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      problems.push(`${APPROVAL_LOG} has an entry that isn't valid JSON: ${line.slice(0, 80)}`);
    }
  }
  return { entries, problems };
}

/**
 * Whether every commit since `from` that changed `file` carries the trailer a protected entry names as
 * a person's signature (`signedBy`, a pattern for one line of the message). A person's own commit from
 * their terminal never passes through the hooks, so for such files the signature stands in for the log.
 */
function signedByPerson(root, from, file, signedBy) {
  if (!signedBy) return false;
  const out = git(root, 'log', '--format=%B%x1e', `${from}..HEAD`, '--', file);
  const messages = out
    .split('\x1e')
    .map((m) => m.trim())
    .filter(Boolean);
  const line = new RegExp(signedBy, 'm');
  return messages.length > 0 && messages.every((m) => line.test(m));
}

/**
 * Secrets anywhere in the branch's history, not only in the files as they end up: a secret committed
 * and then deleted is still in the commits that merge. Names that look like secret files, from every
 * commit; and, where gitleaks is installed, what it finds in the commits' content.
 */
function historySecrets(root, from, changed) {
  const problems = [];
  const touched = git(root, 'log', '--format=', '--name-only', `${from}..HEAD`)
    .split('\n')
    .filter(Boolean);
  for (const f of new Set(touched))
    if (SECRETS(f) && !changed.includes(f))
      problems.push(
        `${f} may hold secrets, and it's in this branch's history even though it's gone now. Rewrite the history without it before it merges.`,
      );
  const scan = spawnSync(
    'gitleaks',
    ['detect', '--source', root, `--log-opts=${from}..HEAD`, '--redact', '--no-banner'],
    { encoding: 'utf8' },
  );
  if (scan.error?.code !== 'ENOENT' && scan.status === 1)
    problems.push(
      `gitleaks found possible secrets in this branch's commits:\n${`${scan.stdout}${scan.stderr}`.trim()}`,
    );
  return problems;
}

/**
 * Every problem with the branch, grouped: { ownership, protected, layers, baseline, design, checks }.
 * `lane` holds the branch to that lane's paths; `checks: false` leaves the project's checks to CI's
 * own steps.
 */
export function verifyBranch({ root, base, config, lane = null, checks = true }) {
  // Where the branch left the base: the base may have moved on since (new log entries, a smaller baseline).
  const from = git(root, 'merge-base', base, 'HEAD').trim();
  const changed = branchChanges(root, base);
  const present = changed.filter((f) => existsSync(join(root, f)));
  const found = { ownership: [], protected: [], layers: [], baseline: [], design: [], checks: [] };
  const { entries, problems: logProblems } = logEntries(root, from);
  found.protected.push(...logProblems);
  const logged = new Map(entries.map((e) => [e.file, e]));
  const direct = lane === 'lead' ? directChanges(root, from) : null;

  found.ownership.push(...historySecrets(root, from, changed));
  for (const f of changed) {
    if (SECRETS(f))
      found.ownership.push(`${f} may hold secrets; secrets never go in the repository.`);
    if (f === APPROVAL_LOG) continue;
    const guarded = protectedEntry(f, config);
    const signed = guarded && !logged.has(f) && signedByPerson(root, from, f, guarded.signedBy);
    if (guarded && !logged.has(f) && !signed)
      found.protected.push(
        `${f} is ${guarded.why}, but no approval-log entry records this change. Protected files are committed through Claude Code with code-kit, which logs them.`,
      );
    if (matchesAny(f, config.anyActor)) continue;
    if (lane === 'lead') {
      // The lead's branch is held to the lead's paths for what it changes itself; lane work reaches it
      // by merging the lane's branch, which verify held to that lane.
      if (!direct.has(f)) continue;
      const entry = logged.get(f);
      const approved =
        (guarded && entry?.approval === guarded.approval) ||
        signed ||
        (isDependencyFile(f) && entry?.approval === 'dependency');
      if (!owns({ kind: 'lead' }, f, config) && !approved)
        found.ownership.push(
          `${f}: changed by a commit on the lead's branch, but the lead doesn't own it (owner: ${ownerOf(f, config) ?? 'nobody'}). Lane work comes in by merging the lane's reviewed branch.`,
        );
    } else if (lane) {
      const { paths, exclude } = config.lanes[lane];
      const own = matchesAny(f, paths) && !matchesAny(f, exclude);
      const entry = logged.get(f);
      // A manifest or lockfile no other lane owns, logged under a person's dependency approval.
      const dependency =
        isDependencyFile(f) &&
        entry?.approval === 'dependency' &&
        [null, lane].includes(laneOf(f, config));
      const approved = (guarded && entry?.approval === guarded.approval) || signed || dependency;
      if (!own && !approved)
        found.ownership.push(
          `${f}: the ${lane} lane doesn't own it (owner: ${ownerOf(f, config) ?? 'nobody'}).`,
        );
    } else if (!ownerOf(f, config)) {
      found.ownership.push(`${f}: nobody owns it, so nobody may change it.`);
    }
  }

  const baseline = loadBaseline(root);
  for (const f of present) {
    found.layers.push(
      ...newProblems(f, layerProblems(f, readFileSync(join(root, f), 'utf8'), config), baseline),
    );
    const screen = screenProblem(f, root, config);
    if (screen) found.design.push(screen.split('\n')[0]);
  }

  // The baseline only shrinks once the kit is adopted (the adopting change may record it).
  if (showAt(root, from, CONFIG_FILE) !== null) {
    let before = {};
    try {
      before = JSON.parse(showAt(root, from, BASELINE_FILE) ?? '{}').layers ?? {};
    } catch {
      // an unreadable baseline excused nothing
    }
    for (const [f, problems] of Object.entries(baseline.layers))
      for (const p of problems)
        if (!(before[f] ?? []).includes(p))
          found.baseline.push(`${BASELINE_FILE} gained ${p}; it only shrinks.`);
  }

  if (checks) {
    const actor = lane
      ? { kind: 'lane', lane, label: `${lane} lane branch` }
      : { kind: 'lead', label: 'lead' };
    const failure = runChecks(config, changed, root, actor);
    if (failure)
      found.checks.push(
        `${failure.title}\n${String(failure.output ?? '')
          .split('\n')
          .slice(-40)
          .join('\n')}`.trim(),
      );
  }
  return { changed, found };
}
