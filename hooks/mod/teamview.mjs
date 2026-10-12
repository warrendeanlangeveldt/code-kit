// Teams in the mod (docs/specs/16-teams.md, TEAM-7, TEAM-9), the pure parts: what of the team's state
// needs this person, as band lines, and the Team tab. It reads `code-kit team --json` and
// `code-kit team since --json`; the CLI and the hooks do the rest.
import { globsOverlap, laneOfBranch } from '../lib/teamfacts.mjs';

const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'a while'
    : d.toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
};

/** What the person owns or is building: their lanes' paths and their claims' leases. */
function yoursOf(team, lanes = {}) {
  const owned = Object.entries(team.owners ?? {})
    .filter(([, people]) => people.includes(team.me))
    .flatMap(([lane]) => lanes[lane]?.paths ?? []);
  const leased = team.claims.filter((c) => c.by === team.me).flatMap((c) => c.lease);
  return [...owned, ...leased];
}

const overlapping = (globs, others) => [
  ...new Set(globs.filter((g) => others.some((o) => globsOverlap(g, o)))),
];

/**
 * TEAM-7, TEAM-9: band lines for what of the team needs this person, and only that: their stale
 * claims (Keep or Release), a claim of theirs sharing files with someone else's, intents touching what
 * they own or lease (every open intent, for the tech lead, with Agree and Drop), and reviews in lanes
 * they own. `team` is `code-kit team --json`; `lanes` the config's lanes, for their paths.
 */
export function teamLines(team, lanes = {}) {
  if (!team) return [];
  const lines = [];
  if (team.reachable === false)
    lines.push({
      kind: 'teamDown',
      text: "team: the shared repository can't be reached, so claims aren't checked",
      actions: [],
    });
  else if (team.fallback)
    lines.push({
      kind: 'teamDown',
      text: "team: the team's provider can't be reached, so claims are checked through GitHub until it's back",
      actions: [],
    });
  const me = team.me;
  if (!me) return lines;
  const mine = team.claims.filter((c) => c.by === me);
  for (const c of mine.filter((x) => x.stale))
    lines.push({
      kind: 'teamStale',
      text: `Still on ${c.story}? Nothing on it since ${day(c.active)}`,
      claim: c,
      story: { id: c.story },
      actions: [
        { id: 'keepClaim', label: 'Keep' },
        { id: 'releaseClaim', label: 'Release' },
      ],
    });
  for (const c of mine)
    for (const o of team.claims.filter((x) => x.by !== me)) {
      const shared = overlapping(c.lease, o.lease);
      if (shared.length)
        lines.push({
          kind: 'teamCollision',
          text: `${c.story} and ${o.by}'s ${o.story} both change ${shared.join(', ')}`,
          claim: c,
          other: o,
          story: { id: c.story },
          actions: [{ id: 'team', label: 'Team' }],
        });
    }
  const yours = yoursOf(team, lanes);
  const leading = me === team.techLead;
  for (const i of team.intents.filter((x) => x.by !== me)) {
    const touched = overlapping(i.touches, yours);
    if (!leading && !touched.length) continue;
    lines.push({
      kind: 'teamIntent',
      text: `${i.by} intends: ${i.about}${touched.length ? ' (touches yours)' : ''}`,
      intent: i,
      actions: leading
        ? [
            { id: 'agreeIntent', label: 'Agree' },
            { id: 'dropIntent', label: 'Drop' },
            { id: 'team', label: 'Team' },
          ]
        : [{ id: 'team', label: 'Team' }],
    });
  }
  // A provider's drift check (the hub's): findings on this person's branches or claimed stories.
  const myBranches = new Set([
    ...team.pulls.filter((p) => p.by === me).map((p) => p.branch),
    ...(team.sessions ?? []).filter((s) => s.login === me).map((s) => s.branch),
  ]);
  for (const f of (team.findings ?? []).filter(
    (x) => x.severity !== 'note' && (x.by === me || myBranches.has(x.branch)),
  ))
    lines.push({
      kind: 'teamDrift',
      text: `drift on ${f.branch}: ${f.text}`,
      finding: f,
      actions: [{ id: 'team', label: 'Team' }],
    });
  for (const p of team.pulls.filter((x) => x.by !== me && !x.draft)) {
    const lane = laneOfBranch(p.branch);
    if (lane && team.owners?.[lane]?.includes(me))
      lines.push({
        kind: 'teamReview',
        text: `${p.by}'s #${p.number} ${p.title} is in your ${lane} lane and waits for your review`,
        pull: p,
        actions: [{ id: 'team', label: 'Team' }],
      });
  }
  return lines;
}

/** The people on the team, the tech lead first, then everyone named by an owner, claim, intent or pull. */
export function peopleOf(team) {
  const named = [
    team.techLead,
    ...Object.values(team.owners ?? {}).flat(),
    ...team.claims.map((c) => c.by),
    ...team.intents.map((i) => i.by),
    ...team.pulls.map((p) => p.by),
    ...(team.sessions ?? []).map((s) => s.login),
    team.me,
  ].filter(Boolean);
  return [...new Set(named)];
}

/**
 * TEAM-6, TEAM-7: the Team tab: since you last looked, then each person with the lanes they own, their
 * claims (stale ones marked, with Keep and Release for yours), their pull requests and their intents
 * (Agree and Drop for the tech lead). `on.onNeed(id, line)` acts as the band's buttons do.
 */
export function teamTab(team, since, { Box, Text, Button }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!team) return [];
  const rows = [];
  if (team.reachable === false)
    rows.push(
      text(
        "The shared repository can't be reached: claims and leases aren't checked until it can be.",
        {
          color: 'yellow',
        },
      ),
    );
  const sincePeople = Object.entries(since?.people ?? {});
  rows.push(text('Since you last looked', { bold: true }));
  rows.push(
    Box({
      key: 'team-since',
      flexDirection: 'column',
      children: sincePeople.length
        ? sincePeople.map(([who, events]) =>
            Box({
              key: `since-${who}`,
              children: [
                text(
                  `  ${who}${who === team.me ? ' (you)' : ''}: ${events.map((e) => e.text).join('; ')}`,
                  {
                    wrap: 'wrap',
                  },
                ),
              ],
            }),
          )
        : [text('  Nothing new.', { dimColor: true })],
    }),
  );
  for (const who of peopleOf(team)) {
    const lanes = Object.entries(team.owners ?? {})
      .filter(([, people]) => people.includes(who))
      .map(([lane]) => lane);
    const claims = team.claims.filter((c) => c.by === who);
    const pulls = team.pulls.filter((p) => p.by === who);
    const intents = team.intents.filter((i) => i.by === who);
    // A live provider's presence: where each of their sessions is, and what its agents are doing.
    const sessions = (team.sessions ?? []).filter((x) => x.login === who);
    const findings = (team.findings ?? []).filter((f) => f.by === who);
    const role = [
      who === team.techLead ? 'tech lead' : null,
      who === team.me ? 'you' : null,
      lanes.length ? `owns ${lanes.join(', ')}` : null,
    ].filter(Boolean);
    const items = [
      ...sessions.map((x, n) =>
        Box({
          key: `team-session-${who}-${n}`,
          children: [
            text(
              x.away
                ? `  away (last seen ${new Date(x.seen).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })})`
                : `  at work on ${x.branch ?? 'no branch'}${x.agents.length ? `: ${x.agents.map((a) => `${a.type ?? 'an agent'}${a.story ? ` on ${a.story}` : ''}${a.tool ? ` (${a.tool})` : ''}`).join(', ')}` : ''}`,
              { wrap: 'truncate-end', ...(x.away ? { dimColor: true } : { color: 'green' }) },
            ),
          ],
        }),
      ),
      ...findings.map((f) =>
        Box({
          key: `team-finding-${f.id}`,
          children: [
            text(`  drift on ${f.branch} (${f.severity}): ${f.text}`, {
              wrap: 'wrap',
              color: f.severity === 'blocker' ? 'red' : 'yellow',
            }),
          ],
        }),
      ),
      ...claims.map((c) =>
        Box({
          key: `team-claim-${c.story}`,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(
              `  ${c.story}${c.stale ? ` · stale since ${day(c.active)}` : ''}${c.lease.length ? ` · ${c.lease.join(', ')}` : ''}`,
              { wrap: 'truncate-end', ...(c.stale ? { color: 'yellow' } : {}) },
            ),
            ...(who === team.me && c.stale
              ? [
                  Button({
                    key: `team-keep-${c.story}`,
                    label: 'Keep',
                    onPress: () => on.onNeed('keepClaim', { kind: 'teamStale', claim: c }),
                  }),
                  Button({
                    key: `team-release-${c.story}`,
                    label: 'Release',
                    onPress: () => on.onNeed('releaseClaim', { kind: 'teamStale', claim: c }),
                  }),
                ]
              : []),
          ],
        }),
      ),
      ...pulls.map((p) =>
        Box({
          key: `team-pull-${p.number}`,
          children: [
            text(`  #${p.number} ${p.title} (${p.branch}${p.draft ? ', draft' : ''})`, {
              wrap: 'truncate-end',
            }),
          ],
        }),
      ),
      ...intents.map((i) =>
        Box({
          key: `team-intent-${i.id}`,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(`  intends: ${i.about}${i.touches.length ? ` · ${i.touches.join(', ')}` : ''}`, {
              wrap: 'truncate-end',
              color: 'cyan',
            }),
            ...(team.me === team.techLead && i.by !== team.me
              ? [
                  Button({
                    key: `team-agree-${i.id}`,
                    label: 'Agree',
                    onPress: () => on.onNeed('agreeIntent', { kind: 'teamIntent', intent: i }),
                  }),
                  Button({
                    key: `team-drop-${i.id}`,
                    label: 'Drop',
                    onPress: () => on.onNeed('dropIntent', { kind: 'teamIntent', intent: i }),
                  }),
                ]
              : []),
          ],
        }),
      ),
    ];
    rows.push(
      Box({
        key: `team-person-${who}`,
        flexDirection: 'column',
        children: [
          text(`${who}${role.length ? ` · ${role.join(' · ')}` : ''}`, { bold: true }),
          ...(items.length ? items : [text('  nothing open', { dimColor: true })]),
        ],
      }),
    );
  }
  return rows;
}
