import * as vscode from 'vscode';
import * as ast from './ast';
import { lex, Position, Range, Token, TokenType } from './lexer';
import { registerSymbol, removeUriFromSymbolRegistry } from './symbolregistry';

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

export function parse(uri: vscode.Uri, source: string, documentVersion: number = -1): ast.File {
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

  function atFirstTokenOfNewLine(): boolean {
    return i === 0 || (tokens[i - 1].range.end.line < tokens[i].range.start.line);
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
    if (atFirstTokenOfNewLine()) {
      const pos = tokens[i - 1].range.end;
      return { range: { start: pos, end: pos }, type: ';', value: null };
    }
    // Also create a synthetic token if we are at a '}' token
    if (at('}')) return { range: tokens[i].range, type: ';', value: null };
    // EOF also counts as statement delimiter
    if (at('EOF')) return { range: tokens[i].range, type: ';', value: null };
    // if not, trigger an expect error
    return expect(';');
  }

  function parseIdentifier(): ast.IdentifierNode {
    const peek = tokens[i];
    if (peek.type === 'IDENTIFIER') {
      i++;
      return new ast.IdentifierNode({ uri, range: peek.range }, peek.value);
    }
    errors.push({
      location: { uri, range: peek.range },
      message: `Expected identifier but got ${JSON.stringify(peek.type)}`,
    });
    throw new Exception();
  }

  function parseTypeExpression(): ast.TypeExpression {
    const firstIdentifier = parseIdentifier();
    const start = firstIdentifier.location.range.start;
    const secondIdentifier = consume('.') ?
      (!atFirstTokenOfNewLine() && at('IDENTIFIER')) ?
        parseIdentifier() :
        new ast.IdentifierNode({ uri, range: tokens[i - 1].range }, '') :
      null;
    const identifier = secondIdentifier || firstIdentifier;
    const qualifier = secondIdentifier ? firstIdentifier : null;
    const args: ast.TypeExpression[] = [];
    let end = identifier.location.range.end;
    if (consume('[')) {
      while (!atEOF() && !at(']')) {
        args.push(parseTypeExpression());
        if (!consume(',')) break;
      }
      end = expect(']').range.end;
    }
    const location: ast.Location = { uri, range: { start, end } };
    const coreExpression = new ast.TypeExpression(location, qualifier, identifier, args);
    if (at('?')) {
      const nullableIdentifier = new ast.IdentifierNode({ uri, range: next().range }, 'Nullable');
      const nullableRange: Range = { start, end: nullableIdentifier.location.range.end };
      const nullableLocation: ast.Location = { uri, range: nullableRange };
      return new ast.TypeExpression(nullableLocation, null, nullableIdentifier, [coreExpression]);
    }
    return coreExpression;
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
      return consume(':') || consume('=>');
    } finally {
      i = j;
    }
  }

  function parseLiteral(): ast.Literal {
    if (at('null')) return new ast.NullLiteral({ uri, range: next().range });
    if (at('true')) return new ast.BooleanLiteral({ uri, range: next().range }, true);
    if (at('false')) return new ast.BooleanLiteral({ uri, range: next().range }, false);
    if (at('NUMBER')) return new ast.NumberLiteral({ uri, range: tokens[i].range }, next().value as number);
    if (at('STRING')) return parseStringLiteral();
    if (consume('-')) {
      return new ast.NumberLiteral({ uri, range: tokens[i].range }, -(expect('NUMBER').value as number));
    }
    errors.push({
      location: { uri, range: tokens[i].range },
      message: `Expected literal expression`,
    });
    return new ast.NullLiteral({ uri, range: tokens[i].range });
  }

  function parseParameter(): ast.Parameter {
    const identifier = parseIdentifier();
    const type = consume(':') ? parseTypeExpression() : null;
    const value = consume('=') ? parseLiteral() : null;
    const location = {
      uri,
      range: {
        start: identifier.location.range.start,
        end:
          value ? value.location.range.end :
            type ? type.location.range.end :
              identifier.location.range.end,
      }
    };
    return new ast.Parameter(location, true, identifier, type, null, value);
  }

  function parseParameters(): ast.Parameter[] {
    expect('(');
    const parameters: ast.Parameter[] = [];
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
    if (peek.type === 'null') {
      i++;
      return new ast.NullLiteral({ uri, range: peek.range });
    }
    if (peek.type === 'true') {
      i++;
      return new ast.BooleanLiteral({ uri, range: peek.range }, true);
    }
    if (peek.type === 'false') {
      i++;
      return new ast.BooleanLiteral({ uri, range: peek.range }, false);
    }
    if (peek.type === 'NUMBER') {
      i++;
      return new ast.NumberLiteral({ uri, range: peek.range }, peek.value);
    }
    if (peek.type === 'STRING') {
      return parseStringLiteral();
    }
    if (peek.type === 'IDENTIFIER') {
      const identifier = parseIdentifier();
      if (consume('=')) {
        const rhs = parseExpression();
        const range = { start: identifier.location.range.start, end: rhs.location.range.end };
        return new ast.Assignment({ uri, range }, identifier, rhs);
      }
      if (consume('=>')) {
        const body = parseBlockOrQuickReturnExpression();
        const range = { start: identifier.location.range.start, end: body.location.range.end };
        return new ast.FunctionDisplay(
          { uri, range },
          [new ast.Parameter(identifier.location, true, identifier, null, null, null)],
          null,
          body);
      }
      return identifier;
    }
    if (peek.type === '(') {
      if (atFunctionDisplay()) {
        const parameters = parseParameters();
        const returnType = consume(':') ? parseTypeExpression() : null;
        expect('=>');
        const body = parseBlockOrQuickReturnExpression();
        const range = { start: peek.range.start, end: body.location.range.end };
        return new ast.FunctionDisplay({ uri, range }, parameters, returnType, body);
      }
      i++;
      const innerExpression = parseExpression();
      expect(')');
      return innerExpression;
    }
    if (peek.type === '[') {
      i++;
      const start = peek.range.start;
      const elements: ast.Expression[] = [];
      while (!atEOF() && !at(']')) {
        elements.push(parseExpression());
        if (!consume(',')) break;
      }
      const end = expect(']').range.end;
      return new ast.ListDisplay({ uri, range: { start, end } }, elements);
    }
    if (consume('new')) {
      const start = peek.range.start;
      const type = parseTypeExpression();
      // emit error if args is missing, but don't fail the parse.
      // This allows autocomplete to happen for new expressions
      if (!at('(')) {
        errors.push({
          location: { uri, range: tokens[i].range },
          message: "Expected new expression arguments",
        });
      }
      const [_, args, end] = at('(') ?
        parseArgsWithParens() : [start, [], type.location.range.end];
      return new ast.New({ uri, range: { start, end } }, type, args);
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
    if (consume('not')) {
      const start = peek.range.start;
      const expression = parsePrec(PREC_UNARY_NOT);
      const end = expression.location.range.end;
      return new ast.LogicalNot({ uri, range: { start, end } }, expression);
    }
    if (consume('native')) {
      const start = peek.range.start;
      if (at('STRING')) {
        // native expression
        const stringToken = expect('STRING');
        const end = stringToken.range.end;
        const source = new ast.StringLiteral(
          { uri, range: stringToken.range }, stringToken.value as string);
        return new ast.NativeExpression({ uri, range: { start, end } }, source);
      }
      // native pure function
      const identifier = at('IDENTIFIER') ? parseIdentifier() : undefined;
      const parameters = parseParameters();
      const returnType = consume(':') ? parseTypeExpression() : null;
      const body = parseNativePureFunctionBody();
      const end = tokens[i - 1].range.end;
      return new ast.NativePureFunction(
        { uri, range: { start, end } }, identifier, parameters, returnType, body);
    }
    const unopMethod = UnopMethodMap.get(peek.type);
    if (unopMethod) {
      i++;
      const arg = parsePrec(PREC_UNARY_MINUS);
      const identifier = new ast.IdentifierNode({ uri, range: peek.range }, unopMethod);
      const location: ast.Location = {
        uri, range: {
          start: peek.range.start, end: arg.location.range.end
        }
      };
      return new ast.MethodCall(location, arg, identifier, []);
    }
    errors.push({
      location: { uri, range: peek.range },
      message: `Expected expression but got ${JSON.stringify(peek.type)}`,
    });
    throw new Exception();
  }

  function parseNativePureFunctionBody(): [ast.IdentifierNode, ast.StringLiteral][] {
    const body: [ast.IdentifierNode, ast.StringLiteral][] = [];

    // syntactic sugar for simple expressions
    if (at('STRING')) {
      const stringToken = expect('STRING');
      const location: ast.Location = { uri, range: stringToken.range };
      const identifier = new ast.IdentifierNode(location, 'js');
      const stringLiteral = new ast.StringLiteral(location, `return ${stringToken.value}`);
      return [[identifier, stringLiteral]];
    }

    // Otherwise, we have a block of content
    expect('{');
    while (!atEOF() && !at('}')) {
      const identifier = parseIdentifier();
      const implementation = parseStringLiteral();
      body.push([identifier, implementation]);
    }
    expect('}');

    return body;
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

  function parseArgsWithParens(): [Position, ast.Expression[], Position] {
    const args: ast.Expression[] = [];
    const start = expect('(').range.start;
    while (!atEOF() && !at(')')) {
      args.push(parseExpression());
      if (!consume(',')) {
        break;
      }
    }
    const end = expect(')').range.end;
    return [start, args, end];
  }

  function parseInfix(lhs: ast.Expression, startRange: Range): ast.Expression {
    const optok = tokens[i];
    const tokenType = optok.type;
    if (tokenType === '(') {
      const methodIdentifier = new ast.IdentifierNode({ uri, range: optok.range }, '__call__');
      const args = parseArgs();
      const end = tokens[i - 1].range.end;
      return new ast.MethodCall(
        { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, args);
    }
    if (consume('as')) {
      const type = parseTypeExpression();
      return new ast.TypeAssertion(
        { uri, range: { start: lhs.location.range.start, end: type.location.range.end } },
        lhs, type);
    }
    if (consume('.')) {
      if (!at('IDENTIFIER') || atFirstTokenOfNewLine()) {
        // If the person is just typing, the dot might not yet be followed by any name.
        // We still want the parse to succeed so that we can provide completion
        const location: ast.Location = { uri, range: tokens[i - 1].range };
        const identifier = new ast.IdentifierNode(location, '');
        return new ast.MethodCall(location, lhs, identifier, []);
      }
      const identifier = parseIdentifier();
      if (at('(') && !atFirstTokenOfNewLine()) {
        const args = parseArgs();
        const end = tokens[i - 1].range.end;
        return new ast.MethodCall(
          { uri, range: { start: startRange.start, end } }, lhs, identifier, args);
      }
      if (consume('=')) {
        const methodIdentifier = new ast.IdentifierNode(
          identifier.location, `__set_${identifier.name}`);
        const value = parseExpression();
        const end = tokens[i - 1].range.end;
        return new ast.MethodCall(
          { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, [value]);
      }
      const methodIdentifier = new ast.IdentifierNode(
        identifier.location, `__get_${identifier.name}`);
      const end = tokens[i - 1].range.end;
      return new ast.MethodCall(
        { uri, range: { start: startRange.start, end } }, lhs, methodIdentifier, []);
    }
    if (consume('[')) {
      const optokLocation: ast.Location = { uri, range: optok.range };
      const index = parseExpression();
      const bracketEnd = expect(']').range.end;
      if (consume('=')) {
        const value = parseExpression();
        const valueEnd = value.location.range.end;
        const methodIdentifier = new ast.IdentifierNode(optokLocation, '__setitem__');
        return new ast.MethodCall(
          { uri, range: { start: startRange.start, end: valueEnd } },
          lhs, methodIdentifier, [index, value]);
      }
      const methodIdentifier = new ast.IdentifierNode(optokLocation, '__getitem__');
      return new ast.MethodCall(
        { uri, range: { start: startRange.start, end: bracketEnd } },
        lhs, methodIdentifier, [index]);
    }
    const precedence = PrecMap.get(tokenType);
    if (precedence && consume('and')) {
      const rhs = parsePrec(precedence + 1);
      const location = {
        uri,
        range: { start: startRange.start, end: rhs.location.range.end },
      };
      return new ast.LogicalAnd(location, lhs, rhs);
    }
    if (precedence && consume('or')) {
      const rhs = parsePrec(precedence + 1);
      const location = {
        uri,
        range: { start: startRange.start, end: rhs.location.range.end },
      };
      return new ast.LogicalOr(location, lhs, rhs);
    }
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
      const methodIdentifier = new ast.IdentifierNode(
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
      // Some infix tokens that start on the next line should actually
      // be ignored.
      if ((tokens[i].type === '(' || tokens[i].type === '[') && atFirstTokenOfNewLine()) {
        break;
      }
      expr = parseInfix(expr, startRange);
    }
    return expr;
  }

  function parseExpression(): ast.Expression {
    return parsePrec(1);
  }

  function parseStatement(): ast.Statement {
    const peek = tokens[i];
    if (at('COMMENT')) return new ast.CommentStatement({ uri, range: peek.range }, next().value as string);
    if (consume(';')) return new ast.EmptyStatement({ uri, range: peek.range });
    if (at('return')) return parseReturn();
    if (at('if')) return parseIf();
    if (at('while')) return parseWhile();
    if (at('{')) return parseBlock();
    if (at('var') || at('const')) return parseDeclaration(false);
    if (at('native')) return parseNativeFunctionDefinition(false);
    if (at('function')) return parseFunctionDefinition(false);
    if (at('class')) return parseClassDefinition(false);
    if (at('interface')) return parseInterfaceDefinition(false);
    if (at('enum')) return parseEnumDefinition(false);
    if (at('typedef')) return parseTypedef(false);
    if (at('import')) return parseImport(false);
    if (consume('export')) {
      if (at('native')) return parseNativeFunctionDefinition(true);
      if (at('function')) return parseFunctionDefinition(true);
      if (at('class')) return parseClassDefinition(true);
      if (at('interface')) return parseInterfaceDefinition(true);
      if (at('enum')) return parseEnumDefinition(true);
      if (at('var') || at('const')) return parseDeclaration(true);
      if (at('typedef')) return parseTypedef(true);
      if (at('IDENTIFIER')) return parseImport(true);
      if (at('as')) return parseExportAs();

      // This is actually an error, but it helps autocomplete to not panic and return
      // some sensible values
      const location: ast.Location = { uri, range: tokens[i - 1].range };
      const identifier = new ast.IdentifierNode(location, 'export');
      errors.push({
        location,
        message: `export must be followed by a 'function', 'class', 'interface', 'var' or 'const'`,
      });
      return new ast.ExpressionStatement(location, identifier);
    }
    const expression = parseExpression();
    expectStatementDelimiter();
    return new ast.ExpressionStatement(expression.location, expression);
  }

  function parseReturn(): ast.Return {
    const start = expect('return').range.start;
    const value = parseExpression();
    const end = tokens[i].range.end;
    expectStatementDelimiter();
    return new ast.Return({ uri, range: { start, end } }, value);
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

  function parseDeclaration(isExported: boolean): ast.Declaration {
    const start = tokens[i].range.start;
    const isMutable = consume('const') ? false : (expect('var'), true);
    const identifier = parseIdentifier();
    const type = consume(':') ? parseTypeExpression() : null;
    const comment = consume('STRING') ?
      new ast.StringLiteral({ uri, range: tokens[i - 1].range }, tokens[i - 1].value as string) :
      null;
    const value = consume('=') ? parseExpression() : null;
    const end = expectStatementDelimiter().range.end;
    return new ast.Declaration(
      { uri, range: { start, end } }, isExported, isMutable, identifier, type, comment, value);
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

  function parseBlockOrQuickReturnExpression(): ast.Block {
    return at('{') ? parseBlock() : (() => {
      const expression = parseExpression();
      return new ast.Block(
        expression.location,
        [new ast.Return(expression.location, expression)]);
    })();
  }

  function parseNativeFunctionDefinition(isExported: boolean): ast.Declaration {
    const startPos = expect('native').range.start;
    const identifier = parseIdentifier();
    const comments = at('STRING') ? parseStringLiteral() : null;
    const parameters = parseParameters();
    const returnType = consume(':') ? parseTypeExpression() : null;
    const body = parseNativePureFunctionBody();
    const location: ast.Location =
      { uri, range: { start: startPos, end: tokens[i - 1].range.end } };
    return new ast.Declaration(
      location,
      isExported, false, identifier, null, comments,
      new ast.NativePureFunction(location, identifier, parameters, returnType, body));
  }

  function parseFunctionDefinition(isExported: boolean): ast.Declaration {
    const startPos = expect('function').range.start;
    const identifier = parseIdentifier();
    const comments = at('STRING') ? parseStringLiteral() : null;
    const parameters = parseParameters();
    const returnType = consume(':') ? parseTypeExpression() : null;
    const body = (atFirstTokenOfNewLine() || consume(';')) ?
      new ast.Block({ uri, range: tokens[i - 1].range }, []) :
      parseBlock();
    const location: ast.Location =
      { uri, range: { start: startPos, end: body.location.range.end } };
    return new ast.Declaration(
      location,
      isExported, false, identifier, null, comments,
      new ast.FunctionDisplay(location, parameters, returnType, body));
  }

  function parseClassDefinition(isExported: boolean): ast.ClassDefinition {
    const startPos = expect('class').range.start;
    const identifier = parseIdentifier();
    const extendsFragment = at('IDENTIFIER') ? parseIdentifier() : null;
    const superClass = consume('extends') ? parseTypeExpression() : null;
    if (!at('{')) {
      errors.push({
        location: identifier.location,
        message: `Class body missing`,
      });
    }
    const body = at('{') ? parseBlock() : new ast.Block(identifier.location, []);
    return new ast.ClassDefinition(
      { uri, range: { start: startPos, end: body.location.range.end } },
      isExported, identifier, extendsFragment, superClass, body.statements);
  }

  function parseInterfaceDefinition(isExported: boolean): ast.InterfaceDefinition {
    const startPos = expect('interface').range.start;
    const identifier = parseIdentifier();
    const extendsFragment = at('IDENTIFIER') ? parseIdentifier() : null;
    const superTypes: ast.TypeExpression[] = [];
    if (consume('extends')) {
      superTypes.push(parseTypeExpression());
      while (consume(',')) {
        superTypes.push(parseTypeExpression());
      }
    }
    if (!at('{')) {
      errors.push({
        location: identifier.location,
        message: `Interface body missing`,
      });
    }
    const body = at('{') ? parseBlock() : new ast.Block(identifier.location, []);
    return new ast.InterfaceDefinition(
      { uri, range: { start: startPos, end: body.location.range.end } },
      isExported, identifier, extendsFragment, superTypes, body.statements);
  }

  function parseEnumDefinition(isExported: boolean): ast.EnumDefinition {
    const startPos = expect('enum').range.start;
    const identifier = parseIdentifier();
    if (!at('{')) {
      errors.push({
        location: identifier.location,
        message: `Interface body missing`,
      });
    }
    const body = at('{') ? parseBlock() : new ast.Block(identifier.location, []);
    return new ast.EnumDefinition(
      { uri, range: { start: startPos, end: body.location.range.end } },
      isExported, identifier, body.statements);
  }

  function parseStringLiteral(): ast.StringLiteral {
    const stringToken = expect('STRING');
    const value = stringToken.value as string;
    return new ast.StringLiteral({ uri, range: stringToken.range }, value);
  }

  function parseImport(isExported: boolean): ast.Import | ast.ImportFrom {
    const start = isExported ? tokens[i - 1].range.start : expect('import').range.start;
    if (at('IDENTIFIER')) {
      const identifier = parseIdentifier();
      expect('from');
      const path = parseStringLiteral();
      const end = path.location.range.end;
      return new ast.ImportFrom({ uri, range: { start, end } }, isExported, identifier, path);
    }
    if (isExported) {
      errors.push({
        location: { uri, range: tokens[i - 1].range },
        message: `export not supported for this style of import`,
      });
    }
    const path = parseStringLiteral();
    expect('as');
    const identifier = parseIdentifier();
    const end = identifier.location.range.end;
    return new ast.Import({ uri, range: { start, end } }, path, identifier);
  }

  function parseTypedef(isExported: boolean): ast.Typedef {
    const start = expect('typedef').range.start;
    const identifier = parseIdentifier();
    expect('=');
    const type = parseTypeExpression();
    const end = type.location.range.end;
    return new ast.Typedef({ uri, range: { start, end } }, isExported, identifier, type);
  }

  function parseExportAs(): ast.ExportAs {
    const start = tokens[i - 1].range.start;
    expect('as');
    const identifier = parseIdentifier();
    const end = identifier.location.range.end;
    return new ast.ExportAs({ uri, range: { start, end } }, identifier);
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
    documentVersion,
    globalStatements, errors);
}

type AstCacheEntry = {
  readonly version: number,
  readonly node: ast.File,
};

const astCache = new Map<string, AstCacheEntry>();

export async function getAstForDocument(document: vscode.TextDocument): Promise<ast.File> {
  const key = document.uri.toString();
  const version = document.version;
  const entry = astCache.get(key);
  // console.log(`DEBUG getAstForDocument ${key} ${entry && entry.version === version ? '(cached)' : ''}`);
  if (entry && entry.version === version) return entry.node;

  const node = parse(document.uri, document.getText(), document.version);
  removeUriFromSymbolRegistry(key);
  for (const statement of node.statements) {
    if (statement instanceof ast.ExportAs) {
      removeUriFromSymbolRegistry(key);
      registerSymbol(statement.identifier.name, key, 'module');
      break;
    }
    if ((statement instanceof ast.InterfaceDefinition ||
      statement instanceof ast.ClassDefinition ||
      statement instanceof ast.EnumDefinition ||
      (statement instanceof ast.Declaration && !statement.isMutable)) &&
      statement.isExported) {
      registerSymbol(statement.identifier.name, key, 'member');
    }
  }
  astCache.set(key, { version, node });
  return node;
}
