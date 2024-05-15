import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import { translateFieldName, translateMethodName, translateVariableName } from '../middleend/names';
import { getAnnotationForDocument } from '../middleend/annotator';
import { Annotation } from '../middleend/annotation';
import {
  RAISE_FUNCTION_DEFINITION,
  NULL_GET_FUNCTION_DEFINITION,
  REPR_FUNCTION_DEFINITION,
  STR_FUNCTION_DEFINITION,
  PRINT_FUNCTION_DEFINITION,
  NULL_MAP_FUNCTION_DEFINITION,
} from '../middleend/shared-functions';

const specialUnaryOperatorMap = new Map<string, (e: string) => string>([
  ['__op_neg__', e => `(-${e})`],
  ['__op_pos__', e => `(+${e})`],
  ['__op_isnull__', e => `((${e}??null)===null)`],
  ['__op_hasvalue__', e => `((${e}??null)!==null)`],
  ['__op_nullget__', e => `nullGet(${e})`],
  ['__op_noop__', e => e],
  ['__op_clearlength__', e => `(${e}.length=0)`],
  ['__op_0__', e => `${e}[0]`],
  ['__op_1__', e => `${e}[1]`],
  ['__op_2__', e => `${e}[2]`],
  ['__op_3__', e => `${e}[3]`],
  ['__op_4__', e => `${e}[4]`],
  ['__op_5__', e => `${e}[5]`],
  ['__op_6__', e => `${e}[6]`],
  ['__op_7__', e => `${e}[7]`],
  ['__op_8__', e => `${e}[8]`],
  ['__op_9__', e => `${e}[9]`],
  ['__op_10__', e => `${e}[10]`],
]);

const specialBinaryOperatorMap = new Map<string, (a: string, b: string) => string>([
  ['__op_eq__', (a, b) => `(${a}===${b})`],
  ['__op_ne__', (a, b) => `(${a}!==${b})`],
  ['__op_lt__', (a, b) => `(${a}<${b})`],
  ['__op_le__', (a, b) => `(${a}<=${b})`],
  ['__op_gt__', (a, b) => `(${a}>${b})`],
  ['__op_ge__', (a, b) => `(${a}>=${b})`],
  ['__op_add__', (a, b) => `(${a}+${b})`],
  ['__op_sub__', (a, b) => `(${a}-${b})`],
  ['__op_mul__', (a, b) => `(${a}*${b})`],
  ['__op_div__', (a, b) => `(${a}/${b})`],
  ['__op_mod__', (a, b) => `(${a}%${b})`],
  ['__op_pow__', (a, b) => `(${a}**${b})`],
  ['__op_and__', (a, b) => `(${a}&${b})`],
  ['__op_or__', (a, b) => `(${a}|${b})`],
  ['__op_xor__', (a, b) => `(${a}^${b})`],
  ['__op_lshift__', (a, b) => `(${a}<<${b})`],
  ['__op_rshift__', (a, b) => `(${a}>>${b})`],
  ['__op_nullish_coalescing__', (a, b) => `(${a}??${b})`],
  ['__op_nullmap__', (a, b) => `nullMap(${a},${b})`],
]);

const specialTernaryOperatorMap = new Map<string, (a: string, b: string, c: string) => string>([
  ['__op_newarray__', (a, b, c) => `Array(${b}).fill(${c})`],
]);

const builtinOnlyMethodNames = new Set([
  ...specialTernaryOperatorMap.keys(),
  ...specialBinaryOperatorMap.keys(),
  ...specialUnaryOperatorMap.keys(),
  '__op_getitem__',
  '__op_setitem__',
  '__op_new__',
  '__call__',
].flat());

export type TranslationWarning = {
  readonly location: ast.Location,
  readonly message: string;
};

export type JavascriptTranslationOptions = {
  readonly addToPrelude?: string[];
  readonly omitDefaultPrintFunction?: boolean;
};

class Translator implements ast.NodeVisitor<string> {
  readonly warnings: TranslationWarning[] = [];
  visitTypename(n: ast.Typename): string {
    return n.qualifier ?
      `${translateVariableName(n.qualifier.name)}.${translateVariableName(n.identifier.name)}` :
      translateVariableName(n.identifier.name);
  }
  visitValueTypeDisplay(n: ast.ValueTypeDisplay): string {
    return JSON.stringify(n.value);
  }
  visitSpecialTypeDisplay(n: ast.SpecialTypeDisplay): string {
    return 'SPECIALTYPEDISPLAY';
  }
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
  visitYield(n: ast.Yield): string {
    return `(yield ${n.value.accept(this)})`;
  }
  visitAwait(n: ast.Await): string {
    return `(await ${n.value.accept(this)})`;
  }
  visitAssignment(n: ast.Assignment): string {
    return `(${translateVariableName(n.identifier.name)} = ${n.value.accept(this)})`;
  }
  visitListDisplay(n: ast.ListDisplay): string {
    return `[${n.values.map(e => e.accept(this)).join(',')}]`;
  }
  visitRecordDisplay(n: ast.RecordDisplay): string {
    return `{${n.entries.map(e =>
      translateVariableName(e.identifier.name) + ':' + e.value.accept(this)).join(',')}}`;
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): string {
    const parameters = n.parameters.map(p => translateVariableName(p.identifier.name));
    const body = n.body.accept(this);
    if (n.isAsync && n.isGenerator) {
      return `(async function*(${parameters.join(',')}) ${body}).bind(this)`;
    }
    if (n.isGenerator) {
      return `(function*(${parameters.join(',')}) ${body}).bind(this)`;
    }
    if (n.isAsync) {
      return `(async(${parameters.join(',')}) => ${body})`;
    }
    return `((${parameters.join(',')}) => ${body})`;
  }
  visitMethodCall(n: ast.MethodCall): string {
    const owner = n.owner.accept(this);
    const args = n.args.map(e => e.accept(this));
    const name = n.identifier.name;
    if (name === '__call__') return `${owner}(${args.join(',')})`;
    if (name === '__op_new__') return `(new (${owner})(${args.join(',')}))`;
    if (args.length === 0) {
      const applyOperator = specialUnaryOperatorMap.get(name);
      if (applyOperator) return applyOperator(owner);
      if (name.startsWith('__get_')) return `${owner}.${translateFieldName(name.substring(6))}`;
    } else if (args.length === 1) {
      if (name === '__op_getitem__') return `${owner}[${args[0]}]`;
      const op = specialBinaryOperatorMap.get(name);
      if (op) return op(owner, args[0]);
      if (name.startsWith('__set_')) return `(${owner}.${translateFieldName(name.substring(6))}=${args[0]})`;
    } else if (args.length === 2) {
      if (name === '__op_setitem__') return `(${owner}[${args[0]}]=${args[1]})`;
      const op = specialTernaryOperatorMap.get(name);
      if (op) return op(owner, args[0], args[1]);
    }
    if (name.startsWith('__js_')) return `${owner}.${name.substring(5)}(${args.join(',')})`;
    if (name.startsWith('__fn_')) return `${name.substring(5)}(${[owner].concat(args).join(',')})`; // "function"
    if (name.startsWith('__sfn_')) return `${name.substring(6)}(${args.join(',')})`; // "static function"
    return `${owner}.${translateMethodName(name, args.length)}(${args.join(',')})`;
  }
  visitLogicalNot(n: ast.LogicalNot): string {
    return `(!${n.value.accept(this)})`;
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
    const body = n.getJavascriptReturnExpression();
    if (!body) this.warnings.push({ location: n.location, message: `Native Pure function missing body` });
    return `((${parameters.join(',')}) => {${body || 'throw new Error("missing pure function body")'}})`;
  }
  visitEmptyStatement(n: ast.EmptyStatement): string { return ''; }
  visitCommentStatement(n: ast.CommentStatement): string { return ''; }
  visitExpressionStatement(n: ast.ExpressionStatement): string { return `${n.expression.accept(this)};`; }
  visitBlock(n: ast.Block): string { return `{${n.statements.map(s => s.accept(this)).join('')}}`; }
  visitStatic(n: ast.Static): string { return ''; }
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
  visitFor(n: ast.For): string {
    const storageClass = n.isMutable ? 'var' : 'const';
    const jsName = translateVariableName(n.identifier.name);
    return `for(${storageClass} ${jsName} of ${n.collection.accept(this)})${n.body.accept(this)}`;
  }
  visitBreak(n: ast.Break): string {
    return 'break;';
  }
  visitContinue(n: ast.Continue): string {
    return 'continue;';
  }
  visitReturn(n: ast.Return): string {
    return `return ${n.value.accept(this)};`;
  }
  visitClassDefinition(n: ast.ClassDefinition): string {
    const name = n.identifier.name;
    const superClass = n.superClass ? ` extends ${n.superClass.accept(this)}` : '';
    const staticMethods = n.statements.map(statement => {
      if (statement instanceof ast.Static) {
        return statement.statements.map(stmt => {
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
              return `static ${translateMethodName(name, parameters.length)}${suffix}`;
            }
          }
          return [];
        }).flat();
      }
      return [];
    }).flat();
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
          const prefix = value.isGenerator ? '*' : '';
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
            if (name.startsWith('__get___js_')) return `get${prefix} ${name.substring(11)}${suffix}`;
            if (name.startsWith('__get_')) return `get${prefix} YAL${name.substring(6)}${suffix}`;
          } else if (parameters.length === 1) {
            if (name.startsWith('__set__js_')) return `set${prefix} ${name.substring(11)}${suffix}`;
            if (name.startsWith('__set_')) return `set${prefix} YAL${name.substring(6)}${suffix}`;
          }
          if (name.startsWith('__js_')) return `${prefix}${name.substring(5)}${suffix}`;
          return `${prefix}${translateMethodName(name, parameters.length)}${suffix}`;
        }
      }
      return [];
    }).flat();
    methods.push(`toString(){return '<${n.identifier.name} instance>'}`);
    return `class YAL${name}${superClass}{${staticMethods.join('')}${ctor}${methods.join('')}}`;
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): string { return ''; }
  visitEnumDefinition(n: ast.EnumDefinition): string { return ''; }
  visitImportAs(n: ast.ImportAs): string { return ''; }
  visitFromImport(n: ast.FromImport): string { return ''; }
  visitExportAs(n: ast.ExportAs): string { return ''; }
  visitTypedef(n: ast.Typedef): string { return ''; }
  visitFile(n: ast.File): string {
    return '"use strict";' + n.statements.map(s => s.accept(this)).join('');
  }
}

export type JSTranslation = {
  readonly type: 'javascript';
  readonly javascript: string;
};
export type HTMLTranslation = {
  readonly type: 'html';
  readonly html: string;
};

export type Translation = JSTranslation | HTMLTranslation;

export async function getJavascriptTranslationForDocument(
  document: vscode.TextDocument,
  options?: JavascriptTranslationOptions): Promise<string> {
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
    '(()=>{"use strict";',
    RAISE_FUNCTION_DEFINITION,
    NULL_GET_FUNCTION_DEFINITION,
    NULL_MAP_FUNCTION_DEFINITION,
    REPR_FUNCTION_DEFINITION,
    STR_FUNCTION_DEFINITION,
  ];
  if (!opts.omitDefaultPrintFunction) parts.push(PRINT_FUNCTION_DEFINITION);
  if (opts.addToPrelude) parts.push(...opts.addToPrelude);
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
    const exportImports: string[] = [];
    for (const { isExported, moduleVariable, memberVariable } of ann.memberImports) {
      // If the member is compile time only, the translator does not have to emit the import
      if (memberVariable.type.typeTypeData?.isCompileTimeOnly) {
        continue;
      }
      const importAnnotation = moduleVariable.type.moduleTypeData.annotation;
      if (!seen.has(importAnnotation)) {
        seen.add(importAnnotation);
        stack.push(importAnnotation);
      }
      const moduleID = getAnnotationID(importAnnotation);
      const memberName = translateVariableName(memberVariable.identifier.name);
      parts.push(`const { ${memberName} } = ${moduleID}();`);
      if (isExported) {
        exportImports.push(memberName);
      }
    }
    for (const statement of ann.ir.statements) {
      parts.push(statement.accept(translator));
    }
    parts.push(`return {`);
    for (const statement of ann.ir.statements) {
      if (statement instanceof ast.Declaration && statement.isExported) {
        const jsVariableName = translateVariableName(statement.identifier.name);
        parts.push(`${jsVariableName},`);
      }
    }
    for (const exportImport of exportImports) {
      parts.push(`${exportImport},`);
    }
    parts.push(`YAL__repr__(){return '<module>'},`);
    parts.push('};})()}})();');
  }
  parts.push(`${getAnnotationID(annotation)}();`);
  parts.push('})();');
  return parts.join('');
}

export async function getTranslationForDocument(
  document: vscode.TextDocument,
  options?: JavascriptTranslationOptions): Promise<Translation> {
  const opts = options || {};
  const annotation = await getAnnotationForDocument(document);
  const configs = annotation.compileTimeConfigs;
  const addToPrelude = Array.from(options?.addToPrelude || []);
  for (const js of configs.addJS) {
    addToPrelude.push(js);
  }
  const javascript = await getJavascriptTranslationForDocument(document, {
    ...opts,
    addToPrelude,
  });
  if (configs.target === 'html') {
    const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>YAL VIEW</title>
    </head>
    <body>
      <script>${javascript}</script>
    </body>
    </html>`;
    return { type: 'html', html };
  }
  return { type: 'javascript', javascript };
}
