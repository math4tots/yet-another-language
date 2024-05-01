import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";


export const LIBRARY_URIS: vscode.Uri[] = [];

export type ResolveResult = { uri: vscode.Uri, error?: string; };

// When importing `rawPath` from file `srcURI`, this function resolves the `rawPath` into a Uri
export async function resolveURI(srcURI: vscode.Uri, rawPath: string): Promise<ResolveResult> {
  if (!rawPath.endsWith('.yal')) {
    rawPath = rawPath + '.yal';
  }
  if (rawPath.startsWith('/')) {
    // absolute path. Not yet supported
    return { uri: srcURI, error: `Absolute import paths not yet supported` };
  }
  if (rawPath.startsWith('@/')) {
    // path relative to workspace root
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        const folderUri = folder.uri;
        if (srcURI.path.startsWith(folderUri.path)) {
          const importURI = joinUri(folderUri, rawPath.substring('@/'.length));
          return { uri: importURI };
        }
      }
    }
  }
  if (rawPath.startsWith('./')) {
    // relative path
    return { uri: joinUri(getParentUri(srcURI), rawPath.substring('./'.length)) };
  }
  for (const libraryURI of LIBRARY_URIS) {
    const importURI = joinUri(libraryURI, rawPath);
    try {
      // If URI exists, return this one
      await vscode.workspace.fs.stat(importURI);
      return { uri: importURI };
    } catch (e) {
      // URI does not exist - continue the loop to find another
    }
  }
  return {
    uri: srcURI,
    error: `Module ${JSON.stringify(rawPath)} not found`
  };
}

export function joinUri(uri: vscode.Uri, ...components: string[]): vscode.Uri {
  return vscode.Uri.from({
    authority: uri.authority,
    fragment: uri.fragment,
    path: uri.path + components.map(c => `/${c}`).join(''),
    query: uri.query,
    scheme: uri.scheme,
  });
}

export function getParentUri(uri: vscode.Uri): vscode.Uri {
  const originalPath = uri.path;
  const slashIndex = originalPath.lastIndexOf('/');
  if (slashIndex < 0) {
    return uri; // cannot get parent (path does not contain '/')
  }
  return vscode.Uri.from({
    authority: uri.authority,
    fragment: uri.fragment,
    path: originalPath.substring(0, slashIndex),
    query: uri.query,
    scheme: uri.scheme,
  });
}

export function startsWithUri(uri: vscode.Uri, prefix: vscode.Uri): boolean {
  return uri.path.startsWith(prefix.path + '/');
}

/** A module is 'private' if its filename starts with '_' */
export function isPrivateModuleUri(uri: vscode.Uri): boolean {
  return isPrivateModuleUriPath(uri.path);
}

/** A module is 'private' if its filename starts with '_' */
function isPrivateModuleUriPath(path: string): boolean {
  const slashIndex = path.lastIndexOf('/');
  if (slashIndex < 0) return false;
  const basename = path.substring(slashIndex + 1);
  return basename.startsWith('_');
}

function stripYALExtension(s: string): string {
  return s.endsWith('.yal') ? s.substring(0, s.length - 4) : s;
}

export function getImportPath(uriString: string, startingUriString: string): string {
  const slashIndex = startingUriString.lastIndexOf('/');
  if (slashIndex !== -1) {
    const folderUri = startingUriString.substring(0, slashIndex + 1);
    if (uriString.startsWith(folderUri)) {
      return stripYALExtension('./' + uriString.substring(folderUri.length));
    }
  }
  for (const root of LIBRARY_URIS) {
    const folderUri = root.toString() + '/';
    if (uriString.startsWith(folderUri)) {
      return stripYALExtension(uriString.substring(folderUri.length));
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const folder of folders) {
      const prefix = folder.uri.toString() + '/';
      if (startingUriString.startsWith(prefix) && uriString.startsWith(prefix)) {
        return '@/' + stripYALExtension(uriString.substring(prefix.length));
      }
    }
  }
  return stripYALExtension(uriString);
}

async function* findYalFiles(dir: string, token?: vscode.CancellationToken, atRootDir = false):
  AsyncGenerator<string, undefined, undefined> {
  const subdirectories = [];
  const files = [];
  for await (const d of await fs.promises.opendir(dir)) {
    if (token?.isCancellationRequested) return;
    const name = d.name;
    const entry = path.join(dir, name);
    if (!name.startsWith('.') && d.isDirectory()) subdirectories.push(entry);
    else if (name.endsWith('.yal') && d.isFile()) files.push(entry);
  }

  // Only investigate this directory further if either
  //   * this is a root directory, or
  //   * it contains at least 1 yal file
  if (atRootDir || (files.length > 0)) {
    if (token?.isCancellationRequested) return;
    yield* files;
    for (const subdiredtory of subdirectories) {
      if (token?.isCancellationRequested) return;
      yield* findYalFiles(subdiredtory, token);
    }
  }
}

export async function* findAllLibraryFiles(token?: vscode.CancellationToken): AsyncGenerator<vscode.Uri> {
  for (const libraryUri of LIBRARY_URIS) {
    const libraryPath = libraryUri.fsPath;
    for await (const yalFilePath of findYalFiles(libraryPath, token)) {
      if (token?.isCancellationRequested) return;
      yield vscode.Uri.file(yalFilePath);
    }
  }
}

export async function* findAllYalFilesInWorkspace(token?: vscode.CancellationToken): AsyncGenerator<vscode.Uri> {
  for (const workspaceFolder of (vscode.workspace.workspaceFolders || [])) {
    for await (const path of findYalFiles(workspaceFolder.uri.fsPath, token)) {
      yield vscode.Uri.file(path);
    }
  }
}
