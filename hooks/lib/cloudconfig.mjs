// The config's `cloud` section (spec 32, CLOUD-1): the platform whose machine the project's work may run
// on, named by its adapter's key, with what a new machine needs. Kept apart from cloud.mjs so the config's
// validation doesn't load everything a machine's commands read.
import { isAbsolute } from 'node:path';
import { machineAdapterOf } from './adapters/index.mjs';

/** How long nothing may move before the lead's session is ended and the machine sleeps (CLOUD-7). */
export const DEFAULT_IDLE_MINUTES = 30;
export const LEAST_IDLE_MINUTES = 5;

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/** Whether a `carry` entry is a path inside the project: relative, with no step out of it. */
export const insideProject = (p) =>
  isStr(p) && !isAbsolute(p) && !p.split(/[\\/]/).includes('..') && !/^~/.test(p);

/** What's wrong with the config's `cloud`, as sentences; none when it's absent or right. */
export function cloudProblems(c) {
  const cloud = c?.cloud;
  if (cloud === undefined) return [];
  const named = machineAdapterOf(cloud);
  if (named?.problem) return [named.problem];
  const p = [];
  if (cloud.prepare !== undefined && !isStr(cloud.prepare))
    p.push(
      '"cloud.prepare" must be a command: what a new machine needs that its image lacks, such as "npx playwright install --with-deps chromium"',
    );
  if (cloud.carry !== undefined && !(Array.isArray(cloud.carry) && cloud.carry.every(isStr)))
    p.push(
      '"cloud.carry" must be a list of paths: files git ignores that the project can\'t run without, such as ".env.local"',
    );
  else
    for (const f of cloud.carry ?? [])
      if (!insideProject(f))
        p.push(
          `"cloud.carry" holds ${JSON.stringify(f)}, which leaves the project's folder. It carries files inside the project only, by their path from its top.`,
        );
  if (
    cloud.idleMinutes !== undefined &&
    !(Number.isInteger(cloud.idleMinutes) && cloud.idleMinutes >= LEAST_IDLE_MINUTES)
  )
    p.push(
      `"cloud.idleMinutes" must be a whole number of ${LEAST_IDLE_MINUTES} or more: the minutes with nothing moving before the lead's session there is ended so the machine sleeps (${DEFAULT_IDLE_MINUTES} unless set)`,
    );
  return p;
}

/**
 * The project's cloud settings in force: { adapter, options, prepare, carry, idleMinutes }, or null when
 * the config names no platform (or names one wrongly, which `check` reports).
 */
export function cloudOf(config) {
  const named = machineAdapterOf(config?.cloud);
  if (!named || named.problem) return null;
  const cloud = config.cloud;
  return {
    adapter: named.adapter,
    options: named.options,
    prepare: isStr(cloud.prepare) ? cloud.prepare : null,
    carry: Array.isArray(cloud.carry) ? cloud.carry.filter(insideProject) : [],
    idleMinutes:
      Number.isInteger(cloud.idleMinutes) && cloud.idleMinutes >= LEAST_IDLE_MINUTES
        ? cloud.idleMinutes
        : DEFAULT_IDLE_MINUTES,
  };
}

/** CLOUD-10: the cost register's problem when a project with a budget has a machine and no row for it. */
export function cloudCostProblem(config, rows, file) {
  const cloud = cloudOf(config);
  if (!cloud || !config?.cost) return null;
  const label = cloud.adapter.label.toLowerCase();
  const named = (rows ?? []).some((r) =>
    [r.item, r.provider].some((v) =>
      String(v ?? '')
        .toLowerCase()
        .includes(label),
    ),
  );
  return named
    ? null
    : `The project's work can run on a cloud machine (${cloud.adapter.label}), which is paid for, and ${file} has no row for it. Add one with ${cloud.adapter.label} as its Provider: the monthly estimate from the platform's published prices and the awake hours \`code-kit cloud\` reports, with which you used as its Basis.`;
}
