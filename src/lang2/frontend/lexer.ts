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

export type Rangeable = Range | { range: Range; };

export class Range {
  private static getStart(r: Rangeable): Position { return r instanceof Range ? r.start : r.range.start; }
  private static getEnd(r: Rangeable): Position { return r instanceof Range ? r.end : r.range.end; }
  private static getStartIndex(r: Rangeable): number { return Range.getStart(r).index; }
  private static getEndIndex(r: Rangeable): number { return Range.getEnd(r).index; }
  static join(...rangeables: (Rangeable | undefined)[]) {
    const rr: Rangeable[] = [];
    for (const r of rangeables) {
      if (r !== undefined) rr.push(r);
    }
    const min = rr.reduce((a, b) => Range.getStartIndex(a) < Range.getStartIndex(b) ? a : b);
    const max = rr.reduce((a, b) => Range.getEndIndex(a) > Range.getEndIndex(b) ? a : b);
    return new Range(Range.getStart(min), Range.getEnd(max));
  }

  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

export const Keywords = [
  'null', 'true', 'false',
  'and', 'or', 'is', 'in', 'as',
  'not',
  'import', 'export', 'from',
  'static', 'inline', 'constexpr',
  'class', 'interface', 'enum', 'typedef',
  'function', 'var', 'const', 'let', 'final', 'extends',
  'if', 'elif', 'then', 'else', 'for', 'while', 'break', 'continue',
  'return', 'yield', 'async', 'await',
  'native',
  'abstract',
] as const;

export const Punctuators = [
  // grouping tokens
  '(', ')',
  '[', ']',
  '{', '}',

  // other single character tokens
  ':', ';', ',', '.', '-', '+', '/', '%', '*',
  '@', '|', '&', '^', '~', '?', '!', '=', '<', '>',

  // double character tokens
  '//', '**', '!=', '==', '<<', '<=', '>>', '>=', '??',
  '=>', '->',

  // triple character tokens
  '...',
] as const;

export type KeywordTokenType = typeof Keywords[number];
export type PunctuatorTokenType = typeof Punctuators[number];

export const KeywordsMap: Map<string, KeywordTokenType> = new Map(
  Keywords.map(keyword => [keyword, keyword])
);
export const PunctuatorsMap: Map<string, PunctuatorTokenType> = new Map(
  Punctuators.map(punc => [punc, punc])
);

const ReverseSortedPunctuators = Array.from(Punctuators).sort().reverse();

export type StringValueTokenType = (
  'ERROR' | 'NAME' | 'STRING' | 'COMMENT' |
  'TEMPLATE_START' | 'TEMPLATE_MIDDLE' | 'TEMPLATE_END'
);
export type NumberValueTokenType = 'NUMBER';
export type NoValueTokenType = KeywordTokenType |
  PunctuatorTokenType |
  'NEWLINE' |
  'INDENT' |
  'DEDENT' |
  'EOF';

export type TokenType = StringValueTokenType | NumberValueTokenType | NoValueTokenType;

export type Token = {
  readonly range: Range,
  readonly type: StringValueTokenType,
  readonly value: string,
} | {
  readonly range: Range,
  readonly type: NumberValueTokenType,
  readonly value: number,
} | {
  readonly range: Range,
  readonly type: NoValueTokenType,
  readonly value?: undefined,
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

export function* lex(s: string): Generator<Token, Token, any> {
  let i = 0;
  let line = 0;
  let column = 0;
  let groupingDepth = 0;
  const indentStack = [''];
  const here = () => new Position(line, column, i);
  const rangeFrom = (start: Position) => new Range(start, here());

  nextToken: while (true) {
    while (i < s.length && isSpace(s[i]) && (groupingDepth > 0 || s[i] !== '\n')) {
      if (s[i] === '\n') i++, line++, column = 0;
      else i++, column++;
    }

    // newline
    if ((i < s.length && s[i] === '\n') || i >= s.length) {
      const start = here();
      i++, line++, column = 0;
      yield { range: rangeFrom(start), type: 'NEWLINE' };

      // indent and dedent
      while (true) {
        const lineStart = here();
        while (i < s.length && s[i] !== '\n' && isSpace(s[i])) i++, column++;
        if (i < s.length && s[i] === '\n') {
          i++, line++, column = 0;
          continue;
        }
        const newIndent = i >= s.length ? '' : s.substring(lineStart.index, i);
        const oldIndent = indentStack[indentStack.length - 1];
        if (newIndent === oldIndent) {
          // nothing to do
        } else if (newIndent.startsWith(oldIndent)) {
          yield { range: rangeFrom(lineStart), type: 'INDENT' };
          indentStack.push(newIndent);
        } else if (oldIndent.startsWith(newIndent)) {
          yield { range: rangeFrom(lineStart), type: 'DEDENT' };
          indentStack.pop();
        } else {
          yield { range: rangeFrom(lineStart), type: 'ERROR', value: 'invalid indentation' };
        }
        break;
      }

      if (i < s.length) continue;
    }

    if (i >= s.length) break;
    const start = here();
    const j = i;
    const c = s[i];

    // number
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
      if (radix !== 10) i += 2, column += 2;
      const valueStart = i;
      while (i < s.length && digitTest(s[i])) i++, column++;
      let value = 0;
      if (radix === 10 && i < s.length && s[i] === '.') {
        i++, column++;
        while (i < s.length && isDigit(s[i])) i++, column++;
        value = parseFloat(s.substring(valueStart, i));
      } else {
        value = parseInt(s.substring(valueStart, i), radix);
      }
      yield { range: rangeFrom(start), type: 'NUMBER', value };
      continue;
    }

    // string
    if (c === '"' || c === "'") {
      i++, column++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\') i++, column++;
        if (s[i] === '\n') i++, line++, column = 0;
        else i++, column++;
      }
      i++, column++;
      try {
        const value = '' + (0, eval)(s.substring(j, i)); // TODO: avoid eval
        yield { range: rangeFrom(start), type: 'STRING', value };
      } catch (err) {
        yield { range: rangeFrom(start), type: 'ERROR', value: `Invalid string literal ${err}` };
      }
      continue;
    }

    // TOOD: template literals
    if (c === '`') {
      i++, column++;
      i++, column++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\') i++, column++;
        if (s[i] === '\n') i++, line++, column = 0;
        else i++, column++;
      }
      i++, column++;
      try {
        const value = '' + (0, eval)(s.substring(j, i)); // TODO: avoid eval
        yield { range: rangeFrom(start), type: 'STRING', value };
      } catch (err) {
        yield { range: rangeFrom(start), type: 'ERROR', value: `Invalid string literal ${err}` };
      }
      continue;
    }

    // name or keyword
    if (isLetterOrUnderscore(c)) {
      while (i < s.length && isLetterOrUnderscoreOrDigit(s[i])) i++, column++;
      const range = rangeFrom(start);
      const value = s.substring(j, i);
      const keyword = KeywordsMap.get(value);
      if (keyword) yield { range, type: keyword };
      else yield { range, type: 'NAME', value };
      continue;
    }

    // punctuator
    for (const punctuator of ReverseSortedPunctuators) {
      if (s.startsWith(punctuator, i)) {
        switch (punctuator) {
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
        i += punctuator.length, column += punctuator.length;
        yield { range: rangeFrom(start), type: punctuator };
        continue nextToken;
      }
    }

    // unrecognzied
    while (i < s.length && !isSpace(s[i])) i++, column++;
    yield {
      range: rangeFrom(start),
      type: 'ERROR',
      value: `Unrecognized token ${JSON.stringify(s.substring(j, i))}`,
    };
  }

  const EOF: Token = { range: rangeFrom(here()), type: 'EOF' };
  yield EOF;
  return EOF;
}
