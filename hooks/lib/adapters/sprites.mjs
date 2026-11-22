// Fly's Sprites as a machine adapter (code-kit spec 32, CLOUD-11): chosen by `"cloud": { "sprites": {} }`.
// It works through the `sprite` command the person installed and signed in to, in the organisation that
// sign-in selects, and never reads its token. Nothing outside this folder names it.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Fly's installer puts the command in ~/.local/bin, which a shell opened before the install doesn't
// have on its PATH yet.
const INSTALLED_AT = join(homedir(), '.local', 'bin', 'sprite');
function command() {
  if (spawnSync('sprite', ['--help'], { stdio: 'ignore' }).error?.code !== 'ENOENT')
    return 'sprite';
  return existsSync(INSTALLED_AT) ? INSTALLED_AT : null;
}
const sprite = (args, opts = {}) =>
  spawnSync(command() ?? 'sprite', args, { encoding: 'utf8', ...opts });
const said = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
const firstLine = (r) => said(r).split('\n')[0] || (r.error ? String(r.error.message) : '');

// A Sprite's own management socket, and the one hold code-kit keeps through it.
const SOCKET = '/.sprite/api.sock';
const HOLD = 'http://sprite/v1/tasks/code-kit';
function task(method, body = null) {
  const r = spawnSync(
    'curl',
    [
      ...['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10'],
      ...['--unix-socket', SOCKET, '-X', method],
      ...(body ? ['-H', 'Content-Type: application/json', '-d', JSON.stringify(body)] : []),
      HOLD,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0 && /^2\d\d$/.test(r.stdout.trim());
}

// A Sprite's hosts file gives `localhost` the Sprite's own network address ahead of the loopback one,
// and Node takes the first: a dev server told to listen on `localhost` listens where no browser on the
// Sprite looks for it, and a project's browser tests find nothing there. With IPv4 first it listens on
// 127.0.0.1, which the browser and the platform's port forwarding both reach. Every command code-kit
// runs on a Sprite starts with this, and what it starts there inherits it; a project's own setting stays.
const ON_SPRITE =
  'case " ${NODE_OPTIONS:-} " in *" --dns-result-order="*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" ;; esac; ';

/** The one service code-kit keeps on a Sprite: the terminal its address serves. */
const SERVICE = 'code-kit-terminal';

/** The Sprites the sign-in's organisation holds, or null when the platform can't be asked. */
function listed() {
  const r = sprite(['list']);
  if (r.status !== 0) return null;
  return r.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n ?? ''));
}

/** The open sessions `sprite sessions list` prints: [{ id, command, started }]. */
export function sessionsOf(text) {
  const lines = String(text).split('\n');
  const rule = lines.findIndex((l) => /^[─-]{5,}/.test(l.trim()));
  if (rule < 1) return [];
  const header = lines[rule - 1];
  const at = (name) => header.indexOf(name);
  const cols = ['ID', 'Command', 'Workdir', 'Started', 'Activity'].map(at);
  if (cols.some((c) => c < 0)) return [];
  const cell = (line, i) => line.slice(cols[i], cols[i + 1] ?? undefined).trim();
  const found = [];
  for (const line of lines.slice(rule + 1)) {
    if (!line.trim()) break;
    found.push({ id: cell(line, 0), command: cell(line, 1), started: cell(line, 3) });
  }
  return found.filter((s) => s.id);
}

export default {
  key: 'sprites',
  label: 'Sprites',
  options: [],
  /** What the platform needs on the computer (CLOUD-2): its command line, and a sign-in to it. */
  needs() {
    const installed = command() !== null;
    return [
      {
        what: 'the `sprite` command',
        have: installed,
        command: 'curl -fsSL https://sprites.dev/install.sh | sh',
        from: "Fly's own installer at sprites.dev, which checks the download against its SHA-256 and puts `sprite` in ~/.local/bin",
      },
      {
        what: 'a sign-in to Sprites',
        have: installed && listed() !== null,
        command: `${command() ?? 'sprite'} login`,
        from: 'the `sprite` command, which opens your browser to sign in to Fly',
        terminal: true,
      },
    ];
  },
  /** The project's Sprite, made if it wasn't there, with what its image would get wrong put right. */
  ready(name) {
    const have = listed();
    if (have === null)
      return { ok: false, why: `Sprites didn't answer: ${firstLine(sprite(['list']))}` };
    let made = false;
    if (!have.includes(name)) {
      const r = sprite(['create', '--skip-console', name]);
      if (r.status !== 0)
        return { ok: false, why: `Sprites couldn't make ${name}: ${firstLine(r)}` };
      made = true;
    }
    // The image's global git ignore leaves .env.*, build/, dist/ and target/ out of commits made there.
    const fixed = this.run(name, 'git config --global core.excludesFile /dev/null');
    if (fixed.status !== 0)
      return { ok: false, why: `${name} was made, and didn't answer a command: ${fixed.output}` };
    return { ok: true, made };
  },
  run(name, cmd, { cwd = null, timeoutSeconds = 120, inherit = false } = {}) {
    const r = sprite(
      [
        'exec',
        '-s',
        name,
        '--no-stdin',
        '--no-port-forward',
        ...(cwd ? ['--dir', cwd] : []),
        '--',
        'bash',
        '-c',
        `${ON_SPRITE}${cmd}`,
      ],
      {
        timeout: timeoutSeconds * 1000,
        maxBuffer: 64 * 1024 * 1024,
        ...(inherit ? { stdio: ['ignore', 'inherit', 'inherit'] } : {}),
      },
    );
    const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
    return {
      status: r.status,
      timedOut,
      stdout: r.stdout ?? '',
      output: said(r) || (r.error ? String(r.error.message) : ''),
    };
  },
  /** A file sent as the input of a command there. The platform's own file upload is one request that
   * it ends after 30 seconds, which a file of a few hundred megabytes doesn't fit in. */
  put(name, file, to) {
    let from;
    try {
      from = openSync(file, 'r');
    } catch (e) {
      return { ok: false, why: String(e.message) };
    }
    try {
      const r = sprite(
        [
          'exec',
          '-s',
          name,
          '--stdin',
          '--no-port-forward',
          '--',
          'bash',
          '-c',
          'cat > "$0" && wc -c < "$0"',
          to,
        ],
        { stdio: [from, 'pipe', 'pipe'] },
      );
      if (r.status !== 0) return { ok: false, why: firstLine(r) };
      const arrived = Number(r.stdout.trim().split('\n').pop());
      const sent = fstatSync(from).size;
      return arrived === sent
        ? { ok: true, why: null }
        : { ok: false, why: `${arrived || 0} of its ${sent} bytes arrived` };
    } finally {
      closeSync(from);
    }
  },
  /**
   * The Sprite's own address, and whether it's open to anyone who has it. Fly's sign-in stands in front
   * of an address set to `sprite`, which is how a Sprite is made; one the person made `public` isn't
   * asked about, and anything else the platform says of it is read as open.
   */
  address(name) {
    const r = sprite(['info', '-s', name]);
    const url = r.stdout?.match(/^URL:\s*(\S+)/m)?.[1];
    if (r.status !== 0 || !url) return { ok: false, why: firstLine(r) || 'it named no address' };
    return {
      ok: true,
      url,
      open: r.stdout.match(/^Auth:\s*(\S+)/m)?.[1] !== 'sprite',
      gate: 'Fly asks who you are first, and lets in only people in the organisation the machine is in',
      close: `sprite config update --url-auth sprite -s ${name}`,
    };
  },
  /** Packages the Sprite's image lacks, from Ubuntu's own archive, which its user may install from. */
  install(name, packages) {
    const get = `sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dpkg::Use-Pty=0 ${packages.join(' ')}`;
    const r = this.run(name, `${get} || { sudo -n apt-get update && ${get}; }`, {
      timeoutSeconds: 600,
      inherit: true,
    });
    return { ok: r.status === 0 };
  },
  /**
   * A command the platform keeps as a service and routes the Sprite's address to: a request to the
   * address starts it, after a sleep too. A Sprite routes its address to one port, so one service holds
   * it, and code-kit's is put in place of its own earlier one only.
   */
  serve(name, { command, args, dir, port }) {
    if ([command, dir, ...args].some((a) => /[,\s'"]/.test(String(a))))
      return {
        ok: false,
        why: 'a path in it holds a comma, a space or a quote, which a service on a Sprite is given none of',
      };
    const r = this.run(
      name,
      `sprite-env services delete ${SERVICE} >/dev/null 2>&1; sprite-env services create ${SERVICE} --cmd ${command} --args ${args.join(',')} --dir ${dir} --http-port ${port} --no-stream`,
      { timeoutSeconds: 60 },
    );
    return r.status === 0
      ? { ok: true, why: null }
      : { ok: false, why: r.output.split('\n').filter(Boolean).pop() || `exit ${r.status}` };
  },
  /** That service taken away, so the address goes back to what the Sprite routed it to before. */
  unserve(name) {
    return { ok: this.run(name, `sprite-env services delete ${SERVICE}`).status === 0 };
  },
  /** The person's terminal joined to a command on the Sprite, until it ends or they detach. */
  terminal(name, cmd, { cwd = null } = {}) {
    const r = sprite(
      [
        'exec',
        '-s',
        name,
        '--tty',
        ...(cwd ? ['--dir', cwd] : []),
        '--',
        'bash',
        '-c',
        `${ON_SPRITE}${cmd}`,
      ],
      { stdio: 'inherit' },
    );
    return r.status ?? 1;
  },
  /** Whether the Sprite is there, and the platform's sessions open on it. The status the platform
   * reports reads `cold` whether the Sprite is awake or not, so it isn't used. */
  state(name) {
    const have = listed();
    if (have === null) return { reachable: false, why: firstLine(sprite(['list'])) };
    if (!have.includes(name)) return { reachable: true, exists: false, sessions: [] };
    const r = sprite(['sessions', 'list', '-s', name]);
    return { reachable: true, exists: true, sessions: r.status === 0 ? sessionsOf(r.stdout) : [] };
  },
  /**
   * Run on the Sprite itself: keeps it running for this many seconds more. A Sprite nobody is connected
   * to is paused about half a minute after its last request, whatever is working on it, and a task held
   * through its own management socket is what the platform gives to prevent that. One hold lasts an
   * hour at most, so it's asked for again while the work goes on.
   */
  stayAwake(seconds) {
    return task('PUT', { expire: Math.min(Math.max(Math.round(seconds), 1), 3600) });
  },
  /** Run on the Sprite itself: lets go of the hold, so it's paused once nothing is connected. */
  maySleep() {
    return task('DELETE');
  },
  release(name) {
    const have = listed();
    if (have === null) return { ok: false, why: firstLine(sprite(['list'])) };
    if (!have.includes(name)) return { ok: true, gone: true };
    const r = sprite(['destroy', '--force', name]);
    return { ok: r.status === 0, why: r.status === 0 ? null : firstLine(r) };
  },
};
