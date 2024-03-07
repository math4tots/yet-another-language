import * as vscode from "vscode";
import * as ast from "./ast";
import { Range } from "./lexer";
import {
  Type,
  AnyType, BoolType, ClassType, FunctionType, ListType, NilType, NumberType, StringType,
  Value,
  Method,
  Field,
  reprValue, strValue, MethodBody, Instance, InterfaceType, ModuleType, ModuleInstance,
} from "./type";
import { parse } from "./parser";
import { LIBRARY_URIS } from "./paths";

export type AnnotationError = ast.ParseError;
export type ValueInfo = { type: Type, value?: Value; };

export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

export type Variable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly value?: Value;
  readonly comment?: ast.StringLiteral | null;
};
export type ExplicitVariable = Variable & {
  readonly identifier: ast.ExplicitIdentifier;
};
type Scope = { [key: string]: Variable; };

export type Reference = {
  readonly identifier: ast.ExplicitIdentifier,
  readonly variable: Variable,
};

const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyType, value: AnyType };
BASE_SCOPE['Nil'] =
  { identifier: NilType.identifier, type: AnyType, value: NilType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: AnyType, value: BoolType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: AnyType, value: NumberType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: AnyType, value: StringType };

function newBuiltin(name: string, ptypes: Type[], rtype: Type, body?: MethodBody): Variable {
  const identifier: ast.Identifier = { location: null, name };
  const type = FunctionType.of(ptypes, rtype);
  return { identifier, type, value: new Method(identifier, type, body || null) };
}

function addBuiltin(name: string, ptypes: Type[], rtype: Type, body?: MethodBody) {
  BASE_SCOPE[name] = newBuiltin(name, ptypes, rtype, body);
}

addBuiltin('print', [AnyType], NilType);
addBuiltin('str', [AnyType], StringType, (_, args) => strValue(args[0]));
addBuiltin('repr', [AnyType], StringType, (_, args) => reprValue(args[0]));

const printVariable = BASE_SCOPE.print;

export interface Completion {
  readonly name: string;
  readonly detail?: string;
}

export interface CompletionPoint {
  readonly range: Range;
  getCompletions(): Completion[];
}

export interface PrintInstance {
  readonly range: Range;
  readonly value: Value;
}

export interface CallInstance {
  readonly range: Range; // range of entire call
  readonly args: Range[]; // range of individual arguments
  readonly type: FunctionType;
  readonly value?: Method;
}

function getCommentFromSeq(stmts: ast.Statement[]): ast.StringLiteral | undefined {
  return (stmts.length > 0 &&
    stmts[0] instanceof ast.ExpressionStatement &&
    stmts[0].expression instanceof ast.StringLiteral) ? stmts[0].expression : undefined;
}

function getCommentFromFunctionDisplay(fd: ast.Node | null): ast.StringLiteral | undefined {
  return fd instanceof ast.FunctionDisplay ?
    getCommentFromSeq(fd.body.statements) : undefined;
}

export async function annotateDocument(document: vscode.TextDocument): Promise<Annotator> {
  const annotator = new Annotator(document.uri, document.version);
  const fileNode = parse(document.uri, document.getText());
  await annotator.annotateFile(fileNode);
  return annotator;
}

function isTruthy(value: Value): boolean {
  return !(value === null || value === false);
}

export class Annotator implements
  ast.ExpressionVisitor<ValueInfo>,
  ast.StatementVisitor<RunStatus> {
  readonly uri: vscode.Uri;
  readonly errors: AnnotationError[] = [];
  readonly variables: Variable[] = [];
  readonly references: Reference[] = [];
  readonly completionPoints: CompletionPoint[] = [];
  readonly printInstances: PrintInstance[] = [];
  readonly callInstances: CallInstance[] = [];
  private scope: Scope = Object.create(BASE_SCOPE);
  private hint: Type = AnyType;
  private currentReturnType: Type | null = null;
  private readonly importCache: Map<string, Annotator>;
  private readonly moduleType: ModuleType;
  private readonly version: number;
  private readonly moduleVariable: ExplicitVariable;

  // a cache is required when type solving, because:
  //   (1) we generate annotations while solving types, and
  //   (2) sometimes we need to solve a type multiple times
  //       when doing forward declarations (e.g. class methods)
  //
  // So without caching, we might see duplicate hover items.
  //
  private readonly typeSolverCache = new Map<ast.TypeExpression, Type>();

  constructor(
    uri: vscode.Uri, version: number, importCache: Map<string, Annotator> = new Map()) {
    this.uri = uri;
    this.version = version;
    this.importCache = importCache;
    const shortName = getShortName(uri);
    const identifier: ast.ExplicitIdentifier = {
      location: {
        uri, range: {
          start: { index: 0, line: 0, column: 0 },
          end: { index: 0, line: 0, column: 0 },
        }
      },
      name: `module(${JSON.stringify(shortName)})`,
    };
    this.moduleType = new ModuleType(identifier);
    this.moduleVariable = {
      identifier,
      type: this.moduleType,
      value: new ModuleInstance(this.moduleType),
    };
  }

  async annotateFile(file: ast.File): Promise<void> {
    this.errors.push(...file.errors);
    await this.blockScoped(async () => {
      for (const statement of file.statements) {
        if (statement instanceof ast.Import) {
          await this.resolveImport(statement);
        }
      }
      this.declareClassesAndFunctions(file.statements);
      for (const statement of file.statements) {
        statement.accept(this);
        if (statement instanceof ast.ClassDefinition ||
          statement instanceof ast.InterfaceDefinition) {
          const variable = this.scope[statement.identifier.name];
          if (variable && variable.identifier.location) {
            if (variable.value instanceof Type) {
              this.moduleType.addMemberTypeVariable(
                statement.identifier.name, variable as ExplicitVariable);
            }
          }
        } else if (statement instanceof ast.Declaration) {
          const variable = this.scope[statement.identifier.name];
          if (variable) {
            // getter method
            this.moduleType.addMethod(new Method(
              {
                location: variable.identifier.location,
                name: `get_${variable.identifier.name}`
              },
              FunctionType.of([], variable.type),
              () => variable.value,
              variable.comment || null
            ));
            // setter method
            if (variable.isMutable) {
              this.moduleType.addMethod(new Method(
                {
                  location: variable.identifier.location,
                  name: `set_${variable.identifier.name}`
                },
                FunctionType.of([variable.type], AnyType),
                null,
                variable.comment || null
              ));
            }
            // direct method (for functions)
            if (variable.type instanceof FunctionType &&
              (statement.value instanceof ast.FunctionDisplay ||
                statement.value instanceof ast.NativePureFunction)) {
              this.moduleType.addMethod(new Method(
                variable.identifier,
                variable.type,
                variable.value instanceof Method ? variable.value.body : null,
                variable.comment || null
              ));
            }
          }
        }
      }
    });
    this.typeSolverCache.clear();
  }

  private async openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | null> {
    try {
      const stat = await vscode.workspace.fs.stat(uri); // check if document exists
      return await vscode.workspace.openTextDocument(uri);
    } catch (e) {
      return null;
    }
  }

  private async getImportVariable(
    uri: vscode.Uri, importLocation: ast.Location): Promise<ExplicitVariable> {
    const key = uri.toString();
    const cached = this.importCache.get(key);
    const document = await this.openDocument(uri);
    if (!document) {
      const annotator = new Annotator(uri, -1, this.importCache);
      this.importCache.set(key, annotator);
      const location = {
        uri,
        range: { start: { index: 0, line: 0, column: 0 }, end: { index: 0, line: 0, column: 0 } }
      };
      this.errors.push({
        location: importLocation,
        message: `Resource ${uri.toString()} not found`,
      });
      annotator.errors.push({
        location,
        message: `Resource ${uri.toString()} not found`,
      });
      return annotator.moduleVariable;
    }
    if (cached && cached.version === document.version) {
      return cached.moduleVariable;
    }
    const annotator = new Annotator(uri, document.version, this.importCache);
    this.importCache.set(key, annotator);
    const text = document.getText();
    const fileNode = parse(uri, text);
    await annotator.annotateFile(fileNode);
    if (annotator.errors.length > 0) {
      this.errors.push({
        location: importLocation,
        message: `import has errors`,
      });
    }
    return annotator.moduleVariable;
  }

  private async resolveImport(n: ast.Import) {
    let rawPath = n.path.value;
    if (!rawPath.endsWith('.yal')) {
      rawPath = rawPath + '.yal';
    }
    if (rawPath.startsWith('/')) {
      // absolute path. Not yet supported
      this.errors.push({
        location: n.path.location,
        message: `Absolute improt paths not yet supported`,
      });
      return Continues;
    }
    let importURI: vscode.Uri | undefined = undefined;
    if (rawPath.startsWith('./')) {
      // relative path
      importURI = vscode.Uri.from({
        authority: this.uri.authority,
        fragment: this.uri.fragment,
        path: getParentPath(this.uri.path) + rawPath.substring(1),
        query: this.uri.query,
        scheme: this.uri.scheme,
      });
    } else {
      // library path
      for (const libraryURI of LIBRARY_URIS) {
        importURI = vscode.Uri.from({
          authority: libraryURI.authority,
          fragment: libraryURI.fragment,
          path: libraryURI.path + '/' + rawPath,
          query: libraryURI.query,
          scheme: libraryURI.scheme,
        });
        try {
          await vscode.workspace.fs.stat(importURI); // check if URI exists
          break;
        } catch (e) { }
      }
      if (importURI === undefined) {
        this.errors.push({
          location: n.location,
          message: `Module ${JSON.stringify(n.path.value)} not found`,
        });
        return Continues;
      }
    }
    const moduleVariable = await this.getImportVariable(
      importURI, n.path.location);

    // Add a reference for the path to the file
    this.references.push({
      identifier: {
        location: n.path.location,
        name: n.path.value,
      },
      variable: moduleVariable,
    });

    // Add a reference for the local variable
    const localVariable: Variable = {
      identifier: n.identifier,
      type: moduleVariable.type,
      value: moduleVariable.value,
    };
    this.scope[n.identifier.name] = localVariable;
    this.references.push({
      identifier: n.identifier,
      variable: localVariable,
    });
    this.variables.push(localVariable);
  }

  private classScoped<R>(thisLocation: ast.Location, thisType: ClassType, f: () => R): R {
    return this.blockScoped<R>(() => {
      this.scope['this'] = {
        identifier: { location: thisLocation, name: 'this' },
        type: thisType,
      };
      return f();
    });
  }

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
    const cached = this.typeSolverCache.get(e);
    if (cached) return cached;
    const type = this._solveType(e);
    this.typeSolverCache.set(e, type);
    return type;
  }
  private _solveType(e: ast.TypeExpression): Type {
    const scope = this.scope;
    if (e.args.length > 0) {
      if (!e.qualifier) {
        if (e.identifier.name === 'List') {
          if (e.args.length !== 1) {
            this.errors.push({
              location: e.location,
              message: `List requires exactly one parameter`,
            });
            return AnyType;
          }
          const itemType = this.solveType(e.args[0]);
          return ListType.of(itemType);
        }
        if (e.identifier.name === 'Function') {
          const types = e.args.map(arg => this.solveType(arg));
          const returnType = types[types.length - 1];
          const parameterTypes = types.slice(0, types.length - 1);
          return FunctionType.of(parameterTypes, returnType);
        }
      }
      this.errors.push({
        location: e.location,
        message: `Only builtin generics List and Function are supported right now`,
      });
      return AnyType;
    }
    if (e.qualifier) {
      const importVariable = this.scope[e.qualifier.name];
      if (!importVariable) {
        this.errors.push({
          location: e.qualifier.location,
          message: `${e.qualifier.name} not found`,
        });
        return AnyType;
      }
      this.references.push({ identifier: e.qualifier, variable: importVariable });
      const moduleType = importVariable.type;
      if (!(moduleType instanceof ModuleType)) {
        this.errors.push({
          location: e.qualifier.location,
          message: `${e.qualifier.name} is not a module`,
        });
        return AnyType;
      }
      this.completionPoints.push({
        range: e.identifier.location.range,
        getCompletions() {
          return moduleType.getMemberTypeVariables().map(v => ({
            name: v.identifier.name,
          }));
        },
      });
      const memberVariable = moduleType.getMemberTypeVariable(e.identifier.name);
      if (!memberVariable) {
        this.errors.push({
          location: e.identifier.location,
          message: `Type ${e.identifier.name} not found in module`,
        });
        return AnyType;
      }
      this.references.push({ identifier: e.identifier, variable: memberVariable });
      if (!(memberVariable.value instanceof Type)) {
        this.errors.push({
          location: e.identifier.location,
          message: `${e.qualifier.name}.${e.identifier.name} is not a type`,
        });
        return AnyType;
      }
      return memberVariable.value;
    }
    this.completionPoints.push({
      range: e.identifier.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scope) {
          const variable = scope[key];
          if (variable.value instanceof Type || variable.value instanceof ModuleInstance) {
            completions.push({ name: key });
          }
        }
        // Provide completions for builtin generic types
        completions.push({ name: 'List' });
        completions.push({ name: 'Function' });
        return completions;
      },
    });
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
      this.references.push({ identifier: e.identifier, variable });
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
            message: `Expected ${hint.identifier.name} but got ${info.type.identifier.name}`,
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
  visitIdentifierNode(n: ast.IdentifierNode): ValueInfo {
    const scope = this.scope;
    this.completionPoints.push({
      range: n.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scope) {
          const variable = scope[key];
          if (!(variable.value instanceof Type)) {
            completions.push({
              name: key,
            });
          }
        }
        // additionally, provide provide completions for constants
        completions.push({ name: 'nil' });
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
      this.errors.push({
        location: n.location,
        message: `Variable ${n.name} not found`,
      });
      return { type: AnyType };
    }
    this.references.push({ identifier: n, variable });
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
    this.references.push({ identifier: n.identifier, variable });
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
        (this.hint instanceof ListType) ?
          this.hint.itemType :
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
  private solveFunctionDisplayType(n: ast.FunctionDisplay): FunctionType {
    const parameterTypes = n.parameters.map(p => p.type ? this.solveType(p.type) : AnyType);
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    return FunctionType.of(parameterTypes, returnType);
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ValueInfo {
    const funcType = this.solveFunctionDisplayType(n);
    const parameterTypes = funcType.parameterTypes;
    const returnType = funcType.returnType;
    this.functionScoped(returnType, () => {
      for (let i = 0; i < n.parameters.length; i++) {
        const identifier = n.parameters[i].identifier;
        const variable: Variable = { identifier, type: parameterTypes[i] };
        this.variables.push(variable);
        this.references.push({ identifier, variable });
        this.scope[identifier.name] = variable;
      }
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
  private checkArgs(location: ast.Location, types: Type[], args: ast.Expression[]): ValueInfo[] {
    const expectedArgc = types.length;
    const argc = args.length;
    if (expectedArgc !== argc) {
      this.errors.push({ location, message: `Expected ${expectedArgc} args but got ${argc}` });
    }
    const ret: ValueInfo[] = [];
    for (let i = 0; i < args.length; i++) {
      if (i < types.length) {
        ret.push(this.solve(args[i], types[i], true));
      } else {
        ret.push(this.solve(args[i]));
      }
    }
    return ret;
  }
  private applyPure(
    location: ast.Location,
    method: Value | undefined, owner: ValueInfo, args: ValueInfo[]): Value | undefined {
    if (owner.value !== undefined && method instanceof Method && method?.body &&
      args.length === method.type.parameterTypes.length &&
      args.every((arg, i) =>
        arg.value !== undefined &&
        arg.type.isAssignableTo(method.type.parameterTypes[i]))) {
      try {
        return method.body(owner.value, args.map(arg => arg.value as Value));
      } catch (e) {
        this.errors.push({
          location,
          message: `Pure function failed: ${e}`
        });
      }
    }
    return undefined;
  }
  private addCallInstance(
    location: ast.Location,
    args: ast.Expression[],
    type: Type,
    method: Value | undefined) {
    if (type instanceof FunctionType) {
      this.callInstances.push({
        range: location.range,
        args: args.map(arg => arg.location.range),
        type,
        value: method instanceof Method ? method : undefined,
      });
    }
  }
  visitMethodCall(n: ast.MethodCall): ValueInfo {
    const owner = this.solve(n.owner);
    if (owner.type instanceof FunctionType && n.identifier.name === '__call__') {
      // function call
      const args = this.checkArgs(n.location, owner.type.parameterTypes, n.args);
      const method = owner.value;
      if (owner.value === printVariable.value && args.length == 1 && args[0].value !== undefined) {
        // print value
        this.printInstances.push({ range: n.location.range, value: args[0].value });
      }
      this.addCallInstance(n.location, n.args, owner.type, owner.value);
      return {
        type: owner.type.returnType,
        value: this.applyPure(n.location, method, owner, args),
      };
    }
    this.completionPoints.push({
      range: n.identifier.location.range,
      getCompletions(): Completion[] {
        const completions: Completion[] = [];
        for (const method of owner.type.getAllMethods()) {
          const rawName = method.identifier.name;
          if (rawName.startsWith('set_')) {
            // skip setters
          } else if (rawName.startsWith('get_')) {
            // field or property
            const name = rawName.substring('get_'.length);
            completions.push({
              name,
              detail: '(property)',
            });
          } else {
            // normal methods
            const name = rawName;
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
      this.errors.push({
        location: n.location,
        message: `Method ${JSON.stringify(n.identifier.name)} ` +
          `not found on type ${owner.type.identifier.name}`,
      });
      for (const arg of n.args) {
        this.solve(arg);
      }
      return { type: AnyType };
    }
    this.references.push({ identifier: n.identifier, variable: method });
    const args = this.checkArgs(n.location, method.type.parameterTypes, n.args);
    this.addCallInstance(n.location, n.args, method.type, method);
    return {
      type: method.type.returnType,
      value: this.applyPure(n.location, method, owner, args),
    };
  }
  visitNew(n: ast.New): ValueInfo {
    const type = this.solveType(n.type);
    if (!(type instanceof ClassType)) {
      this.errors.push({
        location: n.location,
        message: `new requires a class type but got ${type}`,
      });
      return { type: AnyType };
    }
    const method = type.getConstructorMethod();
    this.addCallInstance(n.location, n.args, method.type, method);
    const fields = type.getFields();
    const fieldTypes = fields.map(field => field.type);
    const args = this.checkArgs(n.location, fieldTypes, n.args);
    const fieldValues: (Value | undefined)[] = [];
    for (let i = 0; i < fieldTypes.length; i++) {
      if (!fields[i].isMutable &&
        i < args.length &&
        args[i].value !== undefined &&
        args[i].type.isAssignableTo(fieldTypes[i])) {
        fieldValues.push(args[i].value);
      } else {
        fieldValues.push(undefined);
      }
    }
    return { type, value: new Instance(type, fieldValues) };
  }
  visitLogicalNot(n: ast.LogicalNot): ValueInfo {
    const value = this.solve(n.value, BoolType, true);
    return value.value === undefined ?
      { type: BoolType } :
      { type: BoolType, value: !isTruthy(value.value) };
  }
  visitLogicalAnd(n: ast.LogicalAnd): ValueInfo {
    const lhs = this.solve(n.lhs, BoolType, true);
    const rhs = this.solve(n.rhs, BoolType, true);
    return lhs.value === undefined ? { type: BoolType } : (isTruthy(lhs.value) ? rhs : lhs);
  }
  visitLogicalOr(n: ast.LogicalOr): ValueInfo {
    const lhs = this.solve(n.lhs, BoolType, true);
    const rhs = this.solve(n.rhs, BoolType, true);
    return lhs.value === undefined ? { type: BoolType } : (isTruthy(lhs.value) ? lhs : rhs);
  }
  visitConditional(n: ast.Conditional): ValueInfo {
    const cond = this.solve(n.condition, BoolType, true);
    const lhs = this.solve(n.lhs);
    const rhs = this.solve(n.rhs);
    return cond.value === undefined ?
      { type: lhs.type.getCommonType(rhs.type) } :
      (isTruthy(cond.value) ? lhs : rhs);
  }
  visitTypeAssertion(n: ast.TypeAssertion): ValueInfo {
    const value = this.solve(n.value);
    const type = this.solveType(n.type);
    return value.type.isAssignableTo(type) ? value : { type };
  }
  visitNativeExpression(n: ast.NativeExpression): ValueInfo {
    return { type: AnyType };
  }
  visitNativePureFunction(n: ast.NativePureFunction): ValueInfo {
    const parameterTypes = n.parameters.map(p => p.type ? this.solveType(p.type) : AnyType);
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    const type = FunctionType.of(parameterTypes, returnType);
    const parameterNames = n.parameters.map(p => p.identifier.name);
    const body = n.getBodyFor('vscode');
    let maybeFunc: Function | undefined;
    if (body) {
      try {
        maybeFunc = Function(...parameterNames, `return (${body})`);
      } catch (e) {
        this.errors.push({
          location: n.location,
          message: `Could not make pure function: ${e}`,
        });
      }
    }
    const func = maybeFunc;
    const value = new Method(
      new ast.IdentifierNode(n.location, '(native)'),
      type,
      func ? (recv, args) => func.apply(null, args) : null,
      null,
      parameterNames);
    return { type, value };
  }

  visitEmptyStatement(n: ast.EmptyStatement): RunStatus { return Continues; }
  visitExpressionStatement(n: ast.ExpressionStatement): RunStatus {
    this.solve(n.expression);
    return Continues;
  }
  visitBlock(n: ast.Block): RunStatus {
    let status: RunStatus = Continues;
    this.blockScoped(() => {
      this.declareClassesAndFunctions(n.statements);
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
    const comment = n.comment || getCommentFromFunctionDisplay(n.value);
    const variable = this.scope[n.identifier.name] = {
      isMutable: n.isMutable,
      identifier: n.identifier,
      type: explicitType || value.type,
      value: n.isMutable ? undefined : value.value,
      comment,
    };
    if (variable.value === undefined) {
      delete variable.value;
    }
    this.variables.push(variable);
    this.references.push({ identifier: n.identifier, variable });
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
  private declareClassesAndFunctions(statements: ast.Statement[]) {
    this.declareClasses(statements);
    this.forwardDeclareFunctions(statements);
  }
  private forwardDeclareFunctions(statements: ast.Statement[]) {
    for (const statement of statements) {
      if (statement instanceof ast.Declaration) {
        if (statement.value instanceof ast.FunctionDisplay) {
          const funcType = this.solveFunctionDisplayType(statement.value);
          // this declaration should get replaced by the "real" function when
          // we get there.
          // However, note, when the function is used recursively, there's no
          // mechanism currently in place that would allow
          // computing values at IDE time.
          this.scope[statement.identifier.name] = {
            identifier: statement.identifier,
            type: funcType,
            comment: statement.comment || getCommentFromFunctionDisplay(statement.value),
          };
        }
      }
    }
  }
  private declareClasses(statements: ast.Statement[]) {
    for (const statement of statements) {
      if (statement instanceof ast.ClassDefinition ||
        statement instanceof ast.InterfaceDefinition) {
        this.forwardDeclareClass(statement);
      }
    }
    for (const statement of statements) {
      if (statement instanceof ast.ClassDefinition ||
        statement instanceof ast.InterfaceDefinition) {
        this.declareClass(statement);
      }
    }
  }
  private forwardDeclareClass(n: ast.ClassDefinition | ast.InterfaceDefinition) {
    if (n.extendsFragment) {
      this.errors.push({
        location: n.extendsFragment.location,
        message: `Expected 'extends'`,
      });
      this.completionPoints.push({
        range: n.extendsFragment.location.range,
        getCompletions() {
          return [{ name: 'extends' }];
        },
      });
    }
    const superClass = (n instanceof ast.ClassDefinition && n.superClass) ?
      this.solveType(n.superClass) : null;
    const superTypes = (n instanceof ast.InterfaceDefinition) ?
      n.superTypes.map(t => this.solveType(t)) : [];
    if (n instanceof ast.ClassDefinition) {
      if (superClass !== null && !(superClass instanceof ClassType)) {
        this.errors.push({
          location: n.superClass!.location,
          message: `Base classes must be class types`
        });
      }
    } else {
      for (let i = 0; i < superTypes.length; i++) {
        if (!(superTypes[i] instanceof InterfaceType)) {
          this.errors.push({
            location: n.superTypes[i].location,
            message: `Base interfaces must be interface types`,
          });
        }
      }
    }
    const cls = n instanceof ast.ClassDefinition ?
      new ClassType(n.identifier, superClass instanceof ClassType ? superClass : null) :
      new InterfaceType(
        n.identifier,
        superTypes.filter(t => t instanceof InterfaceType) as InterfaceType[]);
    const comment = (n.statements.length > 0 &&
      n.statements[0] instanceof ast.ExpressionStatement &&
      n.statements[0].expression instanceof ast.StringLiteral) ?
      n.statements[0].expression : undefined;
    this.scope[cls.identifier.name] = {
      identifier: n.identifier,
      type: AnyType,
      value: cls,
      comment,
    };
  }
  private declareClass(n: ast.ClassDefinition | ast.InterfaceDefinition) {
    const variable = this.scope[n.identifier.name];
    const cls = variable.value;
    if (!variable || !(cls instanceof ClassType || cls instanceof InterfaceType)) {
      // this should never happen
      this.errors.push({
        location: n.location,
        message: `Forward declaration failed for class`,
      });
      return Continues;
    }
    for (const statement of n.statements) {
      if (statement instanceof ast.Declaration) {
        // forward declare methods
        if (statement.value instanceof ast.FunctionDisplay) {
          // normal method
          const functionDisplay = statement.value;
          const funcType = this.solveFunctionDisplayType(functionDisplay);
          const method = new Method(statement.identifier, funcType, null,
            getCommentFromFunctionDisplay(functionDisplay),
            functionDisplay.parameters.map(p => p.identifier.name));
          cls.addMethod(method);
          this.variables.push(method);
          this.references.push({ identifier: statement.identifier, variable: method });
        } else if (statement.value === null) {
          // field
          const fieldType = (statement.type && this.solveType(statement.type)) || AnyType;
          if (statement.value) {
            this.solve(statement.value, fieldType, true);
          }
          const comment = statement.comment;
          const field: Field = {
            isMutable: statement.isMutable,
            identifier: statement.identifier,
            type: fieldType,
          };
          if (cls instanceof ClassType) {
            cls.addField(field);
          }
          this.variables.push(field);
          this.references.push({ identifier: statement.identifier, variable: field });

          // synthesized field methods
          const getType = FunctionType.of([], fieldType);
          const name = statement.identifier.name;
          const getIdent = new ast.IdentifierNode(statement.identifier.location, `get_${name}`);
          const getMethod = new Method(
            getIdent, getType,
            (recv) => (recv as Instance).getField(statement.identifier.name),
            comment);
          cls.addMethod(getMethod);
          this.variables.push(getMethod);
          this.references.push({ identifier: statement.identifier, variable: getMethod });
          if (statement.isMutable) {
            const setType = FunctionType.of([fieldType], NilType);
            const setIdent = new ast.IdentifierNode(statement.identifier.location, `set_${name}`);
            const setMethod = new Method(setIdent, setType, null, null, ['value']);
            cls.addMethod(setMethod);
            this.variables.push(setMethod);
            this.references.push({ identifier: statement.identifier, variable: setMethod });
          }
        }
      }
    }
  }
  visitClassDefinition(n: ast.ClassDefinition): RunStatus {
    const variable = this.scope[n.identifier.name];
    const cls = variable.value;
    if (!variable || !(cls instanceof ClassType)) {
      // this should never happen
      this.errors.push({
        location: n.location,
        message: `Declaration failed for class`,
      });
      return Continues;
    }
    this.variables.push(variable);
    this.references.push({ identifier: n.identifier, variable });
    this.classScoped(n.identifier.location, cls, () => {
      for (const statement of n.statements) {
        if (statement instanceof ast.ExpressionStatement) {
          if (statement.expression instanceof ast.StringLiteral) {
            continue; // comments
          } else if (statement.expression instanceof ast.IdentifierNode) {
            // programmer is in the middle of typing something
            this.completionPoints.push({
              range: statement.location.range,
              getCompletions() {
                const completions: Completion[] = [];
                completions.push({ name: 'function' });
                completions.push({ name: 'var' });
                completions.push({ name: 'const' });
                return completions;
              },
            });
          }
        } else if (statement instanceof ast.Declaration) {
          if (statement.value instanceof ast.FunctionDisplay) {
            // method (everything but solving body handled in declareClass())
            const functionDisplay = statement.value;
            this.solve(functionDisplay);
            continue;
          } else if (statement.value === null) {
            // field (already handled in declareClass())
            continue;
          }
        }
        this.errors.push({
          location: statement.location,
          message: `Unsupported statement in class body`,
        });
      }
    });
    return Continues;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): RunStatus {
    return Continues;
  }
  visitImport(n: ast.Import): RunStatus {
    return Continues;
  }
}

function getParentPath(path: string): string {
  let i = path.length;
  while (i > 0 && path[i - 1] !== '/') i--;
  i--;
  return path.substring(0, i);
}

function getShortName(path: string | vscode.Uri): string {
  return vscode.workspace.asRelativePath(path);
}
