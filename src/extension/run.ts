import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';

export async function runCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const printValues: string[] = [];
  const translation = await yal.translateToJavascript(editor.document, `
  printHandler = x => this.printValues.push(x);
  `);
  try {
    Function(`"use strict"; ${translation}`).bind({ printValues })();
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
