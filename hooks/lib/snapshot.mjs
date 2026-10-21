// HUBR-2: what a project reports to its team provider (docs/specs/21-hub-adapter-and-reports.md): a
// snapshot of facts code-kit already has (status, timeline, trail, journal's approvals, the merge queue,
// usage, the rules), as metadata only. SNAPSHOT_SCHEMA is the allow-list: every field a snapshot may
// hold, and what kind of value it is. A provider validates against the same list, and `validSnapshot`
// refuses anything else, so file contents, diffs, prompts and messages have nowhere to go.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { APPROVAL_LOG } from './rules.mjs';
import { approverOf } from './journal.mjs';
import { readQueue } from './queue.mjs';
import { sendBacks } from './reviews.mjs';
import { readMilestones, specCheckRows } from './plan.mjs';
import { storyTimes } from './timeline.mjs';
import { trail } from './storymap.mjs';

export const SNAPSHOT_VERSION = 1;

/** A story's stage, as a report names it. */
export const STAGES = [
  'planned',
  'claimed',
  'building',
  'review',
  'sent-back',
  'queued',
  'merged',
  'done',
];
export const AGENT_KINDS = ['lead', 'lane', 'reviewer', 'security-reviewer', 'background'];

/**
 * The allow-list. A leaf is a kind: `id` (ST-4, API-2), `handle` (a GitHub login), `name` (a lane, a
 * layer, a milestone, an approval: one line, at most 120 characters), `title` (one line, at most 200),
 * `line` (a send-back's reason: one line, at most 200), `path` (a file path or glob: one line, at most
 * 300), `ms` (a time in milliseconds), `date` (YYYY-MM-DD), `count` (a whole number, 0 or more),
 * `bool`, `enum:a|b`. A trailing `?` allows null. An array holds one shape; an object holds only the
 * keys it lists.
 */
export const SNAPSHOT_SCHEMA = {
  version: 'count',
  project: { repository: 'name?', base: 'name', codeKit: 'name', at: 'ms' },
  milestones: [{ name: 'name', target: 'date?', stories: ['id'] }],
  stories: [
    {
      id: 'id',
      title: 'title',
      lane: 'name?',
      milestone: 'name?',
      requirements: ['id'],
      dependsOn: ['id'],
      stage: `enum:${STAGES.join('|')}`,
      since: {
        building: 'ms?',
        review: 'ms?',
        sentBack: 'ms?',
        queued: 'ms?',
        merged: 'ms?',
      },
      claimedBy: 'handle?',
    },
  ],
  sendBacks: [{ story: 'id', at: 'ms', reason: 'line?' }],
  requirements: [
    {
      id: 'id',
      stories: ['id'],
      built: ['path'],
      tested: ['path'],
      check: 'enum:done|partial|missing|conflicts|none',
    },
  ],
  approvals: [{ what: 'name', path: 'path?', who: 'enum:person|lead', at: 'ms', branch: 'name?' }],
  usage: [
    {
      story: 'id?',
      kind: `enum:${AGENT_KINDS.join('|')}`,
      input: 'count',
      output: 'count',
      cache: 'count',
    },
  ],
  rules: {
    layers: [{ name: 'name', mayImport: ['name'] }],
    protected: [{ glob: 'path', approval: 'name' }],
    delegated: { protected: ['name'], dependencies: 'bool', merge: 'bool' },
    designGate: 'bool',
  },
};

const ONE_LINE = (max) => (v) => typeof v === 'string' && v.length <= max && !/[\r\n]/.test(v);
const KINDS = {
  id: (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(v),
  handle: (v) => typeof v === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v),
  name: ONE_LINE(120),
  title: ONE_LINE(200),
  line: ONE_LINE(200),
  path: ONE_LINE(300),
  ms: (v) => Number.isInteger(v) && v > 0,
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  count: (v) => Number.isInteger(v) && v >= 0,
  bool: (v) => typeof v === 'boolean',
};

/** What's wrong with a snapshot against the allow-list, as `path: problem` lines; empty when valid. */
export function snapshotProblems(value, shape = SNAPSHOT_SCHEMA, at = 'snapshot') {
  if (typeof shape === 'string') {
    const optional = shape.endsWith('?');
    const kind = optional ? shape.slice(0, -1) : shape;
    if (value === null || value === undefined) return optional ? [] : [`${at}: missing`];
    if (kind.startsWith('enum:'))
      return kind.slice(5).split('|').includes(value) ? [] : [`${at}: not one of ${kind.slice(5)}`];
    return KINDS[kind](value) ? [] : [`${at}: not a ${kind}`];
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${at}: not a list`];
    return value.flatMap((v, i) => snapshotProblems(v, shape[0], `${at}[${i}]`));
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return [`${at}: not an object`];
  const extra = Object.keys(value).filter((k) => !(k in shape));
  return [
    ...extra.map((k) => `${at}.${k}: not a field a report may hold`),
    ...Object.entries(shape).flatMap(([k, s]) => snapshotProblems(value[k], s, `${at}.${k}`)),
  ];
}

/** The snapshot's hash, leaving out when it was made: equal snapshots aren't sent twice. */
export function snapshotHash(snapshot, parts = null) {
  const { project, ...rest } = snapshot;
  const kept = parts ? Object.fromEntries(parts.map((p) => [p, rest[p]])) : rest;
  return createHash('sha256')
    .update(JSON.stringify({ project: { ...project, at: 0 }, ...kept }))
    .digest('hex');
}

/** The parts whose change is sent at once (HUBR-3); usage alone waits for the ten minutes. */
export const EVENT_PARTS = [
  'milestones',
  'stories',
  'sendBacks',
  'requirements',
  'approvals',
  'rules',
];

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

/** owner/name of the repository's GitHub origin, or null. */
export function repositoryOf(root) {
  const remote = git(root, 'config', '--get', 'remote.origin.url');
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The main checkout, where the lanes' worktrees share their state. */
export function mainCheckout(root) {
  const common = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return common ? dirname(common) : root;
}

export const USAGE_DIR = '.claude/state/usage';

/** The usage every session recorded (USE-1's ledgers, written by the mod): [{ story, kind, … }]. */
export function recordedUsage(root) {
  const dir = join(mainCheckout(root), USAGE_DIR);
  const sums = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  for (const f of files) {
    let entries = [];
    try {
      entries = Object.values(JSON.parse(readFileSync(join(dir, f), 'utf8')).entries ?? {});
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!AGENT_KINDS.includes(e.kind)) continue;
      const story = KINDS.id(e.story) ? e.story : null;
      const key = `${story}|${e.kind}`;
      const was = sums.get(key) ?? { story, kind: e.kind, input: 0, output: 0, cache: 0 };
      for (const k of ['input', 'output', 'cache'])
        was[k] += Number.isInteger(e[k]) && e[k] > 0 ? e[k] : 0;
      sums.set(key, was);
    }
  }
  return [...sums.values()];
}

/** The spec-check report's status for each requirement of a story, from its branch's report. */
function checkedRows(root, story) {
  const name = `${story.branch.replace(/[^\w.-]+/g, '_')}.md`;
  for (const dir of [story.worktree, root].filter(Boolean)) {
    const file = join(dir, '.claude/state/spec-check', name);
    if (existsSync(file)) return specCheckRows(readFileSync(file, 'utf8'));
  }
  return [];
}

const CHECKS = ['done', 'partial', 'missing', 'conflicts'];

/**
 * The snapshot (HUBR-2) from what code-kit already computed: `status` is buildStatus's, `base` the
 * branch stories merge into, `claims` the team's claims as last read, `version` code-kit's.
 */
export function buildSnapshot({
  root,
  config,
  status,
  base,
  claims = [],
  version,
  now = Date.now(),
}) {
  const times = new Map(storyTimes(root, status.stories, base).map((t) => [t.id, t]));
  const queued = new Map(
    readQueue(root)
      .filter((e) => e.state === 'waiting' || e.state === 'merging')
      .map((e) => [e.branch, Date.parse(e.passed)]),
  );
  const backs = sendBacks(root);
  const claimed = new Map(claims.map((c) => [c.story, c.by]));
  const ms = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  const line = (s) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, 200) || null : null);

  const stories = status.stories.map((s) => {
    const t = times.get(s.id) ?? {};
    const myBacks = backs.filter((b) => b.branch === s.branch);
    const lastBack = myBacks.length ? Date.parse(myBacks.at(-1).at) : null;
    let stage = 'planned';
    if (s.state === 'done') stage = s.status === 'done' ? 'done' : 'merged';
    else if (s.state === 'sent back') stage = 'sent-back';
    else if (s.state === 'review') stage = queued.has(s.branch) ? 'queued' : 'review';
    else if (s.state === 'in progress') stage = 'building';
    else if (claimed.has(s.id)) stage = 'claimed';
    const reached = STAGES.indexOf(stage);
    return {
      id: s.id,
      title: line(s.title) ?? s.id,
      lane: s.lane || null,
      milestone: s.milestone ? line(s.milestone).slice(0, 120) : null,
      requirements: s.requirements,
      dependsOn: s.dependsOn,
      stage,
      since: {
        building: reached >= STAGES.indexOf('building') ? ms(t.started) : null,
        review:
          reached >= STAGES.indexOf('review') && stage !== 'sent-back' ? ms(t.lastCommit) : null,
        sentBack: ms(lastBack),
        queued: stage === 'queued' ? ms(queued.get(s.branch)) : null,
        merged: ms(t.merged),
      },
      claimedBy: claimed.get(s.id) ?? null,
    };
  });

  const targets = Object.fromEntries(
    readMilestones(root, config.docs.plan).map((m) => [m.name, m.target]),
  );
  const milestones = [...new Set(status.stories.map((s) => s.milestone).filter(Boolean))].map(
    (m) => ({
      name: line(m).slice(0, 120),
      target: targets[m] ?? null,
      stories: status.stories.filter((s) => s.milestone === m).map((s) => s.id),
    }),
  );

  const byBranch = new Map(status.stories.map((s) => [s.branch, s.id]));
  const sendBackList = backs
    .filter((b) => byBranch.has(b.branch) && ms(Date.parse(b.at)))
    .map((b) => ({ story: byBranch.get(b.branch), at: Date.parse(b.at), reason: line(b.reason) }));

  const checks = new Map();
  for (const s of status.stories)
    if (s.branchExists)
      for (const row of checkedRows(root, s))
        if (CHECKS.includes(row.status)) checks.set(row.requirement, row.status);
  const requirements = trail(root, status, base).map((r) => ({
    id: r.id,
    stories: r.stories.map((s) => s.id),
    built: r.files.filter((f) => KINDS.path(f)),
    tested: r.tests.filter((f) => KINDS.path(f)),
    check: checks.get(r.id) ?? 'none',
  }));

  const approvals = [];
  const seen = new Set();
  for (const raw of git(root, 'show', `${base}:${APPROVAL_LOG}`).split('\n').filter(Boolean)) {
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!e.approval || e.approval === 'lead') continue;
    const at = Date.parse(e.grantedAt ?? e.at);
    const key = `${e.approval}|${e.file ?? ''}|${at}`;
    if (seen.has(key) || !ms(at) || !KINDS.name(e.approval)) continue;
    seen.add(key);
    approvals.push({
      what: e.approval,
      path: KINDS.path(e.file) ? e.file : null,
      who: approverOf(e),
      at,
      branch: KINDS.name(e.branch) ? e.branch : null,
    });
  }

  const delegate = config.approvals?.delegate ?? null;
  const snapshot = {
    version: SNAPSHOT_VERSION,
    project: {
      repository: repositoryOf(root),
      base,
      codeKit: String(version),
      at: now,
    },
    milestones,
    stories,
    sendBacks: sendBackList,
    requirements,
    approvals,
    usage: recordedUsage(root),
    rules: {
      layers: (config.layers ?? []).map((l) => ({ name: l.name, mayImport: l.mayImport ?? [] })),
      protected: (config.protected ?? [])
        .filter((p) => KINDS.path(p.glob) && KINDS.name(p.approval))
        .map((p) => ({ glob: p.glob, approval: p.approval })),
      delegated: {
        protected: delegate?.protected ?? [],
        dependencies: Boolean(delegate?.dependencies),
        merge: Boolean(delegate?.merge),
      },
      designGate: Boolean(config.designGate),
    },
  };
  return snapshot;
}
