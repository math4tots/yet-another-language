export type Position = {
  /** Line number, zero indexed */
  readonly line: number;
  /** Column number, zero indexed */
  readonly column: number;
  /** UTF-16 offset */
  readonly index: number;
};
export type Range = {
  readonly start: Position;
  readonly end: Position;
};
export const Keywords = [
  'null', 'true', 'false',
  'and', 'or', 'is', 'in', 'as',
  'not',
  'import', 'export', 'from',
  'static', 'inline', 'constexpr',
  'class', 'interface', 'enum', 'typedef',
  'function', 'var', 'const', 'let', 'final', 'extends',
  'if', 'then', 'else', 'while', 'break', 'continue',
  'return',
  'native',
] as const;
export const Symbols = [
  // grouping tokens
  '(', ')',
  '[', ']',
  '{', '}',

  // other single character tokens
  ':', ';', ',', '.', '-', '+', '/', '%', '*',
  '@', '|', '&', '^', '~', '?', '!', '=', '<', '>',

  // double character tokens
  '//', '**', '!=', '==', '<<', '<=', '>>', '>=', '??',
  '=>',
] as const;
export type KeywordTokenType = typeof Keywords[number];
export type SymbolTokenType = typeof Symbols[number];
export type StringValueTokenType = 'ERROR' | 'IDENTIFIER' | 'STRING' | 'COMMENT';
export type TokenType = (
  StringValueTokenType |
  KeywordTokenType |
  SymbolTokenType |
  'NUMBER' |
  'EOF'
);
export const SymbolsMap: Map<string, SymbolTokenType> = new Map(
  Symbols.map(symbol => [symbol, symbol])
);
export const KeywordsMap: Map<string, KeywordTokenType> = new Map(
  Keywords.map(keyword => [keyword, keyword])
);
export type Token = {
  readonly range: Range,
  readonly type: StringValueTokenType,
  readonly value: string,
} | {
  readonly range: Range,
  readonly type: 'NUMBER',
  readonly value: number,
} | {
  readonly range: Range,
  readonly type: KeywordTokenType | SymbolTokenType | 'EOF',
  readonly value: null,
};

function isSpace(c: string): boolean {
  return /[ \t\r\n]/.test(c);
}

function isDigit(c: string): boolean {
  return /[0-9]/.test(c);
}

function isBinDigit(c: string): boolean {
  return /[01]/.test(c);
}

function isOctDigit(c: string): boolean {
  return /[0-7]/.test(c);
}

function isHexDigit(c: string): boolean {
  return /[0-9a-hA-H]/.test(c);
}

function isLetterOrUnderscore(c: string): boolean {
  return /[a-zA-Z_]/.test(c);
}

function isLetterOrUnderscoreOrDigit(c: string): boolean {
  return /[a-zA-Z_0-9]/.test(c);
}

export function lex(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  let column = 0;
  while (true) {
    // skip spaces
    while (i < s.length && isSpace(s[i])) {
      if (s[i] === '\n') {
        line++;
        column = 0;
      } else {
        column++;
      }
      i++;
    }
    const start = { line, column, index: i };
    if (i >= s.length) {
      tokens.push({
        range: { start, end: start },
        type: 'EOF',
        value: null,
      });
      break;
    }
    const j = i;
    const c = s[i];

    // COMMENTs
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') {
        i++;
        column++;
      }
      tokens.push({
        range: { start, end: { line, column, index: i } },
        type: 'COMMENT',
        value: s.substring(j, i),
      });
      continue;
    }

    // NUMBERs
    if (isDigit(c)) {
      const radix =
        s.startsWith('0x', i) ? 16 :
          s.startsWith('0o', i) ? 8 :
            s.startsWith('0b', i) ? 2 : 10;
      const digitTest =
        radix == 16 ? isHexDigit :
          radix == 8 ? isOctDigit :
            radix == 2 ? isBinDigit :
              isDigit;
      if (radix !== 10) {
        i += 2;
        column += 2;
      }
      const valueStart = i;
      while (i < s.length && digitTest(s[i])) {
        i++;
        column++;
      }
      let value = 0;
      if (radix === 10 && i < s.length && s[i] === '.') {
        i++;
        column++;
        while (i < s.length && isDigit(s[i])) {
          i++;
          column++;
        }
        value = parseFloat(s.substring(valueStart, i));
      } else {
        value = parseInt(s.substring(valueStart, i), radix);
      }
      tokens.push({
        range: { start, end: { line, column, index: i } },
        type: 'NUMBER',
        value,
      });
      continue;
    }

    // STRINGs
    if (c === '"' || c === "'") {
      const c3 = c + c + c;
      const quote = s.startsWith(c3, i) ? c3 : c;
      let value = '';
      i += quote.length;
      column += quote.length;
      while (i < s.length && !s.startsWith(quote, i)) {
        if (s[i] === '\n') {
          value += s[i];
          i++;
          line++;
          column = 0;
        } else if (s[i] === '\\') {
          i++;
          column++;
          if (i < s.length) {
            if (s[i] === 'b') {
              i++;
              column++;
              value += '\b';
            } else if (s[i] === 'f') {
              i++;
              column++;
              value += '\f';
            } else if (s[i] === 'n') {
              i++;
              column++;
              value += '\n';
            } else if (s[i] === 'r') {
              i++;
              column++;
              value += '\r';
            } else if (s[i] === 't') {
              i++;
              column++;
              value += '\t';
            } else if (s[i] === 'u') {
              i++;
              column++;
              const k = i;
              while (i < s.length && i < k + 4 && isHexDigit(s[i])) {
                i++;
                column++;
              }
              const codePoint = parseInt(s.substring(k, i), 16);
              value += String.fromCodePoint(codePoint);
            } else {
              value += s[i];
              i++;
              column++;
            }
          }
        } else {
          value += s[i];
          i++;
          column++;
        }
      }
      if (i < s.length && s.startsWith(quote, i)) {
        i += quote.length;
        column += quote.length;
      } else {
        tokens.push({
          range: { start, end: { line, column, index: i } },
          type: 'ERROR',
          value: 'Unterminated string literal',
        });
      }
      tokens.push({
        range: { start, end: { line, column, index: i } },
        type: 'STRING',
        value,
      });
      continue;
    }

    // IDENTIFIERs and Keywords
    if (isLetterOrUnderscore(c)) {
      while (i < s.length && isLetterOrUnderscoreOrDigit(s[i])) {
        i++;
        column++;
      }
      const value = s.substring(j, i);
      const type = KeywordsMap.get(value) || 'IDENTIFIER';
      const range = { start, end: { line, column, index: i } };
      tokens.push(type === 'IDENTIFIER' ?
        { range, type, value } :
        { range, type, value: null });
      continue;
    }

    // Symbols
    if (i + 1 < s.length) {
      const type = SymbolsMap.get(s.substring(i, i + 2)); // 2 character symbols
      if (type) {
        i += 2;
        column += 2;
        tokens.push({ range: { start, end: { line, column, index: i } }, type, value: null });
        continue;
      }
    }
    const type = SymbolsMap.get(c); // 1 character symbols
    if (type) {
      i++;
      column++;
      tokens.push({ range: { start, end: { line, column, index: i } }, type, value: null });
      continue;
    }

    // unrecognized token
    while (i < s.length && !isSpace(s[i])) {
      i++;
      column++;
    }
    tokens.push({
      range: { start, end: { line, column, index: i } },
      type: 'ERROR',
      value: `Unrecognized token ${s.substring(j, i)}`,
    });
  }
  return tokens;
}
