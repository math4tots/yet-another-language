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
  visitMapDisplay(e: MapDisplay): R;
}

export interface StatementVisitor<R> { }

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

export class MapDisplay extends Expression {
  readonly pairs: [Expression, Expression][];
  constructor(location: Location, pairs: [Expression, Expression][]) {
    super(location);
    this.pairs = pairs;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitMapDisplay(this); }
}
