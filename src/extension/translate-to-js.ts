import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getSelectionOrAllText, writeToNewEditor } from './utils';
// import { BASE_SCOPE, evaluate } from '../lang/evaluator';

export async function translateToJSCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = yal.parse(editor.document.uri, text);
  const codegen = new yal.JSCodegen();
  file.accept(codegen);
  const translation = yal.JS_PRELUDE + codegen.out;

  await writeToNewEditor(emit => {
    emit(translation);
  }, 'javascript');
}
