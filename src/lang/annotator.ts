import * as ast from "./ast";
import { Value, YALClass } from "./value";

export type AnnotationError = ast.ParseError;
export type VariableInfo = {
  readonly location?: ast.Location;
  readonly isConst: boolean;
  readonly value: ValueInfo;
};
export type StaticScope = { [key: string]: VariableInfo; };
export type ValueInfo = {
  readonly kind: 'VALUE';
  readonly value: Value;
} | {
  readonly kind: 'TYPE';
  readonly type: YALClass;
} | {
  readonly kind: 'ANY';
};

class Annotator implements ast.ExpressionVisitor<ValueInfo>, ast.StatementVisitor<null> {
  readonly stack: StaticScope[] = [];
  readonly errors: AnnotationError[] = [];
  private scope: StaticScope = Object.create(null);

  visitNilLiteral(n: ast.NilLiteral): ValueInfo {
    return { kind: 'VALUE', value: null };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ValueInfo {
    return { kind: 'VALUE', value: n.value };
  }
  visitNumberLiteral(n: ast.NumberLiteral): ValueInfo {
    return { kind: 'VALUE', value: n.value };
  }
  visitStringLiteral(n: ast.StringLiteral): ValueInfo {
    return { kind: 'VALUE', value: n.value };
  }
  visitIdentifier(n: ast.Identifier): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitListDisplay(n: ast.ListDisplay): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitMethodCall(n: ast.MethodCall): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitLogicalAnd(n: ast.LogicalAnd): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitLogicalOr(n: ast.LogicalOr): ValueInfo {
    throw new Error("Method not implemented.");
  }
  visitConditional(n: ast.Conditional): ValueInfo {
    throw new Error("Method not implemented.");
  }

  visitEmptyStatement(n: ast.EmptyStatement): null { return null; }
  visitExpressionStatement(n: ast.ExpressionStatement): null {
    n.expression.accept(this);
    return null;
  }
  visitBlock(n: ast.Block): null {
    throw new Error("Method not implemented.");
  }
  visitDeclaration(n: ast.Declaration): null {
    throw new Error("Method not implemented.");
  }
  visitIf(n: ast.If): null {
    throw new Error("Method not implemented.");
  }
  visitWhile(n: ast.While): null {
    throw new Error("Method not implemented.");
  }
  visitClassDefinition(n: ast.ClassDefinition): null {
    throw new Error("Method not implemented.");
  }
}
