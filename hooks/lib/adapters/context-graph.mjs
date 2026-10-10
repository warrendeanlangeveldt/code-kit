// Context Graph (ctx) keeps a project's engineering context in `.ctx/`: ratified rules and concepts in
// graph.ctx, settings in config.toml, the decisions agents record as they work in decisions.ctx, and
// each file's card (its why) in cards.ctx. Every agent records decisions and cards for the files it
// edits, so those two files are writable by any actor; the rules and settings
// are the lead's, and changes to them go through the approval log. Ratifying a rule is a person's act,
// signed with a commit trailer, so no Claude actor may write that trailer, unless the project lets the
// lead act on what the person says in chat (`approvals.lead`). A delegated ratification, signed
// `Ctx-Ratified-By: <ratifier> (delegated)`, is the lead's own act under the repository's [delegate]
// rules: only the lead may write that trailer, and Context Graph's gate checks the kinds it covers.
// Ratifying with `--commit`, dropping a proposal and changing the harness settings are the person's acts
// in ctx too, so no actor runs
// them; only a command the line runs counts, so a heredoc or quoted text that mentions one isn't refused.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** ctx's JSON for `args`, run in `root`, or null where ctx isn't installed or fails. */
function ctx(root, args) {
  try {
    return JSON.parse(
      execFileSync('ctx', [...args, '--json'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30000,
      }),
    );
  } catch {
    return null;
  }
}

const CTX = String.raw`(?:ctx|node\s+["']?[^\s"']*ctx\.mjs["']?|npx\s+(?:--yes\s+)?@warren-dean/context-graph(?:@\S+)?)`;
const PERSONS_ACT = String.raw`^${CTX}\s+(?:ratify\b[^;&|\n]*\s--commit\b|drop\b|settings\s+set\b)`;

/** A commit the person signed with their ratification trailer; agents may not write it. */
const PERSON_SIGNED = '^Ctx-Ratified-By:(?![^\\n]*\\(delegated\\))\\s*\\S';

export default {
  name: 'context-graph',
  detect: (root) => existsSync(join(root, '.ctx')),
  config: {
    lead: ['.ctx/**'],
    anyActor: ['.ctx/decisions.ctx', '.ctx/cards.ctx'],
    protected: [
      {
        glob: '.ctx/graph.ctx',
        approval: 'ctx',
        why: "Context Graph's rules and concepts",
        // A person's ratification (`ctx ratify --commit`, `ctx drop --commit`) is signed, not logged.
        signedBy: PERSON_SIGNED,
      },
      // Setting Context Graph up is ratified the same way: the person commits it from their terminal.
      {
        glob: '.ctx/config.toml',
        approval: 'ctx',
        why: "Context Graph's settings",
        signedBy: PERSON_SIGNED,
      },
    ],
  },
  shell: {
    block: [
      {
        pattern: 'Ctx-Ratified-By\\s*[:=](?![^\\n"\']*\\(delegated\\))',
        why: "Ratifying a Context Graph rule is a person's act: they add the Ctx-Ratified-By trailer themselves, with a `!` git command.",
        person: true,
      },
      {
        pattern: PERSONS_ACT,
        command: true,
        why: "Ratifying a Context Graph proposal with --commit, dropping one, and changing Context Graph's harness settings are the person's own acts: they run them themselves, with a `!` command, or from the Context Graph pane.",
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
  // What Context Graph knows of the lanes' work (the combined lane view, docs/specs/13-combined.md).
  facts: {
    /** Whether ctx's command line runs here. */
    available: (root) => ctx(root, ['agents', '--session', 'none']) !== null,
    /**
     * Per agent type in a session (null for the main session): the edits made without understanding,
     * each with the files still unread, and the cards owed.
     */
    lanes: (root, { session }) => {
      const agents = session ? (ctx(root, ['agents', '--session', session]) ?? []) : [];
      const byType = {};
      for (const a of Array.isArray(agents) ? agents : []) {
        const key = a.agentType ?? 'lead';
        const f = (byType[key] ??= { withoutUnderstanding: [], cardsOwed: [] });
        for (const e of a.edited ?? [])
          if (!e.understood) f.withoutUnderstanding.push({ path: e.path, unread: e.missing ?? [] });
        for (const c of a.cardsOwed ?? []) if (!f.cardsOwed.includes(c)) f.cardsOwed.push(c);
      }
      return byType;
    },
    /** Per file: the rules that apply to it, agreed and proposed, and its card: current, stale or missing, with its text. */
    files: (root, paths) =>
      Object.fromEntries(
        paths.map((path) => {
          const f = ctx(root, ['file', path]);
          return [
            path,
            {
              card: f?.card
                ? { state: f.card.fresh === false ? 'stale' : 'current', text: f.card.text ?? '' }
                : { state: 'missing', text: '' },
              rules: (f?.rules ?? []).map((r) => ({
                id: r.id,
                text: r.text,
                mode: r.mode,
                proposed: r.mode === 'G?',
              })),
            },
          ];
        }),
      ),
    /** The command that opens Context Graph's pane on a file, given its path. */
    open: { command: 'graph' },
  },
  setup: [
    '.gitignore: .ctx/archive/, .ctx/bench/, .ctx/models/ and .ctx/serve.json (ctx working files, never committed)',
    '.gitattributes: .ctx/decisions.ctx merge=union and .ctx/cards.ctx merge=union (lanes record decisions and cards on parallel branches; merging keeps them all)',
    "CLAUDE.md: keep the Context Graph block and code-kit's section side by side, each pointing to the other",
  ],
};
