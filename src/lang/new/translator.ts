import * as vscode from 'vscode';
import * as ast from '../ast';
import { getAstForDocument } from '../parser';


type Result = string;

interface Value {
  readonly value?: any;
  test(): boolean;
  equals(other: Value): boolean;
  toRepr(): string;
  toString(): string;
}

class CLASSNil implements Value {
  static readonly INSTANCE = new CLASSNil();
  private constructor() { }
  test(): boolean { return false; }
  equals(other: Value): boolean { return this === other; }
  toRepr(): string { return 'nil'; }
  toString(): string { return 'nil'; }
}
class CLASSBool implements Value {
  static readonly TRUE = new CLASSBool(true);
  static readonly FALSE = new CLASSBool(false);
  readonly value: boolean;
  private constructor(value: boolean) { this.value = value; }
  test(): boolean { return this.value; }
  equals(other: Value): boolean { return this === other || this.value === other.value; }
  toRepr(): string { return this.value ? 'true' : 'false'; }
  toString(): string { return this.value ? 'true' : 'false'; }
  valueOf(): boolean { return this.value; }
}
class CLASSNumber implements Value {
  static of(value: number): CLASSNumber { return new CLASSNumber(value); }
  readonly value: number;
  private constructor(value: number) { this.value = value; }
  test(): boolean { return true; }
  equals(other: Value): boolean { return this === other || this.value === other.value; }
  toRepr(): string { return `${this.value}`; }
  toString(): string { return `${this.value}`; }
  valueOf(): number { return this.value; }
}
class CLASSString implements Value {
  static of(value: string): CLASSString { return new CLASSString(value); }
  readonly value: string;
  private constructor(value: string) { this.value = value; }
  test(): boolean { return true; }
  equals(other: Value): boolean { return this === other || this.value === other.value; }
  toRepr(): string { return JSON.stringify(this.value); }
  toString(): string { return this.value; }
  valueOf(): string { return this.value; }
}
class CLASSList implements Value {
  static using(value: Value[]): CLASSList { return new CLASSList(value); }
  static of(value: Value[]): CLASSList { return new CLASSList([...value]); }
  readonly value: Value[];
  private constructor(value: Value[]) { this.value = value; }
  test(): boolean { return true; }
  equals(other: Value): boolean {
    const rhs = other;
    return this === rhs ||
      this.value === rhs.value ||
      (rhs instanceof CLASSList &&
        this.value.length === rhs.value.length &&
        this.value.every((v, i) => v.equals(rhs.value[i])));
  }
  toRepr(): string { return `[${this.value.map(v => v.toRepr()).join(', ')}]`; }
  toString(): string { return this.toRepr(); }
}
class CLASSFunction implements Value {
  static of(value: Function): CLASSFunction { return new CLASSFunction(value); }
  readonly value: Function;
  private constructor(value: Function) { this.value = value; }
  test(): boolean { return true; }
  equals(other: Value): boolean { return this === other || this.value === other.value; }
  toRepr(): string { return `<function ${this.value.name}>`; }
  toString(): string { return this.toRepr(); }
}
class CLASSClass implements Value {
  static of(value: { new(...args: any[]): Value; }): CLASSClass { return new CLASSClass(value); }
  readonly value: { new(...args: any[]): Value; };
  private constructor(value: { new(...args: any[]): Value; }) { this.value = value; }
  test(): boolean { return true; }
  equals(other: Value): boolean { return this === other || this.value === other.value; }
  toRepr(): string { return `<class ${this.value.name}>`; }
  toString(): string { return this.toRepr(); }
}

const NIL = CLASSNil.INSTANCE;
const TRUE = CLASSBool.TRUE;
const FALSE = CLASSBool.FALSE;

export const PRELUDE = `
class CLASSNil {
  test(){return false}
  equals(other){return this===other}
  toRepr(){return 'nil'}
  toString(){return 'nil'}
}
const NIL = new CLASSNil();
class CLASSBool {
  static of(value){return value?TRUE:FALSE}
  constructor(value){this.value=value}
  test(){return this.value}
  equals(other){return this===other||this.value===other.value}
  toRepr(){return this.value?'true':'false'}
  toString(){return this.value?'true':'false'}
}
const TRUE = new CLASSBool(true);
const FALSE = new CLASSBool(false);
class CLASSNumber {
  static of(value){return new CLASSNumber(value)}
  constructor(value){this.value=value}
  test(){return true}
  equals(other){return this===other||this.value===other.value}
  toRepr(){return ''+this.value}
  toString(){return ''+this.value}
  YAL__add__(rhs){return CLASSNumber.of(this.value+rhs.value)}
  YAL__lt__(rhs){return CLASSBool.of(this.value < rhs.value)}
}
class CLASSString {
  static of(value){return new CLASSString(value)}
  constructor(value){this.value=value}
  test(){return true}
  equals(other){return this===other||this.value===other.value}
  toRepr(){return ''+this.value}
  toString(){return ''+this.value}
  YAL__add__(rhs){return CLASSString.of(this.value+rhs.value)}
}
class CLASSList {
  static using(value){return new CLASSList(value)}
  static of(value){return new CLASSList([...value])}
  constructor(value){this.value=value}
  test(){return true}
  equals(other){
    const rhs = other;
    return this === rhs ||
      this.value === rhs.value ||
      (rhs instanceof CLASSList &&
        this.value.length === rhs.value.length &&
        this.value.every((v, i) => v.equals(rhs.value[i])));
  }
  toRepr(){return '[' + this.value.map(v => v.toRepr()).join(',') + ']'}
  toString(){return this.toRepr()}
}
class CLASSFunction {
  static of(value) { return new CLASSFunction(value); }
  constructor(value) { this.value = value; }
  test() { return true; }
  equals(other) { return this === other || this.value === other.value; }
  toRepr() { return '<function ' + this.value.name + '>'; }
  toString() { return this.toRepr(); }
  YAL__call__(...args){return this.value(...args) || NIL;}
}
class CLASSClass {
  static of(value){ return new CLASSClass(value); }
  constructor(value) { this.value = value; }
  test() { return true; }
  equals(other) { return this === other || this.value === other.value; }
  toRepr(){ return '<class ' + this.value.name + '>'; }
  toString(){ return this.toRepr(); }
}
const YALprint = CLASSFunction.of(x => console.log(x.toString()));
`;

/**
 * Translates YAL to JavaScript
 */
class Translator implements ast.ExpressionVisitor<Result>, ast.StatementVisitor<Result> {
  visitNilLiteral(n: ast.NilLiteral): Result {
    return 'NIL';
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): Result {
    return n.value ? 'TRUE' : 'FALSE';
  }
  visitNumberLiteral(n: ast.NumberLiteral): Result {
    return `CLASSNumber.of(${n.value})`;
  }
  visitStringLiteral(n: ast.StringLiteral): Result {
    return `CLASSString.of(${JSON.stringify(n.value)})`;
  }
  visitIdentifierNode(n: ast.IdentifierNode): Result {
    if (n.name === 'this') return 'this';
    return `YAL${n.name}`;
  }
  visitAssignment(n: ast.Assignment): Result {
    return `(YAL${n.identifier.name}=${n.value.accept(this)})`;
  }
  visitListDisplay(n: ast.ListDisplay): Result {
    return `[${n.values.map(e => e.accept(this)).join(',')}]`;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): Result {
    return `CLASSFunction.of((${n.parameters.map(p => `YAL${p.identifier.name}`).join(',')}) => ${n.body.accept(this)})`;
  }
  visitMethodCall(n: ast.MethodCall): Result {
    return `${n.owner.accept(this)}.YAL${n.identifier.name}(${n.args.map(e => e.accept(this)).join(',')})`;
  }
  visitNew(n: ast.New): Result {
    const te = n.type;
    const type = te.qualifier ? `YAL${te.qualifier.name}.CLASS${te.identifier.name}` : `CLASS${te.identifier.name}`;
    return `new ${type}(${n.args.map(e => e.accept(this)).join(',')})`;
  }
  visitLogicalNot(n: ast.LogicalNot): Result {
    return `(${n.value.accept(this)}.test()?FALSE:TRUE)`;
  }
  visitLogicalAnd(n: ast.LogicalAnd): Result {
    return `(${n.lhs.accept(this)}.test()&&${n.rhs.accept(this)}.test()?TRUE:FALSE)`;
  }
  visitLogicalOr(n: ast.LogicalOr): Result {
    return `(${n.lhs.accept(this)}.test()||${n.rhs.accept(this)}.test()?TRUE:FALSE)`;
  }
  visitConditional(n: ast.Conditional): Result {
    return `(${n.condition.accept(this)}.test()?${n.lhs.accept(this)}:${n.rhs.accept(this)})`;
  }
  visitTypeAssertion(n: ast.TypeAssertion): Result {
    return n.value.accept(this);
  }
  visitNativeExpression(n: ast.NativeExpression): Result {
    return n.source.value;
  }
  visitNativePureFunction(n: ast.NativePureFunction): Result {
    const body = n.body.find(pair => pair[0].name === 'js')?.[1] || '';
    return `CLASSFunction.of((${n.parameters.map(p => p.identifier.name).join(',')})=>{${body}})`;
  }
  visitEmptyStatement(n: ast.EmptyStatement): Result {
    return ';';
  }
  visitExpressionStatement(n: ast.ExpressionStatement): Result {
    return `${n.expression.accept(this)};`;
  }
  visitBlock(n: ast.Block): Result {
    return `{${n.statements.map(s => s.accept(this)).join('')}}`;
  }
  visitDeclaration(n: ast.Declaration): Result {
    const storageClass = n.isMutable ? 'let' : 'const';
    const value = n.value ? `=${n.value.accept(this)}` : '';
    return `${storageClass} YAL${n.identifier.name}${value};`;
  }
  visitIf(n: ast.If): Result {
    return `if(${n.condition.accept(this)}.test())${n.lhs.accept(this)}${n.rhs ? 'else ' + n.rhs.accept(this) : ''}`;
  }
  visitWhile(n: ast.While): Result {
    return `while(${n.condition.accept(this)}.test())${n.body.accept(this)}`;
  }
  visitReturn(n: ast.Return): Result {
    return `return ${n.value.accept(this)};`;
  }
  visitClassDefinition(n: ast.ClassDefinition): Result {
    const fields = n.statements.map(statement => {
      if (statement instanceof ast.Declaration) {
        const value = statement.value;
        if (!(value instanceof ast.FunctionDisplay) && statement.type && !statement.value) {
          return [{ name: statement.identifier.name, isMutable: statement.isMutable }];
        }
      }
      return [];
    }).flat();
    const ctorParameters = fields.map(f => `YAL${f.name}`).join(',');
    const ctorAssignments = fields.map(f => `this.FIELD${f.name} = YAL${f.name};`);
    const ctor = `constructor(${ctorParameters}){${ctorAssignments}}`;
    const basicMethods =
      `test(){return true;}` +
      `equals(other){return this===other;}` +
      `toRepr(){return "<${n.identifier.name} instance>";}` +
      `toString(){return this.toRepr();}`;
    const fieldMethods = fields.map(field => {
      return `YALget_${field.name}(){return this.FIELD${field.name}}` +
        (field.isMutable ? `YALset_${field.name}(x){return this.FIELD${field.name}=x}` : '');
    }).join('');
    const methods = basicMethods + fieldMethods + n.statements.map(statement => {
      if (statement instanceof ast.Declaration) {
        const value = statement.value;
        if (value instanceof ast.FunctionDisplay) {
          const parameters = value.parameters.map(p => p.identifier.name).join(',');
          const methodBody = value.body.accept(this);
          return `YAL${statement.identifier.name}(${parameters})${methodBody}`;
        }
      }
      return '';
    }).join('');
    const classdef = `class CLASS${n.identifier.name}{${ctor}${methods}}`;
    const vardef = `const YAL${n.identifier.name}=CLASSClass.of(CLASS${n.identifier.name});`;
    return `${classdef}${vardef}`;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): Result {
    return ';';
  }
  visitImport(n: ast.Import): Result {
    return ';';
  }
}

const TRANSLATOR = new Translator();

export async function getTranslationForDocument(document: vscode.TextDocument): Promise<string> {
  const node = await getAstForDocument(document);
  return `${PRELUDE}(${translateFileThunk(node)})()`;
}

export function translateFileThunk(n: ast.File): string {
  const body = translateFileBody(n);
  const object = translateFileObject(n);
  const core = `(()=>{${body}return ${object}})()`;
  return `(() => {let cache; return () => {if (cache)return cache;return cache=${core}}})()`;
}

export function translateFileObject(n: ast.File): string {
  const basicMethods =
    `test(){return true;},` +
    `equals(other){return this===other;},` +
    `toRepr(){return "<module>";},` +
    `toString(){return this.toRepr();},`;
  const methods = basicMethods + n.statements.map(statement => {
    if (statement instanceof ast.ClassDefinition) {
      const name = statement.identifier.name;
      return `YALget_${name}(){return YAL${name}},`;
    }
    if (statement instanceof ast.Declaration) {
      const name = statement.identifier.name;
      const value = statement.value;
      const getter = `YALget_${name}(){return YAL${name}},`;
      const setter = statement.isMutable ? `,YALset_${name}(x){return YAL${name}=x},` : '';
      const caller = (!statement.isMutable && value instanceof ast.FunctionDisplay) ?
        `YAL${name}(...args){return YAL${name}.value(...args)},`
        : '';
      return getter + setter + caller;
    }
    return '';
  }).join('');
  const classes = n.statements.map(statement => {
    if (statement instanceof ast.ClassDefinition) {
      const name = statement.identifier.name;
      return `CLASS${name},`;
    }
    return '';
  }).join('');
  return `{${methods}${classes}}`;
}

export function translateFileBody(n: ast.File): string {
  return n.statements.map(s => s.accept(TRANSLATOR)).join('');
}
