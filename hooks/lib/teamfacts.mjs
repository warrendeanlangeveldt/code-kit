// Teams (docs/specs/16-teams.md), the pure parts: names, story branches, staleness and what an intent
// touches. Shared by the hooks and CLI (team.mjs) and the mod, which runs without Node.

export const INTENT_LABEL = 'code-kit:intent';

/** A GitHub handle: letters, digits and single hyphens, at most 39 characters. */
export const isHandle = (h) =>
  typeof h === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(h);

/** A story id a ref can carry: ST-12, AUTH-3. */
export const isStoryId = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(s);

/** The paths an intent touches, from its issue's body ("Touches: a/**, b"). */
export const touchesOf = (body) =>
  (String(body ?? '').match(/^Touches:\s*(.+)$/m)?.[1] ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);

/** Whole working days (Monday to Friday) from `from` to `to`, both in ms. */
export function workingDaysBetween(from, to) {
  let days = 0;
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days += 1;
  }
  return days;
}

/** TEAM-9: a claim with when it was last worked on (claimed, or its branch pushed) and whether it's stale. */
export function withStaleness(claim, lastPush, staleDays, now = Date.now()) {
  const active = Math.max(Date.parse(claim.at) || 0, lastPush ?? 0);
  return {
    ...claim,
    active: new Date(active).toISOString(),
    stale: workingDaysBetween(active, now) >= staleDays,
  };
}

/** The story a branch is for: web/st-4 → ST-4. Null for any other branch. */
export const storyOfBranch = (branch) => {
  const m = String(branch ?? '').match(/^[a-z][a-z0-9-]*\/([a-z][a-z0-9]*-\d+)$/i);
  return m ? m[1].toUpperCase() : null;
};

/** The lane a story branch is in: web/st-4 → web. */
export const laneOfBranch = (branch) => (storyOfBranch(branch) ? branch.split('/')[0] : null);

/** Whether two path globs can name the same file: one's fixed start begins the other's. */
export function globsOverlap(a, b) {
  const fixed = (g) => g.split(/[*?{]/)[0];
  const [x, y] = [fixed(a), fixed(b)];
  return x.startsWith(y) || y.startsWith(x);
}
