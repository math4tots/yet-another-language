import { Identifier } from "../ast";

type TypeConstructorParameters = {
  readonly identifier: Identifier;
  readonly listItemType?: Type;
  readonly hasFields?: boolean;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
};

type FunctionTypeData = {
  readonly parameterTypes: Type[];
  readonly returnType: Type;
};

type LambdaTypeData = {
  readonly functionType: Type;
};

export class Type {
  readonly identifier: Identifier;
  private _list?: Type;
  readonly listItemType?: Type;
  readonly fields?: Field[];
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
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
  }

  private getProxyType(): Type {
    return this.lambdaTypeData?.functionType || this;
  }

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

  addMethod(method: Method) {
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
  readonly identifier: Identifier;
  readonly type: Type;
};

export type Method = {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;
  readonly asFunctionType: Type;
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
  type?: Type,
  map: WeakMap<Type, Cache>,
};

const cache: Cache = { map: new WeakMap() };

export function newFunctionType(parameterTypes: Type[], returnType: Type): Type {
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
  const functionType = new Type({ identifier: { name }, functionTypeData });
  functionType.addMethod({
    identifier: { name: '__call__' },
    parameters: parameterTypes.map((ptype, i) => ({ identifier: { name: `arg${i}` }, type: ptype })),
    returnType,
    asFunctionType: functionType,
  });
  c.type = functionType;
  return functionType;
}

export function newLambdaType(parameters: Parameter[], returnType: Type): Type {
  const functionType = newFunctionType(parameters.map(p => p.type), returnType);
  const lambdaType = new Type({
    identifier: functionType.identifier,
    lambdaTypeData: { functionType },
  });
  lambdaType.addMethod({
    identifier: { name: '__call__' },
    parameters: [...parameters],
    returnType: returnType,
    asFunctionType: functionType,
  });
  return lambdaType;
}
