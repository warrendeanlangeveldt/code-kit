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
import contextGraph from './context-graph.mjs';
import hub from './hub/index.mjs';

export const ADAPTERS = [contextGraph];
export const PROVIDERS = [hub];

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
  }
  merged.adapters = active.map((a) => a.name);
  return merged;
}
