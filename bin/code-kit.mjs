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
//                         record approvals a person gave in chat (with approvals.lead on, the lead runs it)
// --config <file> reads a draft (.claude/code-kit.draft.json) instead of .claude/code-kit.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { BASELINE_FILE, loadBaseline } from '../hooks/lib/baseline.mjs';
import { matchesAny } from '../hooks/lib/glob.mjs';
import { CONFIG_FILE, effectiveConfig, validate } from '../hooks/lib/config.mjs';
import { diffConfigs, ownershipMoves } from '../hooks/lib/diff.mjs';
import { CODE, importsOf, layerOf, layerProblems, targetOf } from '../hooks/lib/layers.mjs';
import { ADAPTERS, activeAdapters } from '../hooks/lib/adapters/index.mjs';
import { nextStep } from '../hooks/lib/next.mjs';
import { traceFile } from '../hooks/lib/trace.mjs';
import { buildStatus } from '../hooks/lib/plan.mjs';
import { recordSentBack } from '../hooks/lib/reviews.mjs';
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

function merge(branch) {
  const { config } = load();
  const byPerson = flag('--person');
  if (!flag('--delegated') && !byPerson)
    die(
      'code-kit merge needs --delegated (the lead, within the delegated rules) or --person (the person, as from the code-kit pane).',
    );
  if (flag('--delegated') && byPerson)
    die("A merge is either the lead's (--delegated) or the person's (--person), not both.");
  const into = intoName ?? config.branches.protected[0];
  // Whether the lead may merge, and which branches are protected, are the target's rules.
  const target = configAt(into);
  if (!byPerson && !target.approvals.delegate?.merge)
    die(
      `${into} doesn't delegate merges to the lead ("approvals.delegate.merge" isn't true in its ${file}). A person merges after review.`,
    );
  if (!target.branches.protected.includes(into))
    die(`${into} isn't a protected branch; merge into it with git.`);
  if (target.branches.protected.includes(branch)) die(`${branch} is itself a protected branch.`);
  const root = resolve('.');
  const g = (cwd, ...a) =>
    execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    g(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  } catch {
    die(`There is no branch ${branch}.`);
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
  // die() exits at once, so every way out of here removes the temporary worktrees first.
  const cleanup = () => {
    for (const dir of temporary.splice(0)) {
      try {
        g(root, 'worktree', 'remove', '--force', dir);
      } catch {
        // already gone
      }
    }
  };
  const fail = (message) => {
    cleanup();
    die(message);
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
      );
    }
    out(
      `Merged ${branch} into ${into}: verify passed on ${changed.length} file(s)${lane ? `, held to ${heldTo(lane)}` : ''}.`,
    );
  } finally {
    cleanup();
  }
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
  if (via !== undefined && via !== 'pane')
    die('--via takes only "pane": the code-kit mod passes it for a press in its pane.');
  if (via === 'pane' && delegated)
    die("An approval is either the person's (--via pane) or the lead's (--delegated), not both.");
  if (via === 'pane') for (const n of names) marks[n] = PANE;
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
      '              | stops [--session id] [--json] | sent-back <branch> [--reason "…"]',
  );
}
await (commands[command] ?? usage)();
