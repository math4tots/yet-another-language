import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getSelectionOrAllText, writeToNewEditor } from './utils';

export async function runCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const printValues: string[] = [];
  const translation = await yal.translateToJavascript(editor.document);
  Function(`"use strict"; ${translation}`).bind({ printValues })();
  if (printValues.length > 0) {
    await writeToNewEditor(emit => {
      for (const value of printValues) emit(`${value}\n`);
    });
  }
}
