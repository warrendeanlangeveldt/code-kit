// Spec 29: what a project costs to run each month. The person sets a budget per environment in the
// config (`cost`); the lead keeps a register of estimated costs (docs/costs.md, a table with a row per
// paid thing); code-kit adds the register up against the budget. It knows no provider's prices: every
// figure is the lead's estimate, with where it came from.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from './glob.mjs';

export const COST_APPROVAL = 'cost';
export const DEFAULT_REGISTER = 'docs/costs.md';
// A price older than this is rechecked (COST-7).
export const STALE_DAYS = 90;

/**
 * Infrastructure files, whatever tool defines them, for init's draft of `cost.paths` and for `next`
 * to notice a project with infrastructure and no budget (COST-1, COST-6).
 */
export const INFRA_GLOBS = [
  '**/*.tf',
  '**/*.tfvars',
  '**/cdk.json',
  '**/Pulumi*.yaml',
  '**/serverless.yml',
  '**/serverless.yaml',
  '**/sst.config.ts',
  '**/docker-compose*.yml',
  '**/docker-compose*.yaml',
  '**/compose.yml',
  '**/compose.yaml',
  '**/fly.toml',
  '**/vercel.json',
  '**/netlify.toml',
  '**/render.yaml',
  '**/wrangler.toml',
  '**/app.yaml',
  '**/supabase/config.toml',
  '**/k8s/**',
  '**/kubernetes/**',
  '**/helm/**',
  'infra/**',
  'infrastructure/**',
  'terraform/**',
];

/** Where the project keeps its cost register. */
export const registerFile = (config) => config?.docs?.costs ?? DEFAULT_REGISTER;

const cells = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

/** A Monthly cell as a number (`25`, `7.80`, `$1,200`, `€30`), or null when it isn't one. */
export function amountOf(text) {
  const m = String(text ?? '')
    .trim()
    .match(/^[$€£¥]?\s*(\d[\d,]*(?:\.\d+)?)$/);
  return m ? Number(m[1].replaceAll(',', '')) : null;
}

/**
 * The register's rows: { line, item, provider, environment, size, monthly, amount, basis }, `amount`
 * null where Monthly isn't a number. `table` is false when the text has no table whose header starts
 * `| Item |` with a Monthly column.
 */
export function parseRegister(text) {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => /^\|\s*Item\s*\|/i.test(l));
  if (at < 0) return { table: false, rows: [] };
  const columns = cells(lines[at]).map((c) => c.toLowerCase());
  const col = (name) => columns.findIndex((c) => c.startsWith(name));
  if (col('monthly') < 0) return { table: false, rows: [] };
  const rows = [];
  for (let i = at + 1; i < lines.length && /^\|/.test(lines[i]); i++) {
    if (/^\|\s*:?-/.test(lines[i])) continue;
    const c = cells(lines[i]);
    const get = (name) => (col(name) >= 0 ? (c[col(name)] ?? '') : '');
    if (!get('item')) continue;
    rows.push({
      line: i + 1,
      item: get('item'),
      provider: get('provider'),
      environment: get('env').toLowerCase(),
      size: get('size'),
      monthly: get('monthly'),
      amount: amountOf(get('monthly')),
      basis: get('basis'),
    });
  }
  return { table: true, rows };
}

/** Each environment the budget names: { name, total, budget, over }, `all` rows counting in every one. */
export function totals(rows, cost) {
  return Object.entries(cost?.monthly ?? {}).map(([name, budget]) => {
    const total = rows
      .filter((r) => r.amount !== null && (r.environment === name || r.environment === 'all'))
      .reduce((sum, r) => sum + r.amount, 0);
    const rounded = Math.round(total * 100) / 100;
    return { name, total: rounded, budget, over: Math.round((rounded - budget) * 100) / 100 };
  });
}

/** The money in the budget's currency, as people write it: `130`, `32.80`. */
export const money = (n, currency) =>
  `${Number.isInteger(n) ? n : n.toFixed(2)}${currency ? ` ${currency}` : ''}`;

/** The newest date (YYYY-MM-DD) a Basis names, or null. */
function basisDate(basis) {
  const dates = String(basis).match(/\d{4}-\d{2}-\d{2}/g);
  const t = dates ? Math.max(...dates.map((d) => Date.parse(d))) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * The register against the budget (COST-3, COST-7): { file, exists, environments, rows, problems, stale }.
 * `problems` are what's wrong (an unreadable row, one without its basis or for an environment the budget
 * doesn't name, no table, a total over its budget); `stale`, the rows whose price is more than 90 days
 * old, to recheck.
 */
export function costReport(root, config, now = Date.now()) {
  const file = registerFile(config);
  const exists = existsSync(join(root, file));
  return {
    file,
    exists,
    ...readCosts(exists ? readFileSync(join(root, file), 'utf8') : null, config, now),
  };
}

/** costReport's reading of a register's text (null when there's none). */
export function readCosts(text, config, now = Date.now()) {
  const cost = config?.cost;
  const file = registerFile(config);
  const { table, rows } = parseRegister(text ?? '');
  const environments = totals(rows, cost);
  const names = new Set([...environments.map((e) => e.name), 'all']);
  const problems = [];
  const stale = [];
  if (text !== null && !table)
    problems.push(
      `${file} has no cost table: a table whose header row starts \`| Item |\`, with Provider, Environment, Size, Monthly and Basis columns.`,
    );
  for (const r of rows) {
    const where = `${file}:${r.line} (${r.item})`;
    if (r.amount === null)
      problems.push(
        `${where}: Monthly is "${r.monthly}", not a number. Write the estimate as a number in ${cost?.currency ?? "the budget's currency"}, such as 25 or 7.80.`,
      );
    if (!r.basis)
      problems.push(
        `${where} has no Basis: say where the price came from (the provider's pricing page and the date you read it).`,
      );
    if (!names.has(r.environment))
      problems.push(
        `${where} is for "${r.environment || '(none)'}", which the budget doesn't name. Environments: ${[...names].join(', ')}.`,
      );
    const dated = r.basis ? basisDate(r.basis) : null;
    if (r.basis && (dated === null || now - dated > STALE_DAYS * 86_400_000))
      stale.push(
        `${where}: ${dated === null ? 'its Basis has no date' : `its price was read ${Math.floor((now - dated) / 86_400_000)} days ago`}; recheck it and date the Basis (YYYY-MM-DD).`,
      );
  }
  for (const e of environments)
    if (e.over > 0)
      problems.push(
        `${e.name} is estimated at ${money(e.total, cost.currency)} a month, ${money(e.over, cost.currency)} over its budget of ${money(e.budget, cost.currency)}.`,
      );
  return { environments, rows, problems, stale };
}

/**
 * COST-5: the environments a change to the register takes over budget, or further over it:
 * [{ name, before, after, budget }]. A change that leaves every total within budget, or lowers one
 * that was already over, needs nothing.
 */
export function overBudget(beforeText, afterText, cost) {
  const before = new Map(
    totals(parseRegister(beforeText ?? '').rows, cost).map((e) => [e.name, e.total]),
  );
  return totals(parseRegister(afterText ?? '').rows, cost)
    .filter((e) => e.over > 0 && e.total > (before.get(e.name) ?? 0))
    .map((e) => ({
      name: e.name,
      before: before.get(e.name) ?? 0,
      after: e.total,
      budget: e.budget,
    }));
}

/** The words for overBudget's environments: "prod would be 130 of 100, 30 over". */
export const overWords = (over, currency) =>
  over
    .map(
      (e) =>
        `${e.name} would be ${money(e.after, currency)} a month against its budget of ${money(e.budget, currency)}, ${money(Math.round((e.after - e.budget) * 100) / 100, currency)} over (it was ${money(e.before, currency)})`,
    )
    .join('; ');

/** The project's tracked files that look like infrastructure (`globs`, INFRA_GLOBS by default). */
export function infraFiles(root, globs = INFRA_GLOBS) {
  let files = [];
  try {
    files = execFileSync('git', ['-C', root, 'ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
  return files.filter((f) => matchesAny(f, globs));
}
