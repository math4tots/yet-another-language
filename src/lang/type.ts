import { Identifier } from "./ast";

export type Value =
  null | boolean | number | string |
  Value[] |
  Type |
  Method // Single methods when passed around like values are functions
  ;

export class Type {
  readonly identifier: Identifier;
  private readonly methodMap = new Map<string, Method>();
  _listType: ListType | null = null;
  constructor(identifier: Identifier) {
    this.identifier = identifier;
  }
  addMethod(method: Method) {
    this.methodMap.set(method.identifier.name, method);
  }
  getMethod(name: string): Method | null {
    return this.methodMap.get(name) || null;
  }
  getCommonType(rhs: Type): Type {
    return this.isAssignableTo(rhs) ? rhs :
      rhs.isAssignableTo(this) ? this : AnyType;
  }
  isTypeOf(value: Value): boolean {
    if (this === AnyType) return true;
    const v = value;
    switch (typeof v) {
      case 'boolean': return this === BoolType;
      case 'number': return this === NumberType;
      case 'string': return this === StringType;
      case 'object':
        if (v === null) return this === NilType;
        if (Array.isArray(v)) return this instanceof ListType &&
          v.every(i => this.itemType.isTypeOf(i));
    }
    return false;
  }
  isAssignableTo(targetType: Type): boolean {
    if (targetType === AnyType) return true;
    if (this === targetType) return true;
    if (this instanceof ListType) {
      // TODO: Reconsider whether I want to allow Lists to be
      // treated as though they are covariant
      return targetType instanceof ListType && this.itemType.isAssignableTo(targetType);
    }
    if (this instanceof FunctionType) {
      if (!(targetType instanceof FunctionType)) {
        return false;
      }
      if (this.parameterTypes.length !== targetType.parameterTypes.length) {
        return false;
      }
      for (let i = 0; i < this.parameterTypes.length; i++) {
        if (!targetType.parameterTypes[i].isAssignableTo(this.parameterTypes[i])) {
          return false;
        }
      }
      if (!this.returnType.isAssignableTo(targetType.returnType)) {
        return false;
      }
      return true;
    }
    return false;
  }
}

export class ListType extends Type {
  static of(itemType: Type): ListType {
    if (itemType._listType) {
      return itemType._listType;
    }
    const listType = new ListType(
      { location: null, name: `List[${itemType.identifier.name}]` }, itemType);
    itemType._listType = listType;
    return listType;
  }
  readonly itemType: Type;
  private constructor(identifier: Identifier, itemType: Type) {
    super(identifier);
    this.itemType = itemType;
  }
}

const functionTypeMap = new Map<string, FunctionType>();

export class FunctionType extends Type {
  static of(parameterTypes: Type[], returnType: Type) {
    const key =
      Array.from(parameterTypes).concat([returnType]).map(t => t.identifier.name).join(',');
    const type = functionTypeMap.get(key);
    if (type) {
      return type;
    }
    const identifier: Identifier = { location: null, name: `Function[${key}]` };
    const functionType = new FunctionType(identifier, Array.from(parameterTypes), returnType);
    functionTypeMap.set(key, functionType);
    return functionType;
  }
  readonly parameterTypes: Type[];
  readonly returnType: Type;
  private constructor(identifier: Identifier, parameterTypes: Type[], returnType: Type) {
    super(identifier);
    this.parameterTypes = Array.from(parameterTypes);
    this.returnType = returnType;
  }
}

export const AnyType = new Type({ location: null, name: 'Any' });
export const NilType = new Type({ location: null, name: 'Nil' });
export const BoolType = new Type({ location: null, name: 'Bool' });
export const NumberType = new Type({ location: null, name: 'Number' });
export const StringType = new Type({ location: null, name: 'String' });

export class MethodSignature {
  readonly parameterTypes: Type[];
  readonly returnType: Type;
  constructor(parameterTypes: Type[], returnType: Type) {
    this.parameterTypes = Array.from(parameterTypes);
    this.returnType = returnType;
  }
}

export type MethodBody = (recv: Value, args: Value[]) => Value;

export class Method {
  readonly identifier: Identifier;
  readonly signature: MethodSignature;
  readonly body: MethodBody | null;
  constructor(identifier: Identifier, signature: MethodSignature, body: MethodBody | null) {
    this.identifier = identifier;
    this.signature = signature;
    this.body = body;
  }
}
