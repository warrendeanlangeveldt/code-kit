// Layer rules: each layer lists the layers it may depend on, and optionally packages it may not use.
// Imports are read from JavaScript and TypeScript source; a file outside every layer is not checked.
import { posix } from 'node:path';
import { matchesAny } from './glob.mjs';

export const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const SPECIFIERS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g, // import … from 'x', export … from 'x'
  /^\s*import\s*['"]([^'"\n]+)['"]/gm, // import 'x'
  /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, // require('x'), import('x')
];

export function importsOf(source) {
  const found = new Set();
  for (const re of SPECIFIERS) for (const m of source.matchAll(re)) found.add(m[1]);
  return [...found];
}

export const layerOf = (rel, layers) => layers.find((l) => matchesAny(rel, l.paths));

/** The repository path an import points at, or null for a package. */
export function targetOf(spec, rel, aliases) {
  if (spec.startsWith('./') || spec.startsWith('../'))
    return posix.normalize(posix.join(posix.dirname(rel), spec));
  const prefix = Object.keys(aliases)
    .sort((a, b) => b.length - a.length)
    .find((a) => spec === a || spec.startsWith(`${a}/`));
  return prefix === undefined
    ? null
    : posix.normalize(posix.join(aliases[prefix], spec.slice(prefix.length)));
}

/** Every import in `source` (the file at repo path `rel`) that breaks the layer rules. */
export function layerProblems(rel, source, config) {
  if (!CODE.test(rel) || config.layers.length === 0) return [];
  const layer = layerOf(rel, config.layers);
  if (!layer) return [];
  const allowed = new Set([layer.name, ...layer.mayImport]);
  const problems = [];
  for (const spec of importsOf(source)) {
    const target = targetOf(spec, rel, config.importAliases);
    if (target === null) {
      if (matchesAny(spec, layer.denyPackages))
        problems.push(`${rel} (${layer.name}) may not import the package ${spec}.`);
      continue;
    }
    const to = layerOf(target, config.layers) ?? layerOf(`${target}/index`, config.layers);
    if (to && !allowed.has(to.name)) {
      const may = layer.mayImport.length ? layer.mayImport.join(', ') : 'no other layer';
      problems.push(
        `${rel} (${layer.name}) imports ${spec} (${to.name}); ${layer.name} may depend on ${may}.`,
      );
    }
  }
  return problems;
}
