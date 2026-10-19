// ONB-8: the parts of a project's instructions that are code-kit's own: the lead's section of CLAUDE.md
// and the "Always:" rules of each lane agent. Each is rendered from code-kit's templates and the
// project's config, and kept between markers, so a newer code-kit can tell they're out of date and bring
// them up to date exactly, leaving everything the project wrote around them as it is.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version of code-kit's instructions: raised whenever the templates' rules change. */
export const INSTRUCTIONS_VERSION = 5;

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
const BEGIN = (v) => `<!-- code-kit:begin v${v} -->`;
const END = '<!-- code-kit:end -->';
const MARKED = /<!-- code-kit:begin v(\d+) -->\n[\s\S]*?<!-- code-kit:end -->/;
const CI_WORKFLOW = '.github/workflows/code-kit.yml';

/** `{{if key}}…{{end}}` kept where `facts[key]`, dropped otherwise; `{{key}}` replaced by `facts[key]`. */
function fill(text, facts) {
  return text
    .replace(/^([ \t]*- )?\{\{if ([\w.]+)\}\}([\s\S]*?)\{\{end\}\}\n?/gm, (_, item, key, body) =>
      facts[key] ? `${item ?? ''}${body}\n` : '',
    )
    .replace(/\{\{([\w.]+)\}\}/g, (whole, key) => (key in facts ? String(facts[key]) : whole))
    .replace(/\n{3,}/g, '\n\n');
}

/** What the templates need from the project: everything the config and the repository say. */
function factsOf(root, config) {
  const delegated = new Set(config.approvals?.delegate?.protected ?? []);
  const kept = [];
  for (const p of config.protected ?? []) {
    if (p.approval === 'kit' || delegated.has(p.approval)) continue;
    if (!kept.some((k) => k.approval === p.approval)) kept.push(p);
  }
  return {
    layers: (config.layers ?? []).map((l) => l.name).join(', ') || 'none set',
    designGate: config.designGate ? '; designs approved before screens' : '',
    personKeeps: kept.length
      ? kept.map((p) => `\`${p.approval}\` (${p.why})`).join(', ')
      : 'changes to the rules themselves',
    'approvals.lead': Boolean(config.approvals?.lead),
    'harness.report.on': Boolean(config.harness?.report?.on),
    ci: existsSync(join(root, CI_WORKFLOW)),
    'docs.specs': config.docs?.specs ?? 'the specs',
    'docs.plan': config.docs?.plan ?? 'the plan',
    'docs.principles': config.docs?.principles ?? "the project's principles",
  };
}

const marked = (body) => `${BEGIN(INSTRUCTIONS_VERSION)}\n${body.trim()}\n${END}`;

/** The lead's section of CLAUDE.md, between its markers. */
export function leadSection(root, config) {
  return marked(fill(readFileSync(join(TEMPLATES, 'claude-md.md'), 'utf8'), factsOf(root, config)));
}

/** A lane agent's "Always:" rules, between their markers. */
export function agentRules(root, config) {
  const template = readFileSync(join(TEMPLATES, 'agent.md'), 'utf8');
  return marked(fill(template.slice(template.indexOf('Always:')), factsOf(root, config)));
}

/** Whether two renderings say the same, whatever their whitespace and list indentation. */
const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

const LEAD_LEGACY = /^## Enforced, not advised\s*$/;
const AGENT_LEGACY = /^Always:\s*$/;

/**
 * Where a file's code-kit part stands: `current`; `stale` (marked, from an older code-kit or an older
 * config); `legacy` (written before the markers, often tailored by hand, so merged once by the lead, not
 * overwritten); or `missing` (none yet).
 */
function stateOf(text, block, legacy) {
  const m = MARKED.exec(text);
  // A formatter that rewraps the project's markdown doesn't make code-kit's part out of date.
  if (m) return { state: same(m[0], block) ? 'current' : 'stale', version: Number(m[1]) };
  if (text.split('\n').some((l) => legacy.test(l))) return { state: 'legacy', version: 0 };
  return { state: 'missing', version: null };
}

/**
 * Each file holding code-kit's instructions: `{ file, kind, state, version, block, next }`, `next` being
 * the file brought up to date (null for a legacy one, which the lead merges). The lead's CLAUDE.md, and
 * the agent file of every lane whose agent file exists.
 */
export function instructionsState(root, config) {
  const lead = leadSection(root, config);
  const rules = agentRules(root, config);
  const files = [
    { file: 'CLAUDE.md', kind: 'lead', block: lead, legacy: LEAD_LEGACY },
    ...[...new Set(Object.values(config.lanes ?? {}).map((l) => l.agent))]
      .map((agent) => ({
        file: `.claude/agents/${agent}.md`,
        kind: 'lane',
        block: rules,
        legacy: AGENT_LEGACY,
      }))
      .filter((f) => existsSync(join(root, f.file))),
  ];
  return files.map(({ file, kind, block, legacy }) => {
    const path = join(root, file);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const { state, version } = stateOf(text, block, legacy);
    const next =
      state === 'stale'
        ? text.replace(MARKED, block)
        : state === 'missing'
          ? `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${block}\n`
          : null;
    return { file, kind, state, version, block, next };
  });
}

/** Brings every marked or missing part of code-kit's instructions up to date; the files it changed. */
export function writeInstructions(root, config) {
  const changed = [];
  for (const f of instructionsState(root, config)) {
    if (!f.next) continue;
    mkdirSync(dirname(join(root, f.file)), { recursive: true });
    writeFileSync(join(root, f.file), f.next);
    changed.push(f.file);
  }
  return changed;
}
