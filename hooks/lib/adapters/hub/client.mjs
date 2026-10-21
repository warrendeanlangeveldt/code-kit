#!/usr/bin/env node
// The code-kit hub client (code-kit spec 21, HUBR-6): a hosted team provider's adapter. Plain Node, no
// dependencies. Every command takes the hub's address as `--url <https address>`, from the config.
//
//   client.mjs signin                  sign this machine in to the hub (GitHub's device flow)
//   client.mjs signout | status
//   client.mjs connect                 set this repository's code-kit config to use the hub
//   client.mjs drift-model hub|own     choose the drift agent's model (own: the key on stdin)
//   client.mjs <op>                    code-kit's team provider command (TEAM-2, HUBR-1): the
//                                        operation's input as JSON on stdin, its answer on stdout
//   client.mjs daemon --root <dir> --session <id> [--watch <pid>]
//                                        holds the event stream, writes each event for code-kit's
//                                        mod and the team's state for its hooks, reports presence
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.CODE_KIT_HUB_HOME ?? join(homedir(), '.config', 'code-kit-hub');
const OPS = [
  'whoami',
  'claim',
  'release',
  'state',
  'intend',
  'settle',
  'reassign',
  'intent',
  'since',
  'report',
  'standards',
];
/** What to run again to sign in: code-kit's own command for the client. */
const SIGN_IN = 'code-kit team provider signin';
const DOWN_AFTER_MS = 60_000;
const PRESENCE_MS = 30_000;
const EVENTS_KEPT = 500;

// --- where things are kept ---------------------------------------------------------------------

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value, mode) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', mode ? { mode } : undefined);
  renameSync(tmp, file);
};

/** The hub's address and this machine's sign-in. */
let given = null; // the hub's address from --url
const hubUrl = () => {
  const url = given ?? process.env.CODE_KIT_HUB_URL ?? credentials()?.url;
  if (!url)
    throw new Error(
      'No hub address: the config\'s team.provider names it, as { "hub": "<https address>" }.',
    );
  return url.replace(/\/$/, '');
};
const credentials = () => readJson(join(HOME, 'credentials.json'));

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/** The origin's address as configured (git's `insteadOf` rewriting left out). */
const originOf = (cwd) => git(cwd, 'config', '--get', 'remote.origin.url');

/** owner/name of the repository's GitHub origin. */
export function repoOf(remote) {
  const m = String(remote ?? '').match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The main checkout: state is shared by the lanes' worktrees. */
const mainRoot = (cwd) => {
  const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return common ? dirname(common) : cwd;
};
const stateDir = (root) => join(mainRoot(root), '.claude', 'state');
const hubDown = (root) => readJson(join(stateDir(root), 'hub-down.json'), {});

// --- talking to the hub ------------------------------------------------------------------------

async function hub(method, path, body, { timeoutMs = 15_000 } = {}) {
  const cred = credentials();
  const res = await fetch(`${hubUrl()}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cred?.token ? { authorization: `Bearer ${cred.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, why: `The hub answered ${res.status}.` };
  }
  return { status: res.status, json };
}

const unreachable = (why) => ({ ok: false, unreachable: true, why });

/**
 * code-kit's provider command: one operation. The hub is down when it hasn't answered for a minute, and
 * then every operation answers `unreachable` at once, so code-kit falls back to its GitHub provider
 * (team.provider.fallback) without waiting on the network.
 */
export async function provide(op, input, root = process.cwd()) {
  if (!OPS.includes(op)) return { ok: false, why: `The hub has no operation "${op}".` };
  const repo = repoOf(originOf(root));
  if (!repo)
    return unreachable("This repository has no GitHub origin, so the hub can't be used here.");
  if (!credentials()?.token)
    return unreachable(`This machine isn't signed in to code-kit hub: run ${SIGN_IN}.`);
  const down = hubDown(root);
  if (
    down.since &&
    Date.now() - down.since > DOWN_AFTER_MS &&
    Date.now() - (down.tried ?? 0) < 15_000
  )
    return unreachable(
      `code-kit hub hasn't answered since ${new Date(down.since).toLocaleTimeString()}.`,
    );
  // The daemon keeps the state fresh from the stream: read it from disk unless asked for fresh.
  if (op === 'state' && !input.fresh) {
    const kept = readJson(join(stateDir(root), 'team.json'));
    const live = readJson(join(stateDir(root), 'hub-stream.json'), {});
    if (kept?.hub && live.connected && Date.now() - Date.parse(kept.at) < 5 * 60_000)
      return named(kept, root);
  }
  const { team: _team, ...body } = input;
  try {
    // STD-6: the organisation's standards are read, not posted. A hub without them answers none.
    if (op === 'standards') {
      const { status, json } = await hub('GET', `/v1/repos/${repo}/standards`);
      markUp(root);
      if (status === 401) return unreachable(json.why ?? `Sign in to the hub again: ${SIGN_IN}.`);
      if (status === 404 || status === 405 || !Array.isArray(json?.standards))
        return { ok: true, standards: [], waivers: [] };
      return {
        ok: true,
        version: json.version ?? null,
        standards: json.standards,
        waivers: Array.isArray(json.waivers) ? json.waivers : [],
      };
    }
    const { status, json } = await hub('POST', `/v1/repos/${repo}/${op}`, body);
    markUp(root);
    if (status === 401) return unreachable(json.why ?? `Sign in to the hub again: ${SIGN_IN}.`);
    if (status >= 500 && json?.unreachable) return unreachable(json.why);
    if ((op === 'claim' || op === 'release' || op === 'reassign') && json?.ok)
      mirrorClaim(root, op, input, json);
    return op === 'state' && json?.hub ? named(json, root) : json;
  } catch (err) {
    markDown(root);
    return unreachable(
      `code-kit hub can't be reached (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`,
    );
  }
}

/**
 * The state names what coordinates the team, for code-kit's Team pane: the hub, whether this session's
 * stream is live, and who this machine is signed in as.
 */
function named(state, root) {
  const live = readJson(join(stateDir(root), 'hub-stream.json'), {});
  return {
    ...state,
    provider: {
      name: 'code-kit hub',
      live: Boolean(live.connected),
      account: credentials()?.login ?? null,
      detail: live.connected
        ? 'claims, leases, intents and presence as they happen; every push checked for drift'
        : (live.why ?? 'not connected to its live updates; read on each refresh'),
    },
  };
}

function markDown(root) {
  const file = join(stateDir(root), 'hub-down.json');
  const d = readJson(file, {});
  writeJson(file, { since: d.since ?? Date.now(), tried: Date.now() });
}
function markUp(root) {
  const file = join(stateDir(root), 'hub-down.json');
  if (existsSync(file)) writeJson(file, {});
}

/**
 * The hub's claims, mirrored as code-kit's claim refs, so code-kit's GitHub provider sees the same
 * claims if the hub goes down. Best effort: the hub stays the authority.
 */
function mirrorClaim(root, op, input, result) {
  const claim = op === 'claim' ? result.claim : op === 'reassign' ? null : result.claim;
  const story = claim?.story ?? input.story;
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(String(story))) return;
  const ref = `refs/code-kit/claims/${story}`;
  try {
    if (op === 'release') {
      if (result.released)
        execFileSync('git', ['-C', root, 'push', '--quiet', 'origin', `:${ref}`], {
          stdio: 'ignore',
          timeout: 20_000,
        });
      return;
    }
    const c =
      op === 'claim' ? claim : { story, by: input.to, at: new Date().toISOString(), lease: [] };
    const email = `${c.by}@users.noreply.github.com`;
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: c.by,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: c.by,
      GIT_COMMITTER_EMAIL: email,
    };
    const tree = execFileSync('git', ['-C', root, 'mktree'], {
      input: '',
      encoding: 'utf8',
    }).trim();
    const sha = execFileSync(
      'git',
      [
        '-C',
        root,
        'commit-tree',
        tree,
        '-m',
        JSON.stringify({ story: c.story, by: c.by, at: c.at, lease: c.lease }),
      ],
      { encoding: 'utf8', env },
    ).trim();
    execFileSync('git', ['-C', root, 'push', '--quiet', '--force', 'origin', `${sha}:${ref}`], {
      stdio: 'ignore',
      timeout: 20_000,
    });
  } catch {
    // the mirror is a fallback's convenience; the hub has the claim
  }
}

// --- sign-in (HUB-1): GitHub's device flow, through the App ------------------------------------

async function signin() {
  const meta = await hub('GET', '/v1/meta');
  const { clientId, github } = meta.json;
  const form = (o) => new URLSearchParams(o).toString();
  const started = await (
    await fetch(`${github}/login/device/code`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId }),
    })
  ).json();
  if (!started.device_code)
    throw new Error(
      `GitHub didn't start the sign-in: ${started.error_description ?? JSON.stringify(started)}`,
    );
  console.log(
    `Open ${started.verification_uri} and enter the code ${started.user_code} (within ${Math.round(started.expires_in / 60)} minutes).`,
  );
  let interval = (started.interval ?? 5) * 1000;
  const until = Date.now() + started.expires_in * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, interval));
    const polled = await (
      await fetch(`${github}/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form({
          client_id: clientId,
          device_code: started.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
    ).json();
    if (polled.error === 'authorization_pending') continue;
    if (polled.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (!polled.access_token)
      throw new Error(`GitHub refused the sign-in: ${polled.error_description ?? polled.error}`);
    const signed = await hub('POST', '/v1/auth/github', { token: polled.access_token });
    if (!signed.json.token) throw new Error(signed.json.why ?? 'The hub refused the sign-in.');
    writeJson(
      join(HOME, 'credentials.json'),
      { url: hubUrl(), login: signed.json.login, token: signed.json.token },
      0o600,
    );
    chmodSync(join(HOME, 'credentials.json'), 0o600);
    console.log(`Signed in to code-kit hub as ${signed.json.login}.`);
    return;
  }
  throw new Error('The sign-in code expired; run signin again.');
}

// --- connect: this repository's code-kit config uses the hub -----------------------------------

// --- the config's team provider, changed in place -------------------------------------------------

const space = (text, i) => {
  while (/\s/.test(text[i] ?? '')) i++;
  return i;
};
const stringEnd = (text, i) => {
  for (i++; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  throw new Error('unterminated string');
};
/** Where the JSON value starting at `i` ends. */
const valueEnd = (text, i) => {
  if (text[i] === '"') return stringEnd(text, i);
  if (text[i] !== '{' && text[i] !== '[') {
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    return i;
  }
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '"') i = stringEnd(text, i) - 1;
    else if (text[i] === '{' || text[i] === '[') depth++;
    else if ((text[i] === '}' || text[i] === ']') && --depth === 0) return i + 1;
  }
  throw new Error('unterminated value');
};
/** An object's members (key, where its line starts, where its value starts and ends), from its `{` at `open`. */
const members = (text, open) => {
  const out = [];
  let i = space(text, open + 1);
  while (text[i] === '"') {
    const keyEnd = stringEnd(text, i);
    const key = JSON.parse(text.slice(i, keyEnd));
    const start = space(text, space(text, keyEnd) + 1);
    const end = valueEnd(text, start);
    out.push({ key, at: i, start, end });
    i = space(text, end);
    if (text[i] === ',') i = space(text, i + 1);
  }
  return out;
};
const indentAt = (text, i) => text.slice(text.lastIndexOf('\n', i - 1) + 1, i).match(/^[ \t]*/)[0];

/**
 * The config's text with `team.provider` set, everything else as it was: its order, its indentation and
 * how its arrays are laid out, so committing it shows only the provider.
 */
export function withTeamProvider(text, provider) {
  const top = members(text, space(text, 0));
  const team = top.find((m) => m.key === 'team');
  if (!team || text[team.start] !== '{') throw new Error('The config has no "team" object.');
  const inside = members(text, team.start);
  const first = inside[0];
  const multiline = first ? text.slice(team.start, first.at).includes('\n') : true;
  const inner = first && multiline ? indentAt(text, first.at) : `${indentAt(text, team.at)}  `;
  const unit = inner.slice(indentAt(text, team.at).length) || '  ';
  const value = multiline
    ? `{\n${Object.entries(provider)
        .map(([k, v]) => `${inner}${unit}${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(',\n')}\n${inner}}`
    : `{ ${Object.entries(provider)
        .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(', ')} }`;
  const had = inside.find((m) => m.key === 'provider');
  const last = inside.at(-1);
  const out = had
    ? text.slice(0, had.start) + value + text.slice(had.end)
    : last
      ? `${text.slice(0, last.end)},${multiline ? `\n${inner}` : ' '}"provider": ${value}${text.slice(last.end)}`
      : `${text.slice(0, team.start + 1)}\n${inner}"provider": ${value}\n${indentAt(text, team.at)}${text.slice(team.start + 1)}`;
  // What was meant, and nothing else: the parsed config is the old one with the provider set.
  const want = JSON.parse(text);
  want.team.provider = provider;
  if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(want))
    throw new Error(
      'Setting the team provider would change more of .claude/code-kit.json than it should.',
    );
  return out;
}

/** The project's MCP servers with the hub's added, as text; null when it's already there. */
export function withHubMcp(text, url) {
  const config = text.trim() ? JSON.parse(text) : {};
  const server = { type: 'http', url: `${url}/mcp` };
  if (JSON.stringify(config.mcpServers?.['code-kit-hub']) === JSON.stringify(server)) return null;
  config.mcpServers = { ...(config.mcpServers ?? {}), 'code-kit-hub': server };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function connect(root) {
  const url = hubUrl();
  const file = join(root, '.claude', 'code-kit.json');
  const config = readJson(file);
  if (!config)
    throw new Error(
      'This repository has no .claude/code-kit.json: set up code-kit first (/code-kit:init).',
    );
  if (!config.team?.techLead)
    throw new Error(
      'Name the tech lead first: "team": { "techLead": "<GitHub handle>" } in .claude/code-kit.json (code-kit spec 16).',
    );
  const provider = { hub: url };
  if (JSON.stringify(config.team.provider) !== JSON.stringify(provider))
    writeFileSync(file, withTeamProvider(readFileSync(file, 'utf8'), provider));
  // Agents reach the hub over MCP: the project's MCP servers name it, for every teammate.
  const mcpFile = join(root, '.mcp.json');
  const mcp = withHubMcp(existsSync(mcpFile) ? readFileSync(mcpFile, 'utf8') : '', url);
  if (mcp) writeFileSync(mcpFile, mcp);
  const state = await provide('state', { fresh: true }, root);
  if (state.unreachable || state.ok === false) {
    console.log(`The config now uses the hub, but the hub says: ${state.why}`);
    return;
  }
  console.log(
    `This repository now coordinates through the hub (${state.claims.length} claims, ${state.intents.length} open intents). Commit .claude/code-kit.json and .mcp.json so the team does too.`,
  );
}

// --- the daemon (HUB-5): the stream, the team's state on disk, presence --------------------------

async function daemon({ root, session, watch }) {
  const dir = stateDir(root);
  const repo = repoOf(originOf(root));
  if (!repo || !credentials()?.token) return;
  const streamFile = join(dir, 'hub-stream.json');
  const eventsFile = join(dir, 'team-events.jsonl');
  writeJson(join(dir, `hub-daemon-${session}.json`), { pid: process.pid, started: Date.now() });
  let lastId = readJson(streamFile, {}).lastId ?? 0;
  let refreshing = null;
  const refresh = () => {
    refreshing ??= (async () => {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const { status, json } = await hub('POST', `/v1/repos/${repo}/state`, {});
        if (status === 200 && json.hub) writeJson(join(dir, 'team.json'), json);
      } catch {
        // the stream's reconnect reports the hub down
      }
      refreshing = null;
    })();
  };
  const presence = async () => {
    const agents = Object.values(
      readJson(join(dir, `hub-presence-${session}.json`), {}).agents ?? {},
    ).filter((a) => Date.now() - a.at < 2 * 60_000);
    try {
      await hub('POST', `/v1/repos/${repo}/presence`, {
        session,
        branch: git(root, 'symbolic-ref', '--short', '-q', 'HEAD'),
        agents: agents.map(({ type, tool, branch }) => ({ type, tool, branch })),
      });
    } catch {
      // reported on the next try
    }
  };
  const tick = setInterval(() => {
    if (watch && !alive(watch)) stop();
    else presence();
  }, PRESENCE_MS);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(tick);
    await hub('POST', `/v1/repos/${repo}/leave`, { session }, { timeoutMs: 3000 }).catch(() => {});
    writeJson(streamFile, { lastId, connected: false });
    try {
      unlinkSync(join(dir, `hub-daemon-${session}.json`));
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await presence();
  refresh();

  let backoff = 1000;
  while (!stopping) {
    try {
      const res = await fetch(`${hubUrl()}/v1/repos/${repo}/stream`, {
        headers: {
          authorization: `Bearer ${credentials()?.token}`,
          ...(lastId ? { 'last-event-id': String(lastId) } : {}),
        },
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        writeJson(streamFile, {
          lastId,
          connected: false,
          why: (await res.json().catch(() => ({}))).why,
        });
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`hub answered ${res.status}`);
      markUp(root);
      writeJson(streamFile, { lastId, connected: true, at: Date.now() });
      backoff = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.id) lastId = event.id;
          // Each event, a line code-kit's mod reads; and the state on disk, for code-kit's hooks.
          appendFileSync(eventsFile, JSON.stringify(event) + '\n');
          writeJson(streamFile, { lastId, connected: true, at: Date.now() });
          refresh();
        }
      }
    } catch {
      markDown(root);
      writeJson(streamFile, { lastId, connected: false, at: Date.now() });
    }
    trim(eventsFile);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function trim(file) {
  try {
    if (statSync(file).size < 512 * 1024) return;
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, lines.slice(-EVENTS_KEPT).join('\n') + '\n');
  } catch {}
}

/** Starts the daemon for a session, detached; one per session. */
export function startDaemon(root, session, watch, url) {
  const dir = stateDir(root);
  const had = readJson(join(dir, `hub-daemon-${session}.json`));
  if (had?.pid && alive(had.pid)) return had.pid;
  const child = spawn(
    process.execPath,
    [
      join(HERE, 'client.mjs'),
      '--url',
      url,
      'daemon',
      '--root',
      root,
      '--session',
      session,
      ...(watch ? ['--watch', String(watch)] : []),
    ],
    {
      detached: true,
      stdio: 'ignore',
      cwd: root,
    },
  );
  child.unref();
  return child.pid;
}

/**
 * The session's agents as the mod last saw them (HUB-4): { [agent id]: { type, tool, branch, at } }, by
 * tool name and branch only, for the daemon to report every 30 seconds.
 */
export function recordPresence(root, session, agents) {
  const id = String(session).replace(/[^\w-]/g, '');
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(agents ?? {})
      .filter(([, a]) => a && now - Number(a.at ?? 0) < 10 * 60_000)
      .map(([k, a]) => [
        k,
        {
          type: typeof a.type === 'string' ? a.type : null,
          tool: typeof a.tool === 'string' ? a.tool : null,
          branch: typeof a.branch === 'string' ? a.branch : null,
          at: Number(a.at),
        },
      ]),
  );
  writeJson(join(stateDir(root), `hub-presence-${id}.json`), { agents: kept });
}

export function stopDaemon(root, session) {
  const had = readJson(join(stateDir(root), `hub-daemon-${session}.json`));
  if (had?.pid && alive(had.pid)) process.kill(had.pid, 'SIGTERM');
}

// --- the command line --------------------------------------------------------------------------

const flag = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(argv) {
  const at = argv.indexOf('--url');
  if (at >= 0) {
    given = argv[at + 1] ?? null;
    argv = [...argv.slice(0, at), ...argv.slice(at + 2)];
  }
  const [cmd, ...args] = argv;
  if (OPS.includes(cmd)) {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let input = {};
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      input = {};
    }
    process.stdout.write(JSON.stringify(await provide(cmd, input)) + '\n');
    return 0;
  }
  if (cmd === 'signin') return signin().then(() => 0);
  if (cmd === 'signout') {
    await hub('DELETE', '/v1/auth').catch(() => {});
    try {
      unlinkSync(join(HOME, 'credentials.json'));
    } catch {}
    console.log('Signed out of code-kit hub on this machine.');
    return 0;
  }
  if (cmd === 'status') {
    const cred = credentials();
    console.log(
      cred?.token ? `Signed in to ${cred.url} as ${cred.login}.` : `Not signed in: run ${SIGN_IN}.`,
    );
    const repo = repoOf(originOf(process.cwd()));
    if (repo && cred?.token) {
      const live = readJson(join(stateDir(process.cwd()), 'hub-stream.json'), {});
      console.log(`${repo}: ${live.connected ? 'live' : (live.why ?? 'not connected')}`);
    }
    return 0;
  }
  if (cmd === 'connect') return connect(process.cwd()).then(() => 0);
  if (cmd === 'drift-model') {
    const choice = args[0];
    let key = '';
    if (choice === 'own') for await (const chunk of process.stdin) key += chunk;
    const repo = repoOf(originOf(process.cwd()));
    const { json } = await hub('PUT', `/v1/repos/${repo}/drift-model`, {
      model: choice,
      ...(key.trim() ? { key: key.trim() } : {}),
    });
    console.log(
      json.ok
        ? `Drift checks for ${repo} now use ${choice === 'own' ? "your team's Anthropic key" : "the hub's model"}.`
        : json.why,
    );
    return json.ok ? 0 : 1;
  }
  if (cmd === 'daemon') {
    await daemon({
      root: flag(args, 'root') ?? process.cwd(),
      session: flag(args, 'session') ?? 'cli',
      watch: Number(flag(args, 'watch')) || null,
    });
    return 0;
  }
  console.error('code-kit team provider signin | signout | status | connect | drift-model hub|own');
  return 2;
}

// Run as a command: code-kit's provider command, its daemon, or `code-kit team provider …`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
