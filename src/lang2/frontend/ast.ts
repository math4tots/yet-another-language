import { Range } from "./lexer";


export type TypeExpression =
  Name |
  QualifiedName |
  ReifiedTypeDisplay |
  FunctionTypeDisplay;

export type Expression = NullLiteral |
  BoolLiteral |
  NumberLiteral |
  StringLiteral |
  Name |
  Assignment |
  ListDisplay |
  RecordDisplay |
  MethodCall |
  LogicalOperator |
  TypeAssertion |
  NativeExpression;

export type HeaderItem = StringLiteral |
  ExportAs |
  ImportAs |
  FromImport;

export type Declaration = VariableDeclaration |
  FunctionDefinition |
  InterfaceDefinition |
  ClassDefinition;

export type Statement = ExpressionStatement |
  IfStatement |
  WhileStatement |
  BreakStatement |
  ContinueStatement |
  ReturnStatement |
  Declaration;

export class ParseError {
  readonly range: Range;
  readonly message: string;

  constructor(range: Range, message: string) {
    this.range = range;
    this.message = message;
  }
}

export class NullLiteral {
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

export class Name {
  readonly range: Range;
  readonly value: string;

  constructor(range: Range, value: string) {
    this.range = range;
    this.value = value;
  }
}

export class QualifiedName {
  readonly range: Range;
  readonly qualifier: Name;
  readonly member: Name;

  constructor(range: Range, qualifier: Name, member: Name) {
    this.range = range;
    this.qualifier = qualifier;
    this.member = member;
  }
}

export class ReifiedTypeDisplay {
  readonly range: Range;
  readonly name: Name | QualifiedName;
  readonly args: TypeExpression[];

  constructor(range: Range, name: Name | QualifiedName, args: TypeExpression[]) {
    this.range = range;
    this.name = name;
    this.args = args;
  }
}

export class FunctionTypeDisplay {
  readonly range: Range;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly parameters: Parameter[];
  readonly returnType: TypeExpression;

  constructor(
    range: Range,
    typeParameters: TypeParameter[] | undefined,
    parameters: Parameter[],
    returnType: TypeExpression) {
    this.range = range;
    this.typeParameters = typeParameters;
    this.parameters = parameters;
    this.returnType = returnType;
  }
}

export class Assignment {
  readonly range: Range;
  readonly target: Name;
  readonly value: Expression;

  constructor(range: Range, target: Name, value: Expression) {
    this.range = range;
    this.target = target;
    this.value = value;
  }
}

export class ListDisplay {
  readonly range: Range;
  readonly values: Expression[];

  constructor(range: Range, values: Expression[]) {
    this.range = range;
    this.values = values;
  }
}

export class RecordDisplay {
  readonly range: Range;
  readonly entries: [(Name | StringLiteral), Expression][];

  constructor(range: Range, entries: [(Name | StringLiteral), Expression][]) {
    this.range = range;
    this.entries = entries;
  }
}

export class MethodCall {
  readonly range: Range;
  readonly owner: Expression;
  readonly name: Name;
  readonly args: Expression[];

  constructor(range: Range, owner: Expression, name: Name, args: Expression[]) {
    this.range = range;
    this.owner = owner;
    this.name = name;
    this.args = args;
  }
}

export type LogicalOperatorType = 'and' | 'or' | 'if' | 'not';

export class LogicalOperator {
  readonly range: Range;
  readonly type: LogicalOperatorType;
  readonly args: Expression[];

  constructor(range: Range, type: LogicalOperatorType, args: Expression[]) {
    this.range = range;
    this.type = type;
    this.args = args;
  }
}

export class TypeAssertion {
  readonly range: Range;
  readonly expression: Expression;
  readonly type: TypeExpression;

  constructor(range: Range, expression: Expression, type: TypeExpression) {
    this.range = range;
    this.expression = expression;
    this.type = type;
  }
}

export class NativeExpression {
  readonly range: Range;
  readonly code: StringLiteral;

  constructor(range: Range, code: StringLiteral) {
    this.range = range;
    this.code = code;
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
  readonly name: Name;
  readonly upperBound: TypeExpression | undefined;

  constructor(range: Range, name: Name, upperBound: TypeExpression | undefined) {
    this.range = range;
    this.name = name;
    this.upperBound = upperBound;
  }
}

export class Parameter {
  readonly range: Range;
  readonly isVariadic: boolean;
  readonly name: Name;
  readonly type: TypeExpression | undefined;
  readonly defaultValue: Expression | undefined;

  constructor(
    range: Range,
    isVariadic: boolean,
    name: Name,
    type: TypeExpression | undefined,
    defaultValue: Expression | undefined) {
    this.range = range;
    this.isVariadic = isVariadic;
    this.name = name;
    this.type = type;
    this.defaultValue = defaultValue;
  }
}

export class VariableDeclaration {
  readonly range: Range;
  readonly isExported: boolean;
  readonly isStatic: boolean;
  readonly isMutable: boolean;
  readonly name: Name;
  readonly type: TypeExpression | undefined;
  readonly value: Expression | undefined;

  constructor(
    range: Range,
    isExported: boolean,
    isStatic: boolean,
    isMutable: boolean,
    name: Name,
    type: TypeExpression | undefined,
    value: Expression | undefined) {
    this.range = range;
    this.isExported = isExported;
    this.isStatic = isStatic;
    this.isMutable = isMutable;
    this.name = name;
    this.type = type;
    this.value = value;
  }
}

export class FunctionDefinition {
  readonly range: Range;
  readonly isExported: boolean;
  readonly isStatic: boolean;
  readonly name: Name;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly parameters: Parameter[];
  readonly returnType: TypeExpression | undefined;
  readonly body: Block;

  constructor(
    range: Range,
    isExported: boolean,
    isStatic: boolean,
    name: Name,
    typeParameters: TypeParameter[] | undefined,
    parameters: Parameter[],
    returnType: TypeExpression | undefined,
    body: Block) {
    this.range = range;
    this.isExported = isExported;
    this.isStatic = isStatic;
    this.name = name;
    this.typeParameters = typeParameters;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }
}

export class InterfaceDefinition {
  readonly range: Range;
  readonly isExported: boolean;
  readonly name: Name;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly superTypes: TypeExpression[];
  readonly body: Block;

  constructor(
    range: Range,
    isExported: boolean,
    name: Name,
    typeParameters: TypeParameter[] | undefined,
    superTypes: TypeExpression[],
    body: Block) {
    this.range = range;
    this.isExported = isExported;
    this.name = name;
    this.typeParameters = typeParameters;
    this.superTypes = superTypes;
    this.body = body;
  }
}

export class ClassDefinition {
  readonly range: Range;
  readonly isExported: boolean;
  readonly name: Name;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly baseClass: TypeExpression | undefined;
  readonly body: Block;

  constructor(
    range: Range,
    isExported: boolean,
    name: Name,
    typeParameters: TypeParameter[] | undefined,
    baseClass: TypeExpression | undefined,
    body: Block) {
    this.range = range;
    this.isExported = isExported;
    this.name = name;
    this.typeParameters = typeParameters;
    this.baseClass = baseClass;
    this.body = body;
  }
}

export class ExportAs {
  readonly range: Range;
  readonly name: Name;

  constructor(range: Range, name: Name) {
    this.range = range;
    this.name = name;
  }
}

export class ImportAs {
  readonly range: Range;
  readonly path: StringLiteral;
  readonly name: Name;

  constructor(range: Range, path: StringLiteral, name: Name) {
    this.range = range;
    this.path = path;
    this.name = name;
  }
}

export class FromImport {
  readonly range: Range;
  readonly path: StringLiteral;
  readonly name: Name;

  constructor(range: Range, path: StringLiteral, name: Name) {
    this.range = range;
    this.path = path;
    this.name = name;
  }
}

export class ModuleDisplay {
  readonly range: Range;
  readonly header: HeaderItem[];
  readonly statements: Statement[];
  readonly errors: ParseError[];

  constructor(range: Range, header: HeaderItem[], statements: Statement[], errors: ParseError[]) {
    this.range = range;
    this.header = header;
    this.statements = statements;
    this.errors = errors;
  }
}
