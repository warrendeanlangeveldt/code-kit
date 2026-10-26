// When each story's work happened (docs/specs/11-panes.md, VIEW-2), from git and the project's own
// records: when its branch was made, its commits, its merge into the base, its send-backs and the
// approvals its commits logged. The mod draws these as a bar per lane on a shared time axis.
import { execFileSync } from 'node:child_process';
import { branchMaking } from './plan.mjs';
import { APPROVAL_LOG } from './rules.mjs';
import { sendBacks } from './reviews.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each object asked for, read by one `git cat-file --batch`: { name: text }, a missing one left out.
 * One process for every branch's approval log, where a `git show` each outlasts the mod's 30 seconds.
 */
export function readObjects(root, names) {
  if (!names.length) return {};
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: `${names.join('\n')}\n`,
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return {};
  }
  const found = {};
  let at = 0;
  for (const name of names) {
    const eol = out.indexOf(10, at);
    if (eol < 0) break;
    const header = out.subarray(at, eol).toString('utf8').split(' ');
    at = eol + 1;
    if (header[1] === 'missing' || header.length < 3) continue;
    const size = Number(header[2]);
    found[name] = out.subarray(at, at + size).toString('utf8');
    at += size + 1;
  }
  return found;
}

/**
 * For each story with a branch, or done: { id, lane, branch, state, started, lastCommit, merged,
 * sentBack: [ms], approvals: [{ at, names }] }, times in milliseconds or null.
 */
export function storyTimes(root, stories, base) {
  const git = (...args) => {
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
  const lines = (text) => text.split('\n').filter(Boolean);
  const merges = lines(git('log', '--merges', '--format=%ct%x09%s', base)).map((l) => {
    const [t, ...subject] = l.split('\t');
    return { at: Number(t) * 1000, subject: subject.join('\t') };
  });
  const backs = sendBacks(root);
  const onBase = new Set(lines(git('show', `${base}:${APPROVAL_LOG}`)));
  const shown = stories.filter((s) => s.branchExists || s.state === 'done');
  const refOf = (s) => s.ref ?? `refs/heads/${s.branch}`;
  const logs = readObjects(
    root,
    shown.filter((s) => s.branchExists).map((s) => `${refOf(s)}:${APPROVAL_LOG}`),
  );
  const making = branchMaking(root);
  return shown.map((s) => {
    const b = s.branch;
    // A branch only on origin has no reflog here.
    const local = s.branchExists && refOf(s).startsWith('refs/heads/');
    const made = local ? (making(b)?.at ?? null) : null;
    // Only a branch ahead of the base has commits of its own.
    const commits =
      s.branchExists && s.ahead !== 0
        ? lines(git('log', '--format=%ct', `${base}..${refOf(s)}`)).map((t) => Number(t) * 1000)
        : [];
    const named = new RegExp(`(^|[\\s'"])${escape(b)}($|[\\s'"])`);
    const merged = merges.find((m) => named.test(m.subject))?.at ?? null;
    const approvals = s.branchExists
      ? lines(logs[`${refOf(s)}:${APPROVAL_LOG}`] ?? '')
          .filter((l) => !onBase.has(l))
          .flatMap((l) => {
            try {
              const e = JSON.parse(l);
              return e.grantedAt || e.at
                ? [{ at: Date.parse(e.grantedAt ?? e.at), names: [e.approval].filter(Boolean) }]
                : [];
            } catch {
              return [];
            }
          })
      : [];
    return {
      id: s.id,
      lane: s.lane,
      branch: b,
      state: s.state,
      started: made ? made : commits.length ? Math.min(...commits) : null,
      lastCommit: commits.length ? Math.max(...commits) : null,
      merged,
      sentBack: backs.filter((x) => x.branch === b).map((x) => Date.parse(x.at)),
      approvals,
    };
  });
}
