// A story's code as the pane draws it (docs/specs/14-mission-and-maps.md): the files it changed, by the
// layer each sits in, with the imports between them (MAP-1); and each requirement's trail to its
// stories, their files and the tests that name it (TRAIL-1). Read from git, the config and the plan.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { matchesAny } from './glob.mjs';
import { CODE, importsOf, layerOf, targetOf } from './layers.mjs';

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return '';
  }
};

/** Files that are the build's own code: not the plan, the specs, or the tools' state. */
const KIT = /^(\.claude|\.ctx|\.github)\//;
const isCode = (rel) => CODE.test(rel) && !KIT.test(rel);

/**
 * The code files a story changed: those in commits whose message names it (on any branch, so a merged
 * story still has its files) and, while its branch is open, its diff against the base. Only files that
 * still exist, in path order.
 */
export function storyFiles(root, story, from) {
  const found = new Set();
  const id = story.id;
  const log = git(
    root,
    'log',
    '--all',
    '--no-merges',
    '-E',
    // POSIX ERE has no \b: "ST-1" mustn't match "ST-12".
    `--grep=(^|[^A-Za-z0-9-])${id}([^0-9]|$)`,
    '--format=',
    '--name-only',
  );
  for (const f of log.split('\n')) if (f) found.add(f);
  if (story.branchExists && story.branch)
    for (const f of git(root, 'diff', '--name-only', `${from}...${story.branch}`).split('\n'))
      if (f) found.add(f);
  return [...found].filter((f) => isCode(f) && existsSync(join(root, f))).sort();
}

const EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
];

/** The file in `files` an import specifier in `rel` points at, or null. */
function resolveIn(spec, rel, aliases, files) {
  const target = targetOf(spec, rel, aliases);
  if (!target) return null;
  // `./x.js` in TypeScript source names `./x.ts`.
  const bare = target.replace(/\.(js|mjs|cjs)$/, '');
  for (const ext of EXTENSIONS) {
    for (const candidate of [`${target}${ext}`, `${bare}${ext}`])
      if (files.has(candidate)) return candidate;
  }
  return null;
}

/** The lane that owns `rel`, or `lead`, or null. */
export function laneOfFile(rel, config) {
  const lane = Object.keys(config.lanes).find((name) => {
    const { paths, exclude = [] } = config.lanes[name];
    return matchesAny(rel, paths) && !matchesAny(rel, exclude);
  });
  if (lane) return lane;
  return matchesAny(
    rel,
    config.lead.paths.filter((p) => p !== '*'),
  )
    ? 'lead'
    : null;
}

const TEST = /(^|\/)(tests?|e2e|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * MAP-1: a story's code: { story, layers, files: [{ path, layer, lane, imports }] }. `layers` are the
 * config's layers in their order, then `tests` and `other` where any file falls there; each file's
 * imports are the story's other files it imports.
 */
export function storyMap(root, story, config, from) {
  const paths = storyFiles(root, story, from);
  const set = new Set(paths);
  const aliases = config.importAliases ?? {};
  const files = paths.map((rel) => {
    let source = '';
    try {
      source = readFileSync(join(root, rel), 'utf8');
    } catch {
      // unreadable: no imports
    }
    const imports = [
      ...new Set(
        importsOf(source)
          .map((spec) => resolveIn(spec, rel, aliases, set))
          .filter((t) => t && t !== rel),
      ),
    ];
    const layer = TEST.test(rel) ? 'tests' : (layerOf(rel, config.layers)?.name ?? 'other');
    return { path: rel, layer, lane: laneOfFile(rel, config), imports };
  });
  const used = new Set(files.map((f) => f.layer));
  const layers = [...config.layers.map((l) => l.name), 'tests', 'other'].filter((l) => used.has(l));
  return {
    story: { id: story.id, title: story.title, lane: story.lane, state: story.state },
    layers,
    files,
  };
}

/**
 * TRAIL-1: each requirement's trail: { id, title, spec, state, stories: [{ id, state, lane }],
 * files, tests }. Files are the code its stories changed, tests aside; tests are the files that name it.
 */
export function trail(root, status, from) {
  const byStory = new Map();
  const filesOf = (s) => {
    if (!byStory.has(s.id)) byStory.set(s.id, storyFiles(root, s, from));
    return byStory.get(s.id);
  };
  return status.requirements
    .filter((r) => !r.removed)
    .map((r) => {
      const stories = status.stories.filter((s) => s.requirements.includes(r.id));
      const files = [...new Set(stories.flatMap((s) => filesOf(s)).filter((f) => !TEST.test(f)))];
      return {
        id: r.id,
        title: r.title,
        spec: r.file ? posix.basename(r.file) : null,
        state: r.state,
        stories: stories.map((s) => ({ id: s.id, state: s.state, lane: s.lane })),
        files,
        tests: [...(r.tests ?? [])],
      };
    });
}
