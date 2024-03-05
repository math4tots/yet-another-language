import * as vscode from 'vscode';
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


export function activate(context: vscode.ExtensionContext) {
  const sub = (item: vscode.Disposable) => context.subscriptions.push(item);
  const registry = new Registry();

  if (vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.languageId === 'yal') {
    registry.startUpdate(vscode.window.activeTextEditor.document);
  }

  // sub(vscode.workspace.onDidOpenTextDocument(async document => {
  //   if (document.languageId === 'yal') {
  //     registry.startUpdate(document);
  //   }
  // }));

  sub(vscode.workspace.onDidSaveTextDocument(async document => {
    if (document.languageId === 'yal') {
      registry.startUpdate(document);
    }
  }));

  sub(vscode.window.onDidChangeActiveTextEditor(async editor => {
    if (editor?.document.languageId === 'yal') {
      registry.startUpdate(editor.document);
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
    'yal.translateToJavascript',
    translateToJSCommand));

  sub(vscode.languages.registerDefinitionProvider(
    { language: 'yal' },
    newDefinitionProvider(registry)));
  sub(vscode.languages.registerHoverProvider(
    { language: 'yal' },
    newHoverProvider(registry)));
  sub(vscode.languages.registerCompletionItemProvider(
    { language: 'yal' },
    newCompletionProvider(registry), '.'));
  sub(vscode.languages.registerSignatureHelpProvider(
    { language: 'yal' },
    newSignatureHelpProvider(registry), '('));
  sub(vscode.languages.registerInlayHintsProvider(
    { language: 'yal' },
    newInlayHintsProvider(registry)));
}
