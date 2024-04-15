import * as vscode from 'vscode';
import * as yal from './lang/yal';
import { tokenizeCommand } from './extension/tokenize';
import { parseCommand } from './extension/parse';
import { runCommand } from './extension/run';
import { newDefinitionProvider } from './extension/definitionprovider';
import { Registry } from './extension/registry';
import { newHoverProvider } from './extension/hoverprovider';
import { newCompletionProvider } from './extension/completionprovider';
import { newInlayHintsProvider } from './extension/inlayhintsprovider';
import { translateToJSCommand } from './extension/translate-to-js';
import { newSignatureHelpProvider } from './extension/signaturehelpprovider';
import { runHTMLCommand } from './extension/runhtml';
import { newNewDefinitionProvider } from './extension/new/definitionprovider';
import { getAnnotationForDocument } from './lang/new/annotator';
import { newNewHoverProvider } from './extension/new/hoverprovider';
import { newNewCompletionProvider } from './extension/new/completionprovider';
import { newNewInlayHintsProvider } from './extension/new/inlayhintsprovider';
import { newNewSignatureHelpProvider } from './extension/new/signaturehelpprovider';


export function activate(context: vscode.ExtensionContext) {
  const extensionURI = context.extensionUri;
  yal.LIBRARY_URIS.push(vscode.Uri.from({
    authority: extensionURI.authority,
    fragment: extensionURI.fragment,
    path: extensionURI.path + '/yallib',
    query: extensionURI.query,
    scheme: extensionURI.scheme,
  }));

  const sub = (item: vscode.Disposable) => context.subscriptions.push(item);
  // const registry = new Registry();

  if (vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.languageId === 'yal') {
    // registry.startUpdate(vscode.window.activeTextEditor.document);
    getAnnotationForDocument(vscode.window.activeTextEditor.document);
  }

  sub(vscode.workspace.onDidSaveTextDocument(async document => {
    if (document.languageId === 'yal') {
      // registry.startUpdate(document);
      getAnnotationForDocument(document);
    }
  }));

  sub(vscode.window.onDidChangeActiveTextEditor(async editor => {
    if (editor?.document.languageId === 'yal') {
      // registry.startUpdate(editor.document);
      getAnnotationForDocument(editor.document);
    }
  }));

  sub(vscode.commands.registerCommand(
    'yal.tokenize',
    tokenizeCommand));
  sub(vscode.commands.registerCommand(
    'yal.parse',
    parseCommand));
  sub(vscode.commands.registerCommand(
    'yal.run',
    runCommand));
  sub(vscode.commands.registerCommand(
    'yal.runhtml',
    runHTMLCommand));
  sub(vscode.commands.registerCommand(
    'yal.translateToJavascript',
    translateToJSCommand));

  sub(vscode.languages.registerDefinitionProvider(
    { language: 'yal' },
    newNewDefinitionProvider()));
  sub(vscode.languages.registerHoverProvider(
    { language: 'yal' },
    newNewHoverProvider()));
  sub(vscode.languages.registerCompletionItemProvider(
    { language: 'yal' },
    newNewCompletionProvider(), '.'));
  sub(vscode.languages.registerSignatureHelpProvider(
    { language: 'yal' },
    newNewSignatureHelpProvider(), '('));
  sub(vscode.languages.registerInlayHintsProvider(
    { language: 'yal' },
    newNewInlayHintsProvider()));

  // sub(vscode.languages.registerDefinitionProvider(
  //   { language: 'yal' },
  //   newDefinitionProvider(registry)));
  // sub(vscode.languages.registerHoverProvider(
  //   { language: 'yal' },
  //   newHoverProvider(registry)));
  // sub(vscode.languages.registerCompletionItemProvider(
  //   { language: 'yal' },
  //   newCompletionProvider(registry), '.'));
  // sub(vscode.languages.registerSignatureHelpProvider(
  //   { language: 'yal' },
  //   newSignatureHelpProvider(registry), '('));
  // sub(vscode.languages.registerInlayHintsProvider(
  //   { language: 'yal' },
  //   newInlayHintsProvider(registry)));
}
