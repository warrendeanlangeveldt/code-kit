// Context Graph (ctx) keeps a project's engineering context in `.ctx/`: ratified rules and concepts in
// graph.ctx, settings in config.toml, and the decisions agents record as they work in decisions.ctx.
// Every agent is asked to record decisions, so that file is writable by any actor; the rules and settings
// are the lead's, and changes to them go through the approval log. Ratifying a rule is a person's act,
// signed with a commit trailer, so no Claude actor may write that trailer.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default {
  name: 'context-graph',
  detect: (root) => existsSync(join(root, '.ctx')),
  config: {
    lead: ['.ctx/**'],
    anyActor: ['.ctx/decisions.ctx'],
    protected: [
      { glob: '.ctx/graph.ctx', approval: 'ctx', why: "Context Graph's rules and concepts" },
      { glob: '.ctx/config.toml', approval: 'ctx', why: "Context Graph's settings" },
    ],
  },
  shell: {
    block: [
      {
        pattern: 'Ctx-Ratified-By\\s*[:=]',
        why: "Ratifying a Context Graph rule is a person's act: they add the Ctx-Ratified-By trailer themselves, with a `!` git command.",
      },
    ],
  },
  setup: [
    '.gitignore: .ctx/archive/, .ctx/bench/, .ctx/models/ and .ctx/serve.json (ctx working files, never committed)',
    '.gitattributes: .ctx/decisions.ctx merge=union (lanes record decisions on parallel branches; merging keeps them all)',
    "CLAUDE.md: keep the Context Graph block and code-kit's section side by side, each pointing to the other",
  ],
};
