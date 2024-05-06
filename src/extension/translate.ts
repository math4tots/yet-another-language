import * as vscode from 'vscode';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { joinUri } from '../lang/middleend/paths';
import { getTranslationForDocument } from '../lang/backend/translator';
import { writeToNewEditor } from './utils';


export async function translateCommand(context: vscode.ExtensionContext) {
  const extensionURI = context.extensionUri;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const annotation = await getAnnotationForDocument(editor.document);
  const configs = annotation.compileTimeConfigs;
  const libUris = Array.from(configs.jsLibs).map(lib => joinUri(extensionURI, 'jslib', lib));
  const libSources = [];
  for (const uri of libUris) {
    libSources.push((await vscode.workspace.openTextDocument(uri)).getText());
  }
  const translation = await getTranslationForDocument(editor.document, {
    omitDefaultPrintFunction: true,
    addToPrelude: libSources.join(''),
  });
  switch (configs.target) {
    case 'html': {
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
      await writeToNewEditor(emit => { emit(html); }, 'html');
      break;
    }
    case 'default':
    default: {
      await writeToNewEditor(emit => { emit(translation); }, 'javascript');
    }
  }
}
