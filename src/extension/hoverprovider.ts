import * as vscode from 'vscode';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { AnyType } from '../lang/middleend/type';
import { reprFunction } from '../lang/middleend/functions';
import { toVSRange } from '../lang/frontend/bridge-utils';

function formatComment(s: string): string {
  if (!s.startsWith('\n')) return s;
  let i = 0;
  while (i < s.length && (s[i] === '\n' || s[i] === ' ')) i++;
  const prefix = s.substring(0, i);
  return s.replace(RegExp(prefix, 'g'), '\n').trim();
}

export function newHoverProvider(): vscode.HoverProvider {
  return {
    async provideHover(document, position, token) {
      const annotation = await getAnnotationForDocument(document);
      const markedStrings: vscode.MarkdownString[] = [];
      for (const reference of annotation.references) {
        if (reference.variable.isForwardDeclaration) continue;
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
            (reference.variable.value ? ` = ${reprFunction(reference.variable.value)}` : '');
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
