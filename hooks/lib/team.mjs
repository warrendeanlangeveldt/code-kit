// Teams (docs/specs/16-teams.md): several people in one repository, each with their own agents. This
// file holds the team's part of the config (TEAM-1) and who the developer at this machine is.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from './glob.mjs';
import {
  isHandle,
  isStoryId,
  discussionActivity,
  intentOf,
  laneOfBranch,
  storyOfBranch,
  touchesOf,
  withStaleness,
  workingDaysBetween,
  BOARD_FIELDS,
  boardChanges,
  boardValues,
} from './teamfacts.mjs';

export {
  isHandle,
  isStoryId,
  discussionActivity,
  intentOf,
  laneOfBranch,
  storyOfBranch,
  touchesOf,
  withStaleness,
  workingDaysBetween,
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What's wrong with `team` and the lanes' `owners`, as the config's other problems are worded. */
export function teamProblems(c) {
  const p = [];
  const t = c.team;
  if (t !== undefined) {
    if (!isObj(t)) return ['"team" must be an object'];
    if (!isHandle(t.techLead)) p.push('"team.techLead" must be the tech lead\'s GitHub handle');
    if (t.staleDays !== undefined && !(Number.isInteger(t.staleDays) && t.staleDays >= 1))
      p.push('"team.staleDays" must be a whole number of working days, 1 or more');
    if (
      t.board !== undefined &&
      !(
        isObj(t.board) &&
        typeof t.board.owner === 'string' &&
        t.board.owner.trim() &&
        Number.isInteger(t.board.number) &&
        t.board.number > 0
      )
    )
      p.push(
        '"team.board" must be { "owner": "<user or organisation>", "number": <the Project\'s number> }',
      );
    if (t.intents !== undefined && !(typeof t.intents === 'string' && t.intents.trim()))
      p.push('"team.intents" must name the discussion category intents go in');
    if (
      t.provider !== undefined &&
      t.provider !== 'github' &&
      !(isObj(t.provider) && typeof t.provider.command === 'string' && t.provider.command.trim())
    )
      p.push('"team.provider" must be "github" or { "command": "<the provider\'s command>" }');
  }
  for (const [name, lane] of Object.entries(isObj(c.lanes) ? c.lanes : {})) {
    if (!isObj(lane) || lane.owners === undefined) continue;
    if (!(Array.isArray(lane.owners) && lane.owners.length && lane.owners.every(isHandle)))
      p.push(`lanes.${name}.owners must list GitHub handles`);
    else if (t === undefined) p.push(`lanes.${name}.owners needs "team", with its tech lead`);
  }
  return p;
}

/**
 * The team, with its defaults, or null for a project that isn't a team's: { techLead, staleDays,
 * provider: 'github' | { command }, owners: { lane: [handles] } }.
 */
export function teamOf(raw) {
  if (!isObj(raw?.team)) return null;
  return {
    techLead: raw.team.techLead,
    staleDays: raw.team.staleDays ?? 3,
    intents: raw.team.intents ?? 'Intents',
    board: raw.team.board ?? null,
    provider: raw.team.provider ?? 'github',
    owners: Object.fromEntries(
      Object.entries(raw.lanes ?? {})
        .filter(([, l]) => Array.isArray(l?.owners))
        .map(([name, l]) => [name, l.owners]),
    ),
  };
}

const WHOAMI = '.claude/state/whoami.json';
const WHOAMI_HOURS = 12;

/**
 * The developer at this machine, by their GitHub handle (`gh api user`), cached in the main checkout
 * for 12 hours so a hook doesn't ask GitHub on every call. Null when gh isn't installed or signed in.
 */
export function whoami(root, now = Date.now()) {
  const file = join(root, WHOAMI);
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (isHandle(cached.login) && now - Date.parse(cached.at) < WHOAMI_HOURS * 3600_000)
      return cached.login;
  } catch {
    // not cached yet, or unreadable: ask GitHub
  }
  const ran = spawnSync('gh', ['api', 'user', '-q', '.login'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const login = ran.status === 0 ? ran.stdout.trim() : '';
  if (!isHandle(login)) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ login, at: new Date(now).toISOString() }) + '\n');
  } catch {
    // a read-only checkout: ask again next time
  }
  return login;
}

// --- the provider (TEAM-2) ----------------------------------------------------------------------------
//
// The core talks to the team through one interface: whoami, claim(story, lease), release(story),
// state() and intend(about, touches). The GitHub provider is built in; any other is a command named in
// the config, called with the operation's name and its input as JSON on stdin, answering JSON.

const CLAIMS = 'refs/code-kit/claims';
const SEEN = 'refs/code-kit/seen-claims';
const TEAM_STATE = '.claude/state/team.json';
const STATE_SECONDS = 60;

/** A claim's ref message: the claim as JSON. Unreadable ones are left out. */
function claimOf(message) {
  try {
    const c = JSON.parse(message);
    return isStoryId(c.story) && isHandle(c.by)
      ? { story: c.story, by: c.by, at: c.at, lease: Array.isArray(c.lease) ? c.lease : [] }
      : null;
  } catch {
    return null;
  }
}

/** The provider for this project's team: GitHub's, or the config's command. */
export function teamProvider(root, team) {
  return team.provider === 'github'
    ? githubProvider(root, team)
    : commandProvider(root, team, team.provider.command);
}

function githubProvider(root, team) {
  const run = (cmd, args, opts = {}) =>
    spawnSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...opts,
    });
  const git = (args, opts) => run('git', args, opts);
  const ok = (r) => r.status === 0;
  const gh = (args, input) => {
    const r = run('gh', args, input === undefined ? {} : { input });
    return ok(r) ? r.stdout : null;
  };
  /** A GraphQL call through gh; `repo` adds the repository as $owner and $name. Null on failure. */
  const graphql = (query, vars = {}, repo = false) => {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    if (repo) args.push('-F', 'owner={owner}', '-F', 'name={repo}');
    for (const [k, v] of Object.entries(vars))
      args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
    const out = gh(args);
    try {
      return out === null ? null : (JSON.parse(out).data ?? null);
    } catch {
      return null;
    }
  };
  /** The repository's discussions, the Intents category among its categories: null when unreadable. */
  const discussions = () => {
    const d = graphql(
      `
        query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
            hasDiscussionsEnabled
            discussionCategories(first: 50) {
              nodes {
                id
                name
              }
            }
            discussions(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                id
                number
                title
                body
                url
                createdAt
                closed
                closedAt
                stateReason
                author {
                  login
                }
                category {
                  name
                }
              }
            }
          }
        }
      `,
      {},
      true,
    );
    const repo = d?.repository;
    if (!repo) return null;
    const category =
      repo.discussionCategories.nodes.find(
        (c) => c.name.toLowerCase() === team.intents.toLowerCase(),
      ) ?? null;
    return {
      repoId: repo.id,
      enabled: repo.hasDiscussionsEnabled,
      category,
      intents: repo.discussions.nodes.filter((n) => n.category?.name === category?.name),
    };
  };
  const noCategory = (found) =>
    found.enabled
      ? `This repository has no "${team.intents}" discussion category, and GitHub doesn't let a tool create one. Add it once in the repository's Settings › Discussions (an "Open-ended discussion" category named ${team.intents}), then raise the intent again.`
      : `Discussions are off for this repository. Turn them on in its Settings › Features, add a "${team.intents}" category, then raise the intent again.`;
  /** Fetch every claim on the shared repository, or null when it can't be reached. */
  const fetchClaims = () => {
    const fetched = git(['fetch', '--prune', '--quiet', 'origin', `+${CLAIMS}/*:${SEEN}/*`]);
    if (!ok(fetched)) return null;
    const listed = git([
      'for-each-ref',
      '--format=%(objectname)%00%(contents)%1e',
      `${SEEN}/`,
    ]).stdout;
    return listed
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [sha, message] = r.split('\0');
        const claim = claimOf(message.trim());
        return claim ? { ...claim, sha } : null;
      })
      .filter(Boolean);
  };
  const unreachable = (why) => ({ ok: false, unreachable: true, why });
  const notReached = () =>
    unreachable("The shared repository (origin) can't be reached, so claims can't be checked.");
  /** Push `sha` to a claim's ref only if the ref is still `expect` ('' for not there yet). */
  const pushClaim = (story, sha, expect) =>
    git([
      'push',
      '--quiet',
      `--force-with-lease=${CLAIMS}/${story}:${expect}`,
      'origin',
      sha ? `${sha}:${CLAIMS}/${story}` : `:${CLAIMS}/${story}`,
    ]);
  const me = () => whoami(root);

  const provider = {
    whoami: () => ({ login: me() }),
    claim(story, lease = []) {
      if (!isStoryId(story)) return { ok: false, why: `"${story}" isn't a story id.` };
      const by = me();
      if (!by) return { ok: false, why: 'Sign in to GitHub first (gh auth login).' };
      const claims = fetchClaims();
      if (!claims) return notReached();
      const held = claims.find((c) => c.story === story);
      if (held && held.by !== by) return { ok: false, holder: held };
      const at = new Date().toISOString();
      const email = `${by}@users.noreply.github.com`;
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: by,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: by,
        GIT_COMMITTER_EMAIL: email,
      };
      const tree = git(['mktree'], { input: '' }).stdout.trim();
      // A lease only grows while the story is open: a claim again adds to it.
      lease = [...new Set([...(held?.lease ?? []), ...lease])];
      const message = JSON.stringify({ story, by, at, lease });
      const sha = git(['commit-tree', tree, '-m', message], { env }).stdout.trim();
      const pushed = pushClaim(story, sha, held?.sha ?? '');
      if (!ok(pushed)) {
        // Someone claimed it between our fetch and push: say who.
        const now = fetchClaims();
        const holder = now?.find((c) => c.story === story);
        return holder && holder.by !== by ? { ok: false, holder } : notReached();
      }
      provider.forget();
      return { ok: true, claim: { story, by, at, lease } };
    },
    /** `merged`: the story merged, so its claim ends whoever releases it. */
    release(story, { merged = false } = {}) {
      const by = me();
      const claims = fetchClaims();
      if (!claims) return notReached();
      const held = claims.find((c) => c.story === story);
      if (!held) return { ok: true, released: false };
      if (!merged && held.by !== by && by !== team.techLead)
        return {
          ok: false,
          holder: held,
          why: `${story} is ${held.by}'s claim: only they or the tech lead (${team.techLead}) can release it.`,
        };
      if (!ok(pushClaim(story, '', held.sha))) return notReached();
      provider.forget();
      return { ok: true, released: true, claim: held };
    },
    state({ fresh = false } = {}) {
      const cached = readCache(root);
      if (!fresh && cached && Date.now() - Date.parse(cached.at) < STATE_SECONDS * 1000)
        return cached;
      const claims = fetchClaims();
      // TEAM-9: when each story's branch was last pushed, from the shared repository's branches.
      const pushed = new Map();
      if (claims && ok(git(['fetch', '--prune', '--quiet', 'origin']))) {
        const refs = git([
          'for-each-ref',
          '--format=%(refname:lstrip=3) %(committerdate:unix)',
          'refs/remotes/origin/',
        ]).stdout;
        for (const line of refs.split('\n').filter(Boolean)) {
          const [branch, unix] = line.split(' ');
          const story = storyOfBranch(branch);
          if (story) pushed.set(story, Math.max(pushed.get(story) ?? 0, Number(unix) * 1000));
        }
      }
      const found = discussions();
      const intents = found ? found.intents.filter((n) => !n.closed) : null;
      const pulls = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'open',
          '--json',
          'number,title,author,headRefName,isDraft,updatedAt,url',
        ]) ?? 'null',
      );
      const state = {
        at: new Date().toISOString(),
        reachable: Boolean(claims),
        github: Boolean(intents && pulls),
        me: me(),
        techLead: team.techLead,
        owners: team.owners,
        staleDays: team.staleDays,
        claims: claims
          ? claims.map(({ sha, ...c }) => withStaleness(c, pushed.get(c.story), team.staleDays))
          : (cached?.claims ?? []),
        intents: intents ? intents.map(intentOf) : (cached?.intents ?? []),
        pulls: pulls
          ? pulls.map((p) => ({
              number: p.number,
              title: p.title,
              by: p.author?.login ?? null,
              branch: p.headRefName,
              draft: p.isDraft,
              updated: p.updatedAt,
              url: p.url,
            }))
          : (cached?.pulls ?? []),
      };
      writeCache(root, state);
      return state;
    },
    intend(about, touches = []) {
      const by = me();
      if (!by) return { ok: false, why: 'Sign in to GitHub first (gh auth login).' };
      const found = discussions();
      if (!found) return unreachable("GitHub can't be reached, so the intent wasn't raised.");
      if (!found.category) return { ok: false, why: noCategory(found) };
      const body = `${touches.length ? `Touches: ${touches.join(', ')}\n\n` : ''}Raised with code-kit by @${by} before any code, so the team sees it first. The tech lead agrees, drops or marks it a duplicate here.`;
      const made = graphql(
        `
          mutation ($repo: ID!, $category: ID!, $title: String!, $body: String!) {
            createDiscussion(
              input: { repositoryId: $repo, categoryId: $category, title: $title, body: $body }
            ) {
              discussion {
                number
                url
              }
            }
          }
        `,
        { repo: found.repoId, category: found.category.id, title: about, body },
      );
      const d = made?.createDiscussion?.discussion;
      if (!d) return unreachable("GitHub refused the discussion, so the intent wasn't raised.");
      provider.forget();
      return { ok: true, intent: { id: d.number, by, about, touches, url: d.url, state: 'open' } };
    },
    /** TEAM-9: the tech lead hands a claim, with its lease, to someone else. */
    reassign(story, to) {
      const by = me();
      if (by !== team.techLead)
        return { ok: false, why: `Only the tech lead (${team.techLead}) reassigns a claim.` };
      if (!isHandle(to)) return { ok: false, why: `"${to}" isn't a GitHub handle.` };
      const claims = fetchClaims();
      if (!claims) return notReached();
      const held = claims.find((c) => c.story === story);
      if (!held) return { ok: false, why: `${story} isn't claimed.` };
      const at = new Date().toISOString();
      const email = `${by}@users.noreply.github.com`;
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: by,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: by,
        GIT_COMMITTER_EMAIL: email,
      };
      const tree = git(['mktree'], { input: '' }).stdout.trim();
      const message = JSON.stringify({ story, by: to, at, lease: held.lease });
      const sha = git(['commit-tree', tree, '-m', message], { env }).stdout.trim();
      if (!ok(pushClaim(story, sha, held.sha))) return notReached();
      provider.forget();
      return { ok: true, from: held.by, to };
    },
    /**
     * TEAM-6: what happened since `at` (ms), from the repository's activity on GitHub: [{ at, by, kind,
     * text }], oldest first. Kinds: pushed, branched, opened, merged, closed, reviewed, intended,
     * agreed, dropped. Null when GitHub can't be read.
     */
    since(at) {
      const raw = gh(['api', 'repos/{owner}/{repo}/events?per_page=100']);
      if (raw === null) return null;
      let events;
      try {
        events = JSON.parse(raw);
      } catch {
        return null;
      }
      const found = discussions();
      return [
        ...activityOf(events, at),
        ...discussionActivity(found?.intents ?? [], at, team.techLead),
      ].sort((a, b) => a.at - b.at);
    },
    /** TEAM-10: one intent with its comments, for its decision record; null when unreadable. */
    intent(id) {
      const d = graphql(
        `
          query ($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) {
              discussion(number: $number) {
                number
                title
                body
                url
                createdAt
                closed
                closedAt
                stateReason
                author {
                  login
                }
                category {
                  name
                }
                comments(last: 20) {
                  nodes {
                    author {
                      login
                    }
                    body
                  }
                }
              }
            }
          }
        `,
        { number: Number(id) },
        true,
      );
      if (!d) return null;
      const found = d.repository?.discussion;
      if (!found || found.category?.name?.toLowerCase() !== team.intents.toLowerCase())
        return { missing: true };
      return { ...found, comments: found.comments?.nodes ?? found.comments ?? [] };
    },
    /** TEAM-5: the tech lead agrees an intent (resolved), drops it (outdated) or marks it a duplicate. */
    settle(id, outcome, why = '') {
      const by = me();
      if (by !== team.techLead)
        return {
          ok: false,
          why: `Only the tech lead (${team.techLead}) agrees or drops an intent.`,
        };
      const d = graphql(
        `
          query ($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) {
              discussion(number: $number) {
                id
                closed
                category {
                  name
                }
              }
            }
          }
        `,
        { number: Number(id) },
        true,
      );
      if (!d) return unreachable("GitHub can't be reached, so the intent wasn't settled.");
      const found = d.repository?.discussion;
      if (!found || found.category?.name?.toLowerCase() !== team.intents.toLowerCase())
        return { ok: false, why: `There's no intent #${id} in ${team.intents}.` };
      if (found.closed) return { ok: false, why: `Intent #${id} is already settled.` };
      const words = { agreed: 'Agreed', dropped: 'Dropped', duplicate: 'Marked a duplicate' }[
        outcome
      ];
      const said = `${words} by @${by}, the tech lead${why ? `: ${why}` : '.'}`;
      const reason = { agreed: 'RESOLVED', dropped: 'OUTDATED', duplicate: 'DUPLICATE' }[outcome];
      const commented = graphql(
        `
          mutation ($id: ID!, $body: String!) {
            addDiscussionComment(input: { discussionId: $id, body: $body }) {
              comment {
                id
              }
            }
          }
        `,
        { id: found.id, body: said },
      );
      const closed = graphql(
        `
          mutation ($id: ID!, $reason: DiscussionCloseReason!) {
            closeDiscussion(input: { discussionId: $id, reason: $reason }) {
              discussion {
                number
              }
            }
          }
        `,
        { id: found.id, reason },
      );
      if (!commented || !closed)
        return unreachable("GitHub can't be reached, so the intent wasn't settled.");
      provider.forget();
      return { ok: true, id: Number(id), outcome };
    },
    forget: () => writeCache(root, null),
  };
  return provider;
}

function commandProvider(root, team, command) {
  const call = (op, input = {}) => {
    const r = spawnSync('sh', ['-c', `${command} ${op}`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      input: JSON.stringify({ ...input, team }),
    });
    if (r.status !== 0)
      return {
        ok: false,
        unreachable: true,
        why: `The team provider (${command}) failed: ${(r.stderr || r.stdout || '').trim().split('\n')[0] || `exit ${r.status}`}`,
      };
    try {
      return JSON.parse(r.stdout);
    } catch {
      return {
        ok: false,
        unreachable: true,
        why: `The team provider (${command}) didn't answer JSON.`,
      };
    }
  };
  return {
    whoami: () => call('whoami'),
    claim: (story, lease = []) => call('claim', { story, lease }),
    release: (story, { merged = false } = {}) => call('release', { story, merged }),
    state: ({ fresh = false } = {}) => {
      const s = call('state', { fresh });
      return s.unreachable
        ? { ...(readCache(root) ?? {}), reachable: false, why: s.why }
        : (writeCache(root, s), s);
    },
    intend: (about, touches = []) => call('intend', { about, touches }),
    settle: (id, outcome, why = '') => call('settle', { id, outcome, why }),
    reassign: (story, to) => call('reassign', { story, to }),
    intent: (id) => {
      const r = call('intent', { id });
      return r.unreachable ? null : r;
    },
    since: (at) => {
      const r = call('since', { at });
      return Array.isArray(r) ? r : null;
    },
    forget: () => writeCache(root, null),
  };
}

/** The team's state as last read, for the hooks and the mod between polls. */
export function readCache(root) {
  try {
    const s = JSON.parse(readFileSync(join(root, TEAM_STATE), 'utf8'));
    return s && typeof s.at === 'string' ? s : null;
  } catch {
    return null;
  }
}

function writeCache(root, state) {
  try {
    mkdirSync(join(root, '.claude/state'), { recursive: true });
    writeFileSync(join(root, TEAM_STATE), JSON.stringify(state, null, 2) + '\n');
  } catch {
    // a read-only checkout: read fresh next time
  }
}

// --- the rules (TEAM-1, TEAM-4) -----------------------------------------------------------------------

/** The lane that owns a file, by its paths. */
const laneOf = (rel, config) =>
  Object.keys(config.lanes).find((name) => {
    const { paths, exclude = [] } = config.lanes[name];
    return matchesAny(rel, paths) && !matchesAny(rel, exclude);
  }) ?? null;

/** The project's own lead paths: the plan, specs and contracts, without the kit's `.claude/**`. */
const techLeadPaths = (config) => config.lead.paths.filter((p) => p !== '.claude/**' && p !== '*');

/**
 * Why this person's agent may not write `rel`, as a team, or null. `actor` is the hooks' actor, `branch`
 * the checkout's branch, `me` the developer's handle, `state` the provider's last-read state. Only what
 * the config says is checked when the shared repository can't be reached (TEAM-8).
 */
export function teamRefusal({ actor, rel, branch, config, me, state }) {
  const team = teamOf(config);
  if (!team || !me) return null;
  const intend = `code-kit intend "<what you'd change, and why>" --touches ${rel}`;
  if (actor.kind === 'lead' && me !== team.techLead && matchesAny(rel, techLeadPaths(config)))
    return `${rel} is the tech lead's (${team.techLead}): the plan, specs and contracts change only in their sessions, so the team agrees a change before code is built on it. Raise it as an intent instead: ${intend}`;
  const owners = actor.kind === 'lane' ? team.owners[actor.lane] : null;
  if (owners && !owners.includes(me))
    return `The ${actor.lane} lane is ${owners.join(' and ')}'s, so agents in your session don't work it. Leave this story for them, or ask the tech lead (${team.techLead}) to change the lane's owners.`;
  if (!state || state.reachable === false) return null;
  const story = storyOfBranch(branch);
  const theirs = state.claims.find((c) => c.story === story && c.by !== me);
  const staleNote = (c) =>
    c.stale
      ? ` It's stale: nothing on it since ${String(c.active).slice(0, 10)}, so the tech lead may reassign it.`
      : '';
  if (theirs)
    return `${story} is ${theirs.by}'s claim, so this branch is their work. Ask ${theirs.by} or the tech lead (${team.techLead}) to release it before you work on it.${staleNote(theirs)}`;
  const fileLane = laneOf(rel, config);
  if (fileLane && team.owners[fileLane]?.includes(me)) return null;
  const leased = state.claims.find(
    (c) => c.by !== me && c.story !== story && c.lease.length && matchesAny(rel, c.lease),
  );
  if (leased)
    return `${rel} is leased by ${leased.by} for ${leased.story}, which is changing it now. Ask ${leased.by}, wait for ${leased.story} to merge, or raise what you need as an intent: ${intend}${staleNote(leased)}`;
  return null;
}

/**
 * TEAM-6: GitHub's repository events since `at` (ms) as plain sentences: [{ at, by, kind, text }],
 * oldest first. Events code-kit doesn't speak about (stars, forks, wiki edits) are left out.
 */
export function activityOf(events, at) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const when = Date.parse(e.created_at);
    if (!(when > at)) continue;
    const by = e.actor?.login ?? 'someone';
    const p = e.payload ?? {};
    const add = (kind, text) => out.push({ at: when, by, kind, text });
    if (e.type === 'PushEvent' && String(p.ref).startsWith('refs/heads/')) {
      const n = p.size ?? p.commits?.length ?? 0;
      add('pushed', `pushed ${n} commit${n === 1 ? '' : 's'} to ${p.ref.slice(11)}`);
    } else if (e.type === 'CreateEvent' && p.ref_type === 'branch')
      add('branched', `started ${p.ref}`);
    else if (e.type === 'PullRequestEvent') {
      const pr = p.pull_request ?? {};
      const name = `#${pr.number} ${pr.title}`;
      if (p.action === 'opened' || p.action === 'reopened')
        add('opened', `opened ${pr.draft ? 'draft ' : ''}pull request ${name}`);
      else if (p.action === 'closed' && pr.merged) add('merged', `merged ${name}`);
      else if (p.action === 'closed') add('closed', `closed ${name} without merging`);
      else if (p.action === 'ready_for_review') add('opened', `marked ${name} ready for review`);
    } else if (e.type === 'PullRequestReviewEvent') {
      const pr = p.pull_request ?? {};
      const state = String(p.review?.state ?? '').toLowerCase();
      const how =
        state === 'approved'
          ? 'approved'
          : state === 'changes_requested'
            ? 'asked for changes on'
            : 'reviewed';
      add('reviewed', `${how} #${pr.number} ${pr.title}`);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Claims taken and released between two reads: [{ by, kind: 'claimed'|'released', text }]. */
export function claimChanges(before = [], now = []) {
  const key = (c) => `${c.story}|${c.by}`;
  const was = new Map(before.map((c) => [key(c), c]));
  const is = new Map(now.map((c) => [key(c), c]));
  return [
    ...now
      .filter((c) => !was.has(key(c)))
      .map((c) => ({
        at: Date.parse(c.at),
        by: c.by,
        kind: 'claimed',
        text: `claimed ${c.story}`,
      })),
    ...before
      .filter((c) => !is.has(key(c)))
      .map((c) => ({
        at: Date.now(),
        by: c.by,
        kind: 'released',
        text: `${c.story} is no longer claimed by them`,
      })),
  ];
}

// --- the board (TEAM-12) -------------------------------------------------------------------------------

const BOARD_STATE = '.claude/state/board.json';

/**
 * TEAM-12: mirror the plan's stories onto the team's GitHub Project as draft items with text fields
 * (Lane, Claimed by, Stale, State), creating the fields and items it needs and editing only what
 * changed since the last sync. `stories` are the plan's, `claims` the team's. The board is a view:
 * claims stay refs. Returns { ok, created, edited } or { ok: false, why }.
 */
export function syncBoard(root, team, stories, claims) {
  const { owner, number } = team.board;
  const run = (args) =>
    spawnSync('gh', ['project', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const json = (args) => {
    const r = run([...args, '--format', 'json']);
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim());
    return JSON.parse(r.stdout || 'null');
  };
  const at = ['--owner', owner];
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(join(root, BOARD_STATE), 'utf8'));
  } catch {
    // first sync on this machine
  }
  const key = `${owner}/${number}`;
  if (cache.board !== key) cache = { board: key, items: {} };
  const save = () => {
    mkdirSync(join(root, '.claude/state'), { recursive: true });
    writeFileSync(join(root, BOARD_STATE), JSON.stringify(cache, null, 2) + '\n');
  };
  let created = 0;
  let edited = 0;
  try {
    const project = json(['view', String(number), ...at]);
    const fields = new Map(
      (json(['field-list', String(number), ...at]).fields ?? []).map((f) => [f.name, f.id]),
    );
    for (const name of BOARD_FIELDS)
      if (!fields.has(name))
        fields.set(
          name,
          json(['field-create', String(number), ...at, '--name', name, '--data-type', 'TEXT']).id,
        );
    // Items made before this machine's cache: found by their story id, so nothing is doubled.
    if (stories.some((s) => !cache.items[s.id])) {
      for (const item of json(['item-list', String(number), ...at, '--limit', '1000']).items ??
        []) {
        const id = String(item.title ?? item.content?.title ?? '').split(' ')[0];
        if (isStoryId(id) && !cache.items[id]) cache.items[id] = { id: item.id, values: {} };
      }
    }
    const byStory = new Map(claims.map((c) => [c.story, c]));
    for (const s of stories) {
      const now = boardValues(s, byStory.get(s.id));
      if (!cache.items[s.id]) {
        const item = json([
          'item-create',
          String(number),
          ...at,
          '--title',
          `${s.id} ${s.title ?? ''}`.trim(),
          '--body',
          s.requirements?.length ? `Requirements: ${s.requirements.join(', ')}` : '',
        ]);
        cache.items[s.id] = { id: item.id, values: {} };
        created += 1;
      }
      const entry = cache.items[s.id];
      for (const [field, value] of boardChanges(entry.values, now)) {
        const r = run([
          'item-edit',
          '--id',
          entry.id,
          '--project-id',
          project.id,
          '--field-id',
          fields.get(field),
          ...(value ? ['--text', value] : ['--clear']),
        ]);
        if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim());
        entry.values[field] = value;
        edited += 1;
      }
      save();
    }
  } catch (e) {
    save();
    const why = String(e.message || e);
    return {
      ok: false,
      why:
        /scope|project/i.test(why) && /token|scope|permission|auth/i.test(why)
          ? 'Your gh sign-in needs the project permission to write to the board: run gh auth refresh -s project, then sync again.'
          : `The board couldn't be synced: ${why.split('\n')[0]}`,
    };
  }
  return { ok: true, created, edited };
}
