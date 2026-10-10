// Requirements and stories, read from the project's docs. Specs (docs.specs) hold requirements as
// headings `### BOOK-4 Short name` (`(removed)` at the end drops one); the plan (docs.plan) holds
// stories as `### ST-12 Title` followed by `**Lane:**`, `**Requirements:**`, `**Depends on:**` and
// `**Status:**` lines. A lane builds a story on the branch `<lane>/st-12`. The lane `lead` marks the
// lead's own stories (contracts, foundations, spikes), which the lead builds rather than dispatches;
// `**Requirements:** none` marks a story that delivers no requirement, such as a spike.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sentBack } from './reviews.mjs';

export const REQUIREMENT = /\b(?!ST-)([A-Z][A-Z0-9]*-\d+)\b/g;
const STORY_HEADING = /^###\s+(ST-\d+)\b\s*(.*)$/;
const REQUIREMENT_HEADING = /^###\s+((?!ST-)[A-Z][A-Z0-9]*-\d+)\b\s*(.*)$/;
export const STATES = ['todo', 'in progress', 'review', 'done'];
export const LEAD = 'lead';
// Test files, by the usual conventions. Tests name the requirement IDs they prove.
const TEST =
  /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;

const markdownFiles = (root, path) => {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return path.endsWith('.md') ? [path] : [];
  return readdirSync(full, { recursive: true })
    .map((f) => join(path, String(f)).split('\\').join('/'))
    .filter((f) => f.endsWith('.md') && statSync(join(root, f)).isFile())
    .sort();
};

/** Every requirement in the specs: [{ id, title, file, removed }]. */
export function readRequirements(root, specsPath) {
  const found = [];
  for (const file of markdownFiles(root, specsPath)) {
    for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
      const m = line.match(REQUIREMENT_HEADING);
      if (m)
        found.push({ id: m[1], title: m[2].trim(), file, removed: /\(removed\)\s*$/i.test(m[2]) });
    }
  }
  return found;
}

const field = (lines, name) =>
  lines
    .map((l) => l.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*)$`, 'i')))
    .find(Boolean)?.[1]
    .trim() ?? '';

/** Every story in the plan: [{ id, title, lane, requirements, dependsOn, status }]. */
export function readStories(root, planPath) {
  const stories = [];
  for (const file of markdownFiles(root, planPath)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(STORY_HEADING);
      if (!m) return;
      const end = lines.findIndex((l, j) => j > i && /^#{1,3}\s/.test(l));
      const body = lines.slice(i + 1, end < 0 ? undefined : end);
      const status = field(body, 'Status').toLowerCase();
      stories.push({
        id: m[1],
        title: m[2].trim(),
        file,
        lane: field(body, 'Lane'),
        requirements: [...field(body, 'Requirements').matchAll(REQUIREMENT)].map((r) => r[1]),
        noRequirements: /^none\b/i.test(field(body, 'Requirements')),
        dependsOn: [...field(body, 'Depends on').matchAll(/\bST-\d+\b/g)].map((r) => r[0]),
        status: STATES.includes(status) ? status : 'todo',
      });
    });
  }
  return stories;
}

export const storyBranch = (story) => `${story.lane}/${story.id.toLowerCase()}`;

/** Requirement IDs each tracked test file names: { id: [file, ...] }. */
export function testedRequirements(root, files, specsPath) {
  const tested = {};
  for (const file of files) {
    if (!TEST.test(file) || file.endsWith('.md') || file.startsWith(`${specsPath}/`)) continue;
    let body;
    try {
      body = readFileSync(join(root, file), 'utf8');
    } catch {
      continue; // deleted in the working tree, or not a text file
    }
    for (const [, id] of body.matchAll(REQUIREMENT)) (tested[id] ??= new Set()).add(file);
  }
  return Object.fromEntries(Object.entries(tested).map(([id, s]) => [id, [...s]]));
}

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

/** The ref of a branch, local first, then on origin; null when neither exists. */
function branchRef(root, branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`])
    if (git(root, 'rev-parse', '--verify', '--quiet', ref) !== null) return ref;
  return null;
}

/** Worktree path of each checked-out branch: { branch: path }. */
function worktrees(root) {
  const out = git(root, 'worktree', 'list', '--porcelain') ?? '';
  const found = {};
  let path;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    if (line.startsWith('branch refs/heads/'))
      found[line.slice('branch refs/heads/'.length)] = path;
  }
  return found;
}

/**
 * Where each story is. The plan's `done` stands (the lead marks it after merging, and merged
 * branches are often deleted or squashed). Otherwise git decides: a branch with commits not in
 * `base` is in review; one level with it is in progress, or done once the plan had it in review.
 * A branch still at the commit a review sent back is `sent back`, waiting for its lane's fix.
 * Without a branch, the plan's status stands. A story is `blocked` while a story it depends on
 * isn't done, whatever its branch holds; a todo story whose dependencies are done is `ready`.
 */
export function storyStates(root, stories, base) {
  const trees = worktrees(root);
  const backs = sentBack(root);
  const states = stories.map((story) => {
    const branch = storyBranch(story);
    const ref = story.lane ? branchRef(root, branch) : null;
    const ahead = ref ? Number(git(root, 'rev-list', '--count', `${base}..${ref}`) ?? 0) : 0;
    let state = story.status;
    if (ref && story.status !== 'done') {
      const head = backs[branch] ? git(root, 'rev-parse', ref) : null;
      if (head && head === backs[branch].sha) state = 'sent back';
      else if (ahead > 0) state = 'review';
      else state = story.status === 'review' ? 'done' : 'in progress';
    }
    return {
      ...story,
      branch,
      branchExists: Boolean(ref),
      ahead,
      worktree: trees[branch] ?? null,
      state,
      waitingOn: [],
    };
  });
  const done = new Set(states.filter((s) => s.state === 'done').map((s) => s.id));
  for (const s of states) {
    if (s.state === 'done') continue;
    s.waitingOn = s.dependsOn.filter((d) => !done.has(d));
    if (s.waitingOn.length) s.state = 'blocked';
    else if (s.state === 'todo') s.state = 'ready';
  }
  return states;
}

/** Gaps between specs, plan and tests, as sentences. */
export function traceProblems(requirements, stories, lanes) {
  const problems = [];
  const ids = new Set(requirements.map((r) => r.id));
  const seen = new Set();
  for (const r of requirements) {
    if (seen.has(r.id)) problems.push(`${r.id} is defined more than once (${r.file})`);
    seen.add(r.id);
  }
  const storyIds = new Set();
  for (const s of stories) {
    if (storyIds.has(s.id)) problems.push(`${s.id} is in the plan more than once`);
    storyIds.add(s.id);
    if (!s.lane) problems.push(`${s.id} has no **Lane:**`);
    else if (s.lane !== LEAD && !lanes.includes(s.lane))
      problems.push(`${s.id} names an unknown lane "${s.lane}"`);
    if (!s.requirements.length && !s.noRequirements)
      problems.push(`${s.id} cites no requirements (write "none" if it delivers none)`);
    for (const r of s.requirements)
      if (!ids.has(r)) problems.push(`${s.id} cites ${r}, which no spec defines`);
    for (const d of s.dependsOn)
      if (!stories.some((o) => o.id === d))
        problems.push(`${s.id} depends on ${d}, which isn't in the plan`);
  }
  const covered = new Set(stories.flatMap((s) => s.requirements));
  for (const r of requirements)
    if (!r.removed && !covered.has(r.id)) problems.push(`${r.id} is in no story (${r.file})`);
  return problems;
}

/** The whole picture for `code-kit status` and `code-kit next`: stories, requirements, gaps, drift. */
export function buildStatus(root, config, base, files) {
  const { specs, plan } = config.docs;
  const requirements = readRequirements(root, specs).filter((r) => r.file !== plan);
  const stories = storyStates(root, readStories(root, plan), base);
  const tested = testedRequirements(root, files, specs);
  const problems = traceProblems(requirements, stories, Object.keys(config.lanes));
  const byRequirement = requirements.map((r) => {
    const covering = stories.filter((s) => s.requirements.includes(r.id));
    let state = 'no story';
    if (r.removed) state = 'removed';
    else if (covering.length && covering.every((s) => s.state === 'done')) state = 'done';
    else if (covering.some((s) => ['in progress', 'review', 'sent back', 'done'].includes(s.state)))
      state = 'in progress';
    else if (covering.length) state = 'todo';
    return { ...r, state, stories: covering.map((s) => s.id), tests: tested[r.id] ?? [] };
  });
  const drift = stories
    .filter(
      (s) =>
        !['ready', 'blocked'].includes(s.state) &&
        s.state !== s.status &&
        !(s.state === 'sent back' && s.status === 'in progress'),
    )
    .map((s) => ({ story: s.id, plan: s.status, actual: s.state }));
  return { stories, requirements: byRequirement, problems, drift };
}

/**
 * The rows of a spec-check report's table (skills/spec-check): [{ requirement, status, where, note }],
 * the first column's requirement id, the status as written (done, partial, missing or conflicts).
 */
export function specCheckRows(text) {
  const lines = String(text).split('\n');
  const head = lines.findIndex((l) => /^\s*\|\s*Requirement\s*\|/i.test(l));
  if (head < 0) return [];
  const rows = [];
  for (const line of lines.slice(head + 1)) {
    if (!/^\s*\|/.test(line)) break;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;
    const [requirement = '', status = '', where = '', note = ''] = cells;
    rows.push({
      requirement: requirement.match(REQUIREMENT_ID)?.[0] ?? requirement,
      status: status.toLowerCase(),
      where,
      note,
    });
  }
  return rows;
}
const REQUIREMENT_ID = /\b[A-Z][A-Z0-9]*-\d+\b/;
