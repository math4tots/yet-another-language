export const Any = Symbol('Any');
export const Nil = Symbol('Nil');
export const Bool = Symbol('Bool');
export const Number = Symbol('Number');
export const String = Symbol('String');

export const Kind = Symbol('Kind');
export const ListKind = Symbol('List');
export const TupleKind = Symbol('Tuple');
export const StructKind = Symbol('Struct');
export const FunctionKind = Symbol('Function');
export type ListType = { readonly [Kind]: typeof ListKind, readonly item: Type; };
export type TupleType = { readonly [Kind]: typeof TupleKind, readonly types: Type[]; };
export type StructType =
  { readonly [Kind]: typeof StructKind, readonly fields: [string, Type][]; };
export type FunctionType = {
  readonly [Kind]: typeof FunctionKind;
  readonly parameters: Type[];
  readonly returns: Type;
};

const registry = new Map<Type, number>();

function registerType(type: Type): number {
  const oldID = registry.get(type);
  if (oldID !== undefined) {
    return oldID;
  }
  const id = registry.size;
  registry.set(type, id);
  return id;
}
registerType(Any);
registerType(Nil);
registerType(Bool);
registerType(Number);
registerType(String);

const listTypeMap = new Map<Type, ListType>();

export function List(item: Type): ListType {
  const existingType = listTypeMap.get(item);
  if (existingType) {
    return existingType;
  }
  const type: ListType = { [Kind]: ListKind, item };
  registerType(type);
  listTypeMap.set(item, type);
  return type;
}

const tupleTypeMap = new Map<string, TupleType>();

export function Tuple(types: Type[]): TupleType {
  const key = types.map(t => registry.get(t) || -1).join(',');
  const existingType = tupleTypeMap.get(key);
  if (existingType) {
    return existingType;
  }
  const type: TupleType = { [Kind]: TupleKind, types: Array.from(types) };
  registerType(type);
  tupleTypeMap.set(key, type);
  return type;
}

const structTypeMap = new Map<string, StructType>();

export function Struct(fields: [string, Type][]): StructType {
  const pairs = Array.from(fields).sort((a, b) => a[0] < b[0] ? -1 : a[0] === b[0] ? 0 : 1);
  const key = pairs.map(pair => `${pair[0]},${registry.get(pair[1]) || -1}`).join(',');
  const existingType = structTypeMap.get(key);
  if (existingType) {
    return existingType;
  }
  const type: StructType = { [Kind]: StructKind, fields: Array.from(fields) };
  registerType(type);
  structTypeMap.set(key, type);
  return type;
}

const functionTypeMap = new Map<string, FunctionType>();

export function Function(parameters: Type[], returns: Type): FunctionType {
  const types = Array.from(parameters);
  types.push(returns);
  const key = types.map(t => registry.get(t) || -1).join(',');
  const existingType = functionTypeMap.get(key);
  if (existingType) {
    return existingType;
  }
  const type: FunctionType =
    { [Kind]: FunctionKind, parameters: Array.from(parameters), returns };
  registerType(type);
  functionTypeMap.set(key, type);
  return type;
}

export type Type =
  typeof Any |
  typeof Nil | typeof Bool | typeof Number | typeof String |
  ListType | TupleType | StructType | FunctionType;
