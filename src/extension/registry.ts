import * as vscode from 'vscode';
import * as yal from '../lang/yal';


type Entry = {
  readonly version: number;
  readonly uri: vscode.Uri;
  readonly annotator: yal.Annotator;
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

  startUpdate(document: vscode.TextDocument) {
    (async () => { await this.update(document); })();
  }

  async update(document: vscode.TextDocument): Promise<Entry> {
    const uri = document.uri;
    const key = uri.toString();
    const entry = this.map.get(key);
    if (entry && entry.version === document.version) {
      console.log(`Registry.update(${uri.toString()}) (cached)`);
      return entry;
    }
    console.log(`Registry.update(${uri.toString()})`);
    const annotator = await yal.annotateDocument(document);
    this.diagnostics.set(uri, annotator.errors.map(e => ({
      message: e.message,
      range: toVSRange(e.location.range),
      severity: vscode.DiagnosticSeverity.Warning,
    })));
    const newEntry = { version: document.version, uri, annotator };
    this.map.set(key, newEntry);
    return newEntry;
  }

  get(uri: vscode.Uri): Entry | null {
    return this.map.get(uri.toString()) || null;
  }
}
