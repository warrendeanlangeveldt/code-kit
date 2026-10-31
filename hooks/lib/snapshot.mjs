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
import { readQueue, waiting } from './queue.mjs';
import { sendBacks } from './reviews.mjs';
import { readMilestones, readSpecs, specCheckRows } from './plan.mjs';
import { handedOver, entryProblems, readRegister, toolOf } from './designs.mjs';
import { SECURITY_KINDS, securityReview, securityRules } from './security.mjs';
import { securityReviews } from './events.mjs';
import { sessions } from './sessions.mjs';
import { isHandle, storyOfBranch } from './teamfacts.mjs';
import { storyTimes } from './timeline.mjs';
import { trail } from './storymap.mjs';
import {
  APPLIED,
  CATEGORIES,
  LEVELS,
  ORIGINS,
  SOURCES,
  laneLayers,
  projectStandards,
  sourceOf,
} from './standards.mjs';

import { slicesOf } from './schedule.mjs';

/**
 * 2 adds the project's standards (code-kit spec 22); 3 the plan's slices (spec 23, SCHED-2); 4 each
 * story's summary and each requirement's title; 5 the specs (id, title, outcome line, requirement ids),
 * each layer's and lane's deliverable kind, the lanes with their layers and paths, each approval's
 * approver and story, the security review's rules, each story's spec-check result and place in the
 * merge queue, the design register's entries, and the sessions at work; 6 each usage row's model, the
 * security reviews each story needed and whether they ran, the pull request of each intent a claim
 * carries out, and the team's claims with when each was last renewed.
 */
export const SNAPSHOT_VERSION = 6;

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
/** A spec-check report's status for a requirement, and for a story, its worst requirement's. */
export const CHECKS = ['done', 'partial', 'missing', 'conflicts'];
/** A design register entry's state: its files handed over and as approved, only in a tool, or not as approved. */
export const DESIGN_STATES = ['handed-over', 'in-tool', 'problems'];
/** What a security review that ran found: nothing, findings, or a report without a findings block that reads. */
export const SECURITY_RESULTS = ['pass', 'findings', 'unread'];

/**
 * The allow-list. A leaf is a kind: `id` (ST-4, API-2), `handle` (a GitHub login), `name` (a lane, a
 * layer, a milestone, an approval: one line, at most 120 characters), `title` (one line, at most 200),
 * `line` (a send-back's reason: one line, at most 200), `summary` (a story's summary: one line, at most
 * 600), `path` (a file path or glob: one line, at most
 * 300), `ms` (a time in milliseconds), `date` (YYYY-MM-DD), `count` (a whole number, 0 or more),
 * `bool`, `enum:a|b`. A trailing `?` allows null. An array holds one shape; an object holds only the
 * keys it lists.
 */
export const SNAPSHOT_SCHEMA = {
  version: 'count',
  project: { repository: 'name?', base: 'name', codeKit: 'name', at: 'ms' },
  milestones: [{ name: 'name', target: 'date?', stories: ['id'] }],
  // SCHED-2: each slice in plan order, whether it's open or done, and its stories. Added in version 3.
  slices: [{ name: 'name', open: 'bool', done: 'bool', stories: ['id'] }],
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
      // Added in version 4.
      summary: 'summary?',
      // Added in version 5: the spec-check report's worst status on its branch (`none` with no report),
      // and its place in the merge queue (1 merges next) while its branch waits there.
      check: `enum:${[...CHECKS, 'none'].join('|')}?`,
      queuePosition: 'count?',
    },
  ],
  sendBacks: [{ story: 'id', at: 'ms', reason: 'line?' }],
  requirements: [
    {
      id: 'id',
      // Added in version 4.
      title: 'title?',
      stories: ['id'],
      built: ['path'],
      tested: ['path'],
      check: `enum:${[...CHECKS, 'none'].join('|')}`,
    },
  ],
  // Version 5: each spec, by the id the project gives it, its title, its outcome line and its
  // requirements' ids. Nothing else of its text.
  specs: [{ id: 'name', file: 'path', title: 'title?', outcome: 'summary?', requirements: ['id'] }],
  approvals: [
    {
      what: 'name',
      path: 'path?',
      who: 'enum:person|lead',
      at: 'ms',
      branch: 'name?',
      // Added in version 5: the person's GitHub login, when code-kit knew it; the story of its branch.
      approver: 'handle?',
      story: 'id?',
    },
  ],
  usage: [
    {
      story: 'id?',
      kind: `enum:${AGENT_KINDS.join('|')}`,
      // Added in version 6: the model the requests ran on, as Claude Code names it.
      model: 'name?',
      input: 'count',
      output: 'count',
      cache: 'count',
    },
  ],
  // Version 6: each story that needs the security review on its branch, or whose security reviewer ran:
  // why it needs it (the kinds of change), whether the reviewer ran, when it reported, and what it found.
  securityReviews: [
    {
      story: 'id',
      branch: 'name?',
      needed: 'bool?',
      reasons: [`enum:${SECURITY_KINDS.join('|')}`],
      ran: 'bool',
      at: 'ms?',
      result: `enum:${SECURITY_RESULTS.join('|')}?`,
      findings: 'count?',
      blockers: 'count?',
    },
  ],
  // Version 6: each intent a claim says its story carries out, and that story's open pull request.
  intents: [{ id: 'count', story: 'id', pull: 'count?', draft: 'bool?' }],
  // Version 6: the team's claims: who holds each story, since when, what it leases, when it was last
  // renewed (claimed again, its lease grown, its branch pushed) and whether it's stale. No lease renews
  // on a schedule.
  claims: [{ story: 'id', by: 'handle', at: 'ms', active: 'ms?', stale: 'bool', lease: ['path'] }],
  rules: {
    // `label`, added in version 5: the layer's deliverable kind ("Data", "Service").
    layers: [{ name: 'name', mayImport: ['name'], label: 'name?' }],
    protected: [{ glob: 'path', approval: 'name' }],
    delegated: { protected: ['name'], dependencies: 'bool', merge: 'bool' },
    designGate: 'bool',
    // Version 5: each lane, its deliverable kind, the layers its paths fall in, and what it owns.
    lanes: [{ name: 'name', label: 'name', layers: ['name'], paths: ['path'], exclude: ['path'] }],
    // Version 5: whether the project has the security reviewer, the kinds of change it reviews, and
    // the security requirements a story citing gets it for.
    security: {
      reviewer: 'bool',
      kinds: [`enum:${SECURITY_KINDS.join('|')}`],
      requirements: ['id'],
    },
  },
  // Version 5: the design register's entries, by screen, the code file, the design story, when it was
  // approved, the tool it was drawn in, its state and its states' names.
  designs: [
    {
      screen: 'name',
      file: 'path',
      story: 'id?',
      approved: 'date?',
      tool: 'name?',
      state: `enum:${DESIGN_STATES.join('|')}`,
      states: ['name'],
    },
  ],
  // Version 5: the sessions at work on this machine: the lead or a working one, its person's GitHub
  // login, the code-kit and model it runs, when it started, and the file it last edited, and when.
  sessions: [
    {
      id: 'name',
      role: 'enum:lead|working',
      person: 'handle?',
      codeKit: 'name?',
      model: 'name?',
      started: 'ms',
      editing: 'path?',
      editedAt: 'ms?',
    },
  ],
  // Spec 22: each standard that applies, by id and title, how it's applied and where it came from;
  // its why in one line at most, and its evidence only as counts.
  standards: [
    {
      id: 'id',
      title: 'title',
      category: `enum:${Object.values(CATEGORIES).join('|')}`,
      level: `enum:${LEVELS.join('|')}`,
      applied: `enum:${APPLIED.join('|')}`,
      layers: ['name'],
      source: `enum:${SOURCES.join('|')}`,
      evidenceCount: 'count?',
      evidenceOf: 'count?',
      origin: `enum:${ORIGINS.join('|')}`,
      why: 'line?',
    },
  ],
};

/**
 * Parts a report from an older code-kit doesn't have yet: valid when missing, checked when there. Each
 * is a dotted path into the allow-list, `[]` for a list's items; a leaf that may be missing ends in `?`.
 */
export const LATER_PARTS = [
  'standards',
  'slices',
  'specs',
  'designs',
  'sessions',
  'rules.lanes',
  'rules.security',
  'securityReviews',
  'intents',
  'claims',
];

export const SUMMARY_MAX = 600;

/**
 * A story's summary as a report holds it: on one line, and when longer than 600 characters, cut after
 * the last sentence that fits (or, with no sentence ending in reach, at the last word, with an ellipsis).
 */
export function reportedSummary(text) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length <= SUMMARY_MAX) return s;
  const head = s.slice(0, SUMMARY_MAX + 1);
  const ends = [...head.matchAll(/[.!?](?=\s)/g)].map((m) => m.index + 1);
  if (ends.length) return s.slice(0, ends.at(-1));
  const word = s.slice(0, SUMMARY_MAX).lastIndexOf(' ');
  return `${s.slice(0, word > 0 ? word : SUMMARY_MAX - 1).trimEnd()}…`;
}

const ONE_LINE = (max) => (v) => typeof v === 'string' && v.length <= max && !/[\r\n]/.test(v);
const KINDS = {
  id: (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(v),
  handle: (v) => typeof v === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v),
  name: ONE_LINE(120),
  title: ONE_LINE(200),
  line: ONE_LINE(200),
  summary: ONE_LINE(SUMMARY_MAX),
  path: ONE_LINE(300),
  ms: (v) => Number.isInteger(v) && v > 0,
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  count: (v) => Number.isInteger(v) && v >= 0,
  bool: (v) => typeof v === 'boolean',
};

/** What's wrong with a snapshot against the allow-list, as `path: problem` lines; empty when valid. */
export function snapshotProblems(value, shape = SNAPSHOT_SCHEMA, at = 'snapshot') {
  const later = (k) =>
    LATER_PARTS.includes(`${at}.${k}`.replace(/^snapshot\./, '').replace(/\[\d+\]/g, '[]'));
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
    ...Object.entries(shape)
      .filter(([k]) => !(later(k) && !(k in value)))
      .flatMap(([k, s]) => snapshotProblems(value[k], s, `${at}.${k}`)),
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
  'slices',
  'stories',
  'sendBacks',
  'requirements',
  'specs',
  'approvals',
  'rules',
  'standards',
  'designs',
  'securityReviews',
  'intents',
];

/** The deliverable kinds a layer's or lane's name gives, when the config gives it no `label`. */
const KINDS_BY_NAME = [
  [/^(schemas?|contracts?|api|types|openapi|graphql|protos?)$/, 'API contract'],
  [/^(web|mobile|ui|app|apps|screens?|frontend|client|pages|views?)$/, 'Screens'],
  [/^(data|db|database|migrations?|storage|sql)$/, 'Data'],
  [/^(domain|core|services?|backend|server|workers?|functions|logic|ai|jobs)$/, 'Service'],
  [/^(tests?|qa|e2e|quality)$/, 'Tests'],
  [/^(design|designs|ux)$/, 'Design'],
  [/^(infra|infrastructure|platform|ops|devops|deploy|ci)$/, 'Infrastructure'],
  [/^(docs?|documentation|runbooks?)$/, 'Docs'],
];

/**
 * A layer's or lane's deliverable kind: its `label`, or else what its name gives ("schemas" →
 * "API contract", "web" → "Screens"), or else its name, capitalised, its hyphens as spaces.
 */
export function deliverableKind(name, label = null) {
  if (typeof label === 'string' && label.trim()) return label.trim().slice(0, 120);
  const n = String(name ?? '').toLowerCase();
  const found = KINDS_BY_NAME.find(([re]) => re.test(n))?.[1];
  if (found) return found;
  const words = String(name ?? '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 120) || 'Code';
}

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
      const model = KINDS.name(e.model) && e.model ? e.model : null;
      const key = `${story}|${e.kind}|${model}`;
      const was = sums.get(key) ?? { story, kind: e.kind, model, input: 0, output: 0, cache: 0 };
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

/**
 * The snapshot (HUBR-2) from what code-kit already computed: `status` is buildStatus's, `base` the
 * branch stories merge into, `claims` and `pulls` the team's claims and open pull requests as last
 * read, `version` code-kit's.
 */
export function buildSnapshot({
  root,
  config,
  status,
  base,
  claims = [],
  pulls = [],
  version,
  now = Date.now(),
}) {
  const times = new Map(storyTimes(root, status.stories, base).map((t) => [t.id, t]));
  const inQueue = waiting(readQueue(root));
  const queued = new Map(inQueue.map((e) => [e.branch, Date.parse(e.passed)]));
  const place = new Map(inQueue.map((e, i) => [e.branch, i + 1]));
  // Each story's spec-check report, on its branch: the requirements' statuses, and the story's worst.
  const rowsOf = new Map(
    status.stories
      .filter((s) => s.branchExists)
      .map((s) => [s.id, checkedRows(root, s).filter((r) => CHECKS.includes(r.status))]),
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
      summary: reportedSummary(s.summary),
      check: worstCheck(rowsOf.get(s.id) ?? []),
      queuePosition: place.get(s.branch) ?? null,
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
  for (const rows of rowsOf.values())
    for (const row of rows) checks.set(row.requirement, row.status);
  const requirements = trail(root, status, base).map((r) => ({
    id: r.id,
    title: line(r.title),
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
    const who = approverOf(e);
    const story = KINDS.name(e.branch) ? storyOfBranch(e.branch) : null;
    approvals.push({
      what: e.approval,
      path: KINDS.path(e.file) ? e.file : null,
      who,
      at,
      branch: KINDS.name(e.branch) ? e.branch : null,
      approver: who === 'person' && KINDS.handle(e.approver) ? e.approver : null,
      story: KINDS.id(story) ? story : null,
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
    slices: slicesOf(status.stories).map((sl) => ({ ...sl, name: line(sl.name).slice(0, 120) })),
    stories,
    sendBacks: sendBackList,
    requirements,
    specs: reportedSpecs(root, config, line),
    approvals,
    usage: recordedUsage(root),
    rules: {
      layers: (config.layers ?? []).map((l) => ({
        name: l.name,
        mayImport: l.mayImport ?? [],
        label: deliverableKind(l.name, l.label),
      })),
      protected: (config.protected ?? [])
        .filter((p) => KINDS.path(p.glob) && KINDS.name(p.approval))
        .map((p) => ({ glob: p.glob, approval: p.approval })),
      delegated: {
        protected: delegate?.protected ?? [],
        dependencies: Boolean(delegate?.dependencies),
        merge: Boolean(delegate?.merge),
      },
      designGate: Boolean(config.designGate),
      lanes: Object.entries(config.lanes ?? {}).map(([name, lane]) => ({
        name,
        label: deliverableKind(name, lane.label),
        layers: laneLayers(lane, config),
        paths: (lane.paths ?? []).filter((p) => KINDS.path(p)),
        exclude: (lane.exclude ?? []).filter((p) => KINDS.path(p)),
      })),
      security: securityRules(root, config),
    },
    standards: reportedStandards(root, config, line),
    designs: reportedDesigns(root, config),
    sessions: reportedSessions(root, now),
    securityReviews: reportedSecurityReviews(root, config, status, base),
    intents: reportedIntents(claims, pulls),
    claims: reportedClaims(claims),
  };
  return snapshot;
}

/**
 * Version 6: each story that needs the security review on its branch now (security.mjs, for a branch
 * still at work), or whose security reviewer ran (the event log's record of its findings).
 */
function reportedSecurityReviews(root, config, status, base) {
  const ran = securityReviews(root);
  const out = [];
  for (const s of status.stories) {
    if (!KINDS.id(s.id)) continue;
    const review = ran.get(s.id) ?? null;
    let need = null;
    if (s.branchExists && s.state !== 'done')
      try {
        need = securityReview(root, { base, branch: s.branch, config });
      } catch {
        // the branch can't be compared with the base: whether it needs the review isn't known
      }
    if (!review && !need?.needed) continue;
    const counted = review && !review.unread;
    const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
    out.push({
      story: s.id,
      branch: KINDS.name(s.branch) ? s.branch : null,
      needed: need ? need.needed : null,
      reasons: need
        ? [...new Set(need.reasons.map((r) => r.kind))].filter((k) => SECURITY_KINDS.includes(k))
        : [],
      ran: Boolean(review),
      at: review ? msOf(review.at) : null,
      result: !review ? null : review.unread ? 'unread' : review.findings ? 'findings' : 'pass',
      findings: counted ? count(review.findings) : null,
      blockers: counted ? count(review.blockers) : null,
    });
  }
  return out;
}

const msOf = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isInteger(t) && t > 0 ? t : null;
};

/**
 * Version 6: each intent a claim names (`code-kit team claim <story> --intent <n>`), with its story and
 * that story's open pull request, by its branch, draft or not; none while it has no pull request open.
 */
function reportedIntents(claims, pulls) {
  return claims
    .filter((c) => Number.isInteger(c?.intent) && c.intent > 0 && KINDS.id(c.story))
    .map((c) => {
      const pr = pulls.find((p) => storyOfBranch(p?.branch) === c.story);
      return {
        id: c.intent,
        story: c.story,
        pull: Number.isInteger(pr?.number) && pr.number > 0 ? pr.number : null,
        draft: pr ? Boolean(pr.draft) : null,
      };
    });
}

/**
 * Version 6: the team's claims as the provider last gave them: when each was taken, when it was last
 * renewed by work (`active`: claimed again, its lease grown or its branch pushed) and whether that's
 * longer ago than the team's stale days. A claim never renews on a schedule.
 */
function reportedClaims(claims) {
  return claims
    .filter((c) => KINDS.id(c?.story) && isHandle(c.by) && msOf(c.at))
    .map((c) => ({
      story: c.story,
      by: c.by,
      at: msOf(c.at),
      active: msOf(c.active),
      stale: c.stale === true,
      lease: (Array.isArray(c.lease) ? c.lease : []).filter((p) => KINDS.path(p)),
    }));
}

/** A story's spec-check result: its report's worst status (conflicts, missing, partial), `none` without one. */
function worstCheck(rows) {
  if (!rows.length) return 'none';
  return [...CHECKS].reverse().find((c) => rows.some((r) => r.status === c));
}

/** Each spec as a report holds it: its id, file, title, outcome line and requirements' ids. */
function reportedSpecs(root, config, line) {
  const { specs, plan } = config.docs ?? {};
  if (!specs) return [];
  return readSpecs(root, specs, plan)
    .filter((sp) => KINDS.name(sp.id) && KINDS.path(sp.file))
    .map((sp) => ({
      id: sp.id,
      file: sp.file,
      title: line(sp.title),
      outcome: reportedSummary(sp.outcome),
      requirements: sp.requirements,
    }));
}

/**
 * The design register's entries (spec 24): handed over (its files there, as approved), only in a design
 * tool, or with problems (a file missing or changed, a state the spec lists without a design).
 */
function reportedDesigns(root, config) {
  const { entries } = readRegister(root, config);
  const one = (v, max = 120) =>
    typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null;
  return entries
    .filter((e) => e && KINDS.path(e.file))
    .map((e) => {
      const approved = String(e.approved ?? '').slice(0, 10);
      return {
        screen: one(e.screen) ?? e.file.slice(0, 120),
        file: e.file,
        story: KINDS.id(e.story) ? e.story : null,
        approved: KINDS.date(approved) ? approved : null,
        tool: one(toolOf(e, null)),
        state: !handedOver(e)
          ? 'in-tool'
          : entryProblems(root, e, config.docs?.specs).length
            ? 'problems'
            : 'handed-over',
        states: (handedOver(e) ? e.states : []).map((st) => one(st?.name)).filter(Boolean),
      };
    });
}

/**
 * The sessions at work on this machine's checkout (SESS-1): what code-kit recorded as each started and
 * acted. A session that has ended, or gone quiet past SESSION_LIVE_MS, isn't at work.
 */
function reportedSessions(root, now) {
  const ms = (iso) => {
    const t = Date.parse(iso ?? '');
    return Number.isInteger(t) && t > 0 ? t : null;
  };
  return sessions(root, now)
    .filter((s) => s.live && KINDS.name(s.id) && ms(s.started))
    .map((s) => {
      const editing = s.editing && KINDS.path(s.editing.path) ? s.editing : null;
      return {
        id: s.id,
        role: s.role === 'lead' ? 'lead' : 'working',
        person: KINDS.handle(s.login) ? s.login : null,
        codeKit: KINDS.name(s.codeKit) ? s.codeKit : null,
        model: KINDS.name(s.model) ? s.model : null,
        started: ms(s.started),
        editing: editing?.path ?? null,
        editedAt: editing ? ms(editing.at) : null,
      };
    });
}

/**
 * Spec 22: the standards that apply, as a report holds them. One that the file can't make sense of (an
 * unknown category, no level) is left out: `code-kit standards` tells the project what's wrong with it.
 */
function reportedStandards(root, config, line) {
  let all = [];
  try {
    all = projectStandards(root, config).standards;
  } catch {
    return [];
  }
  return all
    .filter(
      (s) =>
        KINDS.id(s.id) &&
        CATEGORIES[s.id.split('-')[0]] &&
        LEVELS.includes(s.level) &&
        APPLIED.includes(s.applied) &&
        KINDS.title(line(s.title) ?? ''),
    )
    .map((s) => {
      const source = s.origin === 'inherited' ? { kind: 'organisation' } : sourceOf(s.source);
      return {
        id: s.id,
        title: line(s.title),
        category: CATEGORIES[s.id.split('-')[0]],
        level: s.level,
        applied: s.applied,
        layers: (s.layers ?? []).filter((l) => KINDS.name(l)),
        source: source.kind,
        evidenceCount: source.count ?? null,
        evidenceOf: source.of ?? null,
        origin: ORIGINS.includes(s.origin) ? s.origin : 'own',
        why: line(s.why),
      };
    });
}
