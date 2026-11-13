// What a shell command runs, as distinct from the text it carries. Heredoc bodies and quoted strings
// are data: a commit message, a card's --text, a grep pattern. So rules that recognise a command
// (`git commit`, `code-kit merge`) look only at the simple commands it runs, each from its own start.
// Rules about text the command carries (a commit trailer, a path in a redirect) still read it whole.

/** The command's lines and its heredocs' bodies apart: a body is the lines after `<<WORD` up to the line `WORD`. */
function heredocsApart(cmd) {
  const kept = [];
  const bodies = [];
  let until = null;
  for (const line of String(cmd).split('\n')) {
    if (until) {
      if (line.trim() === until) until = null;
      else bodies.push(line);
      continue;
    }
    kept.push(line);
    // `<<WORD`, `<<-WORD`, `<<'WORD'` or `<<"WORD"`; not a `<<<` here-string, whose text is on the line.
    const m = line.match(/(?<!<)<<-?\s*(['"]?)([\w.-]+)\1(?!<)/);
    if (m && !line.includes('<<<')) until = m[2];
  }
  return { kept: kept.join('\n'), bodies: bodies.join('\n') };
}

/** The command with each heredoc's body taken out: the lines after `<<WORD` up to the line `WORD`. */
export const withoutHeredocs = (cmd) => heredocsApart(cmd).kept;

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
// A quoted value is taken whole: unquoted, a value stops at a quote, so `CK="node x"` with nothing after it
// is never read as `CK="node` running `x"`.
const LEADING =
  /^(?:(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s"']*)\s+)|(?:sudo|exec|time|command|nohup|env)\s+|!\s+)+/;

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
  /^(?!.*\s(?:--output\b|-O|--open-files-in-pager\b))git(?:\s+(?:-C\s+\S+|--no-pager|-P))*\s+(?:diff|log|show|blame|grep|status|cat-file|ls-files|ls-tree|shortlog|rev-parse|rev-list|merge-base|check-ignore|check-attr|describe|name-rev|show-ref|for-each-ref|cherry)(?:\s|$)/,
  // git branch only listing branches or naming the current one: no name to create, move or delete.
  /^git(?:\s+(?:-C\s+\S+|--no-pager|-P))*\s+branch(?:\s+(?:--show-current|--list|-l|-a|--all|-r|--remotes|-vv?|--verbose|--no-color|--color|--merged|--no-merged))*\s*$/,
  // rg with no preprocessor; sort with no output file or compressor.
  /^(?!.*\s--pre\b)rg(?:\s|$)/,
  /^(?!.*\s(?:-[a-zA-Z]*o|--output\b|--compress-program\b))sort(?:\s|$)/,
];

// code-kit's own commands that only read and print: what the config says, who owns a path, the
// imports, a requirement's trail, the build's state, the next step and the approved designs (not their
// `evidence`, which records a screenshot), with nothing written but code-kit's own state.
const CODE_KIT_READS = new RegExp(
  String.raw`^(?!.*\s--write\b)${CODE_KIT}\s+(?:check|who|unowned|diff|graph|trace|adapters|status|next|designs(?!\s+evidence\b))(?:\s|$)`,
);

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

/**
 * Where a command sends its output: each `>` or `>>` redirect's target as written, quotes off (`2>&1`
 * and /dev/null left out), and the command without them. Null for a read-write redirect (`<>`).
 */
export function outputRedirects(cmd) {
  const text = withoutHarmlessRedirects(cmd);
  const code = maskQuotes(text);
  if (/<>/.test(code)) return null;
  const targets = [];
  let rest = '';
  let at = 0;
  for (const m of code.matchAll(/(?:\d+|&)?>>?\|?\s*/g)) {
    const from = m.index + m[0].length;
    const word = code.slice(from).match(/^[^\s;&|<>()]*/)[0];
    targets.push(text.slice(from, from + word.length).replace(/^(['"])(.*)\1$/s, '$2'));
    rest += `${text.slice(at, m.index)} `;
    at = from + word.length;
  }
  return { targets, rest: rest + text.slice(at) };
}

// One or more sed substitutions (`s/a/b/g`, `s|a|b|`; `;` between them), with no flag that writes a
// file (`w`) or runs a command (`e`).
function onlySubstitutes(script) {
  const s = script.trim();
  let i = 0;
  while (i < s.length) {
    const d = s[i + 1];
    if (s[i] !== 's' || !d || /[\s\\]/.test(d)) return false;
    let j = i + 2;
    for (let parts = 0; parts < 2; j++) {
      if (j >= s.length) return false;
      if (s[j] === '\\') j++;
      else if (s[j] === d) parts++;
    }
    j += s.slice(j).match(/^[gIip\d]*\s*/)[0].length;
    if (j < s.length && s[j] !== ';') return false;
    i = j + 1;
    while (s[i] === ' ') i++;
  }
  return s.length > 0;
}

/**
 * The files a `sed -i` edits in place when every script only substitutes (onlySubstitutes), or null
 * for any other sed: `-i`, `-i.bak` and BSD's `-i ''`, with `-e`, `-E` and `-r` beside them.
 */
export function sedInPlaceFiles(text) {
  if (!/^sed\s/.test(text) || /[`$<>]/.test(maskQuotes(text))) return null;
  const words = wordsOf(text).slice(1);
  const scripts = [];
  const files = [];
  let inPlace = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '-i' || w === '--in-place') {
      inPlace = true;
      if (words[i + 1] === '') i++;
    } else if (/^-i\.?\w*$|^--in-place=/.test(w)) inPlace = true;
    else if (w === '-e' || w === '--expression') scripts.push(words[++i] ?? '');
    else if (/^-[Er]+$/.test(w)) continue;
    else if (w.startsWith('-')) return null;
    else files.push(w);
  }
  if (!scripts.length && files.length) scripts.push(files.shift());
  return inPlace && files.length && scripts.every(onlySubstitutes) ? files : null;
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
      if (CODE_KIT_READS.test(text)) return true;
      if (/^sed(?:\s|$)/.test(c)) return sedPrints(text);
      if (/^awk(?:\s|$)/.test(c)) return awkPrints(text);
      if (/^uniq(?:\s|$)/.test(c)) return uniqPrints(text);
      return false;
    })
  );
}

// What could change what a later command in the line runs: a function or alias defined, a file sourced,
// a shell option, a variable exported, or one the shell or a command reads (PATH among them).
const REDEFINES =
  /(?:^|[;&|\n(]\s*)(?:[\w.-]+\s*\(\s*\)|function\s|alias\s|unalias\s|source\s|\.\s|hash\s|enable\s|builtin\s|set\s|setopt\s|shopt\s|unset\s|export\s|typeset\s|declare\s|local\s|readonly\s)/;
const SHELL_READS =
  /^(?:PATH|path|FPATH|fpath|CDPATH|cdpath|IFS|ENV|BASH_ENV|ZDOTDIR|HOME|LD_\w*|DYLD_\w*|GIT_\w*|XDG_\w*)$/;
// A function defined in the line: `name() {` or `function name`. One that no reading part calls can't
// change what that part runs; what its body runs is judged as the line's other commands are.
const DEFINES_FUNCTION =
  /(?:^|[;&|\n(]\s*)(?:function\s+([\w.-]+)(?:\s*\(\s*\))?|([\w.-]+)\s*\(\s*\))/g;
function definedFunctions(code) {
  const names = [...code.matchAll(DEFINES_FUNCTION)].map(([, a, b]) => a ?? b);
  // What else the line redefines, a function's body counted, since a call runs it.
  const rest = code.replace(DEFINES_FUNCTION, ';').replace(/[{}]/g, ';');
  return { names, rest };
}
// Any other variable set in the line (`CK=…/code-kit.mjs`) stays in the shell: no command it runs sees
// it, unless it was exported already, and what names it is judged on its own.
const setsWhatRuns = (code) =>
  [...code.matchAll(/(?:^|[;&|\n(]\s*)([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/g)].some(
    ([, name]) => SHELL_READS.test(name) || name in process.env,
  );

/**
 * The parts of `cmd` that name `pattern`, each a pipeline (`a | b`) of its own, that don't only read
 * (readsOnly): what a rule for a file only reads may hold. A line with a heredoc whose body names
 * `pattern`, or one that could change what its commands run (REDEFINES), is one part, judged whole; a
 * heredoc that doesn't name it is judged like any other command that doesn't, and so is a function
 * defined, unless a part that names `pattern` calls it.
 */
export function unreadNames(cmd, pattern) {
  const read = withoutHarmlessRedirects(cmd);
  const code = codeOf(read);
  if (!pattern.test(cmd)) return [];
  const functions = definedFunctions(code);
  if (
    pattern.test(heredocsApart(cmd).bodies) ||
    REDEFINES.test(functions.rest) ||
    setsWhatRuns(code)
  )
    return readsOnly(cmd) ? [] : [cmd];
  const calls = (p) => commandsOf(p).some(({ text: t }) => functions.names.includes(wordsOf(t)[0]));
  const text = withoutHeredocs(read);
  const parts = [];
  let start = 0;
  for (let i = 0; i <= code.length; i++) {
    const two = code.slice(i, i + 2);
    const end = i === code.length || code[i] === ';' || code[i] === '\n';
    const andOr = two === '&&' || two === '||';
    const background = code[i] === '&' && !andOr && code[i - 1] !== '&' && code[i - 1] !== '>';
    if (end || andOr || background) {
      parts.push(text.slice(start, i));
      start = i + (andOr ? 2 : 1);
      if (andOr) i++;
    }
  }
  // The commit hook appends to the log before the command runs: a restore beside a commit could drop that.
  const restores = !runs(
    cmd,
    new RegExp(String.raw`^${GIT}(?:commit|merge|revert|cherry-pick|rebase|am|pull)(?![\w-])`),
  );
  return parts.filter(
    (p) =>
      pattern.test(p) &&
      (calls(p) || (!readsOnly(p) && !(restores && restoresFromHead(p, pattern)))),
  );
}

// git restore's flags that keep its source the last commit (or the index), and change nothing else.
const RESTORE_FLAG = /^(?:--staged|-S|--worktree|-W|-SW|-WS|--source=HEAD|-q|--quiet|--)$/;

/**
 * Whether `part` only puts a file `pattern` names back as the last commit (or the index) has it:
 * `git restore [--staged] [--worktree] <file>` or `git checkout [HEAD] -- <file>`. That can lose only
 * what isn't committed, never what the history holds, as after `git revert --no-commit` took a file's
 * committed lines out.
 */
export function restoresFromHead(part, pattern) {
  const pieces = commandsOf(part);
  if (pieces.length !== 1 || /[|<>`$]/.test(codeOf(part))) return false;
  const words = wordsOf(pieces[0].text);
  if (words[0] !== 'git' || words.length < 3) return false;
  const file = words.at(-1);
  if (!pattern.test(file) || /[*?[]/.test(file)) return false;
  const flags = words.slice(2, -1);
  if (words[1] === 'restore') {
    for (let i = 0; i < flags.length; i++) {
      if ((flags[i] === '-s' || flags[i] === '--source') && flags[i + 1] === 'HEAD') i++;
      else if (!RESTORE_FLAG.test(flags[i])) return false;
    }
    return true;
  }
  if (words[1] === 'checkout')
    return (
      flags.join(' ') === '--' || flags.join(' ') === 'HEAD --' || flags.join(' ') === '-q HEAD --'
    );
  return false;
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
