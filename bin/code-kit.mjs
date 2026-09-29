#!/usr/bin/env node
// Run from the project root: node "${CLAUDE_PLUGIN_ROOT}/bin/code-kit.mjs" <command>
//   check                 validate the config and summarise it
//   who <path>...         who may write each path, and its layer
//   unowned               tracked files nobody may write
//   diff                  what a draft changes against the live config, and whose files move
//   baseline [--write]    layer violations in the code as it is (brownfield adoption); --write records them
//   graph [--depth N]     which folders import which (to find the layers in existing code)
// --config <file> reads a draft (.claude/code-kit.draft.json) instead of .claude/code-kit.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { BASELINE_FILE, loadBaseline } from '../hooks/lib/baseline.mjs';
import { CONFIG_FILE, validate, withDefaults } from '../hooks/lib/config.mjs';
import { diffConfigs, ownershipMoves } from '../hooks/lib/diff.mjs';
import { CODE, importsOf, layerOf, layerProblems, targetOf } from '../hooks/lib/layers.mjs';
import { ownerOf } from '../hooks/lib/rules.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const die = (s) => {
  process.stderr.write(`${s}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const file = option('--config') ?? CONFIG_FILE;
const depth = Number(option('--depth') ?? 2);
const writeBaseline = args.includes('--write');
const [command, ...rest] = args.filter((a) => a !== '--write');

const tracked = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const read = (path) => readFileSync(resolve(path), 'utf8');

function load(path = file) {
  let raw;
  try {
    raw = JSON.parse(read(path));
  } catch (e) {
    die(`${path}: ${e.message}`);
  }
  const problems = validate(raw);
  if (problems.length) die(`${path} is invalid:\n  ${problems.join('\n  ')}`);
  return { raw, config: withDefaults(raw) };
}

function check() {
  const { raw } = load();
  out(`${file} is valid.`);
  out(`Lead: ${raw.lead.paths.join(', ')}`);
  for (const [name, lane] of Object.entries(raw.lanes))
    out(`Lane ${name} (${lane.agent}): ${lane.paths.join(', ')}`);
  for (const l of raw.layers ?? []) out(`Layer ${l.name} → ${l.mayImport.join(', ') || 'nothing'}`);
  for (const c of raw.checks ?? []) out(`Check ${c.name}: ${c.run.join(' && ')}`);
  if (!raw.docs?.specs) out('No docs.specs: lanes are not held to a spec-check report.');
}

function who(paths) {
  const { config } = load();
  for (const p of paths) {
    const layer = layerOf(p, config.layers);
    out(`${p}: ${ownerOf(p, config) ?? 'nobody'}${layer ? ` · layer ${layer.name}` : ''}`);
  }
}

function unowned() {
  const { config } = load();
  const files = tracked();
  const nobody = files.filter((p) => !ownerOf(p, config) && !p.startsWith('.claude/'));
  nobody.forEach(out);
  out(`${nobody.length} of ${files.length} tracked files have no owner.`);
}

function diff() {
  if (file === CONFIG_FILE)
    die('Pass the draft to compare: diff --config .claude/code-kit.draft.json');
  const live = load(CONFIG_FILE);
  const draft = load(file);
  const lines = diffConfigs(live.raw, draft.raw);
  const moves = ownershipMoves(tracked(), live.config, draft.config);
  if (lines.length === 0 && moves.length === 0) return out('No changes.');
  lines.forEach(out);
  const byRoute = Map.groupBy(moves, (m) => `${m.from} → ${m.to}`);
  for (const [route, files] of byRoute) {
    out(
      `Owner ${route}: ${files.length} file(s), e.g. ${files
        .slice(0, 3)
        .map((m) => m.file)
        .join(', ')}`,
    );
  }
}

/** Every layer violation in tracked code, by file. */
function violations(config) {
  const found = {};
  for (const rel of tracked().filter((f) => CODE.test(f) && existsSync(f))) {
    const problems = layerProblems(rel, read(rel), config);
    if (problems.length) found[rel] = problems;
  }
  return found;
}

/** What to record: everything at adoption; afterwards only what was already recorded (it only shrinks). */
function toRecord(found) {
  if (!existsSync(BASELINE_FILE)) return { keep: found, refused: [] };
  const before = loadBaseline('.').layers;
  const keep = {};
  const refused = [];
  for (const [rel, problems] of Object.entries(found)) {
    const known = problems.filter((p) => (before[rel] ?? []).includes(p));
    if (known.length) keep[rel] = known;
    refused.push(...problems.filter((p) => !known.includes(p)));
  }
  return { keep, refused };
}

function baseline() {
  const { config } = load();
  const found = violations(config);
  const count = Object.values(found).flat().length;
  Object.values(found).flat().forEach(out);
  out(`${count} violation(s) in ${Object.keys(found).length} file(s).`);
  if (!writeBaseline) return;
  const { keep, refused } = toRecord(found);
  const body = { recordedAt: new Date().toISOString(), layers: keep };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`);
  out(
    `Recorded ${Object.values(keep).flat().length} in ${BASELINE_FILE}: these don't block; new ones do.`,
  );
  if (refused.length) {
    die(`Not recorded (the baseline only shrinks); fix these instead:\n  ${refused.join('\n  ')}`);
  }
}

/** Workspace packages by name (package.json "name" → its folder), plus the config's aliases. */
function aliases() {
  const found = {};
  for (const p of tracked().filter((f) => f.endsWith('/package.json'))) {
    try {
      const name = JSON.parse(read(p)).name;
      if (name) found[name] = posix.dirname(p);
    } catch {
      // not a readable manifest
    }
  }
  const configured = existsSync(file) ? (JSON.parse(read(file)).importAliases ?? {}) : {};
  return { ...found, ...configured };
}

function graph() {
  const known = aliases();
  const files = tracked();
  // An import names a file without its extension, or a folder (its index): group files by their folder.
  const stems = new Set(files.map((f) => f.replace(/\.[^./]+$/, '')));
  const folderOf = (p) => (stems.has(p) || files.includes(p) ? posix.dirname(p) : p);
  const folder = (p) => folderOf(p).split('/').slice(0, depth).join('/');
  const edges = new Map();
  for (const rel of files.filter((f) => CODE.test(f) && existsSync(f))) {
    for (const spec of importsOf(read(rel))) {
      const target = targetOf(spec, rel, known);
      const real =
        target &&
        (stems.has(target) || files.some((f) => f === target || f.startsWith(`${target}/`)));
      if (!real) continue; // a package, or a path that doesn't exist (e.g. text inside a test fixture)
      const edge = `${folder(rel)} → ${folder(target)}`;
      if (folder(rel) !== folder(target)) edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  [...edges]
    .sort((a, b) => b[1] - a[1])
    .forEach(([edge, n]) => out(`${String(n).padStart(5)}  ${edge}`));
  out(`${edges.size} folder-to-folder dependencies at depth ${depth}.`);
}

const commands = {
  check,
  unowned,
  diff,
  baseline,
  graph,
  who: () => (rest.length ? who(rest) : usage()),
};
function usage() {
  die(
    'Usage: code-kit check | who <path>... | unowned | diff | baseline [--write] | graph [--depth N]   [--config file]',
  );
}
(commands[command] ?? usage)();
