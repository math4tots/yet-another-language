import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import { Range } from '../frontend/lexer';
import type { Value } from './value';
import type {
  Parameter,
  Type,
  ModuleType,
  ClassTypeType,
  InterfaceTypeType,
  EnumTypeType,
  EnumType,
} from './type';

export type AnnotationError = ast.ParseError;

export type Variable = {
  readonly isMutable?: boolean;
  readonly identifier: ast.Identifier;
  readonly type: Type;
  readonly comment?: ast.StringLiteral;
  readonly value?: Value;
  readonly isForwardDeclaration?: boolean,
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

export type EnumVariable = Variable & {
  readonly type: EnumTypeType;
};

export type EnumConstVariable = Variable & {
  readonly type: EnumType;
  readonly value: string;
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
  readonly importFrom?: string;
}

export interface CompletionPoint {
  readonly range: Range;
  getCompletions(): Completion[];
}

export type MemberImport = {
  readonly isExported: boolean;
  readonly moduleVariable: ModuleVariable;
  readonly memberVariable: Variable;
};

export type AnnotationWithoutIR = {
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly errors: AnnotationError[];
  readonly variables: Variable[];
  readonly references: Reference[];
  readonly completionPoints: CompletionPoint[];
  readonly printInstances: PrintInstance[];
  readonly callInstances: CallInstance[];
  readonly exportMap: Map<string, Variable>;
  readonly importMap: Map<string, Annotation>;
  readonly importAliasVariables: ModuleVariable[];
  readonly memberImports: MemberImport[];
};

export type Annotation = AnnotationWithoutIR & {
  readonly ir: ast.File;
};
