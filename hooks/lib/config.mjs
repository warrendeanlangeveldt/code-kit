// The project's rules live in .claude/code-kit.json. The hooks read it from the project the session
// was opened in; a project without one is not governed by the kit, and an invalid one fails closed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { harnessProblems, harnessSettings } from './harness.mjs';
import { teamProblems } from './team.mjs';
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

/**
 * The config as committed on `ref`: what governs merging into it, so a branch's own config can't grant
 * itself a merge its target doesn't allow. `{ config }`, `{ error }` when it's invalid, or `{}` when
 * `ref` has none committed yet (the first merge, which brings code-kit's rules onto it).
 */
export function committedConfig(root, ref, file = CONFIG_FILE) {
  let text;
  try {
    text = execFileSync('git', ['-C', root, 'show', `${ref}:${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return {};
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `${file} on ${ref} is not valid JSON: ${e.message}` };
  }
  const problems = validate(raw);
  if (problems.length)
    return { error: `${file} on ${ref} is invalid:\n  ${problems.join('\n  ')}` };
  return { config: effectiveConfig(raw, root) };
}

/**
 * Whether the lead may merge into the base (the first protected branch), by the rules committed there:
 * `{ into, delegated, first }`, `first` when the base has no config committed yet.
 */
export function mergeDelegation(root, config, file = CONFIG_FILE) {
  const into = config.branches.protected[0];
  const { config: target, error } = committedConfig(root, into, file);
  return { into, delegated: Boolean(target?.approvals.delegate?.merge), first: !target && !error };
}

/** The rules the hooks enforce: the project's config, the kit's defaults, and any active adapters. */
export const effectiveConfig = (raw, root) => applyAdapters(withDefaults(raw), raw, root);

/** An anyActor entry's glob: entries are globs, or { glob, reviewer } naming who reviews changes to it. */
export const anyActorGlob = (e) => (typeof e === 'string' ? e : e?.glob);

/** The engine's fixed rules, merged into the project's: the kit and Claude's own files belong to the lead. */
export function withDefaults(c) {
  return {
    ...c,
    lead: {
      paths: [...c.lead.paths, '.claude/**'],
      outside: [...(c.lead.outside ?? []), ...CLAUDE_OWN],
    },
    anyActor: [...(c.anyActor ?? []).map(anyActorGlob), '.claude/state/**'],
    // Who reviews changes to files any agent may write; the lead unless an entry names a lane.
    anyActorReviewers: (c.anyActor ?? [])
      .filter((e) => typeof e === 'object' && e?.reviewer)
      .map((e) => ({ glob: e.glob, reviewer: e.reviewer })),
    protected: [KIT, ...(c.protected ?? []).filter((p) => p.glob !== KIT.glob)],
    layers: c.layers ?? [],
    importAliases: c.importAliases ?? {},
    shell: { block: c.shell?.block ?? [], restricted: c.shell?.restricted ?? [] },
    postEdit: c.postEdit ?? [],
    checks: c.checks ?? [],
    tests: c.tests ?? [],
    regression: { prepare: c.regression?.prepare ?? null },
    branches: { protected: c.branches?.protected ?? ['main', 'master'] },
    approvals: {
      lead: c.approvals?.lead === true,
      delegate: delegateRules(c.approvals?.delegate, c.protected ?? []),
    },
    harness: harnessSettings(c.harness),
  };
}

/** WHO-1: the approvals the person keeps when the config says nothing: product, design, CI and the kit. */
export const PERSON_KEEPS = ['spec', 'design', 'ci', 'kit'];

/**
 * The rules within which the lead approves on its own (`approvals.delegate`), or null when it may not:
 * the protected approvals it may grant, the dependency rule packages must meet, merges, and weakened
 * tests on a lane's branch. WHO-1: with no `approvals.delegate`, the lead decides everything technical:
 * every protected approval but the person's (PERSON_KEEPS), dependencies within the registry's
 * defaults, merges and weakened tests. `false` keeps everything for the person.
 */
function delegateRules(given, protectedPaths = []) {
  if (given === false) return null;
  const d = given ?? {
    protected: [...new Set(protectedPaths.map((p) => p.approval))].filter(
      (a) => a && !PERSON_KEEPS.includes(a),
    ),
    merge: true,
    tests: true,
    dependencies: {},
  };
  return {
    protected: d.protected ?? [],
    merge: d.merge === true,
    tests: d.tests === true,
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
          // true (any), false (none), or the kinds allowed: binary, build (lib/registry.mjs).
          allowInstallScripts:
            d.dependencies.allowInstallScripts === true ||
            (Array.isArray(d.dependencies.allowInstallScripts)
              ? d.dependencies.allowInstallScripts
              : false),
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

/**
 * ONB-5: the version of init's setup. 2 adds project skills with the lane agents, the design gate for
 * lanes with screens, a QA lane for end-to-end tests, and companions set up before coding; 3 adds the
 * security reviewer (ONB-7, spec 17). A project set up before (no `setup`, or a lower one) is told what
 * re-running init adds.
 */
/**
 * WHO-3: who decides each approval, as the Settings tab's Approvals rows: one per protected approval
 * (but the kit, which is always the person's), dependencies with the registry's rules, merges and
 * weakened tests. Each row: { key, value, default, about, choices?, section: 'Approvals' }.
 */
export function approvalSettings(config) {
  const rules = config.approvals.delegate;
  const who = (lead) => (lead ? 'lead' : 'person');
  const names = [...new Set(config.protected.map((p) => p.approval))].filter((n) => n !== 'kit');
  const fallback = delegateRules(undefined, config.protected) ?? {};
  const deps = rules?.dependencies ?? delegateRules({ dependencies: {} }).dependencies;
  const row = (key, value, dflt, about, choices) => ({
    key,
    value,
    default: dflt,
    about,
    section: 'Approvals',
    ...(choices ? { choices } : {}),
  });
  return [
    ...names.map((n) =>
      row(
        `approvals.${n}`,
        who(rules?.protected.includes(n)),
        who(fallback.protected?.includes(n)),
        `Who approves a lane's change to what's protected as "${n}"`,
        ['lead', 'person'],
      ),
    ),
    row(
      'approvals.dependencies',
      who(Boolean(rules?.dependencies)),
      'lead',
      "Who approves a lane's new package: the lead within the registry's rules, or you",
      ['lead', 'person'],
    ),
    row(
      'approvals.dependencies.licences',
      deps.licences.join(','),
      'MIT,Apache-2.0,BSD-2-Clause,BSD-3-Clause,ISC',
      'The licences a package the lead approves may have, comma-separated',
    ),
    row(
      'approvals.dependencies.minWeeklyDownloads',
      deps.minWeeklyDownloads,
      10_000,
      'The weekly downloads a package the lead approves must have, at least',
    ),
    row(
      'approvals.dependencies.maxMonthsSinceRelease',
      deps.maxMonthsSinceRelease,
      18,
      "Months since a package's last release, at most, for the lead to approve it",
    ),
    row(
      'approvals.dependencies.allowInstallScripts',
      Array.isArray(deps.allowInstallScripts)
        ? deps.allowInstallScripts.join(',')
        : deps.allowInstallScripts,
      false,
      'Install scripts a package the lead approves may run: true, false, or kinds (binary, build, other)',
    ),
    row(
      'approvals.merge',
      who(Boolean(rules?.merge)),
      'lead',
      'Who merges a reviewed branch into the base: merging is not releasing',
      ['lead', 'person'],
    ),
    row(
      'approvals.tests',
      who(Boolean(rules?.tests)),
      'lead',
      "Who approves a weakened test on a lane's branch, after review; on the lead's own branches it is always you",
      ['lead', 'person'],
    ),
  ];
}

/** WHO-3: the raw config with one approval setting changed (a copy), the rules written out in full. */
export function withApprovalSetting(raw, config, key, text) {
  const rules = config.approvals.delegate;
  const deps = rules?.dependencies ?? null;
  const delegate = {
    protected: [...(rules?.protected ?? [])],
    merge: Boolean(rules?.merge),
    tests: Boolean(rules?.tests),
    ...(deps ? { dependencies: { ...deps } } : {}),
  };
  const lead = text === 'lead' ? true : text === 'person' ? false : null;
  const rule = key.replace(/^approvals\./, '');
  const depRule = rule.startsWith('dependencies.') ? rule.slice('dependencies.'.length) : null;
  if (depRule) {
    const base = delegate.dependencies ?? delegateRules({ dependencies: {} }).dependencies;
    const list = String(text)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const value =
      depRule === 'licences'
        ? list
        : depRule === 'allowInstallScripts'
          ? text === 'true' || (text === 'false' ? false : list)
          : /^\d+$/.test(text)
            ? Number(text)
            : text;
    delegate.dependencies = { ...base, [depRule]: value };
  } else if (lead === null) return null;
  else if (rule === 'dependencies')
    lead
      ? (delegate.dependencies = deps ?? delegateRules({ dependencies: {} }).dependencies)
      : delete delegate.dependencies;
  else if (rule === 'merge' || rule === 'tests') delegate[rule] = lead;
  else if (config.protected.some((p) => p.approval === rule) && rule !== 'kit')
    delegate.protected = lead
      ? [...new Set([...delegate.protected, rule])]
      : delegate.protected.filter((n) => n !== rule);
  else return null;
  const copy = structuredClone(raw);
  copy.approvals = { ...(copy.approvals ?? {}), delegate };
  return copy;
}

export const SETUP_VERSION = 3;

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
  need(
    c.setup === undefined ||
      (Number.isInteger(c.setup) && c.setup >= 1 && c.setup <= SETUP_VERSION),
    `"setup" must be a whole number from 1 to ${SETUP_VERSION}: the version of init's setup the project has`,
  );
  // A brownfield project may have no specs yet: then there is no spec-check gate.
  need(c.docs === undefined || isObj(c.docs), '"docs" must be an object');
  for (const k of ['specs', 'principles', 'plan', 'decisions', 'standards'])
    need(c.docs?.[k] === undefined || isStr(c.docs[k]), `"docs.${k}" must be a path`);
  need(isObj(c.lead) && isList(c.lead?.paths), '"lead.paths" must be a list of globs');
  need(
    c.lead?.outside === undefined || isList(c.lead.outside),
    '"lead.outside" must be a list of globs',
  );
  validateLanes(c, need);
  const lanes = Object.keys(isObj(c.lanes) ? c.lanes : {});
  need(
    c.anyActor === undefined ||
      (Array.isArray(c.anyActor) &&
        c.anyActor.every(
          (e) =>
            isStr(e) ||
            (isObj(e) &&
              isStr(e.glob) &&
              (e.reviewer === undefined || e.reviewer === 'lead' || lanes.includes(e.reviewer))),
        )),
    '"anyActor" must be a list of globs, or { "glob", "reviewer" } with the lead or a lane as reviewer',
  );
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
  need(c.tests === undefined || isList(c.tests), '"tests" must be a list of globs: the test files');
  need(
    c.regression === undefined ||
      (isObj(c.regression) && (c.regression.prepare === undefined || isStr(c.regression.prepare))),
    '"regression" must be { prepare?: a command run in a fresh checkout before a fix\'s tests }',
  );
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
      d === false ||
      (isObj(d) &&
        (d.protected === undefined || isList(d.protected)) &&
        [undefined, true, false].includes(d.merge) &&
        [undefined, true, false].includes(d.tests) &&
        (dep === undefined ||
          (isObj(dep) &&
            (dep.licences === undefined || isList(dep.licences)) &&
            isCount(dep.minWeeklyDownloads) &&
            isCount(dep.maxMonthsSinceRelease) &&
            ([undefined, true, false].includes(dep.allowInstallScripts) ||
              (isList(dep.allowInstallScripts) &&
                dep.allowInstallScripts.every((k) => ['binary', 'build', 'other'].includes(k))))))),
    '"approvals.delegate" must be false, or { protected?: [approval names], merge?: true|false, tests?: true|false, dependencies?: { licences?, minWeeklyDownloads?, maxMonthsSinceRelease?, allowInstallScripts?: true|false|["binary","build","other"] } }',
  );
  need(
    c.branches === undefined || isList(c.branches?.protected),
    '"branches.protected" must be a list of branch names',
  );
  p.push(...harnessProblems(c.harness));
  p.push(...teamProblems(c));
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
  const blockRule = (r) =>
    rule(r) &&
    [undefined, true, false].includes(r.person) &&
    [undefined, true, false].includes(r.command);
  need(
    s.block === undefined || (Array.isArray(s.block) && s.block.every(blockRule)),
    '"shell.block" must be a list of { pattern, why, person?, command? }',
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
