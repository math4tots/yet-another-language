import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { CallInstance } from '../lang/middleend/annotation';
import { getAnnotationForDocument } from '../lang/middleend/annotator';

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

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

      const parameterLabels = ci.parameters.map(
        parameter => `${parameter.identifier.name}: ${parameter.type}`);
      // const returnType = type.returnType.toString();

      const help = new vscode.SignatureHelp();
      const signature = new vscode.SignatureInformation(
        `(${parameterLabels.join(', ')})`
        // `(${parameterLabels.join(', ')}): ${returnType}`
      );
      help.signatures = [signature];
      help.activeSignature = 0;
      let activeParameter = 0;
      for (let i = 1; i <= ci.args.length; i++) {
        const end = toVSPosition(ci.args[i - 1].end);
        if (position.isAfter(end)) {
          activeParameter = Math.min(i, Math.max(0, ci.parameters.length - 1));
        }
      }
      // signature.documentation = method?.comment?.value;
      signature.activeParameter = help.activeParameter = activeParameter;
      for (const parameterLabel of parameterLabels) {
        signature.parameters.push(new vscode.ParameterInformation(parameterLabel));
      }
      return help;
    },
  };
}
