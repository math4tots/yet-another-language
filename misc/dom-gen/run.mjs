// @ts-check

// Utility for translating typescript annotations to YAL

import fs from 'fs';
import util from 'util';

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
   * @param {(Rangeable | undefined)[]} rs
   */
  static join(...rs) {
    const rr = /** @type {Rangeable[]} */ ([]);
    for (const r of rs) {
      if (r !== undefined) rr.push(r);
    }
    const min = Math.min(...rr.map(r => r instanceof Range ? r.start : r.range.start));
    const max = Math.max(...rr.map(r => r instanceof Range ? r.end : r.range.end));
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
 * @typedef {PossiblyQualifiedIdentifier
 * |TypeSpecialForm
 * |LiteralTypeDisplay
 * |RecordTypeDisplay
 * |FunctionTypeDisplay} TypeExpression
 */

/**
 * @typedef {Identifier | QualifiedIdentifier} PossiblyQualifiedIdentifier
 */

/**
 * @typedef {Identifier} Expression
 */

/**
 * @typedef {UnknownStatement | VariableDeclaration | FunctionDeclaration} StatementCommon
 */

/**
 * @typedef {StatementCommon | InterfaceDefinition | TypeAliasDeclaration | NamespaceDeclaration} Statement
 */

/**
 * @typedef {StatementCommon | ComputedPropertyDeclaration | SpecialFunctionDeclaration} MemberStatement
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

class QualifiedIdentifier {
  /**
   * @param {Range} range 
   * @param {Identifier} qualifier 
   * @param {Identifier} member 
   */
  constructor(range, qualifier, member) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.qualifier = qualifier;
    /** @readonly */ this.member = member;
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

class LiteralTypeDisplay {
  /**
   * @param {Range} range 
   * @param {Token} token
   */
  constructor(range, token) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.token = token;
  }
}

class RecordTypeDisplay {
  /**
   * @param {Range} range 
   * @param {MemberStatement[]} body
   */
  constructor(range, body) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.body = body;
  }
}

class FunctionTypeDisplay {
  /**
   * @param {Range} range 
   * @param {Parameter[]} parameters
   * @param {TypeExpression | undefined} returnType
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
   * @param {TypeParameter[] | undefined} typeParameters
   * @param {TypeExpression[]} bases
   * @param {MemberStatement[]} body
   */
  constructor(range, comment, identifier, typeParameters, bases, body) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.typeParameters = typeParameters;
    /** @readonly */ this.bases = bases;
    /** @readonly */ this.body = body;
  }
}

class VariableDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {boolean} isReadonly
   * @param {Identifier} identifier 
   * @param {boolean} optional
   * @param {TypeExpression} type
   */
  constructor(range, comment, isReadonly, identifier, optional, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.isReadonly = isReadonly;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.optional = optional;
    /** @readonly */ this.type = type;
  }
}

class NamespaceDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {Statement[]} body
   */
  constructor(range, comment, identifier, body) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.body = body;
  }
}

class TypeParameter {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {TypeExpression | undefined} base
   * @param {TypeExpression | undefined} defaultType
   */
  constructor(range, comment, identifier, base, defaultType) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.base = base;
    /** @readonly */ this.defaultType = defaultType;
  }
}

class Parameter {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {boolean} isVariadic
   * @param {Identifier} identifier 
   * @param {boolean} optional
   * @param {TypeExpression} type
   */
  constructor(range, comment, isVariadic, identifier, optional, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.isVariadic = isVariadic;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.optional = optional;
    /** @readonly */ this.type = type;
  }
}

class FunctionDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {boolean} optional
   * @param {TypeParameter[] | undefined} typeParameters
   * @param {TypeExpression} type
   */
  constructor(range, comment, identifier, optional, typeParameters, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.optional = optional;
    /** @readonly */ this.typeParameters = typeParameters;
    /** @readonly */ this.type = type;
  }
}

class SpecialFunctionDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {string} kind
   * @param {Identifier} identifier 
   * @param {TypeExpression} type
   */
  constructor(range, comment, kind, identifier, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.kind = kind;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.type = type;
  }
}

class TypeAliasDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {Identifier} identifier 
   * @param {TypeParameter[] | undefined} typeParameters
   * @param {TypeExpression} type
   */
  constructor(range, comment, identifier, typeParameters, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.typeParameters = typeParameters;
    /** @readonly */ this.type = type;
  }
}

class UnknownStatement {
  /**
   * @param {Range} range 
   * @param {Identifier} identifier
   */
  constructor(range, identifier) {
    this.range = range;
    this.identifier = identifier;
  }
}

class ComputedPropertyDeclaration {
  /**
   * @param {Range} range 
   * @param {Token | undefined} comment
   * @param {boolean} isReadonly 
   * @param {Identifier} identifier 
   * @param {TypeExpression} keyType
   * @param {TypeExpression} valueType
   */
  constructor(range, comment, isReadonly, identifier, keyType, valueType) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.isReadonly = isReadonly;
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
   * @param {number} offset 
   */
  const peekAhead = offset => {
    if (offset === 0) return peek;
    const saved = save();
    try {
      while (offset > 0 && !at('EOF')) {
        next();
        offset--;
      }
      return peek;
    } finally {
      restore(saved);
    }
  };

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

  function parsePossiblyQualifiedIdentifier() {
    const firstIdentifier = parseIdentifier();
    if (consume('.')) {
      const member = parseIdentifier();
      return new QualifiedIdentifier(Range.join(firstIdentifier, member), firstIdentifier, member);
    }
    return firstIdentifier;
  }

  function parseNumberLiteralAsIdentifier() {
    if (!at('NUMBER')) throw new Error(`Line ${peek.line}: Expected (number literal) identifier but got ${peek}`);
    const token = expect('NUMBER');
    return new Identifier(Range.join(token), token.value);
  }

  function parseStringLiteralAsIdentifier() {
    if (!at('STRING')) throw new Error(`Line ${peek.line}: Expected (string literal) identifier but got ${peek}`);
    const token = expect('STRING');
    return new Identifier(Range.join(token), token.value);
  }

  function parseTypeParameter() {
    while (consume('COMMENT'));
    const comment = lastComment;
    const identifier = parseIdentifier();
    const base = consume('NAME', 'extends') ? parseTypeExpression() : undefined;
    const defaultType = consume('=') ? parseTypeExpression() : undefined;
    return new TypeParameter(Range.join(identifier, base), comment, identifier, base, defaultType);
  }

  function parseTypeParameters() {
    expect('<');
    const tps = /** @type {TypeParameter[]} */ ([]);
    while (!at('>')) {
      tps.push(parseTypeParameter());
      if (!consume(',')) break;
    }
    expect('>');
    return tps;
  }

  function parseParameter() {
    while (consume('COMMENT'));
    const comment = lastComment;
    const isVariadic = consume('...');
    const identifier = parseIdentifier();
    const optional = consume('?');
    expect(':');
    const type = parseTypeExpression();
    return new Parameter(Range.join(identifier, type), comment, isVariadic, identifier, optional, type);
  }

  function parseParameters() {
    expect('(');
    const parameters = /** @type {Parameter[]} */ ([]);
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
    if (consume('[')) {
      const args = /** @type {TypeExpression[]} */ ([]);
      while (!at(']')) {
        args.push(parseTypeExpression());
        if (!consume(',')) break;
      }
      const end = expect(']');
      return new TypeSpecialForm(Range.join(start, end), 'tuple', args);
    }
    if (at('{')) {
      const { body, end } = parseInterfaceBody();
      return new RecordTypeDisplay(Range.join(start, end), body);
    }
    if (consume('...')) {
      const inner = parseTypeExpression();
      return new TypeSpecialForm(Range.join(start, inner), 'splat', [inner]);
    }
    if (consume('-')) {
      const token = expect('NUMBER');
      return new LiteralTypeDisplay(
        token.range, new Token(token.s, token.range.start, token.range.end, token.type, '-' + token.value));
    }
    if (at(['STRING', 'NUMBER'])) {
      const token = next();
      return new LiteralTypeDisplay(token.range, token);
    }
    if (at('NAME', ['new', 'readonly', 'in', 'abstract'])) {
      const kind = next().value;
      if (at('<')) skip(true); // skip type parameters
      const arg = parseTypeExpression();
      return new TypeSpecialForm(Range.join(start, arg), kind, [arg]);
    }
    if (at('NAME', ['typeof', 'keyof', 'infer'])) {
      const kind = next().value;
      const possiblyQualifiedIdentifier = parsePossiblyQualifiedIdentifier();
      return new TypeSpecialForm(Range.join(start, possiblyQualifiedIdentifier), kind, [possiblyQualifiedIdentifier]);
    }
    if (at('NAME')) {
      return parsePossiblyQualifiedIdentifier();
    }
    throw new Error(`Line ${peek.line}: Expected type expression but got ${peek}`);
  }

  /** @returns {TypeExpression} */
  function parseTypeExpression() {
    let te = parsePrimaryTypeExpression();
    while (true) {
      if (consume('|')) {
        const rhs = parseTypeExpression();
        const args = /** @type {TypeExpression[]} */ ([]);
        for (const type of [te, rhs]) {
          if (type instanceof TypeSpecialForm && type.name === 'union') args.push(...type.args);
          else args.push(type);
        }
        te = new TypeSpecialForm(Range.join(te, rhs), 'union', args);
        continue;
      }
      if (consume('&')) {
        const rhs = parseTypeExpression();
        const args = /** @type {TypeExpression[]} */ ([]);
        for (const type of [te, rhs]) {
          if (type instanceof TypeSpecialForm && type.name === '&') args.push(...type.args);
          else args.push(type);
        }
        te = new TypeSpecialForm(Range.join(te, rhs), 'intersect', args);
        continue;
      }
      if (consume('[')) {
        if (at(']')) {
          const end = expect(']');
          te = new TypeSpecialForm(Range.join(te, end), 'array', [te]);
          continue;
        }
        const args = /** @type {TypeExpression[]} */ ([]);
        while (!at(']')) {
          args.push(parseTypeExpression());
          if (!consume(',')) break;
        }
        const end = expect(']');
        te = new TypeSpecialForm(Range.join(te, end), 'subscript', [te, ...args]);
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
      if (at('NAME', ['extends', 'is'])) {
        const kind = next().value;
        const rhs = parseTypeExpression();
        te = new TypeSpecialForm(Range.join(te, rhs), kind, [te, rhs]);
        continue;
      }
      if (consume('?')) {
        const lhs = parseTypeExpression();
        expect(':');
        const rhs = parseTypeExpression();
        te = new TypeSpecialForm(Range.join(te, rhs), 'conditional', [te, lhs, rhs]);
        continue;
      }
      break;
    }
    return te;
  }

  function parseInterfaceBody() {
    const body = /** @type {MemberStatement[]} */ ([]);
    const start = expect('{');
    while (!at(['EOF', '}'])) {
      body.push(parseMemberStatement());
    }
    const end = expect('}');
    return { start, body, end };
  }

  function parseInterfaceDefinition() {
    const comment = lastComment;
    const start = expect('NAME', 'interface');
    const identifier = parseIdentifier();
    const typeParameters = at('<') ? parseTypeParameters() : undefined;
    const bases = /** @type {TypeExpression[]} */ ([]);
    if (consume('NAME', 'extends')) {
      do { bases.push(parseTypeExpression()); } while (consume(','));
    }
    const { body, end } = parseInterfaceBody();
    return new InterfaceDefinition(Range.join(start, end), comment, identifier, typeParameters, bases, body);
  }

  /**
   * @param {Token | undefined} comment 
   * @param {Rangeable} start 
   */
  function parseTypeAliasDeclaration(comment, start) {
    expect('NAME', 'type');
    const identifier = parseIdentifier();
    const typeParameters = at('<') ? parseTypeParameters() : undefined;
    expect('=');
    const type = parseTypeExpression();
    expect(';');
    return new TypeAliasDeclaration(Range.join(start, type), comment, identifier, typeParameters, type);
  }

  /**
   * @param {Token | undefined} comment 
   * @param {Rangeable} start 
   */
  function parseVariableDeclaration(comment, start) {
    const isReadonly = consume('NAME', 'const') || (expect('NAME', 'var'), false);
    const identifier = parseIdentifier();
    expect(':');
    const type = parseTypeExpression();
    const end = expect(';');
    return new VariableDeclaration(Range.join(start, end), comment, isReadonly, identifier, false, type);
  }

  /**
   * @param {Token | undefined} comment 
   * @param {Rangeable} start 
   */
  function parseFunctionDeclaration(comment, start) {
    expect('NAME', 'function');
    const identifier = parseIdentifier();
    const optional = consume('?');
    const typeParameters = at('<') ? parseTypeParameters() : undefined;
    const parameters = parseParameters();
    expect(':');
    const returnType = parseTypeExpression();
    const end = expect(';');
    return new FunctionDeclaration(Range.join(start, end), comment, identifier, optional, typeParameters,
      new FunctionTypeDisplay(Range.join(start, end), parameters, returnType));
  }

  /**
   * @param {Token | undefined} comment 
   * @param {Rangeable} start 
   */
  function parseNamespaceDeclaration(comment, start) {
    expect('NAME', 'namespace');
    const identifier = parseIdentifier();
    const body = /** @type {Statement[]} */ ([]);
    expect('{');
    while (!at('}')) {
      body.push(parseStatement());
    }
    const end = expect('}');
    return new NamespaceDeclaration(Range.join(start, end), comment, identifier, body);
  }

  /**
   * @returns {Statement}
   */
  function parseStatement() {
    while (consume('COMMENT'));
    if (at('NAME', 'interface')) return parseInterfaceDefinition();
    const comment = lastComment;
    const start = peek;
    if (at('NAME', ['var', 'const'])) return parseVariableDeclaration(comment, start);
    if (at('NAME', 'namespace')) return parseNamespaceDeclaration(comment, start);
    if (at('NAME', 'function')) return parseFunctionDeclaration(comment, start);
    if (at('NAME', 'type')) return parseTypeAliasDeclaration(comment, start);
    if (consume('NAME', 'declare')) {
      if (at('NAME', ['var', 'const'])) return parseVariableDeclaration(comment, start);
      if (at('NAME', 'namespace')) return parseNamespaceDeclaration(comment, start);
      if (at('NAME', 'function')) return parseFunctionDeclaration(comment, start);
      if (at('NAME', 'type')) return parseTypeAliasDeclaration(comment, start);
      throw new Error(`Line ${peek.line}: Expected declare type but got ${peek}`);
    }
    throw new Error(`Line ${peek.line}: Expected statement but got ${peek}`);
  }

  /**
   * @returns {MemberStatement}
  */
  function parseMemberStatement() {
    while (consume('COMMENT'));
    const comment = lastComment;
    const start = peek;
    if (at('NAME', ['get', 'set']) && peekAhead(1).type === 'NAME') {
      const kind = expect('NAME').value;
      const identifier = parseIdentifier();
      const parameters = parseParameters();
      const returnType = consume(':') ? parseTypeExpression() : undefined;
      const end = expect(';');
      return new SpecialFunctionDeclaration(Range.join(start, end), comment, kind, identifier,
        new FunctionTypeDisplay(Range.join(start, end), parameters, returnType));
    }
    const isReadonly = consume('NAME', 'readonly');
    if (at(['NAME', 'NUMBER', 'STRING', '(', '<'])) {
      const identifier = at(['(', '<']) ?
        new Identifier(peek.range, '') :
        at('NUMBER') ? parseNumberLiteralAsIdentifier() :
          at('STRING') ? parseStringLiteralAsIdentifier() :
            parseIdentifier();
      const optional = consume('?');
      if (!isReadonly && at(['(', '<'])) {
        const typeParameters = at('<') ? parseTypeParameters() : undefined;
        const parameters = parseParameters();
        expect(':');
        const returnType = parseTypeExpression();
        const end = expect(';');
        return new FunctionDeclaration(Range.join(start, end), comment, identifier, optional, typeParameters,
          new FunctionTypeDisplay(Range.join(start, end), parameters, returnType));
      }
      expect(':');
      const type = parseTypeExpression();
      const end = expect(';');
      return new VariableDeclaration(Range.join(start, end), comment, isReadonly, identifier, optional, type);
    }
    if (consume('[')) {
      const identifier = parseIdentifier();
      if (consume('NAME', 'in')) {
        // bleh. more unexpected syntax. skip these for now
        parseTypeExpression(); // key type
        expect(']');
        consume('-'); // WTH? but this appears in lib.es5.d.ts
        consume('?');
        expect(':');
        const end = parseTypeExpression(); // value type
        expect(';');
        return new UnknownStatement(Range.join(start, end), new Identifier(Range.join(start, end), 'computed-property-in'));
      }
      expect(':');
      const keyType = parseTypeExpression();
      expect(']');
      expect(':');
      const valueType = parseTypeExpression();
      const end = expect(';');
      return new ComputedPropertyDeclaration(Range.join(start, end), comment, isReadonly, identifier, keyType, valueType);
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
      console.log(util.inspect(node, { showHidden: false, depth: null, colors: process.stdout.hasColors && process.stdout.hasColors() }));
    }
    break;
  case 'list':
    for (const node of parse(FILE_CONTENTS)) {
      console.log(`${node.constructor.name} ${node.identifier.name}`);
    }
    break;
  default:
    throw new Error(`Unrecognized command ${JSON.stringify(ARGS.command)}`);
};
