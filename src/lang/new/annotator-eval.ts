import { ModuleValue, Value } from "./annotator-defs";
import { translateVariableName } from "./translator-util";

export const printFunction = (function print(x: any) { console.log('' + x); return null; }) as any;

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
        if (methodName === '__get___size') return owner.length;
      } else if (args.length === 1) {
        const arg0 = args[0];
        if (typeof arg0 === 'string') {
          switch (methodName) {
            case '__lt__': return owner < arg0;
            case '__gt__': return owner > arg0;
            case '__le__': return owner <= arg0;
            case '__ge__': return owner >= arg0;
          }
        }
      }
      break;
    case 'object':
      if (Array.isArray(owner)) {
        if (args.length === 0) {
          if (methodName === '__get___size') return owner.length;
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
