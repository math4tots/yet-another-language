import * as vscode from 'vscode';
import * as ast from '../ast';
import { Position, Range } from '../lexer';
import {
  AnyType,
  BoolType,
  LambdaType,
  NeverType,
  NilType,
  NumberType,
  Parameter,
  StringType,
  Type,
  newLambdaType,
} from './type';
import { getAstForDocument } from '../parser';


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
  readonly errors: AnnotationError[];
  readonly variables: Variable[];
  readonly references: Reference[];
};

type AnnotatorParameters = {
  readonly annotation: Annotation,
};

class Annotator implements ast.ExpressionVisitor<ValueInfo>, ast.StatementVisitor<RunStatus> {
  readonly annotation: Annotation;

  private currentReturnType: Type | null = null;
  private hint: Type = AnyType;
  private scope: Scope = Object.create(BASE_SCOPE);
  private typeSolverCache = new Map<ast.TypeExpression, Type>();
  private lambdaTypeCache = new Map<ast.FunctionDisplay, LambdaType>();

  constructor(params: AnnotatorParameters) {
    this.annotation = params.annotation;
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
    this.annotation.errors.push({
      message: `Could not resolve type`,
      location: e.location,
    });
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
      this.annotation.errors.push({
        message: `Expected expression of type ${hint} but got expression of type ${info.type}`,
        location: e.location,
      });
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
  }

  async annotate(n: ast.File) {
    for (const statement of n.statements) {
      this.solveStmt(statement);
    }
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
      this.annotation.errors.push({
        message: `Variable ${JSON.stringify(n.name)} not found`,
        location: n.location,
      });
      return { type: AnyType };
    }
    this.annotation.references.push({ range: n.location.range, variable });
    return { type: variable.type };
  }
  visitAssignment(n: ast.Assignment): ValueInfo {
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.annotation.errors.push({
        message: `Variable ${JSON.stringify(n.identifier.name)} not found`,
        location: n.location,
      });
      return { type: AnyType };
    }
    const rhs = this.solveExpr(n.value);
    if (!rhs.type.isAssignableTo(variable.type)) {
      this.annotation.errors.push({
        message: `Value of type ${rhs.type} is not assignable to variable of type ${variable.type}`,
        location: n.identifier.location,
      });
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
        this.annotation.errors.push({
          message: `This function cannot return nil, and this function might not return`,
          location: n.location,
        });
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
      this.annotation.errors.push({
        message: `Method ${n.identifier.name} not found on type ${owner.type}`,
        location: n.location,
      });
      return { type: AnyType };
    }
    if (method.parameters.length !== n.args.length) {
      this.annotation.errors.push({
        message: `Expected ${method.parameters.length} args but got ${n.args.length}`,
        location: n.location,
      });
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
      this.annotation.errors.push({
        message: `${type} is not new-constructible`,
        location: n.location,
      });
      return { type: AnyType };
    }
    if (fields.length !== n.args.length) {
      this.annotation.errors.push({
        message: `${type} requires ${fields.length} args but got ${n.args.length}`,
        location: n.location,
      });
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
    this.annotation.errors.push({
      message: `TODO: Annotator NativeExpression`,
      location: n.location,
    });
    return { type: AnyType };
  }
  visitNativePureFunction(n: ast.NativePureFunction): ValueInfo {
    this.annotation.errors.push({
      message: `TODO: Annotator NativePureFunction`,
      location: n.location,
    });
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
    if (!explicitType && !valueInfo) {
      this.annotation.errors.push({
        message: `At least one of value or type of the variable must be specified`,
        location: n.location,
      });
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
    return MaybeJumps;
  }
}

type AnnotationEntry = {
  readonly version: number,
  readonly annotation: Annotation,
};

const annotationCache = new Map<string, AnnotationEntry>();
const diagnostics = vscode.languages.createDiagnosticCollection('yal');

export async function getAnnotationForURI(uri: vscode.Uri): Promise<Annotation> {
  return await getAnnotationForDocument(await vscode.workspace.openTextDocument(uri));
}

function toVSPosition(p: Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export async function getAnnotationForDocument(document: vscode.TextDocument): Promise<Annotation> {
  const key = document.uri.toString();
  const version = document.version;
  const entry = annotationCache.get(key);
  if (entry && entry.version === version) return entry.annotation;
  const fileNode = await getAstForDocument(document);
  const annotation: Annotation = {
    errors: [...fileNode.errors],
    variables: [],
    references: [],
  };
  const annotator = new Annotator({ annotation });
  await annotator.annotate(fileNode);
  console.log(`annotation.errors.length = ${annotation.errors.length}`);
  diagnostics.set(document.uri, annotation.errors.map(e => ({
    message: e.message,
    range: toVSRange(e.location.range),
    severity: vscode.DiagnosticSeverity.Warning,
  })));
  annotationCache.set(key, { version, annotation });
  return annotation;
}
