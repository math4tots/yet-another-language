import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { Registry } from "./registry";

function toVSPosition(p: yal.Position): vscode.Position {
  return new vscode.Position(p.line, p.column);
}

function toVSRange(range: yal.Range): vscode.Range {
  return new vscode.Range(toVSPosition(range.start), toVSPosition(range.end));
}

export function newSignatureHelpProvider(registry: Registry): vscode.SignatureHelpProvider {
  return {
    async provideSignatureHelp(document, position, token, context) {
      const entry = await registry.update(document);
      let callInstance: yal.CallInstance | undefined;
      for (const ci of entry.annotator.callInstances) {
        if (toVSRange(ci.range).contains(position)) {
          callInstance = ci;
          break;
        }
      }
      const ci = callInstance;
      if (!ci) return null;

      const method = ci.value;
      const type = ci.type;
      const parameterLabels = type.parameterTypes.map((t, i) => `arg${i}: ${t}`);
      const returnType = type.returnType.toString();

      const help = new vscode.SignatureHelp();
      const signature = new vscode.SignatureInformation(
        `(${parameterLabels.join(', ')}): ${returnType}`);
      help.signatures = [signature];
      help.activeSignature = 0;
      let activeParameter = 0;
      for (let i = 1; i <= ci.args.length; i++) {
        const end = toVSPosition(ci.args[i - 1].end);
        if (position.isAfter(end)) {
          activeParameter = Math.min(i, Math.max(0, type.parameterTypes.length - 1));
        }
      }
      signature.documentation = method?.comment?.value;
      signature.activeParameter = help.activeParameter = activeParameter;
      for (const parameterLabel of parameterLabels) {
        signature.parameters.push(new vscode.ParameterInformation(parameterLabel));
      }
      return help;
    },
  };
}
