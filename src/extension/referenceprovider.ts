import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getAnnotationForDocument, getAnnotationForURI } from '../lang/middleend/annotator';
import { toVSLocation, toVSRange } from '../lang/frontend/bridge-utils';
import { Annotation, Variable } from '../lang/middleend/annotation';
import { findAllYalFilesInWorkspace } from '../lang/middleend/paths';

export function newReferenceProvider(): vscode.ReferenceProvider {
  return {
    async provideReferences(document, position, context, token) {
      const includeDeclaration = context.includeDeclaration;
      const currentAnntation = await getAnnotationForDocument(document);
      const variable = findVariable(currentAnntation, position);
      const locations: vscode.Location[] = [];
      for await (const annotation of findAllAnnotations(token)) {
        for (const reference of annotation.references) {
          if (reference.variable === variable && (includeDeclaration || !reference.isDeclaration)) {
            locations.push(toVSLocation({
              uri: annotation.uri,
              range: reference.range,
            }));
          }
        }
      }
      return locations;
    },
  };
}

async function* findAllAnnotations(token?: vscode.CancellationToken) {
  for await (const uri of findAllYalFilesInWorkspace(token)) {
    yield getAnnotationForURI(uri);
  }
}

function findVariable(annotation: Annotation, position: vscode.Position): Variable | undefined {
  for (const variable of annotation.variables) {
    const yalRange = variable.identifier.location?.range;
    if (!yalRange) continue;
    const range = toVSRange(yalRange);
    if (range.contains(position)) {
      return variable;
    }
  }
}
