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
                if (
                  // imports should generally come after 'export as' statements
                  statement instanceof yal.ast.ExportAs ||

                  (completion.importAsModule ?

                    // 'import as' statements generally come first, and are sorted by path
                    (statement instanceof yal.ast.Import && statement.path.value < completion.importFrom) :

                    // 'import from' statements generally come after 'import as' statements
                    (statement instanceof yal.ast.Import ||
                      (statement instanceof yal.ast.ImportFrom &&
                        (statement.path.value !== completion.importFrom ?
                          // and are sorted by path
                          statement.path.value < completion.importFrom :
                          // and are sorted by member name if the paths are the same
                          statement.identifier.name < completion.name
                        ))))) {
                  position = new vscode.Position(statement.location.range.end.line + 1, 0);
                }
              }
              item.additionalTextEdits = [
                new vscode.TextEdit(
                  new vscode.Range(position, position),
                  completion.importAsModule ?
                    `import '${completion.importFrom}' as ${completion.name}\n` :
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
