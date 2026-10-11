// The journal (docs/specs/15-decisions-and-journal.md, JOURNAL-1): the build's lineage in plain
// sentences, oldest first: what the person asked for, the decisions that shaped it, the specification,
// the rules being switched on, each story handed out, sent back and merged, each approval and who gave
// it, and each milestone finished. Read from git and the project's own records, so it's the same for
// every session and survives a restart.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVAL_LOG } from './rules.mjs';
import { sendBacks } from './reviews.mjs';
import { storyTimes } from './timeline.mjs';

const gitIn =
  (root) =>
  (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      }).trim();
    } catch {
      return '';
    }
  };

/** When a file was first committed, in ms, or null. */
const addedAt = (git, file) => {
  const t = git('log', '--diff-filter=A', '--format=%ct', '--', file)
    .split('\n')
    .filter(Boolean)
    .at(-1);
  return t ? Number(t) * 1000 : null;
};

/** The brief's title and its problem, in a sentence or two: what the person asked for. */
export function briefRequest(text) {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const section = (name) => {
    const m = text.match(
      new RegExp(`^##\\s+${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'm'),
    );
    return m ? m[1].trim() : '';
  };
  const firstParagraph = (s) =>
    s
      .split(/\n\s*\n/)[0]
      .replace(/\s+/g, ' ')
      .trim();
  const problem = firstParagraph(section('Problem')) || firstParagraph(section('Outcome'));
  return { title, problem: problem || null };
}

/** The brief's decision log: [{ date, decision, why }], from its `## Decision log` table. */
export function briefDecisions(text) {
  const m = text.match(/^##\s+Decision log\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  if (!m) return [];
  return m[1]
    .split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*Date\s*\|/i.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map((c) => ({ date: c[1], decision: c[2], why: c[3] ?? '' }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.decision);
}

/** Who gave an approval, from the reason its log entry carries: the person, or the lead within limits. */
export function approverOf(entry) {
  const reason = String(entry.reason ?? '');
  if (/approved by the lead within the delegated rules/.test(reason)) return 'lead';
  if (entry.approval === 'lead') return 'lead';
  return 'person';
}

/** The words an approval's name stands for: "dep-pdfjs-dist" → "adding the package pdfjs-dist". */
export function approvalWords(name) {
  if (name.startsWith('dep-')) return `adding the package ${name.slice(4)}`;
  if (name === 'dependency') return 'adding a new package';
  if (name === 'kit') return "a change to code-kit's own rules or agents";
  if (name === 'merge') return 'a merge';
  return `a change to the protected ${name.replace(/-/g, ' ')}`;
}

/** The person's own words, without the note the hooks add about how it was given. */
const ownWords = (reason) =>
  String(reason ?? '')
    .replace(
      /\s*\((given in chat, recorded by the lead|approved in the [\w ]+ pane|approved by the lead within the delegated rules[^)]*)\)\s*$/,
      '',
    )
    .trim();

/**
 * JOURNAL-1: the events, oldest first: [{ at, kind, text, story? }]. Kinds: request, decision, spec,
 * setup, dispatch, sentBack, merge, approval, milestone. `status` is buildStatus's; `base` the branch
 * stories merge into; `docs` the config's docs (brief beside the specs).
 */
export function journal(root, status, base, docs = {}) {
  const git = gitIn(root);
  const events = [];
  const at = (iso) => (iso ? Date.parse(`${iso}T12:00:00Z`) : null);
  // What the person asked for, and the decisions the brief records.
  const briefPath = ['docs/brief.md', docs.specs ? join(docs.specs, '..', 'brief.md') : null]
    .filter(Boolean)
    .find((p) => existsSync(join(root, p)));
  if (briefPath) {
    const text = readFileSync(join(root, briefPath), 'utf8');
    const { title, problem } = briefRequest(text);
    const when = addedAt(git, briefPath);
    if (title || problem)
      events.push({
        at: when,
        kind: 'request',
        text: `You asked for ${title ? `“${title}”` : 'a build'}${problem ? `: ${problem}` : ''}`,
      });
    // The decisions were made while the brief was written: they follow the request, in the log's order.
    briefDecisions(text).forEach((d, n) =>
      events.push({
        at: (when ?? at(d.date)) + n + 1,
        kind: 'decision',
        text: `Decided: ${d.decision}${d.why ? `, because ${d.why.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}` : ''}.`,
      }),
    );
  }
  // The specification and the plan.
  const reqs = status.requirements.filter((r) => !r.removed).length;
  const milestones = [...new Set(status.stories.map((s) => s.milestone).filter(Boolean))];
  if (docs.plan && status.stories.length)
    events.push({
      at: addedAt(git, docs.plan),
      kind: 'spec',
      text: `The specification was written: ${reqs} requirement${reqs === 1 ? '' : 's'}, split into ${status.stories.length} stor${status.stories.length === 1 ? 'y' : 'ies'}${milestones.length ? ` across ${milestones.length} milestone${milestones.length === 1 ? '' : 's'}` : ''}.`,
    });
  const switchedOn = addedAt(git, '.claude/code-kit.json');
  if (switchedOn)
    events.push({
      at: switchedOn,
      kind: 'setup',
      text: "code-kit's rules were switched on, as you approved them.",
    });
  // Each story: handed out, sent back, merged.
  const times = storyTimes(root, status.stories, base);
  const byId = new Map(status.stories.map((s) => [s.id, s]));
  const backs = sendBacks(root);
  for (const t of times) {
    const s = byId.get(t.id);
    const name = `${t.id} ${s?.title ?? ''}`.trim();
    const reqText = s?.requirements?.length ? ` (${s.requirements.join(', ')})` : '';
    if (t.started)
      events.push({
        at: t.started,
        kind: 'dispatch',
        story: t.id,
        text:
          t.lane === 'lead'
            ? `The lead started ${name}${reqText} itself.`
            : `${name}${reqText} was handed to the ${t.lane} lane.`,
      });
    for (const b of backs.filter((x) => x.branch === t.branch))
      events.push({
        at: Date.parse(b.at),
        kind: 'sentBack',
        story: t.id,
        text:
          t.lane === 'lead'
            ? `${t.id} needed more work from the lead${b.reason ? `: ${b.reason}` : '.'}`
            : `The lead sent ${t.id} back to the ${t.lane} lane${b.reason ? `: ${b.reason}` : '.'}`,
      });
    if (t.merged)
      events.push({
        at: t.merged,
        kind: 'merge',
        story: t.id,
        text: `${name} was merged into ${base}.`,
      });
  }
  // Approvals on the base, once each (one approval can log several files), and who gave them.
  const seen = new Set();
  for (const line of git('show', `${base}:${APPROVAL_LOG}`).split('\n').filter(Boolean)) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.approval || e.approval === 'lead') continue;
    const key = `${e.approval}|${e.grantedAt ?? e.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const who = approverOf(e);
    const words = ownWords(e.reason);
    events.push({
      at: Date.parse(e.grantedAt ?? e.at),
      kind: 'approval',
      who,
      text:
        who === 'lead'
          ? `The lead approved ${approvalWords(e.approval)}, within the limits you set${words ? `: ${words}` : '.'}`
          : `You approved ${approvalWords(e.approval)}${words ? `: “${words}”` : '.'}`,
    });
  }
  // Milestones finished: when the last of their stories merged.
  for (const m of milestones) {
    const mine = status.stories.filter((s) => s.milestone === m);
    if (!mine.every((s) => s.state === 'done')) continue;
    const last = Math.max(...mine.map((s) => times.find((t) => t.id === s.id)?.merged ?? 0));
    if (last)
      events.push({
        at: last + 1,
        kind: 'milestone',
        text: `${m} was finished: all ${mine.length} of its stories merged.`,
      });
  }
  // The request, its decisions, the spec and the switch-on come first, whatever the commits' times: work
  // can start on a branch before the brief that asked for it is committed.
  const ORDER = ['request', 'decision', 'spec', 'setup'];
  const opening = events.filter((e) => ORDER.includes(e.kind));
  const rest = events.filter((e) => !ORDER.includes(e.kind) && e.at);
  const firstWork = rest.length ? Math.min(...rest.map((e) => e.at)) : Infinity;
  const opened = opening
    .filter((e) => e.at)
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.at - b.at)
    .map((e, n, all) => ({ ...e, at: Math.min(e.at, firstWork - (all.length - n)) }));
  return [...opened, ...rest.sort((a, b) => a.at - b.at)];
}
