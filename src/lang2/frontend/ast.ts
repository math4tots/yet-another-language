import { Range } from "./lexer";


export type TypeExpression = Identifier | QualifiedIdentifier;

export type Expression = NilLiteral |
  BoolLiteral |
  NumberLiteral |
  StringLiteral |
  Identifier;

export type Statement = ExpressionStatement |
  IfStatement |
  WhileStatement |
  BreakStatement |
  ContinueStatement |
  ReturnStatement |
  FunctionDefinition |
  InterfaceDefinition |
  ClassDefinition;


export class NilLiteral {
  readonly range: Range;

  constructor(range: Range) {
    this.range = range;
  }
}

export class BoolLiteral {
  readonly range: Range;
  readonly value: boolean;

  constructor(range: Range, value: boolean) {
    this.range = range;
    this.value = value;
  }
}

export class NumberLiteral {
  readonly range: Range;
  readonly value: number;

  constructor(range: Range, value: number) {
    this.range = range;
    this.value = value;
  }
}

export class StringLiteral {
  readonly range: Range;
  readonly value: string;

  constructor(range: Range, value: string) {
    this.range = range;
    this.value = value;
  }
}

export class Identifier {
  readonly range: Range;
  readonly name: string;

  constructor(range: Range, name: string) {
    this.range = range;
    this.name = name;
  }
}

export class QualifiedIdentifier {
  readonly range: Range;
  readonly qualifier: Identifier;
  readonly member: Identifier;

  constructor(range: Range, qualifier: Identifier, member: Identifier) {
    this.range = range;
    this.qualifier = qualifier;
    this.member = member;
  }
}

export class ExpressionStatement {
  readonly range: Range;
  readonly expression: Expression;

  constructor(range: Range, expression: Expression) {
    this.range = range;
    this.expression = expression;
  }
}

export class Block {
  readonly range: Range;
  readonly statements: Statement[];

  constructor(range: Range, statements: Statement[]) {
    this.range = range;
    this.statements = statements;
  }
}

export class IfClause {
  readonly range: Range;
  readonly condition: Expression;
  readonly body: Block;

  constructor(range: Range, condition: Expression, body: Block) {
    this.range = range;
    this.condition = condition;
    this.body = body;
  }
}

export class IfStatement {
  readonly range: Range;
  readonly ifClauses: IfClause[];
  readonly elseClause: Block | undefined;

  constructor(range: Range, ifClauses: IfClause[], elseClause: Block | undefined) {
    this.range = range;
    this.ifClauses = ifClauses;
    this.elseClause = elseClause;
  }
}

export class WhileStatement {
  readonly range: Range;
  readonly condition: Expression;
  readonly body: Block;

  constructor(range: Range, condition: Expression, body: Block) {
    this.range = range;
    this.condition = condition;
    this.body = body;
  }
}

export class BreakStatement {
  readonly range: Range;

  constructor(range: Range) {
    this.range = range;
  }
}

export class ContinueStatement {
  readonly range: Range;

  constructor(range: Range) {
    this.range = range;
  }
}

export class ReturnStatement {
  readonly range: Range;
  readonly value: Expression | undefined;

  constructor(range: Range, value: Expression | undefined) {
    this.range = range;
    this.value = value;
  }
}

export class TypeParameter {
  readonly range: Range;
  readonly identifier: Identifier;
  readonly upperBound: TypeExpression | undefined;

  constructor(range: Range, identifier: Identifier, upperBound: TypeExpression | undefined) {
    this.range = range;
    this.identifier = identifier;
    this.upperBound = upperBound;
  }
}

export class Parameter {
  readonly range: Range;
  readonly isVariadic: boolean;
  readonly identifier: Identifier;
  readonly type: TypeExpression | undefined;
  readonly defaultValue: Expression | undefined;

  constructor(
    range: Range,
    isVariadic: boolean,
    identifier: Identifier,
    type: TypeExpression | undefined,
    defaultValue: Expression | undefined) {
    this.range = range;
    this.isVariadic = isVariadic;
    this.identifier = identifier;
    this.type = type;
    this.defaultValue = defaultValue;
  }
}

export class FunctionDefinition {
  readonly range: Range;
  readonly identifier: Identifier;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly parameters: Parameter[];
  readonly returnType: TypeExpression | undefined;
  readonly body: Block;

  constructor(
    range: Range,
    identifier: Identifier,
    typeParameters: TypeParameter[] | undefined,
    parameters: Parameter[],
    returnType: TypeExpression | undefined,
    body: Block) {
    this.range = range;
    this.identifier = identifier;
    this.typeParameters = typeParameters;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }
}

export class InterfaceDefinition {
  readonly range: Range;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly identifier: Identifier;
  readonly superTypes: TypeExpression[];
  readonly body: Block;

  constructor(
    range: Range,
    typeParameters: TypeParameter[] | undefined,
    identifier: Identifier,
    superTypes: TypeExpression[],
    body: Block) {
    this.range = range;
    this.typeParameters = typeParameters;
    this.identifier = identifier;
    this.superTypes = superTypes;
    this.body = body;
  }
}

export class ClassDefinition {
  readonly range: Range;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly identifier: Identifier;
  readonly baseClass: TypeExpression | undefined;
  readonly body: Block;

  constructor(
    range: Range,
    typeParameters: TypeParameter[] | undefined,
    identifier: Identifier,
    baseClass: TypeExpression | undefined,
    body: Block) {
    this.range = range;
    this.typeParameters = typeParameters;
    this.identifier = identifier;
    this.baseClass = baseClass;
    this.body = body;
  }
}
