import * as ast from "./ast";
import {
  AnyType, BoolType, FunctionType, ListType, NilType, NumberType, StringType, Type,
  Value,
} from "./type";

export type AnnotationError = ast.ParseError;
export type ValueInfo = { type: Type, value?: Value; };

export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

type Variable = {
  readonly isConst: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly value?: Value;
};
type Scope = { [key: string]: Variable; };

const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { isConst: true, identifier: AnyType.identifier, type: AnyType, value: AnyType };
BASE_SCOPE['Nil'] =
  { isConst: true, identifier: NilType.identifier, type: AnyType, value: NilType };
BASE_SCOPE['Bool'] =
  { isConst: true, identifier: BoolType.identifier, type: AnyType, value: BoolType };
BASE_SCOPE['Number'] =
  { isConst: true, identifier: NumberType.identifier, type: AnyType, value: NumberType };
BASE_SCOPE['String'] =
  { isConst: true, identifier: StringType.identifier, type: AnyType, value: StringType };

class Annotator implements ast.ExpressionVisitor<ValueInfo>, ast.StatementVisitor<RunStatus> {
  readonly errors: AnnotationError[] = [];
  private scope: Scope = Object.create(BASE_SCOPE);
  private hint: Type = AnyType;
  private currentReturnType: Type | null = null;

  private blockScoped<R>(f: () => R): R {
    const outerScope = this.scope;
    try {
      this.scope = Object.create(outerScope);
      return f();
    } finally {
      this.scope = outerScope;
    }
  }

  private functionScoped<R>(rt: Type, f: () => R): R {
    const outerReturnType = this.currentReturnType;
    try {
      this.currentReturnType = rt;
      return this.blockScoped(f);
    } finally {
      this.currentReturnType = outerReturnType;
    }
  }

  private solveType(e: ast.TypeExpression): Type {
    const variable = this.scope[e.identifier.name];
    if (!variable) {
      this.errors.push({
        location: e.location,
        message: `Typename ${e.identifier.name} not found`,
      });
      return AnyType;
    }
    const value = variable.value;
    if (value instanceof Type) {
      return value;
    }
    if (value !== undefined) {
      this.errors.push({
        location: e.location,
        message: `${e.identifier.name} is not a type`,
      });
      return AnyType;
    }
    if (e.args.length === 1 && e.identifier.name === 'List') {
      return ListType.of(this.solveType(e.args[0]));
    }
    this.errors.push({
      location: e.location,
      message: `Unrecognized type`,
    });
    return AnyType;
  }

  private solve(e: ast.Expression, hint: Type = AnyType, required: boolean = false): ValueInfo {
    const oldHint = this.hint;
    try {
      this.hint = hint;
      const info = e.accept(this);
      if (required) {
        if (!info.type.isAssignableTo(hint)) {
          this.errors.push({
            location: e.location,
            message: `Expected ${hint.identifier.name} but got ${info.type.identifier}`,
          });
        }
      }
      return info;
    } finally {
      this.hint = oldHint;
    }
  }

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
    const { type: valueType } = this.solve(n.value);
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
    const elements = n.values.map(v => this.solve(v));

    const elementType =
      elements.length === 0 ?
        AnyType :
        elements.map(e => e.type).reduce((lhs, rhs) => lhs.getCommonType(rhs));
    const listType = ListType.of(elementType);

    const values: Value[] =
      elements.map(e => e.value)
        .filter(v => v !== undefined)
        .map(v => v === undefined ? 0 : v);

    return values.length === elements.length ?
      { type: listType, value: values } :
      { type: listType };
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ValueInfo {
    const parameterTypes = n.parameters.map(p => p.type ? this.solveType(p.type) : AnyType);
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    const funcType = FunctionType.of(parameterTypes, returnType);
    this.functionScoped(returnType, () => {
      const status = n.body.accept(this);
      if (status !== Jumps && !NilType.isAssignableTo(returnType)) {
        this.errors.push({
          location: n.returnType?.location || n.body.location,
          message: `Function with non-nil return type must have explicit return`,
        });
      }
    });
    return { type: funcType };
  }
  visitMethodCall(n: ast.MethodCall): ValueInfo {
    const owner = this.solve(n.owner);
    const method = owner.type.getMethod(n.identifier.name);
    if (!method) {
      this.errors.push({
        location: n.location,
        message: `Method ${n.identifier.name} not found on type ${owner.type.identifier.name}`,
      });
      return { type: AnyType };
    }
    const expectedArgc = method.signature.parameterTypes.length;
    const argc = n.args.length;
    if (expectedArgc !== argc) {
      this.errors.push({
        location: n.location,
        message: `Method ${n.identifier.name} requires ${expectedArgc} args but got ${argc}`,
      });
    }
    for (let i = 0; i < n.args.length; i++) {
      this.solve(n.args[i], method.signature.parameterTypes[i], true);
    }
    return { type: method.signature.returnType };
  }
  visitLogicalAnd(n: ast.LogicalAnd): ValueInfo {
    this.solve(n.lhs, BoolType, true);
    this.solve(n.rhs, BoolType, true);
    return { type: BoolType };
  }
  visitLogicalOr(n: ast.LogicalOr): ValueInfo {
    this.solve(n.lhs, BoolType, true);
    this.solve(n.rhs, BoolType, true);
    return { type: BoolType };
  }
  visitConditional(n: ast.Conditional): ValueInfo {
    this.solve(n.condition, BoolType, true);
    const lhs = this.solve(n.lhs);
    const rhs = this.solve(n.rhs);
    return { type: lhs.type.getCommonType(rhs.type) };
  }

  visitEmptyStatement(n: ast.EmptyStatement): RunStatus { return Continues; }
  visitExpressionStatement(n: ast.ExpressionStatement): RunStatus {
    this.solve(n.expression);
    return Continues;
  }
  visitBlock(n: ast.Block): RunStatus {
    let status: RunStatus = Continues;
    this.blockScoped(() => {
      for (const statement of n.statements) {
        const statementStatus = statement.accept(this);
        // TODO: consider detecting unreachable statements
        if (statementStatus === Jumps || status === Jumps) {
          status = Jumps;
        } else if (statementStatus === MaybeJumps || status == MaybeJumps) {
          status = MaybeJumps;
        } else {
          status = Continues;
        }
      }
    });
    return status;
  }
  visitDeclaration(n: ast.Declaration): RunStatus {
    const explicitType = n.type ? this.solveType(n.type) : null;
    const value = n.value ?
      explicitType ?
        this.solve(n.value, explicitType, true) :
        this.solve(n.value) :
      { type: explicitType || AnyType };
    if (!n.value && !NilType.isAssignableTo(value.type)) {
      this.errors.push({
        location: n.identifier.location,
        message: `A declaration that cannot be nil must have an explicit initial value`,
      });
    }
    const variable = this.scope[n.identifier.name] = {
      isConst: n.isConst,
      identifier: n.identifier,
      type: explicitType || value.type,
      value: value.value,
    };
    if (variable.value === undefined) {
      delete variable.value;
    }
    return Continues;
  }
  visitIf(n: ast.If): RunStatus {
    this.solve(n.condition, BoolType, true);
    const stat1 = n.lhs.accept(this);
    const stat2 = n.rhs ? n.rhs.accept(this) : Continues;
    if (stat1 === Jumps && stat2 === Jumps) return Jumps;
    if (stat1 === Jumps || stat1 === MaybeJumps ||
      stat2 === Jumps || stat2 === MaybeJumps) return MaybeJumps;
    return Continues;
  }
  visitWhile(n: ast.While): RunStatus {
    this.solve(n.condition, BoolType, true);
    n.body.accept(this);
    return MaybeJumps;
  }
  visitReturn(n: ast.Return): RunStatus {
    const returnType = this.currentReturnType;
    if (returnType) {
      this.solve(n.value, returnType, true);
    } else {
      this.errors.push({
        location: n.location,
        message: `Return statements cannot appear outside of functions`,
      });
    }
    return Jumps;
  }
  visitClassDefinition(n: ast.ClassDefinition): RunStatus {
    const cls = new Type(n.identifier);
    this.scope[cls.identifier.name] = {
      isConst: true,
      identifier: n.identifier,
      type: AnyType,
      value: cls,
    };
    return Continues;
  }
}
