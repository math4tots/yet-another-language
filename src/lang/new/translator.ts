import * as vscode from 'vscode';
import * as ast from '../ast';
import { getAstForDocument } from '../parser';

const specialUnaryOperatorMap = new Map([
  ['__neg__', '-'],
  ['__pos__', '+'],
]);

const specialBinaryOperatorMap = new Map([
  ['__eq__', '==='],
  ['__ne__', '!=='],
  ['__lt__', '<'],
  ['__le__', '<='],
  ['__gt__', '>'],
  ['__ge__', '>='],
  ['__add__', '+'],
  ['__sub__', '-'],
  ['__mul__', '*'],
  ['__div__', '/'],
  ['__mod__', '%'],
]);

const builtinOnlyMethodNames = new Set([
  ...specialBinaryOperatorMap.keys(),
  ...specialUnaryOperatorMap.keys(),
  '__getitem__',
  '__setitem__',
  '__get___size',
].flat());

export type TranslationWarning = {
  readonly location: ast.Location,
  readonly message: string;
};

export function translateVariableName(name: string): string {
  if (name === 'this') return 'this';
  if (name.startsWith('__js_')) return name.substring(5);
  return 'YAL' + name;
}

class Translator implements ast.NodeVisitor<string> {
  readonly warnings: TranslationWarning[] = [];
  visitNilLiteral(n: ast.NilLiteral): string {
    return 'null';
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): string {
    return n.value ? 'true' : 'false';
  }
  visitNumberLiteral(n: ast.NumberLiteral): string {
    return '' + n.value;
  }
  visitStringLiteral(n: ast.StringLiteral): string {
    return JSON.stringify(n.value);
  }
  visitIdentifierNode(n: ast.IdentifierNode): string {
    return translateVariableName(n.name);
  }
  visitAssignment(n: ast.Assignment): string {
    return `(${translateVariableName(n.identifier.name)} = ${n.value.accept(this)})`;
  }
  visitListDisplay(n: ast.ListDisplay): string {
    return `[${n.values.map(e => e.accept(this))}]`;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): string {
    const parameters = n.parameters.map(p => translateVariableName(p.identifier.name));
    return `((${parameters.join(',')}) => ${n.body.accept(this)})`;
  }
  visitMethodCall(n: ast.MethodCall): string {
    const owner = n.owner.accept(this);
    const args = n.args.map(e => e.accept(this));
    const name = n.identifier.name;
    if (name === '__call__') return `${owner}(${args.join(',')})`;
    if (args.length === 0) {
      const op = specialUnaryOperatorMap.get(name);
      if (op) return `(${op}${owner})`;
      if (name === '__get___size') return `${owner}.length`;
      if (name.startsWith('__get___js_')) return `${owner}.${name.substring(11)}`;
      if (name.startsWith('__get_')) return `${owner}.YAL${name.substring(6)}`;
    } else if (args.length === 1) {
      if (name === '__getitem__') return `${owner}[${args[0]}]`;
      const op = specialBinaryOperatorMap.get(name);
      if (op) return `(${owner}${op}${args[0]})`;
      if (name.startsWith('__set___js_')) return `(${owner}.${name.substring(11)}=${args[0]})`;
      if (name.startsWith('__set_')) return `(${owner}.YAL${name.substring(6)}=${args[0]})`;
    } else if (args.length === 2) {
      if (name === '__setitem__') return `(${owner}[${args[0]}]=${args[1]})`;
    }
    if (name.startsWith('__js_')) return `${owner}.${name.substring(5)}(${args.join(',')})`;
    return `${owner}.YAL${name}(${args.join(',')})`;
  }
  visitNew(n: ast.New): string {
    const te = n.type;
    const type = te.qualifier ?
      `${translateVariableName(te.qualifier.name)}.${translateVariableName(te.identifier.name)}` :
      translateVariableName(te.identifier.name);
    return `new ${type}(${n.args.map(e => e.accept(this)).join(',')})`;
  }
  visitLogicalNot(n: ast.LogicalNot): string {
    return `(!${n.accept(this)})`;
  }
  visitLogicalAnd(n: ast.LogicalAnd): string {
    return `(${n.lhs.accept(this)}&&${n.rhs.accept(this)})`;
  }
  visitLogicalOr(n: ast.LogicalOr): string {
    return `(${n.lhs.accept(this)}||${n.rhs.accept(this)})`;
  }
  visitConditional(n: ast.Conditional): string {
    return `(${n.condition.accept(this)}?${n.lhs.accept(this)}:${n.rhs.accept(this)})`;
  }
  visitTypeAssertion(n: ast.TypeAssertion): string { return n.value.accept(this); }
  visitNativeExpression(n: ast.NativeExpression): string { return n.source.value; }
  visitNativePureFunction(n: ast.NativePureFunction): string {
    const parameters = n.parameters.map(p => translateVariableName(p.identifier.name));
    const body = n.body.find(pair => pair[0].name === 'js')?.[1].value;
    if (!body) this.warnings.push({ location: n.location, message: `Native Pure function missing body` });
    return `((${parameters.join(',')}) => {${body || 'throw new Error("missing pure function body")'}})`;
  }
  visitEmptyStatement(n: ast.EmptyStatement): string { return ''; }
  visitExpressionStatement(n: ast.ExpressionStatement): string { return `${n.expression.accept(this)};`; }
  visitBlock(n: ast.Block): string { return `{${n.statements.map(s => s.accept(this)).join('')}}`; }
  visitDeclaration(n: ast.Declaration): string {
    const storageClass = n.isMutable ? 'let' : 'const';
    const value = n.value ? `=${n.value.accept(this)}` : '';
    return `${storageClass} ${translateVariableName(n.identifier.name)}${value};`;
  }
  visitIf(n: ast.If): string {
    const condition = n.condition.accept(this);
    const lhs = n.lhs.accept(this);
    const rhs = n.rhs ? `else ${n.rhs.accept(this)}` : '';
    return `if(${condition})${lhs}${rhs}`;
  }
  visitWhile(n: ast.While): string {
    return `while(${n.condition.accept(this)})${n.body.accept(this)}`;
  }
  visitReturn(n: ast.Return): string {
    return `return ${n.value.accept(this)};`;
  }
  visitClassDefinition(n: ast.ClassDefinition): string {
    const name = n.identifier.name;
    const fields = n.statements.map(statement => {
      const stmt = statement;
      if (stmt instanceof ast.Declaration) {
        const value = stmt.value;
        if (!(value instanceof ast.FunctionDisplay) && stmt.type) return stmt.identifier.name;
      }
      return [];
    }).flat();
    const modifiedFieldNames = fields.map(f => f.startsWith('__js_') ? f.substring(5) : `YAL${f}`);
    const ctorParameters = modifiedFieldNames.join(',');
    const ctorAssignments = modifiedFieldNames.map(f => `this.${f}=${f}`).join(';');
    const ctor = `constructor(${ctorParameters}){${ctorAssignments}}`;
    const methods = n.statements.map(statement => {
      const stmt = statement;
      if (stmt instanceof ast.Declaration) {
        const name = stmt.identifier.name;
        const value = stmt.value;
        if ((value instanceof ast.FunctionDisplay) && !stmt.type) {
          if (builtinOnlyMethodNames.has(name)) {
            this.warnings.push({
              location: stmt.identifier.location,
              message: `You cannot define a method with name ${JSON.stringify(name)} - this is a reserved name`,
            });
          }
          const parameters = value.parameters.map(p => `YAL${p.identifier.name}`);
          const body = value.body.accept(this);
          const suffix = `(${parameters.join(',')})${body}`;
          if (parameters.length === 0) {
            if (name.startsWith('__get___js_')) return `get ${name.substring(11)}${suffix}`;
            if (name.startsWith('__get_')) return `get YAL${name.substring(6)}${suffix}`;
          } else if (parameters.length === 1) {
            if (name.startsWith('__set__js_')) return `set ${name.substring(11)}${suffix}`;
            if (name.startsWith('__set_')) return `set YAL${name.substring(6)}${suffix}`;
          }
          if (name.startsWith('__js_')) return `${name.substring(5)}${suffix}`;
          return `YAL${name}${suffix}`;
        }
      }
      return [];
    }).flat();
    return `class YAL${name}{${ctor}${methods.join('')}}`;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): string { return ''; }
  visitImport(n: ast.Import): string { return ''; }
  visitFile(n: ast.File): string {
    return '"use strict";' + n.statements.map(s => s.accept(this)).join('');
  }
}

export function getTranslationForFileNode(node: ast.File): string {
  return node.accept(new Translator());
}

export async function getTranslationForDocument(document: vscode.TextDocument): Promise<string> {
  const node = await getAstForDocument(document);
  return getTranslationForFileNode(node);
}
