import * as ast from './ast';

export function getCommentFromSeq(stmts: ast.Statement[]): ast.StringLiteral | undefined {
  return (stmts.length > 0 &&
    stmts[0] instanceof ast.ExpressionStatement &&
    stmts[0].expression instanceof ast.StringLiteral) ? stmts[0].expression : undefined;
}

export function getCommentFromFunctionDisplay(fd: ast.Node | null): ast.StringLiteral | undefined {
  return fd instanceof ast.FunctionDisplay ?
    getCommentFromSeq(fd.body.statements) : undefined;
}

export function getCommentFromClassDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.ClassDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}

export function getCommentFromInterfaceDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.InterfaceDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}
