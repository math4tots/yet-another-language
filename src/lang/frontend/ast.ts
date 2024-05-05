import { Uri } from "vscode";
import { Range } from "./lexer";

export type Location = {
  readonly uri: Uri;
  readonly range: Range;
};

export interface Identifier {
  readonly location?: Location | null;
  readonly name: string;
};

/// Like Identifier, but location is required
export interface ExplicitIdentifier {
  readonly location: Location;
  readonly name: string;
};

export interface ExpressionVisitor<R> {
  visitNullLiteral(n: NullLiteral): R;
  visitBooleanLiteral(n: BooleanLiteral): R;
  visitNumberLiteral(n: NumberLiteral): R;
  visitStringLiteral(n: StringLiteral): R;
  visitIdentifierNode(n: IdentifierNode): R;
  visitAssignment(n: Assignment): R;
  visitListDisplay(n: ListDisplay): R;
  visitRecordDisplay(n: RecordDisplay): R;
  visitFunctionDisplay(n: FunctionDisplay): R;
  visitMethodCall(n: MethodCall): R;
  visitLogicalNot(n: LogicalNot): R;
  visitLogicalAnd(n: LogicalAnd): R;
  visitLogicalOr(n: LogicalOr): R;
  visitConditional(n: Conditional): R;
  visitTypeAssertion(n: TypeAssertion): R;
  visitNativeExpression(n: NativeExpression): R;
  visitNativePureFunction(n: NativePureFunction): R;
}

export interface StatementVisitor<R> {
  visitEmptyStatement(n: EmptyStatement): R;
  visitCommentStatement(n: CommentStatement): R;
  visitExpressionStatement(n: ExpressionStatement): R;
  visitBlock(n: Block): R;
  visitStatic(n: Static): R;
  visitDeclaration(n: Declaration): R;
  visitIf(n: If): R;
  visitWhile(n: While): R;
  visitReturn(n: Return): R;
  visitClassDefinition(n: ClassDefinition): R;
  visitInterfaceDefinition(n: InterfaceDefinition): R;
  visitEnumDefinition(n: EnumDefinition): R;
  visitImportAs(n: ImportAs): R;
  visitFromImport(n: FromImport): R;
  visitExportAs(n: ExportAs): R;
  visitTypedef(n: Typedef): R;
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

export type Literal = NullLiteral | BooleanLiteral | NumberLiteral | StringLiteral;

export type Node = File | Expression | Statement;

export type ParseError = {
  readonly location: Location;
  readonly message: string;
};

export class TypeExpression {
  readonly location: Location;
  readonly qualifier: IdentifierNode | null;
  readonly identifier: IdentifierNode;
  readonly args: TypeExpression[];
  constructor(
    location: Location,
    qualifier: IdentifierNode | null,
    identifier: IdentifierNode,
    args: TypeExpression[]) {
    this.location = location;
    this.qualifier = qualifier;
    this.identifier = identifier;
    this.args = args;
  }
  toString() {
    return this.identifier.name + (this.args.length ? `[${this.args.join(',')}]` : '');
  }
}

export class NullLiteral implements Expression {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  withLocation(location: Location) { return new NullLiteral(location); }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNullLiteral(this); }
}

export class BooleanLiteral implements Expression {
  readonly location: Location;
  readonly value: boolean;
  constructor(location: Location, value: boolean) {
    this.location = location;
    this.value = value;
  }
  withLocation(location: Location) { return new BooleanLiteral(location, this.value); }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitBooleanLiteral(this); }
}

export class NumberLiteral implements Expression {
  readonly location: Location;
  readonly value: number;
  constructor(location: Location, value: number) {
    this.location = location;
    this.value = value;
  }
  withLocation(location: Location) { return new NumberLiteral(location, this.value); }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNumberLiteral(this); }
}

export class StringLiteral implements Expression {
  readonly location: Location;
  readonly value: string;
  constructor(location: Location, value: string) {
    this.location = location;
    this.value = value;
  }
  withLocation(location: Location) { return new StringLiteral(location, this.value); }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitStringLiteral(this); }
}

export class IdentifierNode implements Expression, Identifier {
  readonly location: Location;
  readonly name: string;
  constructor(location: Location, name: string) {
    this.location = location;
    this.name = name;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitIdentifierNode(this); }
}

export class Assignment implements Expression {
  readonly location: Location;
  readonly identifier: IdentifierNode;
  readonly value: Expression;
  constructor(location: Location, identifier: IdentifierNode, value: Expression) {
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

export type RecordDisplayEntry = {
  readonly isMutable: boolean;
  readonly identifier: IdentifierNode;
  readonly value: Expression;
};

export class RecordDisplay implements Expression {
  readonly location: Location;
  readonly entries: RecordDisplayEntry[];
  constructor(location: Location, entries: RecordDisplayEntry[]) {
    this.location = location;
    this.entries = entries;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitRecordDisplay(this); }
}

export class TypeParameter {
  readonly location: Location;
  readonly identifier: IdentifierNode;
  constructor(location: Location, identifier: IdentifierNode) {
    this.location = location;
    this.identifier = identifier;
  }
}

export class Parameter {
  readonly location: Location;
  readonly isMutable: boolean;
  readonly identifier: IdentifierNode;
  readonly type: TypeExpression | null;
  readonly comment: StringLiteral | null;
  readonly value: Literal | null;
  constructor(
    location: Location,
    isMutable: boolean,
    identifier: IdentifierNode,
    type: TypeExpression | null,
    comment: StringLiteral | null,
    value: Literal | null) {
    this.location = location;
    this.isMutable = isMutable;
    this.identifier = identifier;
    this.type = type;
    this.comment = comment;
    this.value = value;
  }
}

export class FunctionDisplay implements Expression {
  readonly location: Location;
  readonly typeParameters: TypeParameter[] | undefined;
  readonly parameters: Parameter[];
  readonly returnType: TypeExpression | null;
  readonly body: Block;
  constructor(
    location: Location,
    typeParameters: TypeParameter[] | undefined,
    parameters: Parameter[],
    returnType: TypeExpression | null,
    body: Block) {
    this.location = location;
    this.typeParameters = typeParameters;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitFunctionDisplay(this); }
}

export class MethodCall implements Expression {
  readonly location: Location;
  readonly owner: Expression;
  readonly identifier: IdentifierNode;
  readonly args: Expression[];
  constructor(
    location: Location,
    owner: Expression,
    identifier: IdentifierNode,
    args: Expression[]) {
    this.location = location;
    this.owner = owner;
    this.identifier = identifier;
    this.args = args;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitMethodCall(this); }
}

export class LogicalNot implements Expression {
  readonly location: Location;
  readonly value: Expression;
  constructor(location: Location, value: Expression) {
    this.location = location;
    this.value = value;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitLogicalNot(this); }
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

export class TypeAssertion implements Expression {
  readonly location: Location;
  readonly value: Expression;
  readonly type: TypeExpression;
  constructor(location: Location, value: Expression, type: TypeExpression) {
    this.location = location;
    this.value = value;
    this.type = type;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitTypeAssertion(this); }
}

export class NativeExpression implements Expression {
  readonly location: Location;
  readonly kindFragment: IdentifierNode | null;
  readonly isConstexpr: boolean;
  readonly source: StringLiteral;
  constructor(location: Location, kindFragment: IdentifierNode | null, isConstexpr: boolean, source: StringLiteral) {
    this.location = location;
    this.kindFragment = kindFragment;
    this.isConstexpr = isConstexpr;
    this.source = source;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNativeExpression(this); }
}

// NativePureFunctions are functions that are pure (i.e. has no side-effects), and
// implemented in native code (i.e. Javascript).
// In terms of compiled code, these could be implemented entirely with NativeExpressions,
// but allow the annotator to evaluate their bodies
//
// NOTE: There are differences in the way that the annotator and the code generator
// formats values. See 'annotator.ts' and 'codgenjs.ts' for the differences.
// Specifically, the annotators will use native Javascript values for a lot of
// its values, while the code generator wraps the values.
// This means that the sort of functions that can be used with NativePureFunction is
// quite limited. When it gets too tricky, you should use NativeExpression instead.
//
export class NativePureFunction implements Expression {
  readonly location: Location;
  readonly identifier: IdentifierNode | undefined;
  readonly parameters: Parameter[];
  readonly returnType: TypeExpression | null;
  readonly body: Block;
  constructor(location: Location,
    identifier: IdentifierNode | undefined,
    parameters: Parameter[],
    returnType: TypeExpression | null,
    body: Block) {
    this.location = location;
    this.identifier = identifier;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }
  accept<R>(visitor: ExpressionVisitor<R>): R { return visitor.visitNativePureFunction(this); }
  getJavascriptReturnExpression(): string | undefined {
    for (const statement of this.body.statements) {
      if (statement instanceof ExpressionStatement) {
        const e = statement.expression;
        if (e instanceof MethodCall && e.identifier.name === '__call__' && e.args.length === 1) {
          const owner = e.owner;
          const arg = e.args[0];
          if (owner instanceof IdentifierNode && owner.name === 'returns' && arg instanceof StringLiteral) {
            return arg.value;
          }
        }
      }
    }
  }
}

export class EmptyStatement implements Statement {
  readonly location: Location;
  constructor(location: Location) {
    this.location = location;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitEmptyStatement(this); }
}

export class CommentStatement implements Statement {
  readonly location: Location;
  readonly comment: string;
  constructor(location: Location, comment: string) {
    this.location = location;
    this.comment = comment;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitCommentStatement(this); }
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

export class Static implements Statement {
  readonly location: Location;
  readonly statements: Statement[];
  constructor(location: Location, statements: Statement[]) {
    this.location = location;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitStatic(this); }
}

export class Declaration implements Statement {
  readonly location: Location;
  readonly isExported: boolean;
  readonly isMutable: boolean;
  readonly identifier: IdentifierNode;
  readonly type: TypeExpression | null;
  readonly comment: StringLiteral | null;
  readonly value: Expression | null;
  constructor(
    location: Location,
    isExported: boolean,
    isMutable: boolean,
    identifier: IdentifierNode,
    type: TypeExpression | null,
    comment: StringLiteral | null,
    value: Expression | null) {
    this.location = location;
    this.isExported = isExported;
    this.isMutable = isMutable;
    this.identifier = identifier;
    this.type = type;
    this.comment = comment;
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
  readonly isExported: boolean;
  readonly isAbstract: boolean;
  readonly identifier: IdentifierNode;
  readonly extendsFragment: IdentifierNode | null;
  readonly superClass: TypeExpression | null;
  readonly statements: Statement[];
  constructor(
    location: Location,
    isExported: boolean,
    isAbstract: boolean,
    identifier: IdentifierNode,
    extendsFragment: IdentifierNode | null,
    superClass: TypeExpression | null,
    statements: Statement[]) {
    this.location = location;
    this.isExported = isExported;
    this.isAbstract = isAbstract;
    this.identifier = identifier;
    this.extendsFragment = extendsFragment;
    this.superClass = superClass;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitClassDefinition(this); }
}

export class InterfaceDefinition implements Statement {
  readonly location: Location;
  readonly isExported: boolean;
  readonly identifier: IdentifierNode;
  readonly extendsFragment: IdentifierNode | null;
  readonly superTypes: TypeExpression[];
  readonly statements: Statement[];
  constructor(
    location: Location,
    isExported: boolean,
    identifier: IdentifierNode,
    extendsFragment: IdentifierNode | null,
    superTypes: TypeExpression[],
    statements: Statement[]) {
    this.location = location;
    this.isExported = isExported;
    this.identifier = identifier;
    this.extendsFragment = extendsFragment;
    this.superTypes = superTypes;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitInterfaceDefinition(this); }
}

export class EnumDefinition implements Statement {
  readonly location: Location;
  readonly isExported: boolean;
  readonly identifier: IdentifierNode;
  readonly statements: Statement[];
  constructor(
    location: Location,
    isExported: boolean,
    identifier: IdentifierNode,
    statements: Statement[]) {
    this.location = location;
    this.isExported = isExported;
    this.identifier = identifier;
    this.statements = statements;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitEnumDefinition(this); }
}

export class ImportAs implements Statement {
  readonly location: Location;
  readonly path: StringLiteral;
  readonly identifier: IdentifierNode;
  constructor(location: Location, path: StringLiteral, identifier: IdentifierNode) {
    this.location = location;
    this.path = path;
    this.identifier = identifier;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitImportAs(this); }
}

export class FromImport implements Statement {
  readonly location: Location;
  readonly path: StringLiteral;
  readonly isExported: boolean;
  readonly identifier: IdentifierNode;
  constructor(location: Location, path: StringLiteral, isExported: boolean, identifier: IdentifierNode) {
    this.location = location;
    this.path = path;
    this.isExported = isExported;
    this.identifier = identifier;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitFromImport(this); }
}

export class ExportAs implements Statement {
  readonly location: Location;
  readonly identifier: IdentifierNode;
  constructor(location: Location, identifier: IdentifierNode) {
    this.location = location;
    this.identifier = identifier;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitExportAs(this); }
}

export class Typedef implements Statement {
  readonly location: Location;
  readonly isExported: boolean;
  readonly identifier: IdentifierNode;
  readonly type: TypeExpression;
  constructor(location: Location, isExported: boolean, identifier: IdentifierNode, type: TypeExpression) {
    this.location = location;
    this.isExported = isExported;
    this.identifier = identifier;
    this.type = type;
  }
  accept<R>(visitor: StatementVisitor<R>): R { return visitor.visitTypedef(this); }
}

export class File {
  readonly location: Location;
  readonly documentVersion: number;
  readonly statements: Statement[];
  readonly errors: ParseError[];
  constructor(location: Location, documentVersion: number, statements: Statement[], errors: ParseError[]) {
    this.location = location;
    this.documentVersion = documentVersion;
    this.statements = statements;
    this.errors = errors;
  }
  accept<R>(visitor: NodeVisitor<R>): R { return visitor.visitFile(this); }
}
