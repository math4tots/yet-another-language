import * as ast from '../frontend/ast';
import { Solver } from './solver';
import { Type } from './type';
import { Value } from './value';


export type ExpressionInfo = {
  readonly type: Type;
  readonly value?: Value;
};


export class ExpressionSolver
  extends Solver<ast.Expression, ExpressionInfo>
  implements ast.ExpressionVisitor<ExpressionInfo> {

  solve(a: ast.Expression): ExpressionInfo {
    return a.accept(this);
  }

  visitNullLiteral(n: ast.NullLiteral): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitNumberLiteral(n: ast.NumberLiteral): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitStringLiteral(n: ast.StringLiteral): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitIdentifierNode(n: ast.IdentifierNode): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitAssignment(n: ast.Assignment): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitListDisplay(n: ast.ListDisplay): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitMethodCall(n: ast.MethodCall): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitNew(n: ast.New): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitLogicalNot(n: ast.LogicalNot): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitLogicalAnd(n: ast.LogicalAnd): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitLogicalOr(n: ast.LogicalOr): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitConditional(n: ast.Conditional): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitTypeAssertion(n: ast.TypeAssertion): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitNativeExpression(n: ast.NativeExpression): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
  visitNativePureFunction(n: ast.NativePureFunction): ExpressionInfo {
    throw new Error('Method not implemented.');
  }
}
