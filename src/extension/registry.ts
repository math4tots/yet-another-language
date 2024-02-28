import * as vscode from 'vscode';
import * as yal from '../lang/yal';


type Entry = {
  readonly version: number;
  readonly uri: vscode.Uri;
  readonly annotator: yal.Annotator;
  readonly fileNode: yal.ast.File;
};

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export class Registry {
  readonly diagnostics = vscode.languages.createDiagnosticCollection('yal');
  private readonly map = new Map<string, Entry>();

  update(document: vscode.TextDocument): Entry {
    const uri = document.uri;
    const key = uri.toString();
    const entry = this.map.get(key);
    if (entry && entry.version === document.version) {
      return entry;
    }
    const fileNode = yal.parse(uri, document.getText());
    const annotator = new yal.Annotator();
    annotator.annotateFile(fileNode);
    this.diagnostics.set(uri, annotator.errors.map(e => ({
      message: e.message,
      range: toVSRange(e.location.range),
      severity: vscode.DiagnosticSeverity.Warning,
    })));
    const newEntry = { version: document.version, uri, annotator, fileNode };
    this.map.set(key, newEntry);
    return newEntry;
  }

  get(uri: vscode.Uri): Entry | null {
    return this.map.get(uri.toString()) || null;
  }
}
