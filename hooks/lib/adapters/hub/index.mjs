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

// On a cloud machine the hub asked for (spec 32, CLOUD-16): the hub's companion, which the machine's
// owner installs from the hub and pairs by a code they confirm there. It reports the machine and takes
// the hub's commands; code-kit starts its commands and reads nothing of its credential. npm puts a global
// install's commands in its own folder, which a machine's PATH may not hold, so the command is found there.
const COMPANION = 'code-kit-companion';
const plain = (v) => typeof v === 'string' && v.length > 0 && !/[\0-\x1f\x7f]/.test(v);
const installed = (sh) => {
  const prefix = sh('npm prefix -g 2>/dev/null').stdout.trim();
  return plain(prefix) && prefix.startsWith('/') ? `${prefix}/bin/${COMPANION}` : null;
};
const machine = {
  offer: (url) =>
    `Paired, the hub shows this machine on the project's Cloud page, and starts and stops work here when you ask it to. Pairing installs the hub's companion from ${url} and shows a code, which you confirm on the hub as the person who created the machine. The companion tells the hub what the machine says of itself and takes its commands. Your sign-ins stay on the machine.`,
  pair({ url, name, workspace, remote, typed, sh }) {
    if (typed('npm', ['install', '-g', `${url}/companion/${COMPANION}.tgz`]) !== 0) return false;
    const command = installed(sh);
    if (!command) return false;
    const repository = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    return (
      typed(command, [
        ...['setup', '--hub', url, '--workspace', workspace, '--name', name],
        ...(repository ? ['--machine', repository] : []),
      ]) === 0
    );
  },
  session(sh) {
    const command = installed(sh);
    const said = command ? sh(`${quoted(command)} session-env 2>/dev/null`) : null;
    if (said?.status !== 0) return null;
    try {
      const { env, args } = JSON.parse(said.stdout);
      const pairs = Object.entries(env);
      return pairs.every(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && plain(v)) &&
        Array.isArray(args) &&
        args.every(plain)
        ? { env, args }
        : null;
    } catch {
      return null;
    }
  },
  service(sh) {
    const command = installed(sh);
    return command ? { command, args: ['run'] } : null;
  },
};

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
  machine,
};
