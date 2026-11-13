// Layer rules: each layer lists the layers it may depend on, and optionally packages it may not use.
// Imports are read from JavaScript, TypeScript and Python source; a file outside every layer is not
// checked.
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { matchesAny } from './glob.mjs';

export const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
export const PYTHON = /\.pyi?$/;

/** The languages whose imports are read, by a file's path: 'js' (and TypeScript), 'py', or null. */
export const languageOf = (rel) => (CODE.test(rel) ? 'js' : PYTHON.test(rel) ? 'py' : null);
export const LANGUAGES = ['js', 'py'];

const SPECIFIERS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g, // import … from 'x', export … from 'x'
  /^\s*import\s*['"]([^'"\n]+)['"]/gm, // import 'x'
  /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, // require('x'), import('x')
];

// `import type …` and `export type … from` bring in types only: no dependency when the code runs.
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b[^'"]*\bfrom\s*['"]([^'"\n]+)['"]/gm;

/**
 * Every import in `source`, as [{ spec, typeOnly, optional }]: `typeOnly` for one that brings in types
 * only (TypeScript's `import type`, Python's `if TYPE_CHECKING:`), `optional` for a Python name that may
 * be a submodule or only a name in its module (counted only when such a submodule exists). `rel` gives
 * the language; JavaScript and TypeScript without it.
 */
export function importsIn(source, rel = '') {
  if (PYTHON.test(rel)) return pythonImports(source);
  const typeOnly = new Set([...source.matchAll(TYPE_ONLY)].map((m) => m[1]));
  const found = new Map();
  for (const re of SPECIFIERS)
    for (const m of source.matchAll(re))
      found.set(m[1], (found.get(m[1]) ?? true) && typeOnly.has(m[1]));
  return [...found].map(([spec, onlyTypes]) => ({ spec, typeOnly: onlyTypes, optional: false }));
}

/** The import specifiers in `source`, each once. */
export function importsOf(source, rel = '') {
  return [...new Set(importsIn(source, rel).map((i) => i.spec))];
}

/** Python source with its strings and comments blanked, its lines kept, so no text reads as an import. */
export function pythonCode(source) {
  let out = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '"' || c === "'") {
      const quote = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < source.length && !source.startsWith(quote, j)) {
        if (source[j] === '\\') j++;
        else if (quote.length === 1 && source[j] === '\n') break; // an unclosed string ends with its line
        j++;
      }
      const end = Math.min(source.length, j + (source.startsWith(quote, j) ? quote.length : 0));
      out += `""${source.slice(i, end).replace(/[^\n]/g, '')}`;
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const PY_IMPORT = /^([ \t]*)import[ \t]+([^\n;]+)/gm;
const PY_FROM = /^([ \t]*)from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]+)/gm;
const PY_TYPE_CHECKING = /^([ \t]*)if[ \t]+(?:typing\.)?TYPE_CHECKING[ \t]*:/gm;

/** Python's imports: `import a.b`, `from a.b import c`, `from . import x` and `from ..a import b`. */
function pythonImports(source) {
  const code = pythonCode(source);
  const lineOf = (at) => code.slice(0, at).split('\n').length;
  // The lines inside an `if TYPE_CHECKING:` block, which run only for the type checker.
  const typeLines = new Set();
  const lines = code.split('\n');
  for (const m of code.matchAll(PY_TYPE_CHECKING)) {
    const depth = m[1].length;
    for (let n = lineOf(m.index); n < lines.length; n++) {
      const text = lines[n];
      if (!text.trim()) continue;
      if (text.match(/^[ \t]*/)[0].length <= depth) break;
      typeLines.add(n + 1);
    }
  }
  const found = new Map();
  const add = (spec, at, optional = false) => {
    if (!spec || spec === '__future__') return;
    const was = found.get(spec);
    const typeOnly = typeLines.has(lineOf(at));
    found.set(spec, {
      spec,
      typeOnly: was ? was.typeOnly && typeOnly : typeOnly,
      optional: was ? was.optional && optional : optional,
    });
  };
  for (const m of code.matchAll(PY_IMPORT))
    for (const part of m[2].split(','))
      add(
        part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
        m.index,
      );
  for (const m of code.matchAll(PY_FROM)) {
    const from = m[2];
    const names = m[3]
      .replace(/[()\\]/g, ' ')
      .split(',')
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter((n) => n && n !== '*');
    // `from . import x` names modules of the package; `from a import b` may name a submodule, or a name.
    if (from === '__future__') continue;
    if (/^\.+$/.test(from)) for (const n of names) add(`${from}${n}`, m.index);
    else {
      add(from, m.index);
      for (const n of names) add(`${from}${from.endsWith('.') ? '' : '.'}${n}`, m.index, true);
    }
  }
  return [...found.values()];
}

/** The tracked Python files of a project, as a Set, read once per process. */
const pythonCache = new Map();
export function pythonFiles(root) {
  if (!pythonCache.has(root)) {
    let files = [];
    try {
      // New files too: an edit may import a module written a moment before.
      files = execFileSync(
        'git',
        ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '*.py', '*.pyi'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 64 * 1024 * 1024,
        },
      )
        .split('\n')
        .filter(Boolean);
    } catch {
      files = [];
    }
    pythonCache.set(root, pythonIndex(files));
  }
  return pythonCache.get(root);
}

/** What resolving Python imports needs: the files, the folders holding them, and each top package. */
export function pythonIndex(list) {
  const files = new Set(list);
  const dirs = new Set();
  for (const f of list) for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  // A top package: a folder with an __init__.py whose parent has none, or a folder under src/.
  const tops = new Map();
  for (const f of list) {
    if (!/(^|\/)__init__\.pyi?$/.test(f)) continue;
    let d = posix.dirname(f);
    while (d !== '.' && files.has(`${posix.dirname(d)}/__init__.py`)) d = posix.dirname(d);
    if (d === '.') continue;
    const name = posix.basename(d);
    if (!tops.has(name)) tops.set(name, new Set());
    tops.get(name).add(d);
  }
  return { files, dirs, tops };
}

/** The file (or package folder) a module path names under `base`, or null. */
function pythonModuleAt(base, path, index) {
  const at = base === '.' || base === '' ? path : `${base}/${path}`;
  for (const candidate of [`${at}.py`, `${at}.pyi`, `${at}/__init__.py`, `${at}/__init__.pyi`])
    if (index.files.has(candidate)) return candidate;
  return index.dirs.has(at) ? at : null; // a namespace package
}

/**
 * CONF-7, the layers: the repository path a Python import in `rel` points at, or null for a package.
 * A relative import resolves from `rel`'s package; an absolute one from the folders above `rel` (and
 * their `src/`), as the folder a service runs from is on its path, then from the project's top packages,
 * the nearest to `rel` first. Relative imports that resolve to nothing are left out, not packages.
 */
export function pythonTarget(spec, rel, index) {
  const dots = spec.match(/^\.*/)[0].length;
  const path = spec.slice(dots).split('.').filter(Boolean).join('/');
  if (dots) {
    let base = posix.dirname(rel);
    for (let i = 1; i < dots; i++) base = posix.dirname(base);
    return (path ? pythonModuleAt(base, path, index) : base) ?? '';
  }
  for (let d = posix.dirname(rel); ; d = posix.dirname(d)) {
    for (const base of [d, d === '.' ? 'src' : `${d}/src`]) {
      const found = pythonModuleAt(base, path, index);
      if (found) return found;
    }
    if (d === '.' || d === '/') break;
  }
  const [top, ...restParts] = path.split('/');
  const homes = [...(index.tops.get(top) ?? [])];
  const shared = (dir) => {
    const a = dir.split('/');
    const b = rel.split('/');
    let n = 0;
    while (n < a.length && a[n] === b[n]) n++;
    return n;
  };
  homes.sort((a, b) => shared(b) - shared(a) || a.localeCompare(b));
  for (const home of homes) {
    const found = restParts.length
      ? pythonModuleAt(home, restParts.join('/'), index)
      : (pythonModuleAt(posix.dirname(home), top, index) ?? home);
    if (found) return found;
  }
  return null;
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

/**
 * Every import in `source` (the file at repo path `rel`) that breaks the layer rules. A Python file's
 * imports resolve against the project's Python files: `python` (from pythonIndex), or read from `root`.
 */
export function layerProblems(rel, source, config, { root = '.', python = null } = {}) {
  const language = languageOf(rel);
  if (!language || config.layers.length === 0) return [];
  const layer = layerOf(rel, config.layers);
  if (!layer) return [];
  const allowed = new Set([layer.name, ...layer.mayImport]);
  const index = language === 'py' ? (python ?? pythonFiles(root)) : null;
  const problems = [];
  for (const { spec, optional } of importsIn(source, rel)) {
    const target = index
      ? pythonTarget(spec, rel, index)
      : targetOf(spec, rel, config.importAliases);
    if (target === '' || (optional && !target)) continue; // a name, or a module that isn't there
    if (target === null) {
      const top = index ? spec.split('.')[0] : spec;
      if (matchesAny(spec, layer.denyPackages) || matchesAny(top, layer.denyPackages))
        problems.push(`${rel} (${layer.name}) may not import the package ${index ? top : spec}.`);
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

/**
 * The rule a layer problem broke, read back from its sentence (as layerProblems words it):
 * { kind: 'layers', from, to } or { kind: 'layers', from, package }. Null for any other text.
 */
export function brokenLayerRule(problem) {
  const pkg = String(problem).match(/ \(([^()]+)\) may not import the package (\S+)\.$/);
  if (pkg) return { kind: 'layers', from: pkg[1], package: pkg[2] };
  const layer = String(problem).match(/ \(([^()]+)\) imports \S+ \(([^()]+)\); /);
  return layer ? { kind: 'layers', from: layer[1], to: layer[2] } : null;
}
