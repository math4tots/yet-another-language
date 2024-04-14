import * as vscode from 'vscode';
import * as ast from '../ast';
import { Position, Range } from '../lexer';
import {
  AnyType,
  BoolType,
  LambdaType,
  ModuleType,
  NeverType,
  NilType,
  NumberType,
  Parameter,
  StringType,
  Type,
  newLambdaType,
  newModuleType,
} from './type';
import { getAstForDocument } from '../parser';
import { resolveURI } from '../paths';


export type ValueInfo = { type: Type; };

export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

export type Variable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly comment?: ast.StringLiteral;
};

export type ModuleVariable = Variable & {
  readonly type: ModuleType;
};

export type Reference = {
  readonly range: Range;
  readonly variable: Variable;
};

export type Scope = { [key: string]: Variable; };

const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyType };
BASE_SCOPE['Nil'] =
  { identifier: NilType.identifier, type: AnyType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: AnyType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: AnyType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: AnyType };

export type AnnotationError = ast.ParseError;

export type Annotation = {
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly errors: AnnotationError[];
  readonly variables: Variable[];
  readonly references: Reference[];
  readonly moduleVariables: Variable[];
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
    if (!e.qualifier) {
      if (e.args.length === 0) {
        switch (e.identifier.name) {
          case 'Nil': return NilType;
          case 'Bool': return BoolType;
          case 'Number': return NumberType;
          case 'String': return StringType;
        }
      }
      if (e.args.length === 1 && e.identifier.name === 'List') {
        return this.solveType(e.args[0]).list();
      }
    }
    this.error(e.location, `Could not resolve type`);
    return AnyType;
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

  private declareVariable(variable: Variable) {
    this.annotation.variables.push(variable);
    this.scope[variable.identifier.name] = variable;
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
        const aliasVariable: Variable = { identifier, type: importModuleType };
        this.declareVariable(aliasVariable);
        this.markReference(aliasVariable, identifier.location.range);
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

    for (const statement of n.statements) {
      this.solveStmt(statement);
    }

    // We collect module variables to determine which ones should
    for (const key of Object.getOwnPropertyNames(this.scope)) {
      this.annotation.moduleVariables.push(this.scope[key]);
    }

    return { useCached: false };
  }

  visitNilLiteral(n: ast.NilLiteral): ValueInfo {
    return { type: NilType };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ValueInfo {
    return { type: BoolType };
  }
  visitNumberLiteral(n: ast.NumberLiteral): ValueInfo {
    return { type: NumberType };
  }
  visitStringLiteral(n: ast.StringLiteral): ValueInfo {
    return { type: StringType };
  }
  visitIdentifierNode(n: ast.IdentifierNode): ValueInfo {
    const variable = this.scope[n.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.name)} not found`);
      return { type: AnyType };
    }
    this.markReference(variable, n.location.range);
    return { type: variable.type };
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.identifier.name)} not found`);
      return { type: AnyType };
    }
    const rhs = this.solveExpr(n.value);
    if (!rhs.type.isAssignableTo(variable.type)) {
      this.error(
        n.identifier.location,
        `Value of type ${rhs.type} is not assignable to variable of type ${variable.type}`);
    }
    return { type: variable.type };
  }
  visitListDisplay(n: ast.ListDisplay): ValueInfo {
    const givenItemType = this.hint.listItemType;
    if (givenItemType) {
      for (const element of n.values) {
        this.solveExpr(element, givenItemType);
      }
      return { type: givenItemType.list() };
    }
    if (n.values.length === 0) return { type: AnyType };
    let itemType: Type = NeverType;
    for (const element of n.values) {
      const elementInfo = this.solveExpr(element, itemType, false);
      itemType = itemType.getCommonType(elementInfo.type);
    }
    return { type: itemType.list() };
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
    const lambdaType = this.solveFunctionDisplayType(n);
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
          n.location, `This function cannot return nil, and this function might not return`);
      }
    } finally {
      this.currentReturnType = outerReturnType;
    }
    return { type: lambdaType };
  }
  visitMethodCall(n: ast.MethodCall): ValueInfo {
    const owner = this.solveExpr(n.owner);
    const method = owner.type.getMethod(n.identifier.name);
    if (!method) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `Method ${n.identifier.name} not found on type ${owner.type}`);
      return { type: AnyType };
    }
    this.markReference(method.sourceVariable, n.identifier.location.range);
    if (method.parameters.length !== n.args.length) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `Expected ${method.parameters.length} args but got ${n.args.length}`);
      return { type: method.returnType };
    }
    for (let i = 0; i < method.parameters.length; i++) {
      this.solveExpr(n.args[i], method.parameters[i].type);
    }
    return { type: method.returnType };
  }
  visitNew(n: ast.New): ValueInfo {
    const type = this.solveType(n.type);
    const fields = type.fields;
    if (!fields) {
      for (const arg of n.args) this.solveExpr(arg);
      this.error(n.location, `${type} is not new-constructible`);
      return { type: AnyType };
    }
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
    this.solveExpr(n.value);
    return { type: BoolType };
  }
  visitLogicalAnd(n: ast.LogicalAnd): ValueInfo {
    this.solveExpr(n.lhs);
    this.solveExpr(n.rhs);
    return { type: BoolType };
  }
  visitLogicalOr(n: ast.LogicalOr): ValueInfo {
    this.solveExpr(n.lhs);
    this.solveExpr(n.rhs);
    return { type: BoolType };
  }
  visitConditional(n: ast.Conditional): ValueInfo {
    this.solveExpr(n.condition);
    const lhs = this.solveExpr(n.lhs);
    const rhs = this.solveExpr(n.rhs);
    return { type: lhs.type.getCommonType(rhs.type) };
  }
  visitTypeAssertion(n: ast.TypeAssertion): ValueInfo {
    this.solveExpr(n.value);
    const type = this.solveType(n.type);
    return { type };
  }
  visitNativeExpression(n: ast.NativeExpression): ValueInfo {
    this.error(n.location, `TODO: Annotator NativeExpression`);
    return { type: AnyType };
  }
  visitNativePureFunction(n: ast.NativePureFunction): ValueInfo {
    this.error(n.location, `TODO: Annotator NativePureFunction`);
    return { type: AnyType };
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
    if (n.isMutable && !explicitType) {
      this.error(n.location, `Mutable variables must have its type explicitly specified`);
      return Continues;
    }
    if (!explicitType && !valueInfo) {
      this.error(n.location, `At least one of value or type of the variable must be specified`);
      return Continues;
    }
    const type = explicitType || valueInfo?.type || AnyType;
    const variable: Variable = { isMutable: n.isMutable, identifier: n.identifier, type };
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
    return MaybeJumps;
  }
  visitReturn(n: ast.Return): RunStatus {
    return Jumps;
  }
  visitClassDefinition(n: ast.ClassDefinition): RunStatus {
    return Continues;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): RunStatus {
    return Continues;
  }
  visitImport(n: ast.Import): RunStatus {
    if (!this.markedImports.has(n)) {
      this.error(n.location, `Import statement is not allowed here`);
    }
    return MaybeJumps;
  }
}

type AnnotationEntry = {
  readonly version: number,
  readonly annotation: Annotation,
};

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
    moduleVariables: [],
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
  const variable: ModuleVariable = { identifier: moduleType.identifier, type: moduleType };
  moduleVariableMap.set(moduleType, variable);
  return variable;
}
