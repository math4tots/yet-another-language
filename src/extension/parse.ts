import * as vscode from 'vscode';
import * as guc from '../lang/guc';
import { getSelectionOrAllText, writeToNewEditor } from './utils';


class Printer implements guc.ast.Visitor<void> {
  out: string = '';
  depth: number = 0;
  convert(file: guc.ast.File): string {
    file.accept(this);
    return this.out;
  }
  indent() { this.out += '\n' + '  '.repeat(this.depth); }

  visitFile(n: guc.ast.File): void {
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
  visitNone(n: guc.ast.None): void {
    this.indent();
    this.out += `NONE`;
  }
  visitBlock(n: guc.ast.Block): void {
    this.indent();
    this.out += 'BLOCK';
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
  visitNilLiteral(n: guc.ast.NilLiteral): void {
    this.indent();
    this.out += `nil`;
  }
  visitBooleanLiteral(n: guc.ast.BooleanLiteral): void {
    this.indent();
    this.out += `boolean ${n.value}`;
  }
  visitNumberLiteral(n: guc.ast.NumberLiteral): void {
    this.indent();
    this.out += `number ${n.value}`;
  }
  visitStringLiteral(n: guc.ast.StringLiteral): void {
    this.indent();
    this.out += `string ${JSON.stringify(n.value)}`;
  }
  visitIdentifier(n: guc.ast.Identifier): void {
    this.indent();
    this.out += `IDENTIFIER ${n.name}`;
  }
  visitDeclaration(n: guc.ast.Declaration): void {
    this.indent();
    this.out += `DECLARATION ${n.identifier.name}${n.isConst ? ' const' : ''}`;
    this.depth++;
    n.value?.accept(this);
    this.depth--;
  }
  visitAssignment(n: guc.ast.Assignment): void {
    this.indent();
    this.out += `ASSIGNMENT ${n.identifier.name}`;
    this.depth++;
    n.value.accept(this);
    this.depth--;
  }
  visitListDisplay(n: guc.ast.ListDisplay): void {
    this.indent();
    this.out += `LIST DISPLAY`;
    this.depth++;
    for (const element of n.values) {
      element.accept(this);
    }
    this.depth--;
  }
  visitFunctionDisplay(n: guc.ast.FunctionDisplay): void {
    this.indent();
    this.out += `FUNCTION DISPLAY (${n.parameters.map(p => p.identifier.name).join(', ')})`;
    this.depth++;
    n.body.accept(this);
    this.depth--;
  }
  visitMethodCall(n: guc.ast.MethodCall): void {
    this.indent();
    this.out += `METHOD CALL ${n.identifier.name}`;
    this.depth++;
    n.owner.accept(this);
    for (const arg of n.args) {
      arg.accept(this);
    }
    this.depth--;
  }
  visitLogicalAnd(n: guc.ast.LogicalAnd): void {
    this.indent();
    this.out += `LOGICAL AND`;
    this.depth++;
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitLogicalOr(n: guc.ast.LogicalOr): void {
    this.indent();
    this.out += `LOGICAL OR`;
    this.depth++;
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitConditional(n: guc.ast.Conditional): void {
    this.indent();
    this.out += `CONDITIONAL`;
    this.depth++;
    n.condition.accept(this);
    n.lhs.accept(this);
    n.rhs.accept(this);
    this.depth--;
  }
  visitIf(n: guc.ast.If): void {
    this.indent();
    this.out += `IF`;
    this.depth++;
    n.condition.accept(this);
    n.lhs.accept(this);
    n.rhs?.accept(this);
    this.depth--;
  }
  visitWhile(n: guc.ast.While): void {
    this.indent();
    this.out += `WHILE`;
    this.depth++;
    n.condition.accept(this);
    n.body.accept(this);
    this.depth--;
  }
  visitClassDefinition(n: guc.ast.ClassDefinition): void {
    this.indent();
    this.out += `CLASS DEFINITION`;
    this.depth++;
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.depth--;
  }
}

export async function parseCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = guc.parse(editor.document.uri, text);
  const string = new Printer().convert(file);

  await writeToNewEditor(emit => { emit(string); });
}
