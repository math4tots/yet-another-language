import * as vscode from "vscode";
import * as ast from "./ast";
import { Range } from "./lexer";
import {
  Type,
  AnyType, BoolType, ClassType, FunctionType, ListType, NilType, NumberType, StringType,
  Value,
  Method,
  Field,
  reprValue, strValue, MethodBody, Instance, InterfaceType, ModuleType,
} from "./type";
import { parse } from "./parser";

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
export type ExplicitVariable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.ExplicitIdentifier;
  readonly type: Type;
  readonly value?: Value;
  readonly comment?: ast.StringLiteral | null;
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

function getCommentFromSeq(stmts: ast.Statement[]): ast.StringLiteral | undefined {
  return (stmts.length > 0 &&
    stmts[0] instanceof ast.ExpressionStatement &&
    stmts[0].expression instanceof ast.StringLiteral) ? stmts[0].expression : undefined;
}

function getCommentFromFunctionDisplay(fd: ast.Node | null): ast.StringLiteral | undefined {
  return fd instanceof ast.FunctionDisplay ?
    getCommentFromSeq(fd.body.statements) : undefined;
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
  private scope: Scope = Object.create(BASE_SCOPE);
  private hint: Type = AnyType;
  private currentReturnType: Type | null = null;
  private insideInterface: boolean = false;
  private readonly importCache: Map<string, Annotator>;
  private readonly moduleType: ModuleType;
  private readonly version: number;
  private readonly moduleVariable: ExplicitVariable;

  constructor(
    uri: vscode.Uri, version: number, importCache: Map<string, Annotator> = new Map()) {
    this.uri = uri;
    this.version = version;
    this.importCache = importCache;
    const identifier: ast.ExplicitIdentifier = {
      location: {
        uri, range: {
          start: { index: 0, line: 0, column: 0 },
          end: { index: 0, line: 0, column: 0 },
        }
      },
      name: `module(${uri.toString()})`,
    };
    this.moduleType = new ModuleType(identifier);
    this.moduleVariable = { identifier, type: this.moduleType };
  }

  async annotateFile(file: ast.File): Promise<void> {
    this.errors.push(...file.errors);
    await this.blockScoped(async () => {
      for (const statement of file.statements) {
        if (statement instanceof ast.Import) {
          await this.resolveImport(statement);
        }
      }
      for (const statement of file.statements) {
        statement.accept(this);
        if (statement instanceof ast.ClassDefinition ||
          statement instanceof ast.InterfaceDefinition) {
          const variable = this.scope[statement.identifier.name];
          if (variable) {
            if (variable.value instanceof Type) {
              this.moduleType.addMemberType(statement.identifier.name, variable.value);
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
              null,
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
              statement.value instanceof ast.FunctionDisplay) {
              this.moduleType.addMethod(new Method(
                variable.identifier,
                variable.type,
                null,
                variable.comment || null
              ));
            }
          }
        }
      }
    });
  }

  private async openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | null> {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (e) {
      return null;
    }
  }

  private async getImportVariable(uri: vscode.Uri): Promise<ExplicitVariable> {
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
    annotator.annotateFile(fileNode);
    return annotator.moduleVariable;
  }

  private async resolveImport(n: ast.Import) {
    const rawPath = n.path.value;
    if (!rawPath.startsWith('./')) {
      this.errors.push({
        location: n.path.location,
        message: `Import paths must start with './'`,
      });
      return Continues;
    }
    const importURI = vscode.Uri.from({
      authority: this.uri.authority,
      fragment: this.uri.fragment,
      path: getParentPath(this.uri.path) + rawPath.substring(1),
      query: this.uri.query,
      scheme: this.uri.scheme,
    });
    const moduleVariable = await this.getImportVariable(importURI);

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

  private interfaceScoped<R>(f: () => R): R {
    const save = this.insideInterface;
    this.insideInterface = true;
    try {
      return f();
    } finally {
      this.insideInterface = save;
    }
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
  visitVariable(n: ast.Variable): ValueInfo {
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
      for (let i = 0; i < n.parameters.length; i++) {
        const identifier = n.parameters[i].identifier;
        const variable: Variable = { identifier, type: parameterTypes[i] };
        this.variables.push(variable);
        this.references.push({ identifier, variable });
        this.scope[identifier.name] = variable;
      }
      const status = n.body.accept(this);
      if (!this.insideInterface && status !== Jumps && !NilType.isAssignableTo(returnType)) {
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
    method: Value | undefined, owner: ValueInfo, args: ValueInfo[]): Value | undefined {
    if (owner.value && method instanceof Method && method?.body &&
      args.length === method.type.parameterTypes.length &&
      args.every((arg, i) =>
        arg.value !== undefined &&
        arg.type.isAssignableTo(method.type.parameterTypes[i]))) {
      return method.body(owner.value, args.map(arg => arg.value as Value));
    }
    return undefined;
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
      return { type: owner.type.returnType, value: this.applyPure(method, owner, args) };
    }
    this.completionPoints.push({
      range: n.identifier.location.range,
      getCompletions(): Completion[] {
        const completions: Completion[] = [];
        for (const method of owner.type.getMethods()) {
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
    return { type: method.type.returnType, value: this.applyPure(method, owner, args) };
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
    const comment = n.comment || getCommentFromFunctionDisplay(n.value);
    const variable = this.scope[n.identifier.name] = {
      isMutable: n.isMutable,
      identifier: n.identifier,
      type: explicitType || value.type,
      value: value.value,
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
  visitClassDefinition(n: ast.ClassDefinition): RunStatus {
    const cls = new ClassType(n.identifier);
    const comment = (n.statements.length > 0 &&
      n.statements[0] instanceof ast.ExpressionStatement &&
      n.statements[0].expression instanceof ast.StringLiteral) ?
      n.statements[0].expression : undefined;
    const variable = this.scope[cls.identifier.name] = {
      identifier: n.identifier,
      type: AnyType,
      value: cls,
      comment,
    };
    this.variables.push(variable);
    this.references.push({ identifier: n.identifier, variable });
    this.classScoped(n.identifier.location, cls, () => {
      for (const statement of n.statements) {
        if (statement instanceof ast.ExpressionStatement) {
          if (statement.expression instanceof ast.StringLiteral) {
            continue; // comments
          }
        } else if (statement instanceof ast.Declaration) {
          if (statement.value instanceof ast.FunctionDisplay) {
            // method
            const functionDisplay = statement.value;
            const { type: funcType } = this.solve(functionDisplay);
            if (!(funcType instanceof FunctionType)) {
              continue;
            }
            const method = new Method(statement.identifier, funcType, null,
              getCommentFromFunctionDisplay(functionDisplay));
            cls.addMethod(method);
            this.variables.push(method);
            this.references.push({ identifier: statement.identifier, variable: method });
            continue;
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
            cls.addField(field);
            this.variables.push(field);
            this.references.push({ identifier: statement.identifier, variable: field });

            // synthesized field methods
            const getType = FunctionType.of([], fieldType);
            const name = statement.identifier.name;
            const getIdent = new ast.Variable(statement.identifier.location, `get_${name}`);
            const getMethod = new Method(
              getIdent, getType,
              (recv) => (recv as Instance).getField(statement.identifier.name),
              comment);
            cls.addMethod(getMethod);
            this.variables.push(getMethod);
            this.references.push({ identifier: statement.identifier, variable: getMethod });
            if (statement.isMutable) {
              const setType = FunctionType.of([fieldType], NilType);
              const setIdent = new ast.Variable(statement.identifier.location, `set_${name}`);
              const setMethod = new Method(setIdent, setType, null);
              cls.addMethod(setMethod);
              this.variables.push(setMethod);
              this.references.push({ identifier: statement.identifier, variable: setMethod });
            }

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
    const iface = new InterfaceType(n.identifier);
    const comment = (n.statements.length > 0 &&
      n.statements[0] instanceof ast.ExpressionStatement &&
      n.statements[0].expression instanceof ast.StringLiteral) ?
      n.statements[0].expression : undefined;
    const variable = this.scope[iface.identifier.name] = {
      identifier: n.identifier,
      type: AnyType,
      value: iface,
      comment,
    };
    this.variables.push(variable);
    this.references.push({ identifier: n.identifier, variable });
    this.interfaceScoped(() => {
      for (const statement of n.statements) {
        if (statement instanceof ast.ExpressionStatement) {
          if (statement.expression instanceof ast.StringLiteral) {
            continue; // comments
          }
        } else if (statement instanceof ast.Declaration) {
          if (statement.value instanceof ast.FunctionDisplay) {
            // interface method
            if (statement.value.body.statements.some(s =>
              !(s instanceof ast.ExpressionStatement &&
                s.expression instanceof ast.StringLiteral))) {
              this.errors.push({
                location: statement.value.body.location,
                message: `Interface methods cannot have bodies`,
              });
            }
            const { type: funcType } = this.solve(statement.value);
            if (!(funcType instanceof FunctionType)) {
              continue;
            }
            const method = new Method(statement.identifier, funcType, null,
              getCommentFromFunctionDisplay(statement.value));
            iface.addMethod(method);
            this.variables.push(method);
            this.references.push({ identifier: statement.identifier, variable: method });
            continue;
          } else if (statement.value === null) {
            // field
            const ident = statement.identifier;
            const type = statement.type ? this.solveType(statement.type) : AnyType;
            const getIdent = new ast.Variable(ident.location, `get_${ident.name}`);
            const getType = FunctionType.of([], type);
            const getMethod = new Method(getIdent, getType, null);
            iface.addMethod(getMethod);
            this.variables.push(getMethod);
            this.references.push({ identifier: ident, variable: getMethod });
            if (statement.isMutable) {
              const setIdent = new ast.Variable(ident.location, `set_${ident.name}`);
              const setType = FunctionType.of([type], NilType);
              const setMethod = new Method(setIdent, setType, null);
              iface.addMethod(setMethod);
              this.variables.push(setMethod);
              this.references.push({ identifier: ident, variable: setMethod });
            }
            continue;
          }
        }
        this.errors.push({
          location: statement.location,
          message: `Unsupported statement in interface body`,
        });
      }
    });
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
