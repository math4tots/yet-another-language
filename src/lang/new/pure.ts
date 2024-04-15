import * as ast from '../ast';
import { newClosure } from './eval';
import { BoolValue, FunctionValue, NilValue, NumberValue, StringValue, Value } from './value';


export type Result = string | undefined;

type Variable = { value?: Value; local?: boolean; };
type Scope = { [key: string]: Variable; };

class PureCodeCodeGenerator implements ast.ExpressionVisitor<Result>, ast.StatementVisitor<Result> {
  private scope: Scope;

  constructor(scope: Scope) { this.scope = scope; }

  visitNilLiteral(n: ast.NilLiteral): Result {
    return 'NIL';
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): Result {
    return n.value ? 'TRUE' : 'FALSE';
  }
  visitNumberLiteral(n: ast.NumberLiteral): Result {
    switch (n.value) {
      case 0: return `I0`;
      case 1: return `I1`;
      case 2: return `I2`;
      case 3: return `I3`;
      case 4: return `I4`;
      case 5: return `I5`;
      case 6: return `I6`;
      case 7: return `I7`;
      case 8: return `I8`;
      case 9: return `I9`;
      case 10: return `I10`;
      case -0: return `I_0`;
      case -1: return `I_1`;
      case -2: return `I_2`;
      case -3: return `I_3`;
      case -4: return `I_4`;
      case -5: return `I_5`;
      case -6: return `I_6`;
      case -7: return `I_7`;
      case -8: return `I_8`;
      case -9: return `I_9`;
      case -10: return `I_10`;
    }
    return `NumberValue.of(${JSON.stringify(n.value)})`;
  }
  visitStringLiteral(n: ast.StringLiteral): Result {
    return `StringValue.of(${JSON.stringify(n.value)})`;
  }
  visitIdentifierNode(n: ast.IdentifierNode): Result {
    const variable = this.scope[n.name];
    if (!variable) return; // requires undefined or not yet defined variable
    const { value, local } = variable;
    if (local) {
      if (n.name === 'this') return 'this';
      return `YAL${n.name}`;
    }
    if (value instanceof NilValue) {
      return `NIL`;
    }
    if (value instanceof BoolValue) {
      return value.test() ? 'TRUE' : 'FALSE';
    }
    if (value instanceof NumberValue) {
      return `NumberValue.of(${value.value})`;
    }
    if (value instanceof StringValue) {
      return `StringValue.of(${JSON.stringify(value.value)})`;
    }
    return;
  }
  visitAssignment(n: ast.Assignment): Result {
    const rhs = n.value.accept(this);
    if (!rhs) return;
    return `(YAL${n.identifier.name} = ${rhs})`;
  }
  visitListDisplay(n: ast.ListDisplay): Result {
    const values: string[] = [];
    for (const expression of n.values) {
      const code = expression.accept(this);
      if (!code) return;
      values.push(code);
    }
    return `ListValue.using([${values.join(',')}])`;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): Result {
    return; // TODO
  }
  visitMethodCall(n: ast.MethodCall): Result {
    const owner = n.owner.accept(this);
    if (!owner) return;
    const args: string[] = [];
    for (const expr of n.args) {
      const arg = expr.accept(this);
      if (!arg) return;
      args.push(arg);
    }
    return `${owner}.YAL${n.identifier.name}(${args.join(',')})`;
  }
  visitNew(n: ast.New): Result {
    return; // TODO?
  }
  visitLogicalNot(n: ast.LogicalNot): Result {
    const inner = n.value.accept(this);
    if (!inner) return;
    return `(${inner}.test()?FALSE:TRUE)`;
  }
  visitLogicalAnd(n: ast.LogicalAnd): Result {
    const lhs = n.lhs.accept(this);
    if (!lhs) return;
    const rhs = n.rhs.accept(this);
    if (!rhs) return;
    return `(${lhs}.test()&&${rhs}.test()?TRUE:FALSE)`;
  }
  visitLogicalOr(n: ast.LogicalOr): Result {
    const lhs = n.lhs.accept(this);
    if (!lhs) return;
    const rhs = n.rhs.accept(this);
    if (!rhs) return;
    return `(${lhs}.test()||${rhs}.test()?TRUE:FALSE)`;
  }
  visitConditional(n: ast.Conditional): Result {
    const condition = n.condition.accept(this);
    if (!condition) return;
    const lhs = n.lhs.accept(this);
    if (!lhs) return;
    const rhs = n.rhs.accept(this);
    if (!rhs) return;
    return `(${condition}.test()?${lhs}:${rhs})`;
  }
  visitTypeAssertion(n: ast.TypeAssertion): Result {
    return n.value.accept(this);
  }
  visitNativeExpression(n: ast.NativeExpression): Result {
    return;
  }
  visitNativePureFunction(n: ast.NativePureFunction): Result {
    return `new FunctionValue(function(` +
      `${n.parameters.map(p => p.identifier.name).join(',')}` +
      `){return ${n.body}})`;
  }
  visitEmptyStatement(n: ast.EmptyStatement): Result {
    return ';';
  }
  visitExpressionStatement(n: ast.ExpressionStatement): Result {
    const code = n.expression.accept(this);
    if (!code) return;
    return code + ';';
  }
  visitBlock(n: ast.Block): Result {
    const outerScope = this.scope;
    try {
      this.scope = Object.create(this.scope);
      const parts: string[] = [];
      for (const stmt of n.statements) {
        const code = stmt.accept(this);
        if (!code) return;
        parts.push(code);
      }
      return `{${parts.join('')}}`;
    } finally {
      this.scope = outerScope;
    }
  }
  visitDeclaration(n: ast.Declaration): Result {
    const storageClass = n.isMutable ? 'let' : 'const';
    const value = n.value?.accept(this);
    if (n.value && !value) return;
    this.scope[n.identifier.name] = { local: true };
    return `${storageClass} YAL${n.identifier.name}${value ? '=' + value : ''};`;
  }
  visitIf(n: ast.If): Result {
    const condition = n.condition.accept(this);
    if (!condition) return;
    const lhs = n.lhs.accept(this);
    if (!lhs) return;
    const rhs = n.rhs?.accept(this);
    if (n.rhs && !rhs) return;
    return `if(${condition}.test())${lhs}${rhs ? 'else ' + rhs : ''}`;
  }
  visitWhile(n: ast.While): Result {
    const condition = n.condition.accept(this);
    if (!condition) return;
    const body = n.body.accept(this);
    if (!body) return;
    return `while(${condition}.test())${body}`;
  }
  visitReturn(n: ast.Return): Result {
    const code = n.value.accept(this);
    if (!code) return;
    return `return ${code};`;
  }
  visitClassDefinition(n: ast.ClassDefinition): Result {
    return;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): Result {
    return;
  }
  visitImport(n: ast.Import): Result {
    return;
  }
}

export function translatePureFunction(fd: ast.FunctionDisplay, constScope: Scope): Function | undefined {
  const scope: Scope = Object.create(constScope);
  for (const parameter of fd.parameters) {
    scope[parameter.identifier.name] = { local: true };
  }
  const codeGenerator = new PureCodeCodeGenerator(scope);
  const code = fd.body.accept(codeGenerator);
  if (!code) return;
  return newClosure('', fd.parameters.map(p => `YAL${p.identifier.name}`), code);
}

export function newPureFunctionValue(fd: ast.FunctionDisplay, scope: Scope): FunctionValue | undefined {
  const func = translatePureFunction(fd, scope);
  if (!func) return;
  return new FunctionValue(func as any);
}
