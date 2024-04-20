import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { getAstForDocument } from '../lang/frontend/parser';
import { toVSRange } from '../lang/frontend/bridge-utils';

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
              const fileNode = await getAstForDocument(document);
              let position = new vscode.Position(0, 0);
              for (const statement of fileNode.statements) {
                if (statement instanceof yal.ast.Import || statement instanceof yal.ast.ImportFrom) {
                  position = new vscode.Position(statement.location.range.end.line + 1, 0);
                }
              }
              item.additionalTextEdits = [
                new vscode.TextEdit(
                  new vscode.Range(position, position),
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
