import * as vscode from 'vscode';
import { getAstForUri } from '../lang/frontend/parser';
import { findAllLibraryFiles, findAllYalFilesInWorkspace } from '../lang/middleend/paths';

export async function indexCommand() {
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "index YAL symbols",
    cancellable: true,
  }, async (progress, token) => {

    progress.report({ message: 'listing workspace' });
    const uris = [];
    for await (const uri of findAllYalFilesInWorkspace(token)) {
      uris.push(uri);
    }
    // Alternative quick and dirty way to list files:
    //   const uris = await vscode.workspace.findFiles('**/*.yal', undefined, undefined, token);
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
