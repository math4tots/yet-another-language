import * as ast from '../frontend/ast';
import { Completion, Variable } from './annotation';
import { Solver } from './solver';
import { Jumps } from './statementsolver';
import {
  AnyType,
  BoolType,
  LambdaType,
  NeverType,
  NilType,
  NumberType,
  Parameter,
  StringType,
  Type,
  newLambdaType,
} from './type';
import { Value } from './value';


export type ExpressionInfo = {
  readonly type: Type;
  readonly value?: Value;
};


export class ExpressionSolver extends Solver implements ast.ExpressionVisitor<ExpressionInfo> {
  private readonly lambdaTypeCache = new Map<ast.FunctionDisplay, LambdaType>();

  solve(e: ast.Expression, hint: Type = AnyType, required: boolean = true): ExpressionInfo {
    const oldHint = this.hint;
    this.hint = hint;
    const info = e.accept(this);
    if (required && !info.type.isAssignableTo(hint)) {
      this.error(e.location, `Expected expression of type ${hint} but got expression of type ${info.type}`);
    }
    this.hint = oldHint;
    return info;
  }

  visitNullLiteral(n: ast.NullLiteral): ExpressionInfo {
    return { type: NilType, value: null };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ExpressionInfo {
    return { type: BoolType, value: n.value };
  }
  visitNumberLiteral(n: ast.NumberLiteral): ExpressionInfo {
    return { type: NumberType, value: n.value };
  }
  visitStringLiteral(n: ast.StringLiteral): ExpressionInfo {
    return { type: StringType, value: n.value };
  }
  visitIdentifierNode(n: ast.IdentifierNode): ExpressionInfo {
    const scope = this.scope;
    this.annotation.completionPoints.push({
      range: n.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scope) {
          completions.push({ name: key });
        }
        // additionally, provide provide completions for constants and keywords
        completions.push({ name: 'null' });
        completions.push({ name: 'true' });
        completions.push({ name: 'false' });
        completions.push({ name: 'function' });
        completions.push({ name: 'var' });
        completions.push({ name: 'const' });
        completions.push({ name: 'native' });
        completions.push({ name: 'return' });
        completions.push({ name: 'interface' });
        completions.push({ name: 'class' });
        return completions;
      },
    });
    const variable = this.scope[n.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.name)} not found`);
      return { type: AnyType };
    }
    this.markReference(variable, n.location.range);
    return { type: variable.type, value: variable.value };
  }
  visitAssignment(n: ast.Assignment): ExpressionInfo {
    const rhs = this.solveExpression(n.value);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.identifier.name)} not found`);
      return { type: AnyType };
    }
    if (!variable.isMutable) {
      this.error(n.location, `Variable ${n.identifier.name} is not mutable`);
      return { type: variable.type };
    }
    if (!rhs.type.isAssignableTo(variable.type)) {
      this.error(
        n.identifier.location,
        `Value of type ${rhs.type} is not assignable to variable of type ${variable.type}`);
    }
    return { type: variable.type, value: rhs.value };
  }
  visitListDisplay(n: ast.ListDisplay): ExpressionInfo {
    const startErrorCount = this.annotation.errors.length;
    const givenItemType = this.hint.listItemType;
    if (givenItemType) {
      for (const element of n.values) {
        this.solveExpression(element, givenItemType);
      }
      return { type: givenItemType.list() };
    }
    if (n.values.length === 0) return { type: AnyType };
    let itemType: Type = NeverType;
    let values: Value[] | undefined = [];
    for (const element of n.values) {
      const elementInfo = this.solveExpression(element, itemType, false);
      itemType = itemType.getCommonType(elementInfo.type);
      if (elementInfo.value !== undefined) {
        values?.push(elementInfo.value);
      } else {
        values = undefined;
      }
    }
    return {
      type: itemType.list(),
      value: (startErrorCount === this.annotation.errors.length && values) ?
        values : undefined
    };
  }
  private solveFunctionDisplayType(n: ast.FunctionDisplay): LambdaType {
    const cached = this.lambdaTypeCache.get(n);
    if (cached) return cached;
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    const parameters: Parameter[] = n.parameters.map(p => ({
      isMutable: p.isMutable,
      identifier: p.identifier,
      type: (p.type ? this.solveType(p.type) : null) || AnyType,
    }));
    const lambdaType = newLambdaType(parameters, returnType);
    this.lambdaTypeCache.set(n, lambdaType);
    return lambdaType;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ExpressionInfo {
    const startErrorCount = this.annotation.errors.length;
    const lambdaType = this.solveFunctionDisplayType(n);
    this.scoped(() => {
      const parameters = lambdaType.lambdaTypeData.parameters;
      const returnType = lambdaType.lambdaTypeData.functionType.functionTypeData.returnType;
      const outerReturnType = this.currentReturnType;
      try {
        this.currentReturnType = returnType;
        for (const parameter of parameters) {
          const variable: Variable = {
            isMutable: parameter.isMutable,
            identifier: parameter.identifier,
            type: parameter.type,
          };
          this.declareVariable(variable);
        }
        const result = this.solveStatement(n.body);
        if (result.runStatus !== Jumps && !NilType.isAssignableTo(returnType)) {
          this.error(
            n.location, `This function cannot return null and this function might not return`);
        }
      } finally {
        this.currentReturnType = outerReturnType;
      }
    });
    return {
      type: lambdaType,

      // Only bother with even trying to create a pure function if processing the
      // entire function display produced no errors
      value: startErrorCount === this.annotation.errors.length ?
        undefined : // TODO
        undefined
      // newPureFunctionValue(n, this.scope) : undefined
    };
  }

  visitMethodCall(n: ast.MethodCall): ExpressionInfo {
    const startErrorCount = this.annotation.errors.length;
    const owner = this.solveExpression(n.owner);
    this.annotation.completionPoints.push({
      range: n.identifier.location.range,
      getCompletions(): Completion[] {
        const completions: Completion[] = [];
        const seen = new Set<string>();
        for (const method of owner.type.methods) {
          const rawName = method.identifier.name;
          if (rawName.startsWith('__set_')) {
            // skip setters
          } else if (rawName.startsWith('__get_')) {
            // field or property
            const name = rawName.substring('__get_'.length);
            if (seen.has(name)) continue;
            seen.add(name);
            completions.push({
              name,
              detail: '(property)',
            });
          } else {
            // normal methods
            const name = rawName;
            if (seen.has(name)) continue;
            seen.add(name);
            completions.push({
              name,
              detail: '(method)',
            });
          }
        }
        return completions;
      },
    });
    const method = owner.type.getMethod(n.identifier.name);
    if (!method) {
      for (const arg of n.args) this.solveExpression(arg);
      this.error(n.location, `Method ${n.identifier.name} not found on type ${owner.type}`);
      return { type: AnyType };
    }
    this.annotation.callInstances.push({
      range: n.location.range,
      args: n.args.map(arg => arg.location.range),
      parameters: method.parameters,
    });
    this.markReference(method.sourceVariable, n.identifier.location.range);
    if (method.parameters.length !== n.args.length) {
      for (const arg of n.args) this.solveExpression(arg);
      this.error(n.location, `Expected ${method.parameters.length} args but got ${n.args.length}`);
      return { type: method.returnType };
    }
    const argValues: Value[] = [];
    for (let i = 0; i < method.parameters.length; i++) {
      const info = this.solveExpression(n.args[i], method.parameters[i].type);
      if (info.value !== undefined) argValues.push(info.value);
    }

    // If we did not encounter any errors, as a bonus, try computing the static value
    let staticValue: Value | undefined;
    if (this.annotation.errors.length === startErrorCount && argValues.length === method.parameters.length) {
      if (owner.value === printFunction && argValues.length === 1) {
        this.annotation.printInstances.push({
          range: n.location.range,
          value: argValues[0],
        });
      } else {
        staticValue = evalMethodCall(owner.value, n.identifier.name, argValues);
      }
    }
    return { type: method.returnType, value: staticValue };
  }
  visitNew(n: ast.New): ExpressionInfo {
    const type = this.solveType(n.type);
    const fields = type.classTypeData?.fields;
    if (!fields) {
      for (const arg of n.args) this.solveExpression(arg);
      this.error(n.location, `${type} is not new-constructible`);
      return { type: AnyType };
    }
    this.annotation.callInstances.push({
      range: n.location.range,
      args: n.args.map(arg => arg.location.range),
      parameters: fields,
    });
    if (fields.length !== n.args.length) {
      for (const arg of n.args) this.solveExpression(arg);
      this.error(n.location, `${type} requires ${fields.length} args but got ${n.args.length}`);
      return { type };
    }
    for (let i = 0; i < fields.length; i++) {
      this.solveExpression(n.args[i], fields[i].type);
    }
    return { type };
  }
  visitLogicalNot(n: ast.LogicalNot): ExpressionInfo {
    const { value } = this.solveExpression(n.value);
    return { type: BoolType, value: value === undefined ? undefined : !value };
  }
  visitLogicalAnd(n: ast.LogicalAnd): ExpressionInfo {
    const { value: lhs } = this.solveExpression(n.lhs);
    const { value: rhs } = this.solveExpression(n.rhs);
    return { type: BoolType, value: (lhs !== undefined && !lhs) ? lhs : rhs };
  }
  visitLogicalOr(n: ast.LogicalOr): ExpressionInfo {
    const { value: lhs } = this.solveExpression(n.lhs);
    const { value: rhs } = this.solveExpression(n.rhs);
    return { type: BoolType, value: (lhs !== undefined && lhs) ? lhs : rhs };
  }
  visitConditional(n: ast.Conditional): ExpressionInfo {
    const condition = this.solveExpression(n.condition);
    const lhs = this.solveExpression(n.lhs);
    const rhs = this.solveExpression(n.rhs);
    const value = condition.value === undefined ?
      undefined :
      condition.value ? lhs.value : rhs.value;
    return { type: lhs.type.getCommonType(rhs.type), value };
  }
  visitTypeAssertion(n: ast.TypeAssertion): ExpressionInfo {
    this.solveExpression(n.value);
    const type = this.solveType(n.type);
    return { type };
  }
  visitNativeExpression(n: ast.NativeExpression): ExpressionInfo {
    return { type: AnyType };
  }
  visitNativePureFunction(n: ast.NativePureFunction): ExpressionInfo {
    const parameters: Parameter[] = n.parameters.map(p => ({
      identifier: p.identifier,
      type: p.type ? this.solveType(p.type) : AnyType,
    }));
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    const lambdaType = newLambdaType(parameters, returnType);
    const parameterNames = n.parameters.map(p => p.identifier.name);
    const body = n.body.find(pair => pair[0].name === 'js')?.[1].value;
    return {
      type: lambdaType,
      value: body == undefined ? undefined : (Function(...parameterNames, `"use strict";${body}`) as any),
    };
  }
}
