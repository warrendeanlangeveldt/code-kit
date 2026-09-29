// Adapters: what code-kit needs to know about another tool that shares the project, kept out of the core.
// Each adapter says how to detect its tool and what that tool contributes to the rules:
//
//   name      the tool, and the key that switches it off in the config: "adapters": { "<name>": false }
//   detect    (root) => true when the tool is in use in this project
//   config    { lead?, anyActor?, protected? } merged into the effective config, like the kit's defaults
//   shell     { block? } commands refused for every Claude actor, merged into shell.block
//   setup     lines for init to apply or tell the person: ignore files, merge drivers, instructions
//
// The core only ever calls applyAdapters() and activeAdapters(); it never names a tool.
import contextGraph from './context-graph.mjs';

export const ADAPTERS = [contextGraph];

/** Adapters detected in `root` and not switched off by the config's `adapters` map. */
export function activeAdapters(raw, root) {
  return ADAPTERS.filter((a) => raw.adapters?.[a.name] !== false && a.detect(root));
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
  }
  merged.adapters = active.map((a) => a.name);
  return merged;
}
