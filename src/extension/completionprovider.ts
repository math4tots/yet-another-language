import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getAnnotationForDocument } from '../lang/middleend/annotator';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newCompletionProvider(): vscode.CompletionItemProvider {
  return {
    async provideCompletionItems(document, position, token, context) {
      const items: vscode.CompletionItem[] = [];
      const annotation = await getAnnotationForDocument(document);
      for (const cpoint of annotation.completionPoints) {
        const range = toVSRange(cpoint.range);
        if (range.contains(position)) {
          for (const completion of cpoint.getCompletions()) {
            const item = new vscode.CompletionItem(completion.name);
            if (completion.detail) {
              item.detail = completion.detail;
            }
            if (completion.importFrom) {
              item.additionalTextEdits = [
                new vscode.TextEdit(
                  new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                  `import ${completion.name} from '${completion.importFrom}'\n`)
              ];
            }
            item.sortText =
              (completion.name.startsWith('_') ? '~' : '5') + completion.name;
            items.push(item);
          }
        }
      }
      return items;
    },
  };
}
