import type { ExplicitVariable } from "./annotator";
import { Identifier, StringLiteral, ExplicitIdentifier } from "./ast";

export type Value =
  null | boolean | number | string |
  Value[] |
  Type |
  MethodBody |
  Instance |
  ModuleInstance
  ;

export function strValue(value: Value): string {
  return typeof value === 'string' ? value : reprValue(value);
}

export function reprValue(value: Value): string {
  const v = value;
  switch (typeof v) {
    case 'boolean':
    case 'number': return '' + v;
    case 'string': return JSON.stringify(v);
    case 'function': return `<function ${v.name}>`;
    case 'object':
      if (v === null) return 'nil';
      if (Array.isArray(v)) return `[${v.map(e => reprValue(e)).join(', ')}]`;
      if (v instanceof Type) return v.repr();
      if (v instanceof Instance) return v.toString();
      if (v instanceof ModuleInstance) return v.toString();
  }
  return `<badvalue typeof=${typeof v}, JSON=${JSON.stringify(v)}>`;
}

export class Type {
  readonly identifier: Identifier;
  private readonly methodMap = new Map<string, Method>();
  private readonly methods: Method[] = [];
  _listType: ListType | null = null;
  protected constructor(identifier: Identifier) {
    this.identifier = identifier;
  }
  toString(): string { return this.identifier.name; }
  addMethod(method: Method) {
    this.methods.push(method);
    this.methodMap.set(method.identifier.name, method);
  }
  getMethod(name: string): Method | null {
    return this.methodMap.get(name) || null;
  }
  getMethods(): Method[] { return this.methods; }
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
  implementsMethod(methodName: string, methodType: FunctionType): boolean {
    const method = this.methodMap.get(methodName);
    if (!method) return false;
    return method.type.isAssignableTo(methodType);
  }
  isAssignableTo(targetType: Type): boolean {
    const target = targetType;
    if (target === AnyType) return true;
    if (this === target) return true;
    if (target instanceof InterfaceType) return target.isImplementedBy(this);
    if (this instanceof ListType) {
      // TODO: Reconsider whether I want to allow Lists to be
      // treated as though they are covariant
      return target instanceof ListType && this.itemType.isAssignableTo(target);
    }
    if (this instanceof FunctionType) {
      if (!(target instanceof FunctionType)) {
        return false;
      }
      if (this.parameterTypes.length !== target.parameterTypes.length) {
        return false;
      }
      for (let i = 0; i < this.parameterTypes.length; i++) {
        if (!target.parameterTypes[i].isAssignableTo(this.parameterTypes[i])) {
          return false;
        }
      }
      if (!this.returnType.isAssignableTo(target.returnType)) {
        return false;
      }
      return true;
    }
    return false;
  }
  repr(): string { return this.identifier.name; }
}

export class NativeType extends Type {
  constructor(identifier: Identifier) {
    super(identifier);
  }
}

export interface Field {
  readonly isMutable: boolean;
  readonly identifier: Identifier;
  readonly type: Type;
}

export class ClassType extends Type {
  private readonly fieldMap = new Map<string, Field>();
  private readonly fields: Field[] = [];
  constructor(identifier: ExplicitIdentifier) {
    super(identifier);
  }
  addField(field: Field): void {
    this.fieldMap.set(field.identifier.name, field);
    this.fields.push(field);
  }
  getFields(): Field[] { return this.fields; }
  getField(name: string): Field | null {
    return this.fieldMap.get(name) || null;
  }
  repr(): string { return `<class ${this.identifier.name}>`; }
}

export class InterfaceType extends Type {
  private readonly cacheMap = new Map<Type, boolean>();
  constructor(identifier: ExplicitIdentifier) {
    super(identifier);
  }
  repr(): string { return `<interface ${this.identifier.name}>`; }
  isImplementedBy(src: Type): boolean {
    const type = src;
    if (type === this) return true;
    const cachedResult = this.cacheMap.get(type);
    if (cachedResult !== undefined) return cachedResult;
    let result = true;
    for (const method of this.getMethods()) {
      if (!type.implementsMethod(method.identifier.name, method.type)) {
        result = false;
        break;
      }
    }
    this.cacheMap.set(type, result);
    return result;
  }
}

export class ModuleType extends Type {
  private readonly typeMap = new Map<string, ExplicitVariable>();
  private readonly memberTypeVariables: ExplicitVariable[] = [];
  constructor(identifier: ExplicitIdentifier) {
    super(identifier);
  }
  addMemberTypeVariable(key: string, variable: ExplicitVariable) {
    this.typeMap.set(key, variable);
    this.memberTypeVariables.push(variable);
  }
  getMemberTypeVariable(key: string): ExplicitVariable | null {
    return this.typeMap.get(key) || null;
  }
  getMemberTypeVariables(): ExplicitVariable[] { return this.memberTypeVariables; }
  repr(): string { return `<module ${this.identifier.name}>`; }
}

export class ListType extends Type {
  static of(itemType: Type): ListType {
    if (itemType._listType) {
      return itemType._listType;
    }
    const listType = new ListType(
      { location: null, name: `List[${itemType.identifier.name}]` }, itemType);
    itemType._listType = listType;
    addListMethods(listType);
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
    if (type) return type;
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

export const AnyType = new NativeType({ location: null, name: 'Any' });
export const NilType = new NativeType({ location: null, name: 'Nil' });
export const BoolType = new NativeType({ location: null, name: 'Bool' });
export const NumberType = new NativeType({ location: null, name: 'Number' });
export const StringType = new NativeType({ location: null, name: 'String' });

export type MethodBody = (recv: Value, args: Value[]) => (Value | undefined);

export class Method {
  readonly identifier: Identifier;
  readonly type: FunctionType;

  // A "body" is only present if the method is "pure",
  // i.e. it can be computed at compile time, and has no side-effects
  // used for constexpr evaluation
  readonly body: MethodBody | null;

  readonly comment: StringLiteral | null;

  constructor(identifier: Identifier, type: FunctionType, body: MethodBody | null,
    comment: StringLiteral | null = null) {
    this.identifier = identifier;
    this.type = type;
    this.body = body;
    this.comment = comment;
  }
}

// An instance of a Class - used for constexpr evaluation
export class Instance {
  readonly type: ClassType;
  readonly values: (Value | undefined)[]; // field values (undefined if unknown)
  constructor(type: ClassType, values: (Value | undefined)[]) {
    this.type = type;
    this.values = values;
  }
  toString() { return `<${this.type.identifier.name} instance>`; }
  getField(name: string): Value | undefined {
    const fields = this.type.getFields();
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].identifier.name === name) {
        return i < this.values.length ? this.values[i] : undefined;
      }
    }
  }
}

// Like Instance, but for modules
export class ModuleInstance {
  readonly type: ModuleType;
  constructor(type: ModuleType) {
    this.type = type;
  }
  toString() { return this.type.identifier.name; }
}

// Add builtin methods
(() => {
  const B = BoolType;
  const N = NumberType;
  const S = StringType;

  function addMethod(name: string, c: NativeType, args: Type[], ret: Type,
    body: MethodBody | null) {
    c.addMethod(new Method({ location: null, name }, FunctionType.of(args, ret), body));
  }

  // Number methods
  addMethod('__add__', N, [N], N, (recv, args) => (recv as number) + (args[0] as number));
  addMethod('__sub__', N, [N], N, (recv, args) => (recv as number) - (args[0] as number));
  addMethod('__mul__', N, [N], N, (recv, args) => (recv as number) * (args[0] as number));
  addMethod('__div__', N, [N], N, (recv, args) => (recv as number) / (args[0] as number));
  addMethod('__mod__', N, [N], N, (recv, args) => (recv as number) % (args[0] as number));
  addMethod('__pow__', N, [N], N, (recv, args) => (recv as number) ** (args[0] as number));
  addMethod('__lt__', N, [N], B, (recv, args) => (recv as number) < (args[0] as number));
  addMethod('__gt__', N, [N], B, (recv, args) => (recv as number) > (args[0] as number));
  addMethod('__le__', N, [N], B, (recv, args) => (recv as number) <= (args[0] as number));
  addMethod('__ge__', N, [N], B, (recv, args) => (recv as number) >= (args[0] as number));
  addMethod('__eq__', N, [N], B, (recv, args) => (recv as number) === (args[0] as number));
  addMethod('__ne__', N, [N], B, (recv, args) => (recv as number) !== (args[0] as number));
  addMethod('__neg__', N, [], N, (recv) => -(recv as number));
  addMethod('__pos__', N, [], N, (recv) => recv);

  // String methods
  addMethod('__add__', S, [S], S, (recv, args) => (recv as string) + (args[0] as string));
  addMethod('__mul__', S, [N], S, (recv, args) => (recv as string).repeat(args[0] as number));
  addMethod('get_size', S, [], N, (recv, args) => (recv as string).length);
})();

function addListMethods(c: ListType) {
  const N = NumberType;
  function addMethod(name: string, args: Type[], ret: Type, body: MethodBody | null) {
    c.addMethod(new Method({ location: null, name }, FunctionType.of(args, ret), body));
  }
  addMethod('get_size', [], N, (recv, args) => (recv as Value[]).length);
}
