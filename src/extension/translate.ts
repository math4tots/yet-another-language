import * as vscode from 'vscode';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { joinUri } from '../lang/middleend/paths';
import { getJavascriptTranslationForDocument, getTranslationForDocument } from '../lang/backend/translator';
import { writeToNewEditor } from './utils';


export async function translateCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await getTranslationForDocument(editor.document);
  switch (translation.type) {
    case 'html':
      await writeToNewEditor(emit => { emit(translation.html); }, 'html');
      break;
    case 'javascript':
    default:
      await writeToNewEditor(emit => { emit(translation.javascript); }, 'javascript');
  }
}
