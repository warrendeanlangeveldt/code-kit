// Existing code brought to the project's standards (spec 30). A standard the code doesn't meet yet is
// adopted with its breaches recorded in the baseline, file by file, so new code is held to it while the
// old is refactored: in a conformance milestone of its own (CONF-4), and in every file a story changes
// (CONF-5). Like the layers' baseline, the breaches only shrink, except for a standard the branch adopts.
import { posix } from 'node:path';
import {
  brokenLayerRule,
  CODE,
  PYTHON,
  importsIn,
  layerOf,
  pythonIndex,
  pythonTarget,
  targetOf,
} from './layers.mjs';
import { laneOf } from './rules.mjs';
import { parseStandards } from './standards.mjs';

/** The most files one refactor story takes, so each stays reviewable. */
export const FILES_PER_STORY = 5;

/**
 * CONF-8: the layer rules, as the pathway takes them: their violations are the layers' baseline, and a
 * refactor story brings its files to them with `**Conforms:** layers`.
 */
export const LAYER_RULES = {
  id: 'layers',
  title: 'the layer rules',
  level: 'required',
  applied: 'enforced',
};

/**
 * CONF-9: a breach fixed by splitting its file, or by moving it, carries where to:
 * "… [split: a.ts, b.ts]", "… [move: c.ts]". A bare "[split]" (a file measured as large) is split by
 * its responsibilities, into files its story chooses.
 */
const RESHAPE = /\s*\[(split|move)(?:: ([^\]]+))?\]$/;
export function reshapeOf(breach) {
  const m = String(breach).match(RESHAPE);
  if (!m) return null;
  const to = (m[2] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return m[1] === 'split' || to.length ? { kind: m[1], to } : null;
}
export const withReshape = (breach, kind, to = []) =>
  `${breach.replace(RESHAPE, '')} [${kind}${to.length ? `: ${to.join(', ')}` : ''}]`;

/**
 * CONF-9: what keeps a split or a move from being done, as a sentence, or null: every file it makes
 * exists, and a moved file is gone.
 */
export function reshapeLeft(file, breach, exists) {
  const r = reshapeOf(breach);
  if (!r) return null;
  const missing = r.to.filter((t) => !exists(t));
  if (!r.to.length) return null; // split as its story chose: the review judges it
  const what =
    r.kind === 'split' ? `split ${file} into ${r.to.join(', ')}` : `move ${file} to ${r.to[0]}`;
  if (missing.length)
    return `${missing.join(', ')} ${missing.length === 1 ? "doesn't" : "don't"} exist yet: ${what}, then take the breach out`;
  if (r.kind === 'move' && exists(file))
    return `${file} is still there: a move leaves nothing behind, so move it and update what imports it to ${r.to[0]}`;
  return null;
}

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
 * a story fixes what it touches. A split or a move is left to its own story (CONF-9): it's too large
 * to ask of every change to the file. `changed` holds the files the branch changed and kept.
 */
export function touchedBreaches(before, after, changed) {
  const touched = new Set(changed);
  return breachList(before).filter(
    (b) =>
      touched.has(b.file) &&
      !reshapeOf(b.breach) &&
      (after[b.id]?.[b.file] ?? []).includes(b.breach),
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
      if (s.id === LAYER_RULES.id) return -1; // CONF-8: the architecture's own rules first
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
    // CONF-9: a split or a move is a story of its own.
    const reshape = list.map(reshapeOf).find(Boolean) ?? null;
    const key = reshape ? `${lane}\t${file}\t${reshape.kind}` : `${lane}\t${groupOf(file)}`;
    if (!groups.has(key))
      groups.set(key, { lane, layer, folder: reshape ? file : groupOf(file), reshape, files: [] });
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
      const { reshape } = g;
      out.push({
        id: `ST-${n++}`,
        title: !reshape
          ? `${g.folder} conforms to ${standard.id}`
          : reshape.kind === 'split'
            ? `Split ${g.folder} (${standard.id})`
            : `Move ${g.folder} to ${reshape.to[0]} (${standard.id})`,
        lane: g.lane,
        layer: g.layer,
        conforms: [standard.id],
        files: [...files.map((f) => f.file), ...(reshape?.to ?? [])],
        breaches: files,
        reshape,
        size:
          reshape?.kind === 'split'
            ? 'large'
            : reshape
              ? 'medium'
              : count <= 2
                ? 'small'
                : count <= 6
                  ? 'medium'
                  : 'large',
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
  const layered = standard.id === LAYER_RULES.id;
  const line = (file, b) => {
    const r = reshapeOf(b);
    const words = b.replace(RESHAPE, '');
    if (!r) return `- \`${file}\`: ${words}`;
    const to = r.to.map((t) => `\`${t}\``).join(', ');
    if (r.kind === 'split' && !r.to.length)
      return `- \`${file}\`: ${words}. Split it into modules of one responsibility each, beside it, and point what imports it at them; name the new files in the story's **Files:**.`;
    return r.kind === 'split'
      ? `- \`${file}\`: ${words}. Split it into ${to}, one responsibility each, and point what imports it at the new files.`
      : `- \`${file}\`: ${words}. Move it to ${to}, and point everything that imports it at the new path.`;
  };
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
    ...story.breaches.flatMap((f) => f.breaches.map((b) => line(f.file, b))),
    '',
    'First, where these files have no tests that pin down what they do, write them, and see them pass on the code as it is.',
    '',
    layered
      ? 'Acceptance: each violation above is gone and `code-kit baseline --write` has taken it out of the baseline; behaviour is unchanged, shown by those tests passing before and after; no test is weakened.'
      : `Acceptance: each breach above is gone and taken out of the baseline (\`code-kit conform fixed ${standard.id} <file>\`); behaviour is unchanged, shown by those tests passing before and after; no test is weakened.`,
  ].join('\n');
}

/** The plan's next free story number. */
export const nextStoryNumber = (stories) =>
  Math.max(0, ...stories.map((s) => Number(s.id.slice(3)) || 0)) + 1;

/**
 * CONF-8: the layers a change of the config adopts: new ones, and ones whose rule changed (their paths,
 * what they may import, the packages they may not use). Violations from or into them may be recorded on
 * the branch that adopts them, as a standard's breaches are.
 */
export function adoptedLayers(beforeLayers = [], afterLayers = []) {
  const rule = (l) =>
    JSON.stringify({
      paths: [...(l.paths ?? [])].sort(),
      mayImport: [...(l.mayImport ?? [])].sort(),
      denyPackages: [...(l.denyPackages ?? [])].sort(),
    });
  const before = new Map((Array.isArray(beforeLayers) ? beforeLayers : []).map((l) => [l.name, l]));
  return new Set(
    (Array.isArray(afterLayers) ? afterLayers : [])
      .filter((l) => !before.has(l.name) || rule(before.get(l.name)) !== rule(l))
      .map((l) => l.name),
  );
}

/** CONF-8: whether a layer problem is one the adopted layers bring (from or into one of them). */
export function adoptedProblem(problem, adopted) {
  const r = brokenLayerRule(problem);
  return Boolean(r && (adopted.has(r.from) || (r.to && adopted.has(r.to))));
}

/** Source files measured for size, beside the JavaScript and TypeScript ones whose imports are read. */
export const SOURCE =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rb|go|java|kt|cs|php|swift|rs|vue|svelte)$/;

/**
 * CONF-7: the modules a text names in quotes, dotted ("jobs.cleanup", "app.tasks.run",
 * "pkg.cli:main"): how Celery, a pyproject's scripts and plugin lists load a module by name. Each comes
 * with its parent, for a name that ends in a function.
 */
export function namedModules(text) {
  const out = new Set();
  for (const m of text.matchAll(/["']([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)(?::[\w.]+)?["']/g)) {
    out.add(m[1]);
    out.add(m[1].replace(/\.[^.]+$/, ''));
  }
  return [...out];
}

/** CONF-7: the default size a file is measured as large over, in lines. */
export const LARGE_LINES = 500;

/** Entry points: what a framework, a runtime or a command line loads, and nothing imports. */
const ENTRY =
  /(^|\/)(index|main|app|server|cli|page|layout|route|loading|error|not-found|template|middleware|instrumentation|_app|_document|setup|vite-env\.d|__init__|__main__|manage|conftest|wsgi|asgi|tasks|worker|celery|celery_app)\.[^/]+$|(^|\/)(bin|scripts|pages|routes|migrations|alembic|seeds?)\/|\.(config|d|setup)\.[^/]+$|(^|\/)\.[^/]+$/;

/** Generated code: nobody refactors it by hand. */
const GENERATED = /(^|\/)(generated|__generated__)\/|\.(gen|generated)\.[^/]+$/;

const ENV_READ = /\b(process\.env|import\.meta\.env|os\.environ|os\.getenv|Deno\.env|ENV\[)/;
// Configuration and the providers that wire services may read the environment: that's their job.
const ENV_FILE =
  /(^|\/)(config|configs|env|settings|providers?|dependencies|container|bootstrap)(\/|\.[^/]+$)|(^|\/)[^/]*(config|env|settings|provider)\.[^/]+$/i;

/**
 * CONF-7: measured facts about the code's structure, the evidence for the structural standards: files
 * over `lines` lines (god modules), import cycles, files nothing imports (dead code, entry points left
 * out), and files that read the environment themselves (services not behind a provider). `files` are
 * [{ rel, source }], tests left out (generated code is left out here); `aliases` resolve JavaScript and
 * TypeScript imports as the layers do: an object, or a file's own (its tsconfig's paths) from a function
 * of its path. Python's resolve against `python` (pythonIndex of the project's Python files, tests
 * included), or the files given. `entries` are files something outside the code loads (a pyproject's
 * scripts), not dead for want of an import. Type-only imports count as use, but make no cycle. A file
 * only `tests` import is in `testsOnly`, not `unused`.
 */
export function structureFacts(
  all,
  { aliases = {}, lines = LARGE_LINES, python = null, entries = [], tests = [] } = {},
) {
  const aliasesOf = typeof aliases === 'function' ? aliases : () => aliases;
  const files = all.filter((f) => !GENERATED.test(f.rel));
  const code = files.filter((f) => CODE.test(f.rel) || PYTHON.test(f.rel));
  const py = python ?? pythonIndex(files.filter((f) => PYTHON.test(f.rel)).map((f) => f.rel));
  const byStem = new Map();
  for (const f of code.filter((c) => CODE.test(c.rel))) {
    const stem = f.rel.replace(/\.[^./]+$/, '');
    byStem.set(stem, f.rel);
    if (/\/index$/.test(stem)) byStem.set(stem.replace(/\/index$/, ''), f.rel);
  }
  const resolveTo = (t) => byStem.get(t) ?? byStem.get(t.replace(/\.[^./]+$/, '')) ?? null;
  const edges = new Map(code.map((f) => [f.rel, new Set()]));
  const importedBy = new Map(code.map((f) => [f.rel, 0]));
  // The measured file an import in `rel` points at, or null (a package, a namespace folder, a test).
  const resolveFrom = (rel, spec) => {
    let to;
    if (PYTHON.test(rel)) to = pythonTarget(spec, rel, py);
    else {
      const t = targetOf(spec, rel, aliasesOf(rel));
      to = t === null ? null : resolveTo(t);
    }
    return to && to !== rel && importedBy.has(to) ? to : null;
  };
  for (const f of code)
    for (const { spec, typeOnly } of importsIn(f.source, f.rel)) {
      const to = resolveFrom(f.rel, spec);
      if (!to) continue;
      if (!typeOnly) edges.get(f.rel).add(to);
      importedBy.set(to, importedBy.get(to) + 1);
    }
  // What only the tests import: kept for them, which is a different question from dead code.
  const byTests = new Set();
  for (const t of tests)
    for (const { spec } of importsIn(t.source, t.rel)) {
      const to = resolveFrom(t.rel, spec);
      if (to) byTests.add(to);
    }
  // A Python module named in a string is loaded by name: used, though nothing imports it.
  const loaded = new Set(entries);
  for (const f of code.filter((c) => PYTHON.test(c.rel)))
    for (const name of namedModules(f.source)) {
      const t = pythonTarget(name, f.rel, py);
      if (t && t !== f.rel) loaded.add(t);
    }

  // Tarjan's strongly connected components: each one of two or more files is an import cycle.
  const cycles = [];
  const index = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  let i = 0;
  const visit = (v) => {
    index.set(v, i);
    low.set(v, i++);
    stack.push(v);
    on.add(v);
    for (const w of edges.get(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) cycles.push(scc.sort());
    }
  };
  for (const v of [...edges.keys()].sort()) if (!index.has(v)) visit(v);

  const count = (source) => source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  return {
    large: files
      .filter((f) => SOURCE.test(f.rel))
      .map((f) => ({ file: f.rel, lines: count(f.source) }))
      .filter((f) => f.lines > lines)
      .sort((a, b) => b.lines - a.lines),
    cycles,
    unused: code
      .filter(
        (f) =>
          importedBy.get(f.rel) === 0 &&
          !ENTRY.test(f.rel) &&
          !loaded.has(f.rel) &&
          !byTests.has(f.rel),
      )
      .map((f) => f.rel)
      .sort(),
    testsOnly: code
      .filter(
        (f) =>
          importedBy.get(f.rel) === 0 &&
          !ENTRY.test(f.rel) &&
          !loaded.has(f.rel) &&
          byTests.has(f.rel),
      )
      .map((f) => f.rel)
      .sort(),
    env: files
      .filter((f) => SOURCE.test(f.rel) && !ENV_FILE.test(f.rel) && !ENTRY.test(f.rel))
      .map((f) => ({
        file: f.rel,
        lines: f.source.split('\n').flatMap((text, n) => (ENV_READ.test(text) ? [n + 1] : [])),
      }))
      .filter((f) => f.lines.length),
    limit: lines,
  };
}

/** CONF-7: the kinds of measured fact, and how many files each covers. */
export const FACT_KINDS = ['large', 'cycles', 'unused', 'env'];

/** CONF-7: one kind of measured fact as breaches to record: [{ file, breach }]. */
export function factBreaches(facts, kind) {
  const lineList = (ns) =>
    `line${ns.length === 1 ? '' : 's'} ${ns.slice(0, 5).join(', ')}${ns.length > 5 ? ` and ${ns.length - 5} more` : ''}`;
  if (kind === 'large')
    return facts.large.map((f) => ({
      file: f.file,
      breach: withReshape(
        `${f.lines} lines, over ${facts.limit}: find its responsibilities and split it by them`,
        'split',
      ),
    }));
  if (kind === 'cycles')
    return facts.cycles.flatMap((c) =>
      c.map((file) => ({
        file,
        breach: `in an import cycle of ${c.length} files: ${c.slice(0, 6).join(', ')}${c.length > 6 ? ', …' : ''}`,
      })),
    );
  if (kind === 'unused')
    return facts.unused.map((file) => ({
      file,
      breach: 'nothing imports it: remove it if nothing loads it either',
    }));
  if (kind === 'env')
    return facts.env.map((f) => ({
      file: f.file,
      breach: `${lineList(f.lines)}: reads the environment itself, not through the configuration's provider`,
    }));
  return [];
}

/** JSON with comments and trailing commas, as tsconfig allows, read as JSON; null when it doesn't read. */
export function readJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 1;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

/**
 * CONF-7: each tsconfig's (or jsconfig's) path aliases, as a function of a file's path to the aliases
 * of the nearest one above it: `"@/*": ["./src/*"]` makes `@` its `src`. A config's `extends`, by a
 * relative path, gives the paths it doesn't set. `read(rel)` is a config's text, or null.
 */
export function tsconfigAliases(configs, read) {
  const own = new Map();
  const load = (rel, seen = new Set()) => {
    if (seen.has(rel)) return null;
    seen.add(rel);
    const json = readJsonc(read(rel) ?? '');
    if (!json) return null;
    const opts = json.compilerOptions ?? {};
    const dir = posix.dirname(rel);
    if (opts.paths) {
      const base = posix.join(dir, opts.baseUrl ?? '.');
      const map = {};
      for (const [key, targets] of Object.entries(opts.paths)) {
        const to = Array.isArray(targets) ? targets[0] : null;
        if (typeof to !== 'string' || to.includes('node_modules')) continue;
        map[key.replace(/\/?\*$/, '')] = posix.normalize(
          posix.join(base, to.replace(/\/?\*$/, '')),
        );
      }
      return map;
    }
    const parent =
      typeof json.extends === 'string' && json.extends.startsWith('.') ? json.extends : null;
    if (!parent) return null;
    const next = posix.normalize(
      posix.join(dir, parent.endsWith('.json') ? parent : `${parent}.json`),
    );
    return load(next, seen);
  };
  for (const rel of configs) {
    const map = load(rel);
    if (map) own.set(posix.dirname(rel), map);
  }
  return (file) => {
    for (let d = posix.dirname(file); ; d = posix.dirname(d)) {
      if (own.has(d)) return own.get(d);
      if (d === '.' || d === '/' || d === '') return {};
    }
  };
}
