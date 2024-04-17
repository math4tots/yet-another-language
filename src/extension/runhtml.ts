import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { writeToNewEditor } from './utils';

export async function runHTMLCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  // const translation = await yal.translateToJavascript(editor.document);
  // const javascript = `"use strict";${translation}`;
  // const html = `<!DOCTYPE html>
  // <html lang="en">
  // <head>
  //   <meta charset="UTF-8">
  //   <meta name="viewport" content="width=device-width, initial-scale=1.0">
  //   <title>YAL VIEW</title>
  // </head>
  // <body>
  //   <script>${javascript}</script>
  // </body>
  // </html>`;
  // const panel = vscode.window.createWebviewPanel(
  //   'yalhtml',
  //   'YAL',
  //   vscode.ViewColumn.Active,
  //   {
  //     enableScripts: true,
  //   }
  // );
  // panel.webview.html = html;
}
