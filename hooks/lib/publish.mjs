// What the merge queue merged into the local base, put onto the remote's (spec 09, MQ-6). code-kit
// merges each story locally, verified; where the base only moves through pull requests (GitHub's branch
// protection), pushing it is refused, so the merged work goes up as a pull request of its own instead of
// through an integration branch an agent invents. `branches.publish` says which: `push` or `pull-request`.
import { spawnSync } from 'node:child_process';

/** The branch a pull request publishes the base from: code-kit's own, short-lived. */
export const publishBranch = (base) => `code-kit/publish-${base}`;

/** The stories merged into `base` and not yet on the remote's, from the queue's merge commits. */
export function unpublished(root, base) {
  const run = spawnSync(
    'git',
    ['-C', root, 'log', '--first-parent', '--format=%s', `origin/${base}..${base}`],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) return [];
  return run.stdout
    .split('\n')
    .map((s) => s.match(/^Merge (\S+) into /)?.[1])
    .filter(Boolean)
    .reverse();
}

/** A pull request's title for the branches it publishes. */
export function publishTitle(branches, count) {
  const stories = branches.map((b) => b.split('/').at(-1).toUpperCase());
  if (!stories.length) return `${count} commit${count === 1 ? '' : 's'} from code-kit`;
  if (stories.length === 1) return `${stories[0]} from the code-kit queue`;
  if (stories.length <= 3)
    return `${stories.slice(0, -1).join(', ')} and ${stories.at(-1)} from the code-kit queue`;
  return `${stories.slice(0, 2).join(', ')} and ${stories.length - 2} more from the code-kit queue`;
}

/**
 * Puts the local `base`'s merges onto `origin`. `mode` is `push` or `pull-request`; `mayMove` is whether
 * the caller may move the remote's base (the person, or the lead with `approvals.delegate.push`): without
 * it a push isn't made and a pull request is opened but left for the person. `run(cmd, args)` runs git
 * and gh (spawnSync by default, so tests can stand in for GitHub). Returns { state, message, url? }:
 * `current` (nothing to publish), `pushed`, `merged`, `waiting` (for the person, or for GitHub) or
 * `failed`. It never force-pushes, and never moves the local base except to fast-forward it.
 */
export function publishBase(root, base, { mode, mayMove, run = defaultRun }) {
  const git = (...a) => run('git', ['-C', root, ...a]);
  const gh = (...a) => run('gh', a);
  const first = (r) =>
    String(r.stderr || r.stdout || '')
      .trim()
      .split('\n')[0];
  if (git('remote', 'get-url', 'origin').status !== 0)
    return { state: 'failed', message: `There's no remote named origin to publish ${base} to.` };
  git('fetch', '--quiet', 'origin', base);
  const remote = `origin/${base}`;
  if (git('rev-parse', '--verify', '--quiet', remote).status !== 0)
    return {
      state: 'failed',
      message: `origin has no ${base} yet. Push it once yourself (\`git push -u origin ${base}\`); code-kit publishes merges onto it from then on.`,
    };
  const ahead = Number(git('rev-list', '--count', `${remote}..${base}`).stdout.trim() || 0);
  if (!ahead) return { state: 'current', message: `${base} is already on origin.` };
  const branches = unpublished(root, base);
  const what = branches.length
    ? `${branches.length} merge${branches.length === 1 ? '' : 's'} (${branches.join(', ')})`
    : `${ahead} commit${ahead === 1 ? '' : 's'}`;

  if (mode === 'push') {
    if (!mayMove)
      return {
        state: 'waiting',
        message: `${what} on ${base} aren't on origin yet. Pushing ${base} is the person's, unless they delegate it ("approvals.delegate.push": true, committed on ${base}).`,
      };
    const pushed = git('push', '--quiet', 'origin', `${base}:refs/heads/${base}`);
    if (pushed.status !== 0)
      return {
        state: 'failed',
        message: `Pushing ${base} was refused: ${first(pushed)}${/protected|GH006|pull request/i.test(`${pushed.stderr}`) ? `\norigin requires a pull request to change ${base}: set "branches.publish": "pull-request" in the config.` : ''}`,
      };
    return { state: 'pushed', message: `Pushed ${base} to origin with ${what}.` };
  }

  // A pull request from code-kit's own branch, which holds exactly the base's head.
  const head = publishBranch(base);
  const pushed = git('push', '--quiet', 'origin', `${base}:refs/heads/${head}`);
  if (pushed.status !== 0)
    return {
      state: 'failed',
      message: `Pushing ${base} to ${head} for its pull request was refused: ${first(pushed)}`,
    };
  const open = gh(
    ...['pr', 'list', '--head', head, '--base', base, '--state', 'open'],
    ...['--json', 'url', '--jq', '.[0].url'],
  );
  let url = open.status === 0 ? open.stdout.trim() : '';
  if (!url) {
    const body = [
      `Merged into ${base} by \`code-kit merge\`, each verified against ${base} first:`,
      '',
      ...(branches.length ? branches.map((b) => `- ${b}`) : [`- ${what}`]),
      '',
      'Each merge commit says what was verified, and any checks not run.',
    ].join('\n');
    const made = gh(
      ...['pr', 'create', '--base', base, '--head', head],
      ...['--title', publishTitle(branches, ahead), '--body', body],
    );
    if (made.status !== 0)
      return { state: 'failed', message: `Opening the pull request failed: ${first(made)}` };
    url = made.stdout.trim().split('\n').at(-1);
  }
  if (!mayMove)
    return {
      state: 'waiting',
      url,
      message: `${what} wait to reach origin in ${url}. Merging it is the person's, unless they delegate pushing ${base} ("approvals.delegate.push": true, committed on ${base}).`,
    };
  const merged = gh('pr', 'merge', url, '--merge');
  if (merged.status !== 0)
    return {
      state: 'waiting',
      url,
      message: `${what} wait in ${url}: GitHub didn't merge it (${first(merged)}). It merges once GitHub allows it; run \`code-kit publish\` again then.`,
    };
  git('push', '--quiet', 'origin', '--delete', head);
  // The local base catches up with the merge GitHub made, so the next pull request holds only what's new.
  git('fetch', '--quiet', 'origin', base);
  const where = git('worktree', 'list', '--porcelain')
    .stdout.split('\n\n')
    .find((w) => w.includes(`\nbranch refs/heads/${base}`))
    ?.match(/^worktree (.+)$/m)?.[1];
  const caught = where
    ? run('git', ['-C', where, 'merge', '--quiet', '--ff-only', remote])
    : git('merge-base', '--is-ancestor', base, remote).status === 0
      ? git('update-ref', `refs/heads/${base}`, remote)
      : { status: 1 };
  return {
    state: 'merged',
    url,
    message: `Published ${what} to origin's ${base} through ${url}.${caught.status === 0 ? '' : ` The local ${base} couldn't fast-forward to origin's; pull it when it's free.`}`,
  };
}

function defaultRun(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
