// Teams (docs/specs/16-teams.md), the pure parts: names, story branches, staleness, what an intent
// touches and which drift findings hold a merge (spec 21, HUBR-9). Shared by the hooks and CLI (team.mjs) and the mod, which runs without Node.

/** A GitHub handle: letters, digits and single hyphens, at most 39 characters. */
export const isHandle = (h) =>
  typeof h === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(h);

/** A story id a ref can carry: ST-12, AUTH-3. */
export const isStoryId = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(s);

/** The paths an intent touches, from its issue's body ("Touches: a/**, b"). */
export const touchesOf = (body) =>
  (String(body ?? '').match(/^Touches:\s*(.+)$/m)?.[1] ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);

/** Whole working days (Monday to Friday) from `from` to `to`, both in ms. */
export function workingDaysBetween(from, to) {
  let days = 0;
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days += 1;
  }
  return days;
}

/** TEAM-9: a claim with when it was last worked on (claimed, or its branch pushed) and whether it's stale. */
export function withStaleness(claim, lastPush, staleDays, now = Date.now()) {
  const active = Math.max(Date.parse(claim.at) || 0, lastPush ?? 0);
  return {
    ...claim,
    active: new Date(active).toISOString(),
    stale: workingDaysBetween(active, now) >= staleDays,
  };
}

/** The story a branch is for: web/st-4 → ST-4. Null for any other branch. */
export const storyOfBranch = (branch) => {
  const m = String(branch ?? '').match(/^[a-z][a-z0-9-]*\/([a-z][a-z0-9]*-\d+)$/i);
  return m ? m[1].toUpperCase() : null;
};

/** The lane a story branch is in: web/st-4 → web. */
export const laneOfBranch = (branch) => (storyOfBranch(branch) ? branch.split('/')[0] : null);

/** Whether two path globs can name the same file: one's fixed start begins the other's. */
export function globsOverlap(a, b) {
  const fixed = (g) => g.split(/[*?{]/)[0];
  const [x, y] = [fixed(a), fixed(b)];
  return x.startsWith(y) || y.startsWith(x);
}

/** An intent from its discussion: { id, by, about, touches, at, url, state }. */
export const intentOf = (d) => ({
  id: d.number,
  by: d.author?.login ?? null,
  about: d.title,
  touches: touchesOf(d.body),
  at: d.createdAt,
  url: d.url,
  state: !d.closed
    ? 'open'
    : d.stateReason === 'DUPLICATE'
      ? 'duplicate'
      : d.stateReason === 'OUTDATED'
        ? 'dropped'
        : 'agreed',
});

/**
 * TEAM-6: intents raised and settled since `at` (ms), from their discussions: [{ at, by, kind, text }].
 * A settled one is the tech lead's act; its discussion doesn't say who closed it, so it reads as theirs.
 */
export function discussionActivity(nodes, at, techLead = null) {
  const out = [];
  for (const d of nodes) {
    const name = `#${d.number} ${d.title}`;
    const raised = Date.parse(d.createdAt);
    if (raised > at)
      out.push({
        at: raised,
        by: d.author?.login ?? 'someone',
        kind: 'intended',
        text: `raised intent ${name}`,
      });
    const closed = Date.parse(d.closedAt);
    if (d.closed && closed > at) {
      const state = intentOf(d).state;
      out.push({
        at: closed,
        by: techLead ?? 'the tech lead',
        kind: state === 'agreed' ? 'agreed' : 'dropped',
        text: `${state === 'duplicate' ? 'marked as a duplicate' : state} intent ${name}`,
      });
    }
  }
  return out;
}

/** A title as a file name: "Split the report format" → "split-the-report-format". */
export const slugOf = (title) =>
  String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'decision';

/**
 * TEAM-10: an agreed intent as a decision record, from its discussion's facts only: { title, body, url,
 * author, createdAt, closedAt, comments: [{ author, body }] }. The tech lead's words are their comment
 * agreeing it.
 */
export function decisionRecord(d, techLead) {
  const date = String(d.closedAt ?? d.createdAt).slice(0, 10);
  const touches = touchesOf(d.body);
  const why = String(d.body ?? '')
    .replace(/^Touches:.*$/m, '')
    .replace(/Raised with code-kit by @\S+ before any code[^\n]*/, '')
    .trim();
  // Who settled it: the provider says (a lane owner whose paths it touches may agree it with a hosted
  // provider), or the tech lead, who alone settles intents through GitHub.
  const by = d.settledBy ?? d.settled_by ?? techLead;
  const agreed =
    (d.comments ?? [])
      .filter((c) => c.author?.login === by && /^Agreed by @/.test(c.body))
      .at(-1)
      ?.body.replace(/^Agreed by @[\w-]+(?:, [^:.]*)?(: |\.)?/, '')
      .trim() || (typeof d.why === 'string' ? d.why.trim() : '');
  return [
    `# ${d.title}`,
    '',
    '**Status:** agreed',
    `**Date:** ${date}`,
    `**Raised by:** @${d.author?.login ?? 'someone'} · **Agreed by:** @${by}`,
    `**Discussion:** ${d.url}`,
    '',
    '## What changes, and why',
    '',
    why || '(The intent said no more than its title.)',
    ...(touches.length ? ['', '## What it touches', '', ...touches.map((t) => `- \`${t}\``)] : []),
    ...(agreed ? ['', '## Agreed', '', agreed] : []),
    '',
  ].join('\n');
}

/** A config glob as CODEOWNERS patterns, anchored at the root; `{a,b}` becomes one pattern each. */
export function ownersPatterns(glob) {
  const alt = glob.match(/\{([^{}]*)\}/);
  if (alt) return alt[1].split(',').flatMap((x) => ownersPatterns(glob.replace(alt[0], x)));
  return [glob.startsWith('**') || glob.startsWith('/') ? glob : `/${glob}`];
}

/**
 * TEAM-11: CODEOWNERS from the config: the tech lead for the tech lead's paths, then each owned lane's
 * owners for its paths (later lines win in CODEOWNERS, so lanes come after). `leadPaths` are the
 * project's own lead paths; `lanes` the config's lanes with their owners.
 */
export function codeowners({ techLead, leadPaths, lanes }) {
  const line = (glob, people) =>
    ownersPatterns(glob).map((p) => `${p} ${people.map((h) => `@${h}`).join(' ')}`);
  const out = [
    '# Generated by `code-kit team codeowners --write` from .claude/code-kit.json.',
    '# Change the tech lead or the lanes’ owners there, then generate it again.',
    '',
    '# The tech lead: the plan, specs and contracts.',
    ...leadPaths.filter((p) => p !== '*' && p !== '.claude/**').flatMap((p) => line(p, [techLead])),
  ];
  for (const [name, lane] of Object.entries(lanes)) {
    if (!lane.owners?.length) continue;
    out.push('', `# The ${name} lane.`, ...lane.paths.flatMap((p) => line(p, lane.owners)));
  }
  return `${out.join('\n')}\n`;
}

/** TEAM-12: the board's fields for a story, all text: Lane, Claimed by, Stale and State. */
export const BOARD_FIELDS = ['Lane', 'Claimed by', 'Stale', 'State'];
export const boardValues = (story, claim) => ({
  Lane: story.lane ?? '',
  'Claimed by': claim?.by ?? '',
  Stale: claim?.stale ? 'yes' : '',
  State: story.state ?? '',
});

/** The fields whose value changed since the last sync: [[field, value]]. */
export const boardChanges = (before = {}, now) =>
  BOARD_FIELDS.filter((f) => (before[f] ?? '') !== now[f]).map((f) => [f, now[f]]);

// --- drift holds (spec 21, HUBR-9) ---------------------------------------------------------------------

/**
 * What a team provider's "What blocks a merge" setting may say: a finding against a spec or decision,
 * any finding, or nothing. A provider that says none (GitHub, or an older hosted one) holds nothing.
 */
export const MERGE_HOLDS = ['spec-or-decision', 'any', 'nothing'];

/** What a drift finding is against, from its `conflictsWith`: spec, decision, branch or intent. */
export const findingKind = (f) => String(f?.conflictsWith ?? '').split(/[\s#]/)[0] || null;

/** Whether a finding holds a merge at the provider's level. Its severity doesn't change that. */
export function holdsMerge(finding, level) {
  if (level === 'any') return true;
  if (level === 'spec-or-decision') return ['spec', 'decision'].includes(findingKind(finding));
  return false;
}

/** Whether the team's state came from its provider, not its fallback or a cache it couldn't renew. */
export const providerAnswered = (state) =>
  Boolean(state) && state.reachable !== false && !state.fallback;

/**
 * The open drift findings that hold `branch` in the merge queue, by the provider's state: its level
 * (`mergeHolds`) and its findings. None when the provider didn't answer: code-kit doesn't hold on what
 * it couldn't check (`driftUnchecked` says so).
 */
export function driftHoldsOf(state, branch) {
  if (!providerAnswered(state)) return [];
  const level = MERGE_HOLDS.includes(state.mergeHolds) ? state.mergeHolds : 'nothing';
  if (level === 'nothing') return [];
  return (Array.isArray(state.findings) ? state.findings : []).filter(
    (f) => f && f.branch === branch && !f.resolved && holdsMerge(f, level),
  );
}

/** Each of `branches` the provider's findings hold: Map(branch → findings). */
export function driftHolds(state, branches) {
  const held = new Map();
  for (const b of branches) {
    const found = driftHoldsOf(state, b);
    if (found.length) held.set(b, found);
  }
  return held;
}

const against = (f) =>
  findingKind(f) === 'intent' ? f.conflictsWith : `the ${f.conflictsWith ?? 'work in flight'}`;
const oneLine = (s, max = 200) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Why a branch is held, in words an agent or person can act on: each finding, who decides, and how it
 * clears. `provider` is the team provider's name as its state gives it; `techLead` the team's.
 */
export function driftHoldWords(branch, findings, { techLead = null, provider = null } = {}) {
  const where = provider ?? 'the team provider';
  const each = findings.map(
    (f) =>
      `against ${against(f)}${f.severity ? ` (a ${f.severity})` : ''}: ${oneLine(f.title || f.text)}${f.url ? ` (${f.url})` : ''}`,
  );
  const one = each.length === 1;
  const found = one
    ? `the drift check found it ${each[0]}`
    : `the drift check found it ${each.length} times: ${each.join('; ')}`;
  return `${branch} is held from merging: ${found}. ${techLead ? `The tech lead (${techLead})` : 'The tech lead'} decides: if the work still stands, resolve ${one ? 'the finding' : 'the findings'} on ${where}; otherwise push a fix to ${branch}, and the drift check clears ${one ? 'it' : 'each'} once a push no longer conflicts. It merges as soon as nothing holds it.`;
}

/** When the provider didn't answer, that drift findings weren't checked, in words; null when they were. */
export function driftUnchecked(state) {
  if (providerAnswered(state)) return null;
  const why = oneLine(state?.fallback ?? state?.why ?? "The team provider can't be reached.");
  return `${why.replace(/\.$/, '')}, so drift findings weren't checked: merges don't wait on them until it answers.`;
}
