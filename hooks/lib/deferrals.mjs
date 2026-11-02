// LOOP-15: stories the lead holds on purpose, until a date or until it releases them, with why. A held
// story isn't dispatched, reviewed or merged by `code-kit next`, the loop or the merge queue, so a lead
// waiting on something outside the build (a person's answer elsewhere, a partner's release, a date) isn't
// asked about the same story again every half hour. Kept in the main checkout beside the merge queue, so
// every worktree and a restarted session see the same.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectWorktrees } from './rules.mjs';

export const DEFERRED_FILE = '.claude/state/deferred.json';

const deferredFile = (root) => join(projectWorktrees(root)[0] ?? root, DEFERRED_FILE);

/** Every hold recorded, past ones included: [{ story, reason, until, at, session? }]. */
function readAll(root) {
  try {
    const list = JSON.parse(readFileSync(deferredFile(root), 'utf8'));
    return Array.isArray(list) ? list.filter((h) => h && typeof h.story === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(root, list) {
  const file = deferredFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
}

/** Whether a hold is still in force at `now`: no end, or an end still to come. */
const inForce = (h, now) => !h.until || Date.parse(h.until) > now;

/** The holds in force, in the order they were made: [{ story, reason, until, at, session? }]. */
export function activeDeferrals(root, now = Date.now()) {
  return readAll(root).filter((h) => inForce(h, now));
}

/**
 * What `--until` says, as an ISO time, or { error } in words. A date (2026-11-10) holds until that day
 * begins, in local time; an ISO time holds until then. A time already past holds nothing.
 */
export function parseUntil(text, now = Date.now()) {
  if (text === undefined || text === null) return { until: null };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime()))
    return {
      error: `--until ${text} isn't a date (2026-11-10) or an ISO time (2026-11-10T09:00:00+10:00).`,
    };
  if (date.getTime() <= now)
    return { error: `--until ${text} has already passed; give a date or time still to come.` };
  return { until: date.toISOString() };
}

/**
 * Holds each of `stories` (upper-cased ids) with `reason`, until `until` (ISO) or until released. A
 * story already held takes the new reason and end. Returns the holds made.
 */
export function deferStories(
  root,
  stories,
  { reason, until = null, session = null },
  now = Date.now(),
) {
  const ids = [...new Set(stories.map((s) => s.toUpperCase()))];
  const at = new Date(now).toISOString();
  const made = ids.map((story) => ({
    story,
    reason,
    until,
    at,
    ...(session ? { session } : {}),
  }));
  // Holds that ended are dropped as the list is written: only those in force are worth keeping.
  writeAll(root, [
    ...readAll(root).filter((h) => inForce(h, now) && !ids.includes(h.story)),
    ...made,
  ]);
  return made;
}

/** Releases each of `stories`; returns the holds it ended (none for a story that wasn't held). */
export function releaseStories(root, stories, now = Date.now()) {
  const ids = new Set(stories.map((s) => s.toUpperCase()));
  const all = readAll(root);
  const ended = all.filter((h) => ids.has(h.story) && inForce(h, now));
  if (ended.length || all.some((h) => !inForce(h, now)))
    writeAll(
      root,
      all.filter((h) => !ids.has(h.story) && inForce(h, now)),
    );
  return ended;
}

/** A local time as "2026-11-10", or "2026-11-10 09:30" when it isn't midnight. */
function localTime(iso) {
  const d = new Date(iso);
  const two = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return d.getHours() || d.getMinutes()
    ? `${day} ${two(d.getHours())}:${two(d.getMinutes())}`
    : day;
}

/** A hold in words: "ST-4 is held until 2026-11-10: waiting on the partner's API". */
export function deferralWords(h) {
  return `${h.story} is held${h.until ? ` until ${localTime(h.until)}` : ''}: ${h.reason}`;
}
