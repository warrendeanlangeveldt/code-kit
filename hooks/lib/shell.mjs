// What a shell command runs, as distinct from the text it carries. Heredoc bodies and quoted strings
// are data: a commit message, a card's --text, a grep pattern. So rules that recognise a command
// (`git commit`, `code-kit merge`) look only at the simple commands it runs, each from its own start.
// Rules about text the command carries (a commit trailer, a path in a redirect) still read it whole.

/** The command with each heredoc's body taken out: the lines after `<<WORD` up to the line `WORD`. */
export function withoutHeredocs(cmd) {
  const out = [];
  let until = null;
  for (const line of String(cmd).split('\n')) {
    if (until) {
      if (line.trim() === until) until = null;
      continue;
    }
    out.push(line);
    // `<<WORD`, `<<-WORD`, `<<'WORD'` or `<<"WORD"`; not a `<<<` here-string, whose text is on the line.
    const m = line.match(/(?<!<)<<-?\s*(['"]?)([\w.-]+)\1(?!<)/);
    if (m && !line.includes('<<<')) until = m[2];
  }
  return out.join('\n');
}

/** `text` with every quoted character replaced by `_`, the quotes kept: same length, nothing inside to match. */
export function maskQuotes(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < text.length) {
        out += '__';
        i++;
      } else if (c === quote) {
        quote = null;
        out += c;
      } else out += '_'; // a newline inside quotes too: it ends no command
    } else if (c === '\\' && i + 1 < text.length) {
      out += '__';
      i++;
    } else {
      if (c === '"' || c === "'") quote = c;
      out += c;
    }
  }
  return out;
}

const SEPARATOR = /[;&|\n()`]/;
const LEADING =
  /^(?:(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)|(?:sudo|exec|time|command|nohup|env)\s+|!\s+)+/;

/**
 * The simple commands `cmd` runs, in order: split at `;`, `&`, `|`, newlines, parentheses and
 * backticks outside quotes, heredoc bodies left out, each without leading `VAR=value` assignments.
 * Each is `{ text, code, whole }`: `text` as written, `code` with its quoted text masked, and `whole`
 * as written with its leading assignments and wrappers kept.
 */
export function commandsOf(cmd) {
  const text = withoutHeredocs(cmd);
  const mask = maskQuotes(text);
  const found = [];
  let start = 0;
  const take = (end) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    const skip = body.match(LEADING)?.[0].length ?? 0;
    const from = start + lead + skip;
    const piece = text.slice(from, start + lead + body.length);
    if (piece)
      found.push({ text: piece, code: mask.slice(from, from + piece.length), whole: body });
  };
  for (let i = 0; i < mask.length; i++)
    if (SEPARATOR.test(mask[i])) {
      take(i);
      start = i + 1;
    }
  take(mask.length);
  return found;
}

/** Whether `cmd` runs a command matching `pattern`, which is anchored at the command's start. */
export function runs(cmd, pattern, { quoted = true } = {}) {
  return commandsOf(cmd).some((c) => pattern.test(quoted ? c.text : c.code));
}

/** The whole command with heredoc bodies out and quoted text masked: for rules that span commands (`curl … | sh`). */
export function codeOf(cmd) {
  return maskQuotes(withoutHeredocs(cmd));
}

/** `git`, with any `-C dir` and `-c key=value` before its subcommand. */
export const GIT = String.raw`git\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)\s+)*`;

/** code-kit's command line however it's run: installed, through node (its path quoted or not), or npx. */
export const CODE_KIT = String.raw`(?:code-kit|node\s+(?:"[^"]*code-kit(?:\.mjs)?"|'[^']*code-kit(?:\.mjs)?'|\S*code-kit(?:\.mjs)?)|npx\s+(?:--yes\s+|-y\s+)?@warren-dean\/code-kit(?:@\S+)?)`;

// What a read may redirect: its errors into its output (2>&1, >&2), or anything into /dev/null.
const HARMLESS_REDIRECT = /(?:\d+|&)?>>?\s*(?:&\d+|\/dev\/null(?![\w/.-]))/g;

/** `cmd` with its harmless redirects (`2>&1`, `>&2`, anything into /dev/null) taken out: they write no file. */
export const withoutHarmlessRedirects = (cmd) => String(cmd).replace(HARMLESS_REDIRECT, ' ');
// An assignment before a command (GIT_PAGER=…, GIT_EXTERNAL_DIFF=…, LESSOPEN=…) can make a reader run a
// program, so a read that sets one isn't only a read.
const ASSIGNS = /^\s*(?:(?:sudo|exec|time|command|nohup|env)\s+|!\s+)*[A-Za-z_]\w*=/;

// Commands that read files or what comes down the pipe and print, and write nothing whatever their
// arguments. git reads its history: only `-C` before the subcommand (a `-c` setting can name a program
// to run), and no output file or pager program.
const READERS = [
  /^(?:cd|pwd|cat|head|tail|wc|grep|egrep|fgrep|cut|jq|nl|tr|ls|stat|diff|cmp|echo|printf|true)(?:\s|$)/,
  // less with no log file of what it shows.
  /^(?!.*\s(?:-[a-zA-Z]*[oO]|--log-file\b|--LOG-FILE\b))less(?:\s|$)/,
  /^(?!.*\s(?:--output\b|-O|--open-files-in-pager\b))git(?:\s+(?:-C\s+\S+|--no-pager|-P))*\s+(?:diff|log|show|blame|grep|status|cat-file|ls-files|shortlog|rev-parse)(?:\s|$)/,
  // git branch only listing branches or naming the current one: no name to create, move or delete.
  /^git(?:\s+(?:-C\s+\S+|--no-pager|-P))*\s+branch(?:\s+(?:--show-current|--list|-l|-a|--all|-r|--remotes|-vv?|--verbose|--no-color|--color|--merged|--no-merged))*\s*$/,
  // rg with no preprocessor; sort with no output file or compressor.
  /^(?!.*\s--pre\b)rg(?:\s|$)/,
  /^(?!.*\s(?:-[a-zA-Z]*o|--output\b|--compress-program\b))sort(?:\s|$)/,
];

/** A command's words, quotes taken off. */
const wordsOf = (text) =>
  (text.match(/'[^']*'|"(?:\\.|[^"\\])*"|\S+/g) ?? []).map((w) =>
    w.replace(/^(['"])(.*)\1$/s, '$2'),
  );

// A sed script that only prints, deletes from what it prints, numbers or quits: `5,20p`, `$p`, `/x/p`.
const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
const SED_PRINTS = new RegExp(
  String.raw`^(?:\s*(?:${SED_ADDRESS}(?:\s*,\s*${SED_ADDRESS})?)?\s*[pdq=]\s*)(?:;(?:\s*(?:${SED_ADDRESS}(?:\s*,\s*${SED_ADDRESS})?)?\s*[pdq=]\s*))*;?$`,
);

/** Whether a sed command only prints: no in-place edit, no script file, and every script only prints. */
function sedPrints(text) {
  const words = wordsOf(text).slice(1);
  const scripts = [];
  let expressions = false;
  const files = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '-e' || w === '--expression') {
      expressions = true;
      scripts.push(words[++i] ?? '');
    } else if (w.startsWith('--expression=')) {
      expressions = true;
      scripts.push(w.slice('--expression='.length));
    } else if (w === '--quiet' || w === '--silent' || w === '-n') continue;
    else if (/^-[nErsuz]+$/.test(w)) continue;
    else if (w.startsWith('-'))
      return false; // -i, -I, -f and anything else
    else files.push(w);
  }
  if (!expressions && files.length) scripts.push(files.shift());
  return scripts.length > 0 && scripts.every((s) => SED_PRINTS.test(s));
}

/** Whether an awk command only prints: -F and -v only, and no redirect, pipe, system() or getline. */
function awkPrints(text) {
  const words = wordsOf(text).slice(1);
  for (let i = 0; i < words.length; i++) {
    if (!words[i].startsWith('-')) break;
    if (words[i] === '-v') i++;
    else if (!/^-F/.test(words[i])) return false;
  }
  return !/[>|]|\b(?:system|getline|fflush|close)\b/.test(text);
}

/** Whether a uniq command names no output file: at most one file, the one it reads. */
const uniqPrints = (text) =>
  wordsOf(text)
    .slice(1)
    .filter((w) => !w.startsWith('-')).length <= 1;

/**
 * Whether `cmd` only reads and prints, so it can't write any file: every command of the chain is a
 * reader (`cd`, git's history, cat, head, tail, grep, wc, jq, cut, sort, uniq, awk without redirects,
 * sed -n printing lines…), piped or chained into each other, with no command's output in its
 * arguments, no variable set before a command, and no redirect but `2>&1` or into /dev/null.
 */
export function readsOnly(cmd) {
  // Taken out first: `&` in `2>&1` would otherwise split the command there.
  const read = withoutHarmlessRedirects(cmd);
  const code = codeOf(read);
  if (/[>`]|\$\(|<\(|<>/.test(code)) return false;
  if (code.split(/[;&|\n()]/).some((piece) => ASSIGNS.test(piece))) return false;
  const parts = commandsOf(read);
  return (
    parts.length > 0 &&
    parts.every(({ text, code: c }) => {
      if (READERS.some((re) => re.test(c))) return true;
      if (/^sed(?:\s|$)/.test(c)) return sedPrints(text);
      if (/^awk(?:\s|$)/.test(c)) return awkPrints(text);
      if (/^uniq(?:\s|$)/.test(c)) return uniqPrints(text);
      return false;
    })
  );
}

// What may come before a command it runs: a package runner (`npx`, `pnpm exec`, `uv run`…) or a wrapper
// (`xargs`, `nice`, `timeout 60`), so a rule naming the command finds it there too.
const WRAPPER = String.raw`(?:(?:npx|bunx|pnpx)(?:\s+-\S+)*\s+|(?:pnpm|yarn|bun)\s+(?:(?:exec|dlx|x|run)\s+)?(?:-\S+\s+)*|npm\s+(?:exec|x|run)\s+(?:--\s+)?|(?:uv|poetry|pipenv)\s+run\s+|(?:xargs|nice|nohup|time|command|exec)(?:\s+-\S+)*\s+|timeout\s+(?:-\S+\s+)*\S+\s+)`;
// A shell handed a script (`sh -c '…'`, `bash -lc "…"`): the script's commands run too, as do eval's.
const SHELL_SCRIPT = /^(?:ba|z|da|k)?sh\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c[a-zA-Z]*\s/;
const SCRIPT_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/;

/** The script a command hands a shell it starts (`sh -c '…'`) or `eval`, or null. */
function scriptOf({ text, code }) {
  const words = wordsOf(text);
  if (/^eval\s/.test(code)) return words.slice(1).join(' ');
  if (!SHELL_SCRIPT.test(code)) return null;
  const at = words.findIndex((w, i) => i > 0 && SCRIPT_FLAG.test(w));
  return at > 0 ? (words[at + 1] ?? null) : null;
}

/**
 * Whether `cmd` runs a command `pattern` names: matched from the start of each command the line runs
 * (after a package runner or wrapper, and inside `sh -c` or `eval`), with quoted text masked unless the
 * pattern itself has quotes, so an argument, a heredoc or a message that mentions the command isn't it.
 */
export function runsNamed(cmd, pattern, depth = 0) {
  const source = String(pattern).replace(/^\^/, '');
  const quoted = /["']/.test(source);
  const re = new RegExp(String.raw`^${WRAPPER}*(?:${source})`);
  return commandsOf(cmd).some((c) => {
    // The program's own name counts however it's quoted: `"tool" deploy` runs tool.
    const first = c.text.match(/^(?:'[^']*'|"(?:\\.|[^"\\])*"|\S+)/)?.[0] ?? '';
    const subject = quoted ? c.text : wordsOf(first).join('') + c.code.slice(first.length);
    if (re.test(subject)) return true;
    const script = depth < 3 ? scriptOf(c) : null;
    return script !== null && runsNamed(script, pattern, depth + 1);
  });
}

/**
 * Whether a project's rule for a command (`shell.block`, `shell.restricted`: `{ pattern, command? }`)
 * matches `cmd`. `command: true` matches the commands the line runs (runsNamed). Otherwise the pattern
 * reads the whole line, except that in a line that only reads (readsOnly) quoted text is data: a grep
 * for a blocked command doesn't run it.
 */
export function ruleMatches({ pattern, command }, cmd) {
  if (command) return runsNamed(cmd, pattern);
  const quoted = /["']/.test(pattern);
  return new RegExp(pattern).test(!quoted && readsOnly(cmd) ? codeOf(cmd) : cmd);
}
