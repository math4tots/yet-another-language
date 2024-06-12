import type { Interpreter } from "./interpreter";

export type TableValue = { [key: string]: Value; };
export type FunctionValue = ((this: Value, it: Interpreter, args: Value[]) => Value);

export type Value =
  null | boolean | number | string |
  Value[] | TableValue | FunctionValue;


function newTable(obj: TableValue): TableValue {
  const table: TableValue = Object.create(null);
  for (const key in obj) {
    table[key] = obj[key];
  }
  return table;
}

export const NullTable = newTable({});
export const BoolTable = newTable({});
export const FloatTable = newTable({});
export const StringTable = newTable({});
export const ListTable = newTable({});
export const FunctionTable = newTable({});

