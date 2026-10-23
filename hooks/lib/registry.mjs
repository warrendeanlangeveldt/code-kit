// What the npm registry, or PyPI for a Python package, says about a package, for the lead's delegated
// dependency approvals: the licence, how often it's downloaded, when it was last released, and whether
// installing it runs scripts. The rule itself is a pure function, so it's tested without the network.
import { DEPENDENCY_APPROVAL } from './dependencies.mjs';

const REGISTRY = () => process.env.CODE_KIT_NPM_REGISTRY ?? 'https://registry.npmjs.org';
const DOWNLOADS = () => process.env.CODE_KIT_NPM_DOWNLOADS ?? 'https://api.npmjs.org';
const PYPI = () => process.env.CODE_KIT_PYPI ?? 'https://pypi.org';
const PYPI_STATS = () => process.env.CODE_KIT_PYPI_STATS ?? 'https://pypistats.org';

/** The package managers whose packages come from PyPI. */
export const PYPI_MANAGERS = new Set(['pip', 'uv', 'poetry', 'pipenv', 'pdm']);

/** The package an approval name stands for: `dep-@scope+pkg` → `@scope/pkg`. */
export const packageOf = (approvalName) =>
  approvalName.slice(DEPENDENCY_APPROVAL.length).replace(/\+/g, '/');

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

// Kinds of install script, for the rule's allowInstallScripts:
//   binary  fetches a prebuilt binary for this platform (esbuild, sharp): a prebuild tool, or a script
//           beside optional dependencies built per platform;
//   build   compiles native code from source (node-gyp);
//   other   anything else: code the package runs on install.
const BINARY_TOOLS =
  /\b(prebuild-install|node-pre-gyp|node-gyp-build|prebuildify|napi-postinstall)\b/;
const PLATFORM = /(darwin|linux|win32|windows|freebsd|android|musl|arm64|x64|ia32)/;

/** The kind of install script a package version runs (binary, build or other), or null for none. */
export function installScriptKind(version) {
  const scripts = INSTALL_SCRIPTS.map((s) => version?.scripts?.[s]).filter(Boolean);
  if (!scripts.length) return null;
  const text = scripts.join(' && ');
  const perPlatform = Object.keys(version?.optionalDependencies ?? {}).filter((d) =>
    PLATFORM.test(d),
  );
  if (BINARY_TOOLS.test(text) || perPlatform.length >= 2) return 'binary';
  if (/\bnode-gyp\b|\bcmake-js\b/.test(text)) return 'build';
  return 'other';
}

const KIND_WORDS = {
  binary: 'downloads a prebuilt binary',
  build: 'compiles native code',
  other: 'runs its own code',
};

/** { licence, weeklyDownloads, lastRelease (ISO), installScripts, installScriptKind } for `pkg`, or { error }. */
export async function npmFacts(pkg) {
  const name = pkg.startsWith('@')
    ? `@${encodeURIComponent(pkg.slice(1))}`
    : encodeURIComponent(pkg);
  try {
    const meta = await fetch(`${REGISTRY()}/${name}`, {
      headers: { accept: 'application/json' },
    });
    if (meta.status === 404) return { error: `${pkg} isn't on the npm registry` };
    if (!meta.ok) return { error: `the npm registry answered ${meta.status} for ${pkg}` };
    const doc = await meta.json();
    const latest = doc['dist-tags']?.latest;
    const version = latest ? doc.versions?.[latest] : undefined;
    const licence = version?.license ?? doc.license;
    const dl = await fetch(`${DOWNLOADS()}/downloads/point/last-week/${name}`);
    const weeklyDownloads = dl.ok ? ((await dl.json()).downloads ?? 0) : 0;
    return {
      licence: typeof licence === 'string' ? licence : (licence?.type ?? 'unknown'),
      weeklyDownloads,
      lastRelease: (latest && doc.time?.[latest]) ?? doc.time?.modified ?? null,
      installScripts: INSTALL_SCRIPTS.some((s) => version?.scripts?.[s]),
      installScriptKind: installScriptKind(version),
    };
  } catch (e) {
    return { error: `couldn't reach the npm registry (${e.message})` };
  }
}

// PyPI's licence words as the SPDX ids a rule names: its classifiers first, then its free-text field.
const PYPI_LICENCES = [
  [/\bMIT\b/i, 'MIT'],
  [/\bApache\b.*2|Apache Software License/i, 'Apache-2.0'],
  [/BSD.*3|3-Clause|New BSD|Modified BSD/i, 'BSD-3-Clause'],
  [/BSD.*2|2-Clause|Simplified BSD/i, 'BSD-2-Clause'],
  [/\bISC\b/i, 'ISC'],
  [/Python Software Foundation|\bPSF\b/i, 'PSF-2.0'],
  [/Mozilla Public License 2|\bMPL[- ]?2/i, 'MPL-2.0'],
  [/\bLGPL/i, 'LGPL'],
  [/\bAGPL/i, 'AGPL-3.0'],
  [/\bGPL.*3|GPLv3/i, 'GPL-3.0'],
  [/\bGPL.*2|GPLv2/i, 'GPL-2.0'],
];

/** A PyPI project's licence as an SPDX id: its licence expression, else its classifiers, else its text. */
export function pypiLicence(info) {
  if (info?.license_expression) return info.license_expression;
  const words = [
    ...(info?.classifiers ?? []).filter((c) => c.startsWith('License ::')),
    ...(info?.license && info.license.length <= 80 ? [info.license] : []),
  ];
  for (const w of words) for (const [re, id] of PYPI_LICENCES) if (re.test(w)) return id;
  return info?.license && info.license.length <= 40 ? info.license : 'unknown';
}

/**
 * #70: the same facts for a Python package, from PyPI: a release with no wheel builds from source as it
 * installs, which is what an npm install script that compiles is.
 */
export async function pypiFacts(pkg) {
  const name = encodeURIComponent(pkg.replace(/\[.*\]$/, '').toLowerCase());
  try {
    const meta = await fetch(`${PYPI()}/pypi/${name}/json`, {
      headers: { accept: 'application/json' },
    });
    if (meta.status === 404) return { error: `${pkg} isn't on PyPI` };
    if (!meta.ok) return { error: `PyPI answered ${meta.status} for ${pkg}` };
    const doc = await meta.json();
    const files = doc.urls ?? [];
    const stats = await fetch(`${PYPI_STATS()}/api/packages/${name}/recent`, {
      headers: { accept: 'application/json' },
    });
    const weeklyDownloads = stats.ok ? ((await stats.json()).data?.last_week ?? 0) : 0;
    const wheel = files.some((f) => f.packagetype === 'bdist_wheel');
    return {
      licence: pypiLicence(doc.info),
      weeklyDownloads,
      lastRelease:
        files
          .map((f) => f.upload_time_iso_8601)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      installScripts: files.length > 0 && !wheel,
      installScriptKind: files.length > 0 && !wheel ? 'build' : null,
    };
  } catch (e) {
    return { error: `couldn't reach PyPI (${e.message})` };
  }
}

/** Why `facts` falls outside `rule`, as sentences; empty when it's within it. */
export function dependencyRuleProblems(facts, rule, now = Date.now()) {
  if (facts.error) return [facts.error];
  const problems = [];
  if (!rule.licences.includes(facts.licence))
    problems.push(`its licence (${facts.licence}) isn't one of ${rule.licences.join(', ')}`);
  if (facts.weeklyDownloads < rule.minWeeklyDownloads)
    problems.push(
      `it had ${facts.weeklyDownloads} downloads last week, under ${rule.minWeeklyDownloads}`,
    );
  const months = facts.lastRelease
    ? (now - Date.parse(facts.lastRelease)) / (30.44 * 24 * 3600 * 1000)
    : Infinity;
  if (months > rule.maxMonthsSinceRelease)
    problems.push(
      `its last release was ${Number.isFinite(months) ? `${Math.floor(months)} months` : 'never'} ago, over ${rule.maxMonthsSinceRelease}`,
    );
  if (facts.installScripts) {
    const kind = facts.installScriptKind ?? 'other';
    const allowed =
      rule.allowInstallScripts === true ||
      (Array.isArray(rule.allowInstallScripts) && rule.allowInstallScripts.includes(kind));
    if (!allowed) problems.push(`installing it runs a script that ${KIND_WORDS[kind]}`);
  }
  return problems;
}
