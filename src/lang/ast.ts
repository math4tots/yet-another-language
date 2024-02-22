import { Uri } from "vscode";
import { Range } from "./lexer";

export type Location = {
  uri: Uri;
  range: Range;
};

export interface Visitor<R> {
  visitFile(n: File): R;
  visitNone(n: None): R;
  visitBlock(n: Block): R;
  visitNilLiteral(n: NilLiteral): R;
  visitBooleanLiteral(n: BooleanLiteral): R;
  visitNumberLiteral(n: NumberLiteral): R;
  visitStringLiteral(n: StringLiteral): R;
  visitIdentifier(n: Identifier): R;
  visitDeclaration(n: Declaration): R;
  visitAssignment(n: Assignment): R;
  visitListDisplay(n: ListDisplay): R;
  visitFunctionDisplay(n: FunctionDisplay): R;
  visitMethodCall(n: MethodCall): R;
  visitLogicalAnd(n: LogicalAnd): R;
  visitLogicalOr(n: LogicalOr): R;
  visitIf(n: If): R;
  visitWhile(n: While): R;
  visitClassDefinition(n: ClassDefinition): R;
}

export interface Node {
  readonly location: Location;
  accept<R>(visitor: Visitor<R>): R;
}

export type ParseError = {
  readonly location: Location;
  readonly message: string;
};

export class File implements Node {
  readonly location: Location;
  readonly statements: Node[];
  readonly errors: ParseError[];
  constructor(location: Location, statements: Node[], errors: ParseError[]) {
    this.location = location;
    this.statements = statements;
    this.errors = errors;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitFile(this); }
}

export class None implements Node {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitNone(this); }
}

export class Block implements Node {
  readonly location: Location;
  readonly statements: Node[];
  constructor(location: Location, statements: Node[]) {
    this.location = location;
    this.statements = statements;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitBlock(this); }
}

export class NilLiteral implements Node {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitNilLiteral(this); }
}

export class BooleanLiteral implements Node {
  readonly location: Location;
  readonly value: boolean;
  constructor(location: Location, value: boolean) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitBooleanLiteral(this); }
}

export class NumberLiteral implements Node {
  readonly location: Location;
  readonly value: number;
  constructor(location: Location, value: number) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitNumberLiteral(this); }
}

export class StringLiteral implements Node {
  readonly location: Location;
  readonly value: string;
  constructor(location: Location, value: string) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitStringLiteral(this); }
}

export class Identifier implements Node {
  readonly location: Location;
  readonly name: string;
  constructor(location: Location, name: string) {
    this.location = location;
    this.name = name;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitIdentifier(this); }
}

export class Declaration implements Node {
  readonly location: Location;
  readonly mutable: boolean;
  readonly identifier: Identifier;
  readonly type: Node | null;
  readonly value: Node | null;
  constructor(
    location: Location,
    mutable: boolean,
    identifier: Identifier,
    type: Node | null,
    value: Node | null) {
    this.location = location;
    this.mutable = mutable;
    this.identifier = identifier;
    this.type = type;
    this.value = value;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitDeclaration(this); }
}

export class Assignment implements Node {
  readonly location: Location;
  readonly identifier: Identifier;
  readonly value: Node;
  constructor(location: Location, identifier: Identifier, value: Node) {
    this.location = location;
    this.identifier = identifier;
    this.value = value;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitAssignment(this); }
}

export class ListDisplay implements Node {
  readonly location: Location;
  readonly values: Node[];
  constructor(location: Location, values: Node[]) {
    this.location = location;
    this.values = values;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitListDisplay(this); }
}

export class FunctionDisplay implements Node {
  readonly location: Location;
  readonly parameters: Declaration[];
  readonly body: Node;
  constructor(location: Location, parameters: Declaration[], body: Node) {
    this.location = location;
    this.parameters = parameters;
    this.body = body;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitFunctionDisplay(this); }
}

export class MethodCall implements Node {
  readonly location: Location;
  readonly owner: Node;
  readonly identifier: Identifier;
  readonly args: Node[];
  constructor(location: Location, owner: Node, identifier: Identifier, args: Node[]) {
    this.location = location;
    this.owner = owner;
    this.identifier = identifier;
    this.args = args;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitMethodCall(this); }
}

export class LogicalAnd implements Node {
  readonly location: Location;
  readonly lhs: Node;
  readonly rhs: Node;
  constructor(location: Location, lhs: Node, rhs: Node) {
    this.location = location;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitLogicalAnd(this); }
}

export class LogicalOr implements Node {
  readonly location: Location;
  readonly lhs: Node;
  readonly rhs: Node;
  constructor(location: Location, lhs: Node, rhs: Node) {
    this.location = location;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitLogicalOr(this); }
}

export class If implements Node {
  readonly location: Location;
  readonly condition: Node;
  readonly lhs: Node;
  readonly rhs: Node;
  constructor(location: Location, condition: Node, lhs: Node, rhs: Node) {
    this.location = location;
    this.condition = condition;
    this.lhs = lhs;
    this.rhs = rhs;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitIf(this); }
}

export class While implements Node {
  readonly location: Location;
  readonly condition: Node;
  readonly body: Node;
  constructor(location: Location, condition: Node, body: Node) {
    this.location = location;
    this.condition = condition;
    this.body = body;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitWhile(this); }
}

export type MemberStatement = StringLiteral | Declaration;

export class ClassDefinition implements Node {
  readonly location: Location;
  readonly identifier: Identifier;
  readonly statements: MemberStatement[];
  constructor(location: Location, identifier: Identifier, statements: MemberStatement[]) {
    this.location = location;
    this.identifier = identifier;
    this.statements = statements;
  }
  accept<R>(visitor: Visitor<R>): R { return visitor.visitClassDefinition(this); }
}
