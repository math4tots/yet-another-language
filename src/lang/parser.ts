import { Color, Location, Uri } from 'vscode';
import * as ast from './ast';
import { lex, Position, Range, Token, TokenType } from './lexer';

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
  ['!=', '__eq__'],
  ['<', '__lt__'],
  ['<=', '__lt__'],
  ['>', '__lt__'],
  ['>=', '__lt__'],
  ['<<', '__lshift__'],
  ['>>', '__rshift__'],
  ['&', '__and__'],
  ['^', '__xor__'],
  ['|', '__or__'],
  ['+', '__add__'],
  ['-', '__sub__'],
  ['*', '__mul__'],
  ['/', '__div__'],
  ['//', '__floordiv__'],
  ['%', '__mod__'],
  ['**', '__pow__'],
]);

export function parse(uri: Uri, source: string): ast.File {
  class Exception { }

  const tokens = lex(source);
  const globalStatements: ast.Statement[] = [];
  const errors: ast.ParseError[] = [];
  let i = 0;

  for (const token of tokens) {
    if (token.type === 'ERROR') {
      errors.push({
        location: { uri, range: token.range },
        message: token.value,
      });
    }
  }

  function at(type: TokenType) {
    return tokens[i].type === type;
  }

  function atEOF(): boolean {
    return i >= tokens.length || tokens[i].type === 'EOF';
  }

  function next() {
    return tokens[i++];
  }

  function expect(type: TokenType): Token {
    if (at(type)) {
      return next();
    }
    errors.push({
      location: { uri, range: tokens[i].range },
      message: `Expected ${JSON.stringify(type)} but got ${JSON.stringify(tokens[i].type)}`,
    });
    throw new Exception();
  }

  function consume(type: TokenType) {
    if (at(type)) {
      next();
      return true;
    }
    return false;
  }

  function expectStatementDelimiter(): Token {
    if (at(';')) {
      return next();
    }
    // See if there's a newline here. If so, create a synthetic token
    if (i > 0 && tokens[i - 1].range.end.line < tokens[i].range.start.line) {
      const pos = tokens[i - 1].range.end;
      return { range: { start: pos, end: pos }, type: ';', value: null };
    }
    // if not, trigger an expect error
    return expect(';');
  }

  function parseIdentifier(): ast.Identifier {
    const peek = tokens[i];
    if (peek.type === 'IDENTIFIER') {
      i++;
      return new ast.Identifier({ uri, range: peek.range }, peek.value);
    }
    errors.push({
      location: { uri, range: peek.range },
      message: `Expected identifier but got ${JSON.stringify(peek.type)}`,
    });
    throw new Exception();
  }

  function atFunctionDisplay(): boolean {
    const j = i;
    try {
      if (!consume('(')) return false;
      let depth = 1;
      while (depth > 0 && !atEOF()) {
        switch (tokens[i++].type) {
          case '(':
            depth++;
            break;
          case ')':
            depth--;
            break;
        }
      }
      return consume('=>');
    } finally {
      i = j;
    }
  }

  function parseParameter(): ast.Declaration {
    const identifier = parseIdentifier();
    const type = consume(':') ? parseExpression() : null;
    const location = {
      uri,
      range: {
        start: identifier.location.range.start,
        end: type ? type.location.range.end : identifier.location.range.end,
      }
    };
    return new ast.Declaration(location, true, identifier, type, null);
  }

  function parseParameters(): ast.Declaration[] {
    expect('(');
    const parameters: ast.Declaration[] = [];
    while (!atEOF() && !at(')')) {
      parameters.push(parseParameter());
      if (!consume(',')) {
        break;
      }
    }
    expect(')');
    return parameters;
  }

  function parsePrefix(): ast.Expression {
    const peek = tokens[i];
    if (peek.type === 'NUMBER') {
      i++;
      return new ast.NumberLiteral({ uri, range: peek.range }, peek.value);
    }
    if (peek.type === 'STRING') {
      i++;
      return new ast.StringLiteral({ uri, range: peek.range }, peek.value);
    }
    if (peek.type === 'IDENTIFIER') {
      const identifier = parseIdentifier();
      if (consume('=')) {
        const rhs = parseExpression();
        const range = { start: identifier.location.range.start, end: rhs.location.range.end };
        return new ast.Assignment({ uri, range }, identifier, rhs);
      }
      if (consume('=>')) {
        const body = at('{') ? parseBlock() : parseExpression();
        const range = { start: identifier.location.range.start, end: body.location.range.end };
        return new ast.FunctionDisplay(
          { uri, range },
          [new ast.Declaration(identifier.location, true, identifier, null, null)],
          body);
      }
      return identifier;
    }
    if (peek.type === '(') {
      if (atFunctionDisplay()) {
        const parameters = parseParameters();
        expect('=>');
        const body = at('{') ? parseBlock() : parseExpression();
        const range = { start: peek.range.start, end: body.location.range.end };
        return new ast.FunctionDisplay({ uri, range }, parameters, body);
      }
      i++;
      const innerExpression = parseExpression();
      expect(')');
      return innerExpression;
    }
    if (consume('if')) {
      const condition = parseExpression();
      expect('then');
      const lhs = parseExpression();
      expect('else');
      const rhs = parseExpression();
      const start = peek.range.start;
      const end = rhs.location.range.end;
      return new ast.Conditional({ uri, range: { start, end } }, condition, lhs, rhs);
    }
    errors.push({
      location: { uri, range: peek.range },
      message: `Expected expression but got ${JSON.stringify(peek.type)}`,
    });
    throw new Exception();
  }

  function parseArgs(): ast.Expression[] {
    const args: ast.Expression[] = [];
    expect('(');
    while (!atEOF() && !at(')')) {
      args.push(parseExpression());
      if (!consume(',')) {
        break;
      }
    }
    expect(')');
    return args;
  }

  function parseInfix(lhs: ast.Expression, startRange: Range): ast.Expression {
    const optok = tokens[i];
    const tokenType = optok.type;
    if (tokenType === '(') {
      const methodIdentifier = new ast.Identifier({ uri, range: optok.range }, '__call__');
      const args = parseArgs();
      const end = tokens[i - 1].range.end;
      return new ast.MethodCall(
        { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, args);
    }
    if (consume('.')) {
      const identifier = parseIdentifier();
      if (at('(')) {
        const args = parseArgs();
        const end = tokens[i - 1].range.end;
        return new ast.MethodCall(
          { uri, range: { start: startRange.start, end } }, lhs, identifier, args);
      }
      if (consume('=')) {
        const methodIdentifier = new ast.Identifier(
          identifier.location, `set_${identifier.name}`);
        const value = parseExpression();
        const end = tokens[i - 1].range.end;
        return new ast.MethodCall(
          { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, [value]);
      }
      const methodIdentifier = new ast.Identifier(
        identifier.location, `get_${identifier.name}`);
      const end = tokens[i - 1].range.end;
      return new ast.MethodCall(
        { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, []);
    }
    const precedence = PrecMap.get(tokenType);
    const methodName = BinopMethodMap.get(tokenType);
    if (precedence && methodName) {
      const rightAssociative = methodName === '__pow__';
      const operatorRange = next().range;
      const rhs = rightAssociative ?
        parsePrec(precedence) :
        parsePrec(precedence + 1);
      const location = {
        uri,
        range: { start: startRange.start, end: rhs.location.range.end },
      };
      const methodIdentifier = new ast.Identifier(
        { uri, range: operatorRange }, methodName);
      return new ast.MethodCall(location, lhs, methodIdentifier, [rhs]);
    }
    errors.push({
      location: { uri, range: tokens[i].range },
      message: `Expectd infix token but got ${JSON.stringify(tokenType)}`,
    });
    throw new Exception();
  }

  function parsePrec(precedence: number): ast.Expression {
    const startRange = tokens[i].range;
    let expr: ast.Expression = parsePrefix();
    while (precedence <= (PrecMap.get(tokens[i].type) || 0)) {
      expr = parseInfix(expr, startRange);
    }
    return expr;
  }

  function parseExpression(): ast.Expression {
    return parsePrec(1);
  }

  function parseStatement(): ast.Statement {
    const peek = tokens[i];
    if (consume(';')) return new ast.EmptyStatement({ uri, range: peek.range });
    if (at('if')) return parseIf();
    if (at('while')) return parseWhile();
    if (at('var') || at('const')) return parseDeclaration();
    if (at('{')) return parseBlock();
    if (at('class')) return parseClassDefinition();
    const expression = parseExpression();
    expectStatementDelimiter();
    return new ast.ExpressionStatement(expression.location, expression);
  }

  function parseIf(): ast.If {
    const start = expect('if').range.start;
    const condition = parseExpression();
    const lhs = parseBlock();
    const rhs = consume('else') ? (at('if') ? parseIf() : parseBlock()) : null;
    const end = rhs ? rhs.location.range.end : lhs.location.range.end;
    return new ast.If({ uri, range: { start, end } }, condition, lhs, rhs);
  }

  function parseWhile(): ast.While {
    const start = expect('while').range.start;
    const condition = parseExpression();
    const body = parseBlock();
    const end = body.location.range.end;
    return new ast.While({ uri, range: { start, end } }, condition, body);
  }

  function parseDeclaration(): ast.Declaration {
    const start = tokens[i].range.start;
    const isConst = consume('const') ? true : (expect('var'), false);
    const identifier = parseIdentifier();
    const type = consume(':') ? parseExpression() : null;
    const value = consume('=') ? parseExpression() : null;
    const end = expectStatementDelimiter().range.end;
    return new ast.Declaration({ uri, range: { start, end } }, isConst, identifier, type, value);
  }

  function parseBlock(): ast.Block {
    const startPos = expect('{').range.start;
    const statements: ast.Statement[] = [];
    try {
      while (!atEOF() && !at('}')) {
        statements.push(parseStatement());
      }
    } catch (e) {
      if (e instanceof Exception) {
        while (!atEOF() && !at('}')) {
          i++;
        }
      } else {
        throw e;
      }
    }
    const endPos = expect('}').range.end;
    return new ast.Block({ uri, range: { start: startPos, end: endPos } }, statements);
  }

  function parseClassDefinition(): ast.ClassDefinition {
    const startPos = expect('class').range.start;
    const identifier = parseIdentifier();
    const body = parseBlock();
    return new ast.ClassDefinition(
      { uri, range: { start: startPos, end: body.location.range.end } },
      identifier, body.statements);
  }

  function parseFile() {
    try {
      while (!atEOF()) {
        globalStatements.push(parseStatement());
      }
    } catch (e) {
      if (e instanceof Exception) {
        while (!atEOF()) i++;
      } else {
        throw e;
      }
    }
  }
  parseFile();
  return new ast.File(
    { uri, range: { start: tokens[0].range.start, end: tokens[tokens.length - 1].range.end } },
    globalStatements, errors);
}
