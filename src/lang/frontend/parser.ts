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

// Keywords that can be used as identifiers in some cases
const PROPERTY_KEYWORDS = new Set<TokenType>([
  'from',
  'for',
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

  function atPropertyIdentifier() {
    return at('IDENTIFIER') || PROPERTY_KEYWORDS.has(tokens[i].type);
  }

  function atEOF(): boolean {
    return i >= tokens.length || tokens[i].type === 'EOF';
  }

  function atFirstTokenOfNewLine(j?: number): boolean {
    const k = j ?? i;
    return k === 0 || (tokens[k - 1].range.end.line < tokens[k].range.start.line);
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
    if (at('COMMENT') && atFirstTokenOfNewLine(i + 1)) {
      return next();
    }
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

  function parsePropertyIdentifier(): ast.IdentifierNode {
    const peek = tokens[i];
    if (PROPERTY_KEYWORDS.has(peek.type)) {
      i++;
      return new ast.IdentifierNode({ uri, range: peek.range }, peek.type);
    }
    return parseIdentifier();
  }

  /** A Type expression is expected, but if not found, add an error and return gracefully
   * with a dummy type expression */
  function tryParseTypeExpression(): ast.TypeExpression {
    if (at('IDENTIFIER')) return parseTypeExpression();
    const range = tokens[i].range;
    const location = { uri, range };
    errors.push({ location, message: 'Expected type expression' });
    const identifier = new ast.IdentifierNode(location, 'Null');
    return new ast.Typename(location, undefined, identifier);
  }

  function parsePrimaryTypeExpression(): ast.TypeExpression {
    if (consume('(')) {
      const te = parseTypeExpression();
      expect(')');
      return te;
    }
    if (!at('IDENTIFIER')) {
      const location: ast.Location = { uri, range: tokens[i].range };
      errors.push({
        location,
        message: `Expected type expression`,
      });
      next();
      return new ast.Typename(location, undefined, new ast.IdentifierNode(location, 'Any'));
    }
    const firstIdentifier = parseIdentifier();
    if (consume('.')) {
      const secondIdentifier = (!atFirstTokenOfNewLine() && at('IDENTIFIER')) ?
        parseIdentifier() : new ast.IdentifierNode({ uri, range: tokens[i - 1].range }, '');
      return new ast.Typename(firstIdentifier.location, firstIdentifier, secondIdentifier);
    }
    if (consume('[')) {
      const bracketStart = tokens[i - 1].range.start;
      const start = firstIdentifier.location.range.start;
      const args: ast.TypeExpression[] = [];
      while (!atEOF() && !at(']')) {
        while (consume('COMMENT'));
        args.push(parseTypeExpression());
        if (!consume(',')) break;
        while (consume('COMMENT'));
      }
      const end = expect(']').range.end;
      return new ast.SpecialTypeDisplay({ uri, range: { start, end } }, firstIdentifier, args);
    }
    return new ast.Typename(firstIdentifier.location, undefined, firstIdentifier);
  }

  function parseTypeExpression(): ast.TypeExpression {
    const start = tokens[i].range.start;
    let te = parsePrimaryTypeExpression();
    if (at('?')) {
      const nullableIdentifier = new ast.IdentifierNode({ uri, range: next().range }, 'Nullable');
      const nullableRange: Range = { start, end: nullableIdentifier.location.range.end };
      const nullableLocation: ast.Location = { uri, range: nullableRange };
      te = new ast.SpecialTypeDisplay(nullableLocation, nullableIdentifier, [te]);
    }
    if (at('|')) {
      const unionIdentifier = new ast.IdentifierNode({ uri, range: next().range }, 'Union');
      const rhs = parseTypeExpression();
      const unionRange: Range = { start, end: rhs.location.range.end };
      const unionLocation: ast.Location = { uri, range: unionRange };
      if (rhs instanceof ast.SpecialTypeDisplay && rhs.identifier.name === 'Union') { // rhs is also a union (merge them)
        te = new ast.SpecialTypeDisplay(unionLocation, unionIdentifier, [te, ...rhs.args]);
      } else {
        te = new ast.SpecialTypeDisplay(unionLocation, unionIdentifier, [te, rhs]);
      }
    }
    return te;
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
    if (at('NUMBER')) return parseNumberLiteral();
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

  function parseTypeParameter(): ast.TypeParameter {
    const identifier = parseIdentifier();
    const constraint = consume(':') ? tryParseTypeExpression() : undefined;
    return new ast.TypeParameter(identifier.location, identifier, constraint);
  }

  function parseTypeParameters(): ast.TypeParameter[] {
    expect('[');
    const typeParameters: ast.TypeParameter[] = [];
    while (!atEOF() && !at(']')) {
      while (consume('COMMENT'));
      typeParameters.push(parseTypeParameter());
      if (!consume(',')) {
        break;
      }
      while (consume('COMMENT'));
    }
    expect(']');
    return typeParameters;
  }

  function parseParameter(): ast.Parameter {
    const isMutable = consume('var');
    const identifier = parseIdentifier();
    const type = consume(':') ? tryParseTypeExpression() : null;
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
    return new ast.Parameter(location, isMutable, identifier, type, null, value);
  }

  function parseParameters(): ast.Parameter[] {
    if (!at('(')) {
      // We want the parse to succeed so that we can still have IDE functionality,
      // but we still want to flag an error
      errors.push({ location: { uri, range: tokens[i].range }, message: "Expected '('" });
      return [];
    }
    expect('(');
    const parameters: ast.Parameter[] = [];
    while (!atEOF() && !at(')')) {
      while (consume('COMMENT'));
      parameters.push(parseParameter());
      if (!consume(',')) {
        break;
      }
      while (consume('COMMENT'));
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
    if (consume('yield')) {
      const value = parseExpression();
      const range: Range = { start: peek.range.start, end: value.location.range.end };
      return new ast.Yield({ uri, range }, value);
    }
    if (consume('await')) {
      const value = parseExpression();
      const range: Range = { start: peek.range.start, end: value.location.range.end };
      return new ast.Await({ uri, range }, value);
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
          false,
          false,
          undefined,
          [new ast.Parameter(identifier.location, true, identifier, null, null, null)],
          null,
          body);
      }
      return identifier;
    }
    if (peek.type === '(' || peek.type === 'async' || peek.type === 'function') {
      if (peek.type === 'function' || peek.type === 'async' || atFunctionDisplay()) {
        const isAsync = consume('async');
        consume('function');
        const isGenerator = consume('*');
        const parameters = parseParameters();
        const returnType = consume(':') ? parseTypeExpression() : null;
        expect('=>');
        const body = parseBlockOrQuickReturnExpression();
        const range = { start: peek.range.start, end: body.location.range.end };
        return new ast.FunctionDisplay({ uri, range }, isAsync, isGenerator, undefined, parameters, returnType, body);
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
        while (consume('COMMENT'));
        elements.push(parseExpression());
        if (!consume(',')) break;
        while (consume('COMMENT'));
      }
      const end = expect(']').range.end;
      return new ast.ListDisplay({ uri, range: { start, end } }, elements);
    }
    if (peek.type === '{') {
      i++;
      const start = peek.range.start;
      const entries: ast.RecordDisplayEntry[] = [];
      while (!atEOF() && !at('}')) {
        while (consume('COMMENT'));
        const isMutable = consume('var');
        const identifier = parseIdentifier();
        expect(':');
        while (consume('COMMENT'));
        const value = parseExpression();
        entries.push({ isMutable, identifier, value });
        if (!consume(',')) break;
        while (consume('COMMENT'));
      }
      const end = expect('}').range.end;
      return new ast.RecordDisplay({ uri, range: { start, end } }, entries);
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
      const kindFragment = at('IDENTIFIER') ? parseIdentifier() : null;
      if (!at('function')) {
        // native expression
        const isInline = consume('constexpr');
        const source = at('STRING') ? parseStringLiteral() : new ast.StringLiteral(
          { uri, range: tokens[i - 1].range }, "");
        const end = source.location.range.end;
        return new ast.NativeExpression({ uri, range: { start, end } }, kindFragment, isInline, source);
      }
      // native pure function
      expect('function');
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

  function parseNativePureFunctionBody(): ast.Block {
    // syntactic sugar for simple expressions
    if (at('STRING')) {
      const stringLiteral = parseStringLiteral();
      const location = stringLiteral.location;
      return new ast.Block(location, [
        new ast.ExpressionStatement(
          location,
          new ast.MethodCall(
            location,
            new ast.IdentifierNode(location, 'returns'),
            new ast.IdentifierNode(location, '__call__'),
            [stringLiteral]),
        )
      ]);
    }

    // Otherwise, we have a block
    return parseBlock();
  }

  function parseArgs(): ast.Expression[] {
    const args: ast.Expression[] = [];
    expect('(');
    while (!atEOF() && !at(')')) {
      while (consume('COMMENT')); // allow preceeding comments in argument lists
      args.push(parseExpression());
      if (!consume(',')) {
        break;
      }
      while (consume('COMMENT')); // allow trailing comments in argument lists
    }
    expect(')');
    return args;
  }

  function parseInfix(lhs: ast.Expression, startRange: Range): ast.Expression {
    const optok = tokens[i];
    const tokenType = optok.type;
    if (tokenType === '(') {
      let methodIdentifierRange = optok.range;
      if (lhs instanceof ast.IdentifierNode) {
        methodIdentifierRange = {
          start: lhs.location.range.start,
          end: optok.range.end,
        };
      }
      const methodIdentifier = new ast.IdentifierNode({ uri, range: methodIdentifierRange }, '__call__');
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
      if (!atPropertyIdentifier() || atFirstTokenOfNewLine()) {
        // If the person is just typing, the dot might not yet be followed by any name.
        // We still want the parse to succeed so that we can provide completion
        const location: ast.Location = { uri, range: tokens[i - 1].range };
        const identifier = new ast.IdentifierNode(location, '');
        return new ast.MethodCall(location, lhs, identifier, []);
      }
      const identifier = parsePropertyIdentifier();
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
    if (at('for')) return parseFor();
    if (at('break')) return parseBreak();
    if (at('continue')) return parseContinue();
    if (at('{')) return parseBlock();
    if (at('static')) return parseStatic();
    if (at('var') || at('const')) return parseDeclaration(false);
    if (at('native')) return parseNativeFunctionDefinition(false);
    if (at('function') || at('async')) return parseFunctionDefinition(false);
    if (at('class') || at('abstract')) return parseClassDefinition(false);
    if (at('interface')) return parseInterfaceDefinition(false);
    if (at('enum')) return parseEnumDefinition(false);
    if (at('typedef')) return parseTypedef(false);
    if (at('import')) return parseImportAs();
    if (at('from')) return parseFromImport();
    if (consume('export')) {
      if (at('native')) return parseNativeFunctionDefinition(true);
      if (at('function') || at('async')) return parseFunctionDefinition(true);
      if (at('class') || at('abstract')) return parseClassDefinition(true);
      if (at('interface')) return parseInterfaceDefinition(true);
      if (at('enum')) return parseEnumDefinition(true);
      if (at('var') || at('const')) return parseDeclaration(true);
      if (at('typedef')) return parseTypedef(true);
      if (at('as')) return parseExportAs();

      // This is actually an error, but it helps autocomplete to not panic and return
      // some sensible values
      const location: ast.Location = { uri, range: tokens[i - 1].range };
      const identifier = new ast.IdentifierNode(location, 'export');
      errors.push({
        location,
        message: `unrecognized export statement syntax`,
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

  function parseFor(): ast.For {
    const start = expect('for').range.start;
    const isMutable = consume('var');
    const identifier = parseIdentifier();
    expect('in');
    const collection = parseExpression();
    const body = parseBlock();
    const end = body.location.range.end;
    return new ast.For({ uri, range: { start, end } }, isMutable, identifier, collection, body);
  }

  function parseBreak(): ast.Break {
    const range = expect('break').range;
    return new ast.Break({ uri, range });
  }

  function parseContinue(): ast.Continue {
    const range = expect('continue').range;
    return new ast.Continue({ uri, range });
  }

  function parseDeclaration(isExported: boolean): ast.Declaration {
    const start = tokens[i].range.start;
    const isMutable = consume('const') ? false : (expect('var'), true);
    const identifier = parsePropertyIdentifier();
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

  function parseStatic(): ast.Static {
    const start = expect('static').range.start;
    const block = parseBlock();
    const end = block.location.range.end;
    const statements = block.statements;
    const location: ast.Location = { uri, range: { start, end } };
    return new ast.Static(location, statements);
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
    expect('function');
    const identifier = parsePropertyIdentifier();
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
    const startPos = tokens[i].range.start;
    const isAsync = consume('async');
    expect('function');
    const isGenerator = consume('*');
    const identifier = parsePropertyIdentifier();
    const comments = at('STRING') ? parseStringLiteral() : null;
    const typeParameters = at('[') ? parseTypeParameters() : undefined;
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
      new ast.FunctionDisplay(location, isAsync, isGenerator, typeParameters, parameters, returnType, body));
  }

  function parseClassDefinition(isExported: boolean): ast.ClassDefinition {
    const startPos = tokens[i].range.start;
    const isAbstract = consume('abstract');
    expect('class');
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
      isExported, isAbstract, identifier, extendsFragment, superClass, body.statements);
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

  function parseNumberLiteral(): ast.NumberLiteral {
    const numberToken = expect('NUMBER');
    const value = numberToken.value as number;
    return new ast.NumberLiteral({ uri, range: numberToken.range }, value);
  }

  function parseStringLiteral(): ast.StringLiteral {
    const stringToken = expect('STRING');
    const value = stringToken.value as string;
    return new ast.StringLiteral({ uri, range: stringToken.range }, value);
  }

  function parseFromImport(): ast.FromImport {
    const start = expect('from').range.start;
    const path = parseStringLiteral();
    const isExported = consume('export');
    if (!isExported) expect('import');
    const identifier = parseIdentifier();
    const end = identifier.location.range.end;
    return new ast.FromImport({ uri, range: { start, end } }, path, isExported, identifier);
  }

  function parseImportAs(): ast.ImportAs | ast.FromImport {
    const start = expect('import').range.start;
    const path = parseStringLiteral();
    expect('as');
    const identifier = parseIdentifier();
    const end = identifier.location.range.end;
    return new ast.ImportAs({ uri, range: { start, end } }, path, identifier);
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

export async function getAstForUri(uri: vscode.Uri): Promise<ast.File> {
  let maybeDocument: vscode.TextDocument | undefined;
  try {
    maybeDocument = await vscode.workspace.openTextDocument(uri);
  } catch (e) { }
  const document = maybeDocument;
  if (document) return await getAstForDocument(document);
  const position: Position = { line: 0, column: 0, index: 0 };
  const range: Range = { start: position, end: position };
  const location: ast.Location = { uri, range };
  return document ? getAstForDocument(document) : new ast.File(
    location, -1, [], [{ location, message: `module not found` }]);
}

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
      statement instanceof ast.Typedef ||
      (statement instanceof ast.Declaration && !statement.isMutable)) &&
      statement.isExported) {
      registerSymbol(statement.identifier.name, key, 'member');
    }
  }
  astCache.set(key, { version, node });
  return node;
}
