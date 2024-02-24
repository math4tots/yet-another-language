import * as vscode from 'vscode';
import { tokenizeCommand } from './extension/tokenize';
import { parseCommand } from './extension/parse';
import { runCommand } from './extension/run';



export function activate(context: vscode.ExtensionContext) {
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
}
