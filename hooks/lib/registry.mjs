// What the npm registry says about a package, for the lead's delegated dependency approvals: the
// licence, how often it's downloaded, when it was last released, and whether installing it runs
// scripts. The rule itself is a pure function, so it's tested without the network.
import { DEPENDENCY_APPROVAL } from './dependencies.mjs';

const REGISTRY = () => process.env.CODE_KIT_NPM_REGISTRY ?? 'https://registry.npmjs.org';
const DOWNLOADS = () => process.env.CODE_KIT_NPM_DOWNLOADS ?? 'https://api.npmjs.org';

/** The package an approval name stands for: `dep-@scope+pkg` → `@scope/pkg`. */
export const packageOf = (approvalName) =>
  approvalName.slice(DEPENDENCY_APPROVAL.length).replace(/\+/g, '/');

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/** { licence, weeklyDownloads, lastRelease (ISO), installScripts } for `pkg`, or { error }. */
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
    };
  } catch (e) {
    return { error: `couldn't reach the npm registry (${e.message})` };
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
  if (facts.installScripts && !rule.allowInstallScripts)
    problems.push('installing it runs scripts');
  return problems;
}
