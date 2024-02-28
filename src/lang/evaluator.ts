import * as ast from './ast';
import { RuntimeError, errorStack } from './error';
import * as rt from './value';

export type Variable = { location?: ast.Location, isConst: boolean, value: rt.Value; };
export type Scope = { [key: string]: Variable; };

export function newScope(parent: Scope | null = null): Scope {
  return Object.create(parent);
}

export const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['repr'] =
  { isConst: true, value: (_, args) => args.length > 0 ? rt.repr(args[0]) : '' };
BASE_SCOPE['str'] =
  { isConst: true, value: (_, args) => args.length > 0 ? rt.str(args[0]) : '' };
BASE_SCOPE['print'] = { isConst: true, value: (_, args) => (console.log(args[0]), null) };

export class ReturnException {
  readonly value: rt.Value;
  constructor(value: rt.Value) {
    this.value = value;
  }
}

class Evaluator implements
  ast.ExpressionVisitor<rt.Value>,
  ast.StatementVisitor<null> {
  readonly scope: Scope;
  constructor(scope: Scope) {
    this.scope = scope;
  }
  visitFile(n: ast.File): null {
    if (n.errors.length > 0) {
      throw new RuntimeError(n.errors.map(
        e => `ParseError: ${e.message}\n  ` +
          `${e.location.uri}:${e.location.range.start.line}:${e.location.range.start.column}`
      ).join('\n'));
    }
    for (const statement of n.statements) {
      statement.accept(this);
    }
    return null;
  }
  visitEmptyStatement(n: ast.EmptyStatement): null { return null; }
  visitExpressionStatement(n: ast.ExpressionStatement): null {
    n.expression.accept(this);
    return null;
  }
  visitBlock(n: ast.Block): null {
    for (const statement of n.statements) {
      statement.accept(this);
    }
    return null;
  }
  visitDeclaration(n: ast.Declaration): null {
    const value = n.value?.accept(this) || null;
    this.scope[n.identifier.name] = { isConst: n.isConst, location: n.location, value };
    return null;
  }
  visitIf(n: ast.If): null {
    if (rt.isTruthy(n.condition.accept(this))) {
      n.lhs.accept(this);
    } else {
      n.rhs?.accept(this);
    }
    return null;
  }
  visitWhile(n: ast.While): null {
    while (rt.isTruthy(n.condition.accept(this))) {
      n.body.accept(this);
    }
    return null;
  }
  visitReturn(n: ast.Return): null {
    throw new ReturnException(n.value.accept(this));
  }
  visitClassDefinition(n: ast.ClassDefinition): null {
    const methodMap: rt.MethodMap = Object.create(null);
    for (const statement of n.statements) {
      if (statement instanceof ast.ExpressionStatement) {
        const expression = statement.expression;
        if (expression instanceof ast.StringLiteral) {
          // Comment statement
          continue;
        }
      } else if (statement instanceof ast.Declaration) {
        const valueExpression = statement.value;
        if (valueExpression instanceof ast.FunctionDisplay) {
          const yalfunc = this.visitFunctionDisplay(valueExpression);
          methodMap[statement.identifier.name] = yalfunc;
        }
      }
      throw new RuntimeError(`Unexpected statement`, statement.location);
    }
    const value = new rt.YALClass(n.identifier.location, n.identifier.name, methodMap);
    this.scope[n.identifier.name] =
      { location: n.identifier.location, isConst: true, value };
    return null;
  }
  visitNilLiteral(n: ast.NilLiteral): rt.Value {
    return null;
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): rt.Value {
    return n.value;
  }
  visitNumberLiteral(n: ast.NumberLiteral): rt.Value {
    return n.value;
  }
  visitStringLiteral(n: ast.StringLiteral): rt.Value {
    return n.value;
  }
  visitVariable(n: ast.Variable): rt.Value {
    const variable = this.scope[n.name];
    if (!variable) {
      throw new RuntimeError(`Variable ${n.name} not found`, n.location);
    }
    return variable.value;
  }
  visitAssignment(n: ast.Assignment): rt.Value {
    const value = n.value.accept(this);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      throw new RuntimeError(`Variable ${n.identifier.name} not found`, n.identifier.location);
    }
    if (variable.isConst) {
      throw new RuntimeError(
        `Tried to modify const variable ${n.identifier.name}`, n.identifier.location);
    }
    variable.value = value;
    return value;
  }
  visitListDisplay(n: ast.ListDisplay): rt.Value {
    const values: rt.Value[] = [];
    for (const expression of n.values) {
      values.push(expression.accept(this));
    }
    return values;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): rt.YALFunction {
    return (recv: rt.Value, args: rt.Value[]): rt.Value => {
      const scope: Scope = Object.create(this.scope);
      scope['this'] = { location: n.location, isConst: true, value: recv };
      for (let i = 0; i < n.parameters.length; i++) {
        const param = n.parameters[i];
        const value = i < args.length ? args[i] : null;
        scope[param.identifier.name] =
          { location: param.location, isConst: param.isConst, value };
      }
      const evaluator = new Evaluator(scope);
      const body = n.body;
      try {
        body.accept(evaluator);
        return null; // TODO: return values
      } catch (e) {
        if (e instanceof ReturnException) {
          return e.value;
        }
        throw e;
      }
    };
  }
  visitMethodCall(n: ast.MethodCall): rt.Value {
    const recv = n.owner.accept(this);
    const args = n.args.map(arg => arg.accept(this));
    errorStack.push(n.location);
    const result = rt.callMethod(recv, n.identifier.name, args);
    errorStack.pop();
    return result;
  }
  visitNew(n: ast.New): rt.Value {
    throw new Error(`TODO: Evaluator.visitNew()`);
  }
  visitLogicalAnd(n: ast.LogicalAnd): rt.Value {
    const lhs = n.lhs.accept(this);
    return rt.isTruthy(lhs) ? n.rhs.accept(this) : lhs;
  }
  visitLogicalOr(n: ast.LogicalOr): rt.Value {
    const lhs = n.lhs.accept(this);
    return rt.isTruthy(lhs) ? lhs : n.rhs.accept(this);
  }
  visitConditional(n: ast.Conditional): rt.Value {
    return rt.isTruthy(n.condition.accept(this)) ?
      n.lhs.accept(this) : n.rhs.accept(this);
  }
};

export function evaluate(node: ast.Node, scope: Scope): rt.Value {
  const evaluator = new Evaluator(scope);
  const n = node;
  return n.accept(evaluator);
}
