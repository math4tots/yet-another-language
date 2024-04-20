import * as vscode from "vscode";


export const LIBRARY_URIS: vscode.Uri[] = [];

function getParentPath(path: string): string {
  let i = path.length;
  while (i > 0 && path[i - 1] !== '/') i--;
  i--;
  return path.substring(0, i);
}

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
  if (rawPath.startsWith('./')) {
    // relative path
    return {
      uri: vscode.Uri.from({
        authority: srcURI.authority,
        fragment: srcURI.fragment,
        path: getParentPath(srcURI.path) + rawPath.substring(1),
        query: srcURI.query,
        scheme: srcURI.scheme,
      })
    };
  }
  for (const libraryURI of LIBRARY_URIS) {
    const importURI = vscode.Uri.from({
      authority: libraryURI.authority,
      fragment: libraryURI.fragment,
      path: libraryURI.path + '/' + rawPath,
      query: libraryURI.query,
      scheme: libraryURI.scheme,
    });
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
  return stripYALExtension(uriString);
}
