// Teams (docs/specs/16-teams.md): several people in one repository, each with their own agents. This
// file holds the team's part of the config (TEAM-1) and who the developer at this machine is.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
