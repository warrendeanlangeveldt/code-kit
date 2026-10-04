// Context Graph (ctx) keeps a project's engineering context in `.ctx/`: ratified rules and concepts in
// graph.ctx, settings in config.toml, the decisions agents record as they work in decisions.ctx, and
// each file's card (its why) in cards.ctx. Every agent records decisions and cards for the files it
// edits, so those two files are writable by any actor; the rules and settings
// are the lead's, and changes to them go through the approval log. Ratifying a rule is a person's act,
// signed with a commit trailer, so no Claude actor may write that trailer, unless the project lets the
// lead act on what the person says in chat (`approvals.lead`). A delegated ratification, signed
// `Ctx-Ratified-By: <ratifier> (delegated)`, is the lead's own act under the repository's [delegate]
// rules: only the lead may write that trailer, and Context Graph's gate checks the kinds it covers.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default {
  name: 'context-graph',
  detect: (root) => existsSync(join(root, '.ctx')),
  config: {
    lead: ['.ctx/**'],
    anyActor: ['.ctx/decisions.ctx', '.ctx/cards.ctx'],
    protected: [
      { glob: '.ctx/graph.ctx', approval: 'ctx', why: "Context Graph's rules and concepts" },
      { glob: '.ctx/config.toml', approval: 'ctx', why: "Context Graph's settings" },
    ],
  },
  shell: {
    block: [
      {
        pattern: 'Ctx-Ratified-By\\s*[:=](?![^\\n"\']*\\(delegated\\))',
        why: "Ratifying a Context Graph rule is a person's act: they add the Ctx-Ratified-By trailer themselves, with a `!` git command.",
        person: true,
      },
    ],
    restricted: [
      {
        pattern: 'Ctx-Ratified-By\\s*[:=][^\\n"\']*\\(delegated\\)',
        lanes: [],
        why: "Only the lead ratifies under Context Graph's [delegate] rules. Write a change request for the lead, and stop.",
      },
    ],
  },
  setup: [
    '.gitignore: .ctx/archive/, .ctx/bench/, .ctx/models/ and .ctx/serve.json (ctx working files, never committed)',
    '.gitattributes: .ctx/decisions.ctx merge=union and .ctx/cards.ctx merge=union (lanes record decisions and cards on parallel branches; merging keeps them all)',
    "CLAUDE.md: keep the Context Graph block and code-kit's section side by side, each pointing to the other",
  ],
};
