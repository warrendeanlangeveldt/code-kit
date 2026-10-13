// Bug reports for code-kit itself (docs/specs/15-decisions-and-journal.md, REPORT-1 to REPORT-3). With
// `harness.report.on`, an agent that code-kit got in the way of (a refusal that's wrong, a crash, a pane
// showing the wrong thing) drafts a report. The draft carries code-kit's own facts only (its version, the
// rule, the refusal, the command, what was expected), with the project's paths, home folder and email
// addresses taken out, and waits for the person: they read the exact text and send it, or discard it.
// Sending files a GitHub issue on code-kit's repository through their own `gh`, or, without it, gives
// them the new-issue link to open; a report someone already filed gets a comment instead of a second issue.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectWorktrees } from './rules.mjs';

export const REPORTS_FILE = '.claude/state/reports.jsonl';
const PLUGIN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../.claude-plugin/plugin.json', import.meta.url)), 'utf8'),
);
/** code-kit's own repository, where reports go: `owner/name`. */
export const REPO = PLUGIN.repository.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

const fileOf = (root) => join(projectWorktrees(root)[0] ?? root, REPORTS_FILE);

function records(root) {
  try {
    return readFileSync(fileOf(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const append = (root, record) => {
  const file = fileOf(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
};

/**
 * REPORT-2: text as it may leave the machine: the project's folders, the home folder and email
 * addresses replaced, and cut to `max` characters.
 */
export function scrub(text, roots = [], max = 1500) {
  let out = String(text ?? '');
  const home = homedir();
  for (const r of [...roots].filter(Boolean).sort((a, b) => b.length - a.length))
    out = out.split(r).join('<project>');
  if (home) out = out.split(home).join('~');
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** REPORT-3: what makes two reports the same bug: the title's words and the rule, as a short hash. */
export const fingerprint = (title, rule) =>
  `ck-${createHash('sha1')
    .update(
      `${String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()}|${rule ?? ''}`,
    )
    .digest('hex')
    .slice(0, 8)}`;

/** The issue's body, as the person will read it before it's sent. */
function bodyOf(r) {
  return [
    `**What happened:** ${r.what}`,
    ...(r.expected ? [`**Expected:** ${r.expected}`] : []),
    ...(r.command ? ['**Command or call:**', '```', r.command, '```'] : []),
    ...(r.refusal ? ['**What code-kit said:**', '```', r.refusal, '```'] : []),
    ...(r.rule ? [`**Rule:** ${r.rule}`] : []),
    `**code-kit:** ${r.version} · Node ${r.node} · ${r.os}`,
    '',
    `<sub>Drafted by a code-kit agent, read and sent by a person. Fingerprint: ${r.fingerprint}</sub>`,
  ].join('\n');
}

/**
 * Every report, oldest first: { id, at, by, title, body, fingerprint, state: 'draft' | 'sent' | 'discarded',
 * sent: { at, url, comment } | null }.
 */
export function readReports(root) {
  const byId = new Map();
  for (const r of records(root)) {
    if (r.kind === 'draft') byId.set(r.id, { ...r, state: 'draft', sent: null });
    const d = byId.get(r.id);
    if (!d || d.state !== 'draft') continue;
    if (r.kind === 'sent')
      Object.assign(d, {
        state: 'sent',
        sent: { at: r.at, url: r.url, comment: Boolean(r.comment) },
      });
    if (r.kind === 'discarded') d.state = 'discarded';
  }
  return [...byId.values()].map(({ kind, ...r }) => r);
}

export const draftReports = (root) => readReports(root).filter((r) => r.state === 'draft');

/**
 * REPORT-1: a draft from an agent: { title, what, expected, command, refusal, rule }. The same bug still
 * waiting as a draft is drafted once.
 */
export function draftReport(root, input, { by = 'lead', now = Date.now() } = {}) {
  // Each checkout as written and as the system resolves it (/var and /private/var on macOS).
  const roots = [
    ...new Set(
      [...projectWorktrees(root), root].flatMap((r) => {
        let real = r;
        try {
          real = realpathSync(r);
        } catch {
          // gone: as written
        }
        return [r, real, real.replace(/^\/private(?=\/)/, '')];
      }),
    ),
  ];
  const clean = (v, max) => (v ? scrub(v, roots, max) : null);
  const title = clean(input.title, 120);
  if (!title?.trim())
    return { ok: false, why: 'Give the report a title: what went wrong, in a few words.' };
  if (!input.what?.trim()) return { ok: false, why: 'Say what happened, with --what "…".' };
  const fp = fingerprint(title, input.rule);
  const existing = draftReports(root).find((r) => r.fingerprint === fp);
  if (existing) return { ok: true, report: existing, existed: true };
  const r = {
    title: title.trim(),
    what: clean(input.what, 1500),
    expected: clean(input.expected, 600),
    command: clean(input.command, 600),
    refusal: clean(input.refusal, 1500),
    rule: clean(input.rule, 120),
    version: PLUGIN.version,
    node: process.version,
    os: `${platform()} ${release()}`,
    fingerprint: fp,
  };
  const record = {
    kind: 'draft',
    id: `R-${readReports(root).length + 1}`,
    at: new Date(now).toISOString(),
    by,
    title: r.title,
    fingerprint: fp,
    body: bodyOf(r),
  };
  append(root, record);
  return { ok: true, report: readReports(root).find((x) => x.id === record.id), existed: false };
}

/** The new-issue link, for someone without `gh`: the draft filled in, for them to submit. */
export const issueLink = (r) =>
  `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(r.title)}&body=${encodeURIComponent(r.body)}`;

const gh = (args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  }).trim();

/**
 * REPORT-3: the person sends a draft: a comment on the open issue with its fingerprint, if someone filed
 * it already, otherwise a new issue; without a working `gh`, nothing is sent and the link is returned.
 */
export function sendReport(root, id, now = Date.now()) {
  const r = readReports(root).find((x) => x.id === id);
  if (!r) return { ok: false, why: `There's no report ${id}.` };
  if (r.state !== 'draft') return { ok: false, why: `${id} was ${r.state} already.` };
  let url;
  let comment = false;
  try {
    gh(['auth', 'status']);
  } catch {
    return {
      ok: false,
      link: issueLink(r),
      why: "gh isn't installed or signed in, so nothing was sent.",
    };
  }
  try {
    const found = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        REPO,
        '--state',
        'open',
        '--search',
        `${r.fingerprint} in:body`,
        '--json',
        'number,url',
        '--limit',
        '1',
      ]) || '[]',
    );
    if (found.length) {
      gh([
        'issue',
        'comment',
        String(found[0].number),
        '--repo',
        REPO,
        '--body',
        `Seen again, on code-kit ${PLUGIN.version}.\n\n${r.body}`,
      ]);
      url = found[0].url;
      comment = true;
    } else
      url = gh(['issue', 'create', '--repo', REPO, '--title', r.title, '--body', r.body])
        .split('\n')
        .at(-1);
  } catch (err) {
    return {
      ok: false,
      link: issueLink(r),
      why: `GitHub didn't take it (${
        String(err.stderr || err.message)
          .trim()
          .split('\n')[0]
      }).`,
    };
  }
  append(root, { kind: 'sent', id, at: new Date(now).toISOString(), url, comment });
  return { ok: true, url, comment };
}

export function discardReport(root, id, now = Date.now()) {
  const r = readReports(root).find((x) => x.id === id);
  if (!r) return { ok: false, why: `There's no report ${id}.` };
  if (r.state !== 'draft') return { ok: false, why: `${id} was ${r.state} already.` };
  append(root, { kind: 'discarded', id, at: new Date(now).toISOString() });
  return { ok: true };
}
