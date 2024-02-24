import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getSelectionOrAllText, writeToNewEditor } from './utils';



export async function tokenizeCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const tokens = yal.lex(text);

  await writeToNewEditor(emit => {
    for (const token of tokens) {
      emit(`${token.range.start.line + 1}:${token.range.start.column + 1} - ` +
        token.type + (token.value ? ' ' + JSON.stringify(token.value) : '') +
        '\n');
    }
  });
}
