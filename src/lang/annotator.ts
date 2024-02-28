import * as ast from "./ast";
import { AnyType, BoolType, ListType, NilType, NumberType, StringType, Type } from "./type";
import { Value, YALClass } from "./value";

export type AnnotationError = ast.ParseError;
export type ValueInfo = { type: Type, value?: Value; };

type Variable = {
  readonly identifier: ast.Identifier;
  readonly isConst: boolean;
  readonly type: Type;
  readonly value?: Value;
};
type Scope = { [key: string]: Variable; };

class Annotator implements ast.ExpressionVisitor<ValueInfo> {
  readonly errors: AnnotationError[] = [];
  private scope: Scope = Object.create(null);

  visitNilLiteral(n: ast.NilLiteral): ValueInfo {
    return { type: NilType, value: null };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ValueInfo {
    return { type: BoolType, value: n.value };
  }
  visitNumberLiteral(n: ast.NumberLiteral): ValueInfo {
    return { type: NumberType, value: n.value };
  }
  visitStringLiteral(n: ast.StringLiteral): ValueInfo {
    return { type: StringType, value: n.value };
  }
  visitVariable(n: ast.Variable): ValueInfo {
    const variable = this.scope[n.name];
    if (!variable) {
      this.errors.push({
        location: n.location,
        message: `Variable ${n.name} not found`,
      });
      return { type: AnyType };
    }
    return 'value' in variable ?
      { type: variable.type, value: variable.value } :
      { type: variable.type };
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    const { type: valueType } = n.value.accept(this);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.errors.push({
        location: n.location,
        message: `Variable ${n.identifier.name} not found`,
      });
      return { type: AnyType };
    }
    if (!valueType.isAssignableTo(variable.type)) {
      this.errors.push({
        location: n.location,
        message: `${valueType.identifier.name} is not assignable to ${variable.type}`,
      });
    }
    return 'value' in variable ?
      { type: variable.type, value: variable.value } :
      { type: variable.type };
  }
  visitListDisplay(n: ast.ListDisplay): ValueInfo {
    if (n.values.length === 0) {
      return { type: ListType.of(AnyType), value: [] };
    }
    const elements = n.values.map(v => v.accept(this));
    const values: Value[] = [];
    const types: Type[] = [];
    for (const element of elements) {
      if (element.value !== undefined) {
        values.push(element.value);
      }
      types.push(element.type);
    }
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
}
