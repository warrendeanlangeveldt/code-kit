// What a project's CI costs (docs/specs/25-what-ci-costs.md). code-kit builds each story on its own branch
// and merges it on its own, so whatever CI runs per pull request or per merge runs once per story; the
// merge queue already ran the checks before each merge. `ciFindings` reads the workflows for what
// multiplies that cost (CIC-2), `usageSummary` sums what the project spent (CIC-4), and `releaseBranch`
// cuts the branch the full CI runs on instead (CIC-3).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WORKFLOWS_DIR = '.github/workflows';
export const RELEASE_PREFIX = 'release/';
/** GitHub's own limit for a job without one: six hours. */
const GITHUB_LIMIT_MINUTES = 360;

// --- a YAML subset ---------------------------------------------------------------------------------

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
  return t;
};
const stripComment = (line) => {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};
const scalar = (v) => {
  const t = v.trim();
  if (t === '') return null;
  if (t.startsWith('[') && t.endsWith(']'))
    return t
      .slice(1, -1)
      .split(',')
      .map((x) => unquote(x))
      .filter(Boolean);
  if (t.startsWith('{') && t.endsWith('}')) return {};
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return unquote(t);
};

/**
 * The block maps, block lists and flow lists GitHub workflows are written in, as plain objects. Block
 * scalars (`run: |`) are kept as their text. Anchors, tags and multi-document files aren't read.
 */
export function parseYaml(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((raw) => ({ raw, indent: raw.length - raw.trimStart().length }));
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && !stripComment(lines[i].raw).trim()) i += 1;
  };
  const blockScalar = (indent) => {
    const out = [];
    while (i < lines.length && (!lines[i].raw.trim() || lines[i].indent > indent)) {
      out.push(lines[i].raw.trim());
      i += 1;
    }
    return out.join('\n').trim();
  };
  const node = (indent) => {
    skipBlank();
    if (i >= lines.length || lines[i].indent < indent) return null;
    const first = stripComment(lines[i].raw).trim();
    return first.startsWith('- ') || first === '-' ? list(lines[i].indent) : map(lines[i].indent);
  };
  const value = (rest, indent) => {
    const r = rest.trim();
    if (r === '|' || r === '>' || /^[|>][+-]?$/.test(r)) return blockScalar(indent);
    if (r !== '') return scalar(r);
    skipBlank();
    if (i < lines.length && lines[i].indent > indent) return node(lines[i].indent);
    // A list may sit at its key's own indentation.
    if (i < lines.length && lines[i].indent === indent && /^-(\s|$)/.test(lines[i].raw.trim()))
      return list(indent);
    return null;
  };
  const map = (indent) => {
    const out = {};
    while (true) {
      skipBlank();
      if (i >= lines.length || lines[i].indent !== indent) break;
      const line = stripComment(lines[i].raw).trim();
      if (line.startsWith('- ')) break;
      const m = /^("[^"]*"|'[^']*'|[^:]+?):(\s+|$)(.*)$/.exec(line);
      i += 1;
      if (!m) continue;
      out[unquote(m[1])] = value(m[3], indent);
    }
    return out;
  };
  const list = (indent) => {
    const out = [];
    while (true) {
      skipBlank();
      if (i >= lines.length || lines[i].indent !== indent) break;
      const line = stripComment(lines[i].raw).trim();
      if (!/^-(\s|$)/.test(line)) break;
      const rest = line.replace(/^-\s?/, '');
      const kv = /^("[^"]*"|'[^']*'|[^:\s][^:]*?):(\s+|$)(.*)$/.exec(rest);
      if (kv && !rest.startsWith('"') && !rest.startsWith("'")) {
        // A map in a list: its first key is on the dash's line, the rest under it, past the dash.
        const inner =
          indent +
          (lines[i].raw.slice(indent).length -
            lines[i].raw.slice(indent).replace(/^-\s*/, '').length);
        lines[i] = { raw: `${' '.repeat(inner)}${rest}`, indent: inner };
        out.push(map(inner));
      } else {
        i += 1;
        out.push(rest === '' ? node(indent + 1) : scalar(rest));
      }
    }
    return out;
  };
  return node(0) ?? {};
}

// --- what costs most -------------------------------------------------------------------------------

/** A workflow's triggers as { event: config }, whichever way `on:` is written. */
export function triggersOf(doc) {
  const on = doc?.on ?? doc?.true ?? null; // a bare `on` key can read as a boolean elsewhere
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, null]));
  return on && typeof on === 'object' ? on : {};
}

const listOf = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
const globMatch = (pattern, name) =>
  new RegExp(
    `^${String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  ).test(name);

/** Whether a push trigger runs when `base` moves. */
function pushRunsOnBase(push, base) {
  if (push === null || push === undefined) return true;
  const branches = listOf(push.branches);
  const ignored = listOf(push['branches-ignore']);
  if (branches.length) return branches.some((b) => globMatch(b, base));
  if (ignored.length) return !ignored.some((b) => globMatch(b, base));
  // Tags (or paths) alone: a push of tags only isn't a merge.
  return !(push.tags || push['tags-ignore']) || Boolean(push.paths);
}

const TESTING = /\b(test|tests|e2e|playwright|cypress|integration|pytest|vitest|jest)\b/i;
const runsCodeKitVerify = (step) =>
  typeof step?.run === 'string' && /code-kit(@\S+)?\s+verify\b/.test(step.run.replace(/\n/g, ' '));

/**
 * CIC-2: what in one workflow multiplies its cost with a story per branch: [{ file, kind, what, fix }].
 * `base` is the branch lanes merge into.
 */
export function workflowFindings(file, text, base) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch {
    return [];
  }
  const on = triggersOf(doc);
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  const steps = Object.values(jobs).flatMap((j) => (Array.isArray(j?.steps) ? j.steps : []));
  const ours = steps.some(runsCodeKitVerify);
  const out = [];
  const add = (kind, what, fix) => out.push({ file, kind, what, fix });
  if ('push' in on && pushRunsOnBase(on.push, base))
    add(
      'every-merge',
      `runs on every push to ${base}, so once per story merged; the merge queue already checked each one`,
      `run it on the release branches instead: on: push: branches: ['${RELEASE_PREFIX}**']`,
    );
  const onPr = 'pull_request' in on || 'pull_request_target' in on;
  const pr = on.pull_request ?? on.pull_request_target ?? null;
  const filtered = Boolean(pr?.paths || pr?.['paths-ignore']);
  if (
    onPr &&
    !ours &&
    !filtered &&
    steps.some((s) => TESTING.test(`${s?.name ?? ''} ${s?.run ?? ''} ${s?.uses ?? ''}`))
  )
    add(
      'every-pr',
      'runs its tests on every pull request, so once per story, after the merge queue ran them',
      `run it on the release branches instead (on: push: branches: ['${RELEASE_PREFIX}**']), keeping a fast check on pull requests if the project wants one`,
    );
  const untimed = Object.entries(jobs)
    .filter(([, j]) => j && typeof j === 'object' && !('timeout-minutes' in j) && !j.uses)
    .map(([id]) => id);
  if (untimed.length)
    add(
      'no-timeout',
      `${untimed.length === 1 ? 'job' : 'jobs'} ${untimed.join(', ')} ${untimed.length === 1 ? 'has' : 'have'} no timeout-minutes, so a hung step runs up to GitHub's ${GITHUB_LIMIT_MINUTES / 60} hours`,
      'give each job a timeout-minutes a little over its usual run',
    );
  const cancels = (c) => c && typeof c === 'object' && c['cancel-in-progress'] === true;
  if (
    onPr &&
    !cancels(doc.concurrency) &&
    !Object.values(jobs).every((j) => cancels(j?.concurrency))
  )
    add(
      'no-concurrency',
      'has no concurrency with cancel-in-progress, so every push to a pull request runs to the end',
      'add concurrency: { group: <workflow>-${{ github.head_ref || github.ref }}, cancel-in-progress: true }',
    );
  if (steps.some((s) => runsCodeKitVerify(s) && !/--no-checks\b/.test(s.run)))
    add(
      'code-kit-checks',
      "code-kit's verify runs the project's checks again on every pull request, after the merge queue ran them",
      'add --no-checks to its verify step',
    );
  return out;
}

/** CIC-2: every workflow's findings, in file order. */
export function ciFindings(root, base) {
  const dir = join(root, WORKFLOWS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .flatMap((f) =>
      workflowFindings(`${WORKFLOWS_DIR}/${f}`, readFileSync(join(dir, f), 'utf8'), base),
    );
}

// --- what it spent ---------------------------------------------------------------------------------

/** GitHub refusing to start jobs for the account's billing, from a job's annotations. */
export const BILLING_REFUSAL = /spending limit|payments have failed|billing/i;

/**
 * CIC-4: runs summed by workflow and trigger: { rows: [{ workflow, event, runs, minutes, cancelled,
 * failed }], runs, minutes }, most minutes first. A run's minutes are its wall-clock time.
 */
export function usageSummary(runs) {
  const by = new Map();
  let minutes = 0;
  for (const r of runs) {
    const start = Date.parse(r.run_started_at ?? r.created_at);
    const end = Date.parse(r.updated_at);
    const m =
      Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : 0;
    const key = `${r.name}\u0000${r.event}`;
    const row = by.get(key) ?? {
      workflow: r.name,
      event: r.event,
      runs: 0,
      minutes: 0,
      cancelled: 0,
      failed: 0,
    };
    row.runs += 1;
    row.minutes += m;
    if (r.conclusion === 'cancelled') row.cancelled += 1;
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out') row.failed += 1;
    by.set(key, row);
    minutes += m;
  }
  const rows = [...by.values()]
    .map((r) => ({ ...r, minutes: Math.round(r.minutes) }))
    .sort((a, b) => b.minutes - a.minutes || a.workflow.localeCompare(b.workflow));
  return { rows, runs: runs.length, minutes: Math.round(minutes) };
}

const gh = (root, args) =>
  spawnSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * CIC-4: the project's Actions runs over the last `days`, summed, and whether GitHub refused to start the
 * latest run's jobs for billing: { repo, days, ...usageSummary, refused } or { error }.
 */
export function ciUsage(root, { days = 7, now = Date.now() } = {}) {
  const repo = gh(root, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  if (repo.error || repo.status !== 0)
    return {
      error: `GitHub's CLI couldn't say which repository this is${repo.stderr ? `: ${repo.stderr.trim().split('\n')[0]}` : ''}. Run it in a clone with a GitHub remote, signed in with gh auth login.`,
    };
  const name = repo.stdout.trim();
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const listed = gh(root, [
    'api',
    '--paginate',
    `repos/${name}/actions/runs?created=%3E%3D${since}&per_page=100`,
    '-q',
    '.workflow_runs[] | {name, event, conclusion, run_started_at, created_at, updated_at, id}',
  ]);
  if (listed.status !== 0)
    return { error: `GitHub didn't list the runs: ${listed.stderr.trim().split('\n')[0]}` };
  const runs = listed.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  let refused = null;
  const latest = runs.find((r) => r.conclusion === 'failure');
  if (latest && latest === runs[0]) {
    const jobs = gh(root, [
      'api',
      `repos/${name}/actions/runs/${latest.id}/jobs`,
      '-q',
      '.jobs[].id',
    ]);
    for (const id of jobs.stdout.split('\n').filter(Boolean).slice(0, 3)) {
      const notes = gh(root, [
        'api',
        `repos/${name}/check-runs/${id}/annotations`,
        '-q',
        '.[].message',
      ]);
      const hit = notes.stdout.split('\n').find((m) => BILLING_REFUSAL.test(m));
      if (hit) {
        refused = hit.trim();
        break;
      }
    }
  }
  return { repo: name, days, ...usageSummary(runs), refused };
}

// --- the release branch ----------------------------------------------------------------------------

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
};

/** Version-aware order of release branches: release/0.10.0 after release/0.9.0. */
const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/**
 * CIC-3: cuts `release/<version>` from `base` as committed and pushes it to `remote`, so the project's
 * full CI runs once on it: { ok, branch, commit, stories, since } or { ok: false, why }.
 */
export function releaseBranch(root, version, { base, remote = 'origin', push = true } = {}) {
  const branch = `${RELEASE_PREFIX}${String(version).replace(/^release\//, '')}`;
  if (!version || git(root, 'check-ref-format', '--branch', branch) === null)
    return {
      ok: false,
      why: `${branch} isn't a branch name git accepts. Give a version such as 0.4.0.`,
    };
  const commit = git(root, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  if (!commit) return { ok: false, why: `There's no ${base} here to release from.` };
  const here = git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  const there = push ? git(root, 'ls-remote', '--heads', remote, branch) : '';
  if (here || there)
    return {
      ok: false,
      why: `${branch} already exists${here ? `, at ${here.slice(0, 7)}` : ` on ${remote}`}. A release branch is cut once; give the next version.`,
    };
  // The stories merged since the last release branch, by the ids their commits name.
  const earlier = (
    git(
      root,
      'for-each-ref',
      '--format=%(refname:short)',
      `refs/heads/${RELEASE_PREFIX}`,
      `refs/remotes/${remote}/${RELEASE_PREFIX}`,
    ) ?? ''
  )
    .split('\n')
    .filter(Boolean)
    .sort(byVersion);
  const since = earlier.at(-1) ?? null;
  const log = git(root, 'log', '--format=%s%n%b', since ? `${since}..${commit}` : commit) ?? '';
  const stories = [...new Set(log.match(/\bST-\d+\b/g) ?? [])].sort(
    (a, b) => a.slice(3) - b.slice(3),
  );
  if (git(root, 'branch', branch, commit) === null)
    return { ok: false, why: `git couldn't make ${branch} at ${commit.slice(0, 7)}.` };
  if (push) {
    const pushed = spawnSync(
      'git',
      ['-C', root, 'push', remote, `refs/heads/${branch}:refs/heads/${branch}`],
      {
        encoding: 'utf8',
      },
    );
    if (pushed.status !== 0) {
      git(root, 'branch', '-D', branch);
      return {
        ok: false,
        why: `Pushing ${branch} to ${remote} failed: ${(pushed.stderr || '').trim().split('\n').at(-1)}`,
      };
    }
  }
  return { ok: true, branch, commit, stories, since: since?.replace(`${remote}/`, '') ?? null };
}
