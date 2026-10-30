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
//   security [--base ref] [--branch name] [--json]
//                         whether a branch's changes need the security reviewer, and why (ONB-7)
//   status [--base ref] [--json]
//                         each story and requirement in the plan: built, in review, ready, blocked, tested
//   adapters              other tools detected in the project, what each adds to the rules, and its setup
//   trace <path> [--json] what a file is for: the requirements it delivers, its lane, its layer rules
//   next [--base ref] [--json]
//                         the step to take now (spec-design, init, dispatch, review…), from the project's state
//   approve <name>... --reason "…" [--lane name]
//   merge <branch> --delegated|--person [--into branch]  merge a branch that passes verify: the lead
//                                    (approvals.delegate.merge) or the person (the code-kit pane)
//   publish --delegated|--person      put what's merged into the base onto the remote's, as
//                                    branches.publish says: pushed, or as a pull request
//   replay <story> [--json|--brief]   a story's state rebuilt from its event log (spec 26), reading only
//   reconcile [--json] | reconcile <story> --act <id> --found done|not-done --how "…"
//                                    check acts a stopped agent left open against git; record a finding
//   requests [--json]                 open approval requests and approvals in force
//   requests drop <n>|all [--reason …] [--via pane]   drop requests nobody needs answered any more
//   ask "<question>" [--story ST-n] [--blocks] [--why …] [--option "Label: what it does"]...
//                                    the lead asks the person what it can't settle; ask [--json] lists them
//   ask answer <id> "<answer>" [--via pane] | ask withdraw <id> --reason …
//   report "<title>" --what … [--expected …] [--command …] [--refusal …] [--rule …]
//                                    with harness.report.on, an agent drafts a bug report for code-kit
//   report [--json] | report send|discard <id>   the person sends a draft to code-kit's GitHub, or not
//   stops [--session id] [--json]     finish checks that refused an agent's last stop, still failing
//   sent-back <branch> [--reason …]   records that a review sent the branch back at its current commit
//   standards [--json] [--for <path>...]
//                                    the project's standards, with an organisation's, and their problems
//   settings [--json] | settings set <key> <value> --reason … [--via pane]
//                                    the harness settings; set is the person's own change
//                         record approvals a person gave in chat (with approvals.lead on, the lead runs it)
//   decisions [--json] [--all]       what waits on the person in this session, and a count of each other's
//   who                              which session this is, whether it leads, and its task (spec 23)
//   sessions [--json] | sessions lead the sessions working the project; make this one the lead
//   task "<what>" --touches globs | task done | task take <session>
//                                    a working session's ad hoc task and the paths it leases
//   lanes [--json] | lanes release <lane>
//                                    the lanes running a story now, one each across sessions (spec 23)
//   ci check [--json] | ci usage [--days N] [--json]
//                                    what the project's CI spends and what multiplies it (spec 25)
//   release <version>                cut release/<version> from the base and push it: the full CI runs there
// --config <file> reads a draft (.claude/code-kit.draft.json) instead of .claude/code-kit.json.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { BASELINE_FILE, loadBaseline } from '../hooks/lib/baseline.mjs';
import { matchesAny } from '../hooks/lib/glob.mjs';
import {
  CONFIG_FILE,
  approvalSettings,
  committedConfig,
  effectiveConfig,
  mergeDelegation,
  validate,
  withApprovalSetting,
} from '../hooks/lib/config.mjs';
import { diffConfigs, ownershipMoves } from '../hooks/lib/diff.mjs';
import { CODE, importsOf, layerOf, layerProblems, targetOf } from '../hooks/lib/layers.mjs';
import {
  ADAPTERS,
  activeAdapters,
  adapterFacts,
  providerAdapterOf,
} from '../hooks/lib/adapters/index.mjs';
import {
  EVENT_PARTS,
  USAGE_DIR,
  buildSnapshot,
  mainCheckout,
  snapshotHash,
  snapshotProblems,
} from '../hooks/lib/snapshot.mjs';
import { nextStep } from '../hooks/lib/next.mjs';
import { discardReport, draftReport, readReports, sendReport } from '../hooks/lib/report.mjs';
import {
  answerQuestion,
  askQuestion,
  readQuestions,
  withdrawQuestion,
} from '../hooks/lib/questions.mjs';
import { traceFile } from '../hooks/lib/trace.mjs';
import { buildStatus, readStories, specCheckRows } from '../hooks/lib/plan.mjs';
import { recordSentBack } from '../hooks/lib/reviews.mjs';
import {
  SECURITY_AGENT,
  SECURITY_AGENT_FILE,
  reasonsInWords,
  securityReview,
} from '../hooks/lib/security.mjs';
import { storyTimes } from '../hooks/lib/timeline.mjs';
import { PROJECT, projectMap, storyMap, trail } from '../hooks/lib/storymap.mjs';
import { journal } from '../hooks/lib/journal.mjs';
import {
  INSTRUCTIONS_VERSION,
  agentRules,
  instructionsState,
  leadSection,
  writeInstructions,
} from '../hooks/lib/instructions.mjs';
import { dequeue, enqueue, lastMerged, readQueue, settle, waiting } from '../hooks/lib/queue.mjs';
import { publishBase } from '../hooks/lib/publish.mjs';
import {
  briefOf,
  readEvents,
  reconcileAll,
  recordFinding,
  replay as replayEvents,
} from '../hooks/lib/events.mjs';
import { SETTINGS, parseSetting, settingOf, withSetting } from '../hooks/lib/harness.mjs';
import { claimLead, readLoop, releaseLead, writeLoop } from '../hooks/lib/loop-state.mjs';
import {
  claimChanges,
  storyOfBranch,
  syncBoard,
  readCache,
  mergedClaims,
  teamOf,
  teamProvider,
  whoami,
} from '../hooks/lib/team.mjs';
import { codeowners, decisionRecord, slugOf } from '../hooks/lib/teamfacts.mjs';
import {
  APPROVAL_MINUTES,
  approvalLifetime,
  currentBranch,
  PANE,
  approvalHistory,
  approvalsInForce,
  decidedBy,
  delegatedMark,
  grantApprovals,
  dropRequests,
  openRequests,
  ownerOf,
  reviewerOf,
} from '../hooks/lib/rules.mjs';
import { DEPENDENCY_APPROVAL, dependencyApproval } from '../hooks/lib/dependencies.mjs';
import {
  PYPI_MANAGERS,
  dependencyRuleProblems,
  npmFacts,
  packageOf,
  pypiFacts,
} from '../hooks/lib/registry.mjs';
import { heldTo, laneOfBranch, verifyBranch } from '../hooks/lib/verify.mjs';
import { skippedLine } from '../hooks/lib/checks.mjs';
import { TESTS_APPROVAL } from '../hooks/lib/regression.mjs';
import { freshCheckout } from '../hooks/lib/checkout.mjs';
import { laneClaim, laneClaims, releaseLane, shortSession } from '../hooks/lib/laneclaims.mjs';
import { slicesOf } from '../hooks/lib/schedule.mjs';
import {
  leadSession,
  makeLead,
  memberOf,
  readSession,
  seeSession,
  sessions,
  setTask,
  takeTask,
} from '../hooks/lib/sessions.mjs';
import { globsOverlap } from '../hooks/lib/teamfacts.mjs';
import {
  BUSY_MS,
  agentBusy,
  cleanOf,
  discardWorktree,
  keptBecause,
  pruneWorktrees,
  removeWorktree,
  worktrees,
} from '../hooks/lib/worktrees.mjs';
import { decisionsFor, openDecisions } from '../hooks/lib/decisionstore.mjs';
import { WORKFLOWS_DIR, ciFindings, ciUsage, releaseBranch } from '../hooks/lib/ci.mjs';
import {
  appliesTo,
  projectStandards,
  readInherited,
  standardLine,
  writeInherited,
} from '../hooks/lib/standards.mjs';

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
// SESS-1: the session calling, as Claude Code tells every command an agent runs, unless --session says.
const callerSession = sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
// A provider's command hears which session is calling, for that session's own live link.
if (callerSession) process.env.CODE_KIT_SESSION = callerSession;
const minutesGiven = option('--minutes');
const daysGiven = option('--days');
const answerGiven = option('--answer');
const actGiven = option('--act');
const foundGiven = option('--found');
const howGiven = option('--how');
const leaseGiven = option('--lease');
const touchesGiven = option('--touches');
const techLeadGiven = option('--tech-lead');
const staleDaysGiven = option('--stale-days');
const intentsGiven = option('--intents');
const ownersGiven = [];
for (let o = option('--owner'); o !== undefined; o = option('--owner')) ownersGiven.push(o);
const storyGiven = option('--story');
const whyGiven = option('--why');
const whatGiven = option('--what');
const expectedGiven = option('--expected');
const commandGiven = option('--command');
const refusalGiven = option('--refusal');
const ruleGiven = option('--rule');
const optionsGiven = [];
for (let o = option('--option'); o !== undefined; o = option('--option')) optionsGiven.push(o);
const FLAGS = [
  '--write',
  '--no-checks',
  '--json',
  '--brief',
  '--delegated',
  '--person',
  '--fresh',
  '--peek',
  '--off',
  '--blocks',
  '--take',
  '--dry-run',
  '--for',
];
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
  // Delegation is the base's, by the rules committed there: a branch can't grant itself merges.
  const delegation = mergeDelegation('.', config, file);
  // TEAM-1: the team, with its defaults, and who the developer at this machine is.
  report.team = teamOf(raw);
  report.me = report.team ? whoami(resolve('.')) : null;
  report.delegatesMerge = delegation.delegated;
  report.firstMerge = delegation.first;
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
  const team = teamOf(raw);
  if (team) {
    const me = whoami(resolve('.'));
    out(
      `Team: ${team.techLead} is the tech lead; a claim is stale after ${team.staleDays} working day${team.staleDays === 1 ? '' : 's'} without a push; provider ${team.provider === 'github' ? 'GitHub' : (team.provider.name ?? team.provider.command)}.`,
    );
    for (const [lane, owners] of Object.entries(team.owners))
      out(`Lane ${lane} is owned by ${owners.join(', ')}`);
    out(
      me
        ? `You are ${me}${me === team.techLead ? ', the tech lead' : ''}.`
        : "You aren't signed in to GitHub (gh auth login), so claims and owners can't be checked.",
    );
  }
}

/** SESS-1: which session the caller is, whether it leads the project, and its task. */
function whoAmI() {
  load();
  const root = resolve('.');
  const me = callerSession ? readSession(root, callerSession) : null;
  if (!me)
    return out(
      callerSession
        ? `Session ${shortSession(callerSession)}, which code-kit hasn't recorded yet.`
        : 'Not run from a Claude Code session, so no member of the team.',
    );
  const lead = leadSession(root);
  out(
    `${memberOf(me)}: ${me.role === 'lead' ? 'the lead session' : `a working session${lead ? ` (${memberOf(lead)} leads)` : ' (no session leads now)'}`}${me.task ? `, working on "${me.task.title}"` : ''}.`,
  );
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
  tests: 'Weakened tests',
  regression: 'Fixes and their tests',
  standards: 'Standards',
  checks: 'Checks',
};

// The lead merges a reviewed branch into a protected branch on its own, only where the config delegates
// merges, and only when `verify` passes on that branch, checks included. A person merges with git.
// With --person, the person merges (the mod passes it for a press in its pane): the same verify first,
// with no delegation needed. The hooks refuse --person from every agent.
/** The config committed on `ref`, or null when it has none yet; an invalid one stops here. */
function configAt(ref) {
  const { config, error } = committedConfig('.', ref, file);
  if (error) die(error);
  return config ?? null;
}

/**
 * SETUP-2: a project set up before setup committed its rules onto the base has none there, so nothing
 * could be merged by the lead. `queue rules` commits the rules as committed on this branch (the ones the
 * person approved) onto the base, as setup now does, without checking the base out: a commit of the base
 * with those files changed, the base moved to it. Only while the base has no rules, and only the lead.
 */
function rulesOntoBase(root, config) {
  const into = intoName ?? config.branches.protected[0];
  const git = (args, opts = {}) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', ...opts }).trim();
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head === into)
    die(
      `You're on ${into}: commit ${file} here as setup does (\`git add ${file} && git commit\`), which the hooks allow while ${into} has no rules.`,
    );
  if (configAt(into))
    return out(
      `${into} already has code-kit's rules committed; the merge queue merges under them.`,
    );
  if (!configAt('HEAD'))
    die(
      `${head} has no ${file} committed. Commit the rules the person approved first, then run this again.`,
    );
  const used = git(['worktree', 'list', '--porcelain'])
    .split('\n')
    .some((l) => l === `branch refs/heads/${into}`);
  if (used)
    die(
      `${into} is checked out in a worktree, so moving it here would leave that checkout behind. Commit ${file} in that checkout instead (the hooks allow it while ${into} has no rules).`,
    );
  // The rules, and the baseline of existing violations they were approved with.
  const files = [file, BASELINE_FILE].filter((f) => {
    try {
      execFileSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${f}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  const index = join(tmpdir(), `code-kit-rules-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(['read-tree', into], { env });
    for (const f of files)
      git(
        ['update-index', '--add', '--cacheinfo', `100644,${git(['rev-parse', `HEAD:${f}`])},${f}`],
        {
          env,
        },
      );
    const tree = git(['write-tree'], { env });
    const before = git(['rev-parse', into]);
    const commit = git(
      [
        'commit-tree',
        tree,
        '-p',
        before,
        '-m',
        `code-kit's rules onto ${into}, as the person approved them on ${head}\n\nFrom now on ${into}'s committed rules decide who merges into it.`,
      ],
      { env },
    );
    git(['update-ref', `refs/heads/${into}`, commit, before]);
  } finally {
    rmSync(index, { force: true });
  }
  const now = configAt(into);
  out(
    `Committed ${files.join(' and ')} onto ${into}, from ${head}. ${now?.approvals.delegate?.merge ? 'The lead merges the queue from now on (code-kit queue merge --delegated).' : `${into}'s rules don't delegate merges, so the person merges the queue.`}`,
  );
}

/** Why the first merge into `into`, which has no config committed yet, is the person's. */
const firstMerge = (into, branch) =>
  `${into} has no ${file} committed yet, so it delegates nothing. Put the approved rules onto it first: \`node "${process.argv[1]}" queue rules\`. Then merge ${branch} again; from then on ${into}'s committed rules decide who merges.`;

/** Why a merge didn't happen: `refused` (the rules), `verify` (problems) or `conflict`. */
class MergeStop extends Error {
  /** `first`: the first problem's first line, for the queue's record of why (#57). */
  constructor(kind, message, first = null) {
    super(message);
    this.kind = kind;
    this.first = first;
  }
}

/**
 * #70: the ecosystem a lane's packages come from, by the manifests in its paths: `uv` for a lane with a
 * pyproject.toml, requirements file or uv.lock and no package.json, otherwise `npm`.
 */
function laneEcosystem(config, lane) {
  const paths = lane ? (config.lanes[lane]?.paths ?? []) : (config.lead?.paths ?? []);
  const tracked = (spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')
    .filter((f) => f && matchesAny(f, paths));
  const named = (re) => tracked.some((f) => re.test(f.split('/').at(-1)));
  return named(/^(pyproject\.toml|uv\.lock|requirements[\w.-]*\.txt|Pipfile)$/) &&
    !named(/^package\.json$/)
    ? 'uv'
    : 'npm';
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

/**
 * MQ-6: what's merged into the base, put onto the remote's as the base's rules say (`branches.publish`):
 * pushed, or as a pull request. Moving the remote's base is the person's, or the lead's where pushing it
 * is delegated; otherwise a pull request waits for the person. '' where the base doesn't publish.
 */
function publishAfter(config, byPerson) {
  const into = intoName ?? config.branches.protected[0];
  const target = configAt(into) ?? config;
  const mode = target.branches.publish;
  if (!mode) return '';
  const mayMove = byPerson || target.approvals.delegate?.push === true;
  return ` ${publishBase(resolve('.'), into, { mode, mayMove }).message}`;
}

/** `publish --delegated|--person`: publishes what's merged and not yet on the remote, as a merge does. */
function publish() {
  const { config } = load();
  const byPerson = mergeMode();
  const into = intoName ?? config.branches.protected[0];
  if (!(configAt(into) ?? config).branches.publish)
    return out(
      `${into}'s rules don't say how merges reach the remote ("branches.publish" isn't set), so code-kit leaves pushing ${into} to you.`,
    );
  out(publishAfter(config, byPerson).trim());
}

function merge(branch) {
  const { config } = load();
  const byPerson = mergeMode();
  try {
    const { message } = mergeOne(branch, config, byPerson);
    // A branch merged outside the queue leaves it too, as one the queue merged would.
    settle(resolve('.'), branch, 'merged');
    out(`${message}${publishAfter(config, byPerson)}`);
  } catch (e) {
    if (e instanceof MergeStop) die(e.message);
    throw e;
  }
}

/**
 * Verifies `branch`, checks included, and merges it into the base (`--into`, or the first protected
 * branch). With `commit`, the commit the lead's review passed, it verifies and merges exactly that
 * commit, and refuses if the branch has moved on from it. Returns { into, message }; throws a
 * MergeStop when nothing was merged.
 */
function mergeOne(branch, config, byPerson, commit = null) {
  const refuse = (message) => {
    throw new MergeStop('refused', message);
  };
  const into = intoName ?? config.branches.protected[0];
  // Whether the lead may merge, and which branches are protected, are the target's rules.
  // A person may make the first merge, under the rules it brings; the lead may not.
  const target = configAt(into) ?? (byPerson ? config : refuse(firstMerge(into, branch)));
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
    for (const t of temporary.splice(0)) {
      if (t.remove) {
        t.remove();
        continue;
      }
      try {
        g(root, 'worktree', 'remove', '--force', t);
      } catch {
        // already gone
      }
    }
  };
  const fail = (message, kind = 'refused', first = null) => {
    cleanup();
    throw new MergeStop(kind, message, first);
  };
  const worktree = (b, detach) => {
    const dir = mkdtempSync(join(tmpdir(), 'code-kit-merge-'));
    rmSync(dir, { recursive: true });
    g(root, 'worktree', 'add', '--quiet', ...(detach ? ['--detach'] : []), dir, b);
    temporary.push(dir);
    return dir;
  };
  try {
    const tip = g(root, 'rev-parse', `refs/heads/${branch}`).trim();
    if (commit && tip !== commit)
      fail(
        `Nothing was merged: ${branch} has moved on since its review passed (${commit.slice(0, 7)} → ${tip.slice(0, 7)}). Review it again, then queue it.`,
        'moved',
      );
    // MQ-1: verified as it will land: the branch merged with the base as it is now, in a fresh checkout
    // with its own copy of the installs (the branch's worktree's, else the main checkout's), so neither
    // a stale branch head nor a checkout without dependencies decides it.
    let fresh;
    try {
      fresh = freshCheckout(root, into, {
        merge: tip,
        installsFrom: checkedOut(branch) ?? root,
        prefix: 'code-kit-merge-',
      });
    } catch (e) {
      if (!e.conflict) throw e;
      fail(
        `Nothing was merged: ${branch} doesn't merge cleanly into ${into}. Merge ${into} into ${branch} and resolve it there, then merge again.\n${e.message}`,
        'conflict',
      );
    }
    temporary.push(fresh);
    const verifyIn = fresh.dir;
    const lane = laneOfBranch(branch, config);
    const { changed, found, skipped, unfinished } = verifyBranch({
      root: verifyIn,
      base: into,
      config,
      lane,
      checks: true,
      branch,
    });
    const problems = Object.entries(VERIFY_GROUPS).flatMap(([key, title]) =>
      found[key].map((p) => `${title}: ${p.split('\n').join('\n    ')}`),
    );
    // #62: a check that only ran out of time says nothing against the branch: it's tried again.
    if (problems.length === 1 && unfinished)
      fail(
        `Nothing was merged: a check on ${branch} didn't finish, which says nothing against the branch (checked in ${verifyIn}):\n  ${problems[0]}\nIt stays at the head of the queue; merge again once fewer suites are running.`,
        'unfinished',
      );
    if (problems.length)
      fail(
        `Nothing was merged. code-kit verify found ${problems.length} problem(s) on ${branch} (checked in ${verifyIn}):\n  ${problems.join('\n  ')}\nSend it back to its lane, or fix it, then merge again.`,
        'verify',
        problems[0].split('\n')[0],
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
        `Verified with code-kit verify (${changed.length} file(s)${lane ? `, held to ${heldTo(lane)}` : ''}) at ${tip.slice(0, 7)}${commit ? ', the commit the review passed,' : ''} and merged ${byPerson ? 'by the person, from the code-kit pane' : 'by the lead within the delegated rules'}.${skipped.length ? ` ${notRun(skipped)}` : ''}`,
        tip,
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
    // TEAM-1: a merged story's claim ends, whoever merged it, and so does any an earlier merge left.
    const team = teamOf(config);
    const story = storyOfBranch(branch);
    let unreleased = '';
    if (team) {
      const provider = teamProvider(resolve('.'), team);
      const left = story ? provider.release(story, { merged: true }) : { ok: true };
      if (!left?.ok)
        unreleased = ` Its claim on ${story} wasn't released (${left?.why ?? "the team provider didn't answer"}): run code-kit team release ${story}.`;
      for (const s of mergedClaims(root, provider.state()?.claims ?? [], into))
        if (s !== story) provider.release(s, { merged: true });
    }
    // LEAN-8: the merged branch's worktree, and any other that's done with, go now.
    const pruned = pruneWorktrees(root, config).removed;
    const removed = pruned.length
      ? ` Removed ${pruned.length} worktree${pruned.length === 1 ? '' : 's'} that ${pruned.length === 1 ? 'was' : 'were'} done with.`
      : '';
    return {
      into,
      message: `Merged ${branch} into ${into}: verify passed on ${changed.length} file(s)${lane ? `, held to ${heldTo(lane)}` : ''}, at ${tip.slice(0, 7)}.${skipped.length ? ` ${notRun(skipped)}` : ''}${removed}${unreleased}`,
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
    let commit;
    try {
      commit = execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      die(`There is no branch ${branch}.`);
    }
    // The commit the review passed: the queue merges exactly it, and a branch that moves is reviewed again.
    const added = enqueue(root, branch, commit);
    if (!added) return out(`${branch} is already in the merge queue, at ${commit.slice(0, 7)}.`);
    if (added === 'updated')
      return out(`${branch} keeps its place in the merge queue, now at ${commit.slice(0, 7)}.`);
    const place = waiting(readQueue(root)).length;
    return out(
      `Queued ${branch} at ${commit.slice(0, 7)} to merge${place > 1 ? `, ${place - 1} ahead of it` : ', next'}.`,
    );
  }
  if (sub === 'rules') return rulesOntoBase(root, config);
  if (sub === 'merge') {
    const byPerson = mergeMode();
    const entries = readQueue(root);
    const head = waiting(entries)[0];
    if (!head) return out('The merge queue is empty.');
    try {
      const { message } = mergeOne(head.branch, config, byPerson, head.commit ?? null);
      settle(root, head.branch, 'merged');
      const published = publishAfter(config, byPerson);
      const left = waiting(readQueue(root));
      return out(
        `${message}${published}${left.length ? ` Next in the queue: ${left[0].branch}.` : ' The queue is empty.'}`,
      );
    } catch (e) {
      if (!(e instanceof MergeStop)) throw e;
      // MQ-3: a conflict or a failed verify goes back to the lane; a refusal leaves the queue as it is.
      if (e.kind === 'refused') die(e.message);
      // A branch that moved after its review leaves the queue for the lead to review it again; it
      // isn't sent back, since nothing is wrong with it yet.
      if (e.kind === 'unfinished') die(e.message);
      if (e.kind === 'moved') {
        settle(root, head.branch, 'moved', 'changed after its review');
        die(`${e.message}\n${head.branch} leaves the queue until then.`);
      }
      const into = intoName ?? config.branches.protected[0];
      const after = lastMerged(entries);
      const why =
        e.kind === 'conflict'
          ? `conflicts with ${into}${after ? ` after ${after}` : ''}`
          : `fails verify against ${into}${after ? ` after ${after}` : ''}${e.first ? `: ${e.first}` : ''}`;
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
      'code-kit queue [--json] | queue add <branch> | queue drop <branch> | queue rules | queue merge --delegated|--person',
    );
  const entries = readQueue(root);
  if (flag('--json')) return out(JSON.stringify(entries, null, 2));
  const left = waiting(entries);
  if (!left.length) out('The merge queue is empty.');
  else out(`${left.length} waiting to merge, in order:`);
  left.forEach((e, i) =>
    out(
      `  ${i + 1}. ${e.branch} (passed review ${e.passed}${e.commit ? ` at ${e.commit.slice(0, 7)}` : ''})`,
    ),
  );
}

/**
 * MAP-1: a story's code: the files it changed by layer, with the imports between them, and what the
 * active adapters know of each (its card, its rules). `map <id> --json` is what the pane draws.
 */
function mapCommand(id) {
  const { config, raw } = load();
  // MAP-5: the whole project, by folder, for when no story is at work.
  if (id === PROJECT) {
    const map = projectMap(resolve('.'), config, tracked());
    if (flag('--json')) return out(JSON.stringify(map, null, 2));
    out(`The whole project (${map.files.length} folder(s)):`);
    for (const layer of map.layers) {
      out(`  ${layer}`);
      for (const f of map.files.filter((x) => x.layer === layer))
        out(`    ${f.path} (${f.files})${f.imports.length ? `  → ${f.imports.join(', ')}` : ''}`);
    }
    return;
  }
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die('map needs docs.specs and docs.plan in the config. The spec-design skill writes both.');
  const from = base(config, false);
  const { stories } = buildStatus('.', config, from, tracked());
  const s = stories.find((x) => x.id === id.toUpperCase());
  if (!s) die(`There is no story ${id} in ${plan}.`);
  const map = storyMap(resolve('.'), s, config, from);
  const facts = adapterFacts(raw, resolve('.'), { paths: map.files.map((f) => f.path) });
  for (const f of map.files)
    f.adapters = Object.fromEntries(
      facts.filter((a) => a.files?.[f.path]).map((a) => [a.name, a.files[f.path]]),
    );
  map.open = facts.find((a) => a.open)?.open ?? null;
  if (flag('--json')) return out(JSON.stringify(map, null, 2));
  out(`${s.id} ${s.title} (${map.files.length} file(s)):`);
  for (const layer of map.layers) {
    out(`  ${layer}`);
    for (const f of map.files.filter((x) => x.layer === layer))
      out(`    ${f.path}${f.imports.length ? `  → ${f.imports.join(', ')}` : ''}`);
  }
}

/** JOURNAL-1: the build's lineage, from the request to each merge, in plain sentences. */
function journalCommand() {
  const { config } = load();
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die('journal needs docs.specs and docs.plan in the config. The spec-design skill writes both.');
  const from = base(config, false);
  const events = journal(
    resolve('.'),
    buildStatus('.', config, from, tracked()),
    from,
    config.docs,
  );
  if (flag('--json')) return out(JSON.stringify({ base: from, events }, null, 2));
  for (const e of events)
    out(`${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')}  ${e.text}`);
}

/** TRAIL-1: each requirement to its stories, the code they changed and the tests that name it. */
function trailCommand() {
  const { config } = load();
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    die('trail needs docs.specs and docs.plan in the config. The spec-design skill writes both.');
  const from = base(config, false);
  const status = buildStatus('.', config, from, tracked());
  const rows = trail(resolve('.'), status, from);
  if (flag('--json')) return out(JSON.stringify({ base: from, requirements: rows }, null, 2));
  for (const r of rows)
    out(
      `${pad(r.id, 10)} ${pad(r.stories.map((s) => s.id).join(', ') || '-', 14)} ${pad(`${r.files.length} file(s)`, 10)} ${r.tests.length ? r.tests.join(', ') : 'no test names it'}`,
    );
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
        branch: s.branch,
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
  const { config } = load();
  // CARD-7: a request nobody needs answered any more is dropped: the person's Dismiss, or the lead.
  if (rest[0] === 'drop') {
    if (!rest[1])
      die('code-kit requests drop <n>|all [--reason "…"]: n as `code-kit requests` numbers them.');
    const r = dropRequests(resolve('.'), rest[1], {
      by: via === 'pane' ? 'person' : 'lead',
      reason: reason ?? null,
    });
    if (!r.ok) die(r.why);
    return out(
      `Dropped ${r.dropped.length} request${r.dropped.length === 1 ? '' : 's'}: ${r.dropped.map((d) => `${d.names.join(', ')} for ${d.lane ? `the ${d.lane} lane` : d.actor}`).join('; ')}.`,
    );
  }
  // HELM-2: each request's number for `requests drop`, and whose decision it is.
  const open = openRequests(resolve('.')).map((r, i) => ({
    ...r,
    n: i + 1,
    by: decidedBy(r.names, config, r.lane ? { kind: 'lane', lane: r.lane } : { kind: 'lead' }),
  }));
  const granted = approvalsInForce(resolve('.'));
  // CARD-6: every approval given, newest first.
  const history = approvalHistory(resolve('.')).slice(0, 100);
  if (flag('--json')) return out(JSON.stringify({ open, inForce: granted, history }, null, 2));
  out(open.length ? `${open.length} approval request(s) open:` : 'No approval requests open.');
  open.forEach((r) =>
    out(
      `  ${r.n}. ${r.names.join(', ')} for ${r.lane ? `the ${r.lane} lane` : r.actor}, ${r.by === 'lead' ? "the lead's to decide" : "the person's to decide"}: ${r.what}  (${r.why}; asked ${r.at.slice(0, 16).replace('T', ' ')})`,
    ),
  );
  out(granted.length ? `\n${granted.length} approval(s) in force:` : '\nNo approvals in force.');
  for (const a of granted)
    out(
      `  ${a.name} for ${a.lane ? `the ${a.lane} lane` : 'any agent'}, ${a.minutesLeft} min left: ${a.reason}`,
    );
  out(history.length ? `\nApprovals given (newest first):` : '\nNo approvals given yet.');
  for (const h of history.slice(0, 30))
    out(
      `  ${h.at.slice(0, 16).replace('T', ' ')}  ${h.name} for ${h.lane ? `the ${h.lane} lane` : 'any agent'}, by ${h.by}${h.files.length ? ` · ${h.files.length} file${h.files.length === 1 ? '' : 's'}${h.branches.length ? ` on ${h.branches.join(', ')}` : ''}` : ''}: ${h.reason}`,
    );
}

/**
 * OWN-1: the decisions waiting on the person in this session (the lead's questions, the approvals its
 * refusals asked for), and a count of those in each other session; `--all` lists every session's.
 */
function decisionsCommand() {
  const { config } = load();
  const root = resolve('.');
  if (rest.length) die('code-kit decisions [--json] [--all]');
  const stories =
    config.docs?.specs && config.docs?.plan
      ? buildStatus('.', config, base(config, false), tracked()).stories
      : [];
  if (flag('--all')) {
    const all = openDecisions(root, { stories });
    if (flag('--json')) return out(JSON.stringify(all, null, 2));
    if (!all.length) return out('Nothing waits on the person.');
    for (const d of all)
      out(
        `${pad(d.member ?? 'any session', 30)} ${pad(d.kind, 8)} ${d.what}${d.count > 1 ? ` (asked ${d.count} times)` : ''}`,
      );
    return;
  }
  const r = decisionsFor(root, callerSession, { stories });
  if (flag('--json')) return out(JSON.stringify(r, null, 2));
  if (!r.mine.length) out('Nothing waits on the person in this session.');
  for (const d of r.mine)
    out(`${pad(d.kind, 8)} ${d.what}${d.count > 1 ? ` (asked ${d.count} times)` : ''}`);
  for (const e of r.elsewhere)
    out(`${e.count} decision${e.count === 1 ? '' : 's'} in session ${e.member}, answered there.`);
}

/**
 * SESS-1, SESS-2: the sessions working the project, which one leads, and each one's task; `beat` (the mod,
 * while a session is open) says the session is still there; `lead` makes the caller's session the lead.
 */
function sessionsCommand() {
  load();
  const root = resolve('.');
  const [sub] = rest;
  if (sub === 'beat' || sub === 'lead') {
    if (!callerSession) die(`code-kit sessions ${sub} needs the session: --session <id>.`);
    if (sub === 'beat') return seeSession(root, callerSession) && out('Seen.');
    const was = leadSession(root);
    makeLead(root, callerSession);
    return out(
      `This session (${shortSession(callerSession)}) leads the project now${was && was.id !== callerSession ? `; ${shortSession(was.id)} is a working session` : ''}.`,
    );
  }
  if (sub !== undefined) die('code-kit sessions [--json] | sessions lead | sessions beat');
  const all = sessions(root).filter((s) => s.live || s.task);
  if (flag('--json'))
    return out(
      JSON.stringify(
        all.map((s) => ({ ...s, member: memberOf(s) })),
        null,
        2,
      ),
    );
  if (!all.length) return out('No session is working this project.');
  for (const s of all)
    out(
      `${pad(memberOf(s), 30)} ${pad(s.live ? s.role : 'ended', 8)} ${s.task ? `${s.task.title}${s.task.paths?.length ? ` (${s.task.paths.join(', ')})` : ''}${s.live ? '' : ', stale'}` : '-'}${s.id === callerSession ? '  ← this session' : ''}`,
    );
}

/**
 * SESS-4: an ad hoc task, for a session working without a story: recorded with the paths it leases, so
 * the other sessions' agents leave them alone; `done` ends it; `take <session>` moves a stale one here.
 */
function taskCommand() {
  load();
  const root = resolve('.');
  const [sub] = rest;
  if (!callerSession)
    die(
      'code-kit task needs the session: run it from Claude Code (CLAUDE_CODE_SESSION_ID), or pass --session <id>.',
    );
  if (sub === 'done') {
    const had = readSession(root, callerSession)?.task;
    if (!had) return out('This session has no task.');
    setTask(root, callerSession, null);
    return out(`Done: "${had.title}". Its paths are free for other sessions.`);
  }
  if (sub === 'take') {
    if (rest.length !== 2) die('code-kit task take <session>');
    const r = takeTask(root, rest[1], callerSession);
    if (!r.ok) die(r.why);
    return out(
      `This session took over "${r.task.title}" from ${memberOf(r.from)}${r.task.paths?.length ? `, leasing ${r.task.paths.join(', ')}` : ''}.`,
    );
  }
  if (sub === undefined) {
    const s = readSession(root, callerSession);
    if (flag('--json')) return out(JSON.stringify(s?.task ?? null));
    return out(
      s?.task
        ? `"${s.task.title}"${s.task.paths?.length ? `, leasing ${s.task.paths.join(', ')}` : ''}.`
        : 'This session has no task.',
    );
  }
  if (rest.length !== 1)
    die(
      'code-kit task "<what you\'re doing>" --touches "<globs>" | task done | task take <session>',
    );
  const paths = (touchesGiven ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  const clash = sessions(root).find(
    (s) =>
      s.live &&
      s.id !== callerSession &&
      s.task?.paths?.some((p) => paths.some((q) => globsOverlap(p, q))),
  );
  if (clash)
    die(
      `Another session (${memberOf(clash)}) is working on "${clash.task.title}", leasing ${clash.task.paths.join(', ')}. Pick paths it doesn't lease, or wait until it's done.`,
    );
  const branch = currentBranch(root) ?? null;
  setTask(root, callerSession, { title: sub.trim(), paths, branch });
  out(
    `This session is working on "${sub.trim()}"${paths.length ? `, leasing ${paths.join(', ')}` : ''}. \`code-kit task done\` when it's finished.`,
  );
}

/**
 * SCHED-1: the lanes claimed now, one story each across every session, or one lane released: for an
 * agent the lead saw stop without finishing, so its lane can take the next story.
 */
function lanesCommand() {
  const { config } = load();
  const root = resolve('.');
  if (rest[0] === 'release') {
    const lane = rest[1];
    if (!lane || rest.length !== 2) die('code-kit lanes release <lane>');
    if (!config.lanes[lane])
      die(`There is no lane "${lane}". Lanes: ${Object.keys(config.lanes).join(', ')}.`);
    const held = laneClaim(root, lane);
    if (!releaseLane(root, lane)) return out(`The ${lane} lane isn't claimed.`);
    return out(
      `Released the ${lane} lane${held.story ? ` (it was running ${held.story})` : ''}. Its next story can start.`,
    );
  }
  if (rest.length) die('code-kit lanes [--json] | lanes release <lane>');
  const claims = laneClaims(root);
  if (flag('--json')) return out(JSON.stringify(claims, null, 2));
  if (!claims.length) return out('No lane is running a story.');
  for (const c of claims)
    out(
      `${c.lane.padEnd(12)} ${(c.story ?? 'a story').padEnd(8)} session ${shortSession(c.session) ?? '?'}, since ${c.since.slice(0, 16).replace('T', ' ')} UTC${c.stale ? ' (stale: no agent seen to finish in 12 hours)' : ''}`,
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
    const approvalKey = key.startsWith('approvals.');
    if (!(key in SETTINGS) && !approvalKey)
      die(
        `${key} isn't a setting. They are: ${Object.keys(SETTINGS).join(', ')}, and approvals.<name> (see code-kit settings).`,
      );
    if (!reason?.trim()) die('Give a reason with --reason "…": the approval log keeps it.');
    // WHO-3: who decides an approval is the person's setting too, written out in full.
    const changed = approvalKey
      ? withApprovalSetting(raw, config, key, value)
      : withSetting(raw, key, parseSetting(key, value));
    if (!changed)
      die(
        `${key} isn't an approval setting, or ${JSON.stringify(value)} isn't one of its values. See code-kit settings.`,
      );
    const problems = validate(changed);
    if (problems.length) die(`Nothing changed: ${problems.join('; ')}`);
    writeFileSync(resolve(file), `${JSON.stringify(changed, null, 2)}\n`);
    const mark =
      via === 'pane' ? '(changed in the code-kit pane)' : '(changed with code-kit settings)';
    grantApprovals(resolve('.'), ['kit'], null, reason, { kit: mark });
    const now = approvalKey
      ? approvalSettings(effectiveConfig(changed, resolve('.'))).find((r) => r.key === key)?.value
      : settingOf(changed.harness, key);
    return out(
      `Set ${approvalKey ? key : `harness.${key}`} to ${JSON.stringify(now)}. Commit ${file} to keep it; the approval log will carry your reason.`,
    );
  }
  if (rest.length) die('code-kit settings [--json] | settings set <key> <value> --reason "<why>"');
  const rows = [
    ...Object.entries(SETTINGS).map(([key, s]) => ({
      key,
      value: settingOf(config.harness, key),
      default: s.default,
      about: s.about,
      section: 'Harness',
      // Chosen in the config, or the default standing in.
      set: settingOf(raw.harness, key) !== undefined,
    })),
    ...approvalSettings(config),
  ];
  if (flag('--json')) return out(JSON.stringify(rows, null, 2));
  for (const r of rows)
    out(
      `${r.key.padEnd(44)} ${JSON.stringify(r.value).padEnd(14)} ${r.value === r.default ? '' : `(default ${JSON.stringify(r.default)}) `}${r.about}`,
    );
}

/**
 * CIC-2, CIC-4: `ci check` lists what in the project's workflows multiplies their cost with a story per
 * branch; `ci usage` sums the Actions runs of the last days, by workflow and trigger.
 */
function ciCommand() {
  const { config } = load();
  const root = resolve('.');
  const [sub] = rest;
  if (sub === 'check') {
    const found = ciFindings(root, config.branches.protected[0]);
    if (flag('--json')) return out(JSON.stringify(found, null, 2));
    if (!found.length)
      return out(
        existsSync(join(root, WORKFLOWS_DIR))
          ? "Nothing in the project's workflows multiplies their cost: no full run per merge or pull request, every job has a time limit."
          : `No workflows in ${WORKFLOWS_DIR}.`,
      );
    let last = null;
    for (const f of found) {
      if (f.file !== last) out(`${last ? '\n' : ''}${f.file}`);
      last = f.file;
      out(`  ${f.kind}: ${f.what}.\n    Fix: ${f.fix}.`);
    }
    out(
      "\nChanging CI is the person's to approve (approval ci). A release then runs the full suite once: code-kit release <version>.",
    );
    return;
  }
  if (sub === 'usage') {
    const days = Number(daysGiven ?? 7);
    if (!Number.isFinite(days) || days <= 0) die('--days takes a number of days, such as 7.');
    const u = ciUsage(root, { days });
    if (u.error) die(u.error);
    if (flag('--json')) return out(JSON.stringify(u, null, 2));
    out(
      `${u.repo}, the last ${days} day${days === 1 ? '' : 's'}: ${u.runs} run${u.runs === 1 ? '' : 's'}, about ${u.minutes} minutes of wall-clock time (GitHub bills each job, rounded up to the minute, so the bill is at least this).`,
    );
    for (const r of u.rows)
      out(
        `  ${String(r.minutes).padStart(6)} min  ${String(r.runs).padStart(4)} runs  ${r.workflow} (${r.event})${r.cancelled ? `, ${r.cancelled} cancelled` : ''}${r.failed ? `, ${r.failed} failed` : ''}`,
      );
    if (u.refused)
      out(
        `\nGitHub isn't starting this project's jobs: ${u.refused} The project's CI isn't running at all until that's resolved in the account's Billing settings.`,
      );
    return;
  }
  usage();
}

/** CIC-3: the release branch, cut from the base as committed and pushed, where the full CI runs once. */
function releaseCommand(version) {
  const { config } = load();
  const from = base(config, false);
  const r = releaseBranch(resolve('.'), version, { base: from });
  if (!r.ok) die(`Not released: ${r.why}`);
  if (flag('--json')) return out(JSON.stringify(r, null, 2));
  out(
    `Cut ${r.branch} from ${from} at ${r.commit.slice(0, 7)} and pushed it: the project's full CI runs on it now.`,
  );
  out(
    r.stories.length
      ? `Stories in it since ${r.since ?? 'the start'}: ${r.stories.join(', ')}.`
      : `No story ids in its commits since ${r.since ?? 'the start'}.`,
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
  const { changed, found, skipped } = verifyBranch({
    root: resolve('.'),
    base: from,
    config,
    lane,
    checks: !flag('--no-checks'),
    // REG-1 is code-kit's own, so CI's --no-checks still proves a fix.
    fixes: true,
    branch,
  });
  if (flag('--json')) {
    const count = Object.values(found).reduce((n, list) => n + list.length, 0);
    out(
      JSON.stringify(
        { base: from, branch, lane, changed: changed.length, found, problems: count, skipped },
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
  if (skipped.length) out(`\n${notRun(skipped)}`);
  if (count) die(`\n${count} problem(s). Fix them on this branch.`);
  out(skipped.length ? 'No problems in what ran.' : 'No problems.');
}

/** The checks that didn't run, for verify's and a merge's report. */
const notRun = (skipped) =>
  `Not run, because a tool isn't installed here: ${skipped.map(skippedLine).join('; ')}. Install it where verify runs, or set "ifMissing": "fail" on the check so a missing tool fails it.`;

/**
 * ONB-7: whether a branch's changes need the security reviewer, and why: sign-in, permissions, outside
 * input, personal data, encryption, payments, secrets, commands built from strings, new dependencies,
 * or a security requirement the story cites.
 */
function security() {
  const { config } = load();
  const from = base(config, false);
  let branch = branchName;
  if (!branch) {
    try {
      branch = currentBranch('.');
    } catch {
      die('This checkout has no branch; pass --branch <name>.');
    }
  }
  if (!refExists(branch)) die(`--branch ${branch} is not a known branch.`);
  const found = securityReview(resolve('.'), { base: from, branch, config });
  if (flag('--json')) return out(JSON.stringify({ base: from, ...found }, null, 2));
  const what = found.story ? `${found.story} on ${branch}` : branch;
  if (!found.needed)
    return out(
      `${what} needs no security review: against ${from}, it touches no sign-in, permissions, outside input, personal data, encryption, payments or secrets, adds no dependencies and cites no security requirement.`,
    );
  out(`${what} needs the security review. Against ${from}, it touches:`);
  for (const r of found.reasons) out(`  ${reasonsInWords([r])}`);
  out(
    found.agent
      ? `\nRun the ${SECURITY_AGENT} agent on the diff (git diff ${from}...${branch}) with the story's specs and their threat models. A blocker it finds sends the branch back, like a failing test.`
      : `\nThis project has no ${SECURITY_AGENT} agent (${SECURITY_AGENT_FILE}). Re-run /code-kit:init to add it; until then, review the diff as an attacker would yourself, against the specs' threat models.`,
  );
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
        {
          base: from,
          stories,
          slices: slicesOf(stories),
          requirements: byRequirement,
          problems,
          drift,
        },
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
      `  ${pad(s.id, 7)} ${pad(s.state, 12)} ${pad(s.lane || '-', 10)} ${pad(s.requirements.join(', '), 24)} ${detail}${s.slice ? `${detail ? ' · ' : ''}slice ${s.slice}` : ''}`.trimEnd(),
    );
  }
  // SCHED-2: the slices, in plan order, and which are open.
  const slices = slicesOf(stories);
  if (slices.length) {
    out('\nSlices:');
    for (const sl of slices)
      out(
        `  ${pad(sl.name, 24)} ${pad(sl.done ? 'done' : sl.open ? 'open' : 'not started', 12)} ${sl.stories.join(', ')}`,
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

/**
 * DUR-3, DUR-5: `replay <story>` rebuilds a story's state from its event log, reading only; `--json`
 * for the mod and the skills, `--brief` for the brief of the agent that carries the story on.
 */
function replayCommand(id) {
  const story = id.toUpperCase();
  const events = readEvents('.', story);
  const state = replayEvents(events);
  if (flag('--json'))
    return out(JSON.stringify({ story, events: events.length, ...state }, null, 2));
  if (!events.length)
    return out(
      `${story} has no event log (it started before code-kit kept one): read its state from git, its report and \`code-kit status\`.`,
    );
  const report = state.branch
    ? join('.claude/state/reports', `${state.branch.replace(/[^\w.-]+/g, '_')}.md`)
    : null;
  let reportAt = null;
  try {
    reportAt = report ? statSync(report).mtime.toISOString() : null;
  } catch {
    // no report written
  }
  if (flag('--brief')) return out(briefOf(story, state, { reportAt }));
  out(`${story}: ${state.phase ?? 'not started'}${state.branch ? ` on ${state.branch}` : ''}`);
  out(briefOf(story, state, { reportAt }).split('\n').slice(1).join('\n'));
}

/**
 * DUR-4: `reconcile` checks every act a stopped agent left open against git, as `next` does, and lists
 * what it settled and what it couldn't; `reconcile <story> --act <id> --found done|not-done --how "…"`
 * records the lead's own finding for an act git couldn't settle.
 */
function reconcileCommand(id) {
  const { config } = load();
  if (id) {
    if (!actGiven || !['done', 'not-done'].includes(foundGiven) || !howGiven)
      die('code-kit reconcile <story> --act <id> --found done|not-done --how "<how you know>"');
    const recorded = recordFinding(
      '.',
      id.toUpperCase(),
      actGiven,
      foundGiven === 'done' ? 'done' : 'not done',
      howGiven,
    );
    if (!recorded) die(`${id.toUpperCase()} has no act ${actGiven} left open.`);
    return out(`Recorded act ${actGiven} of ${id.toUpperCase()} as ${recorded.result.found}.`);
  }
  const result = reconcileAll('.', config, { base: findBase(config, false) });
  if (flag('--json')) return out(JSON.stringify(result, null, 2));
  if (!result.reconciled.length && !result.unknowns.length)
    return out('Nothing is left open by an agent that stopped.');
  for (const r of result.reconciled)
    out(`${r.story}: ${r.kind} \`${r.target}\` was ${r.found} (${r.how}); ${r.next}.`);
  for (const u of result.unknowns)
    out(
      `${u.story}: ${u.kind} \`${u.target}\` (act ${u.act}) is unknown: ${u.how}. The lead finds out and records it.`,
    );
}

function next() {
  const step = nextStep(resolve('.'), (config) => findBase(config, false));
  if (flag('--json')) return out(JSON.stringify(step, null, 2));
  const command = (s, args) => `/code-kit:${s}${args ? ` ${args}` : ''}`;
  const actionable = !['wait', 'done'].includes(step.step);
  out(actionable ? `Next: ${command(step.step, step.args)}` : `Next: ${step.step}`);
  out(`Why: ${step.why}`);
  for (const t of step.then) out(`Then: ${command(t.step, t.args)}`);
  // SCHED-3: the model each story offered to a lane runs on.
  for (const m of step.models ?? []) out(`Model: ${m.story} on ${m.model} (${m.why})`);
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
  const known = new Set(['kit', TESTS_APPROVAL, ...config.protected.map((p) => p.approval)]);
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
        'This project keeps every approval for the person ("approvals.delegate" is false). Ask the person.',
      );
    // HELM-3: the lead approves a package for a story it has read, not by default.
    const packages = names.filter((n) => n.startsWith(DEPENDENCY_APPROVAL));
    if (packages.length && !storyGiven)
      die(
        `Nothing was approved. Name the story the package is for, with --story ST-n: approve a dependency only when that story's requirements need it, nothing the project already depends on does the job, and it fits the principles and the layer it goes in.`,
      );
    const stories = storyGiven && config.docs?.plan ? readStories('.', config.docs.plan) : [];
    const story = storyGiven
      ? (stories.find((st) => st.id.toUpperCase() === storyGiven.toUpperCase()) ??
        (config.docs?.plan
          ? die(`Nothing was approved: ${config.docs.plan} has no story ${storyGiven}.`)
          : { id: storyGiven }))
      : null;
    const outside = [];
    for (const name of names) {
      // WHO-2: a weakened test on a lane's branch, after the lead's review; on its own, the person's.
      if (name === TESTS_APPROVAL) {
        if (!rules.tests) outside.push(`${name}: weakened tests aren't delegated`);
        else if (!laneName)
          outside.push(
            `${name}: on your own branch a weakened test is the person's; you approve one only for a lane, with --lane`,
          );
        else if (!storyGiven)
          outside.push(`${name}: name the story whose branch weakens the test, with --story ST-n`);
        else marks[name] = delegatedMark(`tests, reviewed by the lead, for ${story.id}`);
        continue;
      }
      if (name.startsWith(DEPENDENCY_APPROVAL)) {
        if (!rules.dependencies) {
          outside.push(`${name}: dependencies aren't delegated`);
          continue;
        }
        const pkg = packageOf(name);
        // HELM-3: the registry rules are npm's and PyPI's (#70); a package from another ecosystem is the
        // lead's judgement. Which one is the request's, or else the lane's own manifests'.
        const asked = new Set(
          openRequests(resolve('.'))
            .filter((r) => r.names.includes(name) && (r.lane ?? undefined) === laneName)
            .map((r) => r.registries?.[pkg])
            .filter(Boolean),
        );
        const registries = asked.size ? asked : new Set([laneEcosystem(config, laneName)]);
        const npm = registries.has('npm');
        const pypi = !npm && [...registries].some((r) => PYPI_MANAGERS.has(r));
        const facts = npm ? await npmFacts(pkg) : pypi ? await pypiFacts(pkg) : null;
        const problems = facts ? dependencyRuleProblems(facts, rules.dependencies) : [];
        if (problems.length) outside.push(`${name}: ${problems.join('; ')}`);
        else
          marks[name] = delegatedMark(
            `dependencies (${pkg}${npm ? '' : pypi ? ', from PyPI' : `, from ${[...registries].join(', ')}, judged by the lead`}) for ${story.id}`,
          );
      } else if (rules.protected.includes(name))
        marks[name] = delegatedMark(`protected: ${name}${story ? ` for ${story.id}` : ''}`);
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

/** How long ago an ISO time was, in words: "3 hours ago". */
function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The team (TEAM-2, TEAM-3, TEAM-8): `team` says who's on it and what's claimed, intended and open;
 * `team claim <story> [--lease globs]` and `team release <story>` change a claim through the provider.
 */
function teamCommand() {
  const { raw } = load();
  if (rest[0] === 'init') return teamInit(raw);
  const team = teamOf(raw);
  if (!team)
    die(
      'This project has no "team" in its config, so it has no claims or owners. Add "team": { "techLead": "<GitHub handle>" } to share them.',
    );
  // HUBR-6: a hosted provider's own commands (sign in, connect, status), through its adapter.
  if (rest[0] === 'provider') return providerCommand(raw);
  const provider = teamProvider(resolve('.'), team);
  const [sub, story] = rest;
  if (sub === 'report') return teamReport(team, provider);
  if (sub === 'pulse') return pulseCommand(raw, team, provider);
  const holderWords = (h) =>
    `${h.story} is claimed by ${h.by} (${ago(h.at)}). Ask them, or the tech lead (${team.techLead}), to release it.`;
  if (sub === 'claim') {
    if (!story) die('code-kit team claim <story> [--lease "<glob>,<glob>"]');
    const lease = (leaseGiven ?? '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    const r = provider.claim(story, lease);
    if (r.holder) die(holderWords(r.holder));
    if (!r.ok) die(r.why);
    return out(
      `Claimed ${story} as ${r.claim.by}${lease.length ? `, leasing ${lease.join(', ')}` : ''}.`,
    );
  }
  // TEAM-12: the plan mirrored onto the team's GitHub Project.
  if (sub === 'board') {
    if (!team.board)
      die(
        'This team has no board. Add "board": { "owner": "<user or organisation>", "number": <the Project\'s number> } to "team" in the config.',
      );
    const { config, raw: rawConfig } = load();
    if (!rawConfig.docs?.plan)
      die('The board mirrors the plan, and this project has no docs.plan.');
    const status = buildStatus('.', config, base(config, false), tracked());
    const state = provider.state();
    const r = syncBoard(resolve('.'), team, status.stories, state.claims ?? []);
    if (!r.ok) die(r.why);
    return out(
      `Board ${team.board.owner}/${team.board.number} synced: ${r.created} item${r.created === 1 ? '' : 's'} added, ${r.edited} field${r.edited === 1 ? '' : 's'} changed.`,
    );
  }
  // TEAM-11: GitHub's CODEOWNERS from the config, so GitHub asks the right people to review.
  if (sub === 'codeowners') {
    const text = codeowners({
      techLead: team.techLead,
      leadPaths: raw.lead.paths,
      lanes: raw.lanes,
    });
    if (!flag('--write')) return out(text.trimEnd());
    mkdirSync(resolve('.github'), { recursive: true });
    writeFileSync(resolve('.github/CODEOWNERS'), text);
    return out(
      "Wrote .github/CODEOWNERS. Commit it, and require code owners' review in a ruleset on the protected branch, so GitHub holds every pull request to it.",
    );
  }
  // TEAM-9: the holder keeps a stale claim (the clock starts again); the tech lead reassigns one.
  if (sub === 'keep') {
    if (!story) die('code-kit team keep <story>');
    const r = provider.claim(story);
    if (r.holder) die(holderWords(r.holder));
    if (!r.ok) die(r.why);
    return out(
      `Kept ${story}: it isn't stale until ${team.staleDays} more working day${team.staleDays === 1 ? '' : 's'} without a push.`,
    );
  }
  if (sub === 'reassign') {
    const to = rest[2];
    if (!story || !to) die('code-kit team reassign <story> <GitHub handle>');
    const r = provider.reassign(story, to);
    if (!r.ok) die(r.why);
    return out(`Reassigned ${story} from ${r.from} to ${r.to}, with its lease.`);
  }
  if (sub === 'release') {
    if (!story) die('code-kit team release <story>');
    const r = provider.release(story);
    if (!r.ok) die(r.why ?? holderWords(r.holder));
    return out(
      r.released ? `Released ${story} (${r.claim.by}'s claim).` : `${story} isn't claimed.`,
    );
  }
  // TEAM-6: what everyone did since you last looked; reading it marks it read, unless --peek.
  if (sub === 'since') {
    const root = resolve('.');
    const seenFile = join(root, '.claude/state/team-seen.json');
    let seen = null;
    try {
      seen = JSON.parse(readFileSync(seenFile, 'utf8'));
    } catch {
      // never looked: the last day
    }
    const from = seen ? Date.parse(seen.at) : Date.now() - 24 * 3600_000;
    const state = provider.state({ fresh: true });
    const activity = provider.since(from);
    const changes =
      seen && state.reachable !== false ? claimChanges(seen.claims, state.claims) : [];
    const all = [...(activity ?? []), ...changes].sort((a, b) => a.at - b.at);
    const people = {};
    for (const e of all) (people[e.by] ??= []).push(e);
    if (!flag('--peek')) {
      mkdirSync(join(root, '.claude/state'), { recursive: true });
      writeFileSync(
        seenFile,
        JSON.stringify({ at: new Date().toISOString(), claims: state.claims ?? [] }) + '\n',
      );
    }
    if (flag('--json'))
      return out(
        JSON.stringify(
          { since: new Date(from).toISOString(), github: activity !== null, people },
          null,
          2,
        ),
      );
    out(
      `Since ${seen ? ago(seen.at) : 'yesterday'}${activity === null ? " (GitHub's activity couldn't be read; claims only)" : ''}:`,
    );
    if (!all.length) return out('  Nothing new.');
    for (const [who, list] of Object.entries(people))
      out(`  ${who}${who === state.me ? ' (you)' : ''}: ${list.map((e) => e.text).join('; ')}.`);
    return;
  }
  if (sub !== undefined)
    die(
      'code-kit team [--json] [--fresh] | team init … | team since [--json] [--peek] | team claim|keep|release <story> | team reassign <story> <handle> | team report [--dry-run] [--json]',
    );
  const state = provider.state({ fresh: flag('--fresh') });
  if (flag('--json')) return out(JSON.stringify(state, null, 2));
  const you = state.me
    ? `You are ${state.me}${state.me === team.techLead ? ', the tech lead' : ''}.`
    : "You aren't signed in to GitHub (gh auth login).";
  out('Team mode is a preview: report anything that looks wrong.');
  out(`Tech lead: ${team.techLead}. ${you}`);
  if (state.reachable === false)
    out(
      `${state.why ?? "The shared repository can't be reached"}: claims and leases aren't checked until it can be; every other rule still holds.`,
    );
  if (state.github === false) out("GitHub's issues and pull requests couldn't be read (gh).");
  for (const [lane, owners] of Object.entries(team.owners))
    out(`Lane ${lane}: ${owners.join(', ')}`);
  out(state.claims.length ? 'Claims:' : 'Nothing is claimed.');
  for (const c of state.claims)
    out(
      `  ${c.story} by ${c.by}, ${ago(c.at)}${c.stale ? ` · stale, nothing since ${ago(c.active)}` : ''}${c.lease.length ? ` · leases ${c.lease.join(', ')}` : ''}`,
    );
  if (state.intents.length) out('Intents:');
  for (const i of state.intents)
    out(
      `  #${i.id} ${i.about} (${i.by})${i.touches.length ? ` · touches ${i.touches.join(', ')}` : ''}`,
    );
  if (state.pulls.length) out('Open pull requests:');
  for (const p of state.pulls)
    out(`  #${p.number} ${p.title} (${p.by}, ${p.branch}${p.draft ? ', draft' : ''})`);
}

// --- what a project reports (docs/specs/21-hub-adapter-and-reports.md) ----------------------------

const REPORT_SENT = '.claude/state/report-sent.json';
const REPORT_MINUTES = 10;

/** HUBR-2: the snapshot, from what status, timeline, trail, the journal and the config already know. */
function snapshotNow(team) {
  const { config } = load();
  if (!config.docs?.specs || !config.docs?.plan) return null;
  const from = base(config, false);
  const status = buildStatus('.', config, from, tracked());
  const claims = (readCache(resolve('.')) ?? {}).claims ?? [];
  return buildSnapshot({
    root: resolve('.'),
    config,
    status,
    base: from,
    claims,
    version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  });
}

/**
 * HUBR-3: sends the snapshot when what happened changed (stages, approvals, send-backs, merges), or when
 * only usage changed and ten minutes have passed; never the same snapshot twice. A provider that can't
 * be reached is tried again with the next change. `{ sent, why }`.
 */
function sendSnapshot(team, provider, snapshot, { force = false } = {}) {
  if (team.provider === 'github') return { sent: false, why: 'GitHub keeps no reports.' };
  if (!team.report) return { sent: false, why: 'team.report is false.' };
  const problems = snapshotProblems(snapshot);
  if (problems.length) return { sent: false, why: `The report isn't valid: ${problems[0]}.` };
  const file = join(mainCheckout(resolve('.')), REPORT_SENT);
  let last = {};
  try {
    last = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // nothing sent yet
  }
  const events = snapshotHash(snapshot, EVENT_PARTS);
  const all = snapshotHash(snapshot);
  const due =
    force ||
    events !== last.events ||
    (all !== last.all && Date.now() - (last.at ?? 0) >= REPORT_MINUTES * 60_000);
  if (!due) return { sent: false, why: 'Nothing new to report.' };
  const r = provider.report(snapshot);
  if (!r || r.ok === false)
    return { sent: false, why: r?.why ?? 'The provider refused the report.' };
  mkdirSync(join(mainCheckout(resolve('.')), '.claude/state'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ events, all, at: Date.now() })}\n`);
  return { sent: true };
}

/** HUBR-2, HUBR-4: `team report` sends what's new; `--dry-run` prints exactly what would be sent. */
function teamReport(team, provider) {
  const snapshot = snapshotNow(team);
  if (!snapshot)
    die(
      'A report needs docs.specs and docs.plan in the config. The spec-design skill writes both.',
    );
  if (flag('--dry-run')) return out(JSON.stringify(snapshot, null, 2));
  const r = sendSnapshot(team, provider, snapshot, { force: true });
  if (flag('--json')) return out(JSON.stringify(r, null, 2));
  out(
    r.sent
      ? `Reported this project's facts to ${team.provider.name ?? 'the team provider'}.`
      : r.why,
  );
}

/**
 * The mod's pulse (HUBR-3, HUBR-6), every 30 seconds while a session runs, only for a hosted provider:
 * stdin is `{ agents, usage }`, the session's agents by tool and branch and its token ledger (USE-1).
 * Keeps both for the provider's client and the report, and reports when something new happened.
 */
async function pulseCommand(raw, team, provider) {
  const hosted = providerAdapterOf(raw.team?.provider);
  if (!hosted || hosted.problem || !sessionId) return;
  let input = {};
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const root = resolve('.');
  const id = sessionId.replace(/[^\w-]/g, '');
  if (input.agents) hosted.adapter.presence(root, id, input.agents);
  if (input.usage && typeof input.usage === 'object') {
    const dir = join(mainCheckout(root), USAGE_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.json`),
      `${JSON.stringify({ at: Date.now(), entries: input.usage })}\n`,
    );
  }
  // STD-6: the organisation's standards, for the hooks and instructions, read every ten minutes.
  const inherited = readInherited(root);
  if (!inherited.at || Date.now() - Date.parse(inherited.at) >= REPORT_MINUTES * 60_000) {
    const r = provider.standards();
    if (r && r.ok !== false && Array.isArray(r.standards)) writeInherited(root, r);
  }
  // Building the snapshot reads git: at most once a minute.
  const built = join(mainCheckout(root), '.claude/state/report-built.json');
  let at = 0;
  try {
    at = JSON.parse(readFileSync(built, 'utf8')).at ?? 0;
  } catch {
    // never built
  }
  if (Date.now() - at < 60_000) return;
  writeFileSync(built, `${JSON.stringify({ at: Date.now() })}\n`);
  const snapshot = snapshotNow(team);
  if (snapshot) sendSnapshot(team, provider, snapshot);
}

/** HUBR-6: `team provider signin|signout|status|connect|drift-model …`, run by the provider's client. */
function providerCommand(raw) {
  const hosted = providerAdapterOf(raw.team?.provider);
  if (!hosted || hosted.problem)
    die(
      "This team's provider isn't a hosted one: claims and intents go through GitHub, and there's nothing to sign in to.",
    );
  process.exit(hosted.adapter.run(rest.slice(1), hosted.url));
}

/**
 * TEAM-13: `team init` sets the project up as a team's, or (`--off`) as one developer's again. Without
 * `--write` it shows the team section it would write; with it, it writes the config and says what the
 * team still needs on GitHub (gh signed in, origin reachable, the intents' discussion category).
 */
function teamInit(raw) {
  const usage =
    'code-kit team init --tech-lead <GitHub handle> [--owner <lane>=<handle>,<handle>]… [--stale-days <n>] [--intents <category>] [--write] [--json] | team init --off [--write]';
  const changed = structuredClone(raw);
  if (flag('--off')) {
    delete changed.team;
    for (const lane of Object.values(changed.lanes ?? {})) delete lane.owners;
  } else {
    const techLead = techLeadGiven ?? raw.team?.techLead;
    if (!techLead) die(usage);
    changed.team = { ...(raw.team ?? {}), techLead };
    if (staleDaysGiven !== undefined) changed.team.staleDays = Number(staleDaysGiven);
    if (intentsGiven !== undefined) changed.team.intents = intentsGiven;
    for (const given of ownersGiven) {
      const [lane, people = ''] = given.split('=');
      if (!changed.lanes?.[lane])
        die(
          `There's no lane "${lane}" in the config. The lanes are: ${Object.keys(changed.lanes ?? {}).join(', ') || 'none'}.`,
        );
      const handles = people
        .split(',')
        .map((h) => h.trim().replace(/^@/, ''))
        .filter(Boolean);
      if (handles.length) changed.lanes[lane].owners = handles;
      else delete changed.lanes[lane].owners;
    }
  }
  const problems = validate(changed);
  if (problems.length) die(`Nothing changed: ${problems.join('; ')}`);
  const team = teamOf(changed);
  const section = team
    ? {
        team: changed.team,
        owners: team.owners,
      }
    : null;
  if (!flag('--write')) {
    if (flag('--json')) return out(JSON.stringify({ written: false, ...section }, null, 2));
    if (!team)
      return out(
        'This would take the team out of the config: one developer, no claims or owners. Run again with --write to do it.',
      );
    out(JSON.stringify({ team: changed.team }, null, 2));
    for (const [lane, owners] of Object.entries(team.owners))
      out(`lanes.${lane}.owners: ${owners.join(', ')}`);
    return out('Nothing is written yet: run again with --write.');
  }
  writeFileSync(resolve(file), `${JSON.stringify(changed, null, 2)}\n`);
  if (!team)
    return out(
      `Took the team out of ${file}: claims, owners and intents no longer apply. Commit it on a branch.`,
    );
  // What GitHub says now: the provider's own look at the repository.
  const state = teamProvider(resolve('.'), team).state({ fresh: true });
  const setup = state.setup ?? [];
  if (flag('--json'))
    return out(JSON.stringify({ written: true, ...section, me: state.me ?? null, setup }, null, 2));
  out(
    `Wrote the team to ${file}: ${team.techLead} is the tech lead; a claim is stale after ${team.staleDays} working day${team.staleDays === 1 ? '' : 's'} without a push; ${team.intents ? `intents go in "${team.intents}"` : `${team.provider.name ?? 'the provider'} keeps intents`}.`,
  );
  for (const [lane, owners] of Object.entries(team.owners))
    out(`Lane ${lane}: ${owners.join(', ')}`);
  out(setup.length ? 'Still to set up:' : 'GitHub is ready for the team.');
  for (const s of setup) out(`  ${s}`);
  out(`Commit ${file} on a branch; each teammate then needs code-kit and gh signed in.`);
}

/**
 * TEAM-5: `intend "<what and why>" [--touches globs]` raises an intent before any code, so the team sees
 * a change of direction first; `intend agree|drop|duplicate <id> [--reason "…"]` is the tech lead's answer.
 */
function intendCommand() {
  const { raw } = load();
  const team = teamOf(raw);
  if (!team) die('This project has no "team" in its config, so intents have nowhere to go.');
  const provider = teamProvider(resolve('.'), team);
  const [first, id] = rest;
  // TEAM-10: an agreed intent, written where agents read it.
  if (first === 'record') {
    if (!/^\d+$/.test(id ?? '')) die('code-kit intend record <discussion number>');
    const d = provider.intent(Number(id));
    if (!d) die("GitHub can't be reached, so the intent can't be read.");
    if (d.missing) die(`There's no intent #${id} in ${team.intents}.`);
    if (!(d.closed && d.stateReason === 'RESOLVED'))
      die(`Intent #${id} isn't agreed yet: only an agreed intent becomes a decision record.`);
    const dir = raw.docs?.decisions ?? 'docs/decisions';
    mkdirSync(resolve(dir), { recursive: true });
    const existing = readdirSync(resolve(dir)).filter((f) => f.endsWith('.md'));
    const already = existing.find((f) => read(join(dir, f)).includes(`**Discussion:** ${d.url}`));
    if (already) return out(`Intent #${id} is already recorded: ${join(dir, already)}`);
    const last = Math.max(0, ...existing.map((f) => Number(f.match(/^(\d+)-/)?.[1] ?? 0)));
    const path = join(dir, `${String(last + 1).padStart(4, '0')}-${slugOf(d.title)}.md`);
    writeFileSync(resolve(path), decisionRecord(d, team.techLead));
    return out(
      `Wrote ${path}. Commit it on a branch (lead/decision-${id}), push it and open a pull request, so it's reviewed and merged like any change; once merged, every agent reads it.`,
    );
  }
  if (first === 'agree' || first === 'drop' || first === 'duplicate') {
    if (!/^\d+$/.test(id ?? '')) die(`code-kit intend ${first} <issue number> [--reason "…"]`);
    const outcome = { agree: 'agreed', drop: 'dropped', duplicate: 'duplicate' }[first];
    const r = provider.settle(Number(id), outcome, reason ?? '');
    if (!r.ok) die(r.why);
    return out(
      first === 'agree'
        ? `Agreed intent #${id}: it's how the team goes now. Record it so every agent builds on it: code-kit intend record ${id}`
        : first === 'drop'
          ? `Dropped intent #${id}.`
          : `Marked intent #${id} a duplicate.`,
    );
  }
  const about = rest.join(' ').trim();
  if (!about) die('code-kit intend "<what you\'ll change, and why>" [--touches "<glob>,<glob>"]');
  const touches = (touchesGiven ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const r = provider.intend(about, touches);
  if (!r.ok) die(r.why);
  out(
    `Raised intent #${r.intent.id}: ${about}${touches.length ? ` (touches ${touches.join(', ')})` : ''}. The team sees it now; the tech lead (${team.techLead}) agrees or drops it. ${r.intent.url}`,
  );
}

/**
 * ASK-1 to ASK-3: questions for the person. `ask "<question>"` records one (the lead's: the hooks refuse
 * it from lanes), waiting in the Decisions tab; `--blocks` holds its story until it's answered. `ask`
 * lists them; `ask answer` records the answer (the person's from the pane with --via pane, which the
 * hooks refuse from agents; otherwise the lead recording what the person said in chat); `ask withdraw`
 * takes one back once it no longer needs the person.
 */
const ASK_USAGE = `code-kit ask "<question>" [--story ST-n] [--blocks] [--why …] [--option "Label: what it does"]...
  asks the person what the lead can't settle; it waits in their Decisions tab
code-kit ask [list] [--json]          the questions waiting, and those answered lately
code-kit ask answer <id> "<answer>"
code-kit ask withdraw <id> --reason "…"`;

function askCommand() {
  const root = resolve('.');
  if (['--help', '-h', 'help'].includes(rest[0])) return out(ASK_USAGE);
  // `ask list` lists, as `ask` does.
  if (rest[0] === 'list' && rest.length === 1) rest.length = 0;
  const [sub, id, ...words] = rest;
  if (sub === 'answer') {
    const r = answerQuestion(root, id, {
      answer: words.join(' '),
      by: via === 'pane' ? 'person' : 'lead',
      via: via === 'pane' ? 'pane' : 'chat',
    });
    if (!r.ok) die(r.why);
    return out(
      `Recorded the answer to ${id}${via === 'pane' ? '' : ' (given in chat, recorded by the lead)'}: ${r.question.answer.text}${r.question.blocks ? ` ${r.question.story} no longer waits on the person.` : ''}`,
    );
  }
  if (sub === 'withdraw') {
    if (!reason?.trim()) die('Say why it no longer needs the person, with --reason "…".');
    const r = withdrawQuestion(root, id, reason);
    if (!r.ok) die(r.why);
    return out(`Withdrew ${id}: ${reason.trim()}`);
  }
  const all = readQuestions(root);
  if (!rest.length) {
    if (flag('--json')) return out(JSON.stringify(all, null, 2));
    const open = all.filter((q) => q.state === 'open');
    out(
      open.length
        ? `${open.length} question(s) wait for the person:`
        : 'No questions wait for the person.',
    );
    for (const q of open)
      out(
        `  ${q.id}${q.story ? ` (${q.story}${q.blocks ? ', which waits on it' : ''})` : ''}: ${q.question}${q.options.length ? `  [${q.options.map((o) => o.label).join(' / ')}]` : ''}`,
      );
    const answered = all.filter((q) => q.state === 'answered').slice(-10);
    if (answered.length) out('\nAnswered lately:');
    for (const q of answered) out(`  ${q.id}: ${q.question} → ${q.answer.text}`);
    return;
  }
  const question = rest.join(' ').trim();
  // A question reaches the person, so a flag or a stray word never becomes one.
  if (rest[0].startsWith('-'))
    die(`${rest[0]} isn't an option of ask; nothing was asked.\n${ASK_USAGE}`);
  if (!/\s/.test(question) && !question.endsWith('?'))
    die(
      `"${question}" isn't a question for the person; nothing was asked. Ask it as a sentence they can answer.\n${ASK_USAGE}`,
    );
  if (flag('--blocks') && !storyGiven) die('--blocks holds a story: name it with --story ST-n.');
  const r = askQuestion(root, {
    by: 'lead',
    session: callerSession,
    question,
    why: whyGiven ?? null,
    story: storyGiven ?? null,
    blocks: flag('--blocks'),
    options: optionsGiven,
  });
  out(
    r.existed
      ? `${r.question.id} is already open: ${r.question.question}`
      : `Asked ${r.question.id}. It waits in the person's Decisions tab${r.question.blocks ? `, and ${r.question.story} waits on it` : ''}; their answer is sent to you as a prompt. Carry on with other work meanwhile.`,
  );
}

/**
 * REPORT-1 to REPORT-3: bug reports for code-kit itself. An agent drafts one (with harness.report.on);
 * the person reads it and sends or discards it, from the pane or their terminal: the hooks refuse
 * `report send` and `report discard` from every agent.
 */
function reportCommand() {
  const root = resolve('.');
  const [sub, id] = rest;
  if (sub === 'send') {
    const r = sendReport(root, id);
    if (!r.ok) die(`${r.why}${r.link ? `\nOpen this to file it yourself: ${r.link}` : ''}`);
    return out(
      r.comment ? `Someone had filed it already; added it there: ${r.url}` : `Filed ${r.url}`,
    );
  }
  if (sub === 'discard') {
    const r = discardReport(root, id);
    if (!r.ok) die(r.why);
    return out(`Discarded ${id}.`);
  }
  if (!rest.length) {
    const all = readReports(root);
    if (flag('--json')) return out(JSON.stringify(all, null, 2));
    const drafts = all.filter((r) => r.state === 'draft');
    out(
      drafts.length
        ? `${drafts.length} report(s) wait for the person to send or discard:`
        : 'No reports waiting.',
    );
    for (const r of drafts) out(`  ${r.id}: ${r.title}`);
    return;
  }
  const { config } = load();
  if (!config.harness.report.on)
    die(
      "Reporting code-kit's bugs is off (harness.report.on). Tell the person what went wrong instead: what you ran, what code-kit said, and what you expected.",
    );
  const r = draftReport(root, {
    title: rest.join(' '),
    what: whatGiven,
    expected: expectedGiven,
    command: commandGiven,
    refusal: refusalGiven,
    rule: ruleGiven,
  });
  if (!r.ok) die(r.why);
  out(
    r.existed
      ? `${r.report.id} already reports this; it waits for the person.`
      : `Drafted ${r.report.id}. The person reads it in the Decisions tab and sends it to code-kit's GitHub, or discards it. Carry on: work around it if you can, and say so.`,
  );
}

/**
 * The lead loop's pause (LOOP-6): `loop` says whether the person paused it; `loop pause|resume`, the
 * person's act from the code-kit band, records it, so other tools' background work pauses with it.
 * LOOP-10: `loop lead` takes or renews the lease of the one session that runs the loop, and `loop
 * release` gives it up; the mod runs both, and the hooks refuse all four to agents.
 */
function loopCommand() {
  const root = resolve('.');
  const [sub] = rest;
  if (sub === 'pause' || sub === 'resume') {
    writeLoop(root, sub === 'pause');
    return out(sub === 'pause' ? 'The lead loop is paused.' : 'The lead loop is running.');
  }
  // LOOP-10: one session in the project runs the loop; the mod takes and renews the lease.
  if (sub === 'lead' || sub === 'release') {
    if (!sessionId) die(`code-kit loop ${sub} needs the session: --session <id>.`);
    if (sub === 'release')
      return out(
        releaseLead(root, sessionId)
          ? 'This session no longer runs the lead loop.'
          : "This session wasn't running the lead loop.",
      );
    const r = claimLead(root, sessionId, { take: flag('--take') });
    if (!r.ok)
      die(
        r.lead
          ? `Another session (${shortSession(r.lead.session)}, seen ${r.lead.at}) leads this project and runs its loop. Leave it there, or lead from here with --take.`
          : 'No session leads this project now, and this is a working session: the loop runs only in the lead session. Lead from here with --take.',
      );
    return out('This session runs the lead loop.');
  }
  if (sub !== undefined)
    die(
      'code-kit loop [--json] | loop pause | loop resume | loop lead --session <id> [--take] | loop release --session <id>',
    );
  const state = readLoop(root);
  // SESS-2: with --session, whether that session leads the project or works in it.
  const role = sessionId ? (readSession(root, sessionId)?.role ?? null) : null;
  out(
    flag('--json')
      ? JSON.stringify({ ...state, ...(sessionId ? { role } : {}) })
      : `${state.paused ? `The lead loop is paused (since ${state.at}).` : 'The lead loop is running.'}${state.lead ? ` Session ${state.lead.session} runs it.` : ''}`,
  );
}

/**
 * ONB-8: code-kit's own instructions (the lead's section of CLAUDE.md, each lane agent's "Always:" rules):
 * where each stands, `--write` to bring the marked ones up to date, `--show lead|lane` to print one.
 */
function instructionsCommand() {
  const { config } = load();
  const root = resolve('.');
  if (rest[0] === 'show') {
    if (!['lead', 'lane'].includes(rest[1])) die('code-kit instructions show lead|lane [<lane>]');
    if (rest[2] && !config.lanes[rest[2]])
      die(`No lane is called ${rest[2]}: ${Object.keys(config.lanes).join(', ') || 'none'}.`);
    // A named lane's rules carry the standards for its layers (spec 22, STD-3).
    return out(rest[1] === 'lead' ? leadSection(root, config) : agentRules(root, config, rest[2]));
  }
  const changed = flag('--write') ? writeInstructions(root, config) : [];
  const files = instructionsState(root, config);
  if (flag('--json'))
    return out(
      JSON.stringify(
        {
          version: INSTRUCTIONS_VERSION,
          files: files.map(({ file, kind, state, version }) => ({ file, kind, state, version })),
          written: changed,
        },
        null,
        2,
      ),
    );
  const said = {
    current: 'up to date',
    stale: 'from an older code-kit or config; --write brings it up to date',
    missing: 'none yet; --write adds it',
    legacy: 'written before code-kit marked its part; merge it once, by hand (below)',
  };
  if (changed.length) out(`Brought up to date: ${changed.join(', ')}.`);
  for (const f of files) out(`  ${f.file}: ${said[f.state]}`);
  if (files.some((f) => f.state === 'legacy'))
    out(
      '\nTo merge one: replace its old code-kit part (in CLAUDE.md from `## Enforced, not advised` to the line about changing the rules; in an agent file from `Always:` to the end of its list) with what `code-kit instructions show lead` or `show lane <lane>` prints. Keep every line the project wrote itself (its own rules, its layer order, its docs) outside the markers, under a heading of its own, so a later refresh never touches them.',
    );
}

/** LEAN-6: releases a worktree for a fresh agent: its report kept in the main checkout, its branch kept. */
function releaseWorktree(w) {
  if (!cleanOf(w))
    die(
      `${w.branch ?? w.path} has uncommitted changes; nothing was removed. Commit them on the branch, or have its agent do so, then release it.`,
    );
  const r = removeWorktree(resolve('.'), w);
  if (!r.ok) die(`git worktree remove failed: ${r.why}`);
  return `${w.branch ?? w.path}${w.report ? ` (its report kept at ${w.report})` : ''}`;
}

/**
 * LEAN-6, LEAN-8: `worktrees` lists the project's worktrees and why each one stays; `release <branch>`
 * frees one for a fresh agent on the same story; `prune` takes away every one that's done with;
 * `discard <branch>`, the person's act, takes away a merged one that still holds changes, keeping them
 * as a patch.
 */
function worktreesCommand() {
  const { config } = load();
  const root = resolve('.');
  const list = worktrees(root, config);
  if (rest[0] === 'release') {
    const w = list.find((x) => x.branch === rest[1] || x.path === rest[1]);
    if (!w) die(`No worktree has ${rest[1] ?? '<branch>'} checked out.`);
    if (agentBusy(root, w))
      die(
        `The ${w.branch.split('/')[0]} lane's agent is still at work on ${w.branch} (its last act was under ${BUSY_MS / 60_000} minutes ago, with no hand-back); nothing was removed. Wait for it to hand back, or stop it with TaskStop, then release it.`,
      );
    return out(`Released ${releaseWorktree(w)}. The branch and its commits stay.`);
  }
  if (rest[0] === 'discard') {
    if (!rest[1]) die('code-kit worktrees discard <branch>');
    const r = discardWorktree(root, config, rest[1]);
    if (!r.ok) die(`${r.why} Nothing was removed.`);
    return out(
      `Removed ${rest[1]}'s worktree.${r.patch ? ` What it held is kept in ${r.patch}: \`git apply ${r.patch}\` on the branch brings it back.` : ''}${r.report ? ` Its report is kept at ${r.report}.` : ''}`,
    );
  }
  if (rest[0] === 'prune') {
    const { removed, kept } = pruneWorktrees(root, config);
    if (flag('--quiet')) return;
    if (!removed.length) out('Nothing was done with; nothing was removed.');
    for (const r of removed) out(`Removed ${r}.`);
    const decide = kept.filter((k) => k.kind === 'agent' && /uncommitted/.test(k.why));
    if (decide.length)
      out(
        `\n${decide.length} merged worktree${decide.length === 1 ? ' still holds' : 's still hold'} uncommitted changes, so ${decide.length === 1 ? 'it stays' : 'they stay'} for the person to keep or discard: ${decide.map((k) => k.label).join(', ')}.`,
      );
    return;
  }
  if (flag('--json'))
    return out(
      JSON.stringify(
        list.map((w) => ({ ...w, kept: keptBecause(w) })),
        null,
        2,
      ),
    );
  if (!list.length) return out('No worktrees besides the main checkout.');
  for (const w of list) {
    const why = keptBecause(w);
    out(
      `  ${w.branch ?? '(detached)'}${w.story ? ` · ${w.story}` : ''}: ${why ? `stays, as ${why}` : 'done with'}  ${w.path}`,
    );
  }
  const done = list.filter((w) => !keptBecause(w)).length;
  if (done)
    out(
      `\n${done} done with: \`code-kit worktrees prune\` removes ${done === 1 ? 'it' : 'them'}, keeping their reports. It runs by itself after each merge and as a session starts.`,
    );
}

/**
 * Spec 22: `standards` lists the standards that apply (the project's file, merged with what an
 * organisation's team provider supplies) and what's wrong with them (STD-1, STD-6); `--for <path>...`
 * keeps the ones for those files' layers, as a review reads them (STD-4). Exits 1 on a problem.
 */
function standardsCommand() {
  const { raw, config } = load();
  const root = resolve('.');
  const team = teamOf(raw);
  let fetched = null;
  if (team && team.provider !== 'github') {
    const r = teamProvider(root, team).standards();
    if (r && r.ok !== false && Array.isArray(r.standards)) writeInherited(root, r);
    else fetched = r?.why ?? "The team provider didn't answer.";
  }
  const found = projectStandards(root, config);
  const { waivers } = readInherited(root);
  const files = flag('--for') ? rest : [];
  const layersOf = (f) =>
    config.layers.length ? [layerOf(f, config.layers)?.name].filter(Boolean) : null;
  const standards = files.length
    ? found.standards.filter((s) => files.some((f) => appliesTo(s, layersOf(f))))
    : found.standards;
  if (flag('--json')) {
    out(
      JSON.stringify(
        {
          file: found.file,
          exists: found.exists,
          version: found.version,
          ...(files.length ? { for: files } : {}),
          standards,
          waivers,
          problems: found.problems,
          ...(fetched ? { provider: fetched } : {}),
        },
        null,
        2,
      ),
    );
    if (found.problems.length) process.exit(1);
    return;
  }
  if (!found.exists && !found.standards.length)
    return out(
      `This project has no standards yet: ${found.file} doesn't exist. /code-kit:init suggests them from the specs or the code, and the person approves each.`,
    );
  if (fetched)
    out(`The organisation's standards weren't refreshed (${fetched}); using the last ones read.`);
  const inherited = found.standards.filter((s) => s.origin !== 'own').length;
  out(
    `${found.standards.length} standard${found.standards.length === 1 ? '' : 's'} apply${files.length ? `; ${standards.length} to ${files.join(', ')}` : ''}: ${found.standards.length - inherited} from ${found.file}${inherited ? `, ${inherited} from the organisation${found.version ? ` (version ${found.version})` : ''}` : ''}.`,
  );
  for (const s of standards) {
    const rule = s.applied === 'enforced' && s.enforcedBy ? ` · enforced by ${s.enforcedBy}` : '';
    const where = s.layers?.length ? ` · ${s.layers.join(', ')}` : '';
    const origin = s.origin === 'own' ? '' : ` · ${s.origin}`;
    out(`  ${standardLine({ ...s, origin: 'own', waiver: null })}${where}${rule}${origin}`);
    if (s.waiver)
      out(
        `    waived${s.waiver.paths?.length ? ` for ${s.waiver.paths.join(', ')}` : ''}${s.waiver.expires ? ` until ${s.waiver.expires}` : ''}${s.waiver.approvedBy ? `, approved by ${s.waiver.approvedBy}` : ''}${s.waiver.reason ? `: ${s.waiver.reason}` : ''}`,
      );
  }
  if (!found.problems.length) return;
  out(`\nProblems:`);
  for (const p of found.problems) out(`  ${p}`);
  process.exit(1);
}

const commands = {
  check,
  standards: standardsCommand,
  worktrees: worktreesCommand,
  instructions: instructionsCommand,
  loop: loopCommand,
  approve: () => (rest.length ? approve(rest) : usage()),
  merge: () => (rest.length === 1 ? merge(rest[0]) : usage()),
  publish: () => (rest.length === 0 ? publish() : usage()),
  requests,
  stops,
  settings,
  lanes: lanesCommand,
  sessions: sessionsCommand,
  decisions: decisionsCommand,
  task: taskCommand,
  hold: () => (rest.length === 1 ? hold(rest[0]) : usage()),
  queue,
  team: teamCommand,
  intend: intendCommand,
  ask: askCommand,
  report: reportCommand,
  story: () => (rest.length === 1 ? story(rest[0]) : usage()),
  map: () => (rest.length === 1 ? mapCommand(rest[0]) : usage()),
  trail: trailCommand,
  journal: journalCommand,
  timeline,
  'sent-back': () => (rest.length === 1 ? sentBackCommand(rest[0]) : usage()),
  ci: ciCommand,
  release: () => (rest.length === 1 ? releaseCommand(rest[0]) : usage()),
  replay: () => (rest.length === 1 ? replayCommand(rest[0]) : usage()),
  reconcile: () => (rest.length <= 1 ? reconcileCommand(rest[0]) : usage()),
  trace: () => (rest.length ? trace(rest) : usage()),
  adapters,
  next,
  verify,
  security,
  status,
  unowned,
  diff,
  baseline,
  graph,
  who: () => (rest.length ? who(rest) : whoAmI()),
};
function usage() {
  die(
    'Usage: code-kit check | who <path>... | unowned | diff | baseline [--write] | graph [--depth N]\n' +
      '              | verify [--base ref] [--branch name] [--no-checks] | status [--base ref] [--json]\n' +
      '              | security [--base ref] [--branch name] [--json]\n' +
      '              | next [--base ref] [--json] | adapters | trace <path>... [--json]\n' +
      '              | instructions [--write] [--json] | instructions show lead|lane [<lane>]\n' +
      '              | standards [--json] [--for <path>...]\n' +
      '              | worktrees [--json] | worktrees release|discard <branch> | worktrees prune [--quiet]\n' +
      '              | approve <name>... --reason "…" [--lane name]   [--config file]\n' +
      '              | merge <branch> --delegated|--person [--into branch] | publish --delegated|--person\n' +
      '              | replay <story> [--json|--brief] | reconcile [--json] | reconcile <story> --act <id> --found done|not-done --how "…"\n' +
      '              | requests [--json] | requests drop <n>|all\n' +
      '              | ask "<question>" [--story ST-n] [--blocks] [--why "…"] [--option "Label: effect"]... | ask [--json]\n' +
      '              | ask answer <id> "<answer>" | ask withdraw <id> --reason "…"\n' +
      '              | report "<title>" --what "…" [--expected …] [--command …] [--refusal …] [--rule …]\n' +
      '              | report [--json] | report send|discard <id>\n' +
      '              | stops [--session id] [--json] | sent-back <branch> [--reason "…"]\n' +
      '              | settings [--json] | settings set <key> <value> --reason "…" [--via pane]\n' +
      '              | lanes [--json] | lanes release <lane> | sessions [--json] | sessions lead\n' +
      '              | who | task "<what>" --touches globs | task done | task take <session>\n' +
      '              | decisions [--json] [--all]\n' +
      '              | ci check [--json] | ci usage [--days N] [--json] | release <version>\n' +
      '              | hold <id> [--minutes N] | hold <id> --answer approved|refused\n' +
      '              | queue [--json] | queue add|drop <branch> | queue rules | queue merge --delegated|--person\n' +
      '              | loop [--json] | loop pause|resume | loop lead|release --session id [--take]\n' +
      '              | map <story>|project [--json] | trail [--json] | journal [--json]\n' +
      '              | story <id> [--json] | timeline [--json]\n' +
      '              | team [--json] [--fresh] | team since [--json] [--peek]\n' +
      '              | team init --tech-lead <handle> [--owner <lane>=<handles>] [--write] | team init --off [--write]\n' +
      '              | team claim <story> [--lease globs] | team keep|release <story>\n' +
      '              | team reassign <story> <handle> | team codeowners [--write] | team board\n' +
      '              | intend "<what and why>" [--touches globs] | intend agree|drop|duplicate <id> [--reason "…"] | intend record <id>',
  );
}
await (commands[command] ?? usage)();
