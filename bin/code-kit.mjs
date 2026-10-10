#!/usr/bin/env node
// Run from the project root: node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" <command>
//   check [--json]        validate the config and summarise it
//   who <path>...         who may write each path, and its layer
//   unowned               tracked files nobody may write
//   diff                  what a draft changes against the live config, and whose files move
//   baseline [--write]    layer violations in the code as it is (brownfield adoption); --write records them
//   graph [--depth N]     which folders import which (to find the layers in existing code)
//   verify [--base ref] [--branch name] [--no-checks]
//                         the rules for everything this branch changed since base (for CI and review)
//   status [--base ref] [--json]
//                         each story and requirement in the plan: built, in review, ready, blocked, tested
//   adapters              other tools detected in the project, what each adds to the rules, and its setup
//   trace <path> [--json] what a file is for: the requirements it delivers, its lane, its layer rules
//   next [--base ref] [--json]
//                         the step to take now (spec-design, init, dispatch, review…), from the project's state
//   approve <name>... --reason "…" [--lane name]
//   merge <branch> --delegated|--person [--into branch]  merge a branch that passes verify: the lead
//                                    (approvals.delegate.merge) or the person (the code-kit pane)
//   requests [--json]                 open approval requests and approvals in force
//   stops [--session id] [--json]     finish checks that refused an agent's last stop, still failing
//   sent-back <branch> [--reason …]   records that a review sent the branch back at its current commit
//   settings [--json] | settings set <key> <value> --reason … [--via pane]
//                                    the harness settings; set is the person's own change
//                         record approvals a person gave in chat (with approvals.lead on, the lead runs it)
// --config <file> reads a draft (.claude/code-kit.draft.json) instead of .claude/code-kit.json.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { BASELINE_FILE, loadBaseline } from '../hooks/lib/baseline.mjs';
import { matchesAny } from '../hooks/lib/glob.mjs';
import { CONFIG_FILE, effectiveConfig, validate } from '../hooks/lib/config.mjs';
import { diffConfigs, ownershipMoves } from '../hooks/lib/diff.mjs';
import { CODE, importsOf, layerOf, layerProblems, targetOf } from '../hooks/lib/layers.mjs';
import { ADAPTERS, activeAdapters, adapterFacts } from '../hooks/lib/adapters/index.mjs';
import { nextStep } from '../hooks/lib/next.mjs';
import { traceFile } from '../hooks/lib/trace.mjs';
import { buildStatus, specCheckRows } from '../hooks/lib/plan.mjs';
import { recordSentBack } from '../hooks/lib/reviews.mjs';
import { storyTimes } from '../hooks/lib/timeline.mjs';
import { dequeue, enqueue, lastMerged, readQueue, settle, waiting } from '../hooks/lib/queue.mjs';
import { SETTINGS, parseSetting, settingOf, withSetting } from '../hooks/lib/harness.mjs';
import {
  APPROVAL_MINUTES,
  approvalLifetime,
  currentBranch,
  PANE,
  approvalsInForce,
  delegatedMark,
  grantApprovals,
  openRequests,
  ownerOf,
  reviewerOf,
} from '../hooks/lib/rules.mjs';
import { DEPENDENCY_APPROVAL, dependencyApproval } from '../hooks/lib/dependencies.mjs';
import { dependencyRuleProblems, npmFacts, packageOf } from '../hooks/lib/registry.mjs';
import { heldTo, laneOfBranch, verifyBranch } from '../hooks/lib/verify.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
// Piped into `head` and the like: stop quietly when the reader closes.
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});
const die = (s) => {
  process.stderr.write(`${s}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const file = option('--config') ?? CONFIG_FILE;
const depth = Number(option('--depth') ?? 2);
const baseRef = option('--base');
const branchName = option('--branch');
const reason = option('--reason');
const laneName = option('--lane');
const intoName = option('--into');
const via = option('--via');
const sessionId = option('--session');
const minutesGiven = option('--minutes');
const answerGiven = option('--answer');
const FLAGS = ['--write', '--no-checks', '--json', '--delegated', '--person'];
const flag = (name) => args.includes(name);
const writeBaseline = flag('--write');
const [command, ...rest] = args.filter((a) => !FLAGS.includes(a));

const tracked = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const read = (path) => readFileSync(resolve(path), 'utf8');

function load(path = file) {
  let raw;
  try {
    raw = JSON.parse(read(path));
  } catch (e) {
    die(`${path}: ${e.message}`);
  }
  const problems = validate(raw);
  if (problems.length) die(`${path} is invalid:\n  ${problems.join('\n  ')}`);
  return { raw, config: effectiveConfig(raw, '.') };
}

/** The config as the mod reads it: whether it's there and valid, and the lead's and lanes' paths. */
function checkJson() {
  const report = { file, exists: existsSync(resolve(file)), valid: false, problems: [] };
  if (!report.exists) return (out(JSON.stringify(report, null, 2)), process.exit(1));
  let raw;
  try {
    raw = JSON.parse(read(file));
  } catch (e) {
    report.problems = [e.message];
    return (out(JSON.stringify(report, null, 2)), process.exit(1));
  }
  report.problems = validate(raw);
  if (report.problems.length) return (out(JSON.stringify(report, null, 2)), process.exit(1));
  const config = effectiveConfig(raw, '.');
  report.valid = true;
  report.lead = { paths: config.lead.paths };
  report.lanes = Object.fromEntries(
    Object.entries(config.lanes).map(([name, l]) => [name, { agent: l.agent, paths: l.paths }]),
  );
  report.adapters = config.adapters;
  report.docs = config.docs ?? null;
  report.harness = config.harness;
  // The harness settings the person chose, as opposed to defaults: the mod asks before acting on autonomy.
  report.harnessSet = Object.keys(SETTINGS).filter((k) => settingOf(raw.harness, k) !== undefined);
  report.delegatesMerge = Boolean(config.approvals.delegate?.merge);
  out(JSON.stringify(report, null, 2));
}

function check() {
  if (flag('--json')) return checkJson();
  const { raw } = load();
  out(`${file} is valid.`);
  out(`Lead: ${raw.lead.paths.join(', ')}`);
  for (const [name, lane] of Object.entries(raw.lanes))
    out(`Lane ${name} (${lane.agent}): ${lane.paths.join(', ')}`);
  for (const l of raw.layers ?? []) out(`Layer ${l.name} → ${l.mayImport.join(', ') || 'nothing'}`);
  for (const c of raw.checks ?? []) out(`Check ${c.name}: ${c.run.join(' && ')}`);
  if (!raw.docs?.specs) out('No docs.specs: lanes are not held to a spec-check report.');
  for (const name of load().config.adapters) out(`Adapter ${name}: active (see \`adapters\`)`);
}

function who(paths) {
  const { config } = load();
  for (const p of paths) {
    const layer = layerOf(p, config.layers);
    const reviewer = reviewerOf(p, config);
    const whose =
      ownerOf(p, config) ??
      (reviewer
        ? `any agent may write it; ${reviewer === 'lead' ? 'the lead' : `the ${reviewer} lane`} reviews it`
        : 'nobody');
    out(`${p}: ${whose}${layer ? ` · layer ${layer.name}` : ''}`);
  }
}

function unowned() {
  const { config } = load();
  const files = tracked();
  const nobody = files.filter(
    (p) => !ownerOf(p, config) && !p.startsWith('.claude/') && !matchesAny(p, config.anyActor),
  );
  nobody.forEach(out);
  out(`${nobody.length} of ${files.length} tracked files have no owner.`);
}

function diff() {
  if (file === CONFIG_FILE)
    die('Pass the draft to compare: diff --config .claude/code-kit.draft.json');
  const live = load(CONFIG_FILE);
  const draft = load(file);
  const lines = diffConfigs(live.raw, draft.raw);
  const moves = ownershipMoves(tracked(), live.config, draft.config);
  if (lines.length === 0 && moves.length === 0) return out('No changes.');
  lines.forEach(out);
  const byRoute = Map.groupBy(moves, (m) => `${m.from} → ${m.to}`);
  for (const [route, files] of byRoute) {
    out(
      `Owner ${route}: ${files.length} file(s), e.g. ${files
        .slice(0, 3)
        .map((m) => m.file)
        .join(', ')}`,
    );
  }
}

/** Every layer violation in tracked code, by file. */
function violations(config) {
  const found = {};
  for (const rel of tracked().filter((f) => CODE.test(f) && existsSync(f))) {
    const problems = layerProblems(rel, read(rel), config);
    if (problems.length) found[rel] = problems;
  }
  return found;
}

/** What to record: everything at adoption; afterwards only what was already recorded (it only shrinks). */
function toRecord(found) {
  if (!existsSync(BASELINE_FILE)) return { keep: found, refused: [] };
  const before = loadBaseline('.').layers;
  const keep = {};
  const refused = [];
  for (const [rel, problems] of Object.entries(found)) {
    const known = problems.filter((p) => (before[rel] ?? []).includes(p));
    if (known.length) keep[rel] = known;
    refused.push(...problems.filter((p) => !known.includes(p)));
  }
  return { keep, refused };
}

function baseline() {
  const { config } = load();
  const found = violations(config);
  const count = Object.values(found).flat().length;
  Object.values(found).flat().forEach(out);
  out(`${count} violation(s) in ${Object.keys(found).length} file(s).`);
  if (!writeBaseline) return;
  const { keep, refused } = toRecord(found);
  const body = { recordedAt: new Date().toISOString(), layers: keep };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`);
  out(
    `Recorded ${Object.values(keep).flat().length} in ${BASELINE_FILE}: these don't block; new ones do.`,
  );
  if (refused.length) {
    die(`Not recorded (the baseline only shrinks); fix these instead:\n  ${refused.join('\n  ')}`);
  }
}

/** Workspace packages by name (package.json "name" → its folder), plus the config's aliases. */
function aliases() {
  const found = {};
  for (const p of tracked().filter((f) => f.endsWith('/package.json'))) {
    try {
      const name = JSON.parse(read(p)).name;
      if (name) found[name] = posix.dirname(p);
    } catch {
      // not a readable manifest
    }
  }
  const configured = existsSync(file) ? (JSON.parse(read(file)).importAliases ?? {}) : {};
  return { ...found, ...configured };
}

function graph() {
  const known = aliases();
  const files = tracked();
  // An import names a file without its extension, or a folder (its index): group files by their folder.
  const stems = new Set(files.map((f) => f.replace(/\.[^./]+$/, '')));
  const folderOf = (p) => (stems.has(p) || files.includes(p) ? posix.dirname(p) : p);
  const folder = (p) => folderOf(p).split('/').slice(0, depth).join('/');
  const edges = new Map();
  for (const rel of files.filter((f) => CODE.test(f) && existsSync(f))) {
    for (const spec of importsOf(read(rel))) {
      const target = targetOf(spec, rel, known);
      const real =
        target &&
        (stems.has(target) || files.some((f) => f === target || f.startsWith(`${target}/`)));
      if (!real) continue; // a package, or a path that doesn't exist (e.g. text inside a test fixture)
      const edge = `${folder(rel)} → ${folder(target)}`;
      if (folder(rel) !== folder(target)) edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  [...edges]
    .sort((a, b) => b[1] - a[1])
    .forEach(([edge, n]) => out(`${String(n).padStart(5)}  ${edge}`));
  out(`${edges.size} folder-to-folder dependencies at depth ${depth}.`);
}

const refExists = (ref) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** The branch work merges into: --base, else the first protected branch (on origin first when `remote`); null if none exists. */
function findBase(config, remote) {
  if (baseRef) return refExists(baseRef) ? baseRef : die(`--base ${baseRef} is not a known ref.`);
  const name = config.branches.protected[0];
  const order = remote ? [`origin/${name}`, name] : [name, `origin/${name}`];
  return order.find(refExists) ?? null;
}

function base(config, remote) {
  const name = config.branches.protected[0];
  return (
    findBase(config, remote) ?? die(`Neither ${name} nor origin/${name} exists; pass --base <ref>.`)
  );
}

const VERIFY_GROUPS = {
  ownership: 'Ownership',
  protected: 'Protected paths and the approval log',
  layers: 'Layer rules',
  baseline: 'Baseline',
  design: 'Designs before screens',
  checks: 'Checks',
};

// The lead merges a reviewed branch into a protected branch on its own, only where the config delegates
// merges, and only when `verify` passes on that branch, checks included. A person merges with git.
// With --person, the person merges (the mod passes it for a press in its pane): the same verify first,
// with no delegation needed. The hooks refuse --person from every agent.
/**
 * The config as committed on `ref`: what governs merging into it, so a branch's own config can't grant
 * itself a merge its target doesn't allow.
 */
function configAt(ref) {
  let raw;
  try {
    raw = JSON.parse(
      execFileSync('git', ['show', `${ref}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    die(`${ref} has no readable ${file}; a merge into it follows the rules committed there.`);
  }
  const problems = validate(raw);
  if (problems.length) die(`${file} on ${ref} is invalid:\n  ${problems.join('\n  ')}`);
  return effectiveConfig(raw, '.');
}

/** Why a merge didn't happen: `refused` (the rules), `verify` (problems) or `conflict`. */
class MergeStop extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Who merges, from the flags: the lead within the delegated rules, or the person. */
function mergeMode() {
  const byPerson = flag('--person');
  if (!flag('--delegated') && !byPerson)
    die(
      'code-kit merge needs --delegated (the lead, within the delegated rules) or --person (the person, as from the code-kit pane).',
    );
  if (flag('--delegated') && byPerson)
    die("A merge is either the lead's (--delegated) or the person's (--person), not both.");
  return byPerson;
}

function merge(branch) {
  const { config } = load();
  const byPerson = mergeMode();
  try {
    out(mergeOne(branch, config, byPerson).message);
  } catch (e) {
    if (e instanceof MergeStop) die(e.message);
    throw e;
  }
}

/**
 * Verifies `branch`, checks included, and merges it into the base (`--into`, or the first protected
 * branch). Returns { into, message }; throws a MergeStop when nothing was merged.
 */
function mergeOne(branch, config, byPerson) {
  const refuse = (message) => {
    throw new MergeStop('refused', message);
  };
  const into = intoName ?? config.branches.protected[0];
  // Whether the lead may merge, and which branches are protected, are the target's rules.
  const target = configAt(into);
  if (!byPerson && !target.approvals.delegate?.merge)
    refuse(
      `${into} doesn't delegate merges to the lead ("approvals.delegate.merge" isn't true in its ${file}). A person merges after review.`,
    );
  if (!target.branches.protected.includes(into))
    refuse(`${into} isn't a protected branch; merge into it with git.`);
  if (target.branches.protected.includes(branch)) refuse(`${branch} is itself a protected branch.`);
  const root = resolve('.');
  const g = (cwd, ...a) =>
    execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    g(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  } catch {
    refuse(`There is no branch ${branch}.`);
  }
  const checkedOut = (b) =>
    g(root, 'worktree', 'list', '--porcelain')
      .split('\n\n')
      .map((w) => ({ path: w.match(/^worktree (.+)$/m)?.[1], ref: w.match(/^branch (.+)$/m)?.[1] }))
      .find((w) => w.ref === `refs/heads/${b}`)?.path;
  const clean = (dir, b) => {
    if (g(dir, 'status', '--porcelain', '--untracked-files=no').trim())
      fail(`${b} has uncommitted changes in ${dir}; commit or stash them first.`);
  };
  const temporary = [];
  // A stop is thrown at once, so every way out of here removes the temporary worktrees first.
  const cleanup = () => {
    for (const dir of temporary.splice(0)) {
      try {
        g(root, 'worktree', 'remove', '--force', dir);
      } catch {
        // already gone
      }
    }
  };
  const fail = (message, kind = 'refused') => {
    cleanup();
    throw new MergeStop(kind, message);
  };
  const worktree = (b, detach) => {
    const dir = mkdtempSync(join(tmpdir(), 'code-kit-merge-'));
    rmSync(dir, { recursive: true });
    g(root, 'worktree', 'add', '--quiet', ...(detach ? ['--detach'] : []), dir, b);
    temporary.push(dir);
    return dir;
  };
  try {
    // Verify where the branch is checked out (its dependencies are installed there), else in a
    // temporary worktree, where checks that need an install fail rather than being skipped.
    const verifyIn = checkedOut(branch) ?? worktree(branch, true);
    clean(verifyIn, branch);
    const lane = laneOfBranch(branch, config);
    const { changed, found } = verifyBranch({
      root: verifyIn,
      base: into,
      config,
      lane,
      checks: true,
    });
    const problems = Object.entries(VERIFY_GROUPS).flatMap(([key, title]) =>
      found[key].map((p) => `${title}: ${p.split('\n').join('\n    ')}`),
    );
    if (problems.length)
      fail(
        `Nothing was merged. code-kit verify found ${problems.length} problem(s) on ${branch} (checked in ${verifyIn}):\n  ${problems.join('\n  ')}\nSend it back to its lane, or fix it, then merge again.`,
        'verify',
      );
    const mergeIn = checkedOut(into) ?? worktree(into, false);
    clean(mergeIn, into);
    try {
      g(
        mergeIn,
        'merge',
        '--no-ff',
        '-m',
        `Merge ${branch} into ${into}`,
        '-m',
        `Verified with code-kit verify (${changed.length} file(s)${lane ? `, held to ${heldTo(lane)}` : ''}) and merged ${byPerson ? 'by the person, from the code-kit pane' : 'by the lead within the delegated rules'}.`,
        branch,
      );
    } catch (e) {
      try {
        g(mergeIn, 'merge', '--abort');
      } catch {
        // nothing to abort
      }
      fail(
        `Nothing was merged: ${branch} doesn't merge cleanly into ${into}. Merge ${into} into ${branch} and resolve it there, then merge again.\n${String(e.stderr ?? e.message).trim()}`,
        'conflict',
      );
    }
    return {
      into,
      message: `Merged ${branch} into ${into}: verify passed on ${changed.length} file(s)${lane ? `, held to ${heldTo(lane)}` : ''}.`,
    };
  } finally {
    cleanup();
  }
}

/**
 * The merge queue (spec 09): `queue` lists it; `queue add <branch>` puts a branch the lead's review
 * passed at the back; `queue drop <branch>` takes one out; `queue merge --delegated|--person` merges
 * the head, verified against the base as it is now. A head that conflicts or fails verify is sent
 * back to its lane (recorded as `sent-back` records it) and leaves the queue; the next one is then head.
 */
function queue() {
  const { config } = load();
  const root = resolve('.');
  const [sub, branch] = rest;
  if (sub === 'add' || sub === 'drop') {
    if (!branch) die(`code-kit queue ${sub} <branch>`);
    if (sub === 'drop')
      return out(
        dequeue(root, branch)
          ? `Took ${branch} out of the merge queue.`
          : `${branch} isn't waiting in the merge queue.`,
      );
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        stdio: 'ignore',
      });
    } catch {
      die(`There is no branch ${branch}.`);
    }
    if (!enqueue(root, branch)) return out(`${branch} is already in the merge queue.`);
    const place = waiting(readQueue(root)).length;
    return out(`Queued ${branch} to merge${place > 1 ? `, ${place - 1} ahead of it` : ', next'}.`);
  }
  if (sub === 'merge') {
    const byPerson = mergeMode();
    const entries = readQueue(root);
    const head = waiting(entries)[0];
    if (!head) return out('The merge queue is empty.');
    try {
      const { message } = mergeOne(head.branch, config, byPerson);
      settle(root, head.branch, 'merged');
      const left = waiting(readQueue(root));
      return out(
        `${message}${left.length ? ` Next in the queue: ${left[0].branch}.` : ' The queue is empty.'}`,
      );
    } catch (e) {
      if (!(e instanceof MergeStop)) throw e;
      // MQ-3: a conflict or a failed verify goes back to the lane; a refusal leaves the queue as it is.
      if (e.kind === 'refused') die(e.message);
      const into = intoName ?? config.branches.protected[0];
      const after = lastMerged(entries);
      const why =
        e.kind === 'conflict'
          ? `conflicts with ${into}${after ? ` after ${after}` : ''}`
          : `fails verify against ${into}${after ? ` after ${after}` : ''}`;
      const sha = execFileSync('git', ['rev-parse', '--verify', `${head.branch}^{commit}`], {
        encoding: 'utf8',
      }).trim();
      recordSentBack(root, head.branch, sha, why);
      settle(root, head.branch, 'sent back', why);
      die(
        `${e.message}\n${head.branch} is sent back to its lane (${why}) and leaves the queue; its fix rejoins after the next review.`,
      );
    }
  }
  if (sub !== undefined)
    die(
      'code-kit queue [--json] | queue add <branch> | queue drop <branch> | queue merge --delegated|--person',
    );
  const entries = readQueue(root);
  if (flag('--json')) return out(JSON.stringify(entries, null, 2));
  const left = waiting(entries);
  if (!left.length) out('The merge queue is empty.');
  else out(`${left.length} waiting to merge, in order:`);
  left.forEach((e, i) => out(`  ${i + 1}. ${e.branch} (passed review ${e.passed})`));
}

/** When each story's work happened, for the mod's timelines (VIEW-2). */
function timeline() {
  const { config } = load();
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die(
      'timeline needs docs.specs and docs.plan in the config. The spec-design skill writes both.',
    );
  const from = base(config, false);
  const { stories } = buildStatus('.', config, from, tracked());
  const times = storyTimes(resolve('.'), stories, from);
  if (flag('--json'))
    return out(JSON.stringify({ base: from, now: Date.now(), stories: times }, null, 2));
  const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '-');
  for (const s of times)
    out(
      `${s.id} ${s.branch}: started ${when(s.started)}, last commit ${when(s.lastCommit)}, merged ${when(s.merged)}`,
    );
}

/** The most of a story's diff `story` prints; past it the text is cut and says so. */
const DIFF_KEPT = 256 * 1024;

/**
 * One story's facts, for the mod's drill-down (VIEW-7): its requirements with the spec-check report's
 * rows, its branch's diff against the base, and verify's problems on it (without the checks, which
 * merge runs), where it's checked out or in a temporary worktree.
 */
function story(id) {
  const { config } = load();
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die('story needs docs.specs and docs.plan in the config. The spec-design skill writes both.');
  const from = base(config, false);
  const { stories, requirements } = buildStatus('.', config, from, tracked());
  const s = stories.find((x) => x.id === id.toUpperCase());
  if (!s) die(`There is no story ${id} in ${plan}.`);
  const report = {
    id: s.id,
    title: s.title,
    lane: s.lane,
    state: s.state,
    base: from,
    branch: s.branchExists ? s.branch : null,
    worktree: s.worktree,
    requirements: s.requirements.map((rid) => {
      const q = requirements.find((x) => x.id === rid);
      return {
        id: rid,
        title: q?.title ?? '',
        spec: q?.file ?? null,
        state: q?.state ?? 'no spec',
        tests: q?.tests ?? [],
      };
    }),
    specCheck: null,
    diff: null,
    verify: null,
    adapters: [],
  };
  if (s.branchExists) {
    const g = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const name = `.claude/state/spec-check/${s.branch.replace(/[^\w.-]+/g, '_')}.md`;
    const found = [s.worktree, '.']
      .filter(Boolean)
      .map((d) => join(resolve(d), name))
      .find((f) => existsSync(f));
    if (found) report.specCheck = { file: found, rows: specCheckRows(readFileSync(found, 'utf8')) };
    const range = `${from}...${s.branch}`;
    const files = g('diff', '--numstat', range)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, removed, path] = line.split('\t');
        return { path, added: Number(added) || 0, removed: Number(removed) || 0 };
      });
    const text = g('diff', range);
    // JOIN-3: what the active adapters know of the story's files (rules on them, agreed and proposed).
    report.adapters = adapterFacts(load().raw, resolve('.'), {
      paths: files.map((f) => f.path),
    }).map(({ name, files: facts, open }) => ({ name, files: facts ?? {}, open }));
    report.diff = {
      files,
      text:
        text.length > DIFF_KEPT
          ? text.slice(0, text.lastIndexOf('\ndiff --git', DIFF_KEPT) + 1 || DIFF_KEPT)
          : text,
      truncated: text.length > DIFF_KEPT,
    };
    // verify, without checks, where the branch is checked out; a temporary worktree otherwise.
    let dir = s.worktree;
    let temporary = null;
    if (!dir) {
      temporary = mkdtempSync(join(tmpdir(), 'code-kit-story-'));
      rmSync(temporary, { recursive: true });
      g('worktree', 'add', '--quiet', '--detach', temporary, s.branch);
      dir = temporary;
    }
    try {
      const lane = laneOfBranch(s.branch, config);
      const { found: problems } = verifyBranch({
        root: dir,
        base: from,
        config,
        lane,
        checks: false,
      });
      report.verify = {
        checks: false,
        where: temporary ? 'a temporary worktree' : dir,
        problems: Object.fromEntries(
          Object.entries(VERIFY_GROUPS).map(([key, title]) => [title, problems[key] ?? []]),
        ),
      };
    } finally {
      if (temporary) g('worktree', 'remove', '--force', temporary);
    }
  }
  if (flag('--json')) return out(JSON.stringify(report, null, 2));
  out(
    `${report.id} ${report.title} (${report.lane}, ${report.state})${report.branch ? ` on ${report.branch}` : ''}`,
  );
  for (const r of report.requirements) out(`  ${r.id} ${r.title}: ${r.state}`);
  if (report.diff) out(`${report.diff.files.length} file(s) changed against ${from}.`);
  const count = report.verify ? Object.values(report.verify.problems).flat().length : 0;
  if (report.verify)
    out(
      count
        ? `verify (without checks): ${count} problem(s).`
        : 'verify (without checks): no problems.',
    );
}

// Open approval requests and the approvals in force, for the person and the mod's band.
function requests() {
  load();
  const open = openRequests(resolve('.'));
  const granted = approvalsInForce(resolve('.'));
  if (flag('--json')) return out(JSON.stringify({ open, inForce: granted }, null, 2));
  out(open.length ? `${open.length} approval request(s) open:` : 'No approval requests open.');
  for (const r of open)
    out(
      `  ${r.names.join(', ')} for ${r.lane ? `the ${r.lane} lane` : r.actor}: ${r.what}  (${r.why})`,
    );
  out(granted.length ? `\n${granted.length} approval(s) in force:` : '\nNo approvals in force.');
  for (const a of granted)
    out(
      `  ${a.name} for ${a.lane ? `the ${a.lane} lane` : 'any agent'}, ${a.minutesLeft} min left: ${a.reason}`,
    );
}

/**
 * The harness settings (`harness` in the config): listed, or one changed as the person's own act. The
 * change is written to the config and given a kit approval with the person's reason, so the commit that
 * keeps it logs their reason. The hooks refuse `settings set` from every agent.
 */
function settings() {
  const { raw, config } = load();
  if (rest[0] === 'set') {
    const [, key, value] = rest;
    if (!key || value === undefined)
      die('code-kit settings set <key> <value> --reason "<why>" [--via pane]');
    if (!(key in SETTINGS))
      die(`${key} isn't a harness setting. They are: ${Object.keys(SETTINGS).join(', ')}.`);
    if (!reason?.trim()) die('Give a reason with --reason "…": the approval log keeps it.');
    const changed = withSetting(raw, key, parseSetting(key, value));
    const problems = validate(changed);
    if (problems.length) die(`Nothing changed: ${problems.join('; ')}`);
    writeFileSync(resolve(file), `${JSON.stringify(changed, null, 2)}\n`);
    const mark =
      via === 'pane' ? '(changed in the code-kit pane)' : '(changed with code-kit settings)';
    grantApprovals(resolve('.'), ['kit'], null, reason, { kit: mark });
    return out(
      `Set harness.${key} to ${JSON.stringify(settingOf(changed.harness, key))}. Commit ${file} to keep it; the approval log will carry your reason.`,
    );
  }
  if (rest.length) die('code-kit settings [--json] | settings set <key> <value> --reason "<why>"');
  const rows = Object.entries(SETTINGS).map(([key, s]) => ({
    key,
    value: settingOf(config.harness, key),
    default: s.default,
    about: s.about,
    // Chosen in the config, or the default standing in.
    set: settingOf(raw.harness, key) !== undefined,
  }));
  if (flag('--json')) return out(JSON.stringify(rows, null, 2));
  for (const r of rows)
    out(
      `${r.key.padEnd(26)} ${JSON.stringify(r.value).padEnd(14)} ${r.value === r.default ? '' : `(default ${JSON.stringify(r.default)}) `}${r.about}`,
    );
}

/** Records the review's send-back of `branch` at its current commit (lib/reviews.mjs). */
function sentBackCommand(branch) {
  load();
  let sha;
  try {
    sha = execFileSync('git', ['rev-parse', '--verify', `${branch}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    die(`No branch ${branch} here.`);
  }
  recordSentBack(resolve('.'), branch, sha, reason);
  out(
    `Recorded: ${branch} was sent back at ${sha.slice(0, 7)}. status shows its story as sent back until the branch moves on.`,
  );
}

/** Finish checks still failing: the stop hook's last refusal for each session and agent. */
function stops() {
  load();
  const dir = resolve('.claude/state/stop-blocks');
  const found = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    try {
      const b = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (sessionId && b.session !== sessionId) continue;
      found.push({
        session: b.session ?? null,
        agent: b.agent ?? null,
        agentType: b.agentType ?? null,
        title: String(b.message ?? '').split('\n')[0],
        count: b.count ?? 1,
        at: b.at ?? null,
      });
    } catch {
      // a file the hook is still writing, or not one of its own
    }
  }
  if (flag('--json')) return out(JSON.stringify(found, null, 2));
  if (!found.length) return out('No finish check is failing.');
  for (const s of found)
    out(`${s.agentType ?? 'the lead'}${s.session ? ` (session ${s.session})` : ''}: ${s.title}`);
}

// Hold and ask (spec 06): a call the mod holds waits here, in the mod's `$.process.run`, for the
// person's answer, which the band writes with `hold <id> --answer approved|refused` into
// .claude/state/held/<id>. It prints `approved`, `refused` or `timed out` (after hold.minutes).
async function hold(id) {
  const { config } = load();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    die(`Not a held call's id: ${id}. Give the tool call's id, as the code-kit mod does.`);
  const dir = resolve('.claude/state/held');
  const answerFile = join(dir, id);
  const answer = answerGiven;
  if (answer !== undefined) {
    if (!['approved', 'refused'].includes(answer)) die('--answer takes "approved" or "refused".');
    mkdirSync(dir, { recursive: true });
    writeFileSync(answerFile, `${answer}\n`);
    return out(`The held call ${id} is ${answer}.`);
  }
  const minutes = Number(minutesGiven ?? config.harness.hold.minutes);
  const until = Date.now() + minutes * 60000;
  while (Date.now() < until) {
    if (existsSync(answerFile)) {
      const given = readFileSync(answerFile, 'utf8').trim();
      rmSync(answerFile, { force: true });
      return out(given === 'approved' ? 'approved' : 'refused');
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  out('timed out');
}

function verify() {
  const { config } = load();
  const from = base(config, true);
  let branch = branchName;
  if (!branch) {
    try {
      branch = currentBranch('.');
    } catch {
      branch = null;
    }
  }
  const lane = laneOfBranch(branch, config);
  const { changed, found } = verifyBranch({
    root: resolve('.'),
    base: from,
    config,
    lane,
    checks: !flag('--no-checks'),
  });
  if (flag('--json')) {
    const count = Object.values(found).reduce((n, list) => n + list.length, 0);
    out(
      JSON.stringify(
        { base: from, branch, lane, changed: changed.length, found, problems: count },
        null,
        2,
      ),
    );
    if (count) process.exit(1);
    return;
  }
  out(
    `${changed.length} file(s) changed since ${from}${lane ? `, held to ${heldTo(lane)} (branch ${branch})` : ''}.`,
  );
  let count = 0;
  for (const [key, title] of Object.entries(VERIFY_GROUPS)) {
    if (!found[key].length) continue;
    count += found[key].length;
    out(`\n${title}:`);
    for (const p of found[key]) out(`  ${p.split('\n').join('\n    ')}`);
  }
  if (count) die(`\n${count} problem(s). Fix them on this branch.`);
  out('No problems.');
}

const pad = (s, n) => String(s).padEnd(n);

function status() {
  const { config } = load();
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die('status needs docs.specs and docs.plan in the config. The spec-design skill writes both.');
  const from = base(config, false);
  const {
    stories,
    requirements: byRequirement,
    problems,
    drift,
  } = buildStatus('.', config, from, tracked());

  if (flag('--json')) {
    out(
      JSON.stringify(
        { base: from, stories, requirements: byRequirement, problems, drift },
        null,
        2,
      ),
    );
    return;
  }
  out(`Stories (against ${from}):`);
  for (const s of stories) {
    const detail =
      s.state === 'blocked'
        ? `waits on ${s.waitingOn.join(', ')}`
        : s.state === 'review'
          ? `${s.ahead} commit(s) on ${s.branch}${s.worktree ? ` · ${s.worktree}` : ''}`
          : s.branchExists
            ? s.branch
            : '';
    out(
      `  ${pad(s.id, 7)} ${pad(s.state, 12)} ${pad(s.lane || '-', 10)} ${pad(s.requirements.join(', '), 24)} ${detail}`.trimEnd(),
    );
  }
  out('\nRequirements:');
  for (const r of byRequirement) {
    const tests = r.tests.length ? `tested (${r.tests.join(', ')})` : 'no test names it';
    out(
      `  ${pad(r.id, 10)} ${pad(r.state, 12)} ${pad(r.stories.join(', ') || '-', 14)} ${r.removed ? '' : tests}`.trimEnd(),
    );
  }
  const counts = Map.groupBy(byRequirement, (r) => r.state);
  const live = byRequirement.filter((r) => !r.removed);
  out(
    `\n${live.length} requirement(s): ${[...counts]
      .filter(([k]) => k !== 'removed')
      .map(([k, v]) => `${v.length} ${k}`)
      .join(', ')}; ${live.filter((r) => r.tests.length).length} named by a test.`,
  );
  const ready = stories.filter((s) => s.state === 'ready').map((s) => s.id);
  if (ready.length) out(`Ready to dispatch: ${ready.join(', ')}`);
  if (drift.length) {
    out('\nThe plan is out of date:');
    for (const d of drift) out(`  ${d.story}: the plan says ${d.plan}, git says ${d.actual}`);
  }
  if (problems.length) {
    out('\nGaps between the specs and the plan:');
    problems.forEach((p) => out(`  ${p}`));
  }
}

function next() {
  const step = nextStep(resolve('.'), (config) => findBase(config, false));
  if (flag('--json')) return out(JSON.stringify(step, null, 2));
  const command = (s, args) => `/code-kit:${s}${args ? ` ${args}` : ''}`;
  const actionable = !['wait', 'done'].includes(step.step);
  out(actionable ? `Next: ${command(step.step, step.args)}` : `Next: ${step.step}`);
  out(`Why: ${step.why}`);
  for (const t of step.then) out(`Then: ${command(t.step, t.args)}`);
  for (const a of step.attention) out(`Note: ${a}`);
}

function adapters() {
  const { raw } = load();
  // JOIN-1: with --json, what the active adapters know of the lanes' work in a session (--session).
  if (flag('--json'))
    return out(JSON.stringify(adapterFacts(raw, resolve('.'), { session: sessionId }), null, 2));
  const active = activeAdapters(raw, '.').map((a) => a.name);
  for (const a of ADAPTERS) {
    const off = raw.adapters?.[a.name] === false;
    const state = active.includes(a.name)
      ? 'active'
      : off
        ? 'switched off in the config'
        : 'not detected';
    out(`${a.name}: ${state}`);
    if (!active.includes(a.name)) continue;
    const c = a.config ?? {};
    if (c.lead?.length) out(`  lead writes: ${c.lead.join(', ')}`);
    if (c.anyActor?.length)
      out(
        `  anyone writes: ${c.anyActor.map((e) => (typeof e === 'string' ? e : `${e.glob} (reviewed by ${e.reviewer ?? 'the lead'})`)).join(', ')}`,
      );
    for (const p of c.protected ?? [])
      out(`  protected: ${p.glob} (approval "${p.approval}": ${p.why})`);
    for (const b of a.shell?.block ?? []) out(`  blocked command: /${b.pattern}/ — ${b.why}`);
    for (const s of a.setup ?? []) out(`  setup: ${s}`);
  }
}

function trace(paths) {
  const { config } = load();
  const traces = paths.map((p) => traceFile(resolve('.'), p.replace(/^\.\//, ''), config));
  if (flag('--json')) return out(JSON.stringify(traces.length === 1 ? traces[0] : traces, null, 2));
  for (const t of traces) {
    out(t.path);
    out(
      `  owner: ${t.owner ?? (t.reviewer ? `any agent; the ${t.reviewer === 'lead' ? 'lead' : `${t.reviewer} lane`} reviews it` : 'nobody')}${t.layer ? ` · layer ${t.layer.name} → ${t.layer.mayImport.join(', ') || 'only itself'}` : ''}`,
    );
    if (!t.requirements.length) out('  no requirements traced (no commit names a story)');
    for (const r of t.requirements)
      out(`  ${r.id} ${r.title}  (${r.spec}; ${r.stories.join(', ')})`);
  }
}

// Each name is an approval a refusal named: a protected path's, `kit`, or `dep-<package>`. A package
// name (`zod`, `@scope/pkg`) stands for its `dep-` approval. With --delegated, the lead approves on its
// own authority, and only what the project's delegated rules allow.
async function approve(given) {
  const { config } = load();
  const delegated = flag('--delegated');
  if (!reason?.trim())
    die(
      delegated
        ? 'approve needs --reason "<why it\'s needed, for which story>".'
        : 'approve needs --reason "<what the person approved, in their words>".',
    );
  if (laneName !== undefined && !config.lanes[laneName])
    die(`There is no lane "${laneName}". Lanes: ${Object.keys(config.lanes).join(', ')}.`);
  const known = new Set(['kit', ...config.protected.map((p) => p.approval)]);
  const isPackage = (n) => /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(n);
  const names = given.map((n) =>
    n.startsWith(DEPENDENCY_APPROVAL) || known.has(n) || !isPackage(n) ? n : dependencyApproval(n),
  );
  const bad = names.filter((n) => !/^[a-z0-9@][a-z0-9@+._-]*$/.test(n));
  if (bad.length)
    die(
      `Not an approval or package name: ${bad.join(', ')}. Use the name the refusal gave, e.g. kit or dep-zod, or the package's name.`,
    );
  const marks = {};
  // A press in a pane: code-kit's own (pane), or another tool's that shares the project, by its name.
  if (via !== undefined && !/^[a-z][a-z0-9-]{0,39}$/.test(via))
    die(
      '--via takes "pane" (a press in the code-kit pane) or the name of the tool whose pane it was, such as context-graph.',
    );
  if (via !== undefined && delegated)
    die("An approval is either the person's (--via pane) or the lead's (--delegated), not both.");
  if (via !== undefined)
    for (const n of names) marks[n] = via === 'pane' ? PANE : `(approved in the ${via} pane)`;
  if (delegated) {
    const rules = config.approvals.delegate;
    if (!rules)
      die(
        'This project delegates no approvals to the lead ("approvals.delegate" isn\'t set). Ask the person.',
      );
    const outside = [];
    for (const name of names) {
      if (name.startsWith(DEPENDENCY_APPROVAL)) {
        if (!rules.dependencies) {
          outside.push(`${name}: dependencies aren't delegated`);
          continue;
        }
        const pkg = packageOf(name);
        const problems = dependencyRuleProblems(await npmFacts(pkg), rules.dependencies);
        if (problems.length) outside.push(`${name}: ${problems.join('; ')}`);
        else marks[name] = delegatedMark(`dependencies (${pkg})`);
      } else if (rules.protected.includes(name)) marks[name] = delegatedMark(`protected: ${name}`);
      else
        outside.push(
          `${name}: not among the delegated approvals (${rules.protected.join(', ') || 'none'})`,
        );
    }
    if (outside.length)
      die(
        `Nothing was approved. These are outside the project's delegated rules, so the person decides:\n  ${outside.join('\n  ')}\nAsk the person, with the \`!\` command from the refusal.`,
      );
  }
  grantApprovals(resolve('.'), names, laneName, reason, marks);
  const whom = laneName ? `the ${laneName} lane` : 'any agent';
  const renamed = given.flatMap((g, i) => (g === names[i] ? [] : [`${g} → ${names[i]}`]));
  out(
    `Approved ${names.join(', ')} for ${whom}, ${approvalLifetime(names)}${delegated ? ', within the delegated rules' : ''}: ${reason.trim()}${renamed.length ? `\n(${renamed.join(', ')})` : ''}`,
  );
}

const commands = {
  check,
  approve: () => (rest.length ? approve(rest) : usage()),
  merge: () => (rest.length === 1 ? merge(rest[0]) : usage()),
  requests,
  stops,
  settings,
  hold: () => (rest.length === 1 ? hold(rest[0]) : usage()),
  queue,
  story: () => (rest.length === 1 ? story(rest[0]) : usage()),
  timeline,
  'sent-back': () => (rest.length === 1 ? sentBackCommand(rest[0]) : usage()),
  trace: () => (rest.length ? trace(rest) : usage()),
  adapters,
  next,
  verify,
  status,
  unowned,
  diff,
  baseline,
  graph,
  who: () => (rest.length ? who(rest) : usage()),
};
function usage() {
  die(
    'Usage: code-kit check | who <path>... | unowned | diff | baseline [--write] | graph [--depth N]\n' +
      '              | verify [--base ref] [--branch name] [--no-checks] | status [--base ref] [--json]\n' +
      '              | next [--base ref] [--json] | adapters | trace <path>... [--json]\n' +
      '              | approve <name>... --reason "…" [--lane name]   [--config file]\n' +
      '              | merge <branch> --delegated|--person [--into branch] | requests [--json]\n' +
      '              | stops [--session id] [--json] | sent-back <branch> [--reason "…"]\n' +
      '              | settings [--json] | settings set <key> <value> --reason "…" [--via pane]\n' +
      '              | hold <id> [--minutes N] | hold <id> --answer approved|refused\n' +
      '              | queue [--json] | queue add|drop <branch> | queue merge --delegated|--person\n' +
      '              | story <id> [--json] | timeline [--json]',
  );
}
await (commands[command] ?? usage)();
