import * as vscode from 'vscode';

export function getSelectionOrAllText(editor: vscode.TextEditor) {
  const selection =
    editor.selection.isEmpty ?
      new vscode.Range(
        editor.document.lineAt(0).range.start,
        editor.document.lineAt(editor.document.lineCount - 1).range.end) :
      new vscode.Range(
        editor.selection.start,
        editor.selection.end);
  return editor.document.getText(selection);
}

export async function writeToNewEditor(
  f: (emit: (m: string) => void) => void,
  language: string = 'plaintext') {
  const document = await vscode.workspace.openTextDocument({
    content: '',
    language: language,
  });
  let insertText = '';
  function emit(m: string) {
    insertText += m;
  }
  f(emit);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(0, 0), insertText);
  if (await vscode.workspace.applyEdit(edit)) {
    vscode.window.showTextDocument(document);
  }
}
