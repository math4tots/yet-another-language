// @ts-check

// Utility for translating typescript annotations to YAL

import fs from 'fs';

const argv = process.argv.splice(2);

if (argv.length !== 2) {
  throw new Error(`Usage: ${process.argv[0]} ${process.argv[1]} <command> <path-to-ts>`);
}

const ARGS = /** @type {const} */ ({
  command: argv[0],
  path: argv[1],
});

const FILE_CONTENTS = fs.readFileSync(ARGS.path, { encoding: 'utf8' });

const SYMBOLS = new Set([
  '(', ')', '[', ']', '{', '}', '<', '>',
  '=',
  '+', '-',
  '|', '&', '||', '&&',
  '...', '.', ',', ':', ';',
  '=>', '?',
]);
const SYMBOLS_REVERSE_SORTED = Array.from(SYMBOLS).sort().reverse();

class Token {
  /**
   * @param {number} start 
   * @param {number} end 
   * @param {string} type 
   * @param {string} value 
   */
  constructor(start, end, type, value) {
    this.start = start;
    this.end = end;
    this.type = type;
    this.value = value;
  }
  toString() { return JSON.stringify(this); }
}

/**
 * @param {string} s
 * @returns {IterableIterator<Token>}
 */
function* lex(s) {

  /** @param {string} c */
  const isSpace = (c) => /\s/.test(c);

  /** @param {string} c */
  const isDigit = (c) => /[0-9]/.test(c);

  /** @param {string} c */
  const isHexDigit = (c) => /[0-9A-Fa-f]/.test(c);

  /** @param {string} c */
  const isWord = (c) => /[a-zA-Z0-9_]/.test(c);

  let i = 0;
  while (true) {
    while (i < s.length) {
      while (i < s.length && isSpace(s[i])) i++;
      if (s.startsWith('//', i)) {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      if (s.startsWith('/**/', i) || (s.startsWith('/*', i) && !s.startsWith('/**', i))) {
        i += 2;
        while (i < s.length && !s.startsWith('*/', i)) i++;
        i += 2;
        continue;
      }
      break;
    }
    if (i >= s.length) break;
    const start = i;
    if (s.startsWith('/**', i)) {
      i += 2;
      while (i < s.length && !s.startsWith('*/', i)) i++;
      i += 2;
      yield new Token(start, i, 'COMMENT', s.substring(start, i));
      continue;
    }
    if (s[i] === '"' || s[i] === "'" || s[i] === '`') {
      const quote = s[i];
      i++;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === '\\') i++;
        i++;
      }
      i++;
      yield new Token(start, i, 'STRING', s.substring(start, i));
      continue;
    }
    if (isDigit(s[i])) {
      if (s.startsWith('0x', i)) {
        i += 2;
        while (i < s.length && isHexDigit(s[i])) i++;
      } else {
        while (i < s.length && isDigit(s[i])) i++;
      }
      yield new Token(start, i, 'NUMBER', s.substring(start, i));
      continue;
    }
    if (isWord(s[i])) {
      while (i < s.length && isWord(s[i])) i++;
      yield new Token(start, i, 'NAME', s.substring(start, i));
      continue;
    }
    let symbolFound = false;
    for (const symbol of SYMBOLS_REVERSE_SORTED) {
      if (s.startsWith(symbol, i)) {
        i += symbol.length;
        yield new Token(start, i, symbol, '');
        symbolFound = true;
        break;
      }
    }
    if (symbolFound) continue;
    const line = [...s.substring(0, start)].reduce((t, c) => t + (c === '\n' ? 1 : 0), 1);
    while (i < s.length && !isSpace(s[i])) i++;
    throw new Error(`Unrecognized token on line ${line} (${start}-${i}): ${JSON.stringify(s.substring(start, i))}`);
  }
  yield new Token(i, i, 'EOF', '');
};

switch (ARGS.command) {
  case 'lex':
    for (const token of lex(FILE_CONTENTS)) {
      console.log(token);
    }
    break;
  default:
    throw new Error(`Unrecognized command ${JSON.stringify(ARGS.command)}`);
}
