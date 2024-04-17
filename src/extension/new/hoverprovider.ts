import * as vscode from 'vscode';
import * as yal from '../../lang/yal';
import { getAnnotationForDocument } from '../../lang/middleend/annotator';
import { AnyType } from '../../lang/middleend/type';
import { reprStaticValue } from '../../lang/middleend/value';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

function formatComment(s: string): string {
  if (!s.startsWith('\n')) return s;
  let i = 0;
  while (i < s.length && (s[i] === '\n' || s[i] === ' ')) i++;
  const prefix = s.substring(0, i);
  return s.replaceAll(prefix, '\n');
}

export function newNewHoverProvider(): vscode.HoverProvider {
  return {
    async provideHover(document, position, token) {
      const annotation = await getAnnotationForDocument(document);
      const markedStrings: vscode.MarkdownString[] = [];
      for (const reference of annotation.references) {
        const range = toVSRange(reference.range);
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
            (reference.variable.value ? ` = ${reprStaticValue(reference.variable.value)}` : '');
          definitionInfo.appendCodeblock(codeBlock);

          if (variable.comment) {
            const comment = new vscode.MarkdownString();
            markedStrings.push(comment);
            comment.appendMarkdown(formatComment(variable.comment.value));
          }
        }
      }
      return new vscode.Hover(markedStrings);
    },
  };
}
