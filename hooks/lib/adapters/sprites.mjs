// Fly's Sprites as a machine adapter (code-kit spec 32, CLOUD-11): chosen by `"cloud": { "sprites": {} }`.
// It works through the `sprite` command the person installed and signed in to, in the organisation that
// sign-in selects, and never reads its token. Nothing outside this folder names it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
        cmd,
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
  put(name, file, to) {
    const r = sprite([
      'exec',
      '-s',
      name,
      '--no-stdin',
      '--no-port-forward',
      '--file',
      `${file}:${to}`,
      '--',
      'true',
    ]);
    return { ok: r.status === 0, why: r.status === 0 ? null : firstLine(r) };
  },
  /** The person's terminal joined to a command on the Sprite, until it ends or they detach. */
  terminal(name, cmd, { cwd = null } = {}) {
    const r = sprite(
      ['exec', '-s', name, '--tty', ...(cwd ? ['--dir', cwd] : []), '--', 'bash', '-c', cmd],
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
  release(name) {
    const have = listed();
    if (have === null) return { ok: false, why: firstLine(sprite(['list'])) };
    if (!have.includes(name)) return { ok: true, gone: true };
    const r = sprite(['destroy', '--force', name]);
    return { ok: r.status === 0, why: r.status === 0 ? null : firstLine(r) };
  },
};
