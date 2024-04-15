import * as vscode from 'vscode';
import * as yal from '../../lang/yal';
import { getAnnotationForDocument } from '../../lang/new/annotator';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newNewInlayHintsProvider(): vscode.InlayHintsProvider {
  return {
    async provideInlayHints(document, range, token) {
      const annotation = await getAnnotationForDocument(document);
      const hints: vscode.InlayHint[] = [];
      for (const printInstance of annotation.printInstances) {
        const irange = toVSRange(printInstance.range);
        hints.push(new vscode.InlayHint(
          irange.end, ' ' + printInstance.value.toString()));
      }
      return hints;
    },
  };
}
