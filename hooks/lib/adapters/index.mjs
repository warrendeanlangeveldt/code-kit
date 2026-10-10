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
//   facts     what the tool knows of the lanes' work, for the mod's combined view: { available(root),
//             lanes(root, { session }) → { [agent type or 'lead']: { withoutUnderstanding, cardsOwed } },
//             files(root, paths) → { [path]: { rules } }, open: { command } (its view of a file) }
//
// The core only ever calls applyAdapters() and activeAdapters(); it never names a tool.
import contextGraph from './context-graph.mjs';

export const ADAPTERS = [contextGraph];

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
