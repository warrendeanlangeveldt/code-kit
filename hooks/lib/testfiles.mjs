// What counts as a test (docs/specs/18-regression.md), in one place for every check that asks: a fix's
// proof (REG-1), weakened tests (REG-2), the tests that name a requirement, the code map's tests layer,
// what the security review leaves out and which files are screens. A project's `tests` globs replace
// the conventions; without them, a file is a test when it's named as one or sits in a test folder.
import { matchesAny } from './glob.mjs';

// Named as a test: `*.test.*`, `*.spec.*`, `*.smoke.*`, `test_*.py`, `*_test.go` and `*_test.py`.
const NAMED = /\.(test|spec|smoke)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
// Inside a test folder, where a test's helpers, fixtures and harness live too.
const FOLDER = /(^|\/)(tests?|__tests__|e2e|smoke)\//;

/** Whether `rel` is a test or test code: the config's `tests` globs, or named as a test or in a test folder. */
export const isTestFile = (rel, config) =>
  !rel.endsWith('.md') &&
  (config?.tests?.length ? matchesAny(rel, config.tests) : NAMED.test(rel) || FOLDER.test(rel));

/**
 * Whether `rel` is a test itself, by its name, and not a helper beside one: the config's `tests` globs,
 * or the naming conventions. A fix's proof keeps these and takes everything else back (REG-1).
 */
export const isNamedTest = (rel, config) =>
  !rel.endsWith('.md') && (config?.tests?.length ? matchesAny(rel, config.tests) : NAMED.test(rel));
