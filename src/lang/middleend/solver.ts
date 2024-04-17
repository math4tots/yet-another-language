import * as ast from '../frontend/ast';
import type { ExpressionInfo } from './expressionsolver';
import type { StatementInfo } from './statementsolver';
import type { Annotator } from './annotator';
import { AnyType, type Type } from './type';
import type { Variable } from './annotation';
import type { Range } from '../frontend/lexer';
import type { Scope } from './scope';


/** Helper base class for ExpressionSolver, StatementSolver and TypeSolver */
export abstract class Solver {
  protected readonly annotator: Annotator;
  constructor(annotator: Annotator) {
    this.annotator = annotator;
  }

  protected error(location: ast.Location, message: string) {
    return this.annotator.error(location, message);
  }
  protected solveType(e: ast.TypeExpression): Type {
    return this.annotator.solveType(e);
  }
  protected solveExpression(e: ast.Expression, hint: Type = AnyType, required: boolean = true): ExpressionInfo {
    return this.annotator.solveExpression(e, hint, required);
  }
  protected solveStatement(s: ast.Statement): StatementInfo {
    return this.annotator.solveStatement(s);
  }
  protected markReference(variable: Variable, range: Range) {
    return this.annotator.markReference(variable, range);
  }
  protected get annotation() { return this.annotator.annotation; }
  protected get scope() { return this.annotator.scope; }
  protected set scope(newScope: Scope) { this.annotator.scope = newScope; }
  protected get currentReturnType() { return this.annotator.currentReturnType; }
  protected set currentReturnType(t: typeof this.annotator.currentReturnType) { this.annotator.currentReturnType = t; }
  protected get hint() { return this.annotator.hint; }
  protected set hint(t: typeof this.annotator.hint) { this.annotator.hint = t; }
}
