import * as ast from "./ast";
import {
  NoValueTokenType,
  NumberValueTokenType,
  Range,
  Rangeable,
  StringValueTokenType,
  Token,
  TokenType,
  lex,
} from "./lexer";

const PrecList: TokenType[][] = [
  [],
  ['??'],
  ['or'],
  ['and'],
  [],        // precedence for unary operator 'not'
  ['==', '!=', '<', '>', '<=', '>=', 'in', 'not', 'is', 'as', '!'],
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

export function parse(s: string) {
  const generator = lex(s);
  let { value: peek } = generator.next();
  const fileStart = peek;
  const tokenStack: Token[] = [];
  const tokens: Token[] = [];
  const errors: ast.ParseError[] = [];

  function next() {
    const token = peek;
    peek = tokenStack.pop() ?? generator.next().value;
    tokens.push(token);
    return token;
  }

  function getState() { return tokens.length; }

  function restore(state: number) {
    while (tokens.length > state) {
      tokenStack.push(peek);
      peek = tokens.pop()!;
    }
  }

  function formatToken(token: Token) {
    return JSON.stringify(token.type) + (token.value === undefined ? '' : `/${JSON.stringify(token.value)}`);
  }

  type Pattern<T> = T | T[];

  function match<T>(pattern: Pattern<T>, value: T): boolean {
    return Array.isArray(pattern) ? pattern.includes(value) : pattern === value;
  }

  function at(type: Pattern<TokenType>) {
    return match(type, peek.type);
  }

  function peekAt(offset: number) {
    const state = getState();
    while (offset > 0) offset--, next();
    const token = peek;
    restore(state);
    return token;
  }

  function consume(type: Pattern<TokenType>) {
    if (at(type)) return next(), true;
    return false;
  }

  function expect(type: NumberValueTokenType): Token & { value: number; };
  function expect(type: StringValueTokenType): Token & { value: string; };
  function expect(type: NoValueTokenType | Pattern<TokenType>): Token;
  function expect(type: Pattern<TokenType>) {
    if (at(type)) return next();
    throw new ast.ParseError(peek.range, `Expected ${JSON.stringify(type)} but got ${formatToken(peek)}`);
  }

  function synchronize(f: () => void) {
    try {
      f();
    } catch (err) {
      if (err instanceof ast.ParseError) errors.push(err);
      else throw err;
    }
  }

  function parseNumberLiteral() {
    const token = expect('NUMBER');
    return new ast.NumberLiteral(token.range, token.value);
  }

  function parseStringLiteral() {
    const token = expect('STRING');
    return new ast.StringLiteral(token.range, token.value);
  }

  function parseName() {
    const token = expect('NAME');
    return new ast.Name(token.range, token.value);
  }

  function parseTypeParameter(): ast.TypeParameter {
    const name = parseName();
    const upperBound = consume('extends') ? parseTypeExpression() : undefined;
    return new ast.TypeParameter(Range.join(name, upperBound), name, upperBound);
  }

  function parseTypeParameters(): { start: Rangeable, params: ast.TypeParameter[], end: Rangeable; } {
    const start = expect('[');
    const params: ast.TypeParameter[] = [];
    while (!at(']')) {
      params.push(parseTypeParameter());
      if (!consume(',')) continue;
    }
    const end = expect(']');
    return { start, params, end };
  }

  function parseParameter(): ast.Parameter {
    const start = peek;
    const isVariadic = consume('...');
    const name = parseName();
    expect(':');
    const type = parseTypeExpression();
    const defaultValue = consume('=') ? parseExpression() : undefined;
    return new ast.Parameter(Range.join(start, type, defaultValue), isVariadic, name, type, defaultValue);
  }

  function parseParameters(): { start: Rangeable, params: ast.Parameter[], end: Rangeable; } {
    const start = expect('(');
    const params: ast.Parameter[] = [];
    while (!at(')')) {
      params.push(parseParameter());
      if (!consume(',')) continue;
    }
    const end = expect(')');
    return { start, params, end };
  }

  function parseTypeArgs(): { start: Rangeable, args: ast.TypeExpression[], end: Rangeable; } {
    const start = expect('(');
    const args: ast.TypeExpression[] = [];
    while (!at(')')) {
      args.push(parseTypeExpression());
      if (!consume(',')) continue;
    }
    const end = expect(')');
    return { start, args, end };
  }

  function parseTypeExpression(): ast.TypeExpression {
    const start = peek;
    if (consume('function')) {
      const typeParameters = at('[') ? parseTypeParameters().params : undefined;
      const { params: parameters } = parseParameters();
      const returnType = parseTypeExpression();
      return new ast.FunctionTypeDisplay(Range.join(start, returnType), typeParameters, parameters, returnType);
    }
    if (!at('NAME')) {
      throw new ast.ParseError(peek.range, `Expected type expression but got ${formatToken(peek)}`);
    }
    let name: ast.Name | ast.QualifiedName = parseName();
    if (consume('.')) {
      const secondName = parseName();
      name = new ast.QualifiedName(Range.join(name, secondName), name, secondName);
    }
    if (at('[')) {
      const { args, end } = parseTypeArgs();
      return new ast.ReifiedTypeDisplay(Range.join(start, end), name, args);
    }
    return name;
  }

  function parsePrefix(): ast.Expression {
    if (at('null')) return new ast.NullLiteral(next().range);
    if (at('true')) return new ast.BoolLiteral(next().range, true);
    if (at('false')) return new ast.BoolLiteral(next().range, false);
    if (at('NUMBER')) return parseNumberLiteral();
    if (at('STRING')) return parseStringLiteral();
    if (at('NAME')) return parseName();
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
      return new ast.ListDisplay(Range.join(start, end), values);
    }
    if (consume('{')) {
      const entries: [(ast.Name | ast.StringLiteral), ast.Expression][] = [];
      while (!at('}')) {
        const key = at('NAME') ? parseName() : parseStringLiteral();
        expect(':');
        const value = parseExpression();
        entries.push([key, value]);
        if (!consume(',')) break;
      }
      const end = expect('}');
      return new ast.RecordDisplay(Range.join(start, end), entries);
    }
    if (consume('if')) {
      const condition = parseExpression();
      expect('then');
      const lhs = parseExpression();
      expect('else');
      const rhs = parseExpression();
      return new ast.LogicalOperator(Range.join(start, rhs), "if", [condition, lhs, rhs]);
    }
    if (consume('not')) {
      const expression = parsePrec(PREC_UNARY_NOT);
      return new ast.LogicalOperator(Range.join(start, expression), "not", [expression]);
    }
    throw new ast.ParseError(peek.range, `Expected expression but got ${formatToken(peek)}`);
  }

  function parseArgs(): { start: Rangeable, args: ast.Expression[], end: Rangeable; } {
    const args: ast.Expression[] = [];
    const start = expect('(');
    while (!at('EOF') && !at(')')) {
      while (consume('COMMENT')); // allow preceeding comments in argument lists
      args.push(parseExpression());
      if (!consume(',')) {
        break;
      }
      while (consume('COMMENT')); // allow trailing comments in argument lists
    }
    const end = expect(')');
    return { start, args, end };
  }

  function parseInfix(lhs: ast.Expression, start: Range): ast.Expression {
    const optok = peek;
    const tokenType = optok.type;
    if (tokenType === '(') {
      let methodIdentifierRange = optok.range;
      if (lhs instanceof ast.Name) {
        methodIdentifierRange = Range.join(lhs, optok);
      }
      const methodIdentifier = new ast.Name(methodIdentifierRange, '__call__');
      const { args, end } = parseArgs();
      return new ast.MethodCall(
        Range.join(start, end), lhs, methodIdentifier, args);
    }
    if (consume('as')) {
      const type = parseTypeExpression();
      return new ast.TypeAssertion(Range.join(start, type), lhs, type);
    }
    if (consume('.')) {
      // There needs to be an name here, but if there isn't, don't fail the
      // parse completely.
      if (!at('NAME')) {
        return new ast.MethodCall(start, lhs, new ast.Name(start, ''), []);
      }
      const name = parseName();
      if (at('(')) {
        const { args, end } = parseArgs();
        return new ast.MethodCall(Range.join(start, end), lhs, name, args);
      }
      if (consume('=')) {
        const methodIdentifier = new ast.Name(name.range, `__set_${name.value}`);
        const value = parseExpression();
        const end = value;
        return new ast.MethodCall(Range.join(start, end), lhs, methodIdentifier, [value]);
      }
      const methodIdentifier = new ast.Name(Range.join(name), `__get_${name.value}`);
      const end = methodIdentifier;
      return new ast.MethodCall(Range.join(start, end), lhs, methodIdentifier, []);
    }
    if (consume('[')) {
      const index = parseExpression();
      const bracketEnd = expect(']').range;
      if (consume('=')) {
        const methodIdentifier = new ast.Name(optok.range, '__setitem__');
        const value = parseExpression();
        return new ast.MethodCall(Range.join(start, value), lhs, methodIdentifier, [index, value]);
      }
      const methodIdentifier = new ast.Name(optok.range, '__getitem__');
      return new ast.MethodCall(Range.join(start, bracketEnd), lhs, methodIdentifier, [index]);
    }
    const precedence = PrecMap.get(tokenType);
    if (precedence && consume('and')) {
      const rhs = parsePrec(precedence + 1);
      const range = Range.join(start, rhs);
      return new ast.LogicalOperator(range, 'and', [lhs, rhs]);
    }
    if (precedence && consume('or')) {
      const rhs = parsePrec(precedence + 1);
      const range = Range.join(start, rhs);
      return new ast.LogicalOperator(range, 'or', [lhs, rhs]);
    }
    const methodName = BinopMethodMap.get(tokenType);
    if (precedence && methodName) {
      const rightAssociative = methodName === '__pow__';
      const operatorRange = next().range;
      const rhs = rightAssociative ?
        parsePrec(precedence) :
        parsePrec(precedence + 1);
      const methodIdentifier = new ast.Name(operatorRange, methodName);
      return new ast.MethodCall(Range.join(lhs, rhs), lhs, methodIdentifier, [rhs]);
    }
    throw new ast.ParseError(peek.range, `Expected infix token but got ${formatToken(peek)}`);
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

  function parseBlock(): ast.Block {
    const start = expect(':');
    expect('NEWLINE');
    expect('INDENT');
    const statements: ast.Statement[] = [];
    while (!at('DEDENT')) {
      statements.push(parseStatement());
    }
    const end = expect('DEDENT');
    return new ast.Block(Range.join(start, end), statements);
  }

  function parseFunctionDefinition(start: Rangeable, isExported: boolean, isStatic: boolean): ast.FunctionDefinition {
    expect('function');
    const name = parseName();
    const typeParameters = at('[') ? parseTypeParameters().params : undefined;
    const parameters = parseParameters().params;
    const rtype = consume('->') ? parseTypeExpression() : undefined;
    const body = parseBlock();
    const range = Range.join(start, body);
    return new ast.FunctionDefinition(range, isExported, isStatic, name, typeParameters, parameters, rtype, body);
  }

  function parseVariableDeclaration(
    start: Rangeable, isExported: boolean, isStatic: boolean): ast.VariableDeclaration {
    const isMutable = consume('var');
    if (!isMutable) expect('const');
    const name = parseName();
    const type = consume(':') ? parseTypeExpression() : undefined;
    const value = consume('=') ? parseExpression() : undefined;
    const range = Range.join(start, name, type, value);
    return new ast.VariableDeclaration(range, isExported, isStatic, isMutable, name, type, value);
  }

  function parseClassDefinition(start: Rangeable, isExported: boolean): ast.ClassDefinition {
    expect('class');
    const name = parseName();
    const typeParameters = at('[') ? parseTypeParameters().params : undefined;
    const baseClass = consume('extends') ? parseTypeExpression() : undefined;
    const body = parseBlock();
    const range = Range.join(start, body);
    return new ast.ClassDefinition(range, isExported, name, typeParameters, baseClass, body);
  }

  function parseInterfaceDefinition(start: Rangeable, isExported: boolean): ast.InterfaceDefinition {
    expect('class');
    const name = parseName();
    const typeParameters = at('[') ? parseTypeParameters().params : undefined;
    const superTypes: ast.TypeExpression[] = [];
    if (consume('extends')) {
      do {
        superTypes.push(parseTypeExpression());
      } while (consume(','));
    }
    const body = parseBlock();
    const range = Range.join(start, body);
    return new ast.InterfaceDefinition(range, isExported, name, typeParameters, superTypes, body);
  }

  function parseDeclaration(): ast.Declaration {
    const start = peek;
    const isExported = consume('export');
    if (at(['static', 'const', 'var', 'function'])) {
      const isStatic = consume('static');
      if (at('function')) return parseFunctionDefinition(start, isExported, isStatic);
      return parseVariableDeclaration(start, isExported, isStatic);
    }
    if (at('interface')) parseInterfaceDefinition(start, isExported);
    if (at('class')) parseClassDefinition(start, isExported);
    throw new ast.ParseError(peek.range, `Expected declaration but got ${formatToken(peek)}`);
  }

  function parseIfStatement(): ast.IfStatement {
    const start = expect('if');
    const ifClauses: ast.IfClause[] = [];
    do {
      const condition = parseExpression();
      const body = parseBlock();
      ifClauses.push(new ast.IfClause(Range.join(condition, body), condition, body));
    } while (consume('elif'));
    const elseClause = consume('else') ? parseBlock() : undefined;
    const range = Range.join(start, ifClauses[ifClauses.length - 1], elseClause);
    return new ast.IfStatement(range, ifClauses, elseClause);
  }

  function parseWhileStatement(): ast.WhileStatement {
    const start = expect('while');
    const condition = parseExpression();
    const body = parseBlock();
    return new ast.WhileStatement(Range.join(start, body), condition, body);
  }

  function parseBreakStatement() {
    const range = expect('break').range;
    expect('NEWLINE');
    return new ast.BreakStatement(range);
  }

  function parseContinueStatement() {
    const range = expect('continue').range;
    expect('NEWLINE');
    return new ast.ContinueStatement(range);
  }

  function parseReturnStatement() {
    const start = expect('return');
    const value = at('NEWLINE') ? undefined : parseExpression();
    expect('NEWLINE');
    return new ast.ReturnStatement(Range.join(start, value), value);
  }

  function parseExpressionStatement(): ast.ExpressionStatement {
    const start = peek;
    const expression = parseExpression();
    expect('NEWLINE');
    return new ast.ExpressionStatement(Range.join(start, expression), expression);
  }

  function parseStatement() {
    consume('NEWLINE');
    if (at(['export', 'static', 'const', 'var', 'function', 'class', 'interface'])) return parseDeclaration();
    if (at('if')) return parseIfStatement();
    if (at('while')) return parseWhileStatement();
    if (at('break')) return parseBreakStatement();
    if (at('continue')) return parseContinueStatement();
    if (at('return')) return parseReturnStatement();
    return parseExpressionStatement();
  }

  const headers: ast.HeaderItem[] = [];
  const statements: ast.Statement[] = [];

  synchronize(() => {
    while (!at('EOF')) {
      if (at('STRING') && peekAt(1).type === 'NEWLINE') {
        headers.push(parseStringLiteral());
        continue;
      }
      const start = peek;
      if (at('export') && peekAt(1).type === 'as') {
        expect('as');
        const name = parseName();
        const end = expect('NEWLINE');
        headers.push(new ast.ExportAs(Range.join(start, end), name));
        continue;
      }
      if (at('from')) {
        const path = parseStringLiteral();
        expect('import');
        const name = parseName();
        const end = expect('NEWLINE');
        headers.push(new ast.FromImport(Range.join(start, end), path, name));
        continue;
      }
      if (at('import')) {
        const path = parseStringLiteral();
        expect('as');
        const name = parseName();
        const end = expect('NEWLINE');
        headers.push(new ast.ImportAs(Range.join(start, end), path, name));
        continue;
      }
      break;
    }

    while (!at('EOF')) {
      statements.push(parseStatement());
    }
  });

  return new ast.ModuleDisplay(Range.join(fileStart, peek), headers, statements, errors);
}
