import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { Registry } from "./registry";

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newCompletionProvider(registry: Registry): vscode.CompletionItemProvider {
  return {
    async provideCompletionItems(document, position, token, context) {
      const items: vscode.CompletionItem[] = [];
      const entry = await registry.update(document);
      for (const cpoint of entry.annotator.completionPoints) {
        const range = toVSRange(cpoint.range);
        if (range.contains(position)) {
          for (const completion of cpoint.getCompletions()) {
            const item = new vscode.CompletionItem(completion.name);
            if (completion.detail) {
              item.detail = completion.detail;
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
