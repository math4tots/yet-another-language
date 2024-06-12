import * as vscode from 'vscode';
import { getSelectionOrAllText, writeToNewEditor } from './utils';
import { parse } from '../lang3/frontend/parser';
import { Node, ParseError } from '../lang3/frontend/ast';

function format(obj: any): any {
  if (obj instanceof Node) {
    const ret: any = Object.create(null);
    ret.TYPE = obj.constructor.name;
    for (const key in obj) {
      if (key !== 'location') {
        ret[key] = format((obj as any)[key]);
      }
    }
    return ret;
  } else if (Array.isArray(obj)) {
    return obj.map(x => format(x));
  } else {
    return obj;
  }
}

export async function parseCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = parse(text, '<input>');
  const string = JSON.stringify(format(file));

  await writeToNewEditor(emit => { emit(string); }, 'json');
}
