import * as vscode from 'vscode';
import { tokenizeCommand } from './extension/commands';



export function activate(context: vscode.ExtensionContext) {
  const sub = (item: vscode.Disposable) => context.subscriptions.push(item);
  sub(vscode.commands.registerCommand(
    'yal.tokenize',
    tokenizeCommand));
}
