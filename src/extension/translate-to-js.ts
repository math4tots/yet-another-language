import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';
import { getTranslationForDocument, translateFileBody, translateFileObject, translateFileThunk } from '../lang/new/translator';
import { getAstForDocument } from '../lang/parser';

export async function translateToJSCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await getTranslationForDocument(editor.document);
  await writeToNewEditor(emit => { emit(translation); }, 'javascript');
  // const translation = await yal.translateToJavascript(editor.document);
  // await writeToNewEditor(emit => { emit(translation); }, 'javascript');
}
