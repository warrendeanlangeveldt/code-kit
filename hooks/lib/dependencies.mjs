// New dependencies: which packages a shell command adds, and which files installing them changes.
// Each package needs a person's approval (`dep-<package>`), which also covers those files.
import { basename } from 'node:path';
import { commandsOf } from './shell.mjs';

// What installing a package rewrites: manifests and lockfiles, wherever they sit.
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'uv.lock',
  'poetry.lock',
  'Pipfile',
  'Pipfile.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Gemfile',
  'Gemfile.lock',
]);

export const isDependencyFile = (rel) => DEPENDENCY_FILES.has(basename(rel));

export const DEPENDENCY_APPROVAL = 'dep-';

/** The approval a package needs: `dep-<name>`, with `/` as `+` so a scoped name stays one file. */
export const dependencyApproval = (pkg) =>
  `${DEPENDENCY_APPROVAL}${pkg.replace(/\//g, '+').replace(/[^\w.@+-]/g, '_')}`;

const js = (name) => name.replace(/(?<=.)@.*$/, ''); // lodash@4, @scope/pkg@^1
const py = (name) => name.split(/[[<>=!~;\s]/)[0]; // httpx>=0.27, requests[socks]
const at = (name) => name.replace(/@.*$/, ''); // serde@1, example.com/m@v1

// Each package manager: the subcommands that add packages, the flags that take a value (so the value
// isn't read as a package), the words that take one argument before the subcommand, and how a version
// is written onto a name.
const MANAGERS = {
  npm: {
    adds: ['install', 'i', 'add', 'in'],
    values: ['--workspace', '-w', '--prefix', '--registry', '--tag', '--save-prefix'],
    name: js,
  },
  pnpm: {
    adds: ['add', 'install', 'i'],
    values: ['--filter', '-F', '--dir', '-C', '--registry', '--save-prefix'],
    name: js,
  },
  yarn: { adds: ['add'], values: ['--cwd', '--registry'], before: ['workspace'], name: js },
  bun: { adds: ['add', 'install', 'i'], values: ['--cwd', '--registry'], name: js },
  pip: {
    adds: ['install'],
    values: [
      '-r',
      '--requirement',
      '-c',
      '--constraint',
      '-e',
      '--editable',
      '-i',
      '--index-url',
      '--extra-index-url',
      '-f',
      '--find-links',
      '-t',
      '--target',
      '--prefix',
      '--root',
    ],
    name: py,
    local: ['.'],
  },
  uv: { adds: ['add'], values: ['--group', '--optional', '--package', '--directory'], name: py },
  poetry: { adds: ['add'], values: ['--group', '-G', '--directory', '-C'], name: at },
  cargo: {
    adds: ['add'],
    values: ['--features', '-F', '--package', '-p', '--path', '--git', '--rename'],
    name: at,
  },
  go: { adds: ['get'], values: [], name: at },
  bundle: { adds: ['add'], values: ['--version', '-v', '--group', '-g', '--source'], name: at },
};
MANAGERS.pip3 = MANAGERS.pip;

/**
 * The packages `cmd` adds as dependencies, in order: none for a bare install or a requirements file.
 * Only the commands it runs count: quoted text and heredoc bodies are data (an echo, a commit message),
 * except a shell's `-c` script, which runs.
 */
export function addedPackages(cmd) {
  return [...new Set(packagesWithManagers(cmd).map((p) => p.name))];
}

/** The package managers that read the npm registry: their packages are npm's. */
const NPM_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * HELM-3: the registry `pkg` comes from, by the command that adds it: `npm` for npm, pnpm, yarn and
 * bun, otherwise the manager's name (`pip`, `uv`, `cargo`…), or null when the command doesn't add it.
 */
export function ecosystemOf(cmd, pkg) {
  const found = packagesWithManagers(cmd).find((p) => p.name === pkg);
  if (!found) return null;
  return NPM_MANAGERS.has(found.manager) ? 'npm' : found.manager;
}

/** Each package `cmd` adds, with the manager that adds it: `{ name, manager }`. */
function packagesWithManagers(cmd) {
  const found = [];
  for (const { text, code } of commandsOf(cmd)) {
    // Words split where the quote-masked code has spaces, so a quoted word stays one word.
    const words = [...code.matchAll(/\S+/g)].map((m) => ({
      quoted: /^["']/.test(m[0]),
      word: text.slice(m.index, m.index + m[0].length).replace(/^["']|["']$/g, ''),
    }));
    // What a container installs is the container's: the project's manifests don't change, and a
    // mounted project whose manifests do is still held to its dependency approvals when committed.
    if (CONTAINERS.has(basename(words[0]?.word ?? ''))) continue;
    words.forEach(({ word, quoted }, i) => {
      if (quoted) return;
      if (SHELLS.has(basename(word)) && words[i + 1]?.word === '-c' && words[i + 2])
        found.push(...packagesWithManagers(words[i + 2].word));
      const manager = MANAGERS[basename(word)];
      if (manager)
        found.push(
          ...packagesAfter(
            words.slice(i + 1).map((w) => w.word),
            manager,
          ).map((name) => ({ name, manager: basename(word).replace(/3$/, '') })),
        );
    });
  }
  return found;
}

const SHELLS = new Set(['sh', 'bash', 'zsh']);
const CONTAINERS = new Set(['docker', 'podman', 'nerdctl']);

// The words after a package manager's name: its subcommand must be one that adds packages, and the
// words after that, other than flags and their values, are the packages.
function packagesAfter(words, manager) {
  let i = 0;
  const skipFlag = () => {
    const word = words[i++];
    if (manager.values.includes(word)) i++;
  };
  while (i < words.length && words[i].startsWith('-')) skipFlag();
  if (manager.before?.includes(words[i])) i += 2; // yarn workspace <name> add …
  while (i < words.length && words[i].startsWith('-')) skipFlag();
  if (!manager.adds.includes(words[i])) return [];
  i++;
  const packages = [];
  while (i < words.length) {
    if (words[i].startsWith('-')) skipFlag();
    // a redirect ends the arguments
    else if (/^[>&<]|^\d*>/.test(words[i])) break;
    else {
      const word = words[i++];
      if (!manager.local?.includes(word)) packages.push(manager.name(word));
    }
  }
  return packages.filter(Boolean);
}
