// A project's standards (docs/specs/22-standards.md): named engineering rules, each graded (required or
// recommended) and saying how firmly code-kit applies it: `enforced` (an existing rule refuses the
// change), `checked` (the reviewer and the lead's review look for it) or `advice` (agents are told).
// Read from the standards file, merged with any an organisation's team provider supplies (STD-6).
// `parseStandards` and `standardsProblems` are also what a provider uses to check an organisation's
// standards files, so a project and its organisation are held to the same format.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { globsOverlap } from './teamfacts.mjs';

export const STANDARDS_FILE = 'docs/standards.md';
/** The standards an organisation's provider supplied, as last read (STD-6). */
export const INHERITED_FILE = '.claude/state/standards-inherited.json';
/** The approval that guards the standards file (STD-5). */
export const STANDARDS_APPROVAL = 'standards';

export const CATEGORIES = {
  PRI: 'principles',
  PAT: 'patterns',
  ARC: 'architecture',
  CON: 'conventions',
  POL: 'policies',
};
export const LEVELS = ['required', 'recommended'];
/** How firmly a standard is applied, weakest first. */
export const APPLIED = ['advice', 'checked', 'enforced'];
export const SOURCES = ['spec', 'decision', 'threat-model', 'code', 'organisation', 'other'];
export const ORIGINS = ['own', 'inherited', 'extended', 'tightened', 'waived'];
const RULE_KINDS = ['layers', 'protected', 'check', 'shell'];

/** Where the project keeps its standards: `docs.standards`, or docs/standards.md. */
export const standardsFile = (config) => config?.docs?.standards ?? STANDARDS_FILE;

const ID = /^[A-Z]{2,5}-\d+$/;
const HEADING = /^#{2,4}\s+([A-Z]{2,5}-\d+)\s+(.+?)\s*#*\s*$/;
const FIELDS = {
  level: 'level',
  applied: 'applied',
  layers: 'layers',
  layer: 'layers',
  why: 'why',
  source: 'source',
  'enforced by': 'enforcedBy',
  owner: 'owner',
  version: 'version',
};
const clean = (v) =>
  String(v ?? '')
    .replace(/`/g, '')
    .trim();

/** What a source says about where a standard came from: its kind, and its evidence's counts. */
export function sourceOf(text) {
  const t = String(text ?? '');
  const counts = t.match(/(\d+)\s+of\s+(\d+)/);
  const kind = /threat model/i.test(t)
    ? 'threat-model'
    : /\bdecision/i.test(t)
      ? 'decision'
      : /organi[sz]ation|inherited/i.test(t)
        ? 'organisation'
        : /\bcode\b|\bmodules?\b|\bfiles?\b/i.test(t) || counts
          ? 'code'
          : /\bspecs?\b|requirement|architecture|principles|brief/i.test(t)
            ? 'spec'
            : 'other';
  return {
    kind,
    count: counts ? Number(counts[1]) : null,
    of: counts ? Number(counts[2]) : null,
  };
}

/**
 * The rule an `enforced by` names: `layers`, `layers (domain may not import infrastructure)`,
 * `layers (web may not import the package pg)`, `protected (contracts)`, `check (lint)` or
 * `shell (deploys)`. Null when it names none of these.
 */
export function ruleOf(text) {
  const m = clean(text).match(/^(layers?|protected|check|shell)\b\s*(?:\((.*)\)|(.*))$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'layer' ? 'layers' : m[1].toLowerCase();
  const arg = clean(m[2] ?? m[3] ?? '');
  if (kind !== 'layers') return arg ? { kind, name: arg } : { kind };
  if (!arg) return { kind };
  const pkg = arg.match(/^(\S+)\s+may not import the package\s+(\S+)$/i);
  if (pkg) return { kind, from: pkg[1], package: pkg[2] };
  const layer = arg.match(/^(\S+)\s+may not (?:import|depend on)\s+(\S+)$/i);
  if (layer) return { kind, from: layer[1], to: layer[2] };
  return { kind, from: arg.split(/\s+/)[0] };
}

/**
 * The standards in a file's text: `### <id> <title>` headings, each followed by its fields as lines
 * (`level: required`, `- **Applied:** checked`). `{ standards, problems }`, the problems being lines
 * that look like fields but can't be read.
 */
export function parseStandards(text) {
  const standards = [];
  const problems = [];
  let current = null;
  String(text ?? '')
    .split('\n')
    .forEach((line, i) => {
      const h = line.match(HEADING);
      if (h) {
        current = {
          id: h[1],
          title: h[2].trim(),
          level: null,
          applied: null,
          layers: [],
          why: null,
          source: null,
          enforcedBy: null,
          owner: null,
          version: null,
          line: i + 1,
        };
        standards.push(current);
        return;
      }
      if (/^#{1,4}\s/.test(line)) {
        current = null;
        return;
      }
      if (!current) return;
      const f = line
        .replace(/^\s*[-*]\s+/, '')
        .replace(/\*\*/g, '')
        .match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
      const key = f && FIELDS[f[1].toLowerCase()];
      if (!key) return;
      const value = f[2].trim();
      if (key === 'layers') {
        const names = clean(value)
          .split(/[,;]|\band\b/)
          .map((n) => n.trim())
          .filter(Boolean);
        current.layers = names.length === 1 && /^all\b/i.test(names[0]) ? [] : names;
      } else if (key === 'level' || key === 'applied') current[key] = clean(value).toLowerCase();
      else current[key] = value;
    });
  return { standards, problems };
}

/** Whether the config has the rule an `enforced by` names; a sentence saying what's missing when not. */
export function ruleProblem(rule, config) {
  if (!rule) return 'it names no rule code-kit has';
  const layers = config.layers ?? [];
  const layer = (n) => layers.find((l) => l.name === n);
  if (rule.kind === 'layers') {
    if (!layers.length) return 'the config has no layers';
    if (rule.from && !layer(rule.from)) return `the config has no layer "${rule.from}"`;
    if (rule.to) {
      if (!layer(rule.to)) return `the config has no layer "${rule.to}"`;
      if (rule.to === rule.from || layer(rule.from).mayImport.includes(rule.to))
        return `${rule.from} may import ${rule.to} in the config, so nothing refuses it`;
    }
    if (rule.package && !matchesAny(rule.package, layer(rule.from).denyPackages ?? []))
      return `${rule.from}'s denyPackages don't include ${rule.package}`;
    return null;
  }
  if (!rule.name) return `it says ${rule.kind} but not which one`;
  if (rule.kind === 'protected')
    return (config.protected ?? []).some((p) => p.approval === rule.name || p.glob === rule.name)
      ? null
      : `no protected path has the approval or glob "${rule.name}"`;
  if (rule.kind === 'check')
    return (config.checks ?? []).some((c) => c.name === rule.name)
      ? null
      : `no check is named "${rule.name}"`;
  return (config.shell?.block ?? []).some(
    (b) => b.pattern === rule.name || String(b.why).toLowerCase().includes(rule.name.toLowerCase()),
  )
    ? null
    : `no shell.block rule's pattern or why matches "${rule.name}"`;
}

/**
 * Every problem with a list of standards, as sentences an agent can act on (STD-1). Without a config,
 * only the standards themselves are checked: an organisation's provider checks its files this way.
 */
export function standardsProblems(standards, config = null) {
  const p = [];
  const seen = new Set();
  const layerNames = new Set((config?.layers ?? []).map((l) => l.name));
  for (const s of standards) {
    const at = s.id;
    if (seen.has(s.id))
      p.push(`${at} appears twice: each standard needs its own id. Renumber one of them.`);
    seen.add(s.id);
    const prefix = String(s.id).split('-')[0];
    if (!ID.test(String(s.id)) || !CATEGORIES[prefix])
      p.push(
        `${at} has an unknown category: an id starts with PRI- (principles), PAT- (patterns), ARC- (architecture), CON- (conventions) or POL- (policies).`,
      );
    if (!s.title) p.push(`${at} needs a title: one sentence an agent can act on.`);
    if (!LEVELS.includes(s.level))
      p.push(`${at} needs a level: required or recommended (as "level: required").`);
    if (!APPLIED.includes(s.applied))
      p.push(
        `${at} needs to say how it's applied: enforced, checked or advice (as "applied: checked").`,
      );
    if (prefix === 'PRI' && s.applied === 'enforced')
      p.push(
        `${at} is a principle, and a principle can't be enforced, only checked or advised: mark it checked or advice.`,
      );
    else if (s.applied === 'enforced' && !s.enforcedBy)
      p.push(
        `${at} is enforced, but doesn't say what enforces it: add "enforced by:" naming a layer rule, a protected path's approval, a check or a shell rule, or mark it checked.`,
      );
    else if (s.applied === 'enforced' && config) {
      const why = ruleProblem(ruleOf(s.enforcedBy), config);
      if (why)
        p.push(
          `${at} is enforced by "${s.enforcedBy}", but ${why}. Name a rule .claude/code-kit.json has (${RULE_KINDS.map((k) => `${k} (…)`).join(', ')}), or mark it checked.`,
        );
    }
    if (config && layerNames.size)
      for (const l of s.layers ?? [])
        if (!layerNames.has(l))
          p.push(`${at} names the layer "${l}", which the config doesn't have.`);
  }
  return p;
}

const rank = (applied) => APPLIED.indexOf(applied);
const live = (w, now) => !w.expires || Date.parse(`${w.expires}T23:59:59Z`) >= now;

/** Whether `own` asks less than `base`: a lower level, a softer application, or fewer layers. */
function weaker(own, base) {
  if (base.level === 'required' && own.level === 'recommended') return true;
  if (base.level === 'required' && rank(own.applied) < rank(base.applied)) return true;
  if (base.level !== 'required') return false;
  if (!base.layers.length) return own.layers.length > 0;
  return own.layers.length > 0 && base.layers.some((l) => !own.layers.includes(l));
}

/**
 * The standards that apply (STD-6): the organisation's, with the project's own extending, tightening
 * or (with a waiver the provider confirms) weakening them, then the project's own. Each carries its
 * `origin`; a waived one carries its `waiver`. `problems` says which weakening has no waiver.
 */
export function mergeStandards(own, inherited = [], waivers = [], now = Date.now()) {
  const problems = [];
  const mine = new Map(own.map((s) => [s.id, s]));
  const out = [];
  for (const base of inherited) {
    const o = mine.get(base.id);
    mine.delete(base.id);
    if (!o) {
      out.push({ ...base, origin: 'inherited' });
      continue;
    }
    if (weaker(o, base)) {
      const w = waivers.find((x) => x.standard === base.id && live(x, now));
      if (!w) {
        problems.push(
          `${base.id} can't be weakened without a waiver: the organisation has it ${base.level} and ${base.applied}${base.layers.length ? ` for ${base.layers.join(', ')}` : ''}, and this project marks it ${o.level} and ${o.applied}${o.layers.length ? ` for ${o.layers.join(', ')}` : ''}. It applies as the organisation has it; ask for a waiver through the team provider, or drop the change.`,
        );
        out.push({ ...base, origin: 'inherited' });
        continue;
      }
      // A waiver for some paths leaves the standard in full everywhere else.
      out.push(
        (w.paths ?? []).length
          ? { ...base, origin: 'waived', waiver: w }
          : { ...base, ...pick(o), origin: 'waived', waiver: w },
      );
      continue;
    }
    const tighter =
      (base.level === 'recommended' && o.level === 'required') ||
      rank(o.applied) > rank(base.applied);
    out.push({
      ...base,
      ...pick(o),
      layers:
        base.layers.length && o.layers.length ? [...new Set([...base.layers, ...o.layers])] : [],
      origin: tighter ? 'tightened' : 'extended',
    });
  }
  for (const s of mine.values()) out.push({ ...s, origin: 'own' });
  return { standards: out, problems };
}

/** The project's fields that extend an inherited standard: everything it sets. */
const pick = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([k, v]) => v !== null && v !== '' && k !== 'line' && k !== 'layers'),
  );

/** The main checkout, where every worktree's state is shared. */
function mainCheckout(root) {
  try {
    const common = execFileSync(
      'git',
      ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return common ? dirname(common) : root;
  } catch {
    return root;
  }
}

/** The organisation's standards and waivers as the provider last gave them, or none. */
export function readInherited(root) {
  try {
    const r = JSON.parse(readFileSync(join(mainCheckout(root), INHERITED_FILE), 'utf8'));
    return {
      standards: Array.isArray(r.standards) ? r.standards : [],
      waivers: Array.isArray(r.waivers) ? r.waivers : [],
      version: r.version ?? null,
      at: r.at ?? null,
    };
  } catch {
    return { standards: [], waivers: [], version: null, at: null };
  }
}

/** Keeps what the provider's `standards()` answered (STD-6), for the hooks and instructions to read. */
export function writeInherited(root, answer) {
  const file = join(mainCheckout(root), INHERITED_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const norm = (s) => ({
    ...s,
    layers: Array.isArray(s.layers) ? s.layers : [],
    level: s.level ?? null,
    applied: s.applied ?? null,
  });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        version: answer?.version ?? null,
        standards: (answer?.standards ?? []).map(norm),
        waivers: answer?.waivers ?? [],
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * The standards that apply to the project at `root`: its file's, merged with the organisation's as last
 * read. `{ file, exists, standards, problems }`, `problems` covering both the file and the merge.
 */
export function projectStandards(root, config) {
  const file = standardsFile(config);
  const path = join(root, file);
  const exists = existsSync(path);
  const own = exists ? parseStandards(readFileSync(path, 'utf8')).standards : [];
  const inherited = readInherited(root);
  const merged = mergeStandards(own, inherited.standards, inherited.waivers);
  return {
    file,
    exists,
    version: inherited.version,
    standards: merged.standards,
    problems: [...standardsProblems(own, config), ...merged.problems],
  };
}

/** The layers a lane's paths fall in: any layer whose paths can name one of the lane's files. */
export function laneLayers(lane, config) {
  return (config.layers ?? [])
    .filter((l) => l.paths.some((lp) => (lane?.paths ?? []).some((p) => globsOverlap(lp, p))))
    .map((l) => l.name);
}

/** Whether a standard applies to any of `layers` (a standard for all layers applies everywhere). */
export const appliesTo = (s, layers) =>
  !s.layers?.length || !layers || layers.some((l) => s.layers.includes(l));

/** One line an agent acts on: "PAT-1 Data access goes through repositories (required, checked)". */
export function standardLine(s) {
  const from = s.origin && s.origin !== 'own' ? `, from the organisation` : '';
  const waived = s.waiver
    ? `; waived${s.waiver.paths?.length ? ` for ${s.waiver.paths.join(', ')}` : ''}${s.waiver.expires ? ` until ${s.waiver.expires}` : ''}`
    : '';
  return `${s.id} ${s.title} (${s.level}, ${s.applied}${from}${waived})`;
}

/** Whether an enforced standard's rule is the one a refusal came from. */
function names(rule, broke) {
  if (!rule || rule.kind !== broke.kind) return false;
  if (rule.kind === 'layers') {
    if (rule.from && rule.from !== broke.from) return false;
    if (rule.to) return rule.to === broke.to;
    if (rule.package) return Boolean(broke.package) && matchesAny(broke.package, [rule.package]);
    return true;
  }
  if (!rule.name) return true;
  if (rule.kind === 'shell')
    return String(broke.name ?? '')
      .toLowerCase()
      .includes(rule.name.toLowerCase());
  return rule.name === broke.name || (rule.kind === 'protected' && rule.name === broke.glob);
}

/**
 * STD-4: the sentence a refusal adds when an enforced standard names the rule that refused, as
 * " This is the project's standard ARC-2: Domain code doesn't import infrastructure." Empty otherwise.
 * `broke` is one rule or several: { kind: 'layers', from, to | package } | { kind: 'protected',
 * name, glob } | { kind: 'check', name } | { kind: 'shell', name }.
 */
export function standardsNote(standards, broke) {
  const rules = [broke].flat().filter(Boolean);
  const hit = standards.filter(
    (s) => s.applied === 'enforced' && rules.some((b) => names(ruleOf(s.enforcedBy), b)),
  );
  if (!hit.length) return '';
  return hit.length === 1
    ? ` This is the project's standard ${hit[0].id}: ${hit[0].title}.`
    : ` This breaks the project's standards ${hit.map((s) => `${s.id} (${s.title})`).join(', ')}.`;
}

/** The note for the project at `root`, reading its standards; empty when it has none. */
export function noteFor(root, config, broke) {
  try {
    return standardsNote(projectStandards(root, config).standards, broke);
  } catch {
    return '';
  }
}

/**
 * STD-5: what a change to the standards file takes away: standards removed, and required ones made
 * recommended, applied more softly, or held to fewer layers. Sentences, empty when nothing is weakened.
 */
export function standardsWeakenings(beforeText, afterText) {
  const before = parseStandards(beforeText).standards;
  const after = new Map(parseStandards(afterText).standards.map((s) => [s.id, s]));
  const out = [];
  for (const b of before) {
    const a = after.get(b.id);
    if (!a) out.push(`${b.id} (${b.title}) is removed`);
    else if (weaker(a, b))
      out.push(
        `${b.id} goes from ${b.level} and ${b.applied}${b.layers.length ? ` for ${b.layers.join(', ')}` : ''} to ${a.level} and ${a.applied}${a.layers.length ? ` for ${a.layers.join(', ')}` : ''}`,
      );
  }
  return out;
}
