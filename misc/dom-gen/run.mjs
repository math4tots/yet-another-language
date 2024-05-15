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
   * @param {string} s 
   * @param {number} start 
   * @param {number} end 
   * @param {string} type 
   * @param {string} value 
   */
  constructor(s, start, end, type, value) {
    /** @readonly */ this.s = s;
    /** @readonly */ this.range = new Range(start, end);
    /** @readonly */ this.type = type;
    /** @readonly */ this.value = value;
    Object.defineProperty(this, 's', { enumerable: false });
    Object.defineProperty(this, 'range', { enumerable: false });
  }
  get line() {
    const s = this.s.substring(0, this.range.start);
    return /** @type {number} */([...s].reduce((p, c) => p + (c === '\n' ? 1 : 0), 1));
  }
  toString() { return JSON.stringify(this); }
}

/**
 * @param {string} s
 * @returns {Generator<Token, Token, undefined>}
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
      yield new Token(s, start, i, 'COMMENT', s.substring(start, i));
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
      yield new Token(s, start, i, 'STRING', s.substring(start, i));
      continue;
    }
    if (isDigit(s[i])) {
      if (s.startsWith('0x', i)) {
        i += 2;
        while (i < s.length && isHexDigit(s[i])) i++;
      } else {
        while (i < s.length && isDigit(s[i])) i++;
      }
      yield new Token(s, start, i, 'NUMBER', s.substring(start, i));
      continue;
    }
    if (isWord(s[i])) {
      while (i < s.length && isWord(s[i])) i++;
      yield new Token(s, start, i, 'NAME', s.substring(start, i));
      continue;
    }
    let symbolFound = false;
    for (const symbol of SYMBOLS_REVERSE_SORTED) {
      if (s.startsWith(symbol, i)) {
        i += symbol.length;
        yield new Token(s, start, i, symbol, '');
        symbolFound = true;
        break;
      }
    }
    if (symbolFound) continue;
    const line = [...s.substring(0, start)].reduce((t, c) => t + (c === '\n' ? 1 : 0), 1);
    while (i < s.length && !isSpace(s[i])) i++;
    throw new Error(`Unrecognized token on line ${line} (${start}-${i}): ${JSON.stringify(s.substring(start, i))}`);
  }
  yield new Token(s, i, i, 'EOF', '');

  // Also return Token so that the generator value will always be Token regardless of whether it is finished
  return new Token(s, i, i, 'EOF', '');
};

/**
 * @typedef {Range | {range: Range}} Rangeable
 */

class Range {
  /**
   * @param {Rangeable[]} rs
   */
  static join(...rs) {
    const min = Math.min(...rs.map(r => r instanceof Range ? r.start : r.range.start));
    const max = Math.max(...rs.map(r => r instanceof Range ? r.end : r.range.end));
    return new Range(min, max);
  }

  /**
   * @param {number} start
   * @param {number} end
   */
  constructor(start, end) {
    /** @readonly */ this.start = start;
    /** @readonly */ this.end = end;
  }
}

/**
 * @typedef {Identifier | TypeSpecialForm | FunctionTypeDisplay} TypeExpression
 */

/**
 * @typedef {Identifier} Expression
 */

/**
 * @typedef {InterfaceDefinition |
*   VariableDeclaration} Statement
*/

/**
 * @typedef {Statement |
*   ComputedPropertyDeclaration} MemberStatement
*/

class Identifier {
  /**
   * @param {Range} range 
   * @param {string} name 
   */
  constructor(range, name) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.name = name;
  }
}

class TypeSpecialForm {
  /**
   * @param {Range} range 
   * @param {string} name 
   * @param {TypeExpression[]} args 
   */
  constructor(range, name, args) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.name = name;
    /** @readonly */ this.args = args;
  }
}

class FunctionTypeDisplay {
  /**
   * @param {Range} range 
   * @param {VariableDeclaration[]} parameters
   * @param {TypeExpression} returnType
   */
  constructor(range, parameters, returnType) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.parameters = parameters;
    /** @readonly */ this.returnType = returnType;
  }
}

class InterfaceDefinition {
  /**
   * @param {Range} range
   * @param {Token | undefined} comment
   * @param {Identifier} identifier
   * @param {TypeExpression[]} bases
   * @param {MemberStatement[]} body
   */
  constructor(range, comment, identifier, bases, body) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.bases = bases;
    /** @readonly */ this.body = body;
  }
}

class VariableDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {boolean} optional
   * @param {TypeExpression} type
   */
  constructor(range, comment, identifier, optional, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.optional = optional;
    /** @readonly */ this.type = type;
  }
}

class ComputedPropertyDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {TypeExpression} keyType
   * @param {TypeExpression} valueType
   */
  constructor(range, comment, identifier, keyType, valueType) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.keyType = keyType;
    /** @readonly */ this.valueType = valueType;
  }
}

/**
 * @param {string} s 
 */
function* parse(s) {
  const generator = lex(s);
  const tokens = /** @type {Token[]} */ ([]);
  const lookaheadStack = /** @type {Token[]} */ ([]);
  let { value: peek } = generator.next();
  let lastComment = /** @type {Token | undefined} */ (undefined);

  /** @return {Token} */
  const next = () => {
    const last = peek;
    tokens.push(last);
    const again = lookaheadStack.pop();
    if (again) peek = again;
    else ({ value: peek } = generator.next());
    if (last.type === 'COMMENT') lastComment = last;
    else lastComment = undefined;
    return last;
  };

  const save = () => tokens.length;

  /** @param {number} i */
  const restore = (i) => {
    while (tokens.length > i) {
      const token = tokens.pop();
      if (!token) break;
      lookaheadStack.push(peek);
      peek = token;
    }
  };

  /**
   * @typedef {string | string[] | undefined} Descriptor
   */

  /**
   * @param {Descriptor} descriptor
   * @param {string} value
   * @returns {boolean}
   */
  const matches = (descriptor, value) =>
    descriptor === undefined ? true :
      typeof descriptor === 'string' ? value === descriptor :
        descriptor.some(t => value === t);

  /**
   * @param {Descriptor} type
   * @param {Descriptor} value
   * @returns {boolean}
   */
  const at = (type, value = undefined) => matches(type, peek.type) && matches(value, peek.value);

  /**
   * @param {Descriptor} type
   * @param {Descriptor} value
   * @returns {boolean}
   */
  const consume = (type, value = undefined) => {
    if (at(type, value)) {
      next();
      return true;
    }
    return false;
  };

  /**
   * @param {Descriptor} type
   * @param {Descriptor} value
   * @returns {Token}
   */
  const expect = (type, value = undefined) => {
    if (!at(type, value)) throw new Error(`Line ${peek.line}: Expected ${JSON.stringify(type)} but got ${peek}`);
    return next();
  };

  const skip = (respectAngleBrackets = false) => {
    let depth = 0;
    do {
      const token = next();
      switch (token.type) {
        case '<': if (!respectAngleBrackets) break;
        case '(':
        case '[':
        case '{': depth++; break;
        case '>': if (!respectAngleBrackets) break;
        case ')':
        case ']':
        case '}': depth--; break;
      }
    } while (depth > 0);
  };

  function parseIdentifier() {
    if (!at('NAME')) throw new Error(`Line ${peek.line}: Expected identifier but got ${peek}`);
    const token = expect('NAME');
    return new Identifier(Range.join(token), token.value);
  }

  function parseParameter() {
    while (consume('COMMENT'));
    const comment = lastComment;
    const identifier = parseIdentifier();
    const optional = consume('?');
    expect(':');
    const type = parseTypeExpression();
    return new VariableDeclaration(Range.join(identifier, type), comment, identifier, optional, type);
  }

  function parseParameters() {
    expect('(');
    const parameters = /** @type {VariableDeclaration[]} */ ([]);
    while (!at(')')) {
      parameters.push(parseParameter());
      if (!consume(',')) break;
    }
    expect(')');
    return parameters;
  }

  /** @returns {TypeExpression} */
  function parsePrimaryTypeExpression() {
    const start = peek;
    if (at('(')) {
      const here = save();
      skip();
      if (at('=>')) { // function type
        restore(here);
        const parameters = parseParameters();
        expect('=>');
        const returnType = parseTypeExpression();
        return new FunctionTypeDisplay(Range.join(start, returnType), parameters, returnType);
      }
      restore(here);
      expect('(');
      const te = parseTypeExpression();
      expect(')');
      return te;
    }
    return parseIdentifier();
  }

  /** @returns {TypeExpression} */
  function parseTypeExpression() {
    let te = parsePrimaryTypeExpression();
    while (true) {
      if (consume('|')) {
        const rhs = parseTypeExpression();
        const args = /** @type {TypeExpression[]} */ ([]);
        for (const type of [te, rhs]) {
          if (type instanceof TypeSpecialForm && type.name === '|') args.push(...type.args);
          else args.push(type);
        }
        te = new TypeSpecialForm(Range.join(te, rhs), 'union', args);
        continue;
      }
      if (consume('[')) {
        const end = expect(']');
        te = new TypeSpecialForm(Range.join(te, end), 'array', [te]);
        continue;
      }
      if (consume('<')) {
        const args = /** @type {TypeExpression[]} */ ([]);
        while (!at('>')) {
          args.push(parseTypeExpression());
          if (!consume(',')) break;
        }
        const end = expect('>');
        te = new TypeSpecialForm(Range.join(te, end), 'reify', [te, ...args]);
        continue;
      }
      break;
    }
    return te;
  }

  function parseInterfaceDefinition() {
    const comment = lastComment;
    const start = expect('NAME', 'interface');
    const identifier = parseIdentifier();
    if (at('<')) skip(true); // For now skip type parameters
    const bases = /** @type {TypeExpression[]} */ ([]);
    if (consume('NAME', 'extends')) {
      do { bases.push(parseTypeExpression()); } while (consume(','));
    }
    const body = /** @type {MemberStatement[]} */ ([]);
    expect('{');
    while (!at(['EOF', '}'])) {
      body.push(parseMemberStatement());
    }
    const end = expect('}');
    return new InterfaceDefinition(Range.join(start, end), comment, identifier, bases, body);
  }

  /**
   * @returns {Statement}
   */
  function parseStatement() {
    while (consume('COMMENT'));
    if (at('NAME', 'interface')) return parseInterfaceDefinition();
    throw new Error(`Line ${peek.line}: Expected statement but got ${peek}`);
  }

  /**
   * @returns {MemberStatement}
  */
  function parseMemberStatement() {
    while (consume('COMMENT'));
    const comment = lastComment;
    const start = peek;
    if (at('NAME')) {
      const identifier = parseIdentifier();
      const optional = consume('?');
      expect(':');
      const type = parseTypeExpression();
      const end = expect(';');
      return new VariableDeclaration(Range.join(start, end), comment, identifier, optional, type);
    }
    if (consume('[')) {
      const identifier = parseIdentifier();
      expect(':');
      const keyType = parseTypeExpression();
      expect(']');
      expect(':');
      const valueType = parseTypeExpression();
      const end = expect(';');
      return new ComputedPropertyDeclaration(Range.join(start, end), comment, identifier, keyType, valueType);
    }
    throw new Error(`Line ${peek.line}: Expected member statement but got ${peek}`);
  }
  while (!at('EOF')) {
    yield parseStatement();
  }
};

switch (ARGS.command) {
  case 'lex':
    for (const token of lex(FILE_CONTENTS)) {
      console.log(token);
    }
    break;
  case 'parse':
    for (const node of parse(FILE_CONTENTS)) {
      console.log(node);
    }
    break;
  default:
    throw new Error(`Unrecognized command ${JSON.stringify(ARGS.command)}`);
};
