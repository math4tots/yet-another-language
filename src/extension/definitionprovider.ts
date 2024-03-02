import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { Registry } from './registry';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

function toVSLocation(location: yal.Location): vscode.Location {
  return new vscode.Location(location.uri, toVSRange(location.range));
}

export function newDefinitionProvider(registry: Registry): vscode.DefinitionProvider {
  return {
    async provideDefinition(document, position, token) {
      const entry = await registry.update(document);

      for (const reference of entry.annotator.references) {
        const range = toVSRange(reference.identifier.location.range);
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
