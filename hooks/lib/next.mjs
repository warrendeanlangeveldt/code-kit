// What to do next, from the project's state alone: no docs → spec-design; a spec still being shaped →
// spec-design; a ready spec or existing code without the kit → init; then, from the plan and git:
// review finished stories, dispatch ready ones, wait on running ones, or plan the next milestone.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { loadConfig } from './config.mjs';
import { buildStatus, readStories } from './plan.mjs';

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

/** The spec-design brief: { path, status, openQuestions: [question, ...] }, or null. */
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
  const openQuestions = section
    .slice(0, end < 0 ? undefined : end)
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*Question\s*\|/i.test(l))
    .map((l) => l.split('|')[1].trim())
    .filter((q) => q && !q.startsWith('{{'));
  return { path, status: status ?? null, openQuestions };
}

const hasMarkdown = (dir) => {
  try {
    return readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith('.md'));
  } catch {
    return false;
  }
};

/**
 * { step, why, args, then, attention }. `step` is a skill (spec-design, init, check, dispatch,
 * review), `wait` (lanes are building) or `done`. `base(config)` resolves the branch lanes merge into.
 */
export function nextStep(root, base) {
  const attention = [];
  const result = (step, why, extra = {}) => ({
    step,
    why,
    args: '',
    then: [],
    attention,
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
  if (brief?.openQuestions.length)
    attention.push(`${brief.openQuestions.length} open question(s) in ${brief.path}.`);

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

  const ids = (state) => status.stories.filter((s) => s.state === state).map((s) => s.id);
  const [review, building, blocked] = ['review', 'in progress', 'blocked'].map(ids);
  // A ready story with a gap (unknown lane, a requirement no spec defines) waits for the plan's fix.
  const defined = new Set(status.requirements.map((r) => r.id));
  const buildable = (s) =>
    Boolean(config.lanes[s.lane]) &&
    s.requirements.length > 0 &&
    s.requirements.every((r) => defined.has(r));
  const readyStories = status.stories.filter((s) => s.state === 'ready');
  const ready = readyStories.filter(buildable).map((s) => s.id);
  const unbuildable = readyStories.filter((s) => !buildable(s)).map((s) => s.id);
  if (unbuildable.length)
    attention.push(
      `${unbuildable.join(', ')} can't be dispatched until the plan's gaps are fixed.`,
    );
  const then = [];
  if (review.length && ready.length) then.push({ step: 'dispatch', args: ready.join(' ') });
  if (review.length)
    return result('review', `${review.join(', ')} finished and wait for review.`, {
      args: review.join(' '),
      then,
    });
  if (ready.length)
    return result('dispatch', `${ready.join(', ')} can start: their dependencies are done.`, {
      args: ready.join(' '),
    });
  if (building.length)
    return result(
      'wait',
      `${building.join(', ')} ${building.length === 1 ? 'is' : 'are'} being built; nothing else can start until one finishes. A lane that stopped without finishing is dispatched again.`,
    );
  if (unbuildable.length)
    return result(
      'spec-design',
      `${unbuildable.join(', ')} ${unbuildable.length === 1 ? 'is' : 'are'} next, but the plan has gaps to fix first.`,
    );
  if (blocked.length)
    return result(
      'spec-design',
      `${blocked.join(', ')} wait on stories that can't finish: the plan has a dependency cycle or a missing story.`,
    );
  return result(
    'done',
    `All ${status.stories.length} stories are done; spec-design plans the next milestone or feature.`,
  );
}
