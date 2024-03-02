import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';

export async function translateToJSCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await yal.translateToJavascript(editor.document);
  await writeToNewEditor(emit => { emit(translation); }, 'javascript');
}
