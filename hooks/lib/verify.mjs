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
import { entryProblems, readRegister } from './designs.mjs';
import { matchesAny } from './glob.mjs';
import { layerProblems } from './layers.mjs';
import { STANDARDS_APPROVAL, standardsFile, standardsWeakenings } from './standards.mjs';
import { TESTS_APPROVAL, branchWeakenings, fixOf, proveFix } from './regression.mjs';
import {
  APPROVAL_LOG,
  SECRETS,
  laneOf,
  ownerOf,
  owns,
  protectedEntry,
  leadNeedsApproval,
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

/**
 * Files changed on this branch since it left `base`, and still different from `base` as it is now. A
 * branch with two merge bases (it merged the base, and something it holds later reached the base too)
 * can show a file from an older one as changed; one it holds exactly as the base does isn't its change.
 */
export function branchChanges(root, base) {
  const names = (range) =>
    git(root, 'diff', '--name-only', '--no-renames', range).split('\n').filter(Boolean);
  const differs = new Set(names(`${base}..HEAD`));
  return names(`${base}...HEAD`).filter((f) => differs.has(f));
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

/** The branch checked out at `root`, or null when HEAD is detached. */
function currentBranchOf(root) {
  try {
    const name = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    return name === 'HEAD' ? null : name;
  } catch {
    return null;
  }
}

// The runtime's own noise, which says nothing about whether the check passed (#57).
const NOISE = [
  /^\(node:\d+\) \[?\w*\]? ?(DeprecationWarning|ExperimentalWarning|Warning)\b/,
  /^\(Use `node --trace-(deprecation|warnings) /,
  /^\s*$/,
];
const FAILING = /\b(fail(ed|ing|s)?|error|✗|✘|×|expected|received|assert|panic|traceback)\b/i;

/**
 * What a failed check printed, as the lead needs it (#57): the runtime's warnings left out, the lines
 * that name a failure first (up to 20), then the last 20 lines.
 */
export function failureOutput(output) {
  const lines = String(output ?? '')
    .split('\n')
    .filter((l) => !NOISE.some((re) => re.test(l)));
  const tail = lines.slice(-20);
  const named = lines.filter((l) => FAILING.test(l) && !tail.includes(l)).slice(0, 20);
  return [...named, ...(named.length ? ['…'] : []), ...tail].join('\n');
}

/**
 * The files changed, every problem with the branch, grouped as { ownership, protected, layers,
 * baseline, design, tests, regression, standards, checks }, and the checks `skipped` because a tool isn't
 * installed. `lane` holds the branch to that lane's paths; `checks: false` leaves the project's
 * checks to CI's own steps. `fixes` runs a fix's tests without the fix (REG-1; with the
 * checks unless said); `branch` names the branch when the checkout is detached.
 */
export function verifyBranch({
  root,
  base,
  config,
  lane = null,
  checks = true,
  fixes = checks,
  branch = null,
}) {
  // Where the branch left the base: the base may have moved on since (new log entries, a smaller baseline).
  const from = git(root, 'merge-base', base, 'HEAD').trim();
  const changed = branchChanges(root, base);
  const present = changed.filter((f) => existsSync(join(root, f)));
  const found = {
    ownership: [],
    protected: [],
    layers: [],
    baseline: [],
    design: [],
    tests: [],
    regression: [],
    standards: [],
    checks: [],
  };
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
    // WHO-1: where the lead merges, its own change to what the person keeps needs the person's approval,
    // unless the base already holds it as the branch does (the setup's rules, put onto the base first).
    else if (
      guarded &&
      logged.get(f)?.approval === 'lead' &&
      !signed &&
      leadNeedsApproval(guarded.approval, config) &&
      showAt(root, base, f) !== showAt(root, 'HEAD', f)
    )
      found.protected.push(
        `${f} is ${guarded.why}, and the lead changed it without the person's ${guarded.approval} approval. The lead merges here, so nobody else reviews it: ask the person, and commit it again once their approval is in force.`,
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

  // HAND-2: each register entry the branch adds or changes, and each approved design whose files it
  // changed, names the approved files with their hashes, every state the spec lists.
  const register = config.designGate?.register;
  if (register) {
    const old = readRegister(root, config, showAt(root, from, register) ?? '{}').entries;
    const touched = new Set(changed);
    for (const e of readRegister(root, config).entries) {
      const fresh = !old.some((o) => JSON.stringify(o) === JSON.stringify(e));
      const files = (e.states ?? []).flatMap((st) => [st?.image, st?.code]).filter(Boolean);
      if (fresh || files.some((f) => touched.has(f)))
        found.design.push(...entryProblems(root, e, config.docs?.specs));
    }
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

  // REG-2: a test weakened on the branch needs the person's `tests` approval, logged by the commit.
  for (const w of branchWeakenings(root, from, config)) {
    const approved = entries.some((e) => e.file === w.file && e.approval === TESTS_APPROVAL);
    if (!approved)
      found.tests.push(
        `${w.file} ${w.reasons.join(', and ')}. A weakened test can hide a regression, so it needs the person's tests approval, which the commit records in ${APPROVAL_LOG}. Restore the test and fix the code, or ask the person.`,
      );
  }

  // STD-5: removing a standard, or weakening a required one, needs the person's standards approval,
  // which the commit records in the log (the lead's own, delegated or not, doesn't count).
  const stdFile = standardsFile(config);
  if (changed.includes(stdFile)) {
    const weakened = standardsWeakenings(
      showAt(root, from, stdFile) ?? '',
      showAt(root, 'HEAD', stdFile) ?? '',
    );
    const approved = entries.some(
      (e) =>
        e.file === stdFile &&
        e.approval === STANDARDS_APPROVAL &&
        !String(e.reason ?? '').includes('approved by the lead within the delegated rules'),
    );
    if (weakened.length && !approved)
      found.standards.push(
        `${stdFile}: ${weakened.join('; ')}. Removing a standard, or weakening a required one, needs the person's standards approval, which the commit records in ${APPROVAL_LOG}. Restore it, or ask the person.`,
      );
  }

  // REG-1: a fix's tests fail without it, as the bug.
  const fix = fixes ? fixOf(root, branch ?? currentBranchOf(root), config) : null;
  if (fix) found.regression.push(...proveFix({ root, from, base, changed, config, fix }));

  let skipped = [];
  let unfinished = false;
  if (checks) {
    const actor = lane
      ? { kind: 'lane', lane, label: `${lane} lane branch` }
      : { kind: 'lead', label: 'lead' };
    const ran = runChecks(config, changed, root, actor);
    skipped = ran.skipped;
    const { failure } = ran;
    if (failure) {
      found.checks.push(`${failure.title}\n${failureOutput(failure.output)}`.trim());
      unfinished = Boolean(failure.timedOut);
    }
  }
  return { changed, found, skipped, unfinished };
}
