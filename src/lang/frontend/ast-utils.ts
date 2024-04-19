import * as ast from './ast';

export function getCommentFromSeq(stmts: ast.Statement[]): ast.StringLiteral | undefined {
  return (stmts.length > 0 &&
    stmts[0] instanceof ast.ExpressionStatement &&
    stmts[0].expression instanceof ast.StringLiteral) ? stmts[0].expression :
    getCommentCommentsFromSeq(stmts);
}

export function getCommentCommentsFromSeq(stmts: ast.Statement[]): ast.StringLiteral | undefined {
  if (stmts.length === 0) return undefined;
  let comments = '';
  const uri = stmts[0].location.uri;
  const start = stmts[0].location.range.start;
  let end = stmts[0].location.range.end;
  for (let i = 0; i < stmts.length && stmts[i] instanceof ast.CommentStatement; i++) {
    let comment = (stmts[i] as ast.CommentStatement).comment;
    if (comment.startsWith('#')) comment = comment.substring(1);
    comments += comment;
    end = stmts[i].location.range.end;
  }
  return new ast.StringLiteral({ uri, range: { start, end } }, comments) || undefined;
}

export function getCommentFromFunctionDisplay(fd: ast.FunctionDisplay): ast.StringLiteral | undefined {
  return getCommentFromSeq(fd.body.statements);
}

export function getCommentFromClassDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.ClassDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}

export function getCommentFromInterfaceDefinition(cd: ast.Node | null): ast.StringLiteral | undefined {
  return cd instanceof ast.InterfaceDefinition ?
    getCommentFromSeq(cd.statements) : undefined;
}
