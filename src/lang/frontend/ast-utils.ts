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

export function getCommentFromClassDefinition(cd: ast.ClassDefinition): ast.StringLiteral | undefined {
  return getCommentFromSeq(cd.statements);
}

export function getCommentFromInterfaceDefinition(cd: ast.InterfaceDefinition): ast.StringLiteral | undefined {
  return getCommentFromSeq(cd.statements);
}

export function getCommentFromEnumDefinition(cd: ast.EnumDefinition): ast.StringLiteral | undefined {
  return getCommentFromSeq(cd.statements);
}

export function getBodyIfFunctionHasSimpleBody(fd: ast.FunctionDisplay): ast.Expression | undefined {
  return (fd.body.statements.length === 1 && fd.body.statements[0] instanceof ast.Return) ?
    fd.body.statements[0].value : undefined;
}
