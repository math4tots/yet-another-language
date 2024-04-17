import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';
import { getTranslationForDocument } from '../lang/backend/translator';

export async function translateToJSCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await getTranslationForDocument(editor.document);
  await writeToNewEditor(emit => { emit(translation); }, 'javascript');
}
