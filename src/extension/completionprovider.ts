import * as vscode from 'vscode';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { getAstForDocument } from '../lang/frontend/parser';
import { toVSRange } from '../lang/frontend/bridge-utils';
import { ast } from '../lang/yal';

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
            if (completion.variable?.comment) {
              item.documentation = completion.variable.comment.value;
            }
            if (completion.importFrom) {
              const fileNode = await getAstForDocument(document);
              let position = new vscode.Position(0, 0);
              for (const statement of fileNode.statements) {
                if (statement instanceof ast.CommentStatement) {
                  // skip comments at the top
                  position = new vscode.Position(statement.location.range.end.line + 1, 0);
                  continue;
                } else if (statement instanceof ast.ExpressionStatement) {
                  if (statement.expression instanceof ast.StringLiteral) {
                    // skip string literal comment at the top.
                    // But after this one, no more skipping
                    position = new vscode.Position(statement.location.range.end.line + 1, 0);
                    break;
                  }
                }
                break;
              }
              for (const statement of fileNode.statements) {
                if (
                  // imports should generally come after 'export as' statements
                  statement instanceof ast.ExportAs ||

                  (completion.importAsModule ?

                    // 'import as' statements generally come first, and are sorted by path
                    (statement instanceof ast.ImportAs && statement.path.value < completion.importFrom) :

                    // 'import from' statements generally come after 'import as' statements
                    (statement instanceof ast.ImportAs ||
                      (statement instanceof ast.FromImport &&
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
                    `from '${completion.importFrom}' import ${completion.name}\n`)
              ];
            }
            item.sortText =
              // underscore methods are 'private' so should have lower priority
              (completion.name.startsWith('_') ? '~' :
                // You almost never need to explicitly specify 'Null' - especially compared to 'Number'
                completion.name === 'Null' ? '9' :
                  '5') + completion.name;
            items.push(item);
          }
        }
      }
      return items;
    },
  };
}
