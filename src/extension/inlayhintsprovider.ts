import * as vscode from 'vscode';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { strFunction } from '../lang/middleend/functions';
import { toVSRange } from '../lang/frontend/bridge-utils';

export function newInlayHintsProvider(): vscode.InlayHintsProvider {
  return {
    async provideInlayHints(document, range, token) {
      const annotation = await getAnnotationForDocument(document);
      const hints: vscode.InlayHint[] = [];
      for (const printInstance of annotation.printInstances) {
        const irange = toVSRange(printInstance.range);
        hints.push(new vscode.InlayHint(
          irange.end, ' ' + strFunction(printInstance.value)));
      }
      return hints;
    },
  };
}
