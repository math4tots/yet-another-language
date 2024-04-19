import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAstForDocument } from '../frontend/parser';
import { LIBRARY_URIS } from './paths';



export async function crawlAndIndex() {
  try {
    await _crawlAndIndex();
  } catch (e) {
    console.log(`crawAndIndex ERROR`, e);
  }
}

async function _crawlAndIndex() {

  // WORKSPACE FILES
  const uris = await vscode.workspace.findFiles('**/*.ts');
  for (const uri of uris) {
    try {
      getAstForDocument(await vscode.workspace.openTextDocument(uri));
    } catch (e) {
      // if a single document fails, go on to the next one
      console.log(`crawlAndIndex: failed to index uri`, uri);
    }
  }

  // LIBRARY FILES
  for (const libraryUri of LIBRARY_URIS) {
    const libraryPath = libraryUri.fsPath;
    for await (const yalFilePath of findYalFiles(libraryPath)) {
      const uri = vscode.Uri.file(yalFilePath);
      try {
        getAstForDocument(await vscode.workspace.openTextDocument(uri));
      } catch (e) {
        // if a single document fails, go on to the next one
        console.log(`crawlAndIndex: failed to index uri`, uri);
      }
    }
  }
}

async function* findYalFiles(dir: string): AsyncGenerator<string> {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* findYalFiles(entry);
    else if (d.name.endsWith('.yal') && d.isFile()) yield entry;
  }
}
