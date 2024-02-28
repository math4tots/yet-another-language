import { Uri } from "vscode";
import { Range } from "./lexer";

export type Location = {
  uri: Uri;
  range: Range;
};

export interface Identifier {
  readonly location: Location | null;
  readonly name: string;
};

export interface ExpressionVisitor<R> {
  visitNilLiteral(n: NilLiteral): R;
  visitBooleanLiteral(n: BooleanLiteral): R;
  visitNumberLiteral(n: NumberLiteral): R;
  visitStringLiteral(n: StringLiteral): R;
  visitVariable(n: Variable): R;
  visitAssignment(n: Assignment): R;
  visitListDisplay(n: ListDisplay): R;
  visitFunctionDisplay(n: FunctionDisplay): R;
  visitMethodCall(n: MethodCall): R;
  visitLogicalAnd(n: LogicalAnd): R;
  visitLogicalOr(n: LogicalOr): R;
  visitConditional(n: Conditional): R;
}

export interface StatementVisitor<R> {
  visitEmptyStatement(n: EmptyStatement): R;
  visitExpressionStatement(n: ExpressionStatement): R;
  visitBlock(n: Block): R;
  visitDeclaration(n: Declaration): R;
  visitIf(n: If): R;
  visitWhile(n: While): R;
  visitReturn(n: Return): R;
  visitClassDefinition(n: ClassDefinition): R;
}

export interface NodeVisitor<R> extends ExpressionVisitor<R>, StatementVisitor<R> {
  visitFile(n: File): R;
}

export interface Expression {
  readonly location: Location;
  accept<R>(visitor: ExpressionVisitor<R>): R;
}

export interface Statement {
  readonly location: Location;
  accept<R>(visitor: StatementVisitor<R>): R;
}

export type Node = File | Expression | Statement;

export type ParseError = {
  readonly location: Location;
  readonly message: string;
};

export class NilLiteral implements Expression {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNilLiteral(this); }
}

export class BooleanLiteral implements Expression {
  readonly location: Location;
  readonly value: boolean;
  constructor(location: Location, value: boolean) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitBooleanLiteral(this); }
}

export class NumberLiteral implements Expression {
  readonly location: Location;
  readonly value: number;
  constructor(location: Location, value: number) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNumberLiteral(this); }
}

export class StringLiteral implements Expression {
  readonly location: Location;
  readonly value: string;
  constructor(location: Location, value: string) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitStringLiteral(this); }
}

export class Variable implements Expression, Identifier {
  readonly location: Location;
  readonly name: string;
  constructor(location: Location, name: string) {
    this.location = location;
    this.name = name;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitVariable(this); }
}

export class Assignment implements Expression {
  readonly location: Location;
  readonly identifier: Variable;
  readonly value: Expression;
  constructor(location: Location, identifier: Variable, value: Expression) {
    this.location = location;
    this.identifier = identifier;
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitAssignment(this); }
}

export class ListDisplay implements Expression {
  readonly location: Location;
  readonly values: Expression[];
  constructor(location: Location, values: Expression[]) {
    this.location = location;
    this.values = values;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitListDisplay(this); }
}

export class FunctionDisplay implements Expression {
  readonly location: Location;
  readonly parameters: Declaration[];
  readonly body: Block | Expression;
  constructor(location: Location, parameters: Declaration[], body: Block | Expression) {
    this.location = location;
    this.parameters = parameters;
    this.body = body;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitFunctionDisplay(this); }
}

export class MethodCall implements Expression {
  readonly location: Location;
  readonly owner: Expression;
  readonly identifier: Variable;
  readonly args: Expression[];
  constructor(location: Location, owner: Expression, identifier: Variable, args: Expression[]) {
    this.location = location;
    this.owner = owner;
    this.identifier = identifier;
    this.args = args;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitMethodCall(this); }
}

export class LogicalAnd implements Expression {
  readonly location: Location;
  readonly lhs: Expression;
  readonly rhs: Expression;
  constructor(location: Location, lhs: Expression, rhs: Expression) {
    this.location = location;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitLogicalAnd(this); }
}

export class LogicalOr implements Expression {
  readonly location: Location;
  readonly lhs: Expression;
  readonly rhs: Expression;
  constructor(location: Location, lhs: Expression, rhs: Expression) {
    this.location = location;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitLogicalOr(this); }
}

export class Conditional implements Expression {
  readonly location: Location;
  readonly condition: Expression;
  readonly lhs: Expression;
  readonly rhs: Expression;
  constructor(location: Location, condition: Expression, lhs: Expression, rhs: Expression) {
    this.location = location;
    this.condition = condition;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitConditional(this); }
}

export class EmptyStatement implements Statement {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitEmptyStatement(this); }
}

export class ExpressionStatement implements Statement {
  readonly location: Location;
  readonly expression: Expression;
  constructor(location: Location, expression: Expression) {
    this.location = location;
    this.expression = expression;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitExpressionStatement(this); }
}

export class Block implements Statement {
  readonly location: Location;
  readonly statements: Statement[];
  constructor(location: Location, statements: Statement[]) {
    this.location = location;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitBlock(this); }
}

export class Declaration implements Statement {
  readonly location: Location;
  readonly isConst: boolean;
  readonly identifier: Variable;
  readonly type: Expression | null;
  readonly value: Expression | null;
  constructor(
    location: Location,
    isConst: boolean,
    identifier: Variable,
    type: Expression | null,
    value: Expression | null) {
    this.location = location;
    this.isConst = isConst;
    this.identifier = identifier;
    this.type = type;
    this.value = value;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitDeclaration(this); }
}

export class If implements Statement {
  readonly location: Location;
  readonly condition: Expression;
  readonly lhs: Block;
  readonly rhs: If | Block | null;
  constructor(location: Location, condition: Expression, lhs: Block, rhs: If | Block | null) {
    this.location = location;
    this.condition = condition;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitIf(this); }
}

export class While implements Statement {
  readonly location: Location;
  readonly condition: Expression;
  readonly body: Block;
  constructor(location: Location, condition: Expression, body: Block) {
    this.location = location;
    this.condition = condition;
    this.body = body;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitWhile(this); }
}

export class Return implements Statement {
  readonly location: Location;
  readonly value: Expression;
  constructor(location: Location, value: Expression) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitReturn(this); }
}

export class ClassDefinition implements Statement {
  readonly location: Location;
  readonly identifier: Variable;
  readonly statements: Statement[];
  constructor(location: Location, identifier: Variable, statements: Statement[]) {
    this.location = location;
    this.identifier = identifier;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitClassDefinition(this); }
}

export class File {
  readonly location: Location;
  readonly statements: Statement[];
  readonly errors: ParseError[];
  constructor(location: Location, statements: Statement[], errors: ParseError[]) {
    this.location = location;
    this.statements = statements;
    this.errors = errors;
  }
  accept<R>(visitor: NodeVisitor<R>): R { return visitor.visitFile(this); }
}
