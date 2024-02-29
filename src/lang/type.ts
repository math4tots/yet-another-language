import { Identifier, Variable } from "./ast";

export type Value =
  null | boolean | number | string |
  Value[] |
  Type |
  Method | // Single methods when passed around like values are functions
  Instance
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
    case 'object':
      if (v === null) return 'nil';
      if (Array.isArray(v)) return `[${v.map(e => reprValue(e)).join(', ')}]`;
      if (v instanceof Type) return v.repr();
      if (v instanceof Method) return `<function ${v.identifier.name}>`;
      if (v instanceof Instance) return v.toString();
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
  constructor(identifier: Variable) {
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

  constructor(identifier: Identifier, type: FunctionType, body: MethodBody | null) {
    this.identifier = identifier;
    this.type = type;
    this.body = body;
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

// Add builtin methods
(() => {
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

  // String methods
  addMethod('__add__', S, [S], S, (recv, args) => (recv as string) + (args[0] as string));
  addMethod('get_size', S, [], N, (recv, args) => (recv as string).length);
})();

function addListMethods(c: ListType) {
  const N = NumberType;
  function addMethod(name: string, args: Type[], ret: Type, body: MethodBody | null) {
    c.addMethod(new Method({ location: null, name }, FunctionType.of(args, ret), body));
  }
  addMethod('get_size', [], N, (recv, args) => (recv as Value[]).length);
}
