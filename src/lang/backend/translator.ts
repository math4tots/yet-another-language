import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import { translateVariableName } from '../middleend/value';
import { getAnnotationForDocument } from '../middleend/annotator';
import { Annotation } from '../middleend/annotation';
import { PRINT_FUNCTION_DEFINITION, REPR_FUNCTION_DEFINITION, STR_FUNCTION_DEFINITION } from '../middleend/shared-functions';

const specialUnaryOperatorMap = new Map([
  ['__op_neg__', '-'],
  ['__op_pos__', '+'],
]);

const specialBinaryOperatorMap = new Map([
  ['__op_eq__', '==='],
  ['__op_ne__', '!=='],
  ['__op_lt__', '<'],
  ['__op_le__', '<='],
  ['__op_gt__', '>'],
  ['__op_ge__', '>='],
  ['__op_add__', '+'],
  ['__op_sub__', '-'],
  ['__op_mul__', '*'],
  ['__op_div__', '/'],
  ['__op_mod__', '%'],
  ['__op_pow__', '**'],
]);

const builtinOnlyMethodNames = new Set([
  ...specialBinaryOperatorMap.keys(),
  ...specialUnaryOperatorMap.keys(),
  '__op_getitem__',
  '__op_setitem__',
].flat());

export type TranslationWarning = {
  readonly location: ast.Location,
  readonly message: string;
};

export type TranslationOptions = {
  readonly addToPrelude?: string;
  readonly omitDefaultPrintFunction?: boolean;
};

function translateType(te: ast.TypeExpression): string {
  return te.qualifier ?
    `${translateVariableName(te.qualifier.name)}.${translateVariableName(te.identifier.name)}` :
    translateVariableName(te.identifier.name);
}

class Translator implements ast.NodeVisitor<string> {
  readonly warnings: TranslationWarning[] = [];
  visitNullLiteral(n: ast.NullLiteral): string {
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
      if (name === '__op_getitem__') return `${owner}[${args[0]}]`;
      const op = specialBinaryOperatorMap.get(name);
      if (op) return `(${owner}${op}${args[0]})`;
      if (name.startsWith('__set___js_')) return `(${owner}.${name.substring(11)}=${args[0]})`;
      if (name.startsWith('__set_')) return `(${owner}.YAL${name.substring(6)}=${args[0]})`;
    } else if (args.length === 2) {
      if (name === '__op_setitem__') return `(${owner}[${args[0]}]=${args[1]})`;
    }
    if (name.startsWith('__js_')) return `${owner}.${name.substring(5)}(${args.join(',')})`;
    return `${owner}.YAL${name}(${args.join(',')})`;
  }
  visitNew(n: ast.New): string {
    const te = n.type;
    const type = translateType(te);
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
    // For NativePureFunctions, parameter names are intentionally NOT mangled
    // const parameters = n.parameters.map(p => translateVariableName(p.identifier.name));
    const parameters = n.parameters.map(p => p.identifier.name);
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
    const superClass = n.superClass ? ` extends ${translateType(n.superClass)}` : '';
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
    const callSuper = n.superClass ? 'super();' : '';
    const ctor = `constructor(${ctorParameters}){${callSuper}${ctorAssignments}}`;
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
    methods.push(`toString(){return '<${n.identifier.name} instance>'}`);
    return `class YAL${name}${superClass}{${ctor}${methods.join('')}}`;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): string { return ''; }
  visitImport(n: ast.Import): string { return ''; }
  visitFile(n: ast.File): string {
    return '"use strict";' + n.statements.map(s => s.accept(this)).join('');
  }
}

export async function getTranslationForDocument(
  document: vscode.TextDocument,
  options?: TranslationOptions): Promise<string> {
  const opts = options || {};
  const translator = new Translator();
  const annotationToID = new Map<Annotation, string>();

  function getAnnotationID(ann: Annotation): string {
    const cached = annotationToID.get(ann);
    if (cached) return cached;
    const id = `M${annotationToID.size}`;
    annotationToID.set(ann, id);
    return id;
  }

  const parts: string[] = [
    '"use strict";',
    '(()=>{',
    REPR_FUNCTION_DEFINITION,
    STR_FUNCTION_DEFINITION,
  ];
  if (!opts.omitDefaultPrintFunction) parts.push(PRINT_FUNCTION_DEFINITION);
  if (opts.addToPrelude) parts.push(opts.addToPrelude);
  const annotation = await getAnnotationForDocument(document);
  const stack = [annotation];
  const seen = new Set(stack);

  for (let ann = stack.pop(); ann; ann = stack.pop()) {
    const id = getAnnotationID(ann);
    parts.push(`const ${id}=(()=>{let cache;return ()=>{` +
      `if(cache)return cache;return cache=(()=>{`);
    for (const variable of ann.importAliasVariables) {
      const importAnnotation = variable.type.moduleTypeData.annotation;
      if (!seen.has(importAnnotation)) {
        seen.add(importAnnotation);
        stack.push(importAnnotation);
      }
      parts.push(`const ${translateVariableName(variable.identifier.name)}=` +
        `${getAnnotationID(importAnnotation)}();`);
    }
    for (const statement of ann.ir.statements) {
      parts.push(statement.accept(translator));
    }
    parts.push(`return {`);
    for (const statement of ann.ir.statements) {
      if (statement instanceof ast.Declaration) {
        parts.push(`${translateVariableName(statement.identifier.name)},`);
      }
    }
    parts.push(`YAL__repr__(){return '<module>'},`);
    parts.push('};})()}})();');
  }
  parts.push(`${getAnnotationID(annotation)}();`);
  parts.push('})();');
  return parts.join('');
}
