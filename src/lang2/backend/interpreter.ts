import * as ast from '../frontend/ast';
import { Range, Rangeable } from '../frontend/lexer';
import { Location } from '../frontend/location';

const PRELUDE_URI = 'prelude';

class RuntimeError {
  readonly stack: Location[];
  readonly message: string;

  constructor(stack: Location[], message: string) {
    this.stack = stack;
    this.message = message;
  }
}

class Identifier {
  static fromNameAndURI(name: ast.Name, uri: string) {
    return new Identifier(name.value, new Location(uri, name.range));
  }

  readonly name: string;
  readonly location?: Location;
  constructor(name: string, location?: Location) {
    this.name = name;
    this.location = location;
  }
}

class Variable {
  readonly identifier: Identifier;
  value: Value;

  constructor(identifier: Identifier, value: Value) {
    this.identifier = identifier;
    this.value = value;
  }
}

type Scope = { [key: string]: Variable; };

function newScope(parent: Scope | null = null): Scope {
  return Object.create(parent);
}

export class Context {
  readonly locationStack: Location[] = [];
  scope = newScope();
  uri: string = '';
  range?: Range;
  location?: Location;

  addVariable(variable: Variable) {
    this.scope[variable.identifier.name] = variable;
  }

  err(message: string, locationOrRange?: Location | Rangeable) {
    const stack = [...this.locationStack];
    if (locationOrRange instanceof Location) {
      stack.push(locationOrRange);
    } else if (locationOrRange) {
      stack.push(new Location(this.uri, Range.join(locationOrRange)));
    }
    return new RuntimeError(stack, message);
  }
}

type Value = Function | Class | Instance;

class Function {
  readonly identifier: Identifier;
  readonly defn: ast.FunctionDefinition;

  constructor(uri: string, defn: ast.FunctionDefinition) {
    this.identifier = Identifier.fromNameAndURI(defn.name, uri);
    this.defn = defn;
  }
}

class Class {
  readonly identifier: Identifier;
  readonly defn: ast.ClassDefinition;
  readonly methodMap = new Map<string, Function>();

  constructor(uri: string, defn: ast.ClassDefinition) {
    this.identifier = Identifier.fromNameAndURI(defn.name, uri);
    this.defn = defn;
  }

  addMethod(method: Function) {
    this.methodMap.set(method.identifier.name, method);
  }
}

class Instance {
  readonly cls: Class;

  constructor(cls: Class) {
    this.cls = cls;
  }
}

function* evalModule(ctx: Context, uri: string, module: ast.ModuleDisplay) {
  const oldURI = ctx.uri;
  ctx.uri = uri;
  try {
    for (const headerItem of module.header) {
    }
    for (const statement of module.statements) {
      yield* evalStatement(ctx, statement);
    }
  } finally {
    ctx.uri = oldURI;
  }
}

function* evalStatement(ctx: Context, stmt: ast.Statement) {
  if (stmt instanceof ast.FunctionDefinition) {
    const func = new Function(ctx.uri, stmt);
    const variable = new Variable(func.identifier, func);
    ctx.addVariable(variable);
  } else {
    throw ctx.err(`Unrecognized Statement ${stmt.constructor.name}`, stmt);
  }
}

function* evalExpression(ctx: Context, expr: ast.Expression): Generator<undefined, Value, any> {
  if (expr instanceof ast.Name) {
    const identifier = Identifier.fromNameAndURI(expr, ctx.uri);
    const variable = ctx.scope[identifier.name];
    if (!variable) throw ctx.err(`Variable ${identifier.name} not found`, expr);
    return variable.value;
  } else if (expr instanceof ast.MethodCall) {
    const owner = yield* evalExpression(ctx, expr.owner);
    const methodName = expr.name.value;
    if (owner instanceof Function) {

    }
    throw "";
  } else {
    throw ctx.err(`Unrecognized Expression ${expr.constructor.name}`, expr);
  }
}
