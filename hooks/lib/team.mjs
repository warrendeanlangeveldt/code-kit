// Teams (docs/specs/16-teams.md): several people in one repository, each with their own agents. This
// file holds the team's part of the config (TEAM-1) and who the developer at this machine is.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from './glob.mjs';

/** A GitHub handle: letters, digits and single hyphens, at most 39 characters. */
export const isHandle = (h) =>
  typeof h === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(h);

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
export const INTENT_LABEL = 'code-kit:intent';
const STATE_SECONDS = 60;

/** A story id a ref can carry: ST-12, AUTH-3. */
export const isStoryId = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(s);

/** The paths an intent touches, from its issue's body ("Touches: a/**, b"). */
export const touchesOf = (body) =>
  (String(body ?? '').match(/^Touches:\s*(.+)$/m)?.[1] ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);

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
      const intents = JSON.parse(
        gh([
          'issue',
          'list',
          '--label',
          INTENT_LABEL,
          '--state',
          'open',
          '--json',
          'number,title,body,author,createdAt,url',
        ]) ?? 'null',
      );
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
        claims: (claims ?? cached?.claims ?? []).map(({ sha, ...c }) => c),
        intents: intents
          ? intents.map((i) => ({
              id: i.number,
              by: i.author?.login ?? null,
              about: i.title,
              touches: touchesOf(i.body),
              at: i.createdAt,
              url: i.url,
              state: 'open',
            }))
          : (cached?.intents ?? []),
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
      gh([
        'label',
        'create',
        INTENT_LABEL,
        '--force',
        '--color',
        'D4A72C',
        '--description',
        'A change of direction raised before code (code-kit)',
      ]);
      const body = `${touches.length ? `Touches: ${touches.join(', ')}\n\n` : ''}Raised with code-kit by @${by} before any code, so the team sees it first. Agree or drop it here.`;
      const url = gh([
        'issue',
        'create',
        '--title',
        about,
        '--label',
        INTENT_LABEL,
        '--body',
        body,
      ]);
      if (!url) return unreachable("GitHub can't be reached, so the intent wasn't raised.");
      provider.forget();
      const id = Number(url.trim().match(/\/(\d+)\s*$/)?.[1]);
      return { ok: true, intent: { id, by, about, touches, url: url.trim(), state: 'open' } };
    },
    /** TEAM-5: the tech lead agrees an intent (it's how the team goes) or drops it. */
    settle(id, outcome, why = '') {
      const by = me();
      if (by !== team.techLead)
        return {
          ok: false,
          why: `Only the tech lead (${team.techLead}) agrees or drops an intent.`,
        };
      const said = `${outcome === 'agreed' ? 'Agreed' : 'Dropped'} by @${by}, the tech lead${why ? `: ${why}` : '.'}`;
      const closed = gh([
        'issue',
        'close',
        String(id),
        '--reason',
        outcome === 'agreed' ? 'completed' : 'not planned',
        '--comment',
        said,
      ]);
      if (closed === null)
        return unreachable("GitHub can't be reached, so the intent wasn't settled.");
      provider.forget();
      return { ok: true, id, outcome };
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

/** The story a branch is for: web/st-4 → ST-4. Null for any other branch. */
export const storyOfBranch = (branch) => {
  const m = String(branch ?? '').match(/^[a-z][a-z0-9-]*\/([a-z][a-z0-9]*-\d+)$/i);
  return m ? m[1].toUpperCase() : null;
};

/** The lane a story branch is in: web/st-4 → web. */
export const laneOfBranch = (branch) => (storyOfBranch(branch) ? branch.split('/')[0] : null);

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
  if (theirs)
    return `${story} is ${theirs.by}'s claim, so this branch is their work. Ask ${theirs.by} or the tech lead (${team.techLead}) to release it before you work on it.`;
  const fileLane = laneOf(rel, config);
  if (fileLane && team.owners[fileLane]?.includes(me)) return null;
  const leased = state.claims.find(
    (c) => c.by !== me && c.story !== story && c.lease.length && matchesAny(rel, c.lease),
  );
  if (leased)
    return `${rel} is leased by ${leased.by} for ${leased.story}, which is changing it now. Ask ${leased.by}, wait for ${leased.story} to merge, or raise what you need as an intent: ${intend}`;
  return null;
}
