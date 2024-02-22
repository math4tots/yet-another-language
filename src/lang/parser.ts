import { Location, Uri } from 'vscode';
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

function parse(uri: Uri, source: string): ast.File {
  class Exception { }

  const tokens = lex(source);
  const statements: ast.Node[] = [];
  const errors: ast.ParseError[] = [];
  let i = 0;

  function at(type: TokenType) {
    return tokens[i].type === type;
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

  function parsePrefix(): ast.Node {
    const startRange = tokens[i].range;
    const peek = tokens[i];
    if (peek.type === 'NUMBER') {
      return new ast.NumberLiteral({ uri, range: startRange }, peek.value);
    }
    errors.push({
      location: { uri, range: peek.range },
      message: `Expected expression but got ${JSON.stringify(peek.type)}`,
    });
    throw new Exception();
  }

  function parseInfix(lhs: ast.Node, startRange: Range): ast.Node {
    const tokenType = tokens[i].type;
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

  function parsePrec(precedence: number): ast.Node {
    const startRange = tokens[i].range;
    let expr = parsePrefix();
    while (precedence <= (PrecMap.get(tokens[i].type) || 0)) {
      expr = parseInfix(expr, startRange);
    }
    return expr;
  }

  function parseExpression(): ast.Node {
    return parsePrec(1);
  }

  function parseStatement(): ast.Node {
    const peek = tokens[i];
    if (consume(';')) {
      return new ast.None({ uri, range: peek.range });
    }
    const expression = parseExpression();
    expect(';');
    return expression;
  }

  function parseFile() {
    while (i < tokens.length) {
      statements.push(parseStatement());
    }
  }
  parseFile();
  return new ast.File(
    { uri, range: { start: tokens[0].range.start, end: tokens[tokens.length - 1].range.end } },
    statements, errors);
}
