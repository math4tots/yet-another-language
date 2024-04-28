import * as vscode from 'vscode';
import { Position, Range } from "./lexer";
import { Location } from './ast';

export function toVSPosition(p: Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

export function toVSRange(range: Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function toVSLocation(location: Location): vscode.Location {
  return new vscode.Location(location.uri, toVSRange(location.range));
}
