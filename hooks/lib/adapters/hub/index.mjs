// code-kit hub as a team provider adapter (code-kit spec 21, HUBR-6): chosen by
// `"team": { "provider": { "hub": "<https address>" } }`, with GitHub as its fallback. Its client
// (client.mjs) is code-kit's provider command, the session's live link (the event stream and the team's
// state on disk) and the person's sign-in. In preview (HUBR-8): nothing outside this folder names it,
// and code-kit only says its name for a project whose config does.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPresence, startDaemon, stopDaemon } from './client.mjs';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), 'client.mjs');
const quoted = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export default {
  key: 'hub',
  label: 'code-kit hub',
  command: (url) => `node ${quoted(CLIENT)} --url ${quoted(url)}`,
  session: {
    start: (root, session, watch, url) => startDaemon(root, session, watch, url),
    end: (root, session) => stopDaemon(root, session),
  },
  presence: (root, session, agents) => recordPresence(root, session, agents),
  run: (args, url) =>
    spawnSync(process.execPath, [CLIENT, '--url', url, ...args], { stdio: 'inherit' }).status ?? 1,
};
