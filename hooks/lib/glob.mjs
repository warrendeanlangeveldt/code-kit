// Path globs as used in .claude/code-kit.json: `*` within one segment, `**` across segments,
// `**/` for zero or more directories, `?` for one character and `{a,b}` for alternatives.

function source(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        out += '(?:.*/)?';
      } else {
        out += '.*';
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{' && glob.indexOf('}', i) > i) {
      const end = glob.indexOf('}', i);
      out += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map(source)
        .join('|')})`;
      i = end;
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}

const cache = new Map();

export function globToRegExp(glob) {
  if (!cache.has(glob)) cache.set(glob, new RegExp(`^${source(glob)}$`));
  return cache.get(glob);
}

export const matchesAny = (path, globs = []) => globs.some((g) => globToRegExp(g).test(path));
