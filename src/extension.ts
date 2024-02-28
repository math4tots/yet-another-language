import * as vscode from 'vscode';
import { tokenizeCommand } from './extension/tokenize';
import { parseCommand } from './extension/parse';
import { runCommand } from './extension/run';
import { newDefinitionProvider } from './extension/definitionprovider';
import { Registry } from './extension/registry';
import { newHoverProvider } from './extension/hoverprovider';



export function activate(context: vscode.ExtensionContext) {
  const registry = new Registry();
  const sub = (item: vscode.Disposable) => context.subscriptions.push(item);
  sub(vscode.commands.registerCommand(
    'yal.tokenize',
    tokenizeCommand));
  sub(vscode.commands.registerCommand(
    'yal.parse',
    parseCommand));
  sub(vscode.commands.registerCommand(
    'yal.run',
    runCommand));

  sub(vscode.languages.registerDefinitionProvider(
    { language: 'yal' },
    newDefinitionProvider(registry)));
  sub(vscode.languages.registerHoverProvider(
    { language: 'yal' },
    newHoverProvider(registry)));
}
