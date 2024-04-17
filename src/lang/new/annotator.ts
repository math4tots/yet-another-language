import * as vscode from 'vscode';
import * as ast from '../ast';
import { Position, Range } from '../lexer';
import {
  AnyType,
  BoolType,
  ClassType,
  ClassTypeType,
  InterfaceType,
  InterfaceTypeType,
  LambdaType,
  ModuleType,
  NeverType,
  NilType,
  NumberType,
  Parameter,
  StringType,
  Type,
  newClassTypeType,
  newFunctionType,
  newInterfaceTypeType,
  newLambdaType,
  newModuleType,
} from './type';
import { getAstForDocument } from '../parser';
import { resolveURI } from '../paths';
import { translateVariableName } from './translator';


type Value = null | boolean | number | string | Value[] | ModuleValue;


function newModuleValue(annotation: Annotation) {
  const value = Object.create(null);
  Object.defineProperties(value, {
    toString: {}
  });
  return value;
}

export class ModuleValue {
  constructor(annotation: Annotation) {
    for (const variable of annotation.moduleVariableMap.values()) {
      if (!variable.isMutable && variable.value !== undefined) {
        Object.defineProperty(this, translateVariableName(variable.identifier.name), {
          value: variable.value,
          enumerable: true,
          writable: false,
        });
      }
    }
  }
  toString() { return '<module>'; }
}


export type ValueInfo = { readonly type: Type; readonly value?: Value; };

export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

export type Variable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly comment?: ast.StringLiteral;
  readonly value?: Value;
};

export type ModuleVariable = Variable & {
  readonly type: ModuleType;
};

export type ClassVariable = Variable & {
  readonly type: ClassTypeType;
};

export type InterfaceVariable = Variable & {
  readonly type: InterfaceTypeType;
};

export type Reference = {
  readonly range: Range;
  readonly variable: Variable;
};

export interface PrintInstance {
  readonly range: Range;
  readonly value: Value;
}

export interface CallInstance {
  readonly range: Range; // range of entire call
  readonly args: Range[]; // range of individual arguments
  readonly parameters: Parameter[];
}

export type Scope = { [key: string]: Variable; };

const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyType };
BASE_SCOPE['Never'] =
  { identifier: NeverType.identifier, type: NeverType };
BASE_SCOPE['Nil'] =
  { identifier: NilType.identifier, type: AnyType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: AnyType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: AnyType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: AnyType };

const printFunction = (function print(x: any) { console.log('' + x); return null; }) as any;

// Dummy 'print' function
BASE_SCOPE['print'] = {
  identifier: { name: 'print' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: printFunction,
};

export type AnnotationError = ast.ParseError;

export interface Completion {
  readonly name: string;
  readonly detail?: string;
}

export interface CompletionPoint {
  readonly range: Range;
  getCompletions(): Completion[];
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

function getCommentFromClassDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.ClassDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}

function getCommentFromInterfaceDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.InterfaceDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}

export type Annotation = {
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly errors: AnnotationError[];
  readonly variables: Variable[];
  readonly references: Reference[];
  readonly completionPoints: CompletionPoint[];
  readonly printInstances: PrintInstance[];
  readonly callInstances: CallInstance[];
  readonly moduleVariableMap: Map<string, Variable>;
  readonly importMap: Map<string, Annotation>;
};

type AnnotatorParameters = {
  readonly annotation: Annotation;
  readonly stack: Set<string>; // for detecting recursion
  readonly cached?: Annotation;
};

class Annotator implements ast.ExpressionVisitor<ValueInfo>, ast.StatementVisitor<RunStatus> {
  readonly annotation: Annotation;
  private readonly stack: Set<string>; // for detecting recursion

  private currentReturnType: Type | null = null;
  private hint: Type = AnyType;
  private scope: Scope = Object.create(BASE_SCOPE);
  private readonly cached?: Annotation;
  private readonly typeSolverCache = new Map<ast.TypeExpression, Type>();
  private readonly lambdaTypeCache = new Map<ast.FunctionDisplay, LambdaType>();
  private readonly markedImports = new Set<ast.Import>();
  private readonly classMap = new Map<ast.ClassDefinition, ClassVariable>();
  private readonly interfaceMap = new Map<ast.InterfaceDefinition, InterfaceVariable>();

  constructor(params: AnnotatorParameters) {
    this.annotation = params.annotation;
    this.stack = params.stack;
    this.cached = params.cached;
  }

  private error(location: ast.Location, message: string) {
    this.annotation.errors.push({ location, message });
  }

  private scoped<R>(f: () => R): R {
    const outerScope = this.scope;
    this.scope = Object.create(outerScope);
    try {
      return f();
    } finally {
      this.scope = outerScope;
    }
  }

  private _solveType(e: ast.TypeExpression): Type {
    // class or interface from an imported module
    if (e.qualifier) {
      const parent = this.scope[e.qualifier.name];
      if (!parent) {
        this.error(e.qualifier.location, `${e.qualifier.name} not found`);
        return AnyType;
      }
      this.markReference(parent, e.qualifier.location.range);
      const moduleTypeData = parent.type.moduleTypeData;
      if (!moduleTypeData) {
        this.error(e.qualifier.location, `${e.qualifier.name} is not a module`);
        return AnyType;
      }

      // completion based on member of module
      this.annotation.completionPoints.push({
        range: e.identifier.location.range,
        getCompletions() {
          return Array.from(moduleTypeData.annotation.moduleVariableMap.values())
            .filter(v => v.type.classTypeTypeData || v.type.interfaceTypeTypeData)
            .map(v => ({ name: v.identifier.name }));
        },
      });

      const variable = moduleTypeData.annotation.moduleVariableMap.get(e.identifier.name);
      if (!variable) {
        this.error(e.identifier.location, `Type ${e.identifier.name} not found in module`);
        return AnyType;
      }

      this.markReference(variable, e.identifier.location.range);
      const type = variable.type.classTypeTypeData?.classType ||
        variable.type.interfaceTypeTypeData?.interfaceType;
      if (!type) {
        this.error(e.identifier.location, `${e.identifier.name} is not a class or interface`);
        return AnyType;
      }
      return type;
    }

    // autocomplete for typenames without a qualifier
    const scopeAtLocation = this.scope;
    this.annotation.completionPoints.push({
      range: e.identifier.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scopeAtLocation) {
          const variable = scopeAtLocation[key];
          const type = variable.type;
          if (type.classTypeTypeData || type.interfaceTypeTypeData || type.moduleTypeData) {
            completions.push({ name: key });
          }
        }
        // Provide completions for builtin generic types
        completions.push({ name: 'Any' });
        completions.push({ name: 'Never' });
        completions.push({ name: 'Nil' });
        completions.push({ name: 'Bool' });
        completions.push({ name: 'Number' });
        completions.push({ name: 'String' });
        completions.push({ name: 'List' });
        completions.push({ name: 'Function' });
        return completions;
      },
    });

    // builtin types
    if (e.args.length === 0) {
      switch (e.identifier.name) {
        case 'Any': return AnyType;
        case 'Never': return NeverType;
        case 'Nil': return NilType;
        case 'Bool': return BoolType;
        case 'Number': return NumberType;
        case 'String': return StringType;
      }
    }
    if (e.args.length === 1 && e.identifier.name === 'List') {
      return this.solveType(e.args[0]).list();
    }
    if (e.args.length > 0 && e.identifier.name === 'Function') {
      const argTypes = e.args.map(arg => this.solveType(arg));
      const parameterTypes = argTypes.slice(0, argTypes.length - 1);
      const returnType = argTypes[argTypes.length - 1];
      return newFunctionType(parameterTypes, returnType);
    }

    // locally declared class or interface
    const variable = this.scope[e.identifier.name];
    if (!variable) {
      this.error(e.identifier.location, `Type ${e.identifier.name} not found`);
      return AnyType;
    }
    this.markReference(variable, e.identifier.location.range);
    const type = variable.type.classTypeTypeData?.classType ||
      variable.type.interfaceTypeTypeData?.interfaceType;
    if (!type) {
      this.error(e.identifier.location, `${e.identifier.name} is not a class or interface`);
      return AnyType;
    }
    return type;
  }

  private solveType(e: ast.TypeExpression): Type {
    const cached = this.typeSolverCache.get(e);
    if (cached) return cached;
    const type = this._solveType(e);
    this.typeSolverCache.set(e, type);
    return type;
  }

  private solveExpr(e: ast.Expression, hint: Type = AnyType, required: boolean = true): ValueInfo {
    const oldHint = this.hint;
    this.hint = hint;
    const info = e.accept(this);
    if (required && !info.type.isAssignableTo(hint)) {
      this.error(e.location, `Expected expression of type ${hint} but got expression of type ${info.type}`);
    }
    this.hint = oldHint;
    return info;
  }

  private solveStmt(s: ast.Statement): RunStatus {
    return s.accept(this);
  }

  private declareVariable(variable: Variable, addToScope = true) {
    this.annotation.variables.push(variable);
    if (addToScope) {
      this.scope[variable.identifier.name] = variable;
    }
    const range = variable.identifier.location?.range;
    if (range) this.markReference(variable, range);
  }

  private markReference(variable: Variable, range: Range) {
    this.annotation.references.push({ variable, range });
  }

  async handle(n: ast.File): Promise<{ useCached: boolean; }> {
    // resolve imports
    const srcURI = n.location.uri;
    let canUseCached = n.documentVersion === this.cached?.documentVersion;
    for (const statement of n.statements) {
      if (statement instanceof ast.Import) {
        this.markedImports.add(statement);
        const { location, path, identifier } = statement;
        const { uri, error: errMsg } = await resolveURI(srcURI, path.value);
        const uriString = uri.toString();
        if (errMsg) {
          this.error(location, errMsg);
          continue;
        }
        if (this.stack.has(uriString)) {
          this.error(location, `Recursive import`);
          continue;
        }

        const cachedImportModuleAnnotation = this.cached?.importMap.get(uriString);
        const importModuleAnnotation =
          this.annotation.importMap.get(uriString) ||
          await getAnnotationForURI(uri, this.stack);
        this.annotation.importMap.set(uriString, importModuleAnnotation);
        if (cachedImportModuleAnnotation !== importModuleAnnotation) {
          canUseCached = false;
        }
        if (importModuleAnnotation.errors.length > 0) {
          if (importModuleAnnotation.errors.some(e => e.message === 'Recursive import')) {
            this.error(location, `Recursive import`);
          } else {
            this.error(location, `Module has errors`);
          }
        }
        const importModuleType = newModuleType(importModuleAnnotation);
        const importModuleVariable = getModuleVariableForModuleType(importModuleType);
        const aliasVariable: Variable = {
          identifier,
          type: importModuleType,
          value: importModuleVariable.value,
        };
        this.declareVariable(aliasVariable);
        this.markReference(importModuleVariable, path.location.range);
      } else if (statement instanceof ast.ExpressionStatement &&
        statement.expression instanceof ast.StringLiteral) {
        // String literals at the top may be ignored
      } else {
        // However, if we see any other kind of statement, we don't process any
        // further imports.
        break;
      }
    }

    if (canUseCached) {
      return { useCached: true };
    }

    this.forwardDeclare(n.statements);
    for (const statement of n.statements) {
      this.solveStmt(statement);
    }

    // We collect module variables to determine which ones should
    for (const key of Object.getOwnPropertyNames(this.scope)) {
      this.annotation.moduleVariableMap.set(key, this.scope[key]);
    }

    return { useCached: false };
  }

  private addMethodsAndFields(type: ClassType | InterfaceType, bodyStatements: ast.Statement[]) {
    const fields = type.classTypeData?.fields;
    for (const declaration of bodyStatements) {
      if (declaration instanceof ast.Declaration) {
        const value = declaration.value;
        if (!declaration.isMutable && value instanceof ast.FunctionDisplay) {
          // normal method definition
          const funcdisp = value;
          const funcdispType = this.solveFunctionDisplayType(funcdisp);
          const variable: Variable = {
            identifier: declaration.identifier,
            type: funcdispType,
            comment: declaration.comment || getCommentFromFunctionDisplay(funcdisp),
          };
          this.declareVariable(variable, false);
          type.addMethod({
            identifier: declaration.identifier,
            parameters: funcdispType.lambdaTypeData.parameters,
            returnType: funcdispType.lambdaTypeData.returnType,
            functionType: funcdispType.lambdaTypeData.functionType,
            sourceVariable: variable,
          });
        } else if (declaration.type) {
          // field/property
          const variable: Variable = {
            isMutable: declaration.isMutable,
            identifier: declaration.identifier,
            type: this.solveType(declaration.type),
            comment: declaration.comment || undefined,
          };
          fields?.push(variable);
          this.declareVariable(variable, false);
          type.addMethod({
            identifier: { name: `__get_${declaration.identifier.name}` },
            parameters: [],
            returnType: variable.type,
            sourceVariable: variable,
          });
          if (declaration.isMutable) {
            type.addMethod({
              identifier: { name: `__set_${declaration.identifier.name}` },
              parameters: [{ identifier: { name: 'value' }, type: variable.type }],
              returnType: variable.type,
              sourceVariable: variable,
            });
          }
        } else {
          this.error(declaration.location, `Invalid class member declaration`);
        }
      }
    }
  }

  private forwardDeclare(statements: ast.Statement[]) {
    // forward declare classes
    for (const defn of statements) {
      if (defn instanceof ast.ClassDefinition) {
        const variable: ClassVariable = {
          identifier: defn.identifier,
          type: newClassTypeType(defn.identifier),
          comment: getCommentFromClassDefinition(defn),
        };
        this.classMap.set(defn, variable);
        this.declareVariable(variable);
      } else if (defn instanceof ast.InterfaceDefinition) {
        const variable: InterfaceVariable = {
          identifier: defn.identifier,
          type: newInterfaceTypeType(defn.identifier),
          comment: getCommentFromInterfaceDefinition(defn),
        };
        this.interfaceMap.set(defn, variable);
        this.declareVariable(variable);
      }
    }

    // forward declare methods
    for (const defn of statements) {
      if (defn instanceof ast.ClassDefinition) {
        const classTypeType = this.classMap.get(defn);
        if (!classTypeType) throw new Error(`FUBAR class ${classTypeType}`);
        const classType = classTypeType.type.classTypeTypeData.classType;
        this.addMethodsAndFields(classType, defn.statements);
      } else if (defn instanceof ast.InterfaceDefinition) {
        const interfaceTypeType = this.interfaceMap.get(defn);
        if (!interfaceTypeType) throw new Error(`FUBAR interface ${interfaceTypeType}`);
        const interfaceType = interfaceTypeType.type.interfaceTypeTypeData.interfaceType;
        this.addMethodsAndFields(interfaceType, defn.statements);
      }
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
    this.annotation.completionPoints.push({
      range: n.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scope) {
          completions.push({ name: key });
        }
        // additionally, provide provide completions for constants and keywords
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
      this.error(n.location, `Variable ${JSON.stringify(n.name)} not found`);
      return { type: AnyType };
    }
    this.markReference(variable, n.location.range);
    return { type: variable.type, value: variable.value };
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    const rhs = this.solveExpr(n.value);
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
  visitListDisplay(n: ast.ListDisplay): ValueInfo {
    const startErrorCount = this.annotation.errors.length;
    const givenItemType = this.hint.listItemType;
    if (givenItemType) {
      for (const element of n.values) {
        this.solveExpr(element, givenItemType);
      }
      return { type: givenItemType.list() };
    }
    if (n.values.length === 0) return { type: AnyType };
    let itemType: Type = NeverType;
    let values: Value[] | undefined = [];
    for (const element of n.values) {
      const elementInfo = this.solveExpr(element, itemType, false);
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
  visitFunctionDisplay(n: ast.FunctionDisplay): ValueInfo {
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
        const result = this.solveStmt(n.body);
        if (result !== Jumps && !NilType.isAssignableTo(returnType)) {
          this.error(
            n.location, `This function cannot return nil and this function might not return`);
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

  visitMethodCall(n: ast.MethodCall): ValueInfo {
    const startErrorCount = this.annotation.errors.length;
    const owner = this.solveExpr(n.owner);
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
      for (const arg of n.args) this.solveExpr(arg);
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
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `Expected ${method.parameters.length} args but got ${n.args.length}`);
      return { type: method.returnType };
    }
    const argValues: Value[] = [];
    for (let i = 0; i < method.parameters.length; i++) {
      const info = this.solveExpr(n.args[i], method.parameters[i].type);
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
  visitNew(n: ast.New): ValueInfo {
    const type = this.solveType(n.type);
    const fields = type.classTypeData?.fields;
    if (!fields) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `${type} is not new-constructible`);
      return { type: AnyType };
    }
    this.annotation.callInstances.push({
      range: n.location.range,
      args: n.args.map(arg => arg.location.range),
      parameters: fields,
    });
    if (fields.length !== n.args.length) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `${type} requires ${fields.length} args but got ${n.args.length}`);
      return { type };
    }
    for (let i = 0; i < fields.length; i++) {
      this.solveExpr(n.args[i], fields[i].type);
    }
    return { type };
  }
  visitLogicalNot(n: ast.LogicalNot): ValueInfo {
    const { value } = this.solveExpr(n.value);
    return { type: BoolType, value: value === undefined ? undefined : !value };
  }
  visitLogicalAnd(n: ast.LogicalAnd): ValueInfo {
    const { value: lhs } = this.solveExpr(n.lhs);
    const { value: rhs } = this.solveExpr(n.rhs);
    return { type: BoolType, value: (lhs !== undefined && !lhs) ? lhs : rhs };
  }
  visitLogicalOr(n: ast.LogicalOr): ValueInfo {
    const { value: lhs } = this.solveExpr(n.lhs);
    const { value: rhs } = this.solveExpr(n.rhs);
    return { type: BoolType, value: (lhs !== undefined && lhs) ? lhs : rhs };
  }
  visitConditional(n: ast.Conditional): ValueInfo {
    const condition = this.solveExpr(n.condition);
    const lhs = this.solveExpr(n.lhs);
    const rhs = this.solveExpr(n.rhs);
    const value = condition.value === undefined ?
      undefined :
      condition.value ? lhs.value : rhs.value;
    return { type: lhs.type.getCommonType(rhs.type), value };
  }
  visitTypeAssertion(n: ast.TypeAssertion): ValueInfo {
    this.solveExpr(n.value);
    const type = this.solveType(n.type);
    return { type };
  }
  visitNativeExpression(n: ast.NativeExpression): ValueInfo {
    return { type: AnyType };
  }
  visitNativePureFunction(n: ast.NativePureFunction): ValueInfo {
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
  visitEmptyStatement(n: ast.EmptyStatement): RunStatus {
    return Continues;
  }
  visitExpressionStatement(n: ast.ExpressionStatement): RunStatus {
    this.solveExpr(n.expression);
    return Continues;
  }
  visitBlock(n: ast.Block): RunStatus {
    return this.scoped(() => {
      this.forwardDeclare(n.statements);
      let status: RunStatus = Continues;
      for (const stmt of n.statements) {
        const stat = this.solveStmt(stmt);
        if (stat === Jumps) status = Jumps;
        else if (stat === MaybeJumps && status !== Jumps) status = MaybeJumps;
      }
      return status;
    });
  }
  visitDeclaration(n: ast.Declaration): RunStatus {
    const explicitType = n.type ? this.solveType(n.type) : null;
    const valueInfo = n.value ? this.solveExpr(n.value, explicitType || AnyType) : null;
    if (!explicitType && !valueInfo) {
      this.error(n.location, `At least one of value or type of the variable must be specified`);
      return Continues;
    }
    const type = explicitType || valueInfo?.type || AnyType;
    const variable: Variable = {
      isMutable: n.isMutable,
      identifier: n.identifier,
      type,
      comment: n.comment ||
        (n.value instanceof ast.FunctionDisplay ? getCommentFromFunctionDisplay(n.value) : undefined),
      value: n.isMutable ? undefined : valueInfo?.value,
    };
    this.declareVariable(variable);
    return Continues;
  }
  visitIf(n: ast.If): RunStatus {
    this.solveExpr(n.condition);
    const lhs = this.solveStmt(n.lhs);
    const rhs = n.rhs ? this.solveStmt(n.rhs) : Continues;
    return (lhs === Jumps && rhs === Jumps) ? Jumps :
      (lhs === Jumps || lhs === MaybeJumps || rhs === Jumps || rhs === MaybeJumps) ? MaybeJumps :
        Continues;
  }
  visitWhile(n: ast.While): RunStatus {
    this.solveExpr(n.condition);
    this.solveStmt(n.body);
    return MaybeJumps;
  }
  visitReturn(n: ast.Return): RunStatus {
    const returnType = this.currentReturnType;
    if (returnType) {
      this.solveExpr(n.value, returnType);
    } else {
      this.solveExpr(n.value);
      this.error(n.location, `return cannot appear outside a function`);
    }
    return Jumps;
  }
  visitClassDefinition(n: ast.ClassDefinition): RunStatus {
    // a lot is already handled by `forwardDeclare`
    const classTypeType = this.classMap.get(n);
    if (!classTypeType) throw new Error(`FUBAR class ${classTypeType}`);
    const classType = classTypeType.type.classTypeTypeData.classType;
    this.scoped(() => {
      const thisVariable: Variable = {
        identifier: { name: 'this', location: n.identifier.location },
        type: classType,
      };
      this.scope['this'] = thisVariable;
      for (const statement of n.statements) {
        if (statement instanceof ast.ExpressionStatement) {
          if (statement.expression instanceof ast.StringLiteral) {
            // comments
            continue;
          }
        } else if (statement instanceof ast.Declaration) {
          if (!statement.isMutable && statement.value instanceof ast.FunctionDisplay) {
            // methods
            this.solveExpr(statement.value);
          } else if (statement.type) {
            // fields
          }
          continue;
        }
        this.error(statement.location, `Unexpected statement in class body`);
      }
    });
    return Continues;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): RunStatus {
    // almost everything for interfaces is handled in `forwardDeclare`
    for (const statement of n.statements) {
      if (statement instanceof ast.ExpressionStatement) {
        if (statement.expression instanceof ast.StringLiteral) {
          // comments
          continue;
        }
      } else if (statement instanceof ast.Declaration) {
        // methods and properties
        continue;
      }
      this.error(statement.location, `Unexpected statement in interface body`);
    }
    return Continues;
  }
  visitImport(n: ast.Import): RunStatus {
    if (!this.markedImports.has(n)) {
      this.error(n.location, `Import statement is not allowed here`);
    }
    return MaybeJumps;
  }
}

const diagnostics = vscode.languages.createDiagnosticCollection('yal');

export async function getAnnotationForURI(uri: vscode.Uri, stack = new Set<string>()): Promise<Annotation> {
  return await getAnnotationForDocument(await vscode.workspace.openTextDocument(uri), stack);
}

function toVSPosition(p: Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

const annotationCache = new Map<string, Annotation>();

export async function getAnnotationForDocument(
  document: vscode.TextDocument,
  stack = new Set<string>()
): Promise<Annotation> {
  const uri = document.uri;
  const key = uri.toString();
  const cached = annotationCache.get(key);
  const fileNode = await getAstForDocument(document);
  const annotation: Annotation = {
    uri,
    documentVersion: document.version,
    errors: [...fileNode.errors],
    variables: [],
    references: [],
    completionPoints: [],
    printInstances: [],
    callInstances: [],
    moduleVariableMap: new Map(),
    importMap: new Map(),
  };
  const annotator = new Annotator({ annotation, stack, cached });
  stack.add(key);
  const { useCached } = await annotator.handle(fileNode);
  stack.delete(key);
  // console.log(`DEBUG getAnnotationForDocument ${key} ${useCached ? '(cached)' : ''}`);
  if (cached && useCached) {
    return cached;
  }
  diagnostics.set(uri, annotation.errors.map(e => ({
    message: e.message,
    range: toVSRange(e.location.range),
    severity: vscode.DiagnosticSeverity.Warning,
  })));
  annotationCache.set(key, annotation);
  return annotation;
}

const moduleVariableMap = new WeakMap<ModuleType, ModuleVariable>();

function getModuleVariableForModuleType(moduleType: ModuleType): ModuleVariable {
  const cached = moduleVariableMap.get(moduleType);
  if (cached) return cached;
  const variable: ModuleVariable = {
    identifier: moduleType.identifier,
    type: moduleType,
    value: new ModuleValue(moduleType.moduleTypeData.annotation),
  };
  moduleVariableMap.set(moduleType, variable);
  return variable;
}

export function reprStaticValue(x: any): string {
  if (typeof x === 'function') return x.name ? `<function ${x.name}>` : '<function>';
  if (x instanceof ModuleValue) return '<module>';
  return JSON.stringify(x);
}

export function strStaticValue(x: any): string {
  return typeof x === 'string' ? x : reprStaticValue(x);
}

function evalMethodCall(owner: any, methodName: string, args: any[]): Value | undefined {
  if (owner === printFunction) return;
  if (methodName === '__eq__' && args.length === 1) return owner === args[0];
  if (methodName === '__ne__' && args.length === 1) return owner !== args[0];
  switch (typeof owner) {
    case 'number':
      if (args.length === 0) {
        switch (methodName) {
          case '__pos__': return owner;
          case '__neg__': return -owner;
        }
      } else if (args.length === 1) {
        const arg0 = args[0];
        if (typeof arg0 === 'number') {
          switch (methodName) {
            case '__add__': return owner + arg0;
            case '__sub__': return owner - arg0;
            case '__mul__': return owner * arg0;
            case '__div__': return owner / arg0;
            case '__mod__': return owner % arg0;
            case '__lt__': return owner < arg0;
            case '__gt__': return owner > arg0;
            case '__le__': return owner <= arg0;
            case '__ge__': return owner >= arg0;
          }
        }
      }
      break;
    case 'string':
      if (args.length === 0) {
        if (methodName === '__get___size') return owner.length;
      } else if (args.length === 1) {
        const arg0 = args[0];
        if (typeof arg0 === 'string') {
          switch (methodName) {
            case '__lt__': return owner < arg0;
            case '__gt__': return owner > arg0;
            case '__le__': return owner <= arg0;
            case '__ge__': return owner >= arg0;
          }
        }
      }
      break;
    case 'object':
      if (Array.isArray(owner)) {
        if (args.length === 0) {
          if (methodName === '__get___size') return owner.length;
        } else if (args.length === 1) {
          const arg0 = args[0];
          if (typeof arg0 === 'number' && methodName === '__getitem__') {
            return owner[arg0];
          }
        }
      } else if (owner instanceof ModuleValue) {
        if (methodName.startsWith('__get_')) {
          const fieldName = methodName.substring('__get_'.length);
          const modifiedFieldName = translateVariableName(fieldName);
          if ((owner as any)[modifiedFieldName]) return (owner as any)[modifiedFieldName];
        } else if (methodName.startsWith('__set_')) {
          // setters... ignore
        } else {
          const modifiedMethodName = translateVariableName(methodName);
          if ((owner as any)[modifiedMethodName]) return (owner as any)[modifiedMethodName](...args);
        }
      } else {
        // Some other kind of object
      }
      break;
    case 'function':
      if (methodName === '__call__') return owner(...args);
      break;
  }
  return;
}
