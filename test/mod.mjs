// Runs the mod's own tests (hooks/mod/*.test.ts) with `claude plugin test`, which needs Claude Code
// 2.1.287 or later. Where that isn't installed, it says so and skips them; the mod's drawing is also
// tested with node in units.test.mjs, and the CLI it reads in hooks.test.mjs.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NEEDS = [2, 1, 287];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = spawnSync('claude', ['--version'], { encoding: 'utf8' });
const found = v.status === 0 ? v.stdout.match(/(\d+)\.(\d+)\.(\d+)/) : null;
const parts = found ? found.slice(1).map(Number) : null;
const newEnough = parts && parts.reduce((cmp, n, i) => cmp || Math.sign(n - NEEDS[i]), 0) >= 0;
if (!newEnough) {
  process.stdout.write(
    `skip the mod's tests: they need Claude Code ${NEEDS.join('.')} or later (${found ? `found ${found[0]}` : 'claude not found'})\n`,
  );
  process.exit(0);
}
const run = spawnSync('claude', ['plugin', 'test', root], { stdio: 'inherit' });
process.exit(run.status ?? 1);
