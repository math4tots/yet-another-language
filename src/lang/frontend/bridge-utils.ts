import * as vscode from 'vscode';
import { Position, Range } from "./lexer";

export function toVSPosition(p: Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

export function toVSRange(range: Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}
