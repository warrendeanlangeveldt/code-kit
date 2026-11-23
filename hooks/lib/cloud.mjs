// A project on a cloud machine (spec 32): the lead's session, its lane agents, their worktrees, the checks
// and the merge queue all run on one machine the person owns, and the person's computer only connects.
// This file is both sides of it. On the computer: what `cloud up` does to make a machine ready (CLOUD-3),
// opening, stopping and removing it (CLOUD-4, CLOUD-7, CLOUD-9), and the marker that keeps the project in
// one place at a time (CLOUD-6), and the terminal the machine serves in a browser (CLOUD-12). On the
// machine: what it reports of itself (CLOUD-8), the watcher that ends an idle session so the machine
// sleeps (CLOUD-7), what that terminal runs (CLOUD-12), and pairing the machine with the hosted provider
// that asked for it (CLOUD-16). The platform is an adapter's (CLOUD-2), and so is that provider; nothing
// here names either.
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
import { machineAdapterOf, providerAdapterOf } from './adapters/index.mjs';
import { cloudOf } from './cloudconfig.mjs';
import { folderName, httpsRemote, machineNameOf } from './cloudfacts.mjs';
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
/** CLOUD-12, on the machine: the page its terminal serves, and what the terminal runs for each browser. */
const TERMINAL_PAGE = `${CLOUD_DIR}/terminal.html`;
const TERMINAL_START = `${CLOUD_DIR}/terminal.sh`;
/** On the machine: what its platform keeps running for the provider it's paired with (CLOUD-16). */
const PROVIDER_START = `${CLOUD_DIR}/provider.sh`;
/** On the machine: its owner's answer that pairing isn't to be offered again. */
const PROVIDER_FILE = `${CLOUD_DIR}/provider.json`;
/** The port the machine's terminal listens on, which the platform routes the machine's address to. */
export const TERMINAL_PORT = 7681;
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

// What a hub shares with code-kit is in cloudfacts.mjs; the command line and the tests reach it here.
export {
  WORKFLOW_FILE,
  httpsRemote,
  machineWorkflow,
  workflowInputs,
  workflowStanding,
  workflowSteps,
} from './cloudfacts.mjs';

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

/** The host a remote's address is on, or null for a path on this disk. */
export const hostOf = (url) => httpsRemote(url).match(/^https?:\/\/([^/:]+)/i)?.[1] ?? null;

/** The address the project's remote is set to, as the config has it: no rewrite of this computer's applied. */
const remoteOf = (main) => git(main, 'config', '--get', 'remote.origin.url');

/** The project's folder name, as a machine's folder and name can hold it. */
const folderOf = (root) => folderName(basename(mainOf(root)));

/**
 * CLOUD-11: the project's machine, named from its folder and a hash of its remote's address, so a second
 * computer with the same clone finds the same one.
 */
export const machineName = (root, remote = remoteOf(mainOf(root))) =>
  machineNameOf(basename(mainOf(root)), remote ?? mainOf(root));

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
function ensureNeeds(adapter, io, { unattended = false } = {}) {
  if (unattended) {
    const missing = adapter.needs().filter((n) => !n.have);
    if (missing.length)
      stop(
        `${adapter.label} needs ${missing.map((n) => n.what).join(' and ')} here, and nobody is here to install it or sign in. The machine workflow does both before this runs, with the repository's own secret: \`code-kit cloud workflow\` prints the file.`,
      );
    return;
  }
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
 * CLOUD-13: the machine's clone made from this checkout's own commits, sent as one bundle, with the
 * remote's address set on it. For a machine nobody has signed in to GitHub yet, which can't clone: once
 * its owner signs in there, it fetches the rest and pushes as them.
 */
function seedClone({ adapter, name, run, main, clone, address, io }) {
  if (git(main, 'rev-parse', '--is-shallow-repository') === 'true')
    stop(
      "This checkout holds only its latest commit, and the machine's clone is made from it. Check out the whole history (in a workflow, `fetch-depth: 0` on actions/checkout) and run this again.",
    );
  const branch = git(main, 'branch', '--show-current');
  if (!branch)
    stop(
      "This checkout is on no branch, and the machine's clone starts on the one it's on. Check out the default branch and run this again.",
    );
  io.say(
    `Copying ${branch} to ${name}, which fetches the rest once its owner has signed in to GitHub.`,
  );
  const held = mkdtempSync(join(tmpdir(), 'code-kit-seed-'));
  try {
    const bundle = join(held, 'seed.bundle');
    const packed = spawnSync('git', ['-C', main, 'bundle', 'create', '-q', bundle, branch], {
      encoding: 'utf8',
    });
    if (packed.status !== 0)
      stop(
        `${branch} couldn't be packed to copy: ${`${packed.stderr ?? ''}`.trim().split('\n')[0] || packed.error?.message}`,
      );
    // A file is put at a full path: the platform expands no ~ or $HOME in it.
    const to = run(`mkdir -p "$(dirname "${clone}")" && printf %s "${clone}.bundle"`).stdout;
    const sent = to ? adapter.put(name, bundle, to) : { ok: false, why: 'its folder' };
    if (!sent.ok) stop(`${branch} couldn't be copied to ${name}: ${sent.why}. Run this again.`);
    const cloned = run(
      `git clone -q -b ${quoted(branch)} "${to}" "${clone}" && git -C "${clone}" remote set-url origin ${quoted(address)}; S=$?; rm -f "${to}"; exit $S`,
      { timeoutSeconds: 1800 },
    );
    if (cloned.status !== 0)
      stop(`The copy reached ${name} and couldn't be made a clone there: ${cloned.output}`);
  } finally {
    rmSync(held, { recursive: true, force: true });
  }
}

/**
 * CLOUD-3: makes the project's machine ready, doing only what's left. With `unattended` (CLOUD-13) nobody
 * is asked anything: what only the machine's owner can give is left for its terminal, and `stage` stops
 * after the machine is made (`machine`) or the clone is there (`clone`). `io`: say(line), ask(question) →
 * true | false | null (no terminal), local(command) → exit status, terminal (whether the person is at
 * one). Throws Stop at each thing only the person can do, saying what. `provider` is the hosted team
 * provider that asked for the machine, as `team.provider` names one (CLOUD-16): the machine keeps it,
 * and its owner is offered the pairing on their first visit.
 */
export function cloudUp(
  root,
  config,
  io,
  { unattended = false, stage = null, provider = null } = {},
) {
  const main = mainOf(root);
  const cloud = cloudFor(config);
  const { adapter } = cloud;
  const tracked = carryProblem(main, cloud.carry);
  if (tracked) stop(tracked);
  if (unattended && !cloud.terminal)
    stop(
      'With nobody at a computer, the machine\'s terminal in a browser is the only way in to it, and "cloud.terminal" is off in the config. Take that setting out, or make the machine from your own computer: code-kit cloud up',
    );
  ensureNeeds(adapter, io, { unattended });
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
  if (stage === 'machine') return;
  const run = (cmd, o) => adapter.run(name, cmd, o);

  if (run('test -n "${ANTHROPIC_API_KEY:-}"').status === 0)
    stop(
      `${name} has an ANTHROPIC_API_KEY set. Claude Code would bill that key in place of your subscription. Remove it from the machine (code-kit cloud console), then run this again.`,
    );

  // The sign-ins are the person's. code-kit starts GitHub's and reads neither credential.
  // With nobody at a computer (CLOUD-13) neither is asked for: the machine's owner gives both at its
  // terminal, on their first visit (CLOUD-14).
  const host = hostOf(remote);
  let pushesAs = null;
  if (host === 'github.com') {
    const login = () => {
      const r = run('gh api user -q .login');
      return r.status === 0 ? r.stdout.trim() : null;
    };
    if (!login() && unattended)
      io.say(`GitHub: ${name} isn't signed in yet. Its owner signs in at its terminal.`);
    else if (!login()) {
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
    pushesAs = there;
    // A workflow's own sign-in to GitHub is no person's, so there's nobody's to compare with.
    const mine = unattended
      ? null
      : spawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8' });
    const here = mine?.status === 0 ? mine.stdout.trim() : null;
    if (there && here && there !== here)
      stop(
        `${name} is signed in to GitHub as ${there}, and this computer as ${here}. Work pushed from the machine would be ${there}'s. Sign the machine in as ${here} (code-kit cloud console, then gh auth logout and gh auth login), or switch this computer's gh to ${there}, and run this again.`,
      );
    if (there) {
      io.say(`GitHub: signed in there as ${there}.`);
      // git there asks GitHub's own command line for the credential. A device sign-in started with no
      // terminal signs that command line in and leaves git as it was, so a clone would stop to ask for
      // a username.
      const wired = run('gh auth setup-git --hostname github.com');
      if (wired.status !== 0)
        stop(
          `git on ${name} couldn't be set to use the GitHub sign-in there: ${wired.output.split('\n')[0] || `exit ${wired.status}`}. Run \`gh auth setup-git\` there yourself (code-kit cloud console), then run this again.`,
        );
    }
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
  const claudeWaits = unattended && !claudeIn();
  if (claudeWaits)
    io.say(`Claude: ${name} isn't signed in yet. Its owner signs in at its terminal.`);
  else if (!claudeIn()) {
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
  if (!claudeWaits) io.say('Claude: signed in there.');

  // The clone, from the remote, with the computer's git name and email. A machine that can't reach
  // the remote yet, with nobody there to sign it in, gets this checkout's own commits (CLOUD-13).
  const address = httpsRemote(remote);
  if (run(`test -d "${clone}/.git"`).status === 0) {
    // there already
  } else if (unattended && !pushesAs) {
    seedClone({ adapter, name, run, main, clone, address, io });
  } else {
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
  // A workflow's checkout is nobody's: the name and email on the machine's commits are its owner's,
  // set when they sign in there (CLOUD-14).
  for (const key of unattended ? [] : ['user.name', 'user.email']) {
    const value = git(main, 'config', key);
    if (value)
      run(
        `git -C "${clone}" config ${key} ${quoted(value)} && git config --global ${key} ${quoted(value)}`,
      );
    else io.say(`This computer's clone sets no git ${key}; commits made on the machine need one.`);
  }
  if (stage === 'clone') return;

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
      io.say(
        unattended
          ? `"cloud.carry" names ${f}, which git ignores, so this checkout has none to copy. Put it on the machine yourself, at its terminal.`
          : `"cloud.carry" names ${f}, which isn't on this computer: nothing to copy.`,
      );
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

  // The lead's session in a browser, at the machine's own address (CLOUD-12).
  let terminal = null;
  if (cloud.terminal) terminal = serveTerminal({ adapter, name, run, main, clone, io });
  else if (marker?.terminal && adapter.unserve) {
    adapter.unserve(name);
    io.say(`"cloud.terminal" is off: ${name} no longer serves a terminal at its address.`);
  }
  if (unattended && !terminal)
    stop(
      `${name} was made, and serves no terminal (see above), which with nobody at a computer is the only way in to it. Put that right and run this again.`,
    );

  const since = marker?.since ?? new Date().toISOString();
  const facts = {
    machine: name,
    adapter: adapter.key,
    since,
    ...(terminal ? { terminal: terminal.url } : {}),
  };
  // The provider that asked for the machine stays the one it was made for until another asks, and one
  // asking again is offered to its owner again (CLOUD-16).
  const asked =
    provider ?? readJson0(run(`cat "${clone}/${CLOUD_FILE}" 2>/dev/null`).stdout)?.provider ?? null;
  const onMachine = { here: true, ...facts, ...(asked ? { provider: asked } : {}) };
  run(
    `mkdir -p "${clone}/.claude/state" && printf %s ${quoted(JSON.stringify(onMachine))} > "${clone}/${CLOUD_FILE}"${provider ? `; rm -f "${clone}/${PROVIDER_FILE}"` : ''}`,
  );
  // A workflow's checkout is thrown away with its run: the machine's own marker is the one that lasts.
  if (unattended) {
    const waits = [host === 'github.com' && !pushesAs && 'GitHub', claudeWaits && 'Claude'].filter(
      Boolean,
    );
    io.say(`\n${name} is ready${waits.length ? ', and waits for its owner' : ''}.`);
    io.say(`Its terminal, in a browser: ${terminal.url}\n  ${terminal.gate}.`);
    if (waits.length)
      io.say(
        `A first visit there asks them to sign in to ${waits.join(' and to ')}, typed on the machine itself. code-kit reads neither sign-in.`,
      );
    const pairs = providerAdapterOf(asked);
    if (pairs?.adapter?.machine)
      io.say(
        `${waits.length ? 'It then offers' : 'A first visit there offers'} to pair ${name} with ${pairs.adapter.label}, at ${pairs.url}, which asked for it.`,
      );
    return;
  }
  writeMarker(main, facts);

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
  if (terminal)
    io.say(`Or open it in a browser, a phone's too: ${terminal.url}\n  ${terminal.gate}.`);
}

/**
 * CLOUD-12: the terminal's own page with code-kit's part put at the end of its body, or null when what
 * the terminal gave isn't a page.
 */
export function terminalPage(base, keys) {
  const at = String(base ?? '').lastIndexOf('</body>');
  return at < 0 ? null : `${base.slice(0, at)}${keys.trimEnd()}\n${base.slice(at)}`;
}

/**
 * CLOUD-12: the lead's session served as a terminal at the machine's own address, behind the platform's
 * sign-in: ttyd, with a page a phone can work in, started by the platform when a request comes (after a
 * sleep too) and running `cloud join` for each browser. Answers { url, gate }, or null having said why
 * there's no terminal; the project's move doesn't wait on it.
 */
function serveTerminal({ adapter, name, run, main, clone, io }) {
  if (!adapter.address || !adapter.serve) return null;
  const not = (why) => {
    io.say(`${name} serves no terminal in a browser yet: ${why}`);
    return null;
  };
  const again = 'Run `code-kit cloud up` again to try it.';
  const address = adapter.address(name);
  if (!address.ok)
    return not(`${adapter.label} didn't give its address (${address.why}). ${again}`);
  if (address.open) {
    adapter.unserve?.(name);
    return not(
      `its address is open to anyone who has it, and the lead's session would be too, so nothing is served there. Make the address private (${address.close}), then run \`code-kit cloud up\` again. To leave the address as it is, set "terminal": false in the config's "cloud".`,
    );
  }
  const found = () => run('command -v ttyd').stdout.trim().split('\n').pop();
  if (!found() && adapter.install) {
    io.say('Installing ttyd there, which serves the terminal.');
    adapter.install(name, ['ttyd']);
  }
  const ttyd = found();
  if (!ttyd)
    return not(
      `it has no ttyd, which serves it. Add its install to "cloud.prepare" in the config and run \`code-kit cloud up\` again.`,
    );
  // The page is ttyd's own, which only a running one gives: one is started on a spare port that nothing
  // outside the machine reaches, asked for it, and ended.
  const spare = TERMINAL_PORT + 1;
  const base = run(
    `"${ttyd}" -p ${spare} -i 127.0.0.1 true >/dev/null 2>&1 & T=$!; for i in $(seq 40); do curl -fs --compressed http://127.0.0.1:${spare}/ && break; sleep 0.25; done; kill $T 2>/dev/null; true`,
    { timeoutSeconds: 60 },
  ).stdout;
  const page = terminalPage(
    base,
    readFileSync(join(PLUGIN_ROOT, 'templates/cloud-terminal.html'), 'utf8'),
  );
  if (!page) return not(`ttyd there didn't give its page. ${again}`);
  // Full paths, and the environment the adapter's commands run in there, which a service isn't given.
  const [home, path, node] = run(
    `mkdir -p "${clone}/${CLOUD_DIR}" && printf '%s\\n%s\\n%s' "${clone}" "$PATH" "\${NODE_OPTIONS:-}"`,
  ).stdout.split('\n');
  if (!home || !path) return not(`the project's clone there couldn't be read. ${again}`);
  const temp = mkdtempSync(join(tmpdir(), 'code-kit-terminal-'));
  let sent;
  try {
    writeFileSync(join(temp, 'terminal.html'), page);
    sent = adapter.put(name, join(temp, 'terminal.html'), `${home}/${TERMINAL_PAGE}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  if (!sent.ok) return not(`its page couldn't be copied there (${sent.why}). ${again}`);
  const start = [
    '#!/bin/bash',
    "# code-kit (spec 32, CLOUD-12): what this machine's terminal runs for each browser that opens it.",
    `export PATH=${quoted(path)}`,
    ...(node ? [`export NODE_OPTIONS=${quoted(node)}`] : []),
    'export LANG="${LANG:-C.UTF-8}"',
    `( ${onMachine(home, 'cloud join')} ) && exit 0`,
    'echo',
    `read -r -p "The lead's session didn't open (see above). Press Enter to close this; Enter again tries once more. " _`,
    '',
  ].join('\n');
  const wrote = run(
    `printf %s ${quoted(start)} > "${home}/${TERMINAL_START}" && chmod +x "${home}/${TERMINAL_START}"`,
  );
  if (wrote.status !== 0) return not(`what it runs couldn't be written there. ${again}`);
  const served = adapter.serve(name, {
    command: ttyd,
    args: [
      ...['-p', String(TERMINAL_PORT), '-W', '-O'],
      ...['-I', `${home}/${TERMINAL_PAGE}`],
      ...['-t', `titleFixed=${folderOf(main)}`, '-t', 'disableLeaveAlert=true'],
      `${home}/${TERMINAL_START}`,
    ],
    dir: home,
    port: TERMINAL_PORT,
  });
  if (!served.ok) return not(`${adapter.label} couldn't serve it: ${served.why}. ${again}`);
  return { url: address.url, gate: address.gate };
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
function upMachine(root, config, { ready = true, unattended = false } = {}) {
  const cloud = cloudFor(config);
  const marker = readMarker(root);
  if (marker?.here) stop('This is the project on its machine; run this from your computer.');
  const found = {
    cloud,
    adapter: cloud.adapter,
    name: nameFor(root),
    clone: cloneOf(root),
    marker,
  };
  if (!ready || marker) return found;
  if (!unattended)
    stop("This project isn't on a cloud machine. Make its machine ready first: code-kit cloud up");
  // A workflow's checkout holds no marker (CLOUD-13): the machine says whether the project is on it.
  const there = cloud.adapter.state(found.name);
  if (!there.reachable) stop(`${cloud.adapter.label} didn't answer: ${there.why}`);
  if (
    !there.exists ||
    cloud.adapter.run(found.name, `test -f "${found.clone}/${CLOUD_FILE}"`).status !== 0
  )
    stop(
      `This repository has no machine yet${there.exists ? `: ${found.name} is there, and the project isn't on it` : ''}. Make it first: code-kit cloud up --unattended`,
    );
  return found;
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
export function cloudOpen(root, config, io, { unattended = false } = {}) {
  const { adapter, name, clone } = upMachine(root, config, { unattended });
  const run = (cmd, o) => adapter.run(name, cmd, o);
  if (unattended) {
    // Started by a workflow (CLOUD-13): the machine's own terminal is where its owner joins it, and
    // where they sign in first if they haven't (CLOUD-14). No session is started that couldn't work.
    const state = machineState(adapter, name, clone);
    if (state.problem) stop(`${name} didn't report: ${state.problem}.`);
    const at = state.terminal ? `its terminal: ${state.terminal}` : 'its terminal';
    const waits = [
      hostOf(remoteOf(mainOf(root)) ?? '') === 'github.com' && !state.github?.login && 'GitHub',
      !state.claude?.signedIn && 'Claude',
    ].filter(Boolean);
    if (waits.length) {
      io.say(
        `No session was started: ${name} waits for its owner to sign in to ${waits.join(' and to ')}, which they do at ${at}`,
      );
      return 0;
    }
    const { first } = startLead({ run, name, clone, io });
    io.say(
      first
        ? `It's the first session on ${name}, so Claude Code is waiting there at its first-run questions, which are its owner's to answer, at ${at}`
        : `It's running there with nobody attached. Its owner joins it at ${at}`,
    );
    return 0;
  }
  const { first } = startLead({ run, name, clone, io });
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

/**
 * CLOUD-12, on the machine: what its terminal in a browser runs. The lead's session there, started if
 * there's none, with the watcher beside it, and this terminal joined to it. With `attach` false the
 * session is started and left with nobody attached, which is how the provider the machine is paired with
 * starts one (CLOUD-16).
 */
export function cloudJoin(root, io, { attach = true } = {}) {
  const marker = readMarker(root);
  if (!marker?.here)
    stop(
      "`cloud join` runs on the project's machine, where its terminal in a browser starts it. From your computer, the lead's session there is: code-kit cloud open",
    );
  const run = (cmd) => {
    const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
    return {
      status: r.status,
      stdout: r.stdout ?? '',
      output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
    };
  };
  // A session already open is one its owner signed in for; with none, the sign-ins are looked at first,
  // and then the pairing with whoever asked for the machine.
  if (run(`tmux has-session -t ${LEAD_SESSION}`).status !== 0) {
    if (!ownerSignIns(mainOf(root), marker.machine, io)) return 1;
    providerPairing(mainOf(root), marker, io);
  }
  startLead({ run, name: marker.machine, clone: mainOf(root), io });
  if (!attach) return 0;
  // Closing the page leaves the session working; however this terminal's part in it ends, it opened.
  spawnSync('tmux', ['attach', '-t', LEAD_SESSION], { stdio: 'inherit' });
  return 0;
}

/** The provider a machine's marker says asked for it, where it's one that pairs with machines. */
function providerOf(marker) {
  const named = providerAdapterOf(marker?.provider ?? null);
  return named?.adapter?.machine && /^https:\/\//.test(named.url) ? named : null;
}

/**
 * CLOUD-16, on the machine: the pairing with the hosted provider that asked for it, offered to its owner
 * in its terminal once they've signed in. Pairing is the provider's own exchange with the person, typed
 * there: code-kit starts it and reads no credential of it. Nothing of the provider is installed until
 * they say yes. A machine that's paired keeps the provider's part running through its platform, so it's
 * there again when the machine wakes. Said no to, it's offered on the next visit, unless they say to stop.
 */
function providerPairing(main, marker, io) {
  const named = providerOf(marker);
  if (!named || !io.terminal) return;
  const { adapter, url } = named;
  const sh = (cmd) => {
    const r = spawnSync('bash', ['-c', cmd], { cwd: main, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout ?? '' };
  };
  if (!adapter.machine.session(sh)) {
    if (readJson(join(main, PROVIDER_FILE))?.never) return;
    io.say(
      `${marker.machine} was made at the asking of ${adapter.label}, at ${url}. ${adapter.machine.offer(url)}\n`,
    );
    if (!io.ask(`Pair ${marker.machine} with ${adapter.label} now?`)) {
      // A bare Enter is a no to both: nothing is paired, and nothing is silenced for good.
      const never = io.ask('Stop offering this on later visits?') === true;
      if (never) writeJson(join(main, PROVIDER_FILE), { never: true, url });
      io.say(
        never
          ? `Not paired, and it won't be offered here again. ${adapter.label} making the machine ready once more offers it again.\n`
          : 'Not paired. Your next visit offers it again.\n',
      );
      return;
    }
    const paired = adapter.machine.pair({
      url,
      name: marker.machine,
      workspace: dirname(main),
      remote: httpsRemote(remoteOf(main) ?? ''),
      typed: (cmd, args) => spawnSync(cmd, args, { cwd: main, stdio: 'inherit' }).status,
      sh,
    });
    if (!paired || !adapter.machine.session(sh)) {
      io.say(
        `\n${marker.machine} isn't paired with ${adapter.label} (see above). The lead's session opens without it, and your next visit offers the pairing again.\n`,
      );
      return;
    }
    io.say(`\n${marker.machine} is paired with ${adapter.label}.`);
  }
  // What the provider runs on the machine, kept by the platform. A service is given no environment, so
  // what it runs is a file that sets the one this terminal has.
  const service = adapter.machine.service(sh);
  const platform = machineAdapterOf({ [marker.adapter]: {} })?.adapter;
  if (!service) return;
  if (!platform?.keep) {
    io.say(
      `Nothing on ${marker.machine} keeps its part running: start it yourself with \`${[service.command, ...service.args].join(' ')}\`.\n`,
    );
    return;
  }
  const start = [
    '#!/bin/bash',
    `# code-kit (spec 32, CLOUD-16): what this machine keeps running for ${adapter.label}, which it's paired with.`,
    `export PATH=${quoted(process.env.PATH ?? '')}`,
    ...(process.env.NODE_OPTIONS
      ? [`export NODE_OPTIONS=${quoted(process.env.NODE_OPTIONS)}`]
      : []),
    'export LANG="${LANG:-C.UTF-8}"',
    `exec ${[service.command, ...service.args].map(quoted).join(' ')}`,
    '',
  ].join('\n');
  const file = join(main, PROVIDER_START);
  if (readText(file) !== start) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, start, { mode: 0o755 });
  }
  const kept = platform.keep({ key: 'provider', command: file, dir: main });
  if (!kept.ok)
    io.say(
      `${platform.label} couldn't keep ${adapter.label}'s part running on ${marker.machine} (${kept.why}), so nothing runs it yet. Your next visit tries again.\n`,
    );
  else if (kept.made)
    io.say(
      `Its part runs on ${marker.machine} from now on, and again whenever the machine wakes.\n`,
    );
}
const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * CLOUD-14, on the machine: the sign-ins only its owner can give, asked for in its terminal when one is
 * missing: GitHub's by its device sign-in, then Claude's by Claude Code's own. Each is the tool's own
 * exchange with the person, and code-kit reads neither credential. With GitHub's it sets the name and
 * email the machine commits as, where none is set, and fetches what the machine's first copy left out.
 * True when the machine is signed in to both.
 */
function ownerSignIns(main, name, io) {
  const asked = (cmd, args) => spawnSync(cmd, args, { cwd: main, encoding: 'utf8' });
  const typed = (cmd, args) => spawnSync(cmd, args, { cwd: main, stdio: 'inherit' }).status;
  const claudeIn = () => {
    try {
      const text = asked('claude', ['auth', 'status']).stdout;
      return JSON.parse(text.slice(text.indexOf('{'))).loggedIn === true;
    } catch {
      return false;
    }
  };
  const login = () => {
    const r = asked('gh', ['api', 'user', '-q', '.login']);
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const address = remoteOf(main) ?? '';
  const github = hostOf(address) === 'github.com' && !login();
  const claude = !claudeIn();
  if (!github && !claude) return true;
  if (!io.terminal) {
    io.say(
      `${name} waits for its owner to sign in to ${[github && 'GitHub', claude && 'Claude'].filter(Boolean).join(' and to ')}, which takes a terminal: open the machine's own in a browser.`,
    );
    return false;
  }
  io.say(
    `${name} is yours, and it needs ${github && claude ? 'two sign-ins' : 'a sign-in'} only you can give. Each is typed here, on the machine, and code-kit reads neither.\n`,
  );
  if (github) {
    io.say(
      `GitHub, so the machine can fetch and push the project's work. GitHub shows a one-time code below: enter it at https://github.com/login/device, signed in as the account this project is pushed as.\n`,
    );
    typed('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
    const who = login();
    if (!who) {
      io.say(`\nGitHub's sign-in didn't finish, so ${name} can't fetch or push yet.`);
      return false;
    }
    asked('gh', ['auth', 'setup-git', '--hostname', 'github.com']);
    const fetched = asked('git', ['fetch', '-q', 'origin']);
    if (fetched.status !== 0) {
      io.say(
        `\nSigned in to GitHub as ${who}, and ${httpsRemote(address)} couldn't be fetched as them: ${`${fetched.stderr ?? ''}`.trim().split('\n')[0] || `exit ${fetched.status}`}`,
      );
      if (io.ask(`Sign ${who} out here, to sign in as an account that can?`))
        typed('gh', ['auth', 'logout', '--hostname', 'github.com']);
      return false;
    }
    const set = (key) => asked('git', ['config', '--global', key]).stdout.trim();
    if (!set('user.name') || !set('user.email')) {
      const [id, account, full] = asked('gh', [
        ...['api', 'user', '-q'],
        '[.id, .login, .name // ""] | @tsv',
      ])
        .stdout.trim()
        .split('\t');
      if (id && account) {
        if (!set('user.name')) asked('git', ['config', '--global', 'user.name', full || account]);
        if (!set('user.email'))
          asked('git', [
            ...['config', '--global', 'user.email'],
            `${id}+${account}@users.noreply.github.com`,
          ]);
        io.say(
          `\nCommits made here are ${set('user.name')} <${set('user.email')}>. \`git config --global\` changes that.`,
        );
      }
    }
    io.say(`GitHub: signed in as ${who}.\n`);
  }
  if (claude) {
    io.say(
      `Claude, on your own subscription. Claude Code asks you to open an address in your browser and paste a code back.\n`,
    );
    typed('claude', ['auth', 'login']);
    if (!claudeIn()) {
      io.say(`\nClaude's sign-in didn't finish, so no session can work on ${name} yet.`);
      return false;
    }
    io.say('Claude: signed in.\n');
  }
  return true;
}

/** What a session is started with when the one before was ended at a question (CLOUD-7). */
const ASK_AGAIN =
  'code-kit ended this session while a question of yours waited for an answer, so the machine could sleep. The session is open again: ask that question again.';

/**
 * The lead's session on the machine, started if there's none, and the watcher beside it. `run` runs a
 * command there: through the adapter from the computer, or as it is on the machine itself. Answers
 * { first }: whether it's the machine's first session, which waits at Claude Code's own first-run
 * questions until the person answers.
 */
function startLead({ run, name, clone, io }) {
  if (run('command -v tmux').status !== 0)
    stop(
      `${name} has no tmux, which keeps the lead's session running when nobody is attached. Add its install to "cloud.prepare" in the config (such as "sudo apt-get install -y tmux") and run \`code-kit cloud up\`.`,
    );
  let first = false;
  if (run(`tmux has-session -t ${LEAD_SESSION}`).status !== 0) {
    const ended = readJson0(run(`cat "${clone}/${ENDED_FILE}" 2>/dev/null`).stdout);
    // The conversation an earlier session there left, which the new one continues: Claude Code keeps it
    // under the folder's path as the system gives it, with any link in it followed. No session is open,
    // so no tool call is running: what a killed one left noted as running is cleared with the start.
    const before =
      run(
        `ls "$HOME/.claude/projects/$(cd "${clone}" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"/*.jsonl >/dev/null 2>&1`,
      ).status === 0;
    // A question the last session was ended at went with it: the new one is told to ask it again.
    const again = before && ended?.asked === true;
    // On a machine paired with the provider that asked for it, the session is started so that the
    // provider sees it: the one session, whoever starts it (CLOUD-16).
    const seen = providerOf(
      readJson0(run(`cat "${clone}/${CLOUD_FILE}" 2>/dev/null`).stdout),
    )?.adapter.machine.session((cmd) => run(cmd));
    const claude = [
      ...(seen ? ['env', ...Object.entries(seen.env).map(([k, v]) => `${k}=${quoted(v)}`)] : []),
      'claude --permission-mode bypassPermissions',
      ...(seen ? seen.args.map(quoted) : []),
      ...(before ? ['--continue'] : []),
      ...(again ? [quoted(ASK_AGAIN)] : []),
    ].join(' ');
    const started = run(
      `rm -f "${clone}/${ENDED_FILE}"; rm -rf "${clone}/${ACTS_DIR}"; mkdir -p "${clone}/${CLOUD_DIR}" && touch "${clone}/${LAST_FILE}" && tmux new-session -d -s ${LEAD_SESSION} -c "${clone}" ${quoted(claude)}`,
    );
    if (started.status !== 0)
      stop(`The lead's session couldn't be started on ${name}: ${started.output}`);
    first = !before;
    io.say(
      ended
        ? `The last session there ${ended.why}. Started a new one, which continues its conversation${again ? ' and asks its question again' : ''}.`
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
  return { first };
}
const readJson0 = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** CLOUD-7: ends the lead's session on the machine now, so it sleeps. Asks first while lanes work. */
export function cloudStop(root, config, io, { unattended = false } = {}) {
  const { adapter, name, clone } = upMachine(root, config, { unattended });
  const state = machineState(adapter, name, clone);
  const running = state.running ?? [];
  if (running.length) {
    const what = running.map((r) => `${r.story ?? 'a story'} in the ${r.lane} lane`).join(', ');
    const yes = io.ask(
      `${what} ${running.length === 1 ? 'is' : 'are'} working there. End the session anyway?`,
    );
    if (yes === null)
      stop(
        `${what} ${running.length === 1 ? 'is' : 'are'} working on ${name}. Ending the session stops ${running.length === 1 ? 'it' : 'them'} mid-story, so it's the person's to confirm: ${unattended ? 'its owner ends it at its terminal, or stops it again once the work has merged.' : 'ask them to run `code-kit cloud stop` in their own terminal.'}`,
      );
    if (!yes) stop('Left running.');
  }
  // A question it was stopped at goes with it, so the next session asks it again.
  const ended = {
    at: new Date().toISOString(),
    why: 'was stopped from your computer',
    ...(state.activity?.asking ? { asked: true } : {}),
  };
  adapter.run(
    name,
    `mkdir -p "${clone}/${CLOUD_DIR}" && printf %s ${quoted(JSON.stringify(ended))} > "${clone}/${ENDED_FILE}"; tmux kill-session -t ${WATCH_SESSION} 2>/dev/null; ${END_SESSIONS}`,
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
export function cloudDown(root, config, io, { discard = false, unattended = false } = {}) {
  // A workflow's checkout holds no marker (CLOUD-13): whether there's a machine is the platform's to say.
  const { adapter, name, clone } = upMachine(root, config, { ready: !unattended });
  const platform = adapter.state(name);
  if (!platform.reachable) stop(`${adapter.label} didn't answer: ${platform.why}`);
  if (platform.exists) {
    const state = machineState(adapter, name, clone);
    const held = state.problem
      ? [`The machine couldn't say what it holds: ${state.problem}.`]
      : heldThere(state);
    if (held.length && !discard)
      stop(
        `Nothing was removed. ${name} holds work that isn't on the remote, which removing it would lose:\n${held.map((h) => `  ${h}`).join('\n')}\n${unattended ? "Its owner finishes and pushes it at the machine's terminal. To remove the machine with what's on it, they run the workflow's down with discard." : "Finish and push it from the machine (code-kit cloud open). To remove the machine with what's on it, the person runs: code-kit cloud down --discard"}`,
      );
    if (held.length) {
      io.say(`Removing ${name} loses:\n${held.map((h) => `  ${h}`).join('\n')}`);
      // A workflow's discard was the person's own choice where they started it; nobody is here to ask.
      if (!unattended && io.ask('Remove it anyway?') !== true) stop('Nothing was removed.');
    }
    adapter.run(name, `tmux kill-session -t ${WATCH_SESSION} 2>/dev/null; ${END_SESSIONS}`, {
      timeoutSeconds: 60,
    });
    const gone = adapter.release(name);
    if (!gone.ok) stop(`${name} couldn't be removed: ${gone.why}`);
  }
  clearMarker(root);
  io.say(
    `${platform.exists ? `Removed ${name}, with the sign-ins on it` : `${name} was already gone`}. ${unattended ? 'Nothing of the project is on a machine now.' : 'The project is on this computer again: git pull to bring in what was pushed from the machine.'}`,
  );
}

/**
 * CLOUD-8: where the project's work is and what its machine is doing, for `cloud` to print:
 * { platform, name, up, since, terminal, exists, sessions, state } where `state` is the machine's own report.
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
    terminal: marker?.terminal ?? null,
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

/** Claude Code's tool calls that wait on the person: a question to them, and a plan for them to approve. */
const ASKS = ['AskUserQuestion', 'ExitPlanMode'];
export const asksPerson = (tool) => ASKS.includes(tool);
const ASKING = '.asks';

/**
 * A tool call starting or ending in the project on its machine, for the watcher (CLOUD-7). One that
 * `asks` the person is noted apart: it's open until they answer, and nothing works while it is.
 */
export function noteAct(root, id, mode, { session = null, agent = null, asks = false } = {}) {
  const main = mainOf(root);
  if (!isMachine(main)) return;
  try {
    mkdirSync(join(main, ACTS_DIR), { recursive: true });
    const file = join(
      main,
      ACTS_DIR,
      `${actOwner(session, agent)}.${createHash('sha256').update(String(id)).digest('hex').slice(0, 24)}`,
    );
    if (mode === 'start') writeFileSync(`${file}${asks ? ASKING : ''}`, '');
    else for (const f of [file, `${file}${ASKING}`]) rmSync(f, { force: true });
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

/**
 * When anything last moved in the project, the tool calls still running, and those that wait on the
 * person's answer: { last, open, asking }.
 */
export function activityOf(root, now = Date.now()) {
  const main = mainOf(root);
  let last = null;
  try {
    last = statSync(join(main, LAST_FILE)).mtimeMs;
  } catch {
    last = null;
  }
  let open = 0;
  let asking = 0;
  try {
    for (const f of readdirSync(join(main, ACTS_DIR))) {
      if (f.endsWith(ASKING)) asking++;
      else if (now - statSync(join(main, ACTS_DIR, f)).mtimeMs < ACT_STALE_MS) open++;
    }
  } catch {
    open = 0;
    asking = 0;
  }
  return { last, open, asking };
}

/**
 * CLOUD-7: whether the lead's session should be ended now: nothing running, nothing merging, and no tool
 * call or prompt for `idleMinutes`. A question to the person is a tool call too, open until they answer,
 * and it's no work: one that has waited `idleMinutes` ends the session like any other quiet, and `asked`
 * says so, for the next session to ask it again. `{ end, idleMinutes, asked, why }`.
 */
export function idleVerdict({ idleMinutes, last, open, asking = 0, running, merging, since, now }) {
  const quiet = Math.floor((now - Math.max(last ?? 0, since)) / 60_000);
  if (open > 0) return { end: false, idleMinutes: 0, why: `${plural(open, 'tool call')} running` };
  if (running > 0) return { end: false, idleMinutes: 0, why: `${plural(running, 'lane')} working` };
  if (merging) return { end: false, idleMinutes: 0, why: 'the queue is merging' };
  const asked = asking > 0;
  if (quiet < idleMinutes)
    return {
      end: false,
      idleMinutes: quiet,
      why: asked
        ? `its question has waited ${quiet} of ${idleMinutes} minutes for an answer`
        : `${quiet} of ${idleMinutes} idle minutes`,
    };
  return {
    end: true,
    idleMinutes: quiet,
    asked,
    why: asked
      ? `was ended after its question waited ${idleMinutes} minutes for an answer`
      : `was ended after ${idleMinutes} idle minutes`,
  };
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
    terminal: readMarker(main)?.terminal ?? null,
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
      asking: activity.asking,
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
 * counts the awake time and, when nothing has moved for `idleMinutes`, a question left unanswered that
 * long included, ends the lead's session, lets go of the hold and stops, so the machine sleeps. A watcher
 * that dies leaves a hold that runs out by itself.
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
      writeJson(join(main, ENDED_FILE), {
        at: new Date(now).toISOString(),
        why: verdict.why,
        ...(verdict.asked ? { asked: true } : {}),
      });
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
