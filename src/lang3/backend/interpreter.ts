import * as ast from "../frontend/ast";
import {
  BoolTable,
  FloatTable,
  FunctionTable,
  FunctionValue,
  ListTable,
  NullTable,
  StringTable,
  TableValue,
  Value,
} from "./value";

class Variable {
  readonly isMutable: boolean;
  value: Value;

  constructor(isMutable: boolean, value: Value) {
    this.isMutable = isMutable;
    this.value = value;
  }
}

type Scope = { [name: string]: Variable; };

function newScope(parent: Scope | null = null): Scope { return Object.create(parent); }

export class BreakException { }
export class ContinueException { }
export class ReturnException {
  readonly value: Value;
  constructor(value: Value) { this.value = value; }
}

export class Interpreter implements ast.StatementVisitor<void>, ast.ExpressionVisitor<Value> {
  readonly stack = [newScope()];
  get scope() { return this.stack[this.stack.length - 1]; }
  findVariable(name: string): Variable | undefined { return this.scope[name]; }

  getTable(value: Value): TableValue {
    switch (typeof value) {
      case 'string': return StringTable;
      case 'boolean': return BoolTable;
      case 'number': return FloatTable;
      case 'function': return FunctionTable;
      case 'object':
        if (value === null) return NullTable;
        if (Array.isArray(value)) return ListTable;
        return value;
    }
  }

  newError(errorType: string, message: string, location?: ast.Location) {
    let msg = 'Traceback (most recent call last):\n';
    for (const scope of [...this.stack, ...(location ? [{ __location__: { value: location } }] : [])]) {
      const location = scope.__location__?.value;
      if (location instanceof ast.Location) {
        msg += `  File "${location.uri}", line ${location.range.start.line + 1}\n`;
      }
    }
    msg += `${errorType}: ${message}`;
    return new Error(msg);
  }

  newRuntimeError(message: string, location?: ast.Location) {
    return this.newError('RuntimeError', message, location);
  }

  newNotImplementedError(message: string, location?: ast.Location) {
    return this.newError('NotImplementedError', message, location);
  }

  visitBlock(block: ast.Block): void {
    for (const stmt of block.statements) stmt.accept(this);
  }
  visitExpressionStatement(s: ast.ExpressionStatement): void {
    s.expression.accept(this);
  }
  visitIf(s: ast.If): void {
    if (s.test.accept(this)) s.body.accept(this);
    else s.orelse?.accept(this);
  }
  visitWhile(s: ast.While): void {
    while (s.test.accept(this)) {
      try { s.body.accept(this); }
      catch (exc) {
        if (exc instanceof BreakException) break;
        else if (exc instanceof ContinueException) continue;
        else throw exc;
      }
    }
  }
  visitBreak(s: ast.Break): void {
    throw new BreakException();
  }
  visitContinue(s: ast.Continue): void {
    throw new ContinueException();
  }
  visitVariableDeclaration(s: ast.VariableDeclaration): void {
    const variable = new Variable(s.isMutable, s.value.accept(this));
    this.scope[s.identifier.name] = variable;
  }
  visitAssignment(s: ast.Assignment): void {
    const variable = this.findVariable(s.identifier.name);
    if (!variable) throw this.newRuntimeError(`Variable "${s.identifier.name}" not found`);
    variable.value = s.value.accept(this);
  }
  visitFunctionDefinition(s: ast.FunctionDefinition): void {
    const enclosingScope = this.scope;
    const parameters = s.parameters;
    const body = s.body;
    const func: FunctionValue = function (this: Value, it: Interpreter, args: Value[]) {
      let i = 0;
      const scope = newScope(enclosingScope);
      scope['this'] = new Variable(false, this);
      for (const param of parameters) {
        scope[param.identifier.name] = new Variable(false, i < args.length ? args[i++] : null);
      }
      it.stack.push(scope);
      try {
        body.accept(it);
        return null;
      } catch (exc) {
        if (exc instanceof ReturnException) return exc.value;
        else throw exc;
      } finally {
        it.stack.pop();
      }
    };
    this.scope[s.identifier.name] = new Variable(false, func);
  }
  visitReturn(s: ast.Return): void {
    throw new ReturnException(s.expression?.accept(this) ?? null);
  }
  visitTypedef(s: ast.Typedef): void {
    throw this.newNotImplementedError(`Interpreter.visitTypedef()`);
  }
  visitLiteral(e: ast.Literal): Value {
    return e.value;
  }
  visitIdentifier(e: ast.Identifier): Value {
    const variable = this.findVariable(e.name);
    if (!variable) throw this.newRuntimeError(`Variable "${e.name}" not found`);
    return variable.value;
  }
  visitOperation(e: ast.Operation): Value {
    const data = e.data;
    switch (data.operator) {
      case 'or': return data.args[0].accept(this) || data.args[1].accept(this);
      case 'and': return data.args[0].accept(this) && data.args[1].accept(this);
      case 'not': return !data.args[0].accept(this);
      case 'if': return data.args[0].accept(this) ? data.args[1].accept(this) : data.args[2].accept(this);
    }
  }
  visitMethodCall(e: ast.MethodCall): Value {
    const owner = e.owner.accept(this);
    const methodName = e.identifier.name;
    const table = this.getTable(owner);
    const method = table[e.identifier.name];
    if (method === undefined) {
      if (e.args.length === 0 && methodName.startsWith('__get_')) {
        const fieldName = methodName.slice('__get_'.length);
        const value = table[fieldName];
        if (value === undefined) throw this.newRuntimeError(`Field not found`, e.identifier.location);
        return value;
      } else if (e.args.length === 1 && methodName.startsWith('__set_') && typeof owner === 'object' && owner) {
        const fieldName = methodName.slice('__set_'.length);
        const value = e.args[0].accept(this);
        table[fieldName] = value;
        return value;
      }
      throw this.newRuntimeError(`Method "${methodName}" not found`);
    }
    if (typeof method !== 'function') {
      throw this.newRuntimeError(`"${methodName}" is not a method`);
    }
    const args = e.args.map(arg => arg.accept(this));
    const oldLocationVariable = this.scope['__location__'];
    try {
      this.scope['__location__'] = new Variable(false, e.location as unknown as TableValue);
      return method.call(owner, this, args);
    } finally {
      this.scope['__location__'] = oldLocationVariable;
    }
  }
  visitListDisplay(e: ast.ListDisplay): Value {
    return e.values.map(i => i.accept(this));
  }
  visitTableDisplay(e: ast.TableDisplay): Value {
    const table: TableValue = Object.create(null);
    for (const [key, value] of e.pairs) table[key.name] = value.accept(this);
    return table;
  }
}

export function interpret(node: ast.Expression, scope: Scope): Value;
export function interpret(node: ast.Statement, scope: Scope): void;
export function interpret(node: ast.File, scope: Scope): Value;
export function interpret(node: ast.Node, scope: Scope = newScope()): Value | void {
  const it = new Interpreter();
}
