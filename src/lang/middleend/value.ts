import type { Annotation } from "./annotation";
import { printFunction } from "./functions";
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


/**
 * Translates variable names from YAL to JS.
 * 
 * This functionality arguably belongs in the backend, but is needed to properly handle
 * properties of values in the middleend
 */
export function translateVariableName(name: string): string {
  if (name === 'this') return 'this';
  if (name.startsWith('__js_')) return name.substring(5);
  return 'YAL' + name;
}

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

export function evalMethodCall(owner: any, method: Method, args: any[]): Value | undefined {
  if (method.inlineValue !== undefined) return method.inlineValue;
  const methodName = method.identifier.name;
  const endName = method.aliasFor || method.identifier.name;
  const allDefined = typeof owner !== 'undefined' && args.every(arg => typeof arg !== undefined);

  if (args.length === 0 && endName === '__op_noop__') return owner;
  if (owner === printFunction) return;

  if (allDefined) {
    if (args.length === 0 && endName.startsWith('__get___js_')) {
      return owner[endName.substring('__get___js_'.length)];
    }
    if (endName.startsWith('__js_')) return owner[endName.substring('__js_'.length)](...args);
    if (methodName === '__eq__' && args.length === 1) return owner === args[0];
    if (methodName === '__ne__' && args.length === 1) return owner !== args[0];
  }
  switch (typeof owner) {
    case 'undefined': return;
    case 'number':
      if (args.length === 0) {
        switch (methodName) {
          case '__pos__': return owner;
          case '__neg__': return -owner;
        }
      } else if (args.length === 1) {
        const arg0 = args[0];
        if (typeof arg0 === 'number') {
          switch (methodName) {
            case '__add__': return owner + arg0;
            case '__sub__': return owner - arg0;
            case '__mul__': return owner * arg0;
            case '__div__': return owner / arg0;
            case '__mod__': return owner % arg0;
            case '__lt__': return owner < arg0;
            case '__gt__': return owner > arg0;
            case '__le__': return owner <= arg0;
            case '__ge__': return owner >= arg0;
          }
        }
      }
      break;
    case 'string':
      if (args.length === 0) {
        if (methodName === '__get_size') return owner.length;
      } else if (args.length === 1) {
        const arg0 = args[0];
        if (typeof arg0 === 'string') {
          switch (methodName) {
            case '__lt__': return owner < arg0;
            case '__gt__': return owner > arg0;
            case '__le__': return owner <= arg0;
            case '__ge__': return owner >= arg0;
            case '__add__': return owner + arg0;
          }
        }
      }
      break;
    case 'object':
      if (Array.isArray(owner)) {
        if (args.length === 0) {
          if (methodName === '__get_size') return owner.length;
        } else if (args.length === 1) {
          const arg0 = args[0];
          if (typeof arg0 === 'number' && methodName === '__getitem__') {
            return owner[arg0];
          }
        }
      } else if (owner instanceof ModuleValue || owner instanceof RecordValue) {
        if (methodName.startsWith('__get_')) {
          const fieldName = methodName.substring('__get_'.length);
          const modifiedFieldName = translateVariableName(fieldName);
          if ((owner as any)[modifiedFieldName]) return (owner as any)[modifiedFieldName];
        } else if (methodName.startsWith('__set_')) {
          // setters... ignore
        } else {
          // NOTE: this may not correctly handle aliasing methods
          const modifiedMethodName = translateVariableName(methodName);
          if ((owner as any)[modifiedMethodName]) return (owner as any)[modifiedMethodName](...args);
        }
      } else {
        // Some other kind of object
      }
      break;
    case 'function':
      if (methodName === '__call__') return owner(...args);
      break;
  }
  return;
}
