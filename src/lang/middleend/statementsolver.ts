import * as ast from '../frontend/ast';
import { Solver } from './solver';
import { Type } from './type';
import { Value } from './value';


export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

export type StatementInfo = {
  readonly runStatus: RunStatus;
};


export class StatementSolver extends Solver implements ast.StatementVisitor<StatementInfo> {
  solve(a: ast.Statement): StatementInfo {
    return a.accept(this);
  }

  visitEmptyStatement(n: ast.EmptyStatement): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitExpressionStatement(n: ast.ExpressionStatement): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitBlock(n: ast.Block): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitDeclaration(n: ast.Declaration): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitIf(n: ast.If): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitWhile(n: ast.While): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitReturn(n: ast.Return): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitClassDefinition(n: ast.ClassDefinition): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): StatementInfo {
    throw new Error('Method not implemented.');
  }
  visitImport(n: ast.Import): StatementInfo {
    throw new Error('Method not implemented.');
  }

}
