// What to do next, from the project's state alone: no docs → spec-design; a spec still being shaped →
// spec-design; a ready spec or existing code without the kit → init; then, from the plan and git:
// review finished stories, dispatch ready ones, wait on running ones, or plan the next milestone.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { loadConfig, mergeDelegation } from './config.mjs';
import { buildStatus, readStories, DESIGN, LEAD } from './plan.mjs';
import { pendingSetup } from './adapters/index.mjs';
import { CONFIG_FILE, SETUP_VERSION } from './config.mjs';
import { readQueue, waiting } from './queue.mjs';
import { decidedBy, laneOf, openRequests } from './rules.mjs';
import { instructionsState } from './instructions.mjs';
import { SECURITY_AGENT_FILE } from './security.mjs';

export const DRAFT_FILE = '.claude/code-kit.draft.json';
export const BRIEF_STATES = ['framed', 'explored', 'scoped', 'specified', 'planned', 'ready'];

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The spec-design brief: { path, status, openQuestions: [question, ...], open: [{ question, owner,
 * blocks }] }, or null. `open` reads the table's Owner and Blocks columns where it has them.
 */
export function readBrief(root, config) {
  const specs = config?.docs?.specs;
  const candidates = [specs && `${posix.dirname(specs)}/brief.md`, 'docs/brief.md'].filter(Boolean);
  const path = candidates.find((p) => existsSync(join(root, p)));
  if (!path) return null;
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  const status = lines
    .map((l) => l.match(/^\*\*Status:\*\*\s*([a-z ]+?)\s*$/i)?.[1]?.toLowerCase())
    .find((s) => BRIEF_STATES.includes(s));
  const start = lines.findIndex((l) => /^##\s+Open questions/i.test(l));
  const section = start < 0 ? [] : lines.slice(start + 1);
  const end = section.findIndex((l) => /^##\s/.test(l));
  const rows = section.slice(0, end < 0 ? undefined : end).filter((l) => /^\|/.test(l));
  const cells = (l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  const header = rows.find((l) => /^\|\s*Question\s*\|/i.test(l));
  const columns = header ? cells(header).map((c) => c.toLowerCase()) : ['question'];
  const at = (name) => columns.findIndex((c) => c.startsWith(name));
  const open = rows
    .filter((l) => l !== header && !/^\|\s*-/.test(l))
    .map((l) => {
      const c = cells(l);
      return {
        question: c[0] ?? '',
        owner: at('owner') > 0 ? c[at('owner')] || null : null,
        blocks: at('block') > 0 ? c[at('block')] || null : null,
      };
    })
    .filter((q) => q.question && !q.question.startsWith('{{'));
  return { path, status: status ?? null, openQuestions: open.map((q) => q.question), open };
}

const hasMarkdown = (dir) => {
  try {
    return readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith('.md'));
  } catch {
    return false;
  }
};

/**
 * { step, why, args, then, attention, brief }. `brief`: the brief's open questions (ASK-4). `step` is a skill (spec-design, init, check, dispatch,
 * review), `merge` (the head of the merge queue, where the lead merges), `wait` (lanes are
 * building) or `done`. `base(config)` resolves the branch lanes merge into.
 */
export function nextStep(root, base) {
  const attention = [];
  // ASK-4: the brief's open questions, for the person's Decisions tab.
  let briefQuestions = [];
  const result = (step, why, extra = {}) => ({
    step,
    why,
    args: '',
    then: [],
    attention,
    brief: briefQuestions,
    ...extra,
  });
  const isRepo = git(root, 'rev-parse', '--is-inside-work-tree') === 'true';
  if (!isRepo)
    attention.push('This folder is not a git repository yet; run `git init` before init.');
  const files = isRepo ? (git(root, 'ls-files') ?? '').split('\n').filter(Boolean) : [];

  const { config, error } = loadConfig(root);
  if (error)
    return result(
      'check',
      `The config is invalid, so nothing but the config can be written: ${error.split('\n')[0]}`,
    );
  const brief = readBrief(root, config);
  if (brief?.openQuestions.length) {
    attention.push(`${brief.openQuestions.length} open question(s) in ${brief.path}.`);
    // A question the brief gives to the lead alone (Owner: Lead) is the lead's to settle, not the person's.
    briefQuestions = brief.open
      .filter(
        (q) =>
          !q.owner ||
          !/\blead\b/i.test(q.owner) ||
          /owner|person|you|product|client/i.test(q.owner),
      )
      .map((q) => ({ ...q, path: brief.path }));
  }

  if (!config) {
    if (existsSync(join(root, DRAFT_FILE)))
      return result(
        'init',
        'A draft config is waiting for your approval; nothing is enforced until you approve it.',
      );
    if (brief && brief.status !== 'ready')
      return result(
        'spec-design',
        `The spec is ${brief.status ? `at "${brief.status}"` : 'started'}; spec-design picks up from there.`,
      );
    if (brief)
      return result('init', 'The spec is ready; init turns it into enforced lanes and layers.', {
        args: posix.dirname(brief.path),
      });
    const code = files.filter(
      (f) =>
        !f.startsWith('docs/') &&
        !f.endsWith('.md') &&
        !f.split('/').some((p) => p.startsWith('.')),
    );
    if (code.length)
      return result(
        'init',
        `This is existing code (${code.length} tracked files) without code-kit; init works the rules out from the code.`,
      );
    if (hasMarkdown(join(root, 'docs')))
      return result(
        'init',
        'There are docs but no code-kit yet; init drafts the rules from them.',
        {
          args: 'docs/',
        },
      );
    return result(
      'spec-design',
      'Nothing here yet; spec-design turns your idea into a specification.',
    );
  }

  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan)
    return result(
      'spec-design',
      'code-kit is on, but there are no specs and plan to build from; spec-design writes them.',
    );
  if (brief?.status && !['planned', 'ready'].includes(brief.status))
    return result(
      'spec-design',
      `The spec is at "${brief.status}"; spec-design picks up from there.`,
    );
  if (!readStories(root, plan).length)
    return result(
      'spec-design',
      `${plan} has no stories in the \`### ST-n\` form yet; spec-design writes the plan.`,
    );

  // ONB-3: a companion the config wants is set up before any coding starts.
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
  } catch {
    // read and validated above; nothing to add
  }
  const [setup] = pendingSetup(raw, root);
  if (setup) return result('setup', setup.why, { args: setup.skill });
  // ONB-5: a project set up before setup did all of this is told what re-running init adds; when
  // ONB-6 finds what it's missing, no new story starts until init has added it.
  const older = (raw?.setup ?? 1) < SETUP_VERSION;
  const gaps = older ? setupGaps(config, readStories(root, plan), files) : [];
  if (older && !gaps.length)
    attention.push(
      "This project's code-kit setup predates what init now sets up: project skills with each lane agent, designs approved before screens are built, a QA lane for end-to-end tests, a security reviewer that checks each sensitive change as an attacker would, and companion tools set up before coding. Re-run /code-kit:init to add what's missing; it keeps everything that's still right and shows you the difference first.",
    );
  const missingWords = gaps.length
    ? `This project's setup is missing what init now sets up: ${gaps.join('; ')}.`
    : '';
  // ONB-1: a lane agent naming a skill that doesn't exist works without the recipe it was given.
  for (const missing of missingSkills(root)) attention.push(missing);

  const from = base(config);
  if (!from)
    attention.push('The base branch has no commits yet, so story branches are read against HEAD.');
  const status = buildStatus(root, config, from ?? 'HEAD', files);
  if (status.problems.length)
    attention.push(
      `${status.problems.length} gap(s) between the specs and the plan (see \`code-kit status\`).`,
    );
  if (status.drift.length)
    attention.push(
      `The plan's status lines are out of date for ${status.drift.map((d) => d.story).join(', ')}.`,
    );

  // A branch already in the merge queue has passed its review: it isn't reviewed again.
  const queued = waiting(readQueue(root)).map((e) => e.branch);
  const ids = (state) =>
    status.stories
      .filter((s) => s.state === state && !(state === 'review' && queued.includes(s.branch)))
      .map((s) => s.id);
  const [review, building, blocked, fixes] = ['review', 'in progress', 'blocked', 'sent back'].map(
    ids,
  );
  // ASK-3: a story whose question is open waits on the person; nothing dispatches or reviews it.
  const waitingOnPerson = status.stories.filter((s) => s.state === 'waiting on you');
  for (const s of waitingOnPerson)
    attention.push(
      `${s.id} waits on the person: ${s.waitingFor.question} (${s.waitingFor.id}, in their Decisions tab).`,
    );
  // A ready story with a gap (unknown lane, a requirement no spec defines) waits for the plan's fix.
  const defined = new Set(status.requirements.map((r) => r.id));
  const buildable = (s) =>
    (Boolean(config.lanes[s.lane]) || s.lane === LEAD || s.lane === DESIGN) &&
    (s.requirements.length > 0 || s.noRequirements) &&
    s.requirements.every((r) => defined.has(r));
  const readyStories = status.stories.filter((s) => s.state === 'ready');
  // The lead's own stories are built by the lead, not dispatched to a lane agent.
  const forLead = readyStories.filter((s) => buildable(s) && s.lane === LEAD).map((s) => s.id);
  const ready = readyStories
    .filter((s) => buildable(s) && s.lane !== LEAD && s.lane !== DESIGN)
    .map((s) => s.id);
  // ONB-2: design stories, designed with the person before any screen that depends on them is built.
  const forDesign = readyStories.filter((s) => buildable(s) && s.lane === DESIGN).map((s) => s.id);
  const unbuildable = readyStories.filter((s) => !buildable(s)).map((s) => s.id);
  // ONB-6: work already started finishes; nothing new starts until init has filled the gaps.
  const held = gaps.length
    ? [...ready, ...forDesign, ...forLead].sort((a, b) => a.slice(3) - b.slice(3))
    : [];
  if (held.length) {
    ready.length = forDesign.length = forLead.length = 0;
    attention.push(
      `${missingWords} ${held.join(', ')} ${held.length === 1 ? 'waits' : 'wait'} until /code-kit:init has added it.`,
    );
  }
  if (unbuildable.length)
    attention.push(
      `${unbuildable.join(', ')} can't be dispatched until the plan's gaps are fixed.`,
    );
  // LEAN-6: worktrees whose story is merged and which hold nothing uncommitted are only disk space.
  const leftovers = mergedWorktrees(root, config);
  if (leftovers)
    attention.push(
      `${leftovers} worktree${leftovers === 1 ? ' is' : 's are'} merged and clean; \`code-kit worktrees prune\` removes them, keeping their reports.`,
    );
  // ONB-8: code-kit's own instructions to the lead and the lanes, brought up to date before the next step:
  // a newer code-kit's rules reach the agents only through them.
  const instructions = instructionsState(root, config);
  const behind = instructions.filter((f) => ['stale', 'legacy'].includes(f.state));
  // A file with no code-kit part may be one the project keeps without it: said, not insisted on.
  const none = instructions.filter((f) => f.state === 'missing');
  if (none.length)
    attention.push(
      `${none.map((f) => f.file).join(', ')} ${none.length === 1 ? 'has' : 'have'} none of code-kit's instructions; \`code-kit instructions --write\` adds them.`,
    );
  if (behind.length) {
    const legacy = behind.filter((f) => f.state === 'legacy');
    return result(
      'instructions',
      `code-kit's instructions in ${behind.map((f) => f.file).join(', ')} are behind this code-kit${legacy.length ? `; ${legacy.length === behind.length ? 'they were' : `${legacy.map((f) => f.file).join(', ')} were`} written before code-kit marked its part, so merge ${legacy.length === 1 ? 'it' : 'them'} once by hand, keeping the project's own lines` : ''}.`,
      { args: legacy.length ? 'merge' : 'write' },
    );
  }
  // HELM-4: a lane waiting on something the lead decides goes first: the lane can't go on without it.
  const forLeadToDecide = openRequests(root).flatMap((r, i) =>
    r.lane && decidedBy(r.names, config) === 'lead' ? [{ ...r, n: i + 1 }] : [],
  );
  if (forLeadToDecide.length)
    return result(
      'decide',
      `${forLeadToDecide.map((r, i) => `${i ? 'the' : 'The'} ${r.lane} lane asks for ${r.names.map((n) => n.replace(/^dep-/, '').replaceAll('+', '/')).join(', ')}`).join('; ')}: yours to decide, against the story's requirements, the spec and the principles.`,
      { args: forLeadToDecide.map((r) => r.n).join(' ') },
    );
  // The merge queue (spec 09): branches the lead's review passed. Under autonomy, where the base's
  // committed rules delegate merges, the lead merges the head first, so dependents see it; otherwise
  // the person does, and always the first merge, which brings code-kit's rules onto the base.
  const delegation = queued.length ? mergeDelegation(root, config) : { delegated: false };
  const leadMerges = delegation.delegated && config.harness.autonomy === 'autonomous';
  // SETUP-2: a base with no rules committed (a project set up before setup committed them there): the
  // lead puts the approved rules onto it, and the queue merges under them from then on.
  if (queued.length && delegation.first)
    return result(
      'rules',
      `${queued[0]} passed review and is next to merge, but ${delegation.into} has no code-kit rules committed yet. Put the rules the person approved onto it (code-kit queue rules); then the queue merges under them.`,
      { args: delegation.into },
    );
  if (queued.length && !leadMerges)
    attention.push(
      `${queued.join(', ')} passed review and ${queued.length === 1 ? 'waits' : 'wait'} for the person to merge (code-kit queue merge --person, or Merge in the code-kit band).`,
    );
  if (queued.length && leadMerges)
    return result(
      'merge',
      `${queued[0]} passed review and is next in the merge queue${queued.length > 1 ? ` (then ${queued.slice(1).join(', ')})` : ''}.`,
      { args: queued[0] },
    );
  const then = [];
  // A sent-back story goes back to its lane with the review's findings, before new work starts.
  const toDispatch = [...fixes, ...ready];
  if (review.length && forDesign.length) then.push({ step: 'design', args: forDesign.join(' ') });
  if (review.length && toDispatch.length)
    then.push({ step: 'dispatch', args: toDispatch.join(' ') });
  if (forLead.length) then.push({ step: 'lead', args: forLead.join(' ') });
  if (review.length)
    return result('review', `${review.join(', ')} finished and wait for review.`, {
      args: review.join(' '),
      then,
    });
  if (forDesign.length)
    return result(
      'design',
      `${forDesign.join(', ')} ${forDesign.length === 1 ? 'designs' : 'design'} the screens before any code is written for them; the person approves each design.`,
      {
        args: forDesign.join(' '),
        then: [
          ...(toDispatch.length ? [{ step: 'dispatch', args: toDispatch.join(' ') }] : []),
          ...(forLead.length ? [{ step: 'lead', args: forLead.join(' ') }] : []),
        ],
      },
    );
  if (fixes.length)
    return result(
      'dispatch',
      `${fixes.join(', ')} ${fixes.length === 1 ? 'was' : 'were'} sent back and ${fixes.length === 1 ? 'waits' : 'wait'} for the lane's fix: dispatch ${fixes.length === 1 ? 'it' : 'each'} again with the review's findings${ready.length ? `, then ${ready.join(', ')}` : ''}.`,
      { args: toDispatch.join(' '), then },
    );
  if (ready.length)
    return result('dispatch', `${ready.join(', ')} can start: their dependencies are done.`, {
      args: ready.join(' '),
      then,
    });
  if (forLead.length)
    return result(
      'lead',
      `${forLead.join(', ')} ${forLead.length === 1 ? 'is' : 'are'} the lead's own: build ${forLead.length === 1 ? 'it' : 'them'} on ${forLead.map((id) => `lead/${id.toLowerCase()}`).join(', ')}, then review like any branch.`,
      { args: forLead.join(' ') },
    );
  // ONB-6: with nothing in flight, the setup is brought up to date before the next story.
  if (gaps.length && !building.length && !queued.length)
    return result(
      'update',
      `${missingWords} Re-run /code-kit:init before the next story: it shows the person the difference before anything changes.`,
    );
  if (building.length)
    return result(
      'wait',
      `${building.join(', ')} ${building.length === 1 ? 'is' : 'are'} being built; nothing else can start until one finishes. A lane that stopped without finishing is dispatched again.`,
    );
  // Stories waiting on branches in the merge queue wait for the merge, not on a broken plan.
  if (queued.length)
    return result(
      'wait',
      `${queued.join(', ')} passed review and ${queued.length === 1 ? 'waits' : 'wait'} to be merged; the stories that depend on ${queued.length === 1 ? 'it' : 'them'} start after.`,
    );
  if (unbuildable.length)
    return result(
      'spec-design',
      `${unbuildable.join(', ')} ${unbuildable.length === 1 ? 'is' : 'are'} next, but the plan has gaps to fix first.`,
    );
  // ASK-3: what's left waits on the person's answers, directly or through a dependency.
  if (waitingOnPerson.length)
    return result(
      'wait',
      `${waitingOnPerson.map((s) => `${s.id} waits on the person (${s.waitingFor.id})`).join('; ')}${blocked.length ? `; ${blocked.join(', ')} ${blocked.length === 1 ? 'waits' : 'wait'} on ${waitingOnPerson.length === 1 ? 'it' : 'them'}` : ''}. Carry on with anything else; their answer is sent to you.`,
    );
  if (blocked.length)
    return result(
      'spec-design',
      `${blocked.join(', ')} wait on stories that can't finish: the plan has a dependency cycle or a missing story.`,
    );
  if (queued.length)
    return result(
      'wait',
      `${queued.join(', ')} ${queued.length === 1 ? 'waits' : 'wait'} to be merged.`,
    );
  return result(
    'done',
    `All ${status.stories.length} stories are done; spec-design plans the next milestone or feature.`,
  );
}

const SCREEN_LANE = /(^|-)(web|mobile|frontend|front-end|ui|desktop|ios|android|admin|portal)(-|$)/;
const SCREEN_FILE = /\.(tsx|jsx|vue|svelte|swift|dart)$/;
const TEST_FILE = /(^|\/)(__tests__|e2e|tests?)\/|\.(test|spec|stories)\.\w+$/;
const QA_LANE = /(^|-)(qa|e2e|tests?)(-|$)/;

/**
 * ONB-6: what a setup older than init's is missing, in words, from the config, the plan and the code.
 * A lane owns screens when its name or agent says so (web, mobile, desktop…) or it holds screen
 * files. It's missing the design gate, design stories before the screen stories not yet started, and a
 * QA lane for the end-to-end suites; and, with or without screens, the security reviewer (ONB-7), when
 * its agent file isn't among the tracked files.
 */
export function setupGaps(config, stories, files = []) {
  const gaps = screenGaps(config, stories, files);
  if (!files.includes(SECURITY_AGENT_FILE))
    gaps.push(
      `a security reviewer (${SECURITY_AGENT_FILE}) that checks each change touching sign-in, permissions, personal data, payments, secrets or dependencies as an attacker would`,
    );
  return gaps;
}

/** ONB-6: the gaps of a setup whose lanes own screens: the design gate, design stories, a QA lane. */
function screenGaps(config, stories, files) {
  const lanes = Object.entries(config.lanes);
  const holdsScreens = new Set(
    files.filter((f) => SCREEN_FILE.test(f) && !TEST_FILE.test(f)).map((f) => laneOf(f, config)),
  );
  const screens = lanes
    .filter(
      ([name, l]) => SCREEN_LANE.test(name) || SCREEN_LANE.test(l.agent) || holdsScreens.has(name),
    )
    .map(([name]) => name);
  if (!screens.length) return [];
  const gaps = [];
  const list = (names) => names.join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (!config.designGate)
    gaps.push(
      `a design gate for ${list(screens)}, so screens are built only from approved designs`,
    );
  // A screen story not yet started, with no design story among everything it depends on.
  const byId = new Map(stories.map((s) => [s.id, s]));
  const designed = (s, seen = new Set()) =>
    s.dependsOn.some((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      const dep = byId.get(d);
      return dep && (dep.lane === DESIGN || designed(dep, seen));
    });
  const undesigned = stories
    .filter((s) => screens.includes(s.lane) && ['todo', 'ready'].includes(s.status) && !designed(s))
    .map((s) => s.id);
  if (undesigned.length)
    gaps.push(
      `design stories before the screens: ${list(undesigned)} ${undesigned.length === 1 ? 'is' : 'are'} planned with no design to build from`,
    );
  if (!lanes.some(([name, l]) => QA_LANE.test(name) || QA_LANE.test(l.agent)))
    gaps.push('a QA lane with a test-engineer for the end-to-end tests of the journeys');
  return gaps;
}

/** The code-kit skills every agent may name without a project copy. */
const KIT_SKILLS = (() => {
  try {
    return new Set(readdirSync(new URL('../../skills/', import.meta.url)));
  } catch {
    return new Set();
  }
})();

/**
 * ONB-1: lane agents naming skills under **Skills to use** that don't exist, in words: ["web-engineer
 * names a skill that doesn't exist: new-screen"]. Plugin skills (`plugin:skill`) and code-kit's own are
 * left alone.
 */
export function missingSkills(root) {
  const dir = join(root, '.claude/agents');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const line = readFileSync(join(dir, file), 'utf8').match(/^\*\*Skills to use:\*\*(.*)$/m)?.[1];
    if (!line) continue;
    const missing = line
      .split(',')
      .map((n) => n.replace(/[`*]/g, '').trim())
      .filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n))
      .filter(
        (n) => !KIT_SKILLS.has(n) && !existsSync(join(root, '.claude/skills', n, 'SKILL.md')),
      );
    if (missing.length)
      out.push(
        `${file.replace(/\.md$/, '')} names ${missing.length === 1 ? "a skill that doesn't" : "skills that don't"} exist: ${missing.join(', ')}. Write ${missing.length === 1 ? 'it' : 'them'} from the architecture's recipes (re-run init), or take ${missing.length === 1 ? 'it' : 'them'} off the agent.`,
      );
  }
  return out;
}

/** LEAN-6: how many of the project's worktrees have a merged branch and nothing uncommitted. */
function mergedWorktrees(root, config) {
  const list = git(root, 'worktree', 'list', '--porcelain');
  if (!list) return 0;
  const from = config.branches?.protected?.[0];
  if (!from || !git(root, 'rev-parse', '--verify', '-q', from)) return 0;
  let n = 0;
  for (const block of list.split('\n\n').slice(1)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (!path || !branch) continue;
    const merged =
      spawnSync('git', ['merge-base', '--is-ancestor', branch, from], { cwd: root }).status === 0;
    if (!merged) continue;
    const status = spawnSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' });
    if (status.status === 0 && !status.stdout.trim()) n++;
  }
  return n;
}
