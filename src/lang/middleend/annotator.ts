import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import {
  getCommentFromFunctionDisplay,
  getCommentFromClassDefinition,
  getCommentFromInterfaceDefinition,
} from '../frontend/ast-utils';
import { toVSRange } from '../frontend/bridge-utils';
import { getAstForDocument } from '../frontend/parser';
import { Range } from '../frontend/lexer';
import { resolveURI } from './paths';
import {
  AnyType,
  NeverType,
  NilType,
  BoolType,
  NumberType,
  StringType,
  LambdaType,
  Parameter,
  Type,
  newFunctionType,
  newLambdaType,
  newModuleType,
  ClassType,
  InterfaceType,
  newClassTypeType,
  newInterfaceTypeType,
  ModuleType,
} from './type';
import {
  Annotation,
  Completion,
  Variable,
  ClassVariable,
  InterfaceVariable,
  ModuleVariable,
  AnnotationWithoutIR,
} from './annotation';
import { Scope, BASE_SCOPE } from './scope';
import { ModuleValue, Value, evalMethodCall } from './value';
import { printFunction } from './functions';

type AnnotatorParameters = {
  readonly annotation: AnnotationWithoutIR;
  readonly stack: Set<string>; // for detecting recursion
  readonly cached?: Annotation;
};

/** Result of annotating an expression */
type EResult = {
  readonly type: Type;
  readonly value?: Value;

  /**
   * Intermediate Representation
   * A modified version of the AST better suited for code generation
   */
  readonly ir: ast.Expression;
};

const Continues = Symbol('Continues');
const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
const MaybeJumps = Symbol('MaybeJumps');
type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

/** Result of annotating a statement */
type SResult = {
  readonly status: RunStatus;

  /**
   * Intermediate Representation
   * A modified version of the AST better suited for code generation
   */
  readonly ir: ast.Statement;
};

type BResult = SResult & { readonly ir: ast.Block; };

/** Result of annotating a file */
type FResult = {
  readonly useCached: boolean;
  readonly ir: ast.File;
};

type InterfacetMethodBodyContents = {
  readonly aliasFor?: ast.Identifier;
};

class Annotator implements ast.ExpressionVisitor<EResult>, ast.StatementVisitor<SResult> {
  readonly annotation: AnnotationWithoutIR;
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

  private solveExpr(e: ast.Expression, hint: Type = AnyType, required: boolean = true): EResult {
    const oldHint = this.hint;
    this.hint = hint;
    const info = e.accept(this);
    if (required && !info.type.isAssignableTo(hint)) {
      this.error(e.location, `Expected expression of type ${hint} but got expression of type ${info.type}`);
    }
    this.hint = oldHint;
    return info;
  }

  private solveStmt(s: ast.Statement): SResult {
    return s.accept(this);
  }

  private solveBlock(b: ast.Block): BResult {
    const result = this.solveStmt(b);
    if (result.ir instanceof ast.Block) return { ...result, ir: result.ir };
    if (result.ir instanceof ast.EmptyStatement) return { ...result, ir: new ast.Block(result.ir.location, []) };
    return { ...result, ir: new ast.Block(result.ir.location, [result.ir]) };
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

  async handle(n: ast.File): Promise<FResult> {
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
        const aliasVariable: ModuleVariable = {
          identifier,
          type: importModuleType,
          value: importModuleVariable.value,
        };
        this.annotation.importAliasVariables.push(aliasVariable);
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
      return { useCached: true, ir: n };
    }

    this.forwardDeclare(n.statements);
    const irs: ast.Statement[] = [];
    for (const statement of n.statements) {
      const result = this.solveStmt(statement);
      if (!(result.ir instanceof ast.EmptyStatement)) irs.push(result.ir);
    }

    // We collect module variables to determine which ones should
    for (const key of Object.getOwnPropertyNames(this.scope)) {
      this.annotation.moduleVariableMap.set(key, this.scope[key]);
    }

    return { useCached: false, ir: new ast.File(n.location, n.documentVersion, irs, n.errors) };
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

          // If this is an interface method, its body may contain additional information
          // about the method, like whether it is an alias method.
          let aliasFor: string | undefined;
          if (type.interfaceTypeData) {
            const interfacetMethodBodyContents = this.inspectInterfaceMethodBody(value);
            aliasFor = interfacetMethodBodyContents.aliasFor?.name;
          }

          type.addMethod({
            identifier: declaration.identifier,
            parameters: funcdispType.lambdaTypeData.parameters,
            returnType: funcdispType.lambdaTypeData.returnType,
            functionType: funcdispType.lambdaTypeData.functionType,
            sourceVariable: variable,
            aliasFor,
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

  private inspectInterfaceMethodBody(fd: ast.FunctionDisplay): InterfacetMethodBodyContents {
    let aliasFor: ast.Identifier | undefined;
    for (const stmt of fd.body.statements) {
      if (stmt instanceof ast.ExpressionStatement) {
        const expr = stmt.expression;
        if (expr instanceof ast.StringLiteral) {
          continue; // comments
        }
        if (expr instanceof ast.MethodCall && expr.identifier.name === '__call__' && expr.args.length === 1) {
          const owner = expr.owner;
          const arg = expr.args[0];
          if (owner instanceof ast.IdentifierNode && arg instanceof ast.IdentifierNode) {
            if (owner.name === 'aliasFor') {
              if (aliasFor) {
                this.error(owner.location, 'Duplicate aliasFor declaration');
              }
              aliasFor = arg;
              continue;
            }
          }
        }
        if (expr instanceof ast.IdentifierNode) {
          // this an error, but also a chance to help autocomplete 'aliasFor'
          this.annotation.completionPoints.push({
            range: expr.location.range,
            getCompletions() { return [{ name: 'aliasFor' }]; },
          });
        }
      }
      this.error(stmt.location, `Unexpected statement in interface method body`);
    }
    return { aliasFor };
  }

  private forwardDeclare(statements: ast.Statement[]) {
    // forward declare classes
    for (const defn of statements) {
      if (defn instanceof ast.ClassDefinition) {
        const superClassType = defn.superClass ? this.solveType(defn.superClass) : undefined;
        const variable: ClassVariable = {
          identifier: defn.identifier,
          type: newClassTypeType(
            defn.identifier,
            superClassType?.classTypeData ? (superClassType as ClassType) : undefined),
          comment: getCommentFromClassDefinition(defn),
        };
        this.classMap.set(defn, variable);
        this.declareVariable(variable);
      } else if (defn instanceof ast.InterfaceDefinition) {
        const superTypes: InterfaceType[] = [];
        for (const superTypeExpression of defn.superTypes) {
          const superType = this.solveType(superTypeExpression);
          if (superType.interfaceTypeData) {
            superTypes.push(superType as InterfaceType);
          } else {
            this.error(superTypeExpression.location, `interfaces can only extend other interfaces`);
          }
        }
        const variable: InterfaceVariable = {
          identifier: defn.identifier,
          type: newInterfaceTypeType(defn.identifier, superTypes),
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

        // inherit from super class
        const superClassType = classType.classTypeData.superClassType;
        if (superClassType) {
          for (const method of superClassType.getAllMethods()) {
            classType.addMethod(method);
          }
        }

        this.addMethodsAndFields(classType, defn.statements);
      } else if (defn instanceof ast.InterfaceDefinition) {
        const interfaceTypeType = this.interfaceMap.get(defn);
        if (!interfaceTypeType) throw new Error(`FUBAR interface ${interfaceTypeType}`);
        const interfaceType = interfaceTypeType.type.interfaceTypeTypeData.interfaceType;

        // inherit from all the super interfaces
        for (const superType of interfaceType.interfaceTypeData.superTypes) {
          for (const method of superType.getAllMethods()) {
            interfaceType.addMethod(method);
          }
        }

        this.addMethodsAndFields(interfaceType, defn.statements);
      }
    }
  }

  visitNullLiteral(n: ast.NullLiteral): EResult {
    return { type: NilType, value: null, ir: n };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): EResult {
    return { type: BoolType, value: n.value, ir: n };
  }
  visitNumberLiteral(n: ast.NumberLiteral): EResult {
    return { type: NumberType, value: n.value, ir: n };
  }
  visitStringLiteral(n: ast.StringLiteral): EResult {
    return { type: StringType, value: n.value, ir: n };
  }
  visitIdentifierNode(n: ast.IdentifierNode): EResult {
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
      return { type: AnyType, ir: n };
    }
    this.markReference(variable, n.location.range);
    return { type: variable.type, value: variable.value, ir: n };
  }
  visitAssignment(n: ast.Assignment): EResult {
    const rhs = this.solveExpr(n.value);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.identifier.name)} not found`);
      return { type: AnyType, ir: n };
    }
    if (!variable.isMutable) {
      this.error(n.location, `Variable ${n.identifier.name} is not mutable`);
      return { type: variable.type, ir: n };
    }
    if (!rhs.type.isAssignableTo(variable.type)) {
      this.error(
        n.identifier.location,
        `Value of type ${rhs.type} is not assignable to variable of type ${variable.type}`);
    }
    const ir = new ast.Assignment(n.location, n.identifier, rhs.ir);
    return { type: variable.type, value: rhs.value, ir };
  }
  visitListDisplay(n: ast.ListDisplay): EResult {
    const startErrorCount = this.annotation.errors.length;
    let itemType = this.hint.listTypeData?.itemType || NeverType;
    let values: Value[] | undefined = [];
    const irs: ast.Expression[] = [];
    for (const element of n.values) {
      const result = this.solveExpr(element, itemType, false);
      itemType = itemType.getCommonType(result.type);
      irs.push(result.ir);
      if (result.value === undefined) values = undefined;
      else values?.push(result.value);
    }
    return {
      type: itemType.list(),
      value: (startErrorCount === this.annotation.errors.length && values) ? values : undefined,
      ir: new ast.ListDisplay(n.location, irs),
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
  visitFunctionDisplay(n: ast.FunctionDisplay): EResult {
    const startErrorCount = this.annotation.errors.length;
    const lambdaType = this.solveFunctionDisplayType(n);
    return this.scoped(() => {
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
        const result = this.solveBlock(n.body);
        if (result.status !== Jumps && !NilType.isAssignableTo(returnType)) {
          this.error(
            n.location, `This function cannot return null and this function might not return`);
        }
        return {
          type: lambdaType,

          // Only bother with even trying to create a pure function if processing the
          // entire function display produced no errors
          value: startErrorCount === this.annotation.errors.length ?
            undefined : // TODO
            undefined,
          // newPureFunctionValue(n, this.scope) : undefined

          ir: new ast.FunctionDisplay(
            n.location, n.parameters, n.returnType, result.ir),
        };
      } finally {
        this.currentReturnType = outerReturnType;
      }
    });
  }

  visitMethodCall(n: ast.MethodCall): EResult {
    const startErrorCount = this.annotation.errors.length;
    const owner = this.solveExpr(n.owner);
    this.annotation.completionPoints.push({
      range: n.identifier.location.range,
      getCompletions(): Completion[] {
        const completions: Completion[] = [];
        const seen = new Set<string>();
        for (const method of owner.type.getAllMethods()) {
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
      return { type: AnyType, ir: n };
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
      return { type: method.returnType, ir: n };
    }
    const argValues: Value[] = [];
    const argIRs: ast.Expression[] = [];
    for (let i = 0; i < method.parameters.length; i++) {
      const info = this.solveExpr(n.args[i], method.parameters[i].type);
      if (info.value !== undefined) argValues.push(info.value);
      argIRs.push(info.ir);
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

    const methodIdentifier = method.aliasFor ?
      new ast.IdentifierNode(n.identifier.location, method.aliasFor) :
      n.identifier;

    return {
      type: method.returnType,
      value: staticValue,
      ir: new ast.MethodCall(n.location, owner.ir, methodIdentifier, argIRs),
    };
  }
  visitNew(n: ast.New): EResult {
    const type = this.solveType(n.type);
    const fields = type.classTypeData?.fields;
    if (!fields) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `${type} is not new-constructible`);
      return { type: AnyType, ir: n };
    }
    this.annotation.callInstances.push({
      range: n.location.range,
      args: n.args.map(arg => arg.location.range),
      parameters: fields,
    });
    if (fields.length !== n.args.length) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `${type} requires ${fields.length} args but got ${n.args.length}`);
      return { type, ir: n };
    }
    const argIRs: ast.Expression[] = [];
    for (let i = 0; i < fields.length; i++) {
      const result = this.solveExpr(n.args[i], fields[i].type);
      argIRs.push(result.ir);
    }
    return { type, ir: new ast.New(n.location, n.type, argIRs) };
  }
  visitLogicalNot(n: ast.LogicalNot): EResult {
    const { value, ir: valueIR } = this.solveExpr(n.value);
    return {
      type: BoolType,
      value: value === undefined ? undefined : !value,
      ir: new ast.LogicalNot(n.location, valueIR),
    };
  }
  visitLogicalAnd(n: ast.LogicalAnd): EResult {
    const { value: lhs, ir: lhsIR } = this.solveExpr(n.lhs);
    const { value: rhs, ir: rhsIR } = this.solveExpr(n.rhs);
    return {
      type: BoolType,
      value: (lhs !== undefined && !lhs) ? lhs : rhs,
      ir: new ast.LogicalAnd(n.location, lhsIR, rhsIR),
    };
  }
  visitLogicalOr(n: ast.LogicalOr): EResult {
    const { value: lhs, ir: lhsIR } = this.solveExpr(n.lhs);
    const { value: rhs, ir: rhsIR } = this.solveExpr(n.rhs);
    return {
      type: BoolType,
      value: (lhs !== undefined && lhs) ? lhs : rhs,
      ir: new ast.LogicalOr(n.location, lhsIR, rhsIR),
    };
  }
  visitConditional(n: ast.Conditional): EResult {
    const condition = this.solveExpr(n.condition);
    const lhs = this.solveExpr(n.lhs);
    const rhs = this.solveExpr(n.rhs);
    const value = condition.value === undefined ?
      undefined :
      condition.value ? lhs.value : rhs.value;
    return {
      type: lhs.type.getCommonType(rhs.type),
      value,
      ir: new ast.Conditional(n.location, condition.ir, lhs.ir, rhs.ir),
    };
  }
  visitTypeAssertion(n: ast.TypeAssertion): EResult {
    const value = this.solveExpr(n.value);
    const type = this.solveType(n.type);
    return { type, ir: value.ir };
  }
  visitNativeExpression(n: ast.NativeExpression): EResult {
    return { type: AnyType, ir: n };
  }
  visitNativePureFunction(n: ast.NativePureFunction): EResult {
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
      ir: n,
    };
  }
  visitEmptyStatement(n: ast.EmptyStatement): SResult {
    return { status: Continues, ir: n };
  }
  visitCommentStatement(n: ast.CommentStatement): SResult {
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitExpressionStatement(n: ast.ExpressionStatement): SResult {
    const expression = this.solveExpr(n.expression);
    return {
      status: Continues,
      ir: isNOOPExpression(expression) ?
        new ast.EmptyStatement(n.location) :
        new ast.ExpressionStatement(n.location, expression.ir),
    };
  }
  visitBlock(n: ast.Block): SResult {
    return this.scoped(() => {
      this.forwardDeclare(n.statements);
      let status: RunStatus = Continues;
      const irs: ast.Statement[] = [];
      for (const stmt of n.statements) {
        const r = this.solveStmt(stmt);
        if (r.status === Jumps) status = Jumps;
        else if (r.status === MaybeJumps && status !== Jumps) status = MaybeJumps;
        if (!(r.ir instanceof ast.EmptyStatement)) irs.push(r.ir);
      }
      return {
        status,
        ir: irs.length === 0 ?
          new ast.EmptyStatement(n.location) :
          new ast.Block(n.location, irs),
      };
    });
  }
  visitDeclaration(n: ast.Declaration): SResult {
    const explicitType = n.type ? this.solveType(n.type) : null;
    const valueInfo = n.value ? this.solveExpr(n.value, explicitType || AnyType) : null;
    if (!explicitType && !valueInfo) {
      this.error(n.location, `At least one of value or type of the variable must be specified`);
      return { status: Continues, ir: n };
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
    return {
      status: Continues,
      ir: new ast.Declaration(
        n.location, n.isMutable, n.identifier, n.type, n.comment,
        valueInfo?.ir || null
      ),
    };
  }
  visitIf(n: ast.If): SResult {
    const condition = this.solveExpr(n.condition);
    const lhs = this.solveBlock(n.lhs);
    const rhs = n.rhs ? this.solveStmt(n.rhs) : { status: Continues, ir: undefined };
    const status = (lhs.status === Jumps && rhs.status === Jumps) ? Jumps :
      (lhs.status === Jumps || lhs.status === MaybeJumps || rhs.status === Jumps || rhs.status === MaybeJumps) ?
        MaybeJumps : Continues;
    return {
      status,
      ir: new ast.If(
        n.location,
        condition.ir,
        lhs.ir,
        (rhs.ir || null) as ast.Block | ast.If | null),
    };
  }
  visitWhile(n: ast.While): SResult {
    const condition = this.solveExpr(n.condition);
    const body = this.solveBlock(n.body);
    return {
      status: MaybeJumps,
      ir: new ast.While(n.location, condition.ir, body.ir),
    };
  }
  visitReturn(n: ast.Return): SResult {
    const returnType = this.currentReturnType;
    if (!returnType) {
      this.solveExpr(n.value);
      this.error(n.location, `return cannot appear outside a function`);
      return { status: Jumps, ir: n };
    }
    const value = this.solveExpr(n.value, returnType);
    return { status: Jumps, ir: new ast.Return(n.location, value.ir) };
  }
  visitClassDefinition(n: ast.ClassDefinition): SResult {
    // a lot is already handled by `forwardDeclare`
    const classTypeType = this.classMap.get(n);
    if (!classTypeType) throw new Error(`FUBAR class ${classTypeType}`);
    const classType = classTypeType.type.classTypeTypeData.classType;
    const bodyIR: ast.Statement[] = [];
    if (n.extendsFragment) {
      this.annotation.completionPoints.push({
        range: n.extendsFragment?.location.range,
        getCompletions() { return [{ name: 'extends' }]; },
      });
    }
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
            const value = this.solveExpr(statement.value);
            bodyIR.push(new ast.Declaration(
              statement.location,
              statement.isMutable,
              statement.identifier,
              statement.type,
              statement.comment,
              value.ir));
          } else if (statement.type) {
            // fields
            bodyIR.push(statement);
          }
          continue;
        }
        this.error(statement.location, `Unexpected statement in class body`);
      }
    });
    return {
      status: Continues,
      ir: new ast.ClassDefinition(
        n.location,
        n.identifier,
        n.extendsFragment,
        n.superClass,
        bodyIR),
    };
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): SResult {
    // almost everything for interfaces is handled in `forwardDeclare`
    if (n.extendsFragment) {
      this.annotation.completionPoints.push({
        range: n.extendsFragment?.location.range,
        getCompletions() { return [{ name: 'extends' }]; },
      });
    }
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
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitImport(n: ast.Import): SResult {
    if (!this.markedImports.has(n)) {
      this.error(n.location, `Import statement is not allowed here`);
    }
    return { status: MaybeJumps, ir: new ast.EmptyStatement(n.location) };
  }
}

function isNOOPExpression(er: EResult): boolean {
  return (
    er.ir instanceof ast.NullLiteral ||
    er.ir instanceof ast.BooleanLiteral ||
    er.ir instanceof ast.NumberLiteral ||
    er.ir instanceof ast.StringLiteral
  );
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

const diagnostics = vscode.languages.createDiagnosticCollection('yal');

export async function getAnnotationForURI(uri: vscode.Uri, stack = new Set<string>()): Promise<Annotation> {
  return await getAnnotationForDocument(await vscode.workspace.openTextDocument(uri), stack);
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
  const annotationWithoutIR: AnnotationWithoutIR = {
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
    importAliasVariables: [],
  };
  const annotator = new Annotator({ annotation: annotationWithoutIR, stack, cached });
  stack.add(key);
  const { useCached, ir } = await annotator.handle(fileNode);
  const annotation: Annotation = { ...annotationWithoutIR, ir };
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
