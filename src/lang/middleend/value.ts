import type { Annotation } from "./annotation";
import { printFunction } from "./print-function";

export type Value =
  null |
  boolean |
  number |
  string |
  Value[] |
  ModuleValue;


export function translateVariableName(name: string): string {
  if (name === 'this') return 'this';
  if (name.startsWith('__js_')) return name.substring(5);
  return 'YAL' + name;
}

export class ModuleValue {
  constructor(annotation: Annotation) {
    for (const variable of annotation.moduleVariableMap.values()) {
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
}

export function evalMethodCall(owner: any, methodName: string, args: any[]): Value | undefined {
  if (owner === printFunction) return;
  if (methodName === '__eq__' && args.length === 1) return owner === args[0];
  if (methodName === '__ne__' && args.length === 1) return owner !== args[0];
  switch (typeof owner) {
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
      } else if (owner instanceof ModuleValue) {
        if (methodName.startsWith('__get_')) {
          const fieldName = methodName.substring('__get_'.length);
          const modifiedFieldName = translateVariableName(fieldName);
          if ((owner as any)[modifiedFieldName]) return (owner as any)[modifiedFieldName];
        } else if (methodName.startsWith('__set_')) {
          // setters... ignore
        } else {
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

export function reprStaticValue(x: any): string {
  if (typeof x === 'function') return x.name ? `<function ${x.name}>` : '<function>';
  if (x instanceof ModuleValue) return '<module>';
  return JSON.stringify(x);
}

export function strStaticValue(x: any): string {
  return typeof x === 'string' ? x : reprStaticValue(x);
}
