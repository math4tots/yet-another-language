import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getSelectionOrAllText, writeToNewEditor } from './utils';


class Printer implements yal.ast.NodeVisitor<void> {
  out: string = '';
  depth: number = 0;
  convert(file: yal.ast.File): string {
    file.accept(this);
    return this.out;
  }
  indent() { this.out += '\n' + '  '.repeat(this.depth); }

  visitFile(n: yal.ast.File): void {
    this.out += 'FILE';
    this.depth++;
    for (const error of n.errors) {
      this.indent();
      this.out += `ERROR@${error.location.range.start.line + 1}:` +
        `${error.location.range.start.column} - ${error.message}`;
    }
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitEmptyStatement(n: yal.ast.EmptyStatement): void {
    this.indent();
    this.out += `NONE`;
  }
  visitCommentStatement(n: yal.ast.CommentStatement): void {
    this.indent();
    this.out += `COMMENT ${n.comment}`;
  }
  visitExpressionStatement(n: yal.ast.ExpressionStatement): void {
    n.expression.accept(this);
  }
  visitBlock(n: yal.ast.Block): void {
    this.indent();
    this.out += 'BLOCK';
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitNullLiteral(n: yal.ast.NullLiteral): void {
    this.indent();
    this.out += `null`;
  }
  visitBooleanLiteral(n: yal.ast.BooleanLiteral): void {
    this.indent();
    this.out += `boolean ${n.value}`;
  }
  visitNumberLiteral(n: yal.ast.NumberLiteral): void {
    this.indent();
    this.out += `number ${n.value}`;
  }
  visitStringLiteral(n: yal.ast.StringLiteral): void {
    this.indent();
    this.out += `string ${JSON.stringify(n.value)}`;
  }
  visitIdentifierNode(n: yal.ast.IdentifierNode): void {
    this.indent();
    this.out += `IDENTIFIER ${n.name}`;
  }
  visitDeclaration(n: yal.ast.Declaration): void {
    this.indent();
    this.out += `DECLARATION ${n.identifier.name}${n.isMutable ? '' : ' const'}`;
    this.depth++;
    n.value?.accept(this);
    this.depth--;
  }
  visitAssignment(n: yal.ast.Assignment): void {
    this.indent();
    this.out += `ASSIGNMENT ${n.identifier.name}`;
    this.depth++;
    n.value.accept(this);
    this.depth--;
  }
  visitListDisplay(n: yal.ast.ListDisplay): void {
    this.indent();
    this.out += `LIST DISPLAY`;
    this.depth++;
    for (const element of n.values) {
      element.accept(this);
    }
    this.depth--;
  }
  visitFunctionDisplay(n: yal.ast.FunctionDisplay): void {
    this.indent();
    this.out += `FUNCTION DISPLAY (${n.parameters.map(p => p.identifier.name).join(', ')})`;
    this.depth++;
    n.body.accept(this);
    this.depth--;
  }
  visitMethodCall(n: yal.ast.MethodCall): void {
    this.indent();
    this.out += `METHOD CALL ${n.identifier.name}`;
    this.depth++;
    n.owner.accept(this);
    for (const arg of n.args) {
      arg.accept(this);
    }
    this.depth--;
  }
  visitNew(n: yal.ast.New): void {
    this.indent();
    this.out += `NEW ${n.type} (${n.args.length} args)`;
    this.depth++;
    for (const arg of n.args) arg.accept(this);
    this.depth--;
  }
  visitLogicalNot(n: yal.ast.LogicalNot): void {
    this.indent();
    this.out += `LOGICAL NOT`;
    this.depth++;
    n.value.accept(this);
    this.depth--;
  }
  visitLogicalAnd(n: yal.ast.LogicalAnd): void {
    this.indent();
    this.out += `LOGICAL AND`;
    this.depth++;
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitLogicalOr(n: yal.ast.LogicalOr): void {
    this.indent();
    this.out += `LOGICAL OR`;
    this.depth++;
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitConditional(n: yal.ast.Conditional): void {
    this.indent();
    this.out += `CONDITIONAL`;
    this.depth++;
    n.condition.accept(this);
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitTypeAssertion(n: yal.ast.TypeAssertion): void {
    this.indent();
    this.out += `TYPE ASSERTION (${n.type})`;
    this.depth++;
    n.value.accept(this);
    this.depth--;
  }
  visitNativeExpression(n: yal.ast.NativeExpression): void {
    this.indent();
    this.out += `NATIVE EXPRESSION ${JSON.stringify(n.source.value)}`;
  }
  visitNativePureFunction(n: yal.ast.NativePureFunction): void {
    this.indent();
    this.out += `NATIVE PURE FUNCTION ${n.parameters.map(p => p.identifier.name).join(', ')}`;
    this.depth++;
    for (const [identifier, implementation] of n.body) {
      this.indent();
      this.out += `${identifier.name} => ${implementation}`;
    }
    this.depth--;
  }
  visitIf(n: yal.ast.If): void {
    this.indent();
    this.out += `IF`;
    this.depth++;
    n.condition.accept(this);
    n.lhs.accept(this);
    n.rhs?.accept(this);
    this.depth--;
  }
  visitWhile(n: yal.ast.While): void {
    this.indent();
    this.out += `WHILE`;
    this.depth++;
    n.condition.accept(this);
    n.body.accept(this);
    this.depth--;
  }
  visitReturn(n: yal.ast.Return): void {
    this.indent();
    this.out += `RETURN`;
    this.depth++;
    n.value.accept(this);
    this.depth--;
  }
  visitClassDefinition(n: yal.ast.ClassDefinition): void {
    this.indent();
    this.out += `CLASS DEFINITION`;
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitInterfaceDefinition(n: yal.ast.InterfaceDefinition): void {
    this.indent();
    this.out += `INTERFACE DEFINITION`;
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitEnumDefinition(n: yal.ast.EnumDefinition): void {
    this.indent();
    this.out += `ENUM DEFINITION`;
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitImport(n: yal.ast.Import): void {
    this.indent();
    this.out += `IMPORT ${JSON.stringify(n.path.value)} AS ${n.identifier.name}`;
  }
}

export async function parseCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = yal.parse(editor.document.uri, text);
  const string = new Printer().convert(file);

  await writeToNewEditor(emit => { emit(string); });
}
