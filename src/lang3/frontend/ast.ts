import { Range } from "./lexer";

export class Location {
  readonly uri: string;
  readonly range: Range;

  constructor(uri: string, range: Range) {
    this.uri = uri;
    this.range = range;
  }
}

export interface ExpressionVisitor<R> {
  visitLiteral(e: Literal): R;
  visitIdentifier(e: Identifier): R;
  visitOperation(e: Operation): R;
  visitMethodCall(e: MethodCall): R;
  visitListDisplay(e: ListDisplay): R;
  visitTableDisplay(e: TableDisplay): R;
}

export interface StatementVisitor<R> {
  visitExpressionStatement(s: ExpressionStatement): R;
  visitIf(s: If): R;
  visitWhile(s: While): R;
  visitBreak(s: Break): R;
  visitContinue(s: Continue): R;
  visitVariableDeclaration(s: VariableDeclaration): R;
  visitAssignment(s: Assignment): R;
  visitFunctionDefinition(s: FunctionDefinition): R;
  visitReturn(s: Return): R;
  visitTypedef(s: Typedef): R;
}

export abstract class Node {
  readonly location: Location;
  constructor(location: Location) { this.location = location; }
}

export abstract class Expression extends Node {
  abstract accept<R>(visitor: ExpressionVisitor<R>): R;
}

export abstract class Statement extends Node {
  abstract accept<R>(visitor: StatementVisitor<R>): R;
}

export type LiteralValue = null | boolean | number | string;

export class Literal extends Expression {
  readonly value: LiteralValue;
  constructor(location: Location, value: LiteralValue) {
    super(location);
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitLiteral(this); }
}

export class Identifier extends Expression {
  readonly name: string;
  constructor(location: Location, name: string) {
    super(location);
    this.name = name;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitIdentifier(this); }
}

export type LogicalUnaryOperator = 'not';
export type LogicalBinaryOperator = 'and' | 'or';
export type LogicalTernaryOperator = 'if';

export type OperationData = {
  readonly operator: LogicalUnaryOperator;
  readonly args: [Expression];
} | {
  readonly operator: LogicalBinaryOperator;
  readonly args: [Expression, Expression];
} | {
  readonly operator: LogicalTernaryOperator;
  readonly args: [Expression, Expression, Expression];
};

export class Operation extends Expression {
  readonly data: OperationData;
  constructor(location: Location, data: OperationData) {
    super(location);
    this.data = data;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitOperation(this); }
}

export class MethodCall extends Expression {
  readonly owner: Expression;
  readonly identifier: Identifier;
  readonly args: Expression[];
  constructor(location: Location, owner: Expression, identifier: Identifier, args: Expression[]) {
    super(location);
    this.owner = owner;
    this.identifier = identifier;
    this.args = args;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitMethodCall(this); }
}

export class ListDisplay extends Expression {
  readonly values: Expression[];
  constructor(location: Location, values: Expression[]) {
    super(location);
    this.values = values;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitListDisplay(this); }
}

export class TableDisplay extends Expression {
  readonly pairs: [Expression, Expression][];
  constructor(location: Location, pairs: [Expression, Expression][]) {
    super(location);
    this.pairs = pairs;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitTableDisplay(this); }
}

export class Block extends Node {
  readonly statements: Statement[];
  constructor(location: Location, statements: Statement[]) {
    super(location);
    this.statements = statements;
  }
}

export class ExpressionStatement extends Statement {
  readonly expression: Expression;
  constructor(location: Location, expression: Expression) {
    super(location);
    this.expression = expression;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitExpressionStatement(this); }
}

export class If extends Statement {
  readonly test: Expression;
  readonly body: Block;
  readonly orelse: Block | If | undefined;
  constructor(location: Location, test: Expression, body: Block, orelse: Block | If | undefined) {
    super(location);
    this.test = test;
    this.body = body;
    this.orelse = orelse;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitIf(this); }
}

export class While extends Statement {
  readonly test: Expression;
  readonly body: Block;
  constructor(location: Location, test: Expression, body: Block) {
    super(location);
    this.test = test;
    this.body = body;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitWhile(this); }
}

export class Break extends Statement {
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitBreak(this); }
}

export class Continue extends Statement {
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitContinue(this); }
}

export class VariableDeclaration extends Statement {
  readonly isMutable: boolean;
  readonly identifier: Identifier;
  readonly type: Expression | undefined;
  readonly value: Expression;
  constructor(
    location: Location,
    isMutable: boolean,
    identifier: Identifier,
    type: Expression | undefined,
    value: Expression) {
    super(location);
    this.isMutable = isMutable;
    this.identifier = identifier;
    this.type = type;
    this.value = value;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitVariableDeclaration(this); }
}

export class Assignment extends Statement {
  readonly identifier: Identifier;
  readonly value: Expression;
  constructor(location: Location, identifier: Identifier, value: Expression) {
    super(location);
    this.identifier = identifier;
    this.value = value;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitAssignment(this); }
}

export class Parameter extends Node {
  readonly identifier: Identifier;
  readonly type: Expression;
  constructor(location: Location, identifier: Identifier, type: Expression) {
    super(location);
    this.identifier = identifier;
    this.type = type;
  }
}

export class FunctionDefinition extends Statement {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Expression;
  readonly body: Block;
  constructor(
    location: Location,
    identifier: Identifier,
    parameters: Parameter[],
    returnType: Expression,
    body: Block) {
    super(location);
    this.identifier = identifier;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitFunctionDefinition(this); }
}

export class Return extends Statement {
  readonly expression: Expression;
  constructor(location: Location, expression: Expression) {
    super(location);
    this.expression = expression;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitReturn(this); }
}

export class Typedef extends Statement {
  readonly identifier: Identifier;
  readonly type: Expression;
  constructor(location: Location, identifier: Identifier, type: Expression) {
    super(location);
    this.identifier = identifier;
    this.type = type;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitTypedef(this); }
}
