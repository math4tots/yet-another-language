import { Identifier, IdentifierNode } from "../ast";
import type { Annotation, Variable } from "./annotator";

type TypeConstructorParameters = {
  readonly identifier: Identifier;
  readonly listItemType?: Type;
  readonly hasFields?: boolean;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
};

type FunctionTypeData = {
  readonly parameterTypes: Type[];
  readonly returnType: Type;
};

type LambdaTypeData = {
  readonly parameters: Parameter[];
  readonly functionType: FunctionType;
  readonly returnType: Type;
};

type ModuleTypeData = {
  readonly annotation: Annotation;
};

export type LambdaType = Type & { readonly lambdaTypeData: LambdaTypeData; };
export type FunctionType = Type & { readonly functionTypeData: FunctionTypeData; };
export type ModuleType = Type & { readonly moduleTypeData: ModuleTypeData; };

export class Type {
  readonly identifier: Identifier;
  private _list?: Type;
  readonly listItemType?: Type;
  readonly fields?: Field[];
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  private readonly _methods: Method[] = [];
  private readonly _methodMap = new Map<string, Method>();

  constructor(parameters: TypeConstructorParameters) {
    const params = parameters;
    this.identifier = params.identifier;
    if (params.listItemType) {
      this.listItemType = params.listItemType;
    }
    if (params.hasFields) {
      this.fields = [];
    }
    if (params.functionTypeData) {
      this.functionTypeData = params.functionTypeData;
    }
    if (params.lambdaTypeData) {
      this.lambdaTypeData = params.lambdaTypeData;
    }
    if (params.moduleTypeData) {
      this.moduleTypeData = params.moduleTypeData;
    }
  }

  private getProxyType(): Type {
    return this.lambdaTypeData?.functionType || this;
  }

  isFunctionType(): boolean { return !!this.getProxyType().functionTypeData; }

  isAssignableTo(givenTarget: Type): boolean {
    const source = this.getProxyType();
    const target = givenTarget.getProxyType();
    if (source === target || target === AnyType || source === NeverType) return true;
    return false;
  }

  getCommonType(givenRhs: Type): Type {
    const lhs = this.getProxyType();
    const rhs = givenRhs.getProxyType();
    return this.isAssignableTo(rhs) ? rhs :
      rhs.isAssignableTo(this) ? this : AnyType;
  }

  toString(): string { return this.identifier.name; }

  list(): Type {
    const cached = this._list;
    if (cached) return cached;
    const listType = new Type({
      identifier: { name: `List[${this.identifier.name}]` },
      listItemType: this,
    });
    this._list = listType;
    return listType;
  }

  get methods(): Method[] { return [...this._methods]; }
  getMethod(key: string): Method | null { return this._methodMap.get(key) || null; }

  addMethod(params: NewMethodParameters) {
    const method = newMethod(params);
    this._methods.push(method);
    this._methodMap.set(method.identifier.name, method);
  }
}

export type Field = {
  readonly isMutable?: boolean;
  readonly identifier: Identifier;
  readonly type: Type;
};

export type Parameter = {
  readonly isMutable?: boolean;
  readonly identifier: Identifier;
  readonly type: Type;
};

export type Method = {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;

  /**
   * Type of this method, if this method were a function.
   * This can be reconstructed from `parameters` and `returnType`,
   * but is provided here so that it doesn't always have to be reconstructed
   */
  readonly functionType: FunctionType;

  /**
   * The "source" variable associated with this method.
   * 
   * This is the Variable that this method "comes from".
   * 
   * In some cases, a single "Variable" can be associated with multiple
   * methods (e.g. with set_* and get_* style Methods).
   */
  readonly sourceVariable: Variable;
};

export const AnyType = new Type({ identifier: { name: 'Any' } });
export const NeverType = new Type({ identifier: { name: 'Never' } });

export const NilType = new Type({ identifier: { name: 'Nil' } });
export const BoolType = new Type({ identifier: { name: 'Bool' } });
export const NumberType = new Type({ identifier: { name: 'Number' } });
export const StringType = new Type({ identifier: { name: 'String' } });

export function newClassType(identifier: Identifier) {
  const type = new Type({ identifier, hasFields: true });
  return type;
}

type Cache = {
  type?: FunctionType,
  map: WeakMap<Type, Cache>,
};

const cache: Cache = { map: new WeakMap() };

export function newFunctionType(parameterTypes: Type[], returnType: Type): FunctionType {
  const types = [...parameterTypes, returnType];
  let c = cache;
  for (const type of types) {
    const foundChild = c.map.get(type);
    if (foundChild) {
      c = foundChild;
    } else {
      const newChild: Cache = { map: new WeakMap() };
      c.map.set(type, newChild);
      c = newChild;
    }
  }
  const cached = c.type;
  if (cached) return cached;
  const name = `Function[${types.map(t => t.toString()).join(',')}]`;
  const functionTypeData: FunctionTypeData = { parameterTypes: [...parameterTypes], returnType };
  const functionType = new Type({ identifier: { name }, functionTypeData }) as FunctionType;
  functionType.addMethod({
    identifier: { name: '__call__' },
    parameters: parameterTypes.map((ptype, i) => ({ identifier: { name: `arg${i}` }, type: ptype })),
    returnType,
    functionType,
  });
  c.type = functionType;
  return functionType;
}

export function newLambdaType(parameters: Parameter[], returnType: Type): LambdaType {
  const functionType = newFunctionType(parameters.map(p => p.type), returnType);
  const lambdaType = new Type({
    identifier: functionType.identifier,
    lambdaTypeData: { functionType, parameters: [...parameters], returnType },
  });
  lambdaType.addMethod({
    identifier: { name: '__call__' },
    parameters: [...parameters],
    returnType: returnType,
    functionType,
  });
  return lambdaType as LambdaType;
}

const moduleTypeCache = new WeakMap<Annotation, ModuleType>();

export function newModuleType(annotation: Annotation): ModuleType {
  const cached = moduleTypeCache.get(annotation);
  if (cached) return cached;
  const identifier: Identifier = {
    name: '(module)',
    location: {
      uri: annotation.uri, range: {
        start: { line: 0, column: 0, index: 0 },
        end: { line: 0, column: 0, index: 0 }
      },
    },
  };
  const moduleType = new Type({ identifier, moduleTypeData: { annotation } }) as ModuleType;
  for (const variable of annotation.moduleVariables) {
    moduleType.addMethod({
      identifier: { name: `get_${variable.identifier.name}` },
      parameters: [],
      returnType: variable.type,
      sourceVariable: variable,
    });
    if (variable.isMutable) {
      moduleType.addMethod({
        identifier: { name: `set_${variable.identifier.name}` },
        parameters: [{ identifier: variable.identifier, type: variable.type }],
        returnType: NilType,
        sourceVariable: variable,
      });
    } else {
      const lambdaTypeData = variable.type.lambdaTypeData;
      if (lambdaTypeData) {
        const { parameters, returnType } = lambdaTypeData;
        moduleType.addMethod({
          identifier: variable.identifier,
          parameters: [...parameters],
          returnType,
          functionType: lambdaTypeData.functionType,
          sourceVariable: variable,
        });
      }
    }
  }
  return moduleType;
}

interface NewMethodParameters {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;

  /**
   * Type of this method, if this method were a function.
   * This can be reconstructed from `parameters` and `returnType`,
   * but is provided here so that it doesn't always have to be reconstructed
   */
  readonly functionType?: FunctionType;

  /**
   * The "source" variable associated with this method.
   * 
   * This is the Variable that this method "comes from".
   * 
   * In some cases, a single "Variable" can be associated with multiple
   * methods (e.g. with set_* and get_* style Methods).
   */
  readonly sourceVariable?: Variable;
};

function newMethod(params: NewMethodParameters): Method {
  const functionType: FunctionType =
    params.functionType || newFunctionType(params.parameters.map(p => p.type), params.returnType);
  const sourceVariable: Variable = params.sourceVariable || {
    identifier: params.identifier,
    type: functionType,
  };
  return {
    identifier: params.identifier,
    parameters: params.parameters,
    returnType: params.returnType,
    functionType,
    sourceVariable,
  };
}
