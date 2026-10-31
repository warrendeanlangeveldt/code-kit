// ONB-7: which branches the security reviewer looks at. Security is a reviewer, not a lane: it owns no
// paths and checks everyone's work. A story's change gets the security review when it touches sign-in,
// permissions, outside input, personal data, encryption, payments, secrets or commands built from
// strings, adds dependencies, or cites a requirement from a spec's `## Security requirements`. Read
// from git (base...branch): the files changed and the lines added, tests and docs left out.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDependencyFile } from './dependencies.mjs';
import { markdownFiles, readStories } from './plan.mjs';
import { storyOfBranch } from './teamfacts.mjs';

export const SECURITY_AGENT = 'security-reviewer';
export const SECURITY_AGENT_FILE = `.claude/agents/${SECURITY_AGENT}.md`;

// Tests, docs and design files describe the change; the review looks at the code that ships.
const NOT_SHIPPED =
  /(^|\/)(tests?|__tests__|e2e|docs?|design)\/|\.(test|spec|stories)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|\.(md|mdx|txt|png|jpe?g|gif|svg|webp)$/i;

/**
 * What makes a change sensitive, by kind: `path` matches a changed file's path, `code` (one pattern or
 * several) an added line.
 * Each kind reads as the reason a person is given.
 */
export const SENSITIVE = [
  {
    kind: 'sign-in',
    why: 'sign-in or sessions',
    path: /(^|[/_.-])(auth\w*|login|logout|sign-?in|sign-?up|sessions?|oauth|sso|jwt|passwords?|mfa|otp)([/_.-]|$)/i,
    code: /\b(signIn|signOut|login|logout|getSession|setSession|jwt\.(sign|verify)|jsonwebtoken|passport\.|bcrypt|argon2|verifyPassword|hashPassword|Set-Cookie|cookies\(\)|httpOnly)\b/,
  },
  {
    kind: 'permissions',
    why: 'permissions',
    path: /(^|[/_.-])(permissions?|roles?|rbac|acl|polic(y|ies)|guards?|middleware|authori[sz]\w*)([/_.-]|$)/i,
    code: [
      /\b(isAdmin|hasRole|hasPermission|can[A-Z]\w*|[Aa]uthori[sz]e\w*|requireRole)\b/,
      /\b(enable row level security|create policy|grant\s+\w+\s+on)\b/i,
    ],
  },
  {
    kind: 'input',
    why: 'input from outside (requests, forms, uploads, webhooks)',
    path: /(^|[/_.-])(webhooks?|uploads?|handlers?)([/_.-]|$)|(^|\/)(api|routes?)\/|(^|\/)route\.[jt]s$/i,
    code: /\b(req\.(body|query|params|files?)|request\.(json|form|args|body)\(?|formData\(\)|searchParams|FormData|multer|busboy|ctx\.request\.body|@Body\(|@Query\(|@Param\()/,
  },
  {
    kind: 'personal data',
    why: 'personal data',
    path: /(^|[/_.-])(users?|profiles?|accounts?|customers?|patients?|members?|children|students?|contacts?)([/_.-]|$)/i,
    code: /\b(email|phone(_?number)?|date_?of_?birth|dob|home_?address|street_?address|passport|tax_?file|national_?id|medicare|ssn|first_?name|last_?name|full_?name)\b/i,
  },
  {
    kind: 'encryption',
    why: 'encryption, hashing or random values',
    path: /(^|[/_.-])(crypto|encrypt\w*|decrypt\w*|ciphers?|hash(ing)?|keys?|kms|signing)([/_.-]|$)/i,
    code: /\b(createCipheriv|createDecipheriv|createHash|createHmac|randomBytes|Math\.random|crypto\.subtle|md5|sha1|AES|RSA|hashlib|Fernet)\b/,
  },
  {
    kind: 'payments',
    why: 'payments',
    path: /(^|[/_.-])(payments?|billing|checkout|invoices?|stripe|subscriptions?|refunds?|payouts?|wallet)([/_.-]|$)/i,
    code: /\b(stripe|paymentIntent|checkout\.sessions|charge|refund|payout|amount_?cents)\b/i,
  },
  {
    kind: 'secrets',
    why: 'secrets or credentials',
    path: /(^|\/)\.env(\.|$)|(^|[/_.-])(secrets?|credentials?|tokens?)([/_.-]|$)/i,
    code: /\b(api_?key|secret_?key|client_?secret|private_?key|access_?token|refresh_?token|password\s*[:=])/i,
  },
  {
    kind: 'injection',
    why: 'queries, commands, templates or redirects built from strings',
    code: /(\$queryRawUnsafe|\$executeRawUnsafe|\.raw\(|sql\.unsafe|execute\(\s*[`'"]?\s*(select|insert|update|delete)\b.*(\$\{|\+)|child_process|\bexec(Sync)?\(|\bspawn(Sync)?\(|subprocess\.|os\.system|\beval\(|new Function\(|dangerouslySetInnerHTML|\.innerHTML\s*=|v-html|\{\{\{|pickle\.loads|yaml\.load\(|unserialize\(|res\.redirect\(|redirect\(\s*(req|request|params|searchParams)|fetch\(\s*(req|request|params|body|url)\b)/i,
  },
];

/**
 * The requirement IDs of each spec's `## Security requirements` section (spec-design writes a spec's
 * security requirements there, as `### AREA-n` headings like any other requirement).
 */
export function securityRequirementIds(texts) {
  const ids = new Set();
  for (const text of texts) {
    let inSecurity = false;
    for (const line of text.split('\n')) {
      if (/^##\s/.test(line)) inSecurity = /^##\s+Security requirements\b/i.test(line);
      const m = inSecurity && line.match(/^###\s+((?!ST-)[A-Z][A-Z0-9]*-\d+)\b/);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

/** Added lines of a unified diff (`git diff -U0`): [{ file, line, text }]. */
export function addedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (l.startsWith('+')) added.push({ file, line: line++, text: l.slice(1) });
    else if (l.startsWith(' ')) line++;
  }
  return added;
}

const examples = (list) =>
  `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;

/**
 * Why a change needs the security review, in words, one per kind: [{ kind, why, where: [...] }].
 * Empty when it touches nothing sensitive. `files` are the changed files, `added` the added lines,
 * `cites` the story's requirements and `security` the IDs of the specs' security requirements.
 */
export function securityReasons({ files = [], added = [], cites = [], security = new Set() }) {
  const reasons = [];
  const shipped = files.filter((f) => !NOT_SHIPPED.test(f));
  const lines = added.filter((a) => !NOT_SHIPPED.test(a.file));
  for (const s of SENSITIVE) {
    const code = [s.code].flat();
    const where = [
      ...(s.path ? shipped.filter((f) => s.path.test(f)) : []),
      ...lines.filter((a) => code.some((c) => c.test(a.text))).map((a) => `${a.file}:${a.line}`),
    ];
    if (where.length) reasons.push({ kind: s.kind, why: s.why, where: [...new Set(where)] });
  }
  const deps = files.filter(isDependencyFile);
  if (deps.length) reasons.push({ kind: 'dependencies', why: 'dependencies', where: deps });
  const cited = cites.filter((id) => security.has(id));
  if (cited.length)
    reasons.push({ kind: 'requirements', why: 'security requirements it cites', where: cited });
  return reasons;
}

/** Every kind of reason a change gets the security review for: the sensitive kinds, then the rest. */
export const SECURITY_KINDS = [...SENSITIVE.map((s) => s.kind), 'dependencies', 'requirements'];

/**
 * The security review's rules for a project: whether it has the reviewer agent, the kinds of change
 * that get the review, and the ids of its specs' security requirements, a story citing any of which
 * gets it too. { reviewer, kinds, requirements }.
 */
export function securityRules(root, config) {
  const specs = config.docs?.specs;
  const texts = specs
    ? markdownFiles(root, specs).map((f) => readFileSync(join(root, f), 'utf8'))
    : [];
  return {
    reviewer: existsSync(join(root, SECURITY_AGENT_FILE)),
    kinds: SECURITY_KINDS,
    requirements: [...securityRequirementIds(texts)],
  };
}

/** The reasons as one sentence: "sign-in or sessions (src/auth/login.ts), dependencies (package.json)". */
export const reasonsInWords = (reasons) =>
  reasons.map((r) => `${r.why} (${examples(r.where)})`).join('; ');

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Whether `branch` needs the security review against `base`, read from git:
 * { branch, story, needed, reasons, agent } where `agent` says whether the project has the
 * security-reviewer agent.
 */
export function securityReview(root, { base, branch, config }) {
  const range = `${base}...${branch}`;
  const files = git(root, 'diff', '--name-only', '--no-renames', range).split('\n').filter(Boolean);
  const added = addedLines(git(root, 'diff', '-U0', '--no-renames', '--no-color', range));
  const story = storyOfBranch(branch);
  const { specs, plan } = config.docs ?? {};
  const cites =
    (plan ? readStories(root, plan) : []).find((s) => s.id === story)?.requirements ?? [];
  const texts = specs
    ? markdownFiles(root, specs).map((f) => readFileSync(join(root, f), 'utf8'))
    : [];
  const reasons = securityReasons({ files, added, cites, security: securityRequirementIds(texts) });
  return {
    branch,
    story,
    needed: reasons.length > 0,
    reasons,
    agent: existsSync(join(root, SECURITY_AGENT_FILE)),
  };
}
