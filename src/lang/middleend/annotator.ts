import * as ast from '../frontend/ast';
import * as vscode from 'vscode';
import { AnyType, LambdaType, Type } from './type';
import { ExpressionInfo, ExpressionSolver } from './expressionsolver';
import { StatementInfo, StatementSolver } from './statementsolver';
import { Annotation, ClassVariable, InterfaceVariable, Variable } from './annotation';
import { Scope, BASE_SCOPE } from './scope';
import { Range } from '../frontend/lexer';
import { TypeSolver } from './typesolver';

type AnnotatorParameters = {
  readonly annotation: Annotation;
  readonly stack: Set<string>; // for detecting recursion
  readonly cached?: Annotation;
};

export class Annotator {

  // All public fields here really should be package-private

  readonly annotation: Annotation;
  readonly stack: Set<string>; // for detecting recursion

  currentReturnType: Type | null = null;
  hint: Type = AnyType;
  scope: Scope = Object.create(BASE_SCOPE);
  readonly cached?: Annotation;
  readonly markedImports = new Set<ast.Import>();
  readonly classMap = new Map<ast.ClassDefinition, ClassVariable>();
  readonly interfaceMap = new Map<ast.InterfaceDefinition, InterfaceVariable>();

  private readonly typeSolver = new TypeSolver(this);
  private readonly expressionSolver = new ExpressionSolver(this);
  private readonly statementSolver = new StatementSolver(this);

  constructor(params: AnnotatorParameters) {
    this.annotation = params.annotation;
    this.stack = params.stack;
    this.cached = params.cached;
  }

  error(location: ast.Location, message: string): void {
    this.annotation.errors.push({ location, message });
  }
  solveType(e: ast.TypeExpression): Type {
    return this.typeSolver.solve(e);
  }
  solveExpression(e: ast.Expression, hint: Type = AnyType, required: boolean = true): ExpressionInfo {
    return this.expressionSolver.solve(e, hint, required);
  }
  solveStatement(s: ast.Statement): StatementInfo {
    return this.statementSolver.solve(s);
  }
  markReference(variable: Variable, range: Range) {
    this.annotation.references.push({ variable, range });
  }
}
