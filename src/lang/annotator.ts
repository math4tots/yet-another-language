import * as ast from "./ast";
import { Value, YALClass } from "./value";

export type AnnotationError = ast.ParseError;
export type VariableInfo = {
  readonly location?: ast.Location;
  readonly isConst: boolean;
  readonly type: StaticType;
  readonly value?: StaticValue;
};
export type StaticScope = { [key: string]: VariableInfo; };
export type StaticValue = null | boolean | number | string | StaticValue[];
export type StaticType = string;
export const AnyType = 'Any';
export const NilType = 'Nil';
export const BooleanType = 'Boolean';
export const NumberType = 'Number';
export const StringType = 'String';
export const ListType = (t: StaticType): StaticType => `List[${t}]`;
export const FunctionType = (argtypes: StaticType[], rtype: StaticType): StaticType =>
  `Function[${argtypes.map(t => t + ', ')}${rtype}]`;
export type ValueInfo = {
  readonly type: StaticType;
  readonly value?: Value;
};

class Annotator implements ast.ExpressionVisitor<ValueInfo>, ast.StatementVisitor<null> {
  readonly stack: StaticScope[] = [];
  readonly errors: AnnotationError[] = [];
  private scope: StaticScope = Object.create(null);

  solveType(e: ast.Expression): StaticType {
    if (e instanceof ast.Identifier) {
      switch (e.name) {
        case 'Any': return AnyType;
        case 'Nil': return NilType;
        case 'Boolean': return BooleanType;
        case 'Number': return NumberType;
        case 'String': return StringType;
      }
    }
    this.errors.push({
      location: e.location,
      message: `Invalid type expression`,
    });
    return AnyType;
  }

  visitNilLiteral(n: ast.NilLiteral): ValueInfo {
    return { type: NilType, value: null };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ValueInfo {
    return { type: BooleanType, value: n.value };
  }
  visitNumberLiteral(n: ast.NumberLiteral): ValueInfo {
    return { type: NumberType, value: n.value };
  }
  visitStringLiteral(n: ast.StringLiteral): ValueInfo {
    return { type: StringType, value: n.value };
  }
  visitIdentifier(n: ast.Identifier): ValueInfo {
    const variable = this.scope[n.name];
    if (!variable) {
      this.errors.push({
        location: n.location,
        message: `Variable ${n.name} not found`,
      });
      return { type: AnyType };
    }
    return (variable.isConst && 'value' in variable) ?
      { type: variable.type, value: variable.value } :
      { type: variable.type };
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    const value = n.value.accept(this);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.errors.push({
        location: n.identifier.location,
        message: `Variable ${n.identifier.name} not found`,
      });
      return { type: AnyType };
    }
    if (variable.isConst) {
      this.errors.push({
        location: n.identifier.location,
        message: `Cannot assign to const variable ${n.identifier.name}`,
      });
      return { type: AnyType };
    }
    return value;
  }
  visitListDisplay(n: ast.ListDisplay): ValueInfo {
    const infos = n.values.map(v => v.accept(this));
    const type = (infos.length > 0 && infos.every(i => i.type === infos[0].type)) ?
      ListType(infos[0].type) : ListType(AnyType);
    const values = infos.map(v => v.value);
    if (values.every(v => v !== undefined)) {
      return { type, value: values as StaticValue[] };
    }
    return { type };
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ValueInfo {
    const paramTypes = n.parameters.map(p => p.type ? this.solveType(p.type) : AnyType);
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
