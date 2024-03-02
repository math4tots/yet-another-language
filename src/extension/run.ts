import * as vscode from 'vscode';
import * as yal from '../lang/yal';
import { getSelectionOrAllText, writeToNewEditor } from './utils';
// import { BASE_SCOPE, evaluate } from '../lang/evaluator';

export async function runCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = yal.parse(editor.document.uri, text);
  const codegen = new yal.JSCodegen();
  file.accept(codegen);
  const translation = yal.JS_PRELUDE + codegen.out;
  eval(translation);

  // const scope = yal.newScope(BASE_SCOPE);
  // await writeToNewEditor(emit => {
  //   scope['print'] = {
  //     isConst: true, value: (_: yal.Value, args: yal.Value[]) =>
  //       (args.length > 0 ? emit(`${yal.str(args[0])}\n`) : 0, null)
  //   };
  //   try {
  //     evaluate(file, scope);
  //   } catch (e) {
  //     if (e instanceof Error && e.stack) {
  //       emit(e.stack);
  //     } else {
  //       emit(`ERROR: ${e}`);
  //     }
  //   }
  // });
}
