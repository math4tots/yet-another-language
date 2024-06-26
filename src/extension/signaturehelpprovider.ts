import * as vscode from 'vscode';
import { CallInstance } from '../lang/middleend/annotation';
import { getAnnotationForDocument } from '../lang/middleend/annotator';
import { toVSPosition, toVSRange } from '../lang/frontend/bridge-utils';

export function newSignatureHelpProvider(): vscode.SignatureHelpProvider {
  return {
    async provideSignatureHelp(document, position, token, context) {
      const annotation = await getAnnotationForDocument(document);
      let callInstance: CallInstance | undefined;
      for (const ci of annotation.callInstances) {
        if (toVSRange(ci.range).contains(position)) {
          callInstance = ci;
        }
      }
      const ci = callInstance;
      if (!ci) return null;

      const help = new vscode.SignatureHelp();
      help.signatures = [];

      for (const overload of ci.overloads) {
        const parameterLabels = overload.parameters.map(
          parameter => `${parameter.identifier.name}: ${parameter.type}`);
        // const returnType = type.returnType.toString();

        const signature = new vscode.SignatureInformation(
          `(${parameterLabels.join(', ')})`
          // `(${parameterLabels.join(', ')}): ${returnType}`
        );

        let activeParameter = 0;
        for (let i = 1; i <= ci.args.length; i++) {
          const end = toVSPosition(ci.args[i - 1].end);
          if (position.isAfter(end)) {
            activeParameter = Math.min(i, Math.max(0, overload.parameters.length - 1));
          }
        }
        // signature.documentation = method?.comment?.value;
        signature.activeParameter = help.activeParameter = activeParameter;
        for (const parameterLabel of parameterLabels) {
          signature.parameters.push(new vscode.ParameterInformation(parameterLabel));
        }
        help.signatures.push(signature);
      }

      help.activeSignature = 0;
      for (let i = 0; i < ci.overloads.length; i++) {
        if (ci.overloads[i].parameters.length >= ci.args.length) {
          help.activeSignature = i;
          break;
        }
      }
      return help;
    },
  };
}
