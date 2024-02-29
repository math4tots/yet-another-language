import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { Registry } from './registry';
import { AnyType } from '../lang/type';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newHoverProvider(registry: Registry): vscode.HoverProvider {
  return {
    async provideHover(document, position, token) {
      const entry = registry.update(document);
      const markedStrings: vscode.MarkdownString[] = [];
      for (const reference of entry.annotator.references) {
        const range = toVSRange(reference.identifier.location.range);
        if (range.contains(position)) {
          const definitionInfo = new vscode.MarkdownString();
          markedStrings.push(definitionInfo);
          const variable = reference.variable;
          const variableName = variable.identifier.name;
          const type = reference.variable.type;
          const storageClass = reference.variable.isMutable ? 'var' : 'const';
          const codeBlock =
            `${storageClass} ${variableName}` +
            (type === AnyType ? '' : `: ${type}`) +
            (reference.variable.value ? ` = ${yal.reprValue(reference.variable.value)}` : '');
          definitionInfo.appendCodeblock(codeBlock);
        }
      }
      return new vscode.Hover(markedStrings);
    },
  };
}
