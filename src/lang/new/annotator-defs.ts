import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import { translateVariableName } from './translator-util';
import type { ClassTypeType, InterfaceTypeType, ModuleType, Parameter, Type } from './type';
import type { Range } from '../frontend/lexer';

export type AnnotationError = ast.ParseError;

export type Value = null | boolean | number | string | Value[] | ModuleValue;

export const Continues = Symbol('Continues');
export const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
export const MaybeJumps = Symbol('MaybeJumps');
export type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

export class ModuleValue {
  constructor(annotation: Annotation) {
    for (const variable of annotation.moduleVariableMap.values()) {
      if (!variable.isMutable && variable.value !== undefined) {
        Object.defineProperty(this, translateVariableName(variable.identifier.name), {
          value: variable.value,
          enumerable: true,
          writable: false,
        });
      }
    }
  }
  toString() { return '<module>'; }
}

export type Variable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly comment?: ast.StringLiteral;
  readonly value?: Value;
};

export type ModuleVariable = Variable & {
  readonly type: ModuleType;
};

export type ClassVariable = Variable & {
  readonly type: ClassTypeType;
};

export type InterfaceVariable = Variable & {
  readonly type: InterfaceTypeType;
};

export type Reference = {
  readonly range: Range;
  readonly variable: Variable;
};

export interface PrintInstance {
  readonly range: Range;
  readonly value: Value;
}

export interface CallInstance {
  readonly range: Range; // range of entire call
  readonly args: Range[]; // range of individual arguments
  readonly parameters: Parameter[];
}

export interface Completion {
  readonly name: string;
  readonly detail?: string;
}

export interface CompletionPoint {
  readonly range: Range;
  getCompletions(): Completion[];
}

export type Annotation = {
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly errors: AnnotationError[];
  readonly variables: Variable[];
  readonly references: Reference[];
  readonly completionPoints: CompletionPoint[];
  readonly printInstances: PrintInstance[];
  readonly callInstances: CallInstance[];
  readonly moduleVariableMap: Map<string, Variable>;
  readonly importMap: Map<string, Annotation>;
  readonly modifiedAST: ast.File;
};
