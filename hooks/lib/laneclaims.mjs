// One agent per lane, across every session in the project (docs/specs/23-the-team.md, SCHED-1). Two
// agents in one lane build on overlapping files in their worktrees and conflict at merge; the plan's
// graph is for running different lanes at once. Starting a lane's agent claims the lane, and the claim
// ends when the agent finishes, its session ends, or the lead releases a lane whose agent has stopped.
// Kept in the main checkout, one file per lane, so every session and worktree on the machine sees them,
// and two agents started in the same moment can't both take a lane: the file is created exclusively.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const LANE_CLAIMS_DIR = '.claude/state/lanes';
/** A claim this old is taken to be left over from an agent nobody saw stop. */
export const LANE_CLAIM_STALE_MS = 12 * 3600_000;

const dirOf = (root) => join(projectWorktrees(root)[0] ?? root, LANE_CLAIMS_DIR);
const fileOf = (root, lane) => join(dirOf(root), `${lane.replace(/[^\w.-]/g, '_')}.json`);

/** A session's id as people read it: its first 8 characters. */
export const shortSession = (session) => (session ? String(session).slice(0, 8) : null);

function read(root, lane) {
  try {
    return JSON.parse(readFileSync(fileOf(root, lane), 'utf8'));
  } catch {
    return null;
  }
}

const withAge = (claim, now) =>
  claim && { ...claim, stale: now - Date.parse(claim.since) >= LANE_CLAIM_STALE_MS };

/** Every lane claimed now: [{ lane, story, session, since, stale }], by lane. */
export function laneClaims(root, now = Date.now()) {
  let files = [];
  try {
    files = readdirSync(dirOf(root)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return withAge(JSON.parse(readFileSync(join(dirOf(root), f), 'utf8')), now);
      } catch {
        return null;
      }
    })
    .filter((c) => c?.lane)
    .sort((a, b) => a.lane.localeCompare(b.lane));
}

/** The lane's claim, or null. */
export const laneClaim = (root, lane, now = Date.now()) => withAge(read(root, lane), now);

/**
 * SCHED-1: claims `lane` for `story` in `session`: { ok: true } or { ok: false, claim } naming who has it.
 * The session already holding it for the same story (a restart, a send-back) takes it again; so does
 * anyone, from a stale claim.
 */
export function claimLane(root, { lane, story = null, session = null }, now = Date.now()) {
  const record = { lane, story, session, since: new Date(now).toISOString() };
  mkdirSync(dirOf(root), { recursive: true });
  try {
    writeFileSync(fileOf(root, lane), `${JSON.stringify(record)}\n`, { flag: 'wx' });
    return { ok: true };
  } catch {
    // held already: by whom, and whether it may be taken over
  }
  const held = laneClaim(root, lane, now);
  const same = held && held.session === session && (held.story === story || !held.story);
  if (held && !same && !held.stale) return { ok: false, claim: held };
  writeFileSync(fileOf(root, lane), `${JSON.stringify(record)}\n`);
  return { ok: true };
}

/** Ends the lane's claim; with `session`, only that session's. True when one ended. */
export function releaseLane(root, lane, { session = null } = {}) {
  const held = read(root, lane);
  if (!held || (session && held.session !== session)) return false;
  rmSync(fileOf(root, lane), { force: true });
  return true;
}

/** Ends every claim a session holds, as it ends: the lanes it named. */
export function releaseSession(root, session, now = Date.now()) {
  const ended = laneClaims(root, now).filter((c) => c.session === session);
  for (const c of ended) releaseLane(root, c.lane, { session });
  return ended.map((c) => c.lane);
}
