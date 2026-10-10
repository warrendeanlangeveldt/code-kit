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
 * Each is `{ text, code }`: `text` as written, `code` with its quoted text masked.
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
    if (piece) found.push({ text: piece, code: mask.slice(from, from + piece.length) });
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
