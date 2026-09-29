// What a proposed config changes compared with the live one, in words a person can approve:
// lanes, layers and rules added, removed or changed, and which files would change owner.
import { ownerOf } from './rules.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lists = (a = [], b = []) => ({
  added: b.filter((x) => !a.includes(x)),
  removed: a.filter((x) => !b.includes(x)),
});

/** "+ x, y; - z" for a list field, or null when it didn't change. */
function listChange(name, a, b) {
  const { added, removed } = lists(a, b);
  const parts = [
    added.length && `+ ${added.join(', ')}`,
    removed.length && `- ${removed.join(', ')}`,
  ].filter(Boolean);
  return parts.length ? `${name} ${parts.join('; ')}` : null;
}

/** Lines for a keyed collection: `+` added, `-` removed, `~` changed (with `describe` for the detail). */
function keyed(label, before = {}, after = {}, describe) {
  const lines = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) lines.push(`+ ${label} ${key}: ${describe.summary(after[key])}`);
    else if (!same(before[key], after[key]))
      lines.push(`~ ${label} ${key}: ${describe.change(before[key], after[key])}`);
  }
  for (const key of Object.keys(before)) if (!(key in after)) lines.push(`- ${label} ${key}`);
  return lines;
}

const byName = (items = [], key = 'name') => Object.fromEntries(items.map((i) => [i[key], i]));

const fieldChanges = (a, b, fields) =>
  fields
    .map((f) =>
      Array.isArray(a[f]) || Array.isArray(b[f])
        ? listChange(f, a[f], b[f])
        : same(a[f], b[f])
          ? null
          : `${f} ${JSON.stringify(a[f])} → ${JSON.stringify(b[f])}`,
    )
    .filter(Boolean)
    .join('; ');

const LANE = {
  summary: (l) =>
    `${l.agent}, ${l.paths.join(', ')}${l.exclude?.length ? ` (except ${l.exclude.join(', ')})` : ''}`,
  change: (a, b) => fieldChanges(a, b, ['agent', 'paths', 'exclude']),
};
const LAYER = {
  summary: (l) => `${l.paths.join(', ')} → may import ${l.mayImport.join(', ') || 'nothing'}`,
  change: (a, b) => fieldChanges(a, b, ['paths', 'mayImport', 'denyPackages']),
};
const CHECK = {
  summary: (c) => `${c.run.join(' && ')} when ${c.files.join(', ')} change`,
  change: (a, b) =>
    fieldChanges(a, b, [
      'files',
      'exclude',
      'run',
      'each',
      'owners',
      'ifMissing',
      'timeoutSeconds',
    ]),
};
const RULE = {
  summary: (r) => r.why ?? r.glob ?? JSON.stringify(r),
  change: (a, b) => `${JSON.stringify(a)} → ${JSON.stringify(b)}`,
};

/** Every difference between two raw configs (as written in the file, before defaults). */
export function diffConfigs(before, after) {
  const lines = [
    ...keyed('lane', before.lanes, after.lanes, LANE),
    ...keyed('layer', byName(before.layers), byName(after.layers), LAYER),
    ...keyed('check', byName(before.checks), byName(after.checks), CHECK),
    ...keyed('protected', byName(before.protected, 'glob'), byName(after.protected, 'glob'), RULE),
    ...keyed(
      'blocked command',
      byName(before.shell?.block, 'pattern'),
      byName(after.shell?.block, 'pattern'),
      RULE,
    ),
    ...keyed(
      'restricted command',
      byName(before.shell?.restricted, 'pattern'),
      byName(after.shell?.restricted, 'pattern'),
      RULE,
    ),
    ...keyed('per-file check', byName(before.postEdit, 'run'), byName(after.postEdit, 'run'), RULE),
  ];
  for (const [label, a, b] of [
    ['lead paths', before.lead?.paths, after.lead?.paths],
    ['lead outside paths', before.lead?.outside, after.lead?.outside],
    ['any-actor paths', before.anyActor, after.anyActor],
    ['protected branches', before.branches?.protected, after.branches?.protected],
  ]) {
    const change = listChange('', a, b);
    if (change) lines.push(`~ ${label}:${change}`);
  }
  for (const key of ['docs', 'designGate', 'importAliases']) {
    if (!same(before[key], after[key]))
      lines.push(
        `~ ${key}: ${JSON.stringify(before[key] ?? null)} → ${JSON.stringify(after[key] ?? null)}`,
      );
  }
  return lines;
}

/** Files whose owner differs between two configs (with defaults applied): { file, from, to }. */
export function ownershipMoves(files, before, after) {
  return files
    .map((file) => ({
      file,
      from: ownerOf(file, before) ?? 'nobody',
      to: ownerOf(file, after) ?? 'nobody',
    }))
    .filter((m) => m.from !== m.to);
}
