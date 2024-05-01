import * as vscode from 'vscode';
import * as yal from './lang/yal';
import { tokenizeCommand } from './extension/tokenize';
import { parseCommand } from './extension/parse';
import { runCommand } from './extension/run';
import { translateToJSCommand } from './extension/translate-to-js';
import { newDefinitionProvider } from './extension/definitionprovider';
import { newHoverProvider } from './extension/hoverprovider';
import { newCompletionProvider } from './extension/completionprovider';
import { newInlayHintsProvider } from './extension/inlayhintsprovider';
import { newSignatureHelpProvider } from './extension/signaturehelpprovider';
import { getAnnotationForDocument } from './lang/middleend/annotator';
import { indexCommand } from './extension/indexer';
import { newReferenceProvider } from './extension/referenceprovider';
import { joinUri } from './lang/middleend/paths';


export function activate(context: vscode.ExtensionContext) {
  const extensionURI = context.extensionUri;
  yal.LIBRARY_URIS.push(joinUri(extensionURI, 'yallib'));

  const sub = (item: vscode.Disposable) => context.subscriptions.push(item);

  indexCommand();
  // crawlAndIndex();

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
    () => runCommand(context)));
  sub(vscode.commands.registerCommand(
    'yal.translateToJavascript',
    translateToJSCommand));
  sub(vscode.commands.registerCommand(
    'yal.index',
    indexCommand));

  sub(vscode.languages.registerDefinitionProvider(
    { language: 'yal' },
    newDefinitionProvider()));
  sub(vscode.languages.registerReferenceProvider(
    { language: 'yal' },
    newReferenceProvider()));
  sub(vscode.languages.registerHoverProvider(
    { language: 'yal' },
    newHoverProvider()));
  sub(vscode.languages.registerCompletionItemProvider(
    { language: 'yal' },
    newCompletionProvider(), '.', '"'));
  sub(vscode.languages.registerSignatureHelpProvider(
    { language: 'yal' },
    newSignatureHelpProvider(), '('));
  sub(vscode.languages.registerInlayHintsProvider(
    { language: 'yal' },
    newInlayHintsProvider()));

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
