// The project's rules live in .claude/code-kit.json. The hooks read it from the project the session
// was opened in; a project without one is not governed by the kit, and an invalid one fails closed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, applyAdapters } from './adapters/index.mjs';

export const CONFIG_FILE = '.claude/code-kit.json';
// Claude's own memory and session scratchpad, which the lead always writes.
export const CLAUDE_OWN = [
  '~/.claude/projects/*/memory/**',
  '/private/tmp/claude-*/**',
  '/tmp/claude-*/**',
];
const KIT = { glob: '.claude/**', approval: 'kit', why: 'the rules that constrain agents' };

/** `{ config }` when the project has a valid config, `{ error }` when it is invalid, `{}` when it has none. */
export function loadConfig(projectDir) {
  const file = join(projectDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `${CONFIG_FILE} is not valid JSON: ${e.message}` };
  }
  const problems = validate(raw);
  if (problems.length) return { error: `${CONFIG_FILE} is invalid:\n  ${problems.join('\n  ')}` };
  return { config: effectiveConfig(raw, projectDir) };
}

/** The rules the hooks enforce: the project's config, the kit's defaults, and any active adapters. */
export const effectiveConfig = (raw, root) => applyAdapters(withDefaults(raw), raw, root);

/** The engine's fixed rules, merged into the project's: the kit and Claude's own files belong to the lead. */
export function withDefaults(c) {
  return {
    ...c,
    lead: {
      paths: [...c.lead.paths, '.claude/**'],
      outside: [...(c.lead.outside ?? []), ...CLAUDE_OWN],
    },
    anyActor: [...(c.anyActor ?? []), '.claude/state/**'],
    protected: [KIT, ...(c.protected ?? []).filter((p) => p.glob !== KIT.glob)],
    layers: c.layers ?? [],
    importAliases: c.importAliases ?? {},
    shell: { block: c.shell?.block ?? [], restricted: c.shell?.restricted ?? [] },
    postEdit: c.postEdit ?? [],
    checks: c.checks ?? [],
    branches: { protected: c.branches?.protected ?? ['main', 'master'] },
    approvals: { lead: c.approvals?.lead === true, delegate: delegateRules(c.approvals?.delegate) },
  };
}

/**
 * The rules within which the lead approves on its own (`approvals.delegate`), or null when it may not:
 * the protected approvals it may grant, and the dependency rule packages must meet.
 */
function delegateRules(d) {
  if (!d) return null;
  return {
    protected: d.protected ?? [],
    dependencies: d.dependencies
      ? {
          licences: d.dependencies.licences ?? [
            'MIT',
            'Apache-2.0',
            'BSD-2-Clause',
            'BSD-3-Clause',
            'ISC',
          ],
          minWeeklyDownloads: d.dependencies.minWeeklyDownloads ?? 10_000,
          maxMonthsSinceRelease: d.dependencies.maxMonthsSinceRelease ?? 18,
          allowInstallScripts: d.dependencies.allowInstallScripts === true,
        }
      : null,
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isList = (v) => Array.isArray(v) && v.every(isStr);
const isRegExp = (v) => {
  try {
    return isStr(v) && Boolean(new RegExp(v));
  } catch {
    return false;
  }
};

/** Every problem with a parsed config, as readable sentences; empty when it is valid. */
export function validate(c) {
  if (!isObj(c)) return ['the config must be a JSON object'];
  const p = [];
  const need = (ok, msg) => {
    if (!ok) p.push(msg);
    return ok;
  };
  const each = (key, fn) => {
    if (c[key] === undefined) return;
    if (!need(Array.isArray(c[key]), `"${key}" must be a list`)) return;
    c[key].forEach((item, i) =>
      isObj(item) ? fn(item, `${key}[${i}]`) : p.push(`${key}[${i}] must be an object`),
    );
  };
  need(c.version === 1, '"version" must be 1');
  // A brownfield project may have no specs yet: then there is no spec-check gate.
  need(c.docs === undefined || isObj(c.docs), '"docs" must be an object');
  for (const k of ['specs', 'principles', 'plan'])
    need(c.docs?.[k] === undefined || isStr(c.docs[k]), `"docs.${k}" must be a path`);
  need(isObj(c.lead) && isList(c.lead?.paths), '"lead.paths" must be a list of globs');
  need(
    c.lead?.outside === undefined || isList(c.lead.outside),
    '"lead.outside" must be a list of globs',
  );
  need(c.anyActor === undefined || isList(c.anyActor), '"anyActor" must be a list of globs');
  validateLanes(c, need);
  const lanes = Object.keys(isObj(c.lanes) ? c.lanes : {});
  each('protected', (e, at) => {
    need(isStr(e.glob) && isStr(e.why), `${at} needs "glob" and "why"`);
    need(
      /^[a-z][a-z0-9-]*$/.test(e.approval ?? ''),
      `${at}.approval must be a short lower-case name`,
    );
  });
  if (c.designGate !== undefined) validateDesignGate(c.designGate, need);
  validateLayers(c, need, each);
  if (c.shell !== undefined) validateShell(c.shell, lanes, need);
  each('postEdit', (e, at) => {
    need(
      isList(e.files) && isStr(e.run),
      `${at} needs "files" (globs) and "run" (a command; {file} is the edited file)`,
    );
    need(e.exclude === undefined || isList(e.exclude), `${at}.exclude must be a list of globs`);
  });
  each('checks', (e, at) => validateCheck(e, at, lanes, need));
  const known = ADAPTERS.map((a) => a.name);
  need(
    c.adapters === undefined ||
      (isObj(c.adapters) &&
        Object.entries(c.adapters).every(([k, v]) => known.includes(k) && typeof v === 'boolean')),
    `"adapters" must map adapter names (${known.join(', ')}) to true or false`,
  );
  need(
    c.approvals === undefined ||
      (isObj(c.approvals) && [undefined, true, false].includes(c.approvals.lead)),
    '"approvals.lead" must be true or false',
  );
  const d = c.approvals?.delegate;
  const dep = d?.dependencies;
  const isCount = (v) => v === undefined || (Number.isInteger(v) && v >= 0);
  need(
    d === undefined ||
      (isObj(d) &&
        (d.protected === undefined || isList(d.protected)) &&
        (dep === undefined ||
          (isObj(dep) &&
            (dep.licences === undefined || isList(dep.licences)) &&
            isCount(dep.minWeeklyDownloads) &&
            isCount(dep.maxMonthsSinceRelease) &&
            [undefined, true, false].includes(dep.allowInstallScripts)))),
    '"approvals.delegate" must be { protected?: [approval names], dependencies?: { licences?, minWeeklyDownloads?, maxMonthsSinceRelease?, allowInstallScripts? } }',
  );
  need(
    c.branches === undefined || isList(c.branches?.protected),
    '"branches.protected" must be a list of branch names',
  );
  return p;
}

function validateLanes(c, need) {
  if (!need(isObj(c.lanes), '"lanes" must be an object (it may be empty)')) return;
  const agents = new Set();
  for (const [name, lane] of Object.entries(c.lanes)) {
    if (!need(isObj(lane), `lanes.${name} must be an object`)) continue;
    need(
      isList(lane.paths) && lane.paths.length > 0,
      `lanes.${name}.paths must list the globs the lane owns`,
    );
    need(isStr(lane.agent), `lanes.${name}.agent must name the lane's agent`);
    need(
      lane.exclude === undefined || isList(lane.exclude),
      `lanes.${name}.exclude must be a list of globs`,
    );
    need(!agents.has(lane.agent), `lanes.${name}.agent "${lane.agent}" is used by another lane`);
    agents.add(lane.agent);
  }
}

function validateDesignGate(g, need) {
  need(
    isObj(g) && isStr(g.register) && isStr(g.howTo),
    '"designGate" needs "register" and "howTo"',
  );
  const ok =
    Array.isArray(g?.screens) &&
    g.screens.every((s) => isStr(s?.glob) && (s.not === undefined || isRegExp(s.not)));
  need(ok, '"designGate.screens" must be a list of { glob, not? (a regular expression) }');
}

function validateLayers(c, need, each) {
  const names = new Set((Array.isArray(c.layers) ? c.layers : []).map((l) => l?.name));
  each('layers', (l, at) => {
    need(isStr(l.name) && isList(l.paths), `${at} needs "name" and "paths"`);
    need(
      isList(l.mayImport),
      `${at}.mayImport must list the layers it may depend on (may be empty)`,
    );
    for (const n of isList(l.mayImport) ? l.mayImport : [])
      need(names.has(n), `${at}.mayImport names an unknown layer "${n}"`);
    need(
      l.denyPackages === undefined || isList(l.denyPackages),
      `${at}.denyPackages must be a list of globs`,
    );
  });
  const aliases = c.importAliases;
  need(
    aliases === undefined || (isObj(aliases) && Object.values(aliases).every(isStr)),
    '"importAliases" must map import prefixes to repository paths',
  );
}

function validateShell(s, lanes, need) {
  if (!need(isObj(s), '"shell" must be an object')) return;
  const rule = (r) => isObj(r) && isRegExp(r.pattern) && isStr(r.why);
  const blockRule = (r) => rule(r) && [undefined, true, false].includes(r.person);
  need(
    s.block === undefined || (Array.isArray(s.block) && s.block.every(blockRule)),
    '"shell.block" must be a list of { pattern, why, person? }',
  );
  const restricted =
    s.restricted === undefined ||
    (Array.isArray(s.restricted) && s.restricted.every((r) => rule(r) && isList(r.lanes)));
  need(restricted, '"shell.restricted" must be a list of { pattern, lanes, why }');
  for (const r of Array.isArray(s.restricted) ? s.restricted : []) {
    for (const l of isList(r?.lanes) ? r.lanes : [])
      need(lanes.includes(l), `"shell.restricted" names an unknown lane "${l}"`);
  }
}

function validateCheck(e, at, lanes, need) {
  need(
    isStr(e.name) && isList(e.files) && isList(e.run) && e.run.length > 0,
    `${at} needs "name", "files" (globs) and "run" (commands)`,
  );
  need(e.exclude === undefined || isList(e.exclude), `${at}.exclude must be a list of globs`);
  need(e.each === undefined || isStr(e.each), `${at}.each must be a directory glob`);
  need(
    e.ifMissing === undefined || ['skip', 'fail'].includes(e.ifMissing),
    `${at}.ifMissing must be "skip" or "fail"`,
  );
  need(
    e.timeoutSeconds === undefined || (Number.isInteger(e.timeoutSeconds) && e.timeoutSeconds > 0),
    `${at}.timeoutSeconds must be a positive whole number`,
  );
  for (const l of isList(e.owners) ? e.owners : [])
    need(lanes.includes(l), `${at}.owners names an unknown lane "${l}"`);
  need(e.owners === undefined || isList(e.owners), `${at}.owners must be a list of lanes`);
}
