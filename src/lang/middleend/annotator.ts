import * as fs from 'fs';
import * as vscode from 'vscode';
import * as ast from '../frontend/ast';
import {
  getCommentFromFunctionDisplay,
  getCommentFromClassDefinition,
  getCommentFromInterfaceDefinition,
  getCommentFromEnumDefinition,
  getBodyIfFunctionHasSimpleBody,
} from '../frontend/ast-utils';
import { toVSRange } from '../frontend/bridge-utils';
import { getAstForDocument } from '../frontend/parser';
import { Position, Range } from '../frontend/lexer';
import {
  getImportPath,
  getParentUri,
  joinUri,
  resolveURI,
} from './paths';
import {
  AnyType,
  NeverType,
  NullType,
  BoolType,
  NumberType,
  StringType,
  LambdaType,
  Parameter,
  Type,
  newFunctionType,
  newLambdaType,
  newModuleType,
  ClassType,
  InterfaceType,
  newClassTypeType,
  newInterfaceTypeType,
  ModuleType,
  newEnumTypeType,
  InterfaceTypeType,
  newAliasType,
  newRecordClassType,
  TypeParameterTypeType,
  TypeParameterType,
  ClassTypeType,
  newTupleType,
  newTypeParameterTypeType,
  newRecordLiteralType,
} from './type';
import {
  Annotation,
  Completion,
  Variable,
  ClassVariable,
  InterfaceVariable,
  EnumVariable,
  EnumConstVariable,
  ModuleVariable,
  LimitedAnnotation,
  TypeVariance,
  COVARIANT,
  CONTRAVARIANT,
  flipVariance,
  CompileTimeConfigs,
  RunTarget,
  TypeParameterVariable,
  INVARIANT,
} from './annotation';
import { Scope, BASE_SCOPE } from './scope';
import { ModuleValue, RecordValue, Value, evalMethodCallCatchExc } from './value';
import { printFunction } from './functions';
import { getSymbolTable } from '../frontend/symbolregistry';
import { translateVariableName } from './names';
import { sortInterfaces, sortTypedefs } from './sort-nodes';

type CompileTimeConfigsWIP = {
  target?: RunTarget;
  addJS: Set<string>;
};

type AnnotatorParameters = {
  readonly annotation: LimitedAnnotation;
  readonly stack: Set<string>; // for detecting recursion
  readonly cached?: Annotation;
};

/** Result of annotating an expression */
type EResult = {
  readonly type: Type;

  readonly value?: Value;

  readonly thunk?: (scope: Scope) => Value | undefined;

  /**
   * Intermediate Representation
   * A modified version of the AST better suited for code generation
   */
  readonly ir: ast.Expression;
};

const Continues = Symbol('Continues');
const Jumps = Symbol('Jumps'); // return, throw, break, continue, etc
const MaybeJumps = Symbol('MaybeJumps');
type RunStatus = typeof Continues | typeof Jumps | typeof MaybeJumps;

/** Result of annotating a statement */
type SResult = {
  readonly status: RunStatus;

  /**
   * Intermediate Representation
   * A modified version of the AST better suited for code generation
   */
  readonly ir: ast.Statement;
};

type BResult = SResult & { readonly ir: ast.Block; };

/** Result of annotating a file */
type FResult = {
  readonly useCached: boolean;
  readonly ir: ast.File;
  readonly compileTimeConfigs: CompileTimeConfigs;
};

type InterfaceMethodBodyContents = {
  readonly aliasFor?: ast.Identifier;
};

type InterfaceFieldValueContents = {
  readonly aliasFor?: ast.Identifier;
};


const SUBSTITUTION_FAILURE = Symbol('Substitution Failure');

function hasThunkOrValue(result: EResult): boolean {
  return result.value !== undefined || result.thunk !== undefined;
}

function getValue(scope: Scope, result: EResult): Value | undefined {
  return result.value !== undefined ? result.value : result.thunk ? result.thunk(scope) : undefined;
}

class Annotator implements ast.TypeExpressionVisitor<Type>, ast.ExpressionVisitor<EResult>, ast.StatementVisitor<SResult> {
  readonly annotation: LimitedAnnotation;
  private readonly stack: Set<string>; // for detecting recursion

  private currentReturnType: Type | null = null;
  private currentYieldType: Type | null = null;
  private currentAsyncType: Type | null = null;
  private hint: Type = AnyType;
  private hintExplicitlyProvided: boolean = false;
  private mustSatisfyHint: boolean = false;
  private scope: Scope = Object.create(BASE_SCOPE);
  private readonly cached?: Annotation;
  private readonly typeSolverCache = new Map<ast.TypeExpression, Type>();
  private readonly lambdaTypeCache = new Map<ast.FunctionDisplay | ast.FunctionTypeDisplay, LambdaType>();
  private readonly markedImports = new Set<ast.ImportAs | ast.FromImport>();
  private readonly classMap = new Map<ast.ClassDefinition, ClassVariable>();
  private readonly interfaceMap = new Map<ast.InterfaceDefinition, InterfaceVariable>();

  constructor(params: AnnotatorParameters) {
    this.annotation = params.annotation;
    this.stack = params.stack;
    this.cached = params.cached;

    // Add a mechanism for including file resources at compile time
    // This is meant to work with __addJS
    this.declareVariable({
      identifier: { name: '__readFile' },
      type: newFunctionType([StringType], StringType),
      value: (relativePath: string): string | undefined => {
        const parentURI = getParentUri(this.annotation.uri);
        if (!relativePath.startsWith('./')) {
          throw new Error(`__readFile argument must all start with './'`);
        }
        if (relativePath.includes('/..')) {
          throw new Error('__readFile argument must not contain ".."');
        }
        const uri = joinUri(parentURI, relativePath);
        const fsPath = uri.fsPath;
        return fs.readFileSync(fsPath, { encoding: 'utf8' });
      },
    });
  }

  private error(location: ast.Location, message: string) {
    this.annotation.errors.push({ location, message });
  }

  private scoped<R>(f: () => R): R {
    const outerScope = this.scope;
    this.scope = Object.create(outerScope);
    try {
      return f();
    } finally {
      this.scope = outerScope;
    }
  }

  private getErrorCount(): number {
    return this.annotation.errors.length;
  }

  private addSymbolTableCompletions(completions: Completion[], scopeAtLocation: Scope) {
    const startingUriString = this.annotation.uri.toString();
    const symbolTable = getSymbolTable();
    for (const [symbolName, uriToSymbols] of symbolTable) {
      // Only include if the symbol is not currently in scope
      if (!scopeAtLocation[symbolName]) {
        for (const symbol of uriToSymbols.values()) {
          // If a symbol appears in a 'private' uri, do not suggest it unless
          // we are currently in a file where the symbol is visible
          const slashUnderscoreIndex = symbol.uri.lastIndexOf('/_');
          if (slashUnderscoreIndex >= 0) {
            const prefix = symbol.uri.substring(0, slashUnderscoreIndex + 1);
            if (!startingUriString.startsWith(prefix)) {
              continue;
            }
          }

          const importPath = getImportPath(symbol.uri, startingUriString);
          completions.push({
            name: symbol.name,
            detail: importPath,
            importFrom: importPath,
            importAsModule: symbol.kind === 'module',
          });
        }
      }
    }
  }

  visitTypename(e: ast.Typename): Type {
    // class or interface from an imported module
    if (e.qualifier) {
      const parent = this.scope[e.qualifier.name];
      if (!parent) {
        this.error(e.qualifier.location, `${e.qualifier.name} not found`);
        return AnyType;
      }
      this.markReference(parent, e.qualifier.location.range);
      const moduleTypeData = parent.type.moduleTypeData;
      if (!moduleTypeData) {
        this.error(e.qualifier.location, `${e.qualifier.name} is not a module`);
        return AnyType;
      }

      // completion based on member of module
      this.annotation.completionPoints.push({
        range: e.identifier.location.range,
        getCompletions() {
          return Array.from(moduleTypeData.annotation.exportMap.values())
            .filter(v => v.type.typeTypeData)
            .map(v => ({ name: v.identifier.name, variable: v }));
        },
      });

      const variable = moduleTypeData.annotation.exportMap.get(e.identifier.name);
      if (!variable) {
        this.error(e.identifier.location, `Type ${e.identifier.name} not found in module`);
        return AnyType;
      }

      this.markReference(variable, e.identifier.location.range);
      const type = variable.type.typeTypeData?.type;
      if (!type) {
        this.error(e.identifier.location, `${e.identifier.name} is not a type`);
        return AnyType;
      }
      return type;
    }

    // autocomplete for typenames without a qualifier
    const scopeAtLocation = this.scope;
    this.annotation.completionPoints.push({
      range: e.identifier.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scopeAtLocation) {
          const variable = scopeAtLocation[key];
          const type = variable.type;
          if (type.typeTypeData || type.moduleTypeData) {
            completions.push({ name: key, variable });
          }
        }
        // Provide completions for builtin generic types
        completions.push({ name: 'Any' });
        completions.push({ name: 'Never' });
        completions.push({ name: 'Null' });
        completions.push({ name: 'Bool' });
        completions.push({ name: 'Number' });
        completions.push({ name: 'String' });
        completions.push({ name: 'Nullable' });
        completions.push({ name: 'List' });
        completions.push({ name: 'Tuple' });
        completions.push({ name: 'Function' });
        completions.push({ name: 'Union' });
        completions.push({ name: 'Iterable' });
        completions.push({ name: 'Record' });
        completions.push({ name: 'function' });
        this.addSymbolTableCompletions(completions, scopeAtLocation);
        return completions;
      },
    });

    switch (e.identifier.name) {
      case 'Any': return AnyType;
      case 'Never': return NeverType;
      case 'Null': return NullType;
      case 'Bool': return BoolType;
      case 'Number': return NumberType;
      case 'String': return StringType;
    }

    // locally declared class or interface
    const variable = this.scope[e.identifier.name];
    if (!variable) {
      this.error(e.identifier.location, `Type ${e.identifier.name} not found`);
      return AnyType;
    }
    this.markReference(variable, e.identifier.location.range);
    const type = variable.type.typeTypeData?.type;
    if (!type) {
      this.error(e.identifier.location, `${e.identifier.name} is not a type`);
      return AnyType;
    }
    return type;
  }

  visitSpecialTypeDisplay(e: ast.SpecialTypeDisplay): Type {
    if (e.args.length === 1 && e.identifier.name === 'Nullable') {
      return this.solveType(e.args[0]).nullable();
    }
    if (e.args.length === 1 && e.identifier.name === 'List') {
      return this.solveType(e.args[0]).list();
    }
    if (e.identifier.name === 'Tuple') {
      const types = e.args.map(arg => this.solveType(arg));
      return newTupleType(types);
    }
    if (e.args.length === 1 && e.identifier.name === 'Promise') {
      return this.solveType(e.args[0]).promise();
    }
    if (e.args.length > 0 && e.identifier.name === 'Function') {
      const argTypes = e.args.map(arg => this.solveType(arg));
      const parameterTypes = argTypes.slice(0, argTypes.length - 1);
      const returnType = argTypes[argTypes.length - 1];
      return newFunctionType(parameterTypes, returnType);
    }
    if (e.identifier.name === 'Union') {
      let type = NeverType;
      for (const argexpr of e.args) {
        type = type.getCommonType(this.solveType(argexpr));
      }
      return type;
    }
    if (e.args.length === 1 && e.identifier.name === 'Iterable') {
      return this.solveType(e.args[0]).iterable();
    }
    this.error(e.location, `Invalid special type ${e}`);
    return AnyType;
  }

  visitFunctionTypeDisplay(n: ast.FunctionTypeDisplay): Type {
    return this.solveFunctionDisplayType(n, AnyType);
  }

  visitRecordTypeDisplay(n: ast.RecordTypeDisplay): Type {
    const memberVariables: Variable[] = [];
    for (const entry of n.entries) {
      const type = this.solveType(entry.type);
      const variable: Variable = {
        isMutable: entry.isMutable,
        identifier: entry.identifier,
        type,
      };
      this.declareVariable(variable, false);
      memberVariables.push(variable);
    }
    return newRecordLiteralType(n.location, memberVariables);
  }

  private solveType(e: ast.TypeExpression): Type {
    const cached = this.typeSolverCache.get(e);
    if (cached) return cached;
    const type = e.accept(this);
    this.typeSolverCache.set(e, type);
    return type;
  }

  private solveExpr(e: ast.Expression, hint: Type | undefined = undefined, required: boolean = true): EResult {
    const startErrorCount = this.getErrorCount();
    const oldHint = this.hint;
    const oldHintExplicitlyProvided = this.hintExplicitlyProvided;
    const oldMustStasifyHint = this.mustSatisfyHint;
    this.hint = hint ?? AnyType;
    this.hintExplicitlyProvided = hint !== undefined;
    this.mustSatisfyHint = required;
    const info = e.accept(this);
    try {
      if (!info.type.isAssignableTo(this.hint)) {
        // At first glance, the type doesn't seem to fit. But if the statically known value matches
        // the correct enum values for the type, then we don't actually have an error
        const value = info.value;
        if ((typeof value === 'number' || typeof value === 'string') && this.hint.getEnumConstVariableByValue(value)) {
          return { ...info, type: this.hint };
        }

        // If a type is required, we want to add an error message.
        // However, if there were already errors while evaluating the expression, it might just add
        // clutter if we complain again - so we omit it in such cases.
        if (required) {
          this.error(e.location, `Expected expression of type ${this.hint} but got expression of type ${info.type}`);
        }
      }
      return info;
    } finally {
      this.hint = oldHint;
      this.hintExplicitlyProvided = oldHintExplicitlyProvided;
      this.mustSatisfyHint = oldMustStasifyHint;
    }
  }

  private solveStmt(s: ast.Statement): SResult {
    return s.accept(this);
  }

  private solveBlock(b: ast.Block): BResult {
    const result = this.solveStmt(b);
    if (result.ir instanceof ast.Block) return { ...result, ir: result.ir };
    if (result.ir instanceof ast.EmptyStatement) return { ...result, ir: new ast.Block(result.ir.location, []) };
    return { ...result, ir: new ast.Block(result.ir.location, [result.ir]) };
  }

  private declareVariable(variable: Variable, addToScope = true) {
    this.annotation.variables.push(variable);
    if (addToScope) {
      const forward = this.scope[variable.identifier.name];
      if (forward && forward.isForwardDeclaration) {
        for (const range of (forward.forwardDeclarationUsages || [])) {
          this.markReference(variable, range);
        }
      }
      this.scope[variable.identifier.name] = variable;
    }
    const range = variable.identifier.location?.range;
    if (range) this.markReference(variable, range, true);
  }

  private markReference(variable: Variable, range: Range, isDeclaration: boolean = false) {
    variable.forwardDeclarationUsages?.push(range);
    this.annotation.references.push({ variable, range, isDeclaration });
  }

  async handle(n: ast.File): Promise<FResult> {
    // resolve imports
    const compileTimeConfigs: CompileTimeConfigsWIP = { addJS: new Set() };
    const srcURI = n.location.uri;
    let canUseCached = n.documentVersion === this.cached?.documentVersion;
    for (const statement of n.statements) {
      if (statement instanceof ast.ImportAs || statement instanceof ast.FromImport) {
        this.markedImports.add(statement);
        const { location, path, identifier } = statement;
        const { uri, error: errMsg } = await resolveURI(srcURI, path.value);
        const uriString = uri.toString();
        if (errMsg) {
          this.error(location, errMsg);
          continue;
        }
        if (this.stack.has(uriString)) {
          this.error(location, `Recursive import`);
          continue;
        }

        const cachedImportModuleAnnotation = this.cached?.importMap.get(uriString);
        const importModuleAnnotation = await getAnnotationForURI(uri, this.stack);
        if (!this.annotation.importMap.has(uriString)) {
          this.annotation.importMap.set(uriString, importModuleAnnotation);
          const importConfig = importModuleAnnotation.compileTimeConfigs;
          compileTimeConfigs.target = importConfig.target ?? compileTimeConfigs.target;
          for (const item of importModuleAnnotation.compileTimeConfigs.addJS) {
            compileTimeConfigs.addJS.add(item);
          }
        }
        if (cachedImportModuleAnnotation !== importModuleAnnotation) {
          canUseCached = false;
        }
        if (importModuleAnnotation.errors.length > 0) {
          if (importModuleAnnotation.errors.some(e => e.message === 'Recursive import')) {
            this.error(location, `Recursive import`);
          } else {
            this.error(location, `Module has errors`);
          }
        }
        const importModuleType = newModuleType(importModuleAnnotation);
        const moduleVariable = getModuleVariableForModuleType(importModuleType);
        this.markReference(moduleVariable, path.location.range);

        if (statement instanceof ast.FromImport) {
          const isExported = statement.isExported;
          const memberVariable = importModuleAnnotation.exportMap.get(identifier.name);
          if (memberVariable) {
            this.markReference(memberVariable, identifier.location.range);
            this.scope[identifier.name] = memberVariable;
            this.annotation.memberImports.push({ isExported, moduleVariable, memberVariable });
          } else {
            this.error(identifier.location, `${identifier.name} not found in module`);
          }
        } else {
          const aliasVariable: ModuleVariable = {
            identifier,
            type: importModuleType,
            value: moduleVariable.value,
          };
          this.annotation.importAliasVariables.push(aliasVariable);
          this.declareVariable(aliasVariable);
        }
      } else if (
        statement instanceof ast.ExportAs ||
        statement instanceof ast.CommentStatement ||
        (statement instanceof ast.ExpressionStatement &&
          statement.expression instanceof ast.StringLiteral)) {
        // Comments or string literals at the top may be ignored
      } else {
        // However, if we see any other kind of statement, we don't process any
        // further imports.
        break;
      }
    }

    if (canUseCached) {
      return { useCached: true, ir: n, compileTimeConfigs };
    }

    const statements = [...n.statements];
    sortInterfaces(statements);
    sortTypedefs(statements);
    this.forwardDeclare(statements);
    const irs: ast.Statement[] = [];
    for (const statement of statements) {
      const result = this.solveStmt(statement);
      let includeIR = !(result.ir instanceof ast.EmptyStatement);
      if (statement instanceof ast.Declaration || statement instanceof ast.ClassDefinition ||
        statement instanceof ast.InterfaceDefinition || statement instanceof ast.EnumDefinition ||
        statement instanceof ast.Typedef || statement instanceof ast.FromImport) {
        const name = statement.identifier.name;
        const location = statement.identifier.location;
        const variable = this.scope[name];
        if (variable) {
          if (statement.isExported) {
            this.annotation.exportMap.set(variable.identifier.name, variable);
          }
          if (name.startsWith('__')) {
            switch (name) {
              case '__target': {
                includeIR = false;
                const value = variable.value;
                if (value === undefined) {
                  this.error(location, `__target value could not be determined at compile time`);
                } else if (typeof value !== 'string') {
                  this.error(location, `__target value must be a string`);
                } else {
                  switch (value) {
                    case 'default':
                    case 'html':
                      // known values ok
                      compileTimeConfigs.target = value;
                      break;
                    default:
                      this.error(location, `Unrecognized target value ${value}`);
                  }
                }
                break;
              }
              case '__addJS': {
                includeIR = false;
                const value = variable.value;
                if (value === undefined) {
                  this.error(location, '__addJS value could not be determined at compile time');
                } else if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) {
                  this.error(location, `__addJS value must be an array of strings`);
                } else {
                  for (const item of value) {
                    if (typeof item !== 'string') continue;
                    compileTimeConfigs.addJS.add(item);
                  }
                }
                break;
              }
              default:
                this.error(location, `Names that start with '__' are reserved`);
            }
          }
        }
      }
      if (includeIR) irs.push(result.ir);
    }

    return {
      useCached: false,
      ir: new ast.File(n.location, n.documentVersion, irs, n.errors),
      compileTimeConfigs,
    };
  }

  private handleMemberDeclaration(type: Type, declaration: ast.Declaration) {
    if (declaration instanceof ast.Declaration) {
      const value = declaration.value;
      if (!declaration.isMutable && !declaration.type && value instanceof ast.FunctionDisplay) {
        // normal method definition
        const funcdisp = value;
        const funcdispType = this.solveFunctionDisplayType(funcdisp, AnyType);
        const variable: Variable = {
          identifier: declaration.identifier,
          type: funcdispType,
          comment: declaration.comment || getCommentFromFunctionDisplay(funcdisp),
        };
        this.declareVariable(variable, false);

        // If this is an interface method, its body may contain additional information
        // about the method, like whether it is an alias method.
        let aliasFor: string | undefined;
        if (type.interfaceTypeData || type.typeTypeData?.type.interfaceTypeData) {
          const interfaceMethodBodyContents = this.inspectInterfaceMethodBody(value);
          aliasFor = interfaceMethodBodyContents.aliasFor?.name;
        }

        type.addMethod({
          identifier: declaration.identifier,
          typeParameters: funcdispType.lambdaTypeData.typeParameters?.map(tp => tp.type),
          parameters: funcdispType.lambdaTypeData.parameters,
          returnType: funcdispType.lambdaTypeData.returnType,
          sourceVariable: variable,
          aliasFor,
        });
      } else if (declaration.type) {
        // field/property

        let aliasFor: string | undefined;
        if (declaration.value) {
          if (type.interfaceTypeData || type.typeTypeData?.type.interfaceTypeData) {
            const interfaceFieldValueContents = this.inspectInterfaceFieldValue(declaration.value);
            aliasFor = interfaceFieldValueContents.aliasFor?.name;
          } else {
            // TODO: like default parameters, but for passing to 'new'/constructor.
          }
        }

        const variable: Variable = {
          isMutable: declaration.isMutable,
          identifier: declaration.identifier,
          type: this.solveType(declaration.type),
          comment: declaration.comment || undefined,
        };
        type.classTypeData?.fields.push(variable);
        if (type.classTypeData?.isAbstract) {
          this.error(declaration.identifier.location, `abstract classes cannot have fields`);
        }
        this.declareVariable(variable, false);
        type.addMethod({
          identifier: { name: `__get_${declaration.identifier.name}` },
          parameters: [],
          returnType: variable.type,
          sourceVariable: variable,
          aliasFor: aliasFor ? `__get_${aliasFor}` : undefined,
        });
        if (declaration.isMutable) {
          type.addMethod({
            identifier: { name: `__set_${declaration.identifier.name}` },
            parameters: [{ identifier: { name: 'value' }, type: variable.type }],
            returnType: variable.type,
            sourceVariable: variable,
            aliasFor: aliasFor ? `__set_${aliasFor}` : undefined,
          });
        }
      } else {
        this.error(declaration.location, `Invalid class or interface member declaration`);
      }
    }
  }

  private addMethodsAndFields(
    typeType: InterfaceTypeType | ClassTypeType,
    bodyStatements: ast.Statement[]) {
    const type = typeType.typeTypeData.type;
    for (const declaration of bodyStatements) {
      if (declaration instanceof ast.Declaration) {
        this.handleMemberDeclaration(type, declaration);
      } else if (declaration instanceof ast.Static) {
        for (const decl of declaration.statements) {
          if (decl instanceof ast.Declaration) {
            this.handleMemberDeclaration(typeType, decl);
          }
        }
      }
    }
  }

  private inspectInterfaceMethodBody(fd: ast.FunctionDisplay): InterfaceMethodBodyContents {
    let aliasFor: ast.Identifier | undefined;
    for (const stmt of fd.body.statements) {
      if (stmt instanceof ast.CommentStatement) {
        continue; // comments
      }
      if (stmt instanceof ast.ExpressionStatement) {
        const expr = stmt.expression;
        if (expr instanceof ast.StringLiteral) {
          continue; // comments
        }
        if (expr instanceof ast.MethodCall && expr.identifier.name === '__call__' && expr.args.length === 1) {
          const owner = expr.owner;
          const arg = expr.args[0];
          if (owner instanceof ast.IdentifierNode && arg instanceof ast.IdentifierNode) {
            if (owner.name === 'aliasFor') {
              if (aliasFor) {
                this.error(owner.location, 'Duplicate aliasFor declaration');
              }
              aliasFor = arg;
              continue;
            }
          }
        }
        if (expr instanceof ast.IdentifierNode) {
          // this an error, but also a chance to help autocomplete 'aliasFor'
          this.annotation.completionPoints.push({
            range: expr.location.range,
            getCompletions() { return [{ name: 'aliasFor' }]; },
          });
        }
      }
      this.error(stmt.location, `Unexpected statement in interface method body`);
    }
    return { aliasFor };
  }

  private inspectInterfaceFieldValue(e: ast.Expression): InterfaceFieldValueContents {
    if (e instanceof ast.MethodCall && e.identifier.name === '__call__' && e.args.length === 1) {
      const owner = e.owner;
      const arg = e.args[0];
      if (owner instanceof ast.IdentifierNode && arg instanceof ast.IdentifierNode) {
        if (owner.name === 'aliasFor') {
          return { aliasFor: arg };
        }
      }
    }
    if (e instanceof ast.IdentifierNode) {
      // this an error, but also a chance to help autocomplete 'aliasFor'
      this.annotation.completionPoints.push({
        range: e.location.range,
        getCompletions() { return [{ name: 'aliasFor' }]; },
      });
    }
    this.error(e.location, `Invalid descriptor expression for interface field`);
    return {};
  }

  private declareEnum(defn: ast.EnumDefinition) {
    let underlyingType = NeverType;
    for (const statement of defn.statements) {
      if (statement instanceof ast.Declaration && statement.value) {
        if (statement.value instanceof ast.StringLiteral) {
          underlyingType = underlyingType.getCommonType(StringType);
        } else if (statement.value instanceof ast.NumberLiteral) {
          underlyingType = underlyingType.getCommonType(NumberType);
        } else {
          underlyingType = underlyingType.getCommonType(AnyType);
        }
      }
    }
    const comment = getCommentFromEnumDefinition(defn);
    const enumTypeType = newEnumTypeType(defn.identifier, underlyingType, comment);
    const enumTypeVariable: EnumVariable = {
      isPrivate: !defn.isExported,
      identifier: defn.identifier,
      type: enumTypeType,
      comment,
    };
    const enumType = enumTypeVariable.type.typeTypeData.type;
    this.declareVariable(enumTypeVariable);

    for (const statement of defn.statements) {
      if (statement instanceof ast.CommentStatement) continue;
      if (statement instanceof ast.ExpressionStatement) {
        if (statement.expression instanceof ast.StringLiteral) continue; // string literal comments
      }
      if (statement instanceof ast.Declaration && statement.value && !statement.isMutable && !statement.isExported) {
        const value = statement.value;
        if (value instanceof ast.StringLiteral || value instanceof ast.NumberLiteral) {
          const constVariable: EnumConstVariable = {
            identifier: statement.identifier,
            type: enumType,
            value: value.value,
            comment: statement.comment || undefined,
          };
          this.declareVariable(constVariable, false);
          enumType.enumTypeData.valueToVariableMap.set(value.value, constVariable);
          enumTypeType.addMethod({
            identifier: {
              name: `__get_${statement.identifier.name}`,
              location: statement.identifier.location,
            },
            parameters: [],
            returnType: enumType,
            inlineValue: value.value,
            sourceVariable: constVariable,
          });
          continue;
        }
      }
      this.error(statement.location, `Unexpected statement in enum definition body`);
    }
  }

  private forwardDeclareClass(defn: ast.ClassDefinition) {
    const comment = getCommentFromClassDefinition(defn);
    const superClassType = defn.superClass ? this.solveType(defn.superClass) : undefined;
    const superClassLocation = defn.superClass?.location;
    if (superClassLocation) {
      if (!superClassType?.classTypeData) {
        this.error(superClassLocation, `Classes can only inherit from other classes`);
      } else if (!superClassType?.classTypeData?.isAbstract) {
        this.error(superClassLocation, `Classes can only inherit from abstract classes`);
      }
    }
    const variable: ClassVariable = {
      isPrivate: !defn.isExported,
      identifier: defn.identifier,
      type: newClassTypeType(
        defn.isAbstract,
        defn.identifier,
        superClassType?.classTypeData ? (superClassType as ClassType) : undefined,
        comment),
      comment,
    };
    this.classMap.set(defn, variable);
    this.declareVariable(variable);
  }

  private forwardDeclareInterface(defn: ast.InterfaceDefinition) {
    const comment = getCommentFromInterfaceDefinition(defn);
    let hasStatic = false;
    let aliasForValue: Value | undefined;
    let inlineIR: ast.Expression | undefined;
    for (const statement of defn.statements) {
      if (statement instanceof ast.Static) {
        hasStatic = true;
        for (const stmt of statement.statements) {
          if (stmt instanceof ast.ExpressionStatement) {
            const expression = stmt.expression;
            if (expression instanceof ast.MethodCall &&
              expression.identifier.name === '__call__' &&
              expression.args.length === 1) {
              const owner = expression.owner;
              if (owner instanceof ast.IdentifierNode && owner.name === 'aliasFor') {
                const aliasForResult = this.solveExpr(expression.args[0]);
                inlineIR = aliasForResult.ir;
                aliasForValue = aliasForResult.value;
              }
            }
          }
        }
      }
    }

    // We can do this here because interfaces are already topologically sorted
    // and interfaces can only inherit from other interfaces (note, typedefs are
    // not allowed here)
    const superTypes: InterfaceType[] = [];
    for (const superTypeExpression of defn.superTypes) {
      const superType = this.solveType(superTypeExpression);
      if (superType.interfaceTypeData) {
        superTypes.push(superType as InterfaceType);
      } else {
        this.error(superTypeExpression.location, `interfaces can only extend other interfaces`);
      }
    }
    const interfaceTypeType = newInterfaceTypeType(defn.identifier, superTypes, comment);
    const variable: InterfaceVariable = {
      isPrivate: !defn.isExported,
      identifier: defn.identifier,
      type: interfaceTypeType,
      value: aliasForValue,
      inlineIR,
      comment,
    };
    if (hasStatic) {
      // If the interface has a static block, we automatically add a marker method to
      // make the interface a 'unique' type
      const interfaceType = interfaceTypeType.typeTypeData.type;
      interfaceType.addMethod({
        identifier: { name: `__marker_${defn.identifier.name}`, location: defn.identifier.location },
        parameters: [],
        returnType: interfaceTypeType,
      });
    }
    this.interfaceMap.set(defn, variable);
    this.declareVariable(variable);
  }

  private forwardDeclareClassMethods(defn: ast.ClassDefinition) {
    const classTypeTypeVariable = this.classMap.get(defn);
    if (!classTypeTypeVariable) throw new Error(`FUBAR class ${classTypeTypeVariable}`);
    const classTypeType = classTypeTypeVariable.type;
    const classType = classTypeType.typeTypeData.type;

    // inherit from super class
    const superClassType = classType.classTypeData.superClassType;
    if (superClassType) {
      for (const method of superClassType.getAllMethods()) {
        classType.addMethod(method);
      }
    }

    this.addMethodsAndFields(classTypeType, defn.statements);
    classTypeType.addMethod({
      identifier: { name: 'new', location: defn.identifier.location },
      parameters: [...classType.classTypeData.fields],
      returnType: classType,
      sourceVariable: {
        identifier: { name: 'new', location: defn.identifier.location },
        type: newLambdaType(undefined, [...classType.classTypeData.fields], classType),
      },
      aliasFor: '__op_new__',
    });
  }

  private forwardDeclareInterfaceMethods(defn: ast.InterfaceDefinition) {
    const interfaceTypeTypeVariable = this.interfaceMap.get(defn);
    if (!interfaceTypeTypeVariable) throw new Error(`FUBAR interface ${interfaceTypeTypeVariable}`);
    const interfaceTypeType = interfaceTypeTypeVariable.type;
    const interfaceType = interfaceTypeType.typeTypeData.type;
    this.addMethodsAndFields(interfaceTypeType, defn.statements);

    // inherit from all the super interfaces
    for (const superType of interfaceType.interfaceTypeData.superTypes) {
      for (const method of superType.getAllMethods()) {
        interfaceType.addMethod(method);
      }
    }

    // with all methods available, this interface is now 'complete'
    interfaceType.interfaceTypeData.complete = true;
  }

  private solveTypedef(defn: ast.Typedef) {
    const type = this.solveType(defn.type);
    const aliasType = newAliasType(defn.identifier, type);
    const variable: Variable = {
      isPrivate: !defn.isExported,
      identifier: defn.identifier,
      type: aliasType,
      comment: type.comment,
    };
    this.declareVariable(variable);
  }

  private forwardDeclare(statements: ast.Statement[]) {

    // Enum types have no dependency on anything except its definition,
    // so can be processed before anything else.
    for (const statement of statements) {
      if (statement instanceof ast.EnumDefinition) {
        this.declareEnum(statement);
      }
    }

    // forward declare classes and interfaces
    for (const defn of statements) {
      if (defn instanceof ast.ClassDefinition) {
        this.forwardDeclareClass(defn);
      } else if (defn instanceof ast.InterfaceDefinition) {
        this.forwardDeclareInterface(defn);
      }
    }

    // solve typedefs
    // TOOD: This is a bit of a clusterfck, because typedefs may require
    // 'isAssignableTo' checks, but these checks really should not happen until
    // methods are all solved. But methods may use typedefs
    for (const defn of statements) {
      if (defn instanceof ast.Typedef) {
        this.solveTypedef(defn);
      }
    }

    // forward declare methods and inherit them
    for (const defn of statements) {
      if (defn instanceof ast.ClassDefinition) {
        this.forwardDeclareClassMethods(defn);
      } else if (defn instanceof ast.InterfaceDefinition) {
        this.forwardDeclareInterfaceMethods(defn);
      }
    }

    // forward declare functions
    for (const defn of statements) {
      if (defn instanceof ast.Declaration && !defn.isMutable && !defn.type) {
        // NOTE: we do not forward declare the function when 'defn.type' is explicitly provided.
        // This is because if the type is provided, we would expect solveFunctionDisplayType
        // to use the provided type as a hint. But because we are forward declaring, the
        // we do not have access to the solved type yet.
        // And this use case is actually very unlikely anyway, since, if you were going to
        // provide the explicit types, you might as well provide them on the function display while
        // using the function statement syntax, where you can't explicitly provide the variable
        // type anyway.
        const value = defn.value;
        if (value instanceof ast.FunctionDisplay) {
          const comments = getCommentFromFunctionDisplay(value);
          const type = this.solveFunctionDisplayType(value, AnyType);
          // We use a temporary forward declared variable -
          // when we actually reach this location, we will overwrite the existing variable
          // with the 'real' one
          // TODO: Find a way to avoid creating potential duplicate variables
          const variable: Variable = {
            isMutable: defn.isMutable,
            identifier: defn.identifier,
            type,
            comment: comments,
            isForwardDeclaration: true,
            forwardDeclarationUsages: [],
          };
          this.scope[defn.identifier.name] = variable;
        }
      }
    }
  }

  visitNullLiteral(n: ast.NullLiteral): EResult {
    return { type: NullType, value: null, ir: n };
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): EResult {
    return { type: BoolType, value: n.value, ir: n };
  }
  visitNumberLiteral(n: ast.NumberLiteral): EResult {
    const enumConstVariable = this.hint.getEnumConstVariableByValue(n.value);
    if (enumConstVariable) {
      this.markReference(enumConstVariable, n.location.range);
    }
    return { type: NumberType, value: n.value, ir: n };
  }
  visitStringLiteral(n: ast.StringLiteral): EResult {
    const hint = this.hint;
    if (hint.mayHaveEnumConstVariables()) {
      this.annotation.completionPoints.push({
        range: {
          start: {
            line: n.location.range.start.line,
            column: n.location.range.start.column + 1,
            index: n.location.range.start.index + 1,
          },
          end: {
            line: n.location.range.end.line,
            column: n.location.range.end.column - 1,
            index: n.location.range.end.index - 1,
          },
        },
        getCompletions() {
          const completions: Completion[] = [];
          for (const enumConstVariable of hint.getEnumConstVariables()) {
            const value = enumConstVariable.value;
            if (typeof value === 'string') {
              completions.push({ name: value, variable: enumConstVariable });
            }
          }
          return completions;
        },
      });
      const enumConstVariable = hint.getEnumConstVariableByValue(n.value);
      if (enumConstVariable) {
        this.markReference(enumConstVariable, n.location.range);
      }
    }
    return { type: StringType, value: n.value, ir: n };
  }
  visitIdentifierNode(n: ast.IdentifierNode): EResult {
    const scope = this.scope;
    this.annotation.completionPoints.push({
      range: n.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scope) {
          completions.push({ name: key, variable: scope[key] });
        }
        // additionally, provide provide completions for constants and keywords
        completions.push({ name: 'null' });
        completions.push({ name: 'true' });
        completions.push({ name: 'false' });
        completions.push({ name: 'function' });
        completions.push({ name: 'var' });
        completions.push({ name: 'const' });
        completions.push({ name: 'native' });
        completions.push({ name: 'inline' });
        completions.push({ name: 'return' });
        completions.push({ name: 'yield' });
        completions.push({ name: 'async' });
        completions.push({ name: 'await' });
        completions.push({ name: 'interface' });
        completions.push({ name: 'class' });
        completions.push({ name: 'enum' });
        completions.push({ name: 'typedef' });
        completions.push({ name: 'export' });
        completions.push({ name: 'import' });
        completions.push({ name: 'abstract' });
        completions.push({ name: 'while' });
        completions.push({ name: 'for' });
        completions.push({ name: 'break' });
        completions.push({ name: 'continue' });
        this.addSymbolTableCompletions(completions, scope);
        return completions;
      },
    });
    const variable = this.scope[n.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.name)} not found`);
      return { type: AnyType, ir: n };
    }
    this.markReference(variable, n.location.range);
    return {
      type: variable.type,
      value: variable.value,
      thunk: (variable.value === undefined && !variable.isMutable) ?
        (scope: Scope): Value | undefined => {
          const evalTimeVariable = scope[variable.identifier.name];
          return evalTimeVariable.value;
        } : undefined,
      ir: variable.inlineIR ?? n,
    };
  }
  visitYield(n: ast.Yield): EResult {
    const yieldType = this.currentYieldType;
    if (!yieldType) {
      const value = this.solveExpr(n.value);
      this.error(n.location, `yield cannot appear outside of a generator function`);
      return { type: AnyType, ir: new ast.Yield(n.location, value.ir) };
    }
    const value = this.solveExpr(n.value, yieldType);
    return { type: AnyType, ir: new ast.Yield(n.location, value.ir) };
  }
  visitAwait(n: ast.Await): EResult {
    const asyncType = this.currentAsyncType;
    if (!asyncType) {
      const value = this.solveExpr(n.value);
      this.error(n.location, `await cannot appear outside of an async function`);
      return { type: AnyType, ir: new ast.Yield(n.location, value.ir) };
    }
    const value = this.solveExpr(n.value, this.hint.promiseTypeData?.valueType);
    if (!value.type.promiseTypeData) {
      this.error(n.location, `await expects a Promise value`);
    }
    return { type: value.type.promiseTypeData?.valueType ?? AnyType, ir: new ast.Await(n.location, value.ir) };
  }
  visitAssignment(n: ast.Assignment): EResult {
    const rhs = this.solveExpr(n.value);
    const variable = this.scope[n.identifier.name];
    if (!variable) {
      this.error(n.location, `Variable ${JSON.stringify(n.identifier.name)} not found`);
      return { type: AnyType, ir: n };
    }
    if (!variable.isMutable) {
      this.error(n.location, `Variable ${n.identifier.name} is not mutable`);
      return { type: variable.type, ir: n };
    }
    if (!rhs.type.isAssignableTo(variable.type)) {
      this.error(
        n.identifier.location,
        `Value of type ${rhs.type} is not assignable to variable of type ${variable.type}`);
    }
    const ir = new ast.Assignment(n.location, n.identifier, rhs.ir);
    return { type: variable.type, value: rhs.value, ir };
  }
  visitListDisplay(n: ast.ListDisplay): EResult {
    const startErrorCount = this.getErrorCount();
    const hint = this.hint;
    const values: Value[] = [];
    const irs: ast.Expression[] = [];
    if (hint.tupleTypeData && hint.tupleTypeData.itemTypes.length === n.values.length) {
      const itemTypes = hint.tupleTypeData.itemTypes;
      const actualItemTypes = [];
      for (let i = 0; i < n.values.length; i++) {
        const itemNode = n.values[i];
        const itemType = itemTypes[i];
        const result = this.solveExpr(itemNode, itemType, this.mustSatisfyHint);
        actualItemTypes.push(result.type);
        if (result.value !== undefined) values.push(result.value);
        irs.push(result.ir);
      }
      const hasErrors = startErrorCount !== this.getErrorCount();
      const hasAllValues = values.length === n.values.length;
      return {
        type: newTupleType(actualItemTypes),
        value: (!hasErrors && hasAllValues) ? values : undefined,
        ir: new ast.ListDisplay(n.location, irs),
      };
    } else if (hint.listTypeData) {
      const itemType = hint.listTypeData.itemType;
      let actualItemType = itemType;
      for (let i = 0; i < n.values.length; i++) {
        const itemNode = n.values[i];
        const result = this.solveExpr(itemNode, itemType, this.mustSatisfyHint);
        actualItemType = actualItemType.getCommonType(result.type);
        if (result.value !== undefined) values.push(result.value);
        irs.push(result.ir);
      }
      const hasErrors = startErrorCount !== this.getErrorCount();
      const hasAllValues = values.length === n.values.length;
      return {
        type: actualItemType.list(),
        value: (!hasErrors && hasAllValues) ? values : undefined,
        ir: new ast.ListDisplay(n.location, irs),
      };
    } else {
      let itemType = NeverType;
      for (let i = 0; i < n.values.length; i++) {
        const itemNode = n.values[i];
        const result = this.solveExpr(itemNode, itemType, false);
        itemType = itemType.getCommonType(result.type);
        if (result.value !== undefined) values.push(result.value);
        irs.push(result.ir);
      }
      const hasErrors = startErrorCount !== this.getErrorCount();
      const hasAllValues = values.length === n.values.length;
      return {
        type: itemType.list(),
        value: (!hasErrors && hasAllValues) ? values : undefined,
        ir: new ast.ListDisplay(n.location, irs),
      };
    }
  }
  visitRecordDisplay(n: ast.RecordDisplay): EResult {
    const hint = this.hint;
    const memberVariables: Variable[] = [];
    const newEntries: ast.RecordDisplayEntry[] = [];
    const value = new RecordValue();
    for (const entry of n.entries) {
      // TODO: immutable member entries
      const method = hint.getMethodWithExactParameterCount(`__get_${entry.identifier.name}`, 0);
      const memberType = method?.returnType || AnyType;
      const memberResult = this.solveExpr(entry.value, memberType, this.mustSatisfyHint);
      newEntries.push({
        isMutable: entry.isMutable,
        identifier: entry.identifier,
        value: memberResult.ir,
      });
      const memberVariable: Variable = {
        isMutable: entry.isMutable,
        identifier: entry.identifier,
        type: memberResult.type,
        value: memberResult.value,
      };
      this.declareVariable(memberVariable, false);
      memberVariables.push(memberVariable);
      (value as any)[translateVariableName(entry.identifier.name)] = memberResult.value;
    }
    value;
    return {
      type: newRecordClassType(memberVariables),
      ir: new ast.RecordDisplay(n.location, newEntries),
      value,
    };
  }
  private solveFunctionDisplayType(n: ast.FunctionDisplay | ast.FunctionTypeDisplay, rawHint: Type): LambdaType {
    const cached = this.lambdaTypeCache.get(n);
    if (cached) return cached;
    const hint = rawHint.lambdaErasure().functionTypeData;
    if (!hint) {
      for (const parameterNode of n.parameters) {
        if (!parameterNode.type) {
          this.error(parameterNode.location, `Missing parameter type (required when type cannot be inferred)`);
        }
      }
    }
    return this.scoped(() => {
      const typeParameters: TypeParameterVariable[] | undefined = n.typeParameters?.map(tp => ({
        identifier: tp.identifier,
        type: newTypeParameterTypeType(tp.identifier, tp.constraint ? this.solveType(tp.constraint) : AnyType),
      }));
      if (typeParameters) {
        for (const tpVariable of typeParameters) {
          this.declareVariable(tpVariable);
        }
      }
      const parameters: Parameter[] = n.parameters.map((p, i) => ({
        isMutable: p.isMutable,
        identifier: p.identifier,
        type: (p.type ? this.solveType(p.type) : null) || (hint?.parameterTypes[i] || AnyType),
        defaultValue: p.value || undefined,
      }));
      const returnType =
        n.returnType ?
          this.solveType(n.returnType) :
          (hint?.returnType || (n.isGenerator ? AnyType.iterable() : AnyType));
      if (n.isGenerator && !returnType.iterableTypeData) {
        // TODO: in the future I may want to add a 'Generator<T, TNext, TReturn>' type
        // for use with generators so that I can have asymmetric coroutines.
        // But for now, to keep things simple, we just assume generators are always Iterables.
        this.error(n.returnType?.location ?? n.location, `Generator must return iterable`);
      }
      const lambdaType = newLambdaType(typeParameters, parameters, returnType);
      this.lambdaTypeCache.set(n, lambdaType);
      return lambdaType;
    });
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): EResult {
    const startErrorCount = this.getErrorCount();
    if (n.isAsync && n.isGenerator) {
      this.error(n.location, `async generators are not yet supported`);
    }
    const lambdaType = this.solveFunctionDisplayType(n, this.hint);
    const outerScope = this.scope;
    return this.scoped(() => {
      const typeParameters = lambdaType.lambdaTypeData.typeParameters;
      if (typeParameters) {
        for (const tp of typeParameters) {
          this.scope[tp.identifier.name] = tp;
        }
      }
      const parameters = lambdaType.lambdaTypeData.parameters;
      const tentativeReturnType = lambdaType.lambdaTypeData.functionType.functionTypeData.returnType;
      const outerReturnType = this.currentReturnType;
      const outerYieldType = this.currentYieldType;
      const outerAsyncType = this.currentAsyncType;
      try {
        this.currentReturnType = tentativeReturnType;
        if (n.isGenerator) {
          this.currentYieldType = tentativeReturnType.iterableTypeData?.itemType ?? AnyType;
        }
        if (n.isAsync) {
          this.currentAsyncType = tentativeReturnType.promiseTypeData?.valueType ?? AnyType;
        }
        const hasMutableParameters = parameters.some(p => p.isMutable);
        for (const parameter of parameters) {
          const variable: Variable = {
            isMutable: parameter.isMutable,
            identifier: parameter.identifier,
            type: parameter.type,
          };
          this.declareVariable(variable);
        }
        const simpleBody = getBodyIfFunctionHasSimpleBody(n);
        if (simpleBody && !n.returnType) {
          // if the function display's body is just a single return statement, we can
          // try and infer the return type based on the return expression.
          const bodyResult = this.solveExpr(simpleBody);
          const value = bodyResult.value;
          const thunk = bodyResult.thunk;
          return {
            type: n.returnType ?
              lambdaType :
              newLambdaType(typeParameters, lambdaType.lambdaTypeData.parameters, bodyResult.type),
            value: this.getErrorCount() !== startErrorCount ? undefined :
              value !== undefined ?
                () => value :
                (!hasMutableParameters && thunk) ?
                  (...args: Value[]) => {
                    const staticEvalScope: Scope = Object.create(outerScope);
                    for (let i = 0; i < parameters.length; i++) {
                      const parameter = parameters[i];
                      const variable: Variable = {
                        identifier: parameter.identifier,
                        type: parameter.type,
                        value: args[i],
                      };
                      staticEvalScope[parameter.identifier.name] = variable;
                    }
                    return thunk(staticEvalScope);
                  } :
                  undefined,
            ir: new ast.FunctionDisplay(
              n.location, n.isAsync, n.isGenerator, undefined, n.parameters, n.returnType,
              new ast.Block(n.body.location, [new ast.Return(n.body.statements[0].location, bodyResult.ir)])),
          };
        } else {
          const result = this.solveBlock(n.body);
          if (result.status !== Jumps && !(n.isGenerator || NullType.isAssignableTo(tentativeReturnType))) {
            this.error(
              (n.returnType ?? n).location,
              `A function that cannot return null must always explicitly return`);
          }
          return {
            type: lambdaType,
            ir: new ast.FunctionDisplay(
              n.location, n.isAsync, n.isGenerator, undefined, n.parameters, n.returnType, result.ir),
          };
        }
      } finally {
        this.currentReturnType = outerReturnType;
        this.currentYieldType = outerYieldType;
        this.currentAsyncType = outerAsyncType;
      }
    });
  }

  visitMethodCall(n: ast.MethodCall): EResult {
    const startErrorCount = this.getErrorCount();
    const owner = this.solveExpr(n.owner);
    this.annotation.completionPoints.push({
      range: n.identifier.location.range,
      getCompletions(): Completion[] {
        const completions: Completion[] = [];
        const seen = new Set<string>();
        for (const method of owner.type.getAllMethodsWithDedupedNames()) {
          const rawName = method.identifier.name;
          if (rawName.startsWith('__marker_') || rawName.startsWith('__get___marker_')) {
            // skip the __marker__ field/method - these are used purely for
            // adding a unique marker to interfaces
          } else if (rawName.startsWith('__set_')) {
            // skip setters
          } else if (rawName.startsWith('__get_')) {
            // field or property
            const name = rawName.substring('__get_'.length);
            if (seen.has(name)) continue;
            seen.add(name);
            completions.push({
              name,
              detail: '(property)',
              variable: method.sourceVariable,
            });
          } else {
            // normal methods
            const name = rawName;
            if (seen.has(name)) continue;
            seen.add(name);
            completions.push({
              name,
              detail: '(method)',
              variable: method.sourceVariable,
            });
          }
        }
        return completions;
      },
    });

    // Even if the method is not correct based on the parameter count, if we find
    // a method that matches the name, add to the callInstances to provide signature help.
    if (owner.type.getAnyMethodWithName(n.identifier.name)) {
      this.annotation.callInstances.push({
        range: n.location.range,
        args: n.args.map(arg => arg.location.range),
        overloads: owner.type.getAllMethodsWithName(n.identifier.name),
      });
    }

    const possibleMethods = owner.type.getMethodsHandlingArgumentCount(n.identifier.name, n.args.length);

    const firstGuessMethod = possibleMethods[0];
    if (!firstGuessMethod) {
      for (const arg of n.args) this.solveExpr(arg);
      const method = owner.type.getAnyMethodWithName(n.identifier.name);
      if (method) {
        this.markReference(method.sourceVariable, n.identifier.location.range);
        this.error(n.location, `Expected ${method.parameters.length} args but got ${n.args.length}`);
      } else {
        this.error(n.location, `Method ${n.identifier.name} not found on type ${owner.type}`);
      }
      return { type: AnyType, ir: n };
    }
    let method = firstGuessMethod;

    // account for default parameters
    const argExprs = [...n.args];
    while (argExprs.length < method.parameters.length && method.parameters[argExprs.length].defaultValue) {
      const defaultValue = method.parameters[argExprs.length].defaultValue;
      if (defaultValue) argExprs.push(defaultValue.withLocation(n.identifier.location));
    }

    // solve the argument expressions
    const argResults: EResult[] = [];
    const argValues: Value[] = [];
    const argIRs: ast.Expression[] = [];
    let maybeReturnType: Type | undefined;
    if (method.typeParameters) {
      this.markReference(method.sourceVariable, n.identifier.location.range);

      // If the method has type parameters, for the best effect, we need to handle type parameter
      // inference as we solve the expressions
      type Binding = {
        readonly typeParameter: TypeParameterTypeType;
        type?: Type;
      };
      const failBinding = (message?: string): EResult => {
        this.error(n.location, `Failed to infer type parameters` + (message ? ` (${message})` : ''));
        return { type: maybeReturnType || AnyType, ir: n };
      };
      const bindings = new Map<TypeParameterType, Binding>(
        method.typeParameters.map(tp => [tp.typeTypeData.type, { typeParameter: tp }]));
      const saveBindings = () => new Map(Array.from(bindings).map(([k, v]) => [k, { ...v }]));
      const restoreBindings = (savedBindings: Map<TypeParameterType, Binding>) => {
        for (const [key, value] of savedBindings) {
          bindings.set(key, value);
        }
      };
      const bind = (rawTypeTemplate: Type, rawActualType: Type, variance: TypeVariance): boolean => {
        const typeTemplate = rawTypeTemplate.lambdaErasure();
        const actualType = rawActualType.lambdaErasure();
        const binding = bindings.get(typeTemplate as TypeParameterType);
        if (binding) {
          const boundType = binding.type;
          const name = binding.typeParameter.typeTypeData.type.identifier.name;
          if (boundType) {
            switch (variance) {
              case COVARIANT:
                if (!actualType.isAssignableTo(boundType)) {
                  this.error(
                    n.location,
                    `Bound variable conflict (covariant), ` +
                    `already have ${name}=${boundType}, but got ${actualType}`);
                  return false;
                }
                return true;
              case CONTRAVARIANT:
                if (!boundType.isAssignableTo(actualType)) {
                  this.error(
                    n.location,
                    `Bound variable conflict (contravariant), ` +
                    `already have ${name}=${boundType}, but got ${actualType}`);
                  return false;
                }
                return true;
              default:
                if (!(actualType.isAssignableTo(boundType) && boundType.isAssignableTo(actualType))) {
                  this.error(
                    n.location,
                    `Bound variable conflict (invariant), ` +
                    `already have ${name}=${boundType}, but got ${actualType}`);
                  return false;
                }
                return true;
            }
          } else {
            const name = binding.typeParameter.typeTypeData.type.identifier.name;
            const constraint = binding.typeParameter.typeTypeData.type.typeParameterTypeData.constraint;
            binding.type = actualType;
            if (!actualType.isAssignableTo(constraint)) {
              this.error(
                n.location,
                `${actualType} cannot be assigned to type parameter ${name} with constraint ${constraint}`);
              return false;
            }
            return true;
          }
        }

        // If the types satisfy the requirements of the variance without any further binding,
        // there isn't any binding that is needed.
        // Similarly, if the requirements of the variance cannot be satisfied due to the
        // limited ways it can happen, we can determine quickly whether the binding will fail.
        switch (variance) {
          case COVARIANT:
            if (typeTemplate.isAssignableTo(actualType)) return true;
            if (typeTemplate === AnyType || actualType === NeverType) return false;
            if (typeTemplate === NullType) return !!actualType.nullableTypeData;
            if (typeTemplate.unionTypeData) {
              const saved = saveBindings();
              for (const memberType of typeTemplate.unionTypeData.types) {
                if (!bind(memberType, actualType, variance)) {
                  restoreBindings(saved);
                  return false;
                }
              }
              return true;
            }
            if (actualType.iterableTypeData) {
              const actualItemType = actualType.iterableTypeData.itemType;
              const templateItemType = typeTemplate.getIterableItemType();
              if (!templateItemType) return false;
              return bind(templateItemType, actualItemType, variance);
            }
            break;
          case CONTRAVARIANT:
            if (actualType.isAssignableTo(typeTemplate)) return true;
            if (typeTemplate === NeverType || actualType === AnyType) return false;
            if (actualType === NullType) return !!typeTemplate.nullableTypeData;
            if (actualType.unionTypeData) {
              const saved = saveBindings();
              for (const memberType of actualType.unionTypeData.types) {
                if (!bind(typeTemplate, memberType, variance)) {
                  restoreBindings(saved);
                  return false;
                }
              }
              return true;
            }
            if (typeTemplate.iterableTypeData) {
              const templateItemType = typeTemplate.iterableTypeData.itemType;
              const actualItemType = actualType.getIterableItemType();
              if (!actualItemType) return false;
              return bind(templateItemType, actualItemType, variance);
            }
            break;
          default:
            if (typeTemplate.isAssignableTo(actualType) && actualType.isAssignableTo(typeTemplate)) return true;
            if (typeTemplate === AnyType || actualType === NeverType) return false;
            if (typeTemplate === NeverType || actualType === AnyType) return false;
            if (typeTemplate === NullType || actualType === NullType) return false;
            if (typeTemplate.unionTypeData || actualType.unionTypeData) {
              // NOTE: technically we sould try every permutation against every permutation in
              // both directions. But that seemse excessive...
              // For now let's assume that this always fails
              return false;
            }
            break;
        }

        if (typeTemplate.nullableTypeData && actualType.nullableTypeData) {
          return bind(typeTemplate.nullableTypeData.itemType, actualType.nullableTypeData.itemType, variance);
        }
        if (typeTemplate.listTypeData && actualType.listTypeData) {
          return bind(typeTemplate.listTypeData.itemType, actualType.listTypeData.itemType, variance);
        }
        if (typeTemplate.iterableTypeData && actualType.iterableTypeData) {
          return bind(typeTemplate.iterableTypeData.itemType, actualType.iterableTypeData.itemType, variance);
        }
        if (typeTemplate.promiseTypeData && actualType.promiseTypeData) {
          return bind(typeTemplate.promiseTypeData.valueType, actualType.promiseTypeData.valueType, variance);
        }

        if (typeTemplate.functionTypeData && actualType.functionTypeData) {
          const templateData = typeTemplate.functionTypeData;
          const actualData = actualType.functionTypeData;
          const tplen = templateData.parameterTypes.length;
          const aplen = actualData.parameterTypes.length;
          if (variance === COVARIANT && aplen < tplen) return false;
          if (variance === CONTRAVARIANT && aplen > tplen) return false;
          if (variance === INVARIANT && aplen !== aplen) return false;
          const len = Math.min(aplen, tplen);
          if (!bind(templateData.returnType, actualData.returnType, variance)) return false;
          const flippedVariance = flipVariance(variance);
          for (let i = 0; i < len; i++) {
            if (!bind(templateData.parameterTypes[i], actualData.parameterTypes[i], flippedVariance)) return false;
          }
          return true;
        }

        // once we have exhausted all possible ways unification can happen, we return failure.
        return false;
      };
      const substitute = (rawType: Type, variance: TypeVariance): Type => {
        const type = rawType.lambdaErasure();
        const binding = bindings.get(type as TypeParameterType);
        if (binding) {
          const boundType = binding.type;
          if (boundType) {
            return boundType;
          } else {
            // If don't (yet) know the type, we pick the maximally optimistic type.
            // This depends on the variance.
            switch (variance) {
              case COVARIANT: return NeverType;
              case CONTRAVARIANT: return AnyType;
              default:
                // If the binding is invariant, there is no maximally optimistic type.
                // When the binding is invariant, the substitution must be exact.
                // The substitution cannot succeed.
                throw SUBSTITUTION_FAILURE;
            }
          }
        }
        if (type.nullableTypeData) {
          return substitute(type.nullableTypeData.itemType, variance).nullable();
        }
        if (type.listTypeData) {
          return substitute(type.listTypeData.itemType, variance).list();
        }
        if (type.promiseTypeData) {
          return substitute(type.promiseTypeData.valueType, variance).promise();
        }
        if (type.unionTypeData) {
          return type.unionTypeData.types.map(
            t => substitute(t, variance)).reduce((lhs, rhs) => lhs.getCommonType(rhs));
        }
        if (type.iterableTypeData) {
          return substitute(type.iterableTypeData.itemType, variance).iterable();
        }
        if (type.functionTypeData) {
          const flippedVariance = flipVariance(variance);
          return newFunctionType(
            type.functionTypeData.parameterTypes.map(pt => substitute(pt, flippedVariance)),
            substitute(type.functionTypeData.returnType, variance));
        }
        if (type.hasTypeVariable()) throw SUBSTITUTION_FAILURE;
        return type;
      };
      try {
        if (this.hintExplicitlyProvided) {
          if (!bind(method.returnType, this.hint, COVARIANT)) {
            return failBinding('incompatible return type');
          }
        }
        const boundParameters: Parameter[] = [];
        for (let i = 0; i < method.parameters.length; i++) {
          const priorParameterType = substitute(method.parameters[i].type, CONTRAVARIANT);
          const info = this.solveExpr(argExprs[i], priorParameterType);
          argResults.push(info);
          if (!bind(method.parameters[i].type, info.type, CONTRAVARIANT)) {
            return failBinding(`incompatible parameter ${i}`);
          }
          boundParameters.push({ identifier: method.parameters[i].identifier, type: info.type });
          if (info.value !== undefined) argValues.push(info.value);
          argIRs.push(info.ir);
        }
        const returnType = substitute(method.returnType, COVARIANT);
        maybeReturnType = returnType;

        // If we have a successful binding, it can be useful to show the user what
        // the bound method signature looks like
        this.markReference(
          { identifier: method.identifier, type: newLambdaType(undefined, boundParameters, returnType) },
          n.identifier.location.range);
      } catch (e) {
        if (e === SUBSTITUTION_FAILURE) return failBinding('substitution failure');
        throw e;
      }
    } else if (possibleMethods.length > 1) {
      // method is overloaded, and we use the argument types to determine which overload to use.
      for (let i = 0; i < n.args.length; i++) {
        const info = this.solveExpr(
          argExprs[i],
          possibleMethods.length === 1 ? possibleMethods[0].parameters[i].type : AnyType);
        argResults.push(info);
        if (info.value !== undefined) argValues.push(info.value);
        argIRs.push(info.ir);
        for (let j = 0; j < possibleMethods.length;) {
          const possibleMethod = possibleMethods[j];
          if (!info.type.isAssignableTo(possibleMethod.parameters[i].type)) {
            possibleMethods.splice(j, 1);
            if (possibleMethods.length === 0) {
              this.error(n.args[i].location, `No possible overload with given argument types`);
            }
          } else {
            j++;
          }
        }
      }
      // If there is at least one possible method, pick the first one.
      method = possibleMethods[0];
      if (!method) {
        // no possible methods
        this.markReference(firstGuessMethod.sourceVariable, n.identifier.location.range);
        this.error(n.location, `No candidate methods for ${n.identifier.name} match the given arguments`);
        return { type: AnyType, ir: n };
      }
      maybeReturnType = method.returnType;
      this.markReference(method.sourceVariable, n.identifier.location.range);
    } else {
      this.markReference(method.sourceVariable, n.identifier.location.range);
      maybeReturnType = method.returnType;
      for (let i = 0; i < method.parameters.length; i++) {
        const info = this.solveExpr(argExprs[i], method.parameters[i].type);
        argResults.push(info);
        if (info.value !== undefined) argValues.push(info.value);
        argIRs.push(info.ir);
      }
    }
    const returnType = maybeReturnType || AnyType;

    // If we did not encounter any errors, as a bonus, try computing the static value
    let staticValue: Value | undefined;
    if (this.getErrorCount() === startErrorCount &&
      owner.value !== undefined && argValues.length === method.parameters.length) {
      if (owner.value === printFunction && argValues.length === 1) {
        this.annotation.printInstances.push({
          range: n.location.range,
          value: argValues[0],
        });
      } else {
        staticValue = evalMethodCallCatchExc(owner.value, method, argValues);
      }
    }

    const methodIdentifier =
      method.aliasFor ?
        new ast.IdentifierNode(n.identifier.location, method.aliasFor) :
        method.identifier.name.startsWith('__') ? n.identifier :
          n.identifier;

    const value = method.inlineValue !== undefined ? method.inlineValue : staticValue;

    return {
      type: returnType,
      value,
      thunk:
        (value == undefined && hasThunkOrValue(owner) && argResults.every(e => hasThunkOrValue(owner))) ?
          (staticEvalScope: Scope): Value | undefined => {
            const ownerValue = getValue(staticEvalScope, owner);
            const argValues = argResults.map(arg => getValue(staticEvalScope, arg));
            return evalMethodCallCatchExc(ownerValue, method, argValues);
          } : undefined,
      ir:
        (method.identifier.name === `__get_${method.sourceVariable.identifier.name}` &&
          method.sourceVariable.inlineIR) ?
          method.sourceVariable.inlineIR :
          typeof method.inlineValue === 'string' ?
            new ast.StringLiteral(n.location, method.inlineValue) :
            typeof method.inlineValue === 'number' ?
              new ast.NumberLiteral(n.location, method.inlineValue) :
              new ast.MethodCall(n.location, owner.ir, methodIdentifier, argIRs),
    };
  }
  visitLogicalNot(n: ast.LogicalNot): EResult {
    const { value, ir: valueIR } = this.solveExpr(n.value);
    return {
      type: BoolType,
      value: value === undefined ? undefined : !value,
      ir: new ast.LogicalNot(n.location, valueIR),
    };
  }
  visitLogicalAnd(n: ast.LogicalAnd): EResult {
    const { value: lhs, ir: lhsIR } = this.solveExpr(n.lhs);
    const { value: rhs, ir: rhsIR } = this.solveExpr(n.rhs);
    return {
      type: BoolType,
      value: (lhs !== undefined && !lhs) ? lhs : rhs,
      ir: new ast.LogicalAnd(n.location, lhsIR, rhsIR),
    };
  }
  visitLogicalOr(n: ast.LogicalOr): EResult {
    const { value: lhs, ir: lhsIR } = this.solveExpr(n.lhs);
    const { value: rhs, ir: rhsIR } = this.solveExpr(n.rhs);
    return {
      type: BoolType,
      value: (lhs !== undefined && lhs) ? lhs : rhs,
      ir: new ast.LogicalOr(n.location, lhsIR, rhsIR),
    };
  }
  visitConditional(n: ast.Conditional): EResult {
    const condition = this.solveExpr(n.condition);
    const lhs = this.solveExpr(n.lhs);
    const rhs = this.solveExpr(n.rhs);
    const value = condition.value === undefined ?
      undefined :
      condition.value ? lhs.value : rhs.value;
    return {
      type: lhs.type.getCommonType(rhs.type),
      value,
      ir: new ast.Conditional(n.location, condition.ir, lhs.ir, rhs.ir),
    };
  }
  visitTypeAssertion(n: ast.TypeAssertion): EResult {
    const startErrorCount = this.getErrorCount();
    const type = this.solveType(n.type);
    const result = this.solveExpr(n.value, type, false);

    // Warn about specific kinds of type assertions
    if (type === AnyType || result.type === AnyType || result.type.isAssignableTo(type)) {
      // Casting to or from Any is always allowed
      // This allows using Any as an intermediate type when you want to ignore
      // type assertion warnings
      //
      // Upcasting is also always allowed. Generally this is not needed, but
      // it can help with documentation or pushing a certain type to be inferred at
      // a specific location.
      //
    } else if (result.type.nullableTypeData && !type.nullableTypeData) {
      // casting a nullable to a non-nullable is a bit suspicious.
      // It might be better to just get the inside value first
      this.error(n.type.location, `Call '.get()' on Nullable values before making type assertions`);
    }

    let value = startErrorCount === this.getErrorCount() ?
      result.value : undefined;
    return { type, value, ir: result.ir };
  }
  visitNativeExpression(n: ast.NativeExpression): EResult {
    if (n.kindFragment) {
      this.annotation.completionPoints.push({
        range: n.kindFragment?.location.range,
        getCompletions() {
          return [
            { name: 'function' },
            { name: 'constexpr' },
          ];
        },
      });
    }
    let value: Value | undefined;
    if (n.isConstexpr) {
      try {
        value = Function(`return ${n.source.value}`)();
      } catch (e) {
        // could not be evaluated inline
        this.error(n.location, `error in native constexpr: ${e}`);
      }
    }
    return { type: AnyType, value, ir: n };
  }
  visitNativePureFunction(n: ast.NativePureFunction): EResult {
    const parameters: Parameter[] = n.parameters.map(p => ({
      identifier: p.identifier,
      type: p.type ? this.solveType(p.type) : AnyType,
      defaultValue: p.value || undefined,
    }));
    const returnType = n.returnType ? this.solveType(n.returnType) : AnyType;
    const lambdaType = newLambdaType(undefined, parameters, returnType);
    const paramNames = n.parameters.map(p => p.identifier.name);
    for (const statement of n.body.statements) {
      if (statement instanceof ast.ExpressionStatement) {
        const expression = statement.expression;
        if (expression instanceof ast.IdentifierNode) {
          this.annotation.completionPoints.push({
            range: expression.location.range,
            getCompletions() {
              return [
                { name: 'returns' },
              ];
            },
          });
        }
      }
    }
    const body = n.getJavascriptReturnExpression();
    const jsName = n.identifier?.name ? translateVariableName(n.identifier.name) : undefined;
    let value: Value | undefined;
    if (body !== undefined) {
      try {
        if (jsName) {
          value = Function(
            `"use strict";const ${jsName}=(${paramNames.join(',')})=>{return ${body}};return ${jsName}`)() as any;
        } else {
          value = Function(...paramNames, `"use strict";return ${body}`) as any;
        }
      } catch (e) {
        this.error(n.location, `Error with native function: ${e}`);
      }
    }
    return {
      type: lambdaType,
      value,
      ir: n,
    };
  }
  visitEmptyStatement(n: ast.EmptyStatement): SResult {
    return { status: Continues, ir: n };
  }
  visitCommentStatement(n: ast.CommentStatement): SResult {
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitExpressionStatement(n: ast.ExpressionStatement): SResult {
    const expression = this.solveExpr(n.expression);
    return {
      status: Continues,
      ir: isNOOPExpression(expression) ?
        new ast.EmptyStatement(n.location) :
        new ast.ExpressionStatement(n.location, expression.ir),
    };
  }
  visitBlock(n: ast.Block): SResult {
    return this.scoped(() => {
      this.forwardDeclare(n.statements);
      let status: RunStatus = Continues;
      const irs: ast.Statement[] = [];
      for (const stmt of n.statements) {
        const r = this.solveStmt(stmt);
        if (r.status === Jumps) status = Jumps;
        else if (r.status === MaybeJumps && status !== Jumps) status = MaybeJumps;
        if (!(r.ir instanceof ast.EmptyStatement)) irs.push(r.ir);
      }
      return {
        status,
        ir: irs.length === 0 ?
          new ast.EmptyStatement(n.location) :
          new ast.Block(n.location, irs),
      };
    });
  }
  visitStatic(n: ast.Static): SResult {
    this.error(n.location, 'static blocks are not allowed here');
    return { status: Continues, ir: n };
  }
  visitDeclaration(n: ast.Declaration): SResult {
    const explicitType = n.type ? this.solveType(n.type) : undefined;
    const valueInfo = n.value ? this.solveExpr(n.value, explicitType) : null;
    if (!explicitType && !valueInfo) {
      this.error(n.location, `At least one of value or type of the variable must be specified`);
      return { status: Continues, ir: n };
    }
    const type = explicitType || valueInfo?.type || AnyType;
    const variable: Variable = {
      isPrivate: !n.isExported,
      isMutable: n.isMutable,
      identifier: n.identifier,
      type,
      comment: n.comment ||
        (n.value instanceof ast.FunctionDisplay ? getCommentFromFunctionDisplay(n.value) : undefined),
      value: n.isMutable ? undefined : valueInfo?.value,
    };
    this.declareVariable(variable);
    return {
      status: Continues,
      ir: new ast.Declaration(
        n.location, n.isExported, n.isMutable, n.identifier, n.type, n.comment,
        valueInfo?.ir || null
      ),
    };
  }
  visitIf(n: ast.If): SResult {
    const condition = this.solveExpr(n.condition);
    const lhs = this.solveBlock(n.lhs);
    const rhs = n.rhs ? this.solveStmt(n.rhs) : { status: Continues, ir: undefined };
    const status = (lhs.status === Jumps && rhs.status === Jumps) ? Jumps :
      (lhs.status === Jumps || lhs.status === MaybeJumps || rhs.status === Jumps || rhs.status === MaybeJumps) ?
        MaybeJumps : Continues;
    return {
      status,
      ir: new ast.If(
        n.location,
        condition.ir,
        lhs.ir,
        (rhs.ir || null) as ast.Block | ast.If | null),
    };
  }
  visitWhile(n: ast.While): SResult {
    const condition = this.solveExpr(n.condition);
    const body = this.solveBlock(n.body);
    return {
      status: MaybeJumps,
      ir: new ast.While(n.location, condition.ir, body.ir),
    };
  }
  visitBreak(n: ast.Break): SResult {
    return { status: Jumps, ir: n };
  }
  visitContinue(n: ast.Continue): SResult {
    return { status: Jumps, ir: n };
  }
  visitFor(n: ast.For): SResult {
    const collection = this.solveExpr(n.collection);
    const givenItemType = collection.type.getIterableItemType();
    if (!givenItemType) {
      this.error(n.collection.location, `Expected Iterable value`);
    }
    const itemType = givenItemType || AnyType;
    return this.scoped(() => {
      const variable: Variable = {
        isMutable: n.isMutable,
        identifier: n.identifier,
        type: itemType,
      };
      this.declareVariable(variable);
      const body = this.solveBlock(n.body);
      return {
        status: MaybeJumps,
        ir: new ast.For(n.location, n.isMutable, n.identifier, collection.ir, body.ir),
      };
    });
  }
  visitReturn(n: ast.Return): SResult {
    const returnType = this.currentAsyncType ?? (this.currentYieldType ? AnyType : this.currentReturnType);
    if (!returnType) {
      this.solveExpr(n.value);
      this.error(n.location, `return cannot appear outside a function`);
      return { status: Jumps, ir: n };
    }
    const value = this.solveExpr(n.value, returnType);
    return { status: Jumps, ir: new ast.Return(n.location, value.ir) };
  }
  visitClassDefinition(n: ast.ClassDefinition): SResult {
    // a lot is already handled by `forwardDeclare`
    const classTypeType = this.classMap.get(n);
    if (!classTypeType) throw new Error(`FUBAR class ${classTypeType}`);
    const classType = classTypeType.type.typeTypeData.type;
    const bodyIR: ast.Statement[] = [];
    if (n.extendsFragment) {
      this.annotation.completionPoints.push({
        range: n.extendsFragment?.location.range,
        getCompletions() { return [{ name: 'extends' }]; },
      });
    }
    this.scoped(() => {
      const thisVariable: Variable = {
        identifier: { name: 'this', location: n.identifier.location },
        type: classType,
      };
      this.scope['this'] = thisVariable;
      for (const statement of n.statements) {
        if (statement instanceof ast.Static) {
          const staticIR: ast.Statement[] = [];
          bodyIR.push(new ast.Static(statement.location, staticIR));
          for (const stmt of statement.statements) {
            if (stmt instanceof ast.Declaration) {
              if (!stmt.isMutable && stmt.value instanceof ast.FunctionDisplay) {
                // methods
                const value = this.solveExpr(stmt.value);
                staticIR.push(new ast.Declaration(
                  stmt.location,
                  stmt.isExported,
                  stmt.isMutable,
                  stmt.identifier,
                  stmt.type,
                  stmt.comment,
                  value.ir));
              } else if (stmt.type) {
                // fields
                bodyIR.push(stmt);
              }
            }
          }
          // TODO: check what is and is not allowed in static blocks
          continue;
        }
        if (statement instanceof ast.CommentStatement) {
          continue;
        }
        if (statement instanceof ast.ExpressionStatement) {
          if (statement.expression instanceof ast.StringLiteral) {
            // comments
            continue;
          }
          if (statement.expression instanceof ast.IdentifierNode) {
            // This is still an error, but gives us a chance to help autocomplete keywords
            this.annotation.completionPoints.push({
              range: statement.expression.location.range,
              getCompletions() {
                return [
                  { name: 'function' },
                  { name: 'var' },
                  { name: 'const' },
                ];
              },
            });
          }
        } else if (statement instanceof ast.Declaration) {
          if (!statement.isMutable && statement.value instanceof ast.FunctionDisplay) {
            // methods
            const value = this.solveExpr(statement.value);
            bodyIR.push(new ast.Declaration(
              statement.location,
              statement.isExported,
              statement.isMutable,
              statement.identifier,
              statement.type,
              statement.comment,
              value.ir));
          } else if (statement.type) {
            // fields
            bodyIR.push(statement);
          }
          continue;
        }
        this.error(statement.location, `Unexpected statement in class body`);
      }
    });
    return {
      status: Continues,
      ir: new ast.ClassDefinition(
        n.location,
        n.isExported,
        n.isAbstract,
        n.identifier,
        n.extendsFragment,
        n.superClass,
        bodyIR),
    };
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): SResult {
    // almost everything for interfaces is handled in `forwardDeclare`
    if (n.extendsFragment) {
      this.annotation.completionPoints.push({
        range: n.extendsFragment?.location.range,
        getCompletions() { return [{ name: 'extends' }]; },
      });
    }
    for (const statement of n.statements) {
      if (statement instanceof ast.Static) {
        for (const stmt of statement.statements) {
          if (stmt instanceof ast.ExpressionStatement && stmt.expression instanceof ast.IdentifierNode) {
            // This is still an error, but gives us a chance to help autocomplete keywords
            this.annotation.completionPoints.push({
              range: stmt.expression.location.range,
              getCompletions() {
                return [
                  { name: 'function' },
                  { name: 'var' },
                  { name: 'const' },
                  { name: 'aliasFor' },
                ];
              },
            });
          }
          // TOOD: check other kinds of statements here
        }
        continue;
      }
      if (statement instanceof ast.ExpressionStatement) {
        if (statement.expression instanceof ast.StringLiteral) {
          continue; // comments
        }
        if (statement.expression instanceof ast.IdentifierNode) {
          // This is still an error, but gives us a chance to help autocomplete keywords
          this.annotation.completionPoints.push({
            range: statement.expression.location.range,
            getCompletions() {
              return [
                { name: 'function' },
                { name: 'var' },
                { name: 'const' },
                { name: 'static' },
              ];
            },
          });
        }
      } else if (statement instanceof ast.Declaration) {
        // methods and properties
        continue;
      } else if (statement instanceof ast.CommentStatement) {
        continue; // comments
      }
      this.error(statement.location, `Unexpected statement in interface body`);
    }
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitEnumDefinition(n: ast.EnumDefinition): SResult {
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitImportAs(n: ast.ImportAs): SResult {
    if (!this.markedImports.has(n)) {
      this.error(n.location, `Import statement is not allowed here`);
    }
    return { status: MaybeJumps, ir: new ast.EmptyStatement(n.location) };
  }
  visitFromImport(n: ast.FromImport): SResult {
    if (!this.markedImports.has(n)) {
      this.error(n.location, `Import statement is not allowed here`);
    }
    return { status: MaybeJumps, ir: new ast.EmptyStatement(n.location) };
  }
  visitExportAs(n: ast.ExportAs): SResult {
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
  visitTypedef(n: ast.Typedef): SResult {
    // TODO: make it work for classes too
    return { status: Continues, ir: new ast.EmptyStatement(n.location) };
  }
}

function isNOOPExpression(er: EResult): boolean {
  return (
    er.ir instanceof ast.NullLiteral ||
    er.ir instanceof ast.BooleanLiteral ||
    er.ir instanceof ast.NumberLiteral ||
    er.ir instanceof ast.StringLiteral
  );
}

const moduleVariableMap = new WeakMap<ModuleType, ModuleVariable>();

function getModuleVariableForModuleType(moduleType: ModuleType): ModuleVariable {
  const cached = moduleVariableMap.get(moduleType);
  if (cached) return cached;
  const variable: ModuleVariable = {
    identifier: moduleType.identifier,
    type: moduleType,
    value: new ModuleValue(moduleType.moduleTypeData.annotation),
  };
  moduleVariableMap.set(moduleType, variable);
  return variable;
}

const diagnostics = vscode.languages.createDiagnosticCollection('yal');

export async function getAnnotationForURI(uri: vscode.Uri, stack = new Set<string>()): Promise<Annotation> {
  let maybeDocument: vscode.TextDocument | undefined;
  try {
    maybeDocument = await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    // failed to open document
  }
  const document = maybeDocument;
  if (!document) {
    // failed to open document
    const POS: Position = { line: 0, column: 0, index: 0 };
    const LOC: ast.Location = { uri, range: { start: POS, end: POS } };
    return {
      uri,
      documentVersion: -1,
      errors: [{
        location: LOC,
        message: `Could not open YAL source file`,
      }],
      variables: [],
      references: [],
      completionPoints: [],
      printInstances: [],
      callInstances: [],
      exportMap: new Map(),
      importMap: new Map(),
      importAliasVariables: [],
      memberImports: [],
      compileTimeConfigs: { addJS: new Set() },
      ir: new ast.File(LOC, -1, [], []),
    };
  }
  return await getAnnotationForDocument(document, stack);
}

const annotationCache = new Map<string, Annotation>();

export async function getAnnotationForDocument(
  document: vscode.TextDocument,
  stack = new Set<string>()
): Promise<Annotation> {
  const uri = document.uri;
  const key = uri.toString();
  const cached = annotationCache.get(key);
  const fileNode = await getAstForDocument(document);
  const limitedAnnotation: LimitedAnnotation = {
    uri,
    documentVersion: document.version,
    errors: [...fileNode.errors],
    variables: [],
    references: [],
    completionPoints: [],
    printInstances: [],
    callInstances: [],
    exportMap: new Map(),
    importMap: new Map(),
    importAliasVariables: [],
    memberImports: [],
  };
  const annotator = new Annotator({ annotation: limitedAnnotation, stack, cached });
  stack.add(key);
  const { useCached, ir, compileTimeConfigs } = await annotator.handle(fileNode);
  const annotation: Annotation = { ...limitedAnnotation, ir, compileTimeConfigs };
  stack.delete(key);
  // console.log(`DEBUG getAnnotationForDocument ${key} ${useCached ? '(cached)' : ''}`);
  if (cached && useCached) {
    return cached;
  }
  diagnostics.set(uri, annotation.errors.map(e => ({
    message: e.message,
    range: toVSRange(e.location.range),
    severity: vscode.DiagnosticSeverity.Warning,
  })));
  annotationCache.set(key, annotation);
  return annotation;
}
