// Adapters: what code-kit needs to know about another tool that shares the project, kept out of the core.
// Each adapter says how to detect its tool and what that tool contributes to the rules:
//
//   name      the tool, and the key that switches it off in the config: "adapters": { "<name>": false }
//   detect    (root) => true when the tool is in use in this project
//   config    { lead?, anyActor?, protected? } merged into the effective config, like the kit's defaults.
//             A protected entry may name `signedBy`, a pattern for a commit-message line that only a
//             person may write (the hooks block it for every actor); verify accepts a change whose
//             commits all carry it in place of an approval-log entry
//   shell     { block?, restricted? } block: commands refused for every Claude actor, merged into
//             shell.block (`person: true` marks a person's act the lead may do for them under
//             approvals.lead); restricted: commands only the lead and the listed lanes may run
//   setup     lines for init to apply or tell the person: ignore files, merge drivers, instructions
//   onboard   { skill, why }: the tool's own setup skill, which `next` runs before any coding when the
//             config wants the tool ("adapters": { "<name>": true }) but it isn't set up here yet
//   facts     what the tool knows of the lanes' work, for the mod's combined view: { available(root),
//             lanes(root, { session }) → { [agent type or 'lead']: { withoutUnderstanding, cardsOwed } },
//             files(root, paths) → { [path]: { rules } }, open: { command } (its view of a file) }
//
// The core only ever calls applyAdapters() and activeAdapters(); it never names a tool.
//
// Team provider adapters (HUBR-6) are the other kind: a hosted team provider's client, chosen when the
// config's `team.provider` names it, as `{ "<key>": "<its https address>" }`. Each says:
//
//   key       the provider's key in `team.provider`
//   label     what code-kit calls it, only when a config names it (HUBR-8)
//   command   (url) => the provider command code-kit runs for each operation (TEAM-2)
//   session   { start(root, session, watch, url), end(root, session) }: the session's live link
//   presence  (root, session, agents) => void: the session's agents, for the provider
//   run       (args, url) => exit code: the client's own commands (sign in, connect, status), for
//             `code-kit team provider …`
//
// The core only ever calls providerAdapterOf(); it never names a provider.
//
// Machine adapters (spec 32, CLOUD-2) are the third kind: a platform of cloud machines a project's work
// can run on, chosen when the config's `cloud` names it, as `{ "<key>": { its options } }`. Each says:
//
//   key       the platform's key in `cloud`
//   label     what code-kit calls it, and what its row in the cost register is found by (CLOUD-10)
//   options   the option names it takes
//   needs     () => [{ what, have, command, from, terminal? }]: what it needs on the computer, with the
//             command that installs it or signs in, and where that command comes from
//   ready     (name) => { ok, made, why }: the machine of that name, made if it wasn't there
//   run       (name, command, { cwd, timeoutSeconds, inherit }) => { status, timedOut, stdout, output }
//   put       (name, file, to) => { ok, why }: a file from the computer onto the machine, at a full path
//   terminal  (name, command, { cwd }) => exit code: the person's terminal joined to a command there
//   state     (name) => { reachable, exists, sessions: [{ id, command, started }], why }
//   release   (name) => { ok, why }: the machine removed
//
// and, where the platform gives a machine an address of its own, what the terminal in a browser needs
// (CLOUD-12). An adapter without `address` and `serve` has none:
//
//   address   (name) => { ok, url, open, gate, close, why }: the address, whether anyone who has it can
//             open it, who the platform lets in, and the command that makes an open one private
//   serve     (name, { command, args, dir, port }) => { ok, why }: that command kept running on the
//             machine, started again after a sleep, with the address routed to its port
//   unserve   (name) => { ok }: that taken away
//   install   (name, packages) => { ok }: packages the machine's image lacks, from the image's own source
//
// The core only ever calls machineAdapterOf(); it never names a platform.
import contextGraph from './context-graph.mjs';
import hub from './hub/index.mjs';
import sprites from './sprites.mjs';

export const ADAPTERS = [contextGraph];
export const PROVIDERS = [hub];
export const MACHINES = [sprites];

/** The settings `cloud` may hold beside its adapter's key. */
export const CLOUD_SETTINGS = ['prepare', 'carry', 'idleMinutes', 'terminal'];

/**
 * The machine adapter `cloud` names, with its options: { adapter, options }, or null when the config has
 * no `cloud`. `{ problem }` says what's wrong with it: no adapter, two, or options one doesn't take.
 */
export function machineAdapterOf(cloud) {
  if (cloud === undefined || cloud === null) return null;
  const keys = MACHINES.map((m) => m.key);
  const known = `(${keys.join(', ')})`;
  if (typeof cloud !== 'object' || Array.isArray(cloud))
    return {
      problem: `"cloud" must be an object naming one platform ${known}: { "<platform>": {} }`,
    };
  const named = Object.keys(cloud).filter((k) => !CLOUD_SETTINGS.includes(k));
  const found = named.filter((k) => keys.includes(k));
  const strangers = named.filter((k) => !keys.includes(k));
  if (strangers.length)
    return {
      problem: `"cloud.${strangers[0]}" isn't a platform code-kit knows ${known} or a cloud setting (${CLOUD_SETTINGS.join(', ')})`,
    };
  if (found.length !== 1)
    return {
      problem: found.length
        ? `"cloud" names ${found.length} platforms (${found.join(', ')}); a project's work runs on one`
        : `"cloud" must name one platform ${known}: { "<platform>": {} }`,
    };
  const adapter = MACHINES.find((m) => m.key === found[0]);
  const options = cloud[adapter.key];
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    return { problem: `"cloud.${adapter.key}" must be an object of its options; {} for none` };
  const extra = Object.keys(options).filter((k) => !adapter.options.includes(k));
  if (extra.length)
    return {
      problem: `"cloud.${adapter.key}.${extra[0]}" isn't an option ${adapter.label} takes${adapter.options.length ? ` (${adapter.options.join(', ')})` : '; it takes none, and the account is the one you are signed in to'}`,
    };
  return { adapter, options };
}

const isAddress = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v);

/**
 * The team provider adapter `team.provider` names, with its address: { adapter, url }, or null when the
 * provider isn't an adapter's (GitHub, or a command). `{ problem }` when it names one wrongly.
 */
export function providerAdapterOf(provider) {
  if (provider === null || typeof provider !== 'object' || Array.isArray(provider)) return null;
  const adapter = PROVIDERS.find((p) => p.key in provider);
  if (!adapter) return null;
  const extra = Object.keys(provider).filter((k) => k !== adapter.key && k !== 'fallback');
  if (
    !isAddress(provider[adapter.key]) ||
    extra.length ||
    ![undefined, 'github'].includes(provider.fallback)
  )
    return { problem: true };
  return { adapter, url: provider[adapter.key].replace(/\/$/, '') };
}

/** Adapters detected in `root` and not switched off by the config's `adapters` map. */
export function activeAdapters(raw, root) {
  return ADAPTERS.filter((a) => raw.adapters?.[a.name] !== false && a.detect(root));
}

/**
 * What the active adapters that know of the lanes' work report (JOIN-1): [{ name, lanes?, files?, open }],
 * only those whose tool is available here. `paths` asks for those files' facts too.
 */
export function adapterFacts(raw, root, { session = null, paths = null } = {}) {
  return activeAdapters(raw, root)
    .filter((a) => a.facts && a.facts.available(root))
    .map((a) => ({
      name: a.name,
      ...(a.facts.lanes ? { lanes: a.facts.lanes(root, { session }) } : {}),
      ...(paths && a.facts.files ? { files: a.facts.files(root, paths) } : {}),
      open: a.facts.open ?? null,
    }));
}

/**
 * ONB-3: tools the config wants (`"adapters": { "<name>": true }`) that aren't set up in `root` yet,
 * with each one's setup skill: [{ name, skill, why }].
 */
export function pendingSetup(raw, root) {
  return ADAPTERS.filter(
    (a) => raw?.adapters?.[a.name] === true && a.onboard && !a.detect(root),
  ).map((a) => ({ name: a.name, ...a.onboard }));
}

/** The effective config with every active adapter's contributions merged in. */
export function applyAdapters(config, raw, root) {
  const active = activeAdapters(raw, root);
  if (!active.length) return { ...config, adapters: [] };
  const merged = structuredClone(config);
  for (const a of active) {
    const c = a.config ?? {};
    merged.lead.paths.push(...(c.lead ?? []));
    merged.anyActor.push(...(c.anyActor ?? []));
    merged.protected.push(...(c.protected ?? []));
    merged.shell.block.push(...(a.shell?.block ?? []));
    merged.shell.restricted.push(...(a.shell?.restricted ?? []));
    (merged.shell.records ??= []).push(...(a.shell?.records ?? []));
  }
  merged.adapters = active.map((a) => a.name);
  return merged;
}
