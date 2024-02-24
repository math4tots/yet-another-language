import * as ast from './ast';
import * as rt from './runtime';

export type Variable = { location: ast.Location, isConst: boolean, value: rt.Value; };
export type Scope = { [key: string]: Variable; };

class Evaluator implements ast.Visitor<rt.Value> {
  readonly scope: Scope;
  constructor(scope: Scope) {
    this.scope = scope;
  }
  visitFile(n: ast.File): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitNone(n: ast.None): rt.Value {
    return null;
  }
  visitBlock(n: ast.Block): rt.Value {
    let last: rt.Value = null;
    for (const statement of n.statements) {
      last = statement.accept(this);
    }
    return last;
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
  visitIdentifier(n: ast.Identifier): rt.Value {
    const variable = this.scope[n.name];
    if (!variable) {
      throw new rt.RuntimeError(`Variable ${n.name} not found`, n.location);
    }
    return variable.value;
  }
  visitDeclaration(n: ast.Declaration): rt.Value {
    const value: rt.Value = n.value?.accept(this) || null;
    const variable: Variable = { location: n.location, isConst: n.isConst, value: value };
    this.scope[n.identifier.name] = variable;
    return value;
  }
  visitAssignment(n: ast.Assignment): rt.Value {
    const value = n.value.accept(this);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      throw new rt.RuntimeError(`Variable ${n.identifier.name} not found`, n.identifier.location);
    }
    if (variable.isConst) {
      throw new rt.RuntimeError(
        `Variable ${n.identifier.name} is immutable`, n.identifier.location);
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
  visitFunctionDisplay(n: ast.FunctionDisplay): rt.Value {
    return (recv: rt.Value, args: rt.Value[]): rt.Value => {
      const scope: Scope = Object.create(this.scope);
      scope['this'] = { location: n.location, isConst: true, value: recv };
      for (let i = 0; i < n.parameters.length; i++) {
        const value: rt.Value = i < args.length ? args[i] : null;
        const variable: Variable = { location: n.parameters[i].location, isConst: true, value };
        scope[n.parameters[i].identifier.name] = variable;
      }
      const evaluator = new Evaluator(scope);
      return n.body.accept(evaluator);
    };
  }
  visitMethodCall(n: ast.MethodCall): rt.Value {
    const recv = n.owner.accept(this);
    const args = n.args.map(arg => arg.accept(this));
    try {
      rt.errorStack.push(n.location);
      return rt.callMethod(recv, n.identifier.name, args);
    } finally {
      rt.errorStack.pop();
    }
  }
  visitLogicalAnd(n: ast.LogicalAnd): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitLogicalOr(n: ast.LogicalOr): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitConditional(n: ast.Conditional): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitIf(n: ast.If): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitWhile(n: ast.While): rt.Value {
    throw new Error('Method not implemented.');
  }
  visitClassDefinition(n: ast.ClassDefinition): rt.Value {
    throw new Error('Method not implemented.');
  }
}
