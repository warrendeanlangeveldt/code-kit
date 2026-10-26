// Requirements and stories, read from the project's docs. Specs (docs.specs) hold requirements as
// headings `### BOOK-4 Short name` (`(removed)` at the end drops one); the plan (docs.plan) holds
// stories as `### ST-12 Title` followed by `**Lane:**`, `**Requirements:**`, `**Depends on:**` and
// `**Status:**` lines, and for a fix, `**Fixes:**`. A lane builds a story on the branch `<lane>/st-12`. The lane `lead` marks the
// lead's own stories (contracts, foundations, spikes), which the lead builds rather than dispatches;
// `**Requirements:** none` marks a story that delivers no requirement, such as a spike.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { laneClaims } from './laneclaims.mjs';
import { waitingStories } from './questions.mjs';
import { sentBack } from './reviews.mjs';
import { WORKTREES_DIR } from './worktrees.mjs';

export const REQUIREMENT = /\b(?!ST-)([A-Z][A-Z0-9]*-\d+)\b/g;
const STORY_HEADING = /^###\s+(ST-\d+)\b\s*(.*)$/;
const REQUIREMENT_HEADING = /^###\s+((?!ST-)[A-Z][A-Z0-9]*-\d+)\b\s*(.*)$/;
export const STATES = ['todo', 'in progress', 'review', 'done'];
export const LEAD = 'lead';
/** ONB-2: the pseudo-lane for design stories, which the lead designs with the person before any screen is built. */
export const DESIGN = 'design';
// Test files, by the usual conventions. Tests name the requirement IDs they prove.
const TEST =
  /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;

/** The markdown files at `path`: the file itself, or every one under the folder, sorted. */
export const markdownFiles = (root, path) => {
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

/** The first paragraph under a story's `**Field:**` lines, on one line, or null. */
function summaryOf(body) {
  const start = body.findIndex((l) => l.trim() && !/^\*\*[^*]+:\*\*/.test(l.trim()));
  if (start < 0) return null;
  const end = body.findIndex((l, j) => j > start && !l.trim());
  const text = body
    .slice(start, end < 0 ? undefined : end)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Every story in the plan: [{ id, title, lane, requirements, dependsOn, status, fixes, milestone, slice, size, summary }].
 * A story's milestone is the `## ` heading above it ("Milestone 5: Your own key"), or null; its summary the
 * paragraph under its fields, on one line, or null.
 */
export function readStories(root, planPath) {
  const stories = [];
  for (const file of markdownFiles(root, planPath)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    let milestone = null;
    lines.forEach((line, i) => {
      const heading = line.match(/^##\s+(.+?)\s*$/);
      if (heading) milestone = heading[1];
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
        // REG-1: what a fix story fixes, or null.
        fixes: field(body, 'Fixes') || null,
        dependsOn: [...field(body, 'Depends on').matchAll(/\bST-\d+\b/g)].map((r) => r[0]),
        status: STATES.includes(status) ? status : 'todo',
        milestone,
        // SCHED-2: the slice it belongs to, a feature built across lanes, or null.
        slice: field(body, 'Slice') || null,
        // SCHED-3: small, medium or large, as the lead judged it, or null.
        size:
          field(body, 'Size')
            .toLowerCase()
            .match(/^(small|medium|large)\b/)?.[1] ?? null,
        summary: summaryOf(body),
      });
    });
  }
  return stories;
}

/**
 * HUBR-5: each milestone in the plan, in order: [{ name, target }], `name` the `## ` heading a story sits
 * under, `target` the date a `**Target:** YYYY-MM-DD` line under that heading gives, before its first
 * story, or null.
 */
export function readMilestones(root, planPath) {
  const found = [];
  for (const file of markdownFiles(root, planPath)) {
    let current = null;
    for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
      const heading = line.match(/^##\s+(.+?)\s*$/);
      if (heading) {
        current = { name: heading[1], target: null, open: true };
        found.push(current);
        continue;
      }
      if (/^###\s/.test(line) && current) current.open = false;
      const target = line.match(/^\*\*Target:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/i);
      if (target && current?.open && !current.target) current.target = target[1];
    }
  }
  return found.map(({ name, target }) => ({ name, target }));
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
      // A long-lived project's log runs to megabytes.
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
};

/**
 * Every local and origin branch in one read: { ref: { sha, ahead } }, `ahead` the commits it has that
 * `base` hasn't. A project with hundreds of stories has hundreds of branches, and a git call each
 * outlasts the mod's 30 seconds. Git before 2.41 can't count them in the same read: `ahead` is then
 * null, and counted for each branch as it's asked for.
 */
export function branchRefs(root, base) {
  const read = (format) =>
    git(root, 'for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes/origin');
  const counted = read(`%(refname)%09%(objectname)%09%(ahead-behind:${base})`);
  const out = counted ?? read('%(refname)%09%(objectname)') ?? '';
  const refs = {};
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, sha, aheadBehind] = line.split('\t');
    refs[ref] = { sha, ahead: counted === null ? null : Number(aheadBehind.split(' ')[0]) };
  }
  return refs;
}

/**
 * How each local branch was made, from its reflog's oldest entry: (branch) => { sha, at } (the commit
 * it was made at, and when, in milliseconds), or null once the reflog is gone. Read from the file git
 * keeps it in, or from git where there's no file (a reftable repository).
 */
export function branchMaking(root) {
  const common = git(root, 'rev-parse', '--git-common-dir');
  const dir = common ? (isAbsolute(common) ? common : join(root, common)) : null;
  return (branch) => {
    if (!dir) return null;
    try {
      const first = readFileSync(join(dir, 'logs/refs/heads', branch), 'utf8').split('\n')[0];
      const [head] = first.split('\t');
      const sha = head.split(' ')[1];
      const at = head.match(/> (\d+) [+-]\d{4}$/)?.[1];
      return sha && at ? { sha, at: Number(at) * 1000 } : null;
    } catch {
      const oldest = (
        git(root, 'reflog', 'show', '--date=unix', '--format=%H %gd', `refs/heads/${branch}`) ?? ''
      )
        .split('\n')
        .filter(Boolean)
        .at(-1)
        ?.match(/^([0-9a-f]+) .*@\{(\d+)\}$/);
      return oldest ? { sha: oldest[1], at: Number(oldest[2]) * 1000 } : null;
    }
  };
}

/** The ref of a branch, local first, then on origin; null when neither exists. */
function branchRef(refs, branch) {
  return [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].find((r) => refs[r]) ?? null;
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
 * `base` is in review. A branch still at the commit a review sent back is `sent back`, waiting for
 * its lane's fix. Without a branch, the plan's status stands. A story is `blocked` while a story it
 * depends on isn't done, whatever its branch holds; a todo story whose dependencies are done is `ready`.
 * A story with an open question for the person that holds it (`code-kit ask --blocks`) is `waiting on
 * you`.
 *
 * A branch level with the base is in progress while something builds it: a live claim of its lane (an
 * agent at work on it, SCHED-1), or the branch checked out where a person works (the main checkout, or a
 * worktree of theirs). With nothing on it, it's done when its commits merged (the plan had it in review,
 * the branch moved since it was made, or with no reflog, the base names the story or merged the branch),
 * whatever the plan says yet. A lane's branch that never moved is `stopped`: its agent stopped before its
 * first commit, and the story is ready again (or blocked) for a fresh agent, so its lane isn't held by
 * nothing. A branch only on origin may be a teammate's, and stays in progress unless the base holds it.
 */
export function storyStates(root, stories, base) {
  const trees = worktrees(root);
  const backs = sentBack(root);
  const refs = branchRefs(root, base);
  const live = new Set(
    laneClaims(root)
      .filter((c) => !c.stale)
      .map((c) => `${c.lane}|${c.story ?? ''}`),
  );
  // What the base already holds: the stories its commits name, and the story branches merged into it.
  const onBase = { stories: new Set(), branches: new Set() };
  for (const m of (git(root, 'log', base, '--format=%B%x1e') ?? '').matchAll(
    /(?:^|[^A-Za-z0-9-])(ST-\d+)(?!\d)|([A-Za-z0-9_.-]+\/st-\d+)(?![\w-])/gim,
  ))
    if (m[1]) onBase.stories.add(m[1]);
    else onBase.branches.add(m[2].toLowerCase());
  const making = branchMaking(root);
  const merged = (story, branch) =>
    onBase.stories.has(story.id) || onBase.branches.has(branch.toLowerCase());
  const agentTree = (path) => path?.split('\\').join('/').includes(`/${WORKTREES_DIR}/`);
  const builtBy = (story, branch) =>
    live.has(`${story.lane}|${story.id}`) ||
    live.has(`${story.lane}|`) ||
    (trees[branch] !== undefined && !agentTree(trees[branch]));
  const states = stories.map((story) => {
    const branch = storyBranch(story);
    const ref = story.lane ? branchRef(refs, branch) : null;
    const ahead = !ref
      ? 0
      : (refs[ref].ahead ?? Number(git(root, 'rev-list', '--count', `${base}..${ref}`) ?? 0));
    let state = story.status;
    let stopped = false;
    if (ref && story.status !== 'done') {
      const head = backs[branch] ? refs[ref].sha : null;
      if (head && head === backs[branch].sha) state = 'sent back';
      else if (ahead > 0) state = 'review';
      else if (story.status === 'review') state = 'done';
      else if (builtBy(story, branch)) state = 'in progress';
      else {
        // Level with the base, and nothing on it: its commits merged (the plan may not say so yet), or
        // none was made. A local branch's reflog says which: it moved from the commit it was made at only
        // by being committed to. Without one, the base's own log says whether it holds the story's work.
        const made = ref.startsWith('refs/heads/') ? making(branch) : null;
        if (made ? made.sha !== refs[ref].sha : merged(story, branch)) state = 'done';
        else if (made && ![LEAD, DESIGN].includes(story.lane)) {
          state = 'todo';
          stopped = true;
        } else state = 'in progress';
      }
    }
    return {
      ...story,
      branch,
      branchExists: Boolean(ref),
      ref,
      ahead,
      worktree: trees[branch] ?? null,
      state,
      stopped,
      waitingOn: [],
    };
  });
  const done = new Set(states.filter((s) => s.state === 'done').map((s) => s.id));
  // ASK-3: a story whose question for the person is open waits on them, whatever its branch holds.
  const asked = waitingStories(root);
  for (const s of states) {
    if (s.state === 'done') continue;
    s.waitingOn = s.dependsOn.filter((d) => !done.has(d));
    s.waitingFor = asked.has(s.id)
      ? { id: asked.get(s.id).id, question: asked.get(s.id).question }
      : null;
    if (s.waitingFor) s.state = 'waiting on you';
    else if (s.waitingOn.length) s.state = 'blocked';
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
    else if (s.lane !== LEAD && s.lane !== DESIGN && !lanes.includes(s.lane))
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
    else if (
      covering.some((s) =>
        ['in progress', 'review', 'sent back', 'waiting on you', 'done'].includes(s.state),
      )
    )
      state = 'in progress';
    else if (covering.length) state = 'todo';
    return { ...r, state, stories: covering.map((s) => s.id), tests: tested[r.id] ?? [] };
  });
  const drift = stories
    .filter(
      (s) =>
        !['ready', 'blocked', 'waiting on you'].includes(s.state) &&
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
