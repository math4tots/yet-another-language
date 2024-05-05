import type { Annotation } from "./annotation";
import { nullGetFunction, nullMapFunction, printFunction } from "./functions";
import { translateFieldName, translateMethodName, translateVariableName } from "./names";
import type { Method } from "./type";

export type Value =
  null |
  boolean |
  number |
  string |
  Value[] |
  ModuleValue |
  Function |
  RecordValue;


export class ModuleValue {
  constructor(annotation: Annotation) {
    for (const variable of annotation.exportMap.values()) {
      if (!variable.isMutable && variable.value !== undefined) {
        Object.defineProperty(this, translateVariableName(variable.identifier.name), {
          value: variable.value,
          enumerable: true,
          writable: false,
        });
      }
    }
  }
  toString() { return '<module>'; }
  YAL__repr__() { return '<module>'; }
}

export class RecordValue {
  toJSON() {
    const object: { [key: string]: any; } = {};
    for (const key in this) {
      if (key.startsWith('YAL')) {
        object[key.substring('YAL'.length)] = this[key];
      }
    }
    return object;
  }
}

export function evalMethodCallCatchExc(owner: any, method: Method, args: any[]): Value | undefined {
  try {
    return evalMethodCall(owner, method, args);
  } catch (e) {
    return;
  }
}

export function evalMethodCall(owner: any, method: Method, args: any[]): Value | undefined {
  if (method.inlineValue !== undefined) return method.inlineValue;
  const resolvedMethodName = method.aliasFor || method.identifier.name;

  if (resolvedMethodName === '__op_noop__') return owner;
  if (owner === printFunction) return;

  // Beyond this point, we assume all values are available and parameter count matches
  if (owner === undefined ||
    args.some(arg => arg === undefined) ||
    method.parameters.length !== args.length) return;

  if (resolvedMethodName === '__call__') return owner(...args);
  if (resolvedMethodName.startsWith('__set_')) return;
  if (resolvedMethodName.startsWith('__op_setitem__')) return;

  switch (args.length) {
    case 0:
      if (resolvedMethodName.startsWith('__get_')) {
        const translatedFieldName = translateFieldName(resolvedMethodName.substring('__get_'.length));
        return owner[translatedFieldName];
      }
      switch (resolvedMethodName) {
        case '__op_neg__': return -owner;
        case '__op_pos__': return +owner;
        case '__op_isnull__': return (owner ?? null) === null;
        case '__op_hasvalue__': return (owner ?? null) !== null;
        case '__op_nullget__': return nullGetFunction(owner);
        case '__op_noop__': return owner;
        case '__op_0__': return owner[0];
        case '__op_1__': return owner[1];
        case '__op_2__': return owner[2];
        case '__op_3__': return owner[3];
        case '__op_4__': return owner[4];
        case '__op_5__': return owner[5];
        case '__op_6__': return owner[6];
      }
      break;
    case 1: {
      const arg = args[0];
      switch (resolvedMethodName) {
        case '__op_eq__': return owner === arg;
        case '__op_ne__': return owner !== arg;
        case '__op_lt__': return owner < arg;
        case '__op_le__': return owner <= arg;
        case '__op_gt__': return owner > arg;
        case '__op_ge__': return owner >= arg;
        case '__op_add__': return owner + arg;
        case '__op_sub__': return owner - arg;
        case '__op_mul__': return owner * arg;
        case '__op_div__': return owner / arg;
        case '__op_mod__': return owner % arg;
        case '__op_pow__': return owner ** arg;
        case '__op_nullish_coalescing__': return owner ?? arg;
        case '__op_nullmap__': return nullMapFunction(owner, arg);
        case '__op_getitem__': return owner[arg];
      }
      break;
    }
  }

  // "normal" method call
  const translatedMethodName = translateMethodName(resolvedMethodName, args.length);
  if (owner[translatedMethodName]) return owner[translatedMethodName](...args);
}
