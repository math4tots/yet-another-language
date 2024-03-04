import * as ast from './ast';
import * as vscode from 'vscode';
import { parse } from './parser';


export const JS_PRELUDE = `
class YALNil {
  isTrue() { return false; }
  toString() { return 'nil'; }
  toRepr() { return 'nil'; }
  toJS() { return null; }
  valueOf() { return null; }
}
class YALBool {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return this.value; }
  toString() { return this.value ? 'true' : 'false'; }
  toRepr() { return this.value ? 'true' : 'false'; }
  toJS() { return this.value; }
  valueOf() { return this.value }
}
class YALNumber {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return '' + this.value; }
  toRepr() { return '' + this.value; }
  toJS() { return this.value; }
  valueOf() { return this.value }
  YAL__add__(rhs) { return new YALNumber(this.value + rhs.value); }
  YAL__sub__(rhs) { return new YALNumber(this.value - rhs.value); }
  YAL__mul__(rhs) { return new YALNumber(this.value * rhs.value); }
  YAL__div__(rhs) { return new YALNumber(this.value / rhs.value); }
  YAL__mod__(rhs) { return new YALNumber(this.value % rhs.value); }
  YAL__pow__(rhs) { return new YALNumber(this.value ** rhs.value); }
  YAL__lt__(rhs) { return (this.value < rhs.value) ? YALtrue : YALfalse; }
  YAL__gt__(rhs) { return (this.value > rhs.value) ? YALtrue : YALfalse; }
  YAL__le__(rhs) { return (this.value <= rhs.value) ? YALtrue : YALfalse; }
  YAL__ge__(rhs) { return (this.value >= rhs.value) ? YALtrue : YALfalse; }
  YAL__eq__(rhs) { return this.value === rhs.value; }
  YAL__ne__(rhs) { return this.value !== rhs.value; }
}
class YALString {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return this.value; }
  toRepr() { return JSON.stringify(this.value); }
  toJS() { return this.value; }
  valueOf() { return this.value; }
  YAL__add__(rhs) { return new YALString(this.value + rhs.value); }
  YALget_size() { return this.value.length; }
  YAL__lt__(rhs) { return (this.value < rhs.value) ? YALtrue : YALfalse; }
  YAL__gt__(rhs) { return (this.value > rhs.value) ? YALtrue : YALfalse; }
  YAL__le__(rhs) { return (this.value <= rhs.value) ? YALtrue : YALfalse; }
  YAL__ge__(rhs) { return (this.value >= rhs.value) ? YALtrue : YALfalse; }
  YAL__eq__(rhs) { return this.value === rhs.value; }
  YAL__ne__(rhs) { return this.value !== rhs.value; }
}
class YALList {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return '[' + this.value.map(v => v.toString()).join(',') + ']'; }
  toRepr() { return '[' + this.value.map(v => v.toString()).join(',') + ']'; }
  YALget_size() { return this.value.length; }
  toJS() { return this.value.map(v => v.toJS()); }
}
class YALFunction {
  constructor(value, name) {
    this.value = value;
    this.name = name || value.name;
  }
  isTrue() { return true; }
  toString() { return '<function ' + this.name + '>'; }
  toRepr() { return '<function ' + this.name + '>'; }
  toJS() { return (...args) => this.value(...(args.map(arg => arg.toJS()))).toJS(); }
  YAL__call__(...args) { return this.value(...args); }
}
let printHandler = x => console.log(x); // default print behavior, can be modified
const YALnil = new YALNil();
const YALtrue = new YALBool(true);
const YALfalse = new YALBool(false);
const YALprint = new YALFunction(x => (printHandler(x), YALnil), 'print');
const YALstr = new YALFunction(x => new YALString(x.toString()), 'str');
const YALrepr = new YALFunction(x => new YALString(x.toRepr()), 'repr');
const moduleMap = Object.create(null);
const moduleThunkMap = Object.create(null);
function getModule(key) {
  const module = moduleMap[key];
  if (module) return module;
  const thunk = moduleThunkMap[key];
  if (!thunk) throw new Error('Module ' + JSON.stringify(key) + ' not found');
  const m = thunk();
  moduleMap[key] = m;
  return m;
}
function fromJS(v) {
  switch (typeof v) {
    case 'boolean': return v ? YALtrue : YALfalse;
    case 'number': return new YALNumber(v);
    case 'string': return new YALString(v);
    case 'function': return new YALFunction(v);
    case 'object':
      if (v === null) return YALnil;
      if (Array.isArray(v)) return new YALList(v);
  }
  return v;
}
`;

export async function translateToJavascript(
  document: vscode.TextDocument, appendToPrelude: string = ''): Promise<string> {
  const codegen = new JSCodegen();
  const stack = [document];
  const seen = new Set([document.uri.toString()]);
  for (let doc = stack.pop(); doc; doc = stack.pop()) {
    const file = parse(doc.uri, doc.getText());
    file.accept(codegen);
    for (const statement of file.statements) {
      if (statement instanceof ast.Import) {
        const uri = doc.uri;
        const path = statement.path.value;
        const importURI = vscode.Uri.from({
          authority: uri.authority,
          fragment: uri.fragment,
          path: getParentPath(uri.path) + path.substring(1),
          query: uri.query,
          scheme: uri.scheme,
        });
        const importKey = importURI.toString();
        if (seen.has(importKey)) continue;
        seen.add(importKey);
        const importDocument = await openDocument(importURI);
        if (importDocument) stack.push(importDocument);
      }
    }
  }
  const mainKey = JSON.stringify(document.uri.toString());
  return JS_PRELUDE + appendToPrelude + codegen.out + `getModule(${mainKey});`;
}

export class JSCodegen implements ast.NodeVisitor<void> {
  out: string = '';

  visitFile(n: ast.File): void {
    const uri = n.location.uri;
    const key = uri.toString();
    const stringifiedKey = JSON.stringify(key);
    this.out += `moduleThunkMap[${stringifiedKey}]=`;
    this.out += '()=>{';
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.out += 'return {';
    this.out += `isTrue(){return true},`;
    this.out += `toString(){return ${stringifiedKey}},`;
    this.out += `toRepr(){return this.toString()},`;
    for (const statement of n.statements) {
      if (statement instanceof ast.Declaration) {
        const name = statement.identifier.name;
        this.out += `YALget_${name}(){return YAL${name}},`;
        if (statement.isMutable) {
          this.out += `YALset_${name}(x) { return YAL${name} = x;},`;
        } else if (statement.value instanceof ast.FunctionDisplay) {
          this.out += `YAL${name}(...args){return YAL${name}(...args);},`;
        }
      }
    }
    this.out += '}}\n';
  }
  visitNilLiteral(n: ast.NilLiteral): void {
    this.out += 'YALnil';
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): void {
    this.out += n.value ? 'YALtrue' : 'YALfalse';
  }
  visitNumberLiteral(n: ast.NumberLiteral): void {
    this.out += `new YALNumber(${n.value})`;
  }
  visitStringLiteral(n: ast.StringLiteral): void {
    this.out += `new YALString(${JSON.stringify(n.value)})`;
  }
  visitIdentifierNode(n: ast.IdentifierNode): void {
    this.out += `YAL${n.name}`;
  }
  visitAssignment(n: ast.Assignment): void {
    this.out += `(YAL${n.identifier.name} = `;
    n.value.accept(this);
    this.out += ')';
  }
  visitListDisplay(n: ast.ListDisplay): void {
    this.out += 'new YALList([';
    for (let i = 0; i < n.values.length; i++) {
      if (i > 0) {
        this.out += ',';
      }
      n.values[i].accept(this);
    }
    this.out += '])';
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): void {
    const parameters = n.parameters.map(p => `YAL${p.identifier.name}`).join(',');
    this.out += `new YALFunction((${parameters})=>{`;
    n.body.accept(this);
    this.out += 'return YALnil;})';
  }
  visitMethodCall(n: ast.MethodCall): void {
    n.owner.accept(this);
    this.out += `.YAL${n.identifier.name}(`;
    for (let i = 0; i < n.args.length; i++) {
      if (i > 0) this.out += ',';
      n.args[i].accept(this);
    }
    this.out += ')';
  }
  visitNew(n: ast.New): void {
    this.out += `(new YAL${n.type.identifier.name}(`;
    for (let i = 0; i < n.args.length; i++) {
      if (i > 0) this.out += ',';
      n.args[i].accept(this);
    }
    this.out += '))';
  }
  visitLogicalNot(n: ast.LogicalNot): void {
    this.out += '(';
    n.value.accept(this);
    this.out += '.isTrue()?YALfalse:YALtrue)';
  }
  visitLogicalAnd(n: ast.LogicalAnd): void {
    this.out += '(';
    n.lhs.accept(this);
    this.out += '.isTrue()&&';
    n.rhs.accept(this);
    this.out += '.isTrue())?YALtrue:YALfalse';
  }
  visitLogicalOr(n: ast.LogicalOr): void {
    this.out += '(';
    n.lhs.accept(this);
    this.out += '.isTrue()||';
    n.rhs.accept(this);
    this.out += '.isTrue())?YALtrue:YALfalse';
  }
  visitConditional(n: ast.Conditional): void {
    this.out += '(';
    n.condition.accept(this);
    this.out += '.isTrue()?';
    n.lhs.accept(this);
    this.out += ':';
    n.rhs.accept(this);
    this.out += ')';
  }
  visitTypeAssertion(n: ast.TypeAssertion): void {
    n.value.accept(this);
  }
  visitNativeExpression(n: ast.NativeExpression): void {
    this.out += `${n.source.value}`;
  }
  visitNativePureFunction(n: ast.NativePureFunction): void {
    const passign = n.parameters.map(
      (p, i) => `const ${p.identifier.name} = $args[${i}].toJS();`).join('');
    const body = n.body.value;
    this.out += `new YALFunction((...$args) => {${passign}return fromJS(${body})}, '(native)')`;
  }
  visitEmptyStatement(n: ast.EmptyStatement): void { }
  visitExpressionStatement(n: ast.ExpressionStatement): void {
    n.expression.accept(this);
    this.out += ';';
  }
  visitBlock(n: ast.Block): void {
    this.out += '{';
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.out += '}';
  }
  visitDeclaration(n: ast.Declaration): void {
    const storageClass = n.isMutable ? 'let' : 'const';
    this.out += `${storageClass} YAL${n.identifier.name}`;
    if (n.value) {
      this.out += '=';
      n.value.accept(this);
    }
    this.out += ';';
  }
  visitIf(n: ast.If): void {
    this.out += 'if(';
    n.condition.accept(this);
    this.out += '.isTrue())';
    n.lhs.accept(this);
    if (n.rhs) {
      this.out += 'else';
      n.rhs.accept(this);
    }
  }
  visitWhile(n: ast.While): void {
    this.out += 'while(';
    n.condition.accept(this);
    this.out += '.isTrue())';
    n.body.accept(this);
  }
  visitReturn(n: ast.Return): void {
    this.out += 'return ';
    n.value.accept(this);
    this.out += ';';
  }
  visitClassDefinition(n: ast.ClassDefinition): void {
    this.out += `class YAL${n.identifier.name}{`;
    this.out += 'isTrue(){return true;}';
    this.out += `toString(){return "<${n.identifier.name} instance>"; }`;
    this.out += `toRepr(){return this.toString(); }`;
    const constructorFields: string[] = [];
    const initialiedFields: [string, ast.Expression][] = [];
    const readFields: string[] = [];
    const writeFields: string[] = [];
    for (const statement of n.statements) {
      if (statement instanceof ast.Declaration) {
        if (statement.value instanceof ast.FunctionDisplay) {
          // method
          const parameters =
            statement.value.parameters.map(p => `YAL${p.identifier.name}`).join(',');
          this.out += `YAL${statement.identifier.name}(${parameters}){const YALthis = this;`;
          statement.value.body.accept(this);
          this.out += 'return YALnil;}';
        } else {
          // field
          readFields.push(statement.identifier.name);
          if (statement.isMutable) {
            writeFields.push(statement.identifier.name);
          }
          if (statement.value) {
            initialiedFields.push([statement.identifier.name, statement.value]);
          } else {
            constructorFields.push(statement.identifier.name);
          }
        }
      }
    }
    for (const readField of readFields) {
      this.out += `YALget_${readField}(){return this.field${readField};}`;
    }
    for (const writeField of writeFields) {
      this.out += `YALset_${writeField}(x){return this.field${writeField} = x;}`;
    }
    const constructorParameters = constructorFields.map(f => `YAL${f}`);
    this.out += `constructor(${constructorParameters}){`;
    for (const normalField of constructorFields) {
      this.out += `this.field${normalField} = YAL${normalField};`;
    }
    for (const [name, expr] of initialiedFields) {
      this.out += `this.field${name} =`;
      expr.accept(this);
      this.out += ';';
    }
    this.out += '}};';
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): void { }
  visitImport(n: ast.Import): void {
    const uri = n.location.uri;
    const importURI = vscode.Uri.from({
      authority: uri.authority,
      fragment: uri.fragment,
      path: getParentPath(uri.path) + n.path.value.substring(1),
      query: uri.query,
      scheme: uri.scheme,
    });
    const key = JSON.stringify(importURI.toString());
    this.out += `const YAL${n.identifier.name}=getModule(${key});`;
  }
}

function getParentPath(path: string): string {
  let i = path.length;
  while (i > 0 && path[i - 1] !== '/') i--;
  i--;
  return path.substring(0, i);
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | null> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    return null;
  }
}
