// A project on a cloud machine (spec 32): the lead's session, its lane agents, their worktrees, the checks
// and the merge queue all run on one machine the person owns, and the person's computer only connects.
// This file is both sides of it. On the computer: what `cloud up` does to make a machine ready (CLOUD-3),
// opening, stopping and removing it (CLOUD-4, CLOUD-7, CLOUD-9), and the marker that keeps the project in
// one place at a time (CLOUD-6). On the machine: what it reports of itself (CLOUD-8), and the watcher
// that ends an idle session so the machine sleeps (CLOUD-7). The platform is an adapter's (CLOUD-2);
// nothing here names one.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, freemem, loadavg, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudOf } from './cloudconfig.mjs';
import { openDecisions } from './decisionstore.mjs';
import { laneClaims } from './laneclaims.mjs';
import { mainCheckout } from './lanetrees.mjs';
import { readQueue, waiting } from './queue.mjs';
import { storyOfBranch } from './teamfacts.mjs';

/** Where the project's work is: on the computer, the machine it's up on; on the machine, `here`. */
export const CLOUD_FILE = '.claude/state/cloud.json';
const CLOUD_DIR = '.claude/state/cloud';
const ACTS_DIR = `${CLOUD_DIR}/acts`;
const LAST_FILE = `${CLOUD_DIR}/last`;
const ENDED_FILE = `${CLOUD_DIR}/ended.json`;
const AWAKE_FILE = `${CLOUD_DIR}/awake.json`;
const PREPARED_FILE = `${CLOUD_DIR}/prepared`;
const CARRIED_DIR = `${CLOUD_DIR}/carried`;
/** On the computer: the machine's report as `cloud` last read it. */
const STATUS_FILE = '.claude/state/cloud-status.json';
/** The terminal sessions code-kit keeps on a machine: the lead's, and the watcher's. */
export const LEAD_SESSION = 'code-kit-lead';
export const WATCH_SESSION = 'code-kit-watch';
/** A tool call left open by an agent that died stops counting as work after this long. */
const ACT_STALE_MS = 12 * 3600_000;
/** How often the watcher looks. */
export const WATCH_SECONDS = 60;
/** CLOUD-8: a Claude sign-in that ends within this many days is named. */
export const SIGN_IN_DAYS = 3;

/** A refusal: what stopped, and what to do, for the command to print as it exits. */
export class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const quoted = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// code-kit itself, as Claude Code's plugin list names it, for the machine to install and to be found by.
const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const pluginFile = readJson(join(PLUGIN_ROOT, '.claude-plugin/plugin.json')) ?? {};
const marketFile = readJson(join(PLUGIN_ROOT, '.claude-plugin/marketplace.json')) ?? {};
export const PLUGIN = {
  version: pluginFile.version ?? null,
  market: marketFile.name ?? pluginFile.name,
  id: `${pluginFile.name}@${marketFile.name ?? pluginFile.name}`,
  repository: pluginFile.repository ?? null,
};

// ---------------------------------------------------------------------------------------------------
// Both sides: the marker

const mainOf = (root) => mainCheckout(root) ?? root;
export const readMarker = (root) => readJson(join(mainOf(root), CLOUD_FILE));
const writeMarker = (root, marker) => writeJson(join(mainOf(root), CLOUD_FILE), marker);
const clearMarker = (root) => {
  rmSync(join(mainOf(root), CLOUD_FILE), { force: true });
  rmSync(join(mainOf(root), STATUS_FILE), { force: true });
};

/** CLOUD-6: the machine this project's work is on, when that isn't this checkout; else null. */
export function elsewhere(root) {
  const marker = readMarker(root);
  return marker && !marker.here && marker.machine ? marker : null;
}
/** Whether this checkout is the project's clone on its machine. */
export const isMachine = (root) => readMarker(root)?.here === true;

/** CLOUD-6: what a session, `next` and a refused lane agent are told while the project is up. */
export const elsewhereWords = (marker) =>
  `This project's work runs on its cloud machine (${marker.machine}, since ${String(marker.since).slice(0, 10)}), so nothing is dispatched from this computer: two leads would start the same stories. Open the lead's session there with \`code-kit cloud open\`, or bring the project home with \`code-kit cloud down\`.`;

// ---------------------------------------------------------------------------------------------------
// The computer's side

/** A git remote's address as a machine with an https credential can use it. */
export function httpsRemote(url) {
  const scp = String(url).match(/^(?:[\w.-]+@)?([\w.-]+\.[a-z]{2,}):(?!\/)(.+)$/i);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = String(url).match(/^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return String(url);
}
/** The host a remote's address is on, or null for a path on this disk. */
export const hostOf = (url) => httpsRemote(url).match(/^https?:\/\/([^/:]+)/i)?.[1] ?? null;

/** The address the project's remote is set to, as the config has it: no rewrite of this computer's applied. */
const remoteOf = (main) => git(main, 'config', '--get', 'remote.origin.url');

/** The project's folder name, as a machine's folder and name can hold it. */
const folderOf = (root) =>
  basename(mainOf(root))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'project';

/**
 * CLOUD-11: the project's machine, named from its folder and a hash of its remote's address, so a second
 * computer with the same clone finds the same one.
 */
export function machineName(root, remote = remoteOf(mainOf(root))) {
  const address = httpsRemote(remote ?? mainOf(root))
    .replace(/\.git$/, '')
    .toLowerCase();
  const hash = createHash('sha256').update(address).digest('hex').slice(0, 8);
  const slug = folderOf(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `ck-${slug || 'project'}-${hash}`;
}

/** The project's clone on its machine, as the machine's shell says it. */
export const cloneOf = (root) => `$HOME/projects/${folderOf(root)}`;

/**
 * The local branches with commits no remote branch holds: [{ branch, commits }]. What the remote lacks
 * is walked once and each branch counted from that, since asking git branch by branch takes minutes in
 * a project with over a thousand of them.
 */
function unpushed(root) {
  const walk = spawnSync(
    'git',
    ['-C', root, 'rev-list', '--parents', '--branches', '--not', '--remotes=origin'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  if (walk.status !== 0) return [];
  const parents = new Map();
  for (const line of walk.stdout.split('\n')) {
    if (!line) continue;
    const [commit, ...of] = line.split(' ');
    parents.set(commit, of);
  }
  if (!parents.size) return [];
  const reached = (tip) => {
    const seen = new Set();
    const todo = [tip];
    while (todo.length) {
      const commit = todo.pop();
      if (seen.has(commit) || !parents.has(commit)) continue;
      seen.add(commit);
      todo.push(...parents.get(commit));
    }
    return seen.size;
  };
  return (git(root, 'for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads') ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      tip: line.slice(0, line.indexOf(' ')),
      branch: line.slice(line.indexOf(' ') + 1),
    }))
    .filter((b) => parents.has(b.tip))
    .map((b) => ({ branch: b.branch, commits: reached(b.tip) }));
}

/**
 * CLOUD-3: what a move would leave behind on the computer, each as a sentence with what to do. The
 * machine starts from the remote, and `.claude/state` doesn't travel.
 */
export function leftBehind(root, config) {
  const main = mainOf(root);
  const base = config.branches.protected[0];
  const found = [];
  for (const c of laneClaims(main).filter((c) => !c.stale))
    found.push(
      `${c.story ?? 'A story'} is running in the ${c.lane} lane here. Let it finish and merge, or once its agent has stopped free the lane: code-kit lanes release ${c.lane}`,
    );
  for (const e of waiting(readQueue(main)))
    found.push(
      `${e.branch} waits in the merge queue here. Merge it (code-kit queue merge), or drop it: code-kit queue drop ${e.branch}`,
    );
  const decisions = openDecisions(main);
  if (decisions.length)
    found.push(
      `${plural(decisions.length, 'decision waits', 'decisions wait')} on you here (code-kit decisions). Answer ${decisions.length === 1 ? 'it' : 'them'} first: a question asked here isn't asked again on the machine.`,
    );
  for (const b of unpushed(main)) {
    if (b.branch === base)
      found.push(
        `${base} has ${plural(b.commits, 'commit')} that ${b.commits === 1 ? "isn't" : "aren't"} on the remote. Publish ${b.commits === 1 ? 'it' : 'them'} first: code-kit publish`,
      );
    else if (storyOfBranch(b.branch))
      found.push(
        `${b.branch} has ${plural(b.commits, 'commit')} that ${b.commits === 1 ? "isn't" : "aren't"} on the remote. Push it (git push -u origin ${b.branch}), or delete it if it's done with.`,
      );
  }
  return found;
}

const isFolder = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * CLOUD-1: what's wrong with the `carry` entries git tracks, or tracks part of, which travel with the
 * clone already; null when it tracks none.
 */
export function carryProblem(root, carry) {
  const main = mainOf(root);
  const tracked = carry.filter((f) => git(main, 'ls-files', '--error-unmatch', '--', f) !== null);
  if (!tracked.length) return null;
  const folders = tracked.filter((f) => isFolder(join(main, f)));
  const one = tracked.length === 1;
  return `"cloud.carry" is for what git ignores, and git tracks ${tracked.map((f) => (folders.includes(f) ? `files in ${f}` : f)).join(', ')}, which ${one && !folders.length ? 'travels' : 'travel'} with the clone already. Take ${one ? 'it' : 'them'} out of "cloud.carry"${folders.length ? ', and name the ignored files and folders inside a folder git tracks part of' : ''}.`;
}

/** A folder's files: how many, their bytes, and a stamp that changes when one is added, removed or written. */
function folderListing(dir) {
  const hash = createHash('sha256');
  let files = 0;
  let bytes = 0;
  const walk = (at, rel) => {
    const entries = readdirSync(at, { withFileTypes: true });
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) walk(join(at, e.name), `${rel}${e.name}/`);
      else if (e.isFile()) {
        const s = statSync(join(at, e.name));
        files++;
        bytes += s.size;
        hash.update(`${rel}${e.name}\0${s.size}\0${Math.floor(s.mtimeMs)}\n`);
      }
    }
  };
  walk(dir, '');
  return { files, bytes, stamp: hash.digest('hex') };
}
const sizeWords = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${Math.round(bytes / 1024 ** 2)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * CLOUD-3: a folder git ignores, copied into the clone as one archive, and again only when a file in it
 * was added, removed or written since. What the machine has there that this computer doesn't stays.
 * `{ ok, line }`: whether it's there now, and the line to say.
 */
function carryFolder({ adapter, name, run, main, clone, folder }) {
  const { files, bytes, stamp } = folderListing(join(main, folder));
  const mark = `${clone}/${CARRIED_DIR}/${createHash('sha256').update(folder).digest('hex').slice(0, 16)}`;
  if (run(`cat "${mark}" 2>/dev/null`).stdout.trim() === stamp)
    return { ok: true, line: `${folder} is there as it is here.` };
  const held = mkdtempSync(join(tmpdir(), 'code-kit-carry-'));
  try {
    const archive = join(held, 'carry.tgz');
    // A Mac's tar otherwise writes each file's extended attributes as a second file beside it.
    const packed = spawnSync('tar', ['--no-xattrs', '-czf', archive, '-C', main, folder], {
      encoding: 'utf8',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    if (packed.status !== 0)
      return {
        ok: false,
        line: `${folder} couldn't be packed to copy: ${`${packed.stderr ?? ''}`.trim().split('\n')[0] || packed.error?.message}`,
      };
    // A file is put at a full path: the platform expands no ~ or $HOME in it.
    const to = run(
      `mkdir -p "${clone}/${CARRIED_DIR}" && printf %s "${clone}/${CARRIED_DIR}/arriving.tgz"`,
    ).stdout;
    const sent = to ? adapter.put(name, archive, to) : { ok: false, why: 'its folder' };
    if (!sent.ok) return { ok: false, line: `${folder} couldn't be copied there: ${sent.why}` };
    const opened = run(
      `cd "${clone}" && tar -xzf "${to}" && rm -f "${to}" && printf %s ${stamp} > "${mark}"`,
      { timeoutSeconds: 1800 },
    );
    return opened.status === 0
      ? { ok: true, line: `Copied ${folder} there: ${plural(files, 'file')}, ${sizeWords(bytes)}.` }
      : {
          ok: false,
          line: `${folder} reached ${name} and couldn't be unpacked there: ${opened.output}`,
        };
  } finally {
    rmSync(held, { recursive: true, force: true });
  }
}

/** The project's cloud settings, or a stop saying how to name a platform. */
function cloudFor(config, file = '.claude/code-kit.json') {
  const cloud = cloudOf(config);
  if (!cloud)
    stop(
      `This project names no cloud platform. Add one to ${file}, such as "cloud": { "sprites": {} }, and run this again. The machine is yours, in your own account with that platform.`,
    );
  return cloud;
}

/** The machine's name for this project: the one it went up on, or the one it would. */
const nameFor = (root) => readMarker(root)?.machine ?? machineName(root);

/** The shell that finds code-kit's own install on the machine, as `$CK`. */
const FIND_PLUGIN = `CK="$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{const p=JSON.parse(s).find((x)=>x.id===${JSON.stringify(PLUGIN.id)});process.stdout.write(p?p.installPath:"")}catch{}})')"`;
/** Runs the machine's own code-kit in the project's clone there. Exit 97 when it isn't installed. */
const onMachine = (clone, args) =>
  `${FIND_PLUGIN}; test -n "$CK" || { echo "code-kit isn't installed on this machine" >&2; exit 97; }; cd "${clone}" && node "$CK/bin/code-kit.mjs" ${args}`;

/** What the machine says of itself (CLOUD-8), or { problem } when it can't be asked. */
export function machineState(adapter, name, clone) {
  const r = adapter.run(name, onMachine(clone, 'cloud here --json'), { timeoutSeconds: 90 });
  if (r.status !== 0)
    return {
      problem:
        r.status === 97
          ? "code-kit isn't installed on the machine yet"
          : r.output.split('\n').slice(-3).join(' ') || `exit ${r.status}`,
    };
  try {
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    return { problem: "the machine's answer couldn't be read" };
  }
}

/**
 * CLOUD-3 step 1: what the adapter needs on the computer, asked for one at a time. `io.ask` answers
 * true, false, or null where there's no terminal to ask in; nothing is installed without a yes.
 */
function ensureNeeds(adapter, io) {
  const byHand = (missing) =>
    `Run ${missing.length === 1 ? 'it' : 'them'} yourself, then run this again:\n${missing.map((n) => `  ${n.command}\n    (${n.what}, from ${n.from})`).join('\n')}`;
  for (let asked = 0; ; asked++) {
    const missing = adapter.needs().filter((n) => !n.have);
    if (!missing.length) return;
    const next = missing[0];
    if (asked > missing.length + 2)
      stop(
        `${next.what} still isn't there after its command ran. ${byHand(missing)}\nA new terminal may be needed for it to be found.`,
      );
    io.say(`${adapter.label} needs ${next.what} on this computer.`);
    io.say(`  ${next.command}`);
    io.say(`  That comes from ${next.from}.`);
    const yes = io.ask('Run it now?');
    if (yes === null)
      stop(
        `Nothing was installed: there's no terminal here to ask in, and code-kit doesn't install or sign in unasked. Ask the person to run ${missing.length === 1 ? 'this' : 'these'} in their own terminal, then \`code-kit cloud up\`:\n${missing.map((n) => `  ${n.command}\n    (${n.what}, from ${n.from})`).join('\n')}`,
      );
    if (!yes) stop(`Nothing was installed. ${byHand(missing)}`);
    if (io.local(next.command) !== 0) stop(`\`${next.command}\` didn't finish. ${byHand(missing)}`);
  }
}

/** The plugins Claude Code lists as enabled, from its own JSON: [{ id, version }]. */
const pluginsOf = (text) => {
  try {
    return JSON.parse(text)
      .filter((p) => p?.id && p.enabled !== false)
      .map((p) => ({ id: p.id, version: p.version ?? null }));
  } catch {
    return [];
  }
};

/**
 * CLOUD-3: makes the project's machine ready, doing only what's left. `io`: say(line), ask(question) →
 * true | false | null (no terminal), local(command) → exit status, terminal (whether the person is at
 * one). Throws Stop at each thing only the person can do, saying what.
 */
export function cloudUp(root, config, io) {
  const main = mainOf(root);
  const cloud = cloudFor(config);
  const { adapter } = cloud;
  const tracked = carryProblem(main, cloud.carry);
  if (tracked) stop(tracked);
  ensureNeeds(adapter, io);
  const remote = remoteOf(main);
  if (!remote)
    stop(
      'This project has no remote named origin. Its machine starts from the remote: add one, push, and run this again.',
    );
  const marker = readMarker(main);
  if (marker?.here) stop('This is the project on its machine already.');
  if (!marker) {
    const left = leftBehind(main, config);
    if (left.length)
      stop(
        `Nothing was moved. The machine starts from the remote, so this would be left behind on this computer:\n${left.map((l) => `  ${l}`).join('\n')}`,
      );
  }
  const name = marker?.machine ?? machineName(main);
  const clone = cloneOf(main);
  const made = adapter.ready(name);
  if (!made.ok) stop(made.why);
  io.say(made.made ? `Made ${name} on ${adapter.label}.` : `${name} is there on ${adapter.label}.`);
  const run = (cmd, o) => adapter.run(name, cmd, o);

  if (run('test -n "${ANTHROPIC_API_KEY:-}"').status === 0)
    stop(
      `${name} has an ANTHROPIC_API_KEY set. Claude Code would bill that key in place of your subscription. Remove it from the machine (code-kit cloud console), then run this again.`,
    );

  // The sign-ins are the person's. code-kit starts GitHub's and reads neither credential.
  const host = hostOf(remote);
  if (host === 'github.com') {
    const login = () => {
      const r = run('gh api user -q .login');
      return r.status === 0 ? r.stdout.trim() : null;
    };
    if (!login()) {
      if (io.ask(`${name} isn't signed in to GitHub. Start GitHub's device sign-in there now?`)) {
        io.say(
          'GitHub shows a one-time code below. Enter it at https://github.com/login/device, signed in as the account this project is pushed as.',
        );
        run('gh auth login --hostname github.com --git-protocol https --web', {
          inherit: true,
          timeoutSeconds: 900,
        });
      }
      if (!login())
        stop(
          `${name} isn't signed in to GitHub, so it can't clone or push. Run \`code-kit cloud up\` in your own terminal and say yes to GitHub's device sign-in; code-kit shows the code and never reads the token.`,
        );
    }
    const there = login();
    const mine = spawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8' });
    const here = mine.status === 0 ? mine.stdout.trim() : null;
    if (here && there !== here)
      stop(
        `${name} is signed in to GitHub as ${there}, and this computer as ${here}. Work pushed from the machine would be ${there}'s. Sign the machine in as ${here} (code-kit cloud console, then gh auth logout and gh auth login), or switch this computer's gh to ${there}, and run this again.`,
      );
    io.say(`GitHub: signed in there as ${there}.`);
    // git there asks GitHub's own command line for the credential. A device sign-in started with no
    // terminal signs that command line in and leaves git as it was, so a clone would stop to ask for
    // a username.
    const wired = run('gh auth setup-git --hostname github.com');
    if (wired.status !== 0)
      stop(
        `git on ${name} couldn't be set to use the GitHub sign-in there: ${wired.output.split('\n')[0] || `exit ${wired.status}`}. Run \`gh auth setup-git\` there yourself (code-kit cloud console), then run this again.`,
      );
  } else if (host) {
    io.say(
      `The remote is on ${host}: git on the machine needs a credential for it, which is yours to set up there (code-kit cloud console).`,
    );
  }
  const claudeIn = () => {
    const auth = run('claude auth status');
    try {
      return JSON.parse(auth.stdout.slice(auth.stdout.indexOf('{'))).loggedIn === true;
    } catch {
      return false;
    }
  };
  if (!claudeIn()) {
    // The person's own sign-in: at their terminal, up joins them to it and carries on in the same run.
    if (io.ask(`${name} isn't signed in to Claude. Sign in there now?`)) {
      io.say(
        'Claude Code asks you to open an address in your browser and paste a code back. code-kit sees none of it.',
      );
      adapter.terminal(name, 'claude auth login');
    }
    if (!claudeIn())
      stop(
        `${name} isn't signed in to Claude. Run \`code-kit cloud signin\` in your own terminal: it joins your terminal to Claude Code's sign-in on the machine, and code-kit never sees it. Then run \`code-kit cloud up\` again.`,
      );
  }
  io.say('Claude: signed in there.');

  // The clone, from the remote, with the computer's git name and email.
  const address = httpsRemote(remote);
  if (run(`test -d "${clone}/.git"`).status !== 0) {
    io.say(`Cloning ${address} there.`);
    const cloned = run(
      `mkdir -p "$(dirname "${clone}")" && git clone ${quoted(address)} "${clone}"`,
      { inherit: true, timeoutSeconds: 1800 },
    );
    if (cloned.status !== 0)
      stop(
        `The clone on ${name} failed (see above). Nothing else was done; put right what git said and run this again.`,
      );
  }
  for (const key of ['user.name', 'user.email']) {
    const value = git(main, 'config', key);
    if (value)
      run(
        `git -C "${clone}" config ${key} ${quoted(value)} && git config --global ${key} ${quoted(value)}`,
      );
    else io.say(`This computer's clone sets no git ${key}; commits made on the machine need one.`);
  }

  // code-kit there, level with the computer's.
  const listThere = () => pluginsOf(run('claude plugin list --json').stdout);
  let there = listThere();
  const mine = () => there.find((p) => p.id === PLUGIN.id);
  if (!mine()) {
    io.say(`Installing code-kit there.`);
    run(
      `claude plugin marketplace add ${quoted(PLUGIN.repository)}; claude plugin install ${quoted(PLUGIN.id)} -y`,
      { inherit: true, timeoutSeconds: 600 },
    );
    there = listThere();
  } else if (PLUGIN.version && mine().version !== PLUGIN.version) {
    io.say(`Updating code-kit there (${mine().version}) to this computer's (${PLUGIN.version}).`);
    run(
      `claude plugin marketplace update ${quoted(PLUGIN.market)}; claude plugin update ${quoted(PLUGIN.id)}`,
      { inherit: true, timeoutSeconds: 600 },
    );
    there = listThere();
  }
  if (!mine())
    stop(
      `code-kit couldn't be installed on ${name} (see above). Install it there yourself (code-kit cloud console, then claude plugin install ${PLUGIN.id}) and run this again.`,
    );
  if (PLUGIN.version && mine().version !== PLUGIN.version)
    io.say(
      `code-kit there is ${mine().version}, and ${PLUGIN.version} here: the machine has the latest released one.`,
    );

  // The plugins the project's own settings enable, which a session there would ask about.
  for (const plugin of projectPlugins(main)) {
    if (there.some((p) => p.id === plugin.id)) continue;
    io.say(`Installing ${plugin.id} there, which the project's settings enable.`);
    run(
      `${plugin.source ? `claude plugin marketplace add ${quoted(plugin.source)}; ` : ''}claude plugin install ${quoted(plugin.id)} -y`,
      { inherit: true, timeoutSeconds: 600 },
    );
  }
  there = listThere();

  // What the platform's image lacks, once, and again when the command changes.
  if (cloud.prepare) {
    const stamp = createHash('sha256').update(cloud.prepare).digest('hex');
    const had = run(`cat "${clone}/${PREPARED_FILE}" 2>/dev/null`).stdout.trim();
    if (had !== stamp) {
      io.say(`Running the project's prepare there: ${cloud.prepare}`);
      const prepared = run(`cd "${clone}" && ${cloud.prepare}`, {
        inherit: true,
        timeoutSeconds: 1800,
      });
      if (prepared.status !== 0)
        stop(
          `"cloud.prepare" failed on ${name} (see above). Put the command right in the config and run this again.`,
        );
      run(`mkdir -p "${clone}/${CLOUD_DIR}" && printf %s ${stamp} > "${clone}/${PREPARED_FILE}"`);
    }
  }
  const notThere = [];
  for (const f of cloud.carry) {
    if (!existsSync(join(main, f))) {
      io.say(`"cloud.carry" names ${f}, which isn't on this computer: nothing to copy.`);
      continue;
    }
    if (isFolder(join(main, f))) {
      const carried = carryFolder({ adapter, name, run, main, clone, folder: f });
      io.say(carried.line);
      if (!carried.ok) notThere.push(f);
      continue;
    }
    // A file is put at a full path: the platform expands no ~ or $HOME in it.
    const to = run(`mkdir -p "$(dirname "${clone}/${f}")" && printf %s "${clone}/${f}"`).stdout;
    const sent = to ? adapter.put(name, join(main, f), to) : { ok: false, why: 'its folder' };
    io.say(sent.ok ? `Copied ${f} there.` : `${f} couldn't be copied there: ${sent.why}`);
    if (!sent.ok) notThere.push(f);
  }
  // The project can't run there without what it carries: its work stays here until that has arrived.
  if (notThere.length)
    stop(
      `${name} isn't ready: ${notThere.join(', ')} didn't arrive (see above), and the project's checks may not pass there without ${notThere.length === 1 ? 'it' : 'them'}. The project's work stays on this computer. Run \`code-kit cloud up\` again: it copies what's missing and carries on.`,
    );

  const since = marker?.since ?? new Date().toISOString();
  run(
    `mkdir -p "${clone}/.claude/state" && printf %s ${quoted(JSON.stringify({ here: true, machine: name, adapter: adapter.key, since }))} > "${clone}/${CLOUD_FILE}"`,
  );
  writeMarker(main, { machine: name, adapter: adapter.key, since });

  // What this computer has for the project that the machine won't.
  const local = spawnSync('claude', ['plugin', 'list', '--json'], { encoding: 'utf8' });
  const absent = pluginsOf(local.status === 0 ? local.stdout : '[]')
    .map((p) => p.id)
    .filter((id) => !there.some((p) => p.id === id));
  io.say(`\n${name} is ready, and this project's work is there now.`);
  if (absent.length)
    io.say(
      `Plugins on this computer that aren't on the machine: ${absent.join(', ')}. Install the ones the project's work needs there (code-kit cloud console).`,
    );
  io.say(
    "MCP servers set up on this computer, and tools that run on it (a design tool, a browser), aren't reachable from the machine.",
  );
  io.say(
    `Open the lead's session there: code-kit cloud open\nSee what it's doing from here: code-kit cloud`,
  );
}

/** The plugins the project's own `.claude/settings.json` enables: [{ id, source }]. */
function projectPlugins(main) {
  const settings = readJson(join(main, '.claude/settings.json')) ?? {};
  const markets = settings.extraKnownMarketplaces ?? {};
  return Object.entries(settings.enabledPlugins ?? {})
    .filter(([id, on]) => on === true && id !== PLUGIN.id && id.includes('@'))
    .map(([id]) => {
      const source = markets[id.split('@')[1]]?.source;
      return {
        id,
        source:
          source?.source === 'github' && source.repo
            ? source.repo
            : source?.source === 'git' && source.url
              ? source.url
              : null,
      };
    });
}

/** The machine a command works on: { cloud, adapter, name, clone }, stopping when the project isn't up. */
function upMachine(root, config, { ready = true } = {}) {
  const cloud = cloudFor(config);
  const marker = readMarker(root);
  if (marker?.here) stop('This is the project on its machine; run this from your computer.');
  if (ready && !marker)
    stop("This project isn't on a cloud machine. Make its machine ready first: code-kit cloud up");
  return { cloud, adapter: cloud.adapter, name: nameFor(root), clone: cloneOf(root), marker };
}

/** Ends the lead's session on the machine, letting Claude Code finish first, and the watcher. */
const END_SESSIONS = `P="$(tmux list-panes -t ${LEAD_SESSION} -F '#{pane_pid}' 2>/dev/null | head -1)"; if test -n "$P"; then kill -TERM "$P" 2>/dev/null; pkill -TERM -P "$P" 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10; do tmux has-session -t ${LEAD_SESSION} 2>/dev/null || break; sleep 1; done; fi; tmux kill-session -t ${LEAD_SESSION} 2>/dev/null; true`;

/** CLOUD-3: the person's terminal joined to Claude Code's own sign-in on the machine. */
export function cloudSignin(root, config, io) {
  const { adapter, name } = upMachine(root, config, { ready: false });
  if (!io.terminal)
    stop(
      `Signing in to Claude is the person's own step, in their own terminal: ask them to run \`code-kit cloud signin\`.`,
    );
  const made = adapter.ready(name);
  if (!made.ok) stop(made.why);
  io.say(
    'Claude Code asks you to open an address in your browser and paste a code back. code-kit sees none of it.',
  );
  return adapter.terminal(name, 'claude auth login');
}

/** A shell on the machine, in the project's clone when it's there. */
export function cloudConsole(root, config) {
  const { adapter, name, clone } = upMachine(root, config, { ready: false });
  return adapter.terminal(name, `cd "${clone}" 2>/dev/null; exec bash -l`);
}

/**
 * CLOUD-4: the lead's session on the machine, started if there's none, with the watcher beside it, and
 * the person's terminal joined to it where there is one.
 */
export function cloudOpen(root, config, io) {
  const { adapter, name, clone } = upMachine(root, config);
  const run = (cmd, o) => adapter.run(name, cmd, o);
  if (run('command -v tmux').status !== 0)
    stop(
      `${name} has no tmux, which keeps the lead's session running when nobody is attached. Add its install to "cloud.prepare" in the config (such as "sudo apt-get install -y tmux") and run \`code-kit cloud up\`.`,
    );
  // A machine's first session waits at Claude Code's own first-run questions until the person answers.
  let first = false;
  if (run(`tmux has-session -t ${LEAD_SESSION}`).status !== 0) {
    const ended = readJson0(run(`cat "${clone}/${ENDED_FILE}" 2>/dev/null`).stdout);
    // The conversation an earlier session there left, which the new one continues. No session is open,
    // so no tool call is running: what a killed one left noted as running is cleared with the start.
    const before =
      run(
        `ls "$HOME/.claude/projects/$(cd "${clone}" && pwd | sed 's/[^A-Za-z0-9]/-/g')"/*.jsonl >/dev/null 2>&1`,
      ).status === 0;
    const started = run(
      `rm -f "${clone}/${ENDED_FILE}"; rm -rf "${clone}/${ACTS_DIR}"; mkdir -p "${clone}/${CLOUD_DIR}" && touch "${clone}/${LAST_FILE}" && tmux new-session -d -s ${LEAD_SESSION} -c "${clone}" ${quoted(`claude --permission-mode bypassPermissions${before ? ' --continue' : ''}`)}`,
    );
    if (started.status !== 0)
      stop(`The lead's session couldn't be started on ${name}: ${started.output}`);
    first = !before;
    io.say(
      ended
        ? `The last session there ${ended.why}. Started a new one, which continues its conversation.`
        : `Started the lead's session on ${name}${before ? ', continuing its last conversation' : ''}.`,
    );
  } else io.say(`The lead's session is open on ${name}; joining it.`);
  const watching = run(
    `tmux has-session -t ${WATCH_SESSION} 2>/dev/null || tmux new-session -d -s ${WATCH_SESSION} -c "${clone}" ${quoted(onMachine(clone, 'cloud watch'))}`,
  );
  if (watching.status !== 0)
    io.say(
      `The watcher that lets ${name} sleep when nothing moves couldn't be started (${watching.output.split('\n')[0]}). End the session yourself when you're done: code-kit cloud stop`,
    );
  if (!io.terminal) {
    io.say(
      first
        ? `It's the first session on ${name}, so Claude Code is waiting there at its first-run questions (its theme, whether to trust the folder, working without permission prompts). They're the person's to answer, and nothing runs until they do: ask them to run \`code-kit cloud open\` in their own terminal.`
        : `It's running there with nobody attached. Join it from a terminal: code-kit cloud open`,
    );
    return 0;
  }
  io.say('Leave it working with Ctrl-b then d. It carries on with nobody attached.');
  return adapter.terminal(name, `tmux attach -t ${LEAD_SESSION}`);
}
const readJson0 = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** CLOUD-7: ends the lead's session on the machine now, so it sleeps. Asks first while lanes work. */
export function cloudStop(root, config, io) {
  const { adapter, name, clone } = upMachine(root, config);
  const state = machineState(adapter, name, clone);
  const running = state.running ?? [];
  if (running.length) {
    const what = running.map((r) => `${r.story ?? 'a story'} in the ${r.lane} lane`).join(', ');
    const yes = io.ask(
      `${what} ${running.length === 1 ? 'is' : 'are'} working there. End the session anyway?`,
    );
    if (yes === null)
      stop(
        `${what} ${running.length === 1 ? 'is' : 'are'} working on ${name}. Ending the session stops ${running.length === 1 ? 'it' : 'them'} mid-story, so it's the person's to confirm: ask them to run \`code-kit cloud stop\` in their own terminal.`,
      );
    if (!yes) stop('Left running.');
  }
  adapter.run(
    name,
    `mkdir -p "${clone}/${CLOUD_DIR}" && printf %s ${quoted(JSON.stringify({ at: new Date().toISOString(), why: 'was stopped from your computer' }))} > "${clone}/${ENDED_FILE}"; tmux kill-session -t ${WATCH_SESSION} 2>/dev/null; ${END_SESSIONS}`,
    { timeoutSeconds: 60 },
  );
  io.say(
    `Ended the lead's session on ${name}. With nothing open, it sleeps and bills its disk only.`,
  );
}

/** What `cloud down` won't leave behind on the machine (CLOUD-9), as sentences. */
export function heldThere(state) {
  const held = [];
  for (const r of state.running ?? [])
    held.push(`${r.story ?? 'A story'} is running there in the ${r.lane} lane.`);
  const not = state.notOnRemote ?? { branches: [], dirty: [] };
  for (const b of not.branches)
    held.push(
      b.base
        ? `${b.branch} has ${plural(b.commits, 'merge or commit', 'merges and commits')} there that ${b.commits === 1 ? "isn't" : "aren't"} on the remote. Publish from the machine: code-kit publish, in its lead's session.`
        : `${b.branch} has ${plural(b.commits, 'commit')} there that ${b.commits === 1 ? "isn't" : "aren't"} on the remote. Push it from the machine, or merge it.`,
    );
  for (const d of not.dirty)
    held.push(`${d.where} has ${plural(d.files, 'uncommitted file')} there.`);
  return held;
}

/** CLOUD-9: the project brought home, and the machine removed with both sign-ins on it. */
export function cloudDown(root, config, io, { discard = false } = {}) {
  const { adapter, name, clone } = upMachine(root, config);
  const platform = adapter.state(name);
  if (!platform.reachable) stop(`${adapter.label} didn't answer: ${platform.why}`);
  if (platform.exists) {
    const state = machineState(adapter, name, clone);
    const held = state.problem
      ? [`The machine couldn't say what it holds: ${state.problem}.`]
      : heldThere(state);
    if (held.length && !discard)
      stop(
        `Nothing was removed. ${name} holds work that isn't on the remote, which removing it would lose:\n${held.map((h) => `  ${h}`).join('\n')}\nFinish and push it from the machine (code-kit cloud open). To remove the machine with what's on it, the person runs: code-kit cloud down --discard`,
      );
    if (held.length) {
      io.say(`Removing ${name} loses:\n${held.map((h) => `  ${h}`).join('\n')}`);
      if (io.ask('Remove it anyway?') !== true) stop('Nothing was removed.');
    }
    adapter.run(name, `tmux kill-session -t ${WATCH_SESSION} 2>/dev/null; ${END_SESSIONS}`, {
      timeoutSeconds: 60,
    });
    const gone = adapter.release(name);
    if (!gone.ok) stop(`${name} couldn't be removed: ${gone.why}`);
  }
  clearMarker(root);
  io.say(
    `${platform.exists ? `Removed ${name}, with the sign-ins on it` : `${name} was already gone`}. The project is on this computer again: git pull to bring in what was pushed from the machine.`,
  );
}

/**
 * CLOUD-8: where the project's work is and what its machine is doing, for `cloud` to print:
 * { platform, name, up, since, exists, sessions, state } where `state` is the machine's own report.
 */
export function cloudStatus(root, config) {
  const cloud = cloudOf(config);
  if (!cloud) return { platform: null };
  const marker = readMarker(root);
  if (marker?.here) return { platform: cloud.adapter.label, here: true, name: marker.machine };
  const name = nameFor(root);
  const platform = cloud.adapter.state(name);
  const facts = {
    platform: cloud.adapter.label,
    name,
    up: Boolean(marker),
    since: marker?.since ?? null,
    reachable: platform.reachable,
    why: platform.why ?? null,
    exists: platform.exists ?? false,
    sessions: platform.sessions ?? [],
    version: PLUGIN.version,
    state: null,
  };
  if (marker && platform.reachable && platform.exists)
    facts.state = machineState(cloud.adapter, name, cloneOf(root));
  // Kept for `next`, which names what needs the person without asking the machine each time: asking
  // wakes it.
  if (marker) {
    try {
      writeJson(join(mainOf(root), STATUS_FILE), { at: new Date().toISOString(), ...facts });
    } catch {
      // a read-only checkout: next goes without
    }
  }
  return facts;
}

/** The machine's report as `cloud` last read it, or null. */
export const lastStatus = (root) => readJson(join(mainOf(root), STATUS_FILE));

/** CLOUD-8: what `next` on the computer names about the machine, from its last report. */
export function cloudAttention(status, now = Date.now()) {
  const s = status?.state;
  if (!s || s.problem) return [];
  const found = [];
  if (s.claude && !s.claude.signedIn)
    found.push(
      `The Claude sign-in on ${status.name} has ended, so no session there can work. The person signs in again: code-kit cloud signin`,
    );
  else if (s.claude?.ends && Date.parse(s.claude.ends) - now < SIGN_IN_DAYS * 86_400_000)
    found.push(
      `The Claude sign-in on ${status.name} ends on ${s.claude.ends.slice(0, 10)}. The person signs in again before then: code-kit cloud signin`,
    );
  if (s.version && status.version && s.version !== status.version)
    found.push(
      `code-kit on ${status.name} is ${s.version}, and ${status.version} on this computer: code-kit cloud up brings it level.`,
    );
  return found;
}

// ---------------------------------------------------------------------------------------------------
// The machine's side

/** Whose a running tool call is, as its marker's name starts: the session, and its agent or `main`. */
const actOwner = (session, agent) =>
  `${session ?? 'session'}-${agent ?? 'main'}`.replace(/[^\w-]+/g, '_');

/** A tool call starting or ending in the project on its machine, for the watcher (CLOUD-7). */
export function noteAct(root, id, mode, { session = null, agent = null } = {}) {
  const main = mainOf(root);
  if (!isMachine(main)) return;
  try {
    mkdirSync(join(main, ACTS_DIR), { recursive: true });
    const file = join(
      main,
      ACTS_DIR,
      `${actOwner(session, agent)}.${createHash('sha256').update(String(id)).digest('hex').slice(0, 24)}`,
    );
    if (mode === 'start') writeFileSync(file, '');
    else rmSync(file, { force: true });
    writeFileSync(join(main, LAST_FILE), '');
  } catch {
    // a read-only checkout: the watcher goes by what it can see
  }
}
/**
 * An agent's turn ending there (CLOUD-7): none of its tool calls is running any more. A call a guard
 * refused gets a start and no end, and would count as running until it went stale.
 */
export function noteTurnEnd(root, { session = null, agent = null } = {}) {
  const main = mainOf(root);
  if (!isMachine(main)) return;
  try {
    const mine = `${actOwner(session, agent)}.`;
    for (const f of readdirSync(join(main, ACTS_DIR)))
      if (f.startsWith(mine)) rmSync(join(main, ACTS_DIR, f), { force: true });
  } catch {
    // no call was ever noted there
  }
}
/** The person sending a prompt there. */
export function notePrompt(root) {
  const main = mainOf(root);
  if (!isMachine(main)) return;
  try {
    mkdirSync(join(main, CLOUD_DIR), { recursive: true });
    writeFileSync(join(main, LAST_FILE), '');
  } catch {
    // as above
  }
}

/** When anything last moved in the project, and the tool calls still running: { last, open }. */
export function activityOf(root, now = Date.now()) {
  const main = mainOf(root);
  let last = null;
  try {
    last = statSync(join(main, LAST_FILE)).mtimeMs;
  } catch {
    last = null;
  }
  let open = 0;
  try {
    for (const f of readdirSync(join(main, ACTS_DIR)))
      if (now - statSync(join(main, ACTS_DIR, f)).mtimeMs < ACT_STALE_MS) open++;
  } catch {
    open = 0;
  }
  return { last, open };
}

/**
 * CLOUD-7: whether the lead's session should be ended now: nothing running, nothing merging, and no tool
 * call or prompt for `idleMinutes`. `{ end, idleMinutes, why }`.
 */
export function idleVerdict({ idleMinutes, last, open, running, merging, since, now }) {
  const quiet = Math.floor((now - Math.max(last ?? 0, since)) / 60_000);
  if (open > 0) return { end: false, idleMinutes: 0, why: `${plural(open, 'tool call')} running` };
  if (running > 0) return { end: false, idleMinutes: 0, why: `${plural(running, 'lane')} working` };
  if (merging) return { end: false, idleMinutes: 0, why: 'the queue is merging' };
  return quiet >= idleMinutes
    ? { end: true, idleMinutes: quiet, why: `was ended after ${idleMinutes} idle minutes` }
    : { end: false, idleMinutes: quiet, why: `${quiet} of ${idleMinutes} idle minutes` };
}

/** The seconds the machine has been awake since it started, which stop counting while it sleeps. */
function uptimeSeconds() {
  try {
    return Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  } catch {
    return null;
  }
}

/**
 * CLOUD-8: the awake seconds this month, added up from the machine's uptime each time it's looked at:
 * { month, seconds, since }, or null where the machine has no uptime to read.
 */
export function countAwake(root, now = Date.now(), uptime = uptimeSeconds()) {
  if (uptime === null) return null;
  const file = join(mainOf(root), AWAKE_FILE);
  const month = new Date(now).toISOString().slice(0, 7);
  const had = readJson(file);
  const fresh = !had || had.month !== month;
  const prior = fresh ? null : had.uptime;
  // An uptime below the last one read means the platform started the count again.
  const added = prior === null ? 0 : uptime >= prior ? uptime - prior : uptime;
  const next = {
    month,
    seconds: (fresh ? 0 : had.seconds) + added,
    since: fresh ? new Date(now).toISOString() : had.since,
    uptime,
  };
  try {
    writeJson(file, next);
  } catch {
    // counted next time
  }
  return { month, seconds: Math.round(next.seconds), since: next.since };
}

const ran = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20_000 });
  return r.status === 0 ? r.stdout : null;
};

/** What's in this checkout and its worktrees that the remote doesn't hold (CLOUD-8, CLOUD-9). */
export function notOnRemote(root, config) {
  const main = mainOf(root);
  const base = config.branches.protected[0];
  const branches = unpushed(main)
    .filter((b) => b.branch === base || storyOfBranch(b.branch))
    .map((b) => ({ ...b, base: b.branch === base }));
  const dirty = [];
  const trees = (git(main, 'worktree', 'list', '--porcelain') ?? '')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9));
  for (const tree of trees) {
    const files = (git(tree, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
    if (files) dirty.push({ where: tree === main ? 'The main checkout' : basename(tree), files });
  }
  return { branches, dirty };
}

/** CLOUD-8: the machine's report of itself, run there by its own code-kit. */
export function hereState(root, config, now = Date.now()) {
  const main = mainOf(root);
  let claude = { signedIn: false };
  try {
    const text = ran('claude', ['auth', 'status'], main) ?? '';
    const status = JSON.parse(text.slice(text.indexOf('{')));
    const ends = status.loginExpiresAt ?? null;
    claude = {
      signedIn: status.loggedIn === true,
      account: status.subscriptionType ?? status.authMethod ?? null,
      ends: ends ? new Date(ends).toISOString() : null,
    };
  } catch {
    claude = { signedIn: false };
  }
  const login = ran('gh', ['api', 'user', '-q', '.login'], main)?.trim() || null;
  const ghStatus = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  const scopes =
    `${ghStatus.stdout ?? ''}${ghStatus.stderr ?? ''}`
      .match(/Token scopes:\s*(.+)/)?.[1]
      ?.replace(/['"]/g, '')
      .split(/,\s*/)
      .filter(Boolean) ?? [];
  const sessions = (ran('tmux', ['ls', '-F', '#{session_name} #{session_created}'], main) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, created] = l.split(' ');
      return { name, since: new Date(Number(created) * 1000).toISOString() };
    });
  const df = (ran('df', ['-Pk', main], main) ?? '').trim().split('\n').pop()?.split(/\s+/) ?? [];
  const activity = activityOf(main, now);
  return {
    version: PLUGIN.version,
    claude,
    github: { login, scopes },
    apiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    sessions,
    running: laneClaims(main, now)
      .filter((c) => !c.stale)
      .map((c) => ({ lane: c.lane, story: c.story ?? null })),
    merging: readQueue(main).some((e) => e.state === 'merging'),
    notOnRemote: notOnRemote(main, config),
    activity: {
      last: activity.last ? new Date(activity.last).toISOString() : null,
      open: activity.open,
    },
    ended: readJson(join(main, ENDED_FILE)),
    awake: countAwake(main, now),
    load: Number(loadavg()[0].toFixed(2)),
    cores: cpus().length,
    memory: { total: totalmem(), free: freemem() },
    disk: df.length >= 4 ? { size: Number(df[1]) * 1024, used: Number(df[2]) * 1024 } : null,
  };
}

/** How long each of the watcher's holds keeps the machine running: until its look after next. */
export const HOLD_SECONDS = WATCH_SECONDS * 3;

/**
 * CLOUD-7: the watcher, run on the machine beside the lead's session. While the session is open it asks
 * the platform, through the adapter, to keep the machine running, and asks again each minute: a machine
 * nobody is connected to is otherwise paused within the minute, with the work on it. Each minute it also
 * counts the awake time and, when nothing has moved for `idleMinutes`, ends the lead's session, lets go
 * of the hold and stops, so the machine sleeps. A watcher that dies leaves a hold that runs out by itself.
 */
export async function watch(root, config, { once = false } = {}) {
  const main = mainOf(root);
  const cloud = cloudOf(config);
  const idleMinutes = cloud?.idleMinutes ?? 30;
  const maySleep = () => cloud?.adapter.maySleep?.();
  // Stopped from the computer (`cloud stop` ends its terminal session): the machine may sleep at once.
  for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      maySleep();
      process.exit(0);
    });
  // A watcher counts idle time from when it started; a single look goes by what's recorded.
  const since = once ? 0 : Date.now();
  for (;;) {
    const now = Date.now();
    countAwake(main, now);
    const activity = activityOf(main, now);
    const verdict = idleVerdict({
      idleMinutes,
      ...activity,
      running: laneClaims(main, now).filter((c) => !c.stale).length,
      merging: readQueue(main).some((e) => e.state === 'merging'),
      since,
      now,
    });
    const open = spawnSync('tmux', ['has-session', '-t', LEAD_SESSION], { stdio: 'ignore' });
    // The session ended by itself (the person quit it): nothing left to watch.
    if (open.status !== 0 && !once) {
      maySleep();
      return { ended: false, why: 'the session is gone' };
    }
    if (verdict.end) {
      writeJson(join(main, ENDED_FILE), { at: new Date(now).toISOString(), why: verdict.why });
      spawnSync('bash', ['-c', END_SESSIONS], { stdio: 'ignore' });
      maySleep();
      return { ended: true, why: verdict.why };
    }
    cloud?.adapter.stayAwake?.(HOLD_SECONDS);
    if (once) return { ended: false, why: verdict.why };
    await new Promise((r) => setTimeout(r, WATCH_SECONDS * 1000));
  }
}

export const hasGit = () => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
