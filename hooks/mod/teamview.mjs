// Teams in the mod (docs/specs/16-teams.md, TEAM-7, TEAM-9, TEAM-13), the pure parts: what of the team's
// state needs this person, as band lines, and the Team pane. It reads `code-kit team --json` and
// `code-kit team since --json`; the CLI and the hooks do the rest. Whatever coordinates the team (GitHub,
// or a hosted provider) is only named as its state names itself.
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

export const TEAM_ID = 'code-kit-team';

/** TEAM-7: the Team pane's tabs. Drift is there only when the provider checks for it. */
export const TEAM_TABS = [
  { id: 'people', label: 'People', hotkey: '1' },
  { id: 'activity', label: 'Since you looked', hotkey: '2' },
  { id: 'claims', label: 'Claims', hotkey: '3' },
  { id: 'intents', label: 'Intents', hotkey: '4' },
  { id: 'drift', label: 'Drift', hotkey: '5' },
  { id: 'setup', label: 'Setup', hotkey: '6' },
];

export const DEFAULT_TEAM_UI = { tab: 'people', reassign: null, handle: '' };

const clock = (iso) =>
  new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

/** What coordinates the team, and how it's doing, in a line: the provider's own name for itself. */
export function providerLine(team) {
  const p = team.provider ?? null;
  const name = p?.name ?? 'the team provider';
  if (team.reachable === false)
    return {
      text: `${name} can't be reached${team.why ? ` (${team.why})` : ''}: claims and leases aren't checked until it can be.`,
      color: 'yellow',
    };
  if (team.fallback)
    return {
      text: `${name} can't be reached (${team.fallback}): claims are checked through GitHub until it's back.`,
      color: 'yellow',
    };
  const parts = [
    `Through ${name}`,
    p?.live ? 'live' : null,
    p?.account ? `signed in as ${p.account}` : null,
  ].filter(Boolean);
  return {
    text: `${parts.join(' · ')}${p?.detail ? `: ${p.detail}` : ''}`,
    color: p?.live ? 'green' : null,
  };
}

/**
 * TEAM-6, TEAM-7, TEAM-13: the Team pane. `view` is { team, since, config, ui }: `team` is
 * `code-kit team --json`, `since` is `team since --json` (read when that tab opens), `config` the team
 * section and lanes as `code-kit check --json` reports them. `on` acts: onTab(id), onNeed(id, line) as
 * the band's buttons do, onReassign(story | null), onHandle(text), onReassignTo(story, handle) and
 * onSetup() (asks the lead to run the team's init).
 */
export function teamFrame(view, els, on) {
  const { Box, Text, Button, Input } = els;
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const { team, since = null, config = null, ui = DEFAULT_TEAM_UI } = view;
  if (!team)
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        text("The team's state couldn't be read: run code-kit team to see why.", {
          color: 'yellow',
        }),
        Button({
          key: 'team-setup',
          label: 'Set up the team',
          variant: 'primary',
          onPress: () => on.onSetup(),
        }),
      ],
    });
  const me = team.me;
  const lead = team.techLead;
  const drifts = Array.isArray(team.findings);
  const tabs = TEAM_TABS.filter((t) => t.id !== 'drift' || drifts);
  const tab = tabs.some((t) => t.id === ui.tab) ? ui.tab : 'people';
  const myLanes = Object.entries(team.owners ?? {})
    .filter(([, people]) => people.includes(me))
    .map(([lane]) => lane);
  const provider = providerLine(team);
  const setup = team.setup ?? [];
  const header = Box({
    key: 'team-header',
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 2,
        flexWrap: 'wrap',
        children: [
          text(`tech lead ${lead}`, { bold: true }),
          text(
            me
              ? `you are ${me}${me === lead ? ', the tech lead' : ''}${myLanes.length ? ` · own ${myLanes.join(', ')}` : ''}`
              : "you aren't signed in to GitHub (gh auth login)",
            me ? { dimColor: true } : { color: 'yellow' },
          ),
          text(
            `${team.claims.length} claimed · ${team.intents.length} intent${team.intents.length === 1 ? '' : 's'} open · ${team.pulls.length} pull request${team.pulls.length === 1 ? '' : 's'}`,
            { dimColor: true },
          ),
        ],
      }),
      Box({
        key: 'team-provider',
        children: [
          text(provider.text, {
            wrap: 'wrap',
            ...(provider.color ? { color: provider.color } : { dimColor: true }),
          }),
        ],
      }),
      ...(setup.length
        ? [
            Box({
              key: 'team-setup-count',
              children: [
                text(
                  `${setup.length} thing${setup.length === 1 ? '' : 's'} to set up: see Setup (6).`,
                  { color: 'yellow' },
                ),
              ],
            }),
          ]
        : []),
    ],
  });
  const tabRow = Box({
    key: 'team-tabs',
    flexDirection: 'row',
    columnGap: 1,
    children: tabs.map((t) =>
      Button({
        key: `team-tab-${t.id}`,
        label: t.label,
        hotkey: t.hotkey,
        ...(tab === t.id ? { variant: 'primary' } : { dimColor: true }),
        onPress: () => on.onTab(t.id),
      }),
    ),
  });
  const body =
    tab === 'activity'
      ? activityTab(team, since, els)
      : tab === 'claims'
        ? claimsTab(team, ui, els, on)
        : tab === 'intents'
          ? intentsTab(team, els, on)
          : tab === 'drift'
            ? driftTab(team, els)
            : tab === 'setup'
              ? setupTab(team, config, els, on)
              : peopleTab(team, els, on);
  return Box({ flexDirection: 'column', rowGap: 1, children: [header, tabRow, ...body] });
}

/** Each person, the tech lead first: where they're at work, their claims, pull requests and intents. */
function peopleTab(team, { Box, Text }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  return peopleOf(team).map((who) => {
    const lanes = Object.entries(team.owners ?? {})
      .filter(([, people]) => people.includes(who))
      .map(([lane]) => lane);
    const role = [
      who === team.techLead ? 'tech lead' : null,
      who === team.me ? 'you' : null,
      lanes.length ? `owns ${lanes.join(', ')}` : null,
    ].filter(Boolean);
    const line = (key, value, style = {}) =>
      Box({ key, children: [text(`  ${value}`, { wrap: 'truncate-end', ...style })] });
    const items = [
      // A live provider's presence: where each of their sessions is, and what its agents are doing.
      ...(team.sessions ?? [])
        .filter((x) => x.login === who)
        .map((x, n) =>
          line(
            `team-session-${who}-${n}`,
            x.away
              ? `away (last seen ${clock(x.seen)})`
              : `at work on ${x.branch ?? 'no branch'}${x.agents.length ? `: ${x.agents.map((a) => `${a.type ?? 'an agent'}${a.story ? ` on ${a.story}` : ''}${a.tool ? ` (${a.tool})` : ''}`).join(', ')}` : ''}`,
            x.away ? { dimColor: true } : { color: 'green' },
          ),
        ),
      ...(team.findings ?? [])
        .filter((f) => f.by === who)
        .map((f) =>
          line(`team-finding-${f.id}`, `drift on ${f.branch} (${f.severity}): ${f.text}`, {
            wrap: 'wrap',
            color: f.severity === 'blocker' ? 'red' : f.severity === 'note' ? undefined : 'yellow',
          }),
        ),
      ...team.claims
        .filter((c) => c.by === who)
        .map((c) =>
          line(
            `team-claim-${c.story}`,
            `${c.story}${c.stale ? ` · stale since ${day(c.active)}` : ''}${c.lease.length ? ` · ${c.lease.join(', ')}` : ''}`,
            c.stale ? { color: 'yellow' } : {},
          ),
        ),
      ...team.pulls
        .filter((p) => p.by === who)
        .map((p) =>
          line(
            `team-pull-${p.number}`,
            `#${p.number} ${p.title} (${p.branch}${p.draft ? ', draft' : ''})`,
          ),
        ),
      ...team.intents
        .filter((i) => i.by === who)
        .map((i) =>
          line(
            `team-intent-${i.id}`,
            `intends: ${i.about}${i.touches.length ? ` · ${i.touches.join(', ')}` : ''}`,
            {
              color: 'cyan',
            },
          ),
        ),
    ];
    return Box({
      key: `team-person-${who}`,
      flexDirection: 'column',
      children: [
        text(`${who}${role.length ? ` · ${role.join(' · ')}` : ''}`, { bold: true }),
        ...(items.length ? items : [text('  nothing open', { dimColor: true })]),
      ],
    });
  });
}

/** TEAM-6: what everyone did since you last looked; opening the tab marks it read. */
function activityTab(team, since, { Box, Text }) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const people = Object.entries(since?.people ?? {});
  return [
    Box({
      key: 'team-since',
      flexDirection: 'column',
      children: [
        text(
          since?.since
            ? `Since ${new Date(since.since).toLocaleString('en-AU', { timeZone: 'UTC' })}`
            : 'Since you last looked',
          { bold: true },
        ),
        ...(since?.github === false
          ? [text("GitHub's activity couldn't be read: claims only.", { color: 'yellow' })]
          : []),
        ...(people.length
          ? people.map(([who, events]) =>
              Box({
                key: `since-${who}`,
                flexDirection: 'column',
                children: [
                  text(`${who}${who === team.me ? ' (you)' : ''}`, { bold: true }),
                  ...events.map((e, n) =>
                    Box({
                      key: `since-${who}-${n}`,
                      children: [text(`  ${e.text}`, { wrap: 'wrap' })],
                    }),
                  ),
                ],
              }),
            )
          : [text('Nothing new.', { dimColor: true })]),
      ],
    }),
  ];
}

/**
 * TEAM-9: every claim, with Keep and Release on yours, and for the tech lead Release and Reassign on
 * anyone's. Reassign asks for the new holder's handle.
 */
function claimsTab(team, ui, { Box, Text, Button, Input }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!team.claims.length) return [text('Nothing is claimed.', { dimColor: true })];
  const leading = team.me && team.me === team.techLead;
  return team.claims.map((c) => {
    const mine = c.by === team.me;
    const line = { kind: 'teamStale', claim: c };
    return Box({
      key: `team-claims-${c.story}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(c.story, { bold: true }),
            text(`${c.by}${mine ? ' (you)' : ''}`),
            text(
              c.stale ? `stale since ${day(c.active)}` : `since ${day(c.at)}`,
              c.stale ? { color: 'yellow' } : { dimColor: true },
            ),
            ...(mine
              ? [
                  Button({
                    key: `team-keep-${c.story}`,
                    label: 'Keep',
                    onPress: () => on.onNeed('keepClaim', line),
                  }),
                ]
              : []),
            ...(mine || leading
              ? [
                  Button({
                    key: `team-release-${c.story}`,
                    label: 'Release',
                    onPress: () => on.onNeed('releaseClaim', line),
                  }),
                ]
              : []),
            ...(leading
              ? [
                  Button({
                    key: `team-reassign-${c.story}`,
                    label: 'Reassign',
                    onPress: () => on.onReassign(ui.reassign === c.story ? null : c.story),
                  }),
                ]
              : []),
          ],
        }),
        text(`  ${c.lease.length ? `leases ${c.lease.join(', ')}` : 'no lease'}`, {
          dimColor: true,
          wrap: 'truncate-end',
        }),
        ...(leading && ui.reassign === c.story
          ? [
              Input({
                key: `team-reassign-to-${c.story}`,
                label: `Give ${c.story} to`,
                value: ui.handle ?? '',
                placeholder: 'their GitHub handle',
                submitLabel: 'Reassign',
                autoFocus: true,
                onInput: (v) => on.onHandle(v),
                onSubmit: (v) => on.onReassignTo(c.story, v),
              }),
            ]
          : []),
      ],
    });
  });
}

/** TEAM-5: the open intents, with Agree and Drop for the tech lead. */
function intentsTab(team, { Box, Text, Button }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  if (!team.intents.length)
    return [
      text(
        'No open intents. An agent raises one (code-kit intend) before changing what others rely on.',
        { dimColor: true },
      ),
    ];
  const leading = team.me && team.me === team.techLead;
  return team.intents.map((i) =>
    Box({
      key: `team-intents-${i.id}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            text(`#${i.id}`, { bold: true }),
            text(i.about, { color: 'cyan', wrap: 'truncate-end' }),
            text(`${i.by}${i.by === team.me ? ' (you)' : ''}`, { dimColor: true }),
            ...(leading && i.by !== team.me
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
        text(
          `  ${i.touches.length ? `touches ${i.touches.join(', ')}` : 'touches nothing named'}${i.url ? ` · ${i.url}` : ''}`,
          {
            dimColor: true,
            wrap: 'truncate-end',
          },
        ),
      ],
    }),
  );
}

/** A provider's drift checks (the hub's): each branch's findings, worst first. */
function driftTab(team, { Box, Text }) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const rank = { blocker: 0, concern: 1, note: 2 };
  const findings = [...team.findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
  if (!findings.length)
    return [text('No drift found on the branches at work.', { dimColor: true })];
  const branches = [...new Set(findings.map((f) => f.branch))];
  return branches.map((branch) =>
    Box({
      key: `team-drift-${branch}`,
      flexDirection: 'column',
      children: [
        text(
          `${branch}${findings.find((f) => f.branch === branch)?.by ? ` · ${findings.find((f) => f.branch === branch).by}` : ''}`,
          { bold: true },
        ),
        ...findings
          .filter((f) => f.branch === branch)
          .map((f) =>
            Box({
              key: `team-drift-${f.id}`,
              children: [
                text(`  ${f.severity} · ${f.conflictsWith}: ${f.text}`, {
                  wrap: 'wrap',
                  color:
                    f.severity === 'blocker'
                      ? 'red'
                      : f.severity === 'concern'
                        ? 'yellow'
                        : undefined,
                  dimColor: f.severity === 'note',
                }),
              ],
            }),
          ),
      ],
    }),
  );
}

/** TEAM-13: the team's setup as the config has it, what's still missing, and a way to change it. */
function setupTab(team, config, { Box, Text, Button }, on) {
  const text = (value, style = {}) => Text({ ...style, children: [value] });
  const t = config ?? {};
  const owners = Object.entries(team.owners ?? {});
  const unowned = Object.keys(config?.lanes ?? {}).filter((l) => !(team.owners ?? {})[l]);
  const rows = [
    ['Tech lead', team.techLead],
    ['Stale after', `${team.staleDays ?? t.staleDays ?? 3} working days without a push`],
    ['Intents', `discussions in "${t.intents ?? 'Intents'}"`],
    [
      'Provider',
      team.provider?.name ?? (typeof t.provider === 'object' ? t.provider.command : 'GitHub'),
    ],
    ...(typeof t.provider === 'object' && t.provider.fallback
      ? [['Fallback', 'GitHub, while the provider is down']]
      : []),
    ...(t.board ? [['Board', `${t.board.owner}/${t.board.number}`]] : []),
    ...owners.map(([lane, people]) => [`Lane ${lane}`, people.join(', ')]),
    ...(unowned.length
      ? [['Unowned lanes', `${unowned.join(', ')}: whoever claims a story first`]]
      : []),
  ];
  const setup = team.setup ?? [];
  return [
    Box({
      key: 'team-config',
      flexDirection: 'column',
      children: rows.map(([k, v]) =>
        Box({
          key: `team-config-${k}`,
          flexDirection: 'row',
          columnGap: 1,
          children: [text(k.padEnd(14), { dimColor: true }), text(v, { wrap: 'truncate-end' })],
        }),
      ),
    }),
    Box({
      key: 'team-todo',
      flexDirection: 'column',
      children: setup.length
        ? [
            text('Still to set up', { bold: true }),
            ...setup.map((s, n) =>
              Box({
                key: `team-todo-${n}`,
                children: [text(`  ${s}`, { wrap: 'wrap', color: 'yellow' })],
              }),
            ),
          ]
        : [
            text('Nothing missing: claims and intents work for everyone signed in.', {
              color: 'green',
            }),
          ],
    }),
    Button({
      key: 'team-setup',
      label: 'Change the team setup',
      onPress: () => on.onSetup(),
    }),
  ];
}
