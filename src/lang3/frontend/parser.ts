import {
  NumberValueToken,
  NumberValueTokenType,
  Range,
  StringValueToken,
  StringValueTokenType,
  NoValueToken,
  NoValueTokenType,
  Token,
  TokenType,
  lex,
} from "./lexer";
import * as ast from "./ast";

const PrecList: TokenType[][] = [
  [],
  ['or'],
  ['and'],
  [],        // precedence for unary operator 'not'
  ['==', '!=', '<', '>', '<=', '>=', 'not', '!'],
  ['<<', '>>'],
  ['&'],
  ['^'],
  ['|'],
  ['+', '-'],
  ['*', '/', '//', '%'],
  [],        // precedence for unary operators '-', '+' and '~'
  ['**'],
  ['.', '(', '['],
];
const PrecMap: Map<TokenType, number> = new Map();
for (let i = 0; i < PrecList.length; i++) {
  for (const tokenType of PrecList[i]) {
    PrecMap.set(tokenType, i);
  }
}
const PREC_UNARY_NOT = PrecMap.get('and')! + 1;
const PREC_UNARY_MINUS = PrecMap.get('*')! + 1;
const PREC_PRIMARY = PrecMap.get('.')! + 1;
const BinopMethodMap: Map<TokenType, string> = new Map([
  ['==', '__eq__'],
  ['!=', '__ne__'],
  ['<', '__lt__'],
  ['<=', '__le__'],
  ['>', '__gt__'],
  ['>=', '__ge__'],
  ['<<', '__lshift__'],
  ['>>', '__rshift__'],
  ['&', '__and__'],
  ['^', '__xor__'],
  ['|', '__or__'],
  ['<<', '__lshift__'],
  ['>>', '__rshift__'],
  ['+', '__add__'],
  ['-', '__sub__'],
  ['*', '__mul__'],
  ['/', '__div__'],
  ['//', '__floordiv__'],
  ['%', '__mod__'],
  ['**', '__pow__'],
]);
const UnopMethodMap: Map<TokenType, string> = new Map([
  ['-', '__neg__'],
  ['+', '__pos__'],
]);

export function parse(source: string, uri: string) {
  const generator = lex(source);
  let { value: peek } = generator.next();
  const firstToken = peek;
  type Rangeable = Range | Token | ast.Node | ast.Location;
  function rangeOf(item: Rangeable) {
    return item instanceof Range ? item : item instanceof ast.Node ? item.location.range : item.range;
  }
  function formatToken(token: Token) {
    return JSON.stringify(token.type) + (token.value === undefined ? '' : `/${JSON.stringify(token.value)}`);
  }
  function join(first: Rangeable, ...rest: (Rangeable | undefined)[]) {
    const firstRange = rangeOf(first);
    let start = firstRange.start;
    let end = firstRange.end;
    for (const item of rest) {
      if (item) {
        const range = rangeOf(item);
        start = start.index < range.start.index ? start : range.start;
        end = end.index >= range.end.index ? end : range.end;
      }
    }
    return new ast.Location(uri, new Range(start, end));
  }
  function next(): Token {
    const token = peek;
    if (token.type !== 'EOF') peek = generator.next().value;
    return token;
  }
  function at(type: TokenType): boolean { return peek.type === type; }
  function consume(type: TokenType): boolean { return at(type) ? (next(), true) : false; }
  function expect(type: NumberValueTokenType): NumberValueToken;
  function expect(type: StringValueTokenType): StringValueToken;
  function expect(type: NoValueTokenType): NoValueToken;
  function expect(type: TokenType): Token;
  function expect(type: TokenType): Token {
    if (at(type)) return next();
    throw new ast.ParseError(join(peek), `Expected "${type}" but got "${peek.type}"`);
  }

  const errors: ast.ParseError[] = [];

  function parseNumberLiteral() {
    const token = expect('NUMBER');
    return new ast.Literal(join(token), token.value);
  }

  function parseStringLiteral() {
    const token = expect('STRING');
    return new ast.Literal(join(token), token.value);
  }

  function parseIdentifier() {
    const token = expect('IDENTIFIER');
    return new ast.Identifier(join(token), token.value);
  }

  function parseIdentifierOrStringLiteralAsIdentifier() {
    if (at('STRING')) {
      const string = parseStringLiteral();
      return new ast.Identifier(string.location, string.value as string);
    }
    return parseIdentifier();
  }

  function parsePrefix(): ast.Expression {
    if (at('null')) return new ast.Literal(join(next()), null);
    if (at('true')) return new ast.Literal(join(next()), true);
    if (at('false')) return new ast.Literal(join(next()), false);
    if (at('NUMBER')) return parseNumberLiteral();
    if (at('STRING')) return parseStringLiteral();
    if (at('IDENTIFIER')) return parseIdentifier();
    if (consume('(')) {
      const expression = parseExpression();
      expect(')');
      return expression;
    }
    const start = peek;
    if (consume('[')) {
      const values: ast.Expression[] = [];
      while (!at(']')) {
        values.push(parseExpression());
        if (!consume(',')) continue;
      }
      const end = expect(']');
      return new ast.ListDisplay(join(start, end), values);
    }
    if (consume('{')) {
      const entries: [ast.Identifier, ast.Expression][] = [];
      while (!at('}')) {
        const key = parseIdentifierOrStringLiteralAsIdentifier();
        expect(':');
        const value = parseExpression();
        entries.push([key, value]);
        if (!consume(',')) break;
      }
      const end = expect('}');
      return new ast.TableDisplay(join(start, end), entries);
    }
    if (consume('if')) {
      const test = parseExpression();
      expect('then');
      const lhs = parseExpression();
      expect('else');
      const rhs = parseExpression();
      return new ast.Operation(join(start, rhs), { operator: "if", args: [test, lhs, rhs] });
    }
    if (consume('not')) {
      const expression = parsePrec(PREC_UNARY_NOT);
      return new ast.Operation(join(start, expression), { operator: "not", args: [expression] });
    }
    const unopMethod = UnopMethodMap.get(peek.type);
    if (unopMethod) {
      next();
      const arg = parsePrec(PREC_UNARY_MINUS);
      const identifier = new ast.Identifier({ uri, range: peek.range }, unopMethod);
      return new ast.MethodCall(join(start, arg), arg, identifier, []);
    }
    throw new ast.ParseError(join(peek), `Expected expression but got ${formatToken(peek)}`);
  }

  function parseArgs(): { start: Rangeable, args: ast.Expression[], end: Rangeable; } {
    const args: ast.Expression[] = [];
    const start = expect('(');
    while (!at('EOF') && !at(')')) {
      args.push(parseExpression());
      if (!consume(',')) {
        break;
      }
    }
    const end = expect(')');
    return { start, args, end };
  }

  function parseInfix(lhs: ast.Expression, start: Range): ast.Expression {
    const optok = peek;
    const tokenType = optok.type;
    if (tokenType === '(') {
      let methodIdentifierRange = join(optok);
      if (lhs instanceof ast.Identifier) {
        methodIdentifierRange = join(lhs, optok);
      }
      const methodIdentifier = new ast.Identifier(methodIdentifierRange, '__call__');
      const { args, end } = parseArgs();
      return new ast.MethodCall(
        join(start, end), lhs, methodIdentifier, args);
    }
    if (consume('.')) {
      // There needs to be an name here, but if there isn't, don't fail the
      // parse completely.
      if (!at('IDENTIFIER')) {
        return new ast.MethodCall(join(start), lhs, new ast.Identifier(join(start), ''), []);
      }
      const identifier = parseIdentifier();
      if (at('(')) {
        const { args, end } = parseArgs();
        return new ast.MethodCall(join(start, end), lhs, identifier, args);
      }
      if (consume('=')) {
        const methodIdentifier = new ast.Identifier(join(identifier), `__set_${identifier.name}`);
        const value = parseExpression();
        const end = value;
        return new ast.MethodCall(join(start, end), lhs, methodIdentifier, [value]);
      }
      const methodIdentifier = new ast.Identifier(join(identifier), `__get_${identifier.name}`);
      const end = methodIdentifier;
      return new ast.MethodCall(join(start, end), lhs, methodIdentifier, []);
    }
    if (consume('[')) {
      const index = parseExpression();
      const bracketEnd = expect(']').range;
      if (consume('=')) {
        const methodIdentifier = new ast.Identifier(join(optok), '__setitem__');
        const value = parseExpression();
        return new ast.MethodCall(join(start, value), lhs, methodIdentifier, [index, value]);
      }
      const methodIdentifier = new ast.Identifier(join(optok), '__getitem__');
      return new ast.MethodCall(join(start, bracketEnd), lhs, methodIdentifier, [index]);
    }
    const precedence = PrecMap.get(tokenType);
    if (precedence && consume('and')) {
      const rhs = parsePrec(precedence + 1);
      const range = join(start, rhs);
      return new ast.Operation(range, { operator: 'and', args: [lhs, rhs] });
    }
    if (precedence && consume('or')) {
      const rhs = parsePrec(precedence + 1);
      const range = join(start, rhs);
      return new ast.Operation(range, { operator: 'or', args: [lhs, rhs] });
    }
    const methodName = BinopMethodMap.get(tokenType);
    if (precedence && methodName) {
      const rightAssociative = methodName === '__pow__';
      const oploc = join(next());
      const rhs = rightAssociative ?
        parsePrec(precedence) :
        parsePrec(precedence + 1);
      const methodIdentifier = new ast.Identifier(oploc, methodName);
      return new ast.MethodCall(join(lhs, rhs), lhs, methodIdentifier, [rhs]);
    }
    throw new ast.ParseError(join(peek), `Expected infix token but got ${formatToken(peek)}`);
  }

  function parsePrec(precedence: number): ast.Expression {
    const start = peek.range;
    let expr: ast.Expression = parsePrefix();
    while (precedence <= (PrecMap.get(peek.type) || 0)) {
      expr = parseInfix(expr, start);
    }
    return expr;
  }

  function parseExpression(): ast.Expression {
    return parsePrec(1);
  }

  function parseType(): ast.Expression {
    return parsePrec(PREC_PRIMARY);
  }

  function expectStatementDelimiter() {
    if (!consume('NEWLINE')) {
      errors.push(new ast.ParseError(join(peek), `Expected statement delimiter but got "${formatToken(peek)}"`));
      while (!at('EOF') && !at('NEWLINE')) next();
    }
    while (consume('NEWLINE')) { }
  }

  function parseBlock() {
    const start = expect(':');
    const stmts: ast.Statement[] = [];
    expect('NEWLINE');
    expect('INDENT');
    while (!at('EOF') && !at('DEDENT')) {
      if (consume('pass')) {
        expectStatementDelimiter();
        continue;
      }
      stmts.push(parseStatement());
    }
    const end = expect('DEDENT');
    return new ast.Block(join(start, end), stmts);
  }

  function parseIfRec(start: Rangeable): ast.If {
    const test = parseExpression();
    const body = parseBlock();
    let orelse: ast.If | ast.Block | undefined;
    if (at('elif')) {
      const nextStart = next();
      orelse = parseIfRec(nextStart);
    } else if (consume('else')) {
      orelse = parseBlock();
    }
    return new ast.If(join(start, body, orelse), test, body, orelse);
  }

  function parseIf() {
    return parseIfRec(expect('if'));
  }

  function parseWhile() {
    const start = expect('while');
    const test = parseExpression();
    const body = parseBlock();
    return new ast.While(join(start, body), test, body);
  }

  function parseBreak() {
    const start = expect('break');
    expectStatementDelimiter();
    return new ast.Break(join(start));
  }

  function parseContinue() {
    const start = expect('continue');
    expectStatementDelimiter();
    return new ast.Continue(join(start));
  }

  function parseVariableDeclaration() {
    const start = peek;
    const isMutable = consume('const');
    if (!isMutable) expect('var');
    const identifier = parseIdentifier();
    const type = consume(':') ? parseType() : undefined;
    expect('=');
    const value = parseExpression();
    return new ast.VariableDeclaration(join(start, value), isMutable, identifier, type, value);
  }

  function parseCommaSeparatedList<R>(open: TokenType, parseItem: () => R, close: TokenType) {
    const start = expect(open);
    const items: R[] = [];
    while (!at('EOF') && !at(close)) {
      items.push(parseItem());
      if (!consume(',')) break;
    }
    const end = expect(close);
    return { start, items, end };
  }

  function parseTypeParameter() {
    const identifier = parseIdentifier();
    const constraint = consume(':') ? parseType() : undefined;
    return new ast.TypeParameter(join(identifier, constraint), identifier, constraint);
  }

  function parseTypeParameters() {
    if (at('[')) {
      const { items: params } = parseCommaSeparatedList('[', parseTypeParameter, ']');
      return params;
    }
    return undefined;
  }

  function parseParameter() {
    const identifier = parseIdentifier();
    expect(':');
    const type = parseType();
    return new ast.Parameter(join(identifier, type), identifier, type);
  }

  function parseParameters() {
    const { items: params } = parseCommaSeparatedList('(', parseParameter, ')');
    return params;
  }

  function parseFunctionDefinition() {
    const start = expect('def');
    const identifier = parseIdentifier();
    const typeParameters = parseTypeParameters();
    const parameters = parseParameters();
    const returnType = consume('->') ? parseType() : undefined;
    const body = parseBlock();
    return new ast.FunctionDefinition(join(start, body), identifier, typeParameters, parameters, returnType, body);
  }

  function parseReturn() {
    const start = expect('return');
    const expression = at('NEWLINE') ? undefined : parseExpression();
    expectStatementDelimiter();
    return new ast.Return(join(start, expression), expression);
  }

  function parseTypedef() {
    const start = expect('typedef');
    const identifier = parseIdentifier();
    const typeParameters = parseTypeParameters();
    expect('=');
    const type = parseType();
    expectStatementDelimiter();
    return new ast.Typedef(join(start, type), identifier, typeParameters, type);
  }

  function parseStatement() {
    if (at('if')) return parseIf();
    if (at('while')) return parseWhile();
    if (at('break')) return parseBreak();
    if (at('continue')) return parseContinue();
    if (at('var') || at('const')) return parseVariableDeclaration();
    if (at('def')) return parseFunctionDefinition();
    if (at('return')) return parseReturn();
    if (at('typedef')) return parseTypedef();
    const expr = parseExpression();
    if (consume('=')) {
      const rhs = parseExpression();
      expectStatementDelimiter();
      if (expr instanceof ast.Identifier) return new ast.Assignment(join(expr, rhs), expr, rhs);
      errors.push(new ast.ParseError(join(expr), `Cannot assign to ${expr.constructor.name}`));
      return new ast.ExpressionStatement(join(rhs), rhs);
    }
    expectStatementDelimiter();
    return new ast.ExpressionStatement(join(expr), expr);
  }

  const fileStatements: ast.Statement[] = [];

  while (consume('NEWLINE')) { }
  try {
    while (!at('EOF')) {
      fileStatements.push(parseStatement());
      while (consume('NEWLINE')) { }
    }
  } catch (exc) {
    if (exc instanceof ast.ParseError) errors.push(exc);
    else throw exc;
  }

  return new ast.File(join(firstToken, peek), fileStatements, errors);
}
