/** Minimal TypeScript tokenizer for the script editor's colour layer. */

export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'literal'
  | 'type'
  | 'function'
  | 'property'
  | 'engine'
  | 'punct'
  | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(
  (
    'as async await break case catch class const continue debugger default delete do else enum export extends ' +
    'finally for from function if implements import in instanceof interface keyof let new of readonly return ' +
    'satisfies static switch throw try type typeof var void while yield'
  ).split(' '),
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity']);
const BUILTIN_TYPES = new Set(['number', 'string', 'boolean', 'unknown', 'any', 'never', 'object', 'Record', 'Readonly']);
/** Names the engine gives meaning to: the script API parameters and hooks. */
const ENGINE = new Set(['self', 'world', 'hit', 'dt', 'props', 'init', 'update', 'onHit']);

const RULES: Array<[TokenKind | 'word', RegExp]> = [
  ['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?/y],
  ['number', /(?:0[xX][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y],
  ['word', /[A-Za-z_$][\w$]*/y],
  ['text', /\s+/y],
  ['punct', /[{}()[\];,.:?!<>=+\-*/%&|^~@#]+/y],
];

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    let matched = false;
    for (const [kind, re] of RULES) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m || !m[0]) continue;
      out.push({ kind: kind === 'word' ? classifyWord(src, i, m[0], out) : kind, text: m[0] });
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) out.push({ kind: 'text', text: src[i++] });
  }
  return out;
}

function prevSignificant(tokens: Token[]): Token | undefined {
  for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].kind !== 'text') return tokens[k];
  return undefined;
}

function classifyWord(src: string, at: number, word: string, before: Token[]): TokenKind {
  const prev = prevSignificant(before);
  const afterDot = prev?.kind === 'punct' && prev.text.endsWith('.');
  const next = /^\s*(\(|<[\w\s,]*>\s*\()/.test(src.slice(at + word.length, at + word.length + 40));
  if (afterDot) return next ? 'function' : 'property';
  if (KEYWORDS.has(word)) return 'keyword';
  if (LITERALS.has(word)) return 'literal';
  if (ENGINE.has(word)) return 'engine';
  if (BUILTIN_TYPES.has(word) || /^[A-Z]/.test(word)) return 'type';
  if (next) return 'function';
  return 'text';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML for the colour layer; a trailing newline keeps its height in sync with the textarea. */
export function highlightHtml(src: string): string {
  return (
    tokenize(src)
      .map((t) => (t.kind === 'text' ? escapeHtml(t.text) : `<span class="tk-${t.kind}">${escapeHtml(t.text)}</span>`))
      .join('') + '\n'
  );
}
