import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAstForUri } from '../lang/frontend/parser';
import { LIBRARY_URIS } from '../lang/yal';

export async function indexCommand() {
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "index YAL symbols",
    cancellable: true,
  }, async (progress, token) => {

    progress.report({ message: 'listing workspace' });
    const uris = await vscode.workspace.findFiles('**/*.ts', undefined, undefined, token);
    if (token.isCancellationRequested) return;

    progress.report({ message: 'listing library' });
    for await (const uri of findAllLibraryFiles(token)) {
      uris.push(uri);
      if (token.isCancellationRequested) return;
    }
    if (token.isCancellationRequested) return;

    progress.report({ message: 'inspecting files' });
    const uriCount = uris.length;
    let processCount = 0;
    if (token.isCancellationRequested) return;
    for (const uri of uris) {
      await getAstForUri(uri);
      if (token.isCancellationRequested) return;
      processCount++;
      progress.report({
        message: `inspecting ${uri}`,
        increment: (processCount / uriCount) * 100
      });
    }
  });
}

async function* findAllLibraryFiles(token: vscode.CancellationToken): AsyncGenerator<vscode.Uri> {
  for (const libraryUri of LIBRARY_URIS) {
    const libraryPath = libraryUri.fsPath;
    for await (const yalFilePath of findYalFiles(libraryPath, token)) {
      if (token.isCancellationRequested) return;
      yield vscode.Uri.file(yalFilePath);
    }
  }
}

async function* findYalFiles(dir: string, token: vscode.CancellationToken): AsyncGenerator<string> {
  for await (const d of await fs.promises.opendir(dir)) {
    if (token.isCancellationRequested) return;
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* findYalFiles(entry, token);
    else if (d.name.endsWith('.yal') && d.isFile()) yield entry;
  }
}
