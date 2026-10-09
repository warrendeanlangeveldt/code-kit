// When each story's work happened (docs/specs/11-panes.md, VIEW-2), from git and the project's own
// records: when its branch was made, its commits, its merge into the base, its send-backs and the
// approvals its commits logged. The mod draws these as a bar per lane on a shared time axis.
import { execFileSync } from 'node:child_process';
import { APPROVAL_LOG } from './rules.mjs';
import { sendBacks } from './reviews.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const logged = (ref) => new Set(lines(git('show', `${ref}:${APPROVAL_LOG}`)));
  const onBase = logged(base);
  return stories
    .filter((s) => s.branchExists || s.state === 'done')
    .map((s) => {
      const b = s.branch;
      // The reflog's oldest entry is the branch's making, when it's still there.
      const made = s.branchExists
        ? lines(git('reflog', 'show', '--format=%ct', `refs/heads/${b}`))
        : [];
      const commits = s.branchExists
        ? lines(git('log', '--format=%ct', `${base}..${b}`)).map((t) => Number(t) * 1000)
        : [];
      const named = new RegExp(`(^|[\\s'"])${escape(b)}($|[\\s'"])`);
      const merged = merges.find((m) => named.test(m.subject))?.at ?? null;
      const approvals = s.branchExists
        ? [...logged(b)]
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
        started: made.length
          ? Number(made.at(-1)) * 1000
          : commits.length
            ? Math.min(...commits)
            : null,
        lastCommit: commits.length ? Math.max(...commits) : null,
        merged,
        sentBack: backs.filter((x) => x.branch === b).map((x) => Date.parse(x.at)),
        approvals,
      };
    });
}
