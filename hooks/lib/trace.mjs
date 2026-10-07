// What a file is for, in the project's own terms: the requirements it delivers (from the stories that
// changed it), the lane that owns it, and its layer with what that layer may import. This is the contract
// other tools read (`code-kit trace <path> --json`); Context Graph's adapter uses it to anchor a file's
// card in the spec and to show the layer rule before an agent drafts an edit.
import { execFileSync } from 'node:child_process';
import { matchesAny } from './glob.mjs';
import { layerOf } from './layers.mjs';
import { readRequirements, readStories } from './plan.mjs';
import { ownerOf, reviewerOf } from './rules.mjs';

const git = (root, ...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return '';
  }
};

/** Story ids named by the commits that changed `rel`, and by the current branch if it is a story branch. */
export function storiesOf(root, rel) {
  const ids = new Set();
  for (const m of git(root, 'log', '--format=%B', '--', rel).matchAll(/\bST-\d+\b/g)) ids.add(m[0]);
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const onBranch = /^[\w-]+\/(st-\d+)$/i.exec(branch)?.[1];
  if (onBranch) ids.add(onBranch.toUpperCase());
  return [...ids];
}

/** { path, owner, reviewer, lane, layer, requirements: [{ id, title, spec, stories }] } for one repository path. */
export function traceFile(root, rel, config) {
  const laneName = Object.keys(config.lanes).find((l) => {
    const { paths, exclude } = config.lanes[l];
    return matchesAny(rel, paths) && !matchesAny(rel, exclude);
  });
  const layer = layerOf(rel, config.layers);
  const out = {
    path: rel,
    owner: ownerOf(rel, config),
    // For a file any agent may write: who reviews changes to it.
    reviewer: reviewerOf(rel, config),
    lane: laneName ? { name: laneName, agent: config.lanes[laneName].agent } : null,
    layer: layer
      ? { name: layer.name, mayImport: layer.mayImport, denyPackages: layer.denyPackages ?? [] }
      : null,
    requirements: [],
  };
  const { specs, plan } = config.docs ?? {};
  if (!specs || !plan) return out;
  const stories = readStories(root, plan);
  const requirements = new Map(
    readRequirements(root, specs)
      .filter((r) => r.file !== plan && !r.removed)
      .map((r) => [r.id, r]),
  );
  const byReq = new Map();
  for (const id of storiesOf(root, rel)) {
    const story = stories.find((s) => s.id === id);
    for (const req of story?.requirements ?? []) {
      const r = requirements.get(req);
      if (!r) continue;
      if (!byReq.has(req)) byReq.set(req, { id: req, title: r.title, spec: r.file, stories: [] });
      byReq.get(req).stories.push(id);
    }
  }
  out.requirements = [...byReq.values()];
  return out;
}
