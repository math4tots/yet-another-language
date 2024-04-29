import * as vscode from 'vscode';
import { writeToNewEditor } from './utils';
import { getTranslationForDocument } from '../lang/backend/translator';
import { strFunction } from '../lang/middleend/functions';
import { getAnnotationForDocument } from '../lang/middleend/annotator';

export async function runCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const annotation = await getAnnotationForDocument(editor.document);
  const configs = annotation.compileTimeConfigs;
  switch (configs.target) {
    case 'html': {
      // The html runner will create a dummy HTML page and allow the generated code
      // to manipulate the dom as needed.
      const translation = await getTranslationForDocument(editor.document);
      const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YAL VIEW</title>
  </head>
  <body>
    <script type='module'>${translation}</script>
  </body>
  </html>`;
      const panel = vscode.window.createWebviewPanel(
        'yalhtml',
        'YAL',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
        }
      );
      panel.webview.html = html;
      break;
    }
    case 'default':
    default: {
      // The default runner will print stdout and errors messages to a new buffer
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
          for (const value of printValues) emit(`${strFunction(value)}\n`);
        });
      }
      break;
    }
  }
}
