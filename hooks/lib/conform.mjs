// Existing code brought to the project's standards (spec 30). A standard the code doesn't meet yet is
// adopted with its breaches recorded in the baseline, file by file, so new code is held to it while the
// old is refactored: in a conformance milestone of its own (CONF-4), and in every file a story changes
// (CONF-5). Like the layers' baseline, the breaches only shrink, except for a standard the branch adopts.
import { posix } from 'node:path';
import { layerOf } from './layers.mjs';
import { laneOf } from './rules.mjs';
import { parseStandards } from './standards.mjs';

/** The most files one refactor story takes, so each stays reviewable. */
export const FILES_PER_STORY = 5;

/** { id: { file: [breach] } } from a baseline's raw JSON, keeping only what reads. */
export function breachesOf(raw) {
  const out = {};
  for (const [id, files] of Object.entries(raw?.standards ?? {})) {
    if (!files || typeof files !== 'object') continue;
    for (const [file, list] of Object.entries(files)) {
      const kept = (Array.isArray(list) ? list : []).filter(
        (b) => typeof b === 'string' && b.trim(),
      );
      if (kept.length) (out[id] ??= {})[file] = kept;
    }
  }
  return out;
}

/** The breaches as a flat list: [{ id, file, breach }]. */
export const breachList = (breaches) =>
  Object.entries(breaches).flatMap(([id, files]) =>
    Object.entries(files).flatMap(([file, list]) => list.map((breach) => ({ id, file, breach }))),
  );

/** The breaches with one added; unchanged when it's recorded already. */
export function withBreach(breaches, id, file, breach) {
  const out = structuredClone(breaches);
  const list = ((out[id] ??= {})[file] ??= []);
  if (!list.includes(breach)) list.push(breach);
  return out;
}

/** The breaches with a file's (or one of them) taken out: { breaches, removed }. */
export function withoutBreach(breaches, id, file, breach = null) {
  const out = structuredClone(breaches);
  const list = out[id]?.[file] ?? [];
  const kept = breach === null ? [] : list.filter((b) => b !== breach);
  const removed = list.length - kept.length;
  if (kept.length) out[id][file] = kept;
  else if (out[id]) delete out[id][file];
  if (out[id] && !Object.keys(out[id]).length) delete out[id];
  return { breaches: out, removed };
}

/**
 * CONF-2: the standards a branch adopts, whose breaches it may record: those the standards file gains,
 * and those it tightens (recommended to required, or advice to checked).
 */
export function adoptedStandards(beforeText, afterText) {
  const before = new Map(parseStandards(beforeText).standards.map((s) => [s.id, s]));
  const rank = { advice: 0, checked: 1, enforced: 2 };
  return new Set(
    parseStandards(afterText)
      .standards.filter((s) => {
        const was = before.get(s.id);
        if (!was) return true;
        return (
          (was.level === 'recommended' && s.level === 'required') ||
          (rank[s.applied] ?? 0) > (rank[was.applied] ?? 0)
        );
      })
      .map((s) => s.id),
  );
}

/** CONF-2: the breaches recorded since `before` for standards the branch doesn't adopt, as sentences. */
export function breachesGained(before, after, adopted, file) {
  return breachList(after)
    .filter((b) => !adopted.has(b.id) && !(before[b.id]?.[b.file] ?? []).includes(b.breach))
    .map(
      (b) =>
        `${file} gained a breach of ${b.id} in ${b.file} (${b.breach}); breaches only shrink, except for a standard the branch adopts with the person's standards approval. Fix the code instead.`,
    );
}

/**
 * CONF-5: the breaches the base recorded in files the branch changes that the branch still records:
 * a story fixes what it touches. `changed` holds the files the branch changed and kept.
 */
export function touchedBreaches(before, after, changed) {
  const touched = new Set(changed);
  return breachList(before).filter(
    (b) => touched.has(b.file) && (after[b.id]?.[b.file] ?? []).includes(b.breach),
  );
}

/** CONF-5: what verify says of a breach still in a file the branch changes. */
export const touchedWords = (b, cli = 'code-kit') =>
  `${b.file} breaks ${b.id} (${b.breach}), as the baseline records, and this branch changes it, so it fixes it too: bring the file to ${b.id}, then run \`node "${cli}" conform fixed ${b.id} ${b.file}\` and commit the baseline with it.`;

/**
 * CONF-4: a refactor story's breaches still recorded for the standards it conforms to, in the files it
 * names (or, naming none, every file of its lane).
 */
export function storyLeft(story, breaches, config) {
  const files = story.files?.length ? new Set(story.files) : null;
  return breachList(breaches).filter(
    (b) =>
      story.conforms.includes(b.id) &&
      (files ? files.has(b.file) : laneOf(b.file, config) === story.lane),
  );
}

/**
 * CONF-3: where the code stands against each standard: its breaches by file, the refactor stories that
 * conform to it and their states, and the breached files no open story covers.
 */
export function conformance(standards, breaches, stories = []) {
  const live = stories.filter((s) => s.status !== 'dropped');
  return standards.map((s) => {
    const files = breaches[s.id] ?? {};
    const own = live.filter((st) => (st.conforms ?? []).includes(s.id));
    const covered = new Set(
      own.filter((st) => st.status !== 'done').flatMap((st) => st.files ?? []),
    );
    const lanesCovered = new Set(
      own.filter((st) => st.status !== 'done' && !st.files?.length).map((st) => st.lane),
    );
    return {
      id: s.id,
      title: s.title,
      level: s.level,
      applied: s.applied,
      breaches: Object.values(files).flat().length,
      files: Object.keys(files).sort(),
      byFile: files,
      stories: own.map((st) => ({ id: st.id, status: st.status, files: st.files ?? [] })),
      unplanned: Object.keys(files)
        .filter((f) => !covered.has(f) && !lanesCovered.has(f))
        .sort(),
    };
  });
}

/** The conformance problems: breaches of a standard the file doesn't have, and of files gone. */
export function conformProblems(standards, breaches, exists) {
  const ids = new Set(standards.map((s) => s.id));
  const problems = [];
  for (const [id, files] of Object.entries(breaches)) {
    if (!ids.has(id))
      problems.push(
        `breaches are recorded for ${id}, which the standards don't have: take them out with conform fixed, or add the standard`,
      );
    for (const file of Object.keys(files))
      if (!exists(file))
        problems.push(
          `${file} no longer exists, but breaches of ${id} are recorded for it: run conform fixed ${id} ${file}`,
        );
  }
  return problems;
}

/** The folder a file's refactor is grouped by: two levels under its lane's root, or its own folder. */
const groupOf = (file) => {
  const parts = file.split('/');
  return parts.length > 3 ? parts.slice(0, 3).join('/') : posix.dirname(file);
};

/**
 * CONF-6: the layers in the order a refactor goes through them: a layer before every layer that may
 * import it, so what others build on is brought to the standard first. Layers in a cycle keep the
 * config's order.
 */
export function layerOrder(layers = []) {
  const byName = new Map(layers.map((l) => [l.name, l]));
  const done = new Set();
  const order = [];
  const visit = (l, seen = new Set()) => {
    if (done.has(l.name) || seen.has(l.name)) return;
    seen.add(l.name);
    for (const dep of l.mayImport ?? []) if (byName.has(dep)) visit(byName.get(dep), seen);
    done.add(l.name);
    order.push(l.name);
  };
  for (const l of layers) visit(l);
  return order;
}

/** CONF-6: the order standards are conformed to: required first, then structure before detail. */
const CATEGORY_ORDER = ['ARC', 'PAT', 'POL', 'CON', 'PRI'];
export const pathwayOrder = (standards) =>
  [...standards].sort((a, b) => {
    const level = (s) => (s.level === 'required' ? 0 : 1);
    const cat = (s) => {
      const i = CATEGORY_ORDER.indexOf(String(s.id).split('-')[0]);
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    return level(a) - level(b) || cat(a) - cat(b) || a.id.localeCompare(b.id);
  });

/**
 * CONF-4: the refactor stories a standard's breaches make, for the conformance milestone: grouped by
 * owning lane, then folder, at most FILES_PER_STORY files each, numbered from `next` (the plan's next
 * free story number). Breaches already in an open story are left out.
 */
export function refactorStories(standard, breaches, config, { next, stories = [] }) {
  const covered = new Set(
    stories
      .filter(
        (s) => (s.conforms ?? []).includes(standard.id) && !['done', 'dropped'].includes(s.status),
      )
      .flatMap((s) => s.files ?? []),
  );
  const layers = config.layers ?? [];
  const rank = new Map(layerOrder(layers).map((name, i) => [name, i]));
  const groups = new Map();
  for (const [file, list] of Object.entries(breaches[standard.id] ?? {})) {
    if (covered.has(file)) continue;
    const lane = laneOf(file, config) ?? 'lead';
    const layer = layerOf(file, layers)?.name ?? null;
    const key = `${lane}\t${groupOf(file)}`;
    if (!groups.has(key)) groups.set(key, { lane, layer, folder: groupOf(file), files: [] });
    groups.get(key).files.push({ file, breaches: list });
  }
  // CONF-6: the pathway: the layers others import first, then by lane and folder.
  const at = (g) => (g.layer && rank.has(g.layer) ? rank.get(g.layer) : rank.size);
  const out = [];
  let n = next;
  for (const g of [...groups.values()].sort(
    (a, b) => at(a) - at(b) || `${a.lane}/${a.folder}`.localeCompare(`${b.lane}/${b.folder}`),
  )) {
    g.files.sort((a, b) => a.file.localeCompare(b.file));
    for (let i = 0; i < g.files.length; i += FILES_PER_STORY) {
      const files = g.files.slice(i, i + FILES_PER_STORY);
      const count = files.reduce((sum, f) => sum + f.breaches.length, 0);
      out.push({
        id: `ST-${n++}`,
        title: `${g.folder} conforms to ${standard.id}`,
        lane: g.lane,
        layer: g.layer,
        conforms: [standard.id],
        files: files.map((f) => f.file),
        breaches: files,
        size: count <= 2 ? 'small' : count <= 6 ? 'medium' : 'large',
        dependsOn: [],
      });
    }
  }
  // CONF-6: a story waits on this standard's stories in the layers its layer may import.
  const imports = new Map(layers.map((l) => [l.name, new Set(l.mayImport ?? [])]));
  for (const s of out)
    s.dependsOn = out
      .filter((o) => o !== s && s.layer && o.layer && imports.get(s.layer)?.has(o.layer))
      .map((o) => o.id);
  return out;
}

/**
 * CONF-6: the refactor pathway: a conformance milestone per standard, in pathway order, each with its
 * stories in layer order. The first story of a milestone waits on the last of the one before, so the
 * standards are taken one at a time.
 */
export function refactorPathway(standards, breaches, config, { next, stories = [] }) {
  const milestones = [];
  let n = next;
  let last = null;
  for (const s of pathwayOrder(standards)) {
    const drafted = refactorStories(s, breaches, config, { next: n, stories });
    if (!drafted.length) continue;
    n += drafted.length;
    if (last) for (const st of drafted) if (!st.dependsOn.length) st.dependsOn.push(last);
    last = drafted.at(-1).id;
    milestones.push({ standard: s, milestone: milestoneOf(s), stories: drafted });
  }
  return milestones;
}

/** CONF-4: the conformance milestone's heading for a standard. */
export const milestoneOf = (standard) => `Conformance: ${standard.id} ${standard.title}`;

/** CONF-4: a refactor story as the plan writes it. */
export function storyText(story, standard) {
  return [
    `### ${story.id} ${story.title}`,
    '',
    `**Lane:** ${story.lane}`,
    '**Requirements:** none',
    `**Conforms:** ${story.conforms.join(', ')}`,
    `**Files:** ${story.files.map((f) => `\`${f}\``).join(', ')}`,
    ...(story.dependsOn?.length ? [`**Depends on:** ${story.dependsOn.join(', ')}`] : []),
    `**Size:** ${story.size}`,
    '**Status:** todo',
    '',
    `Bring these files to ${standard.id} (${standard.title}) without changing what they do:`,
    '',
    ...story.breaches.flatMap((f) => f.breaches.map((b) => `- \`${f.file}\`: ${b}`)),
    '',
    'First, where these files have no tests that pin down what they do, write them, and see them pass on the code as it is.',
    '',
    `Acceptance: each breach above is gone and taken out of the baseline (\`code-kit conform fixed ${standard.id} <file>\`); behaviour is unchanged, shown by those tests passing before and after; no test is weakened.`,
  ].join('\n');
}

/** The plan's next free story number. */
export const nextStoryNumber = (stories) =>
  Math.max(0, ...stories.map((s) => Number(s.id.slice(3)) || 0)) + 1;
