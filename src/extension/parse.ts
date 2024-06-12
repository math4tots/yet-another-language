import * as vscode from 'vscode';
import { getSelectionOrAllText, writeToNewEditor } from './utils';
import { parse } from '../lang3/frontend/parser';
import { Node, ParseError } from '../lang3/frontend/ast';

function stripLocationsAndAddType(obj: any) {
  if (obj && typeof obj === 'object') {
    if (obj instanceof ParseError) {
      // keep
    } else if (Array.isArray(obj)) {
      for (const item of obj) stripLocationsAndAddType(item);
    } else {
      if (obj instanceof Node) {
        (obj as any).TYPE = obj.constructor.name;
      }
      for (const key in obj) {
        if (key === 'location') {
          delete (obj as any)[key];
        } else {
          stripLocationsAndAddType((obj as any)[key]);
        }
      }
    }
  }
}

export async function parseCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = getSelectionOrAllText(editor);
  const file = parse(text, '<input>');
  stripLocationsAndAddType(file);
  const string = JSON.stringify(file);

  await writeToNewEditor(emit => { emit(string); }, 'json');
}
