import * as vscode from 'vscode';
import * as yal from '../../lang/yal';
import { getAnnotationForDocument } from '../../lang/new/annotator';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

function toVSLocation(location: yal.Location): vscode.Location {
  return new vscode.Location(location.uri, toVSRange(location.range));
}

export function newNewDefinitionProvider(): vscode.DefinitionProvider {
  return {
    async provideDefinition(document, position, token) {
      const annotation = await getAnnotationForDocument(document);

      for (const reference of annotation.references) {
        const range = toVSRange(reference.range);
        if (range.contains(position)) {
          const location = reference.variable.identifier.location;
          if (location) {
            return toVSLocation(location);
          }
        }
      }
      return null;
    },
  };
}
