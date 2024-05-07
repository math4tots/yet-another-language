import * as vscode from 'vscode';
import { writeToNewEditor } from './utils';
import { getJavascriptTranslationForDocument, getTranslationForDocument } from '../lang/backend/translator';
import { strFunction } from '../lang/middleend/functions';

export async function runCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await getTranslationForDocument(editor.document, {
    omitDefaultPrintFunction: true,
  });

  switch (translation.type) {
    case 'html': {
      // The html runner will create a dummy HTML page and allow the generated code
      // to manipulate the dom as needed.
      const panel = vscode.window.createWebviewPanel(
        'yalhtml',
        'YAL',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
        }
      );
      panel.webview.html = translation.html;
      break;
    }
    case 'javascript':
    default: {
      // The default runner will print stdout and errors messages to a new buffer
      const printValues: string[] = [];
      try {
        // TODO: set timeout
        Function("YALprint", translation.javascript).bind({ printValues })(
          (x: any) => printValues.push(x));
      } catch (e) {
        if (e instanceof Error) {
          printValues.push((('' + (e as Error).stack) || (e as Error).message));
        }
      }
      if (printValues.length > 0) {
        await writeToNewEditor(emit => {
          for (const value of printValues) emit(`${strFunction(value)}\n`);
        });
      }
      break;
    }
  }
}
