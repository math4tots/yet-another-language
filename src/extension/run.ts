import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';
import { getTranslationForDocument } from '../lang/backend/translator';

export async function runCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const printValues: string[] = [];
  const translation = await getTranslationForDocument(editor.document, {
    omitDefaultPrintFunction: true,
  });
  try {
    // TODO: set timeout
    Function("YALprint", translation).bind({ printValues })(
      (x: any) => printValues.push(x));
  } catch (e) {
    if (e instanceof Error) {
      printValues.push((('' + (e as Error).stack) || (e as Error).message));
    }
  }
  if (printValues.length > 0) {
    await writeToNewEditor(emit => {
      for (const value of printValues) emit(`${value}\n`);
    });
  }
}
