import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { toVSLocation, toVSRange } from '../lang/frontend/bridge-utils';

export function newDefinitionProvider(): vscode.DefinitionProvider {
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
