export class Position {
  /** Line number, zero indexed */
  readonly line: number;
  /** Column number, zero indexed */
  readonly column: number;
  /** UTF-16 offset */
  readonly index: number;

  constructor(line: number, column: number, index: number) {
    this.line = line;
    this.column = column;
    this.index = index;
  }
};

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

export const KeywordArray = [
  'null', 'true', 'false',
  'var', 'const', 'def', 'class',
  'return', 'yield', 'async', 'await',
  'for', 'while', 'break', 'continue',
  'if', 'then', 'elif', 'else', 'and', 'or', 'not',
  'raise', 'try', 'except', 'finally', 'with',
  'pass',
  'typedef',
] as const;

export type KeywordTokenType = typeof KeywordArray[number];

export const KeywordMap = new Map<string, KeywordTokenType>(KeywordArray.map(s => [s, s]));

export const SymbolArray = [
  // grouping tokens
  '(', ')',
  '[', ']',
  '{', '}',

  // other single character tokens
  ':', ';', ',', '.', '-', '+', '/', '%', '*',
  '@', '|', '&', '^', '~', '?', '!', '=', '<', '>',

  // double character tokens
  '//', '**', '!=', '==', '<<', '<=', '>>', '>=',
  '->',
] as const;

export type SymbolTokenType = typeof SymbolArray[number];

export const SymbolMap = new Map<string, SymbolTokenType>(SymbolArray.map(s => [s, s]));

export const MaxSymbolLength = Math.max(...SymbolArray.map(s => s.length));

export type NumberValueTokenType = 'NUMBER';
export type NumberValueToken = {
  readonly type: NumberValueTokenType;
  readonly range: Range;
  readonly value: number;
};

export type StringValueTokenType = 'STRING' | 'IDENTIFIER' | 'ERROR';
export type StringValueToken = {
  readonly type: StringValueTokenType;
  readonly range: Range;
  readonly value: string;
};

export type NoValueTokenType = SymbolTokenType | KeywordTokenType | 'INDENT' | 'DEDENT' | 'NEWLINE' | 'EOF';
export type NoValueToken = {
  readonly type: SymbolTokenType | KeywordTokenType | 'INDENT' | 'DEDENT' | 'NEWLINE' | 'EOF';
  readonly range: Range;
  readonly value?: undefined;
};

export type Token = NoValueToken | NumberValueToken | StringValueToken;

export type TokenType = Token['type'];

function unescape(s: string): string {
  const A = 'A'.codePointAt(0) ?? 0;
  const ZERO = '0'.codePointAt(0) ?? 0;
  const ord = (a: string, b: string, c: string) => a <= b && b <= c;
  const isDigit = (c: string) => ord('0', c, '9');
  const isHexDigit = (c: string) => isDigit(c) || (ord('a', c, 'f')) || ord('A', c, 'F');
  const hexValueOf = (c: string) => isDigit(c) ?
    ((c.codePointAt(0) ?? 0) - ZERO) : ((c.toUpperCase().codePointAt(0) ?? 0) - A + 10);
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\') {
      i++;
      switch (s[i]) {
        case 'n': out += '\n'; i++; break;
        case 't': out += '\t'; i++; break;
        case 'r': out += '\r'; i++; break;
        case 'v': out += '\v'; i++; break;
        case '"': out += '"'; i++; break;
        case "'": out += "'"; i++; break;
        case 'x':
        case 'u': {
          const maxLen = s[i] === 'x' ? 2 : s[i] === 'u' ? 4 : 2;
          i++;
          let value = 0;
          for (let j = 0; j < maxLen && isHexDigit(s[i]); j++) {
            value = value * 16 + hexValueOf(s[i++]);
          }
          out += String.fromCodePoint(value);
          break;
        }
        case undefined: out += '\\'; break;
        default: out += s[i++]; break;
      }
    } else out += s[i++];
  }
  return out;
}

export function* lex(source: string): Generator<Token, Token, any> {
  const s = source;
  let i = 0, line = 0, column = 0;
  const here = (): Position => ({ index: i, line, column });
  const rangeFrom = (start: Position): Range => ({ start, end: here() });
  let groupingDepth = 0;
  const isSpace = (c: string, newlineIsSpace: boolean) =>
    c === ' ' || c === '\t' || c === '\v' || c == '\r' || (newlineIsSpace && c === '\n');
  const ord = (a: string, b: string, c: string) => a <= b && b <= c;
  const isDigit = (c: string) => ord('0', c, '9');
  const isBinDigit = (c: string) => ord('0', c, '1');
  const isOctDigit = (c: string) => ord('0', c, '7');
  const isHexDigit = (c: string) => isDigit(c) || (ord('a', c, 'f')) || ord('A', c, 'F');
  const isLetter = (c: string) => ord('a', c, 'z') || ord('A', c, 'Z');
  const isLetterOrDigit = (c: string) => isLetter(c) || isDigit(c);
  const isWordChar = (c: string) => c === '_' || isLetterOrDigit(c);
  const indentStack = [''];

  nextToken: while (true) {
    while (i < s.length && isSpace(s[i], groupingDepth > 0)) {
      if (s[i] === '\n') line++, column = 0;
      else column++;
      i++;
    }
    if (i >= s.length) break;
    if (s[i] === '#') {
      while (i < s.length && s[i] !== '\n') i++, column++;
      continue;
    }
    if (s[i] === '\n') {
      const newlineStart = here();
      i++, line++, column = 0;
      yield { type: 'NEWLINE', range: rangeFrom(newlineStart) };
      while (true) {
        const indentStart = here();
        while (i < s.length && isSpace(s[i], false)) {
          i++, column++;
        }
        if (i < s.length && s[i] === '\n') {
          i++, line++, column = 0;
          continue; // if we encounter an empty line, we start over
        }
        const newIndent = s.substring(indentStart.index, i);
        while (true) {
          const oldIndent = indentStack[indentStack.length - 1];
          if (newIndent === oldIndent) continue nextToken; // nothing to do
          else if (newIndent.startsWith(oldIndent)) {
            yield { type: 'INDENT', range: rangeFrom(indentStart) };
            indentStack.push(newIndent);
            continue nextToken;
          } else if (oldIndent.startsWith(newIndent)) {
            yield { type: 'DEDENT', range: rangeFrom(indentStart) };
            indentStack.pop();
            continue; // check if there are more DEDENT tokens we need to emit
          } else {
            yield { type: 'ERROR', range: rangeFrom(indentStart), value: 'Invalid indentation' };
            continue nextToken;
          }
        }
      }
    }

    const tokenStart = here();

    if (s[i] === '"' || s[i] === "'" || s.startsWith('r"', i) || s.startsWith("r'", i)) {
      const raw = s[i] === 'r';
      if (raw) i++, column++;
      const qc = s[i];
      const qlen = s.startsWith(qc + qc + qc, i) ? 3 : 1;
      const quote = s.substring(i, i + qlen);
      i += qlen, column += qlen;
      const j = i;
      while (i < s.length && !s.startsWith(quote, i)) {
        if (!raw && s[i] === '\\') i++, column++;
        if (s[i] === '\n') i++, line++, column = 0;
        else i++, column++;
      }
      const rawValue = s.substring(j, i);
      i += qlen, column += qlen;
      const value = raw ? rawValue : unescape(rawValue);
      yield { type: 'STRING', range: rangeFrom(tokenStart), value };
      continue nextToken;
    }

    if (isDigit(s[i])) {
      const base = s.startsWith('0b', i) ? 2 :
        s.startsWith('0o', i) ? 8 :
          s.startsWith('0x', i) ? 16 : 10;
      if (base !== 10) i += 2, column += 2;
      const isD = base === 2 ? isBinDigit :
        base === 8 ? isOctDigit :
          base === 16 ? isHexDigit : isDigit;
      const j = i;
      while (i < s.length && isD(s[i])) i++, column++;
      let value = 0;
      if (base === 10 && i < s.length && s[i] === '.') {
        i++, column++;
        while (i < s.length && isDigit(s[i])) i++, column++;
        value = parseFloat(s.substring(j, i));
      } else value = parseInt(s.substring(j, i), base);
      yield { type: 'NUMBER', range: rangeFrom(tokenStart), value };
      continue nextToken;
    }

    if (isWordChar(s[i])) {
      const j = i;
      while (i < s.length && isWordChar(s[i])) i++, column++;
      const value = s.substring(j, i);
      const type = KeywordMap.get(value);
      const range = rangeFrom(tokenStart);
      if (type) yield { type, range };
      else yield { type: 'IDENTIFIER', range, value };
      continue nextToken;
    }

    for (let length = MaxSymbolLength; length >= 1; length--) {
      const text = s.substring(i, i + length);
      const type = SymbolMap.get(text);
      if (type) {
        i += length, column += length;
        yield { type, range: rangeFrom(tokenStart) };
        switch (type) {
          case '(':
          case '[':
          case '{':
            groupingDepth++;
            break;
          case ')':
          case ']':
          case '}':
            groupingDepth--;
            break;
        }
        continue nextToken;
      }
    }

    while (i < s.length && !isSpace(s[i], true)) i++, column++;
    yield { type: 'ERROR', range: rangeFrom(tokenStart), value: s.substring(tokenStart.index, i) };
  }

  const eof: Token = { type: 'EOF', range: rangeFrom(here()) };
  yield eof;
  return eof;
}
