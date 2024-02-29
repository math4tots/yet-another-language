import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { Registry } from "./registry";

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newInlayHintsProvider(registry: Registry): vscode.InlayHintsProvider {
  return {
    async provideInlayHints(document, range, token) {
      const entry = registry.update(document);
      const hints: vscode.InlayHint[] = [];
      for (const printInstance of entry.annotator.printInstances) {
        const irange = toVSRange(printInstance.range);
        hints.push(new vscode.InlayHint(
          irange.end, ' ' + yal.strValue(printInstance.value)));
      }
      return hints;
    },
  };
}
