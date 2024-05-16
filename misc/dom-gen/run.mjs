// @ts-check

// Utility for translating typescript annotations to YAL

import fs from 'fs';
import path from 'path';
import util from 'util';

const argv = process.argv.splice(2);

if (argv.length !== 2) {
  throw new Error(`Usage: ${process.argv[0]} ${process.argv[1]} <command> <path-to-ts>`);
}

const ARGS = /** @type {const} */ ({
  command: argv[0],
  path: argv[1],
});

const BASENAME = path.basename(ARGS.path);

const EXPORT_AS_MAP = new Map([
  ['lib.es5.d.ts', 'js'],
  ['lib.dom.d.ts', 'dom'],
]);

const NATIVE_CONSTEXPR_BASENAMES = new Set([
  'lib.es5.d.ts',
]);

const BASENAMES_INCLUDING_INTERFACE_ONLY_TYPES = new Set([
  'lib.dom.d.ts',
]);

const TYPE_ALIAS_BLACKLIST_TABLE = new Map([
  ['lib.dom.d.ts', new Set([
    "IDBValidKey",
  ])],
]);

const INTERFACE_ONLY_TYPE_WHITELIST_TABLE = new Map([
  ['lib.es5.d.ts', new Set([
    "ArrayBufferView",
  ])],
]);

const INTERFACE_ONLY_TYPE_WHITELIST = INTERFACE_ONLY_TYPE_WHITELIST_TABLE.get(BASENAME);
const TABLE_ALIAS_BLACKLIST = TYPE_ALIAS_BLACKLIST_TABLE.get(BASENAME);


const FILE_CONTENTS = fs.readFileSync(ARGS.path, { encoding: 'utf8' });

const USE_NATIVE_CONSTEXPR = NATIVE_CONSTEXPR_BASENAMES.has(BASENAME);
const INCLUDE_ALL_INTERFACE_ONLY_TYPES = BASENAMES_INCLUDING_INTERFACE_ONLY_TYPES.has(BASENAME);

const COVARIANT = 1;
const CONTRAVARIANT = -1;
const INVARIANT = 0;

/** @typedef {typeof COVARIANT | typeof CONTRAVARIANT | typeof INVARIANT} Variance */

/** @param {Variance} variance */
const flipVariance = variance => /** @type {Variance} */(-variance);

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
   * @param {TypeParameter[] | undefined} typeParameters
   * @param {Parameter[]} parameters
   * @param {TypeExpression | undefined} returnType
   */
  constructor(range, typeParameters, parameters, returnType) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.typeParameters = typeParameters;
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
   * @param {FunctionTypeDisplay} type
   */
  constructor(range, comment, identifier, optional, type) {
    /** @readonly */ this.range = range;
    /** @readonly */ this.comment = comment;
    /** @readonly */ this.identifier = identifier;
    /** @readonly */ this.optional = optional;
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
    this.comment = undefined;
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
        return new FunctionTypeDisplay(Range.join(start, returnType), undefined, parameters, returnType);
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
    return new FunctionDeclaration(Range.join(start, end), comment, identifier, optional,
      new FunctionTypeDisplay(Range.join(start, end), typeParameters, parameters, returnType));
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
        new FunctionTypeDisplay(Range.join(start, end), undefined, parameters, returnType));
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
        return new FunctionDeclaration(Range.join(start, end), comment, identifier, optional,
          new FunctionTypeDisplay(Range.join(start, end), typeParameters, parameters, returnType));
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

/**
 * @param {string} s
 * @param {number} depth
 */
function formatCommentString(s, depth) {
  if (s.startsWith('/**')) s = s.slice('/**'.length);
  if (s.endsWith('*/')) s = s.slice(0, s.length - '*/'.length);
  s = s.replace(/\n[ ]*\* /g, '\n\n');
  s = '\n' + s.trim() + '\n';
  s = s.replace(/\n/g, '\n' + '  '.repeat(depth));
  return s;
}

class Sink {
  /**
   * @param {(text: string) => void} write 
   */
  constructor(write) {
    /** @readonly */ this._write = write;
    this._depth = 0;
  }

  /**
   * @template R
   * @param {() => R} f
   * @param {number} depth
   * @returns {R}
   */
  nest(f, depth = 1) {
    const oldDepth = this._depth;
    this._depth += depth;
    try {
      return f();
    } finally {
      this._depth = oldDepth;
    }
  }

  startLine() {
    this._write('  '.repeat(this._depth));
  }

  endLine() {
    this._write('\n');
  }

  /** @param {string} s */
  write(s) {
    this._write(s);
  }

  /** @param {string} s */
  line(s) {
    this.startLine();
    this.write(s);
    this.endLine();
  }

  /** @param {Token | undefined} comment */
  writeBlockComment(comment) {
    if (comment) {
      this.startLine();
      this.writeInlineComment(comment);
      this.endLine();
    }
  }

  /** @param {Token | undefined} comment */
  writeInlineComment(comment) {
    if (comment) {
      this.write('"""');
      this.write(formatCommentString(comment.value, this._depth));
      this.write('"""');
    }
  }
}

/**
 * @typedef {{identifier: Identifier, interfaces: InterfaceDefinition[], declarations: VariableDeclaration[]}} SymbolInfo
 */

/**
 * @param {Sink} out
 * @param {string[]} sources
 */
function translate(out, ...sources) {
  let currentThis = 'Any';
  const stringEnumMap = /** @type {Map<string, string>} */ (new Map());
  const deferredTypeAliases = /** @type {TypeAliasDeclaration[]} */ ([]);

  out.line('"""');
  out.line('AUTOGENERATED FROM ' + BASENAME);
  out.line('WITH dom-gen/run.mjs');
  out.line('"""');
  out.line(`export as ${EXPORT_AS_MAP.get(BASENAME)}`);

  const prefix = PREFIX_MAP.get(BASENAME);
  if (prefix) out.write(prefix);

  const globalsMap = /** @type {Map<string, SymbolInfo>} */ (new Map());
  for (const source of sources) {
    for (const statement of parse(source)) {
      if (statement instanceof InterfaceDefinition || statement instanceof VariableDeclaration) {
        const info = globalsMap.get(statement.identifier.name) || { identifier: statement.identifier, interfaces: [], declarations: [] };
        globalsMap.set(statement.identifier.name, info);
        if (statement instanceof InterfaceDefinition) {
          info.interfaces.push(statement);
        } else if (statement instanceof VariableDeclaration) {
          info.declarations.push(statement);
        }
      } else if (statement instanceof TypeAliasDeclaration) {
        const name = statement.identifier.name;
        if (statement.typeParameters) continue; // skip type aliases with type parameters
        if (TABLE_ALIAS_BLACKLIST?.has(name)) continue;
        const type = statement.type;
        if (type instanceof TypeSpecialForm && type.name === 'union') {
          if (type.args.every(arg => arg instanceof LiteralTypeDisplay && (
            arg.token.type === 'NUMBER' || (
              arg.token.type === 'STRING' && /^"[^"]*"$/.test(arg.token.value))))) {
            const literalDisplays = /** @type {LiteralTypeDisplay[]} */ (type.args);
            out.line(`export enum ${name} {`);
            out.nest(() => {
              for (let i = 0; i < literalDisplays.length; i++) {
                const literalDisplay = literalDisplays[i];
                const simpleNameMatch = /^"([a-zA-Z]\w*)"$/.exec(literalDisplay.token.value);
                const simpleName = simpleNameMatch && simpleNameMatch[1];
                const name = simpleName ? simpleName : `_value${i}`;
                out.line(`const ${name} = ${literalDisplay.token.value}`);
              }
            });
            out.line(`}`);
            continue;
          }
        }
        deferredTypeAliases.push(statement);
      }
    }
  }

  /**
   * @param {TypeExpression} type 
   * @param {Variance} variance
   */
  function translateType(type, variance = INVARIANT) {
    if (type instanceof Identifier) {
      switch (type.name) {
        case 'boolean': return 'Bool';
        case 'number': return 'Number';
        case 'string': return 'String';
        case 'symbol': return 'Any'; // dunno if I care about Symbols yet
        case 'undefined': case 'null': return 'Null';
        case 'Object': case 'object': case 'any': return 'Any';
        case 'void': return 'Null';
        case 'unknown': return 'Any';
        case 'this': return currentThis;
        case 'ArrayBufferLike': return 'ArrayBuffer';
      }
      return type.name;
    }
    if (type instanceof QualifiedIdentifier) {
      if (type.qualifier.name === 'Intl') { // hack this case for now
        switch (type.member.name) {
          case 'CollatorOptions':
          case 'NumberFormatOptions':
          case 'DateTimeFormatOptions':
            return `${type.qualifier.name}${type.member.name}`;
        }
      }
    }
    if (type instanceof FunctionTypeDisplay) {
      if (type.typeParameters) return 'Any';
      const returnType = type.returnType ? translateType(type.returnType) : 'Any';
      return `function${translateParameters(type.parameters)}: ${returnType}`;
    }
    if (type instanceof TypeSpecialForm) {
      switch (type.name) {
        case 'array':
          if (type.args.length === 1) return `List[${translateType(type.args[0])}]`;
        case 'union': {
          const members = new Set();
          const stack = Array.from(type.args).reverse();
          while (true) {
            const arg = stack.pop();
            if (arg === undefined) break;
            if (arg instanceof TypeSpecialForm && arg.name === 'union') {
              stack.push(...Array.from(arg.args).reverse());
            } else {
              const argstr = translateType(arg);
              if (argstr === 'Any') return 'Any';
              members.add(argstr);
            }
          }
          const args = Array.from(members);
          if (args.length === 0) return 'Never';
          if (args.length === 1) return args[0];
          return `Union[${args.join(', ')}]`;
        }
        case 'intersect':
          // TODO: some better type
          return type.args.length === 0 ? 'Never' : translateType(type.args[0]);
        case 'nullable':
          if (type.args.length === 1) {
            return `Nullable[${translateType(type.args[0])}]`;
          }
          break;
        case 'is':
          // YAL does not have a fancy enough type system to take advantage of 'is' style type
          // annotations in typescript
          return 'Bool';
        case 'reify': {
          if (type.args.length === 0) { // defensive
            console.warn(`FUBAR: reify special form with zero args`);
            return 'Any';
          }
          const f = type.args[0];
          if (f instanceof Identifier) {
            switch (f.name) {
              case 'ReadonlyArray':
                if (type.args.length === 2) {
                  const arg = translateType(type.args[1], COVARIANT);
                  return `List[${arg}]`;
                }
                break;
              case 'ArrayLike':
                if (type.args.length === 2) {
                  const arg = translateType(type.args[1]);
                  return `List[${arg}]`;
                }
                break;
              case 'Promise':
              case 'PromiseLike':
                if (type.args.length === 2) {
                  const arg = translateType(type.args[1]);
                  return `Promise[${arg}]`;
                }
                break;
              case 'HTMLCollectionOf':
                if (type.args.length === 2) {
                  // This is basically a generic collection type...
                  // since we don't support arbitrary generic types, and because
                  // there already exists a non-generic base type, return the
                  // non-generic type instead
                  return 'HTMLCollection';
                }
              case 'NodeListOf':
                if (type.args.length === 2) {
                  // This is basically a generic collection type...
                  // since we don't support arbitrary generic types, and because
                  // there already exists a non-generic base type, return the
                  // non-generic type instead
                  return 'NodeList';
                }
              case 'Exclude':
                // No way my type system is going to support fancy things like
                // 'Exclude' anytime soon
                return 'Any';
            }
          }
        }
      }
    }
    if (type instanceof LiteralTypeDisplay) {
      if (type.token.type === 'STRING') {
        if (type.token.value.startsWith('`')) {
          // some magic may be involved. Just return String
          return 'String';
        }
        const contentMatch = /^"([^"]*)"$/.exec(type.token.value);
        if (contentMatch && contentMatch[1] !== undefined) {
          const content = contentMatch[1];
          const cachedTypeName = stringEnumMap.get(content);
          if (cachedTypeName) return cachedTypeName;
          const simpleNameMatch = /^"([a-zA-Z]\w*)"$/.exec(type.token.value);
          const simpleName = (simpleNameMatch && simpleNameMatch[1]) ? simpleNameMatch[1] : undefined;
          const typeName = simpleName ? `_SString${simpleName}` : `_XString${stringEnumMap.size}`;
          stringEnumMap.set(content, typeName);
          return typeName;
        }
      }
      if (variance == COVARIANT) {
        if (type.token.type === 'NUMBER') return 'Number';
        else if (type.token.type === 'STRING') return 'String';
      }
    }
    console.warn(`UNHANDLED TYPE TRANSLATION:`, type);
    return 'Any';
  }

  /**
   * @param {VariableDeclaration} member
   */
  function translateMemberVariable(member) {
    const name = member.identifier.name;
    if (!/^[A-Za-z_]\w*$/.test(name)) return; // skip any field that does not have a "normal" name
    const storageClass = member.isReadonly ? 'const' : 'var';
    let type = member.type;
    if (member.optional) {
      type = new TypeSpecialForm(type.range, 'nullable', [type]);
    }
    const typestr = translateType(type, member.isReadonly ? COVARIANT : INVARIANT);
    const comment = member.comment ? `"""${formatCommentString(member.comment.value, out._depth)}""" ` : '';
    out.line(`${storageClass} ${name}: ${typestr} ${comment}= aliasFor(__js_${name})`);
  }

  /** @param {Parameter} parameter */
  function translateParameter(parameter) {
    const type = parameter.type;
    return `${parameter.identifier.name}: ${translateType(type)}`;
  }

  /** @param {Parameter[]} parameters */
  function translateParameters(parameters) {
    return `(${parameters.map(p => translateParameter(p)).join(', ')})`;
  }

  /**
   * @param {FunctionDeclaration} member
   */
  function translateMemberFunction(member) {
    if (member.optional) return;
    if (member.type.typeParameters) return;
    if (member.type.parameters.some(p => p.isVariadic)) return;
    let comment = member.comment;
    const name = member.identifier.name;
    const yalName = name === '' ? '__call__' : name;
    const opName = name === '' ? '__call__' :
      name === 'new' ? '__op_new__' :
        `__js_${name}`;
    const returnType = member.type.returnType ? `: ${translateType(member.type.returnType)}` : '';

    const parameters = [...member.type.parameters];
    while (true) {
      const header = `function ${yalName}${translateParameters(parameters)}${returnType}`;
      if (comment) {
        out.line(`${header} {`);
        out.nest(() => {
          out.writeBlockComment(comment);
          out.line(`aliasFor(${opName})`);
        });
        out.line(`}`);
      } else {
        out.line(`${header} { aliasFor(${opName}) }`);
      }
      if (parameters.length > 0 && parameters[parameters.length - 1].optional) {
        comment = undefined;
        parameters.pop();
        continue;
      }
      break;
    }
  }

  /**
   * @param {MemberStatement} member 
   */
  function translateMember(member) {
    const comment = member.comment;
    if (comment && comment.value.includes('@deprecated')) return;
    if (member instanceof VariableDeclaration) translateMemberVariable(member);
    else if (member instanceof FunctionDeclaration) translateMemberFunction(member);
  }

  for (const info of globalsMap.values()) {
    const name = info.identifier.name;
    let comment = /** @type {Token | undefined} */ (undefined);
    const superTypes = /** @type {Set<string>} */ (new Set());
    const staticMembers = /** @type {MemberStatement[]} */ ([]);
    const instanceMembers = /** @type {MemberStatement[]} */ ([]);
    if (info.declarations.length === 0) {
      // interface only types
      if (!INCLUDE_ALL_INTERFACE_ONLY_TYPES && !INTERFACE_ONLY_TYPE_WHITELIST?.has(name)) continue;
      let atLeastOneValidDefinition = false;
      for (const iface of info.interfaces) {
        if (iface.typeParameters) continue;
        atLeastOneValidDefinition = true;
        instanceMembers.push(...iface.body);
        for (const base of iface.bases) superTypes.add(translateType(base));
      }
      if (!atLeastOneValidDefinition) continue; // no valid definitions
    } else {
      if (info.declarations.length !== 1) continue;
      const declaration = info.declarations[0];
      const decltype = declaration.type; // I know, I know
      if (decltype instanceof Identifier && !globalsMap.has(decltype.name)) continue;

      // static members from declarations
      comment ??= declaration.comment;
      if (decltype instanceof Identifier) {
        const singletonInfo = globalsMap.get(decltype.name);
        for (const iface of singletonInfo?.interfaces || []) {
          if (iface.typeParameters) continue;
          staticMembers.push(...iface.body);
        }
      } else if (decltype instanceof RecordTypeDisplay) {
        staticMembers.push(...decltype.body);
      }

      // instance members from interface declarations
      // if the declared variable name matches the type name, we skip this
      if (decltype instanceof Identifier && decltype.name === name) {
        // skip - these were already added as static members
      } else {
        for (const iface of info.interfaces) {
          if (iface.typeParameters) continue;
          comment ??= iface.comment;
          instanceMembers.push(...iface.body);
          for (const base of iface.bases) superTypes.add(translateType(base));
        }
      }
    }

    superTypes.delete('Any');
    const extendsFragment = superTypes.size > 0 ? ` extends ${[...superTypes].join(', ')}` : '';
    out.line(`export interface ${name}${extendsFragment} {`);
    out.nest(() => {
      out.writeBlockComment(comment);
      if (info.declarations.length > 0) {
        out.line('static {');
        out.nest(() => {
          out.line(`aliasFor(native ${USE_NATIVE_CONSTEXPR ? 'constexpr ' : ''}"${name}")`);
          for (const member of staticMembers) {
            translateMember(member);
          }
        });
        out.line('}');
      }
      const oldCurrentThis = currentThis;
      currentThis = name;
      try {
        for (const member of instanceMembers) {
          translateMember(member);
        }
      } finally {
        currentThis = oldCurrentThis;
      }
    });
    out.line('}');
  }

  // handle deferred type aliases
  for (const decl of deferredTypeAliases) {
    const name = decl.identifier.name;
    const type = decl.type;
    out.line(`typedef ${name} = ${translateType(type)}`);
  }

  // emit all the generated enums
  for (const [value, typeName] of stringEnumMap) {
    out.line(`enum ${typeName} { const value = "${value}" }`);
  }

  const suffix = SUFFIX_MAP.get(BASENAME);
  if (suffix) out.write(suffix);
}

const PREFIX_MAP = new Map([
  ['lib.dom.d.ts', `
from './js' import ArrayBuffer
from './js' import ArrayBufferView
from './js' import Date
from './js' import Error
from './js' import Float32Array
from './js' import Float64Array
from './js' import Function
from './js' import Int32Array
from './js' import Uint32Array
from './js' import Uint8Array
from './js' import Uint8ClampedArray

`],
]);

const SUFFIX_MAP = new Map([
  ['lib.es5.d.ts', `
typedef PropertyKey = String | Number

interface PropertyDescriptor {
  "TODO"
}

interface PropertyDescriptorMap {
  "TODO"
}

interface RegExpMatchArray {
  const length: Number = aliasFor(__js_length)

  const index: Number? "The index of the search at which the result was found." = aliasFor(__js_index)

  const input: Number? "A copy of the search string." = aliasFor(__js_input)

  function __getitem__(i: Number): String {
    aliasFor(__op_getitem__)
  }
}

interface RegExpExecArray {
  const length: Number = aliasFor(__js_length)

  const index: Number? "The index of the search at which the result was found." = aliasFor(__js_index)

  const input: Number? "A copy of the search string." = aliasFor(__js_input)

  function __getitem__(i: Number): String {
    aliasFor(__op_getitem__)
  }
}

interface IntlCollatorOptions {
  "TODO"
}

interface IntlNumberFormatOptions {
  "TODO"
}

interface IntlDateTimeFormatOptions {
  "TODO"
}

`],
  ['lib.dom.d.ts', `
interface QueuingStrategySize {
  function __call__(value: Any): Number
}

interface QueuingStrategy {
  var highWaterMark: Number?;
  var size: QueuingStrategySize?;
}

# The autogenerated definition is recursive, but YAL cannot handle recursive typedefs
# typedef IDBValidKey = Union[Number, String, Date, BufferSource, List[IDBValidKey]]
typedef IDBValidKey = Union[Number, String, Date, BufferSource,
  List[Union[Number, String, Date, BufferSource]]]

`]
]);

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
  case 'translate': {
    const sink = new Sink((text) => process.stdout.write(text));
    translate(sink, FILE_CONTENTS);
    break;
  }
  default:
    throw new Error(`Unrecognized command ${JSON.stringify(ARGS.command)}`);
};
