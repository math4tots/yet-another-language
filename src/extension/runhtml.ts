import * as vscode from 'vscode';
import { getTranslationForDocument } from '../lang/backend/translator';

export async function runHTMLCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const translation = await getTranslationForDocument(editor.document);
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YAL VIEW</title>
  </head>
  <body>
    <script>${translation}</script>
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
}
