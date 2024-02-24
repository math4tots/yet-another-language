import { RuntimeError } from "./error";

const CLASS_KEY = Symbol('class');

export type Value =
  null |
  boolean |
  number |
  string |
  Value[] |
  YALFunction |
  YALInstance |
  YALClass;

export type YALMethod = (recv: Value, args: Value[]) => Value;
export type YALFunction = YALMethod;
export type YALInstance = { [CLASS_KEY]: YALClass, [key: string]: Value; };
export type MethodMap = { [name: string]: YALMethod; };

export class YALClass {
  readonly name: string;
  readonly methodMap: MethodMap;
  constructor(name: string, methodMap: MethodMap | null = null) {
    this.name = name;
    this.methodMap = methodMap || Object.create(null);
  }
  addMethod(name: string, body: YALMethod) {
    this.methodMap[name] = body;
  }
}

export const NilClass = new YALClass('Nil');
export const BooleanClass = new YALClass('Boolean');
export const NumberClass = new YALClass('Number');
export const StringClass = new YALClass('String');
export const ListClass = new YALClass('List');
export const FunctionClass = new YALClass('Function');
export const ClassClass = new YALClass('Class');

export function getClass(value: Value): YALClass {
  const v = value;
  switch (typeof v) {
    case 'boolean': return BooleanClass;
    case 'number': return NumberClass;
    case 'string': return StringClass;
    case 'function': return FunctionClass;
    case 'object':
      if (v === null) return NilClass;
      if (Array.isArray(v)) return ListClass;
      if (v instanceof YALClass) return ClassClass;
      return v[CLASS_KEY];
  }
  throw new Error(`getClass(): INVALID YAL Value: typeof v = ${typeof v}, v = ${v}`);
}

export function callMethod(recv: Value, methodName: string, args: Value[]): Value {
  const cls = getClass(recv);
  const method = cls.methodMap[methodName];
  console.log(`method = ${method}, typeof method = ${typeof method}`);
  if (!method) {
    console.log(`METHOD NOT FOUND ${methodName}`);
    throw new RuntimeError(`Method ${methodName} not found on ${cls.name} instance`);
  }
  return method(recv, args);
}

export function instanceHasMethod(instance: Value, methodName: string): boolean {
  return !!getClass(instance).methodMap[methodName];
}

export function classHasMethod(cls: YALClass, methodName: string): boolean {
  return !!cls.methodMap[methodName];
}

export function isTruthy(value: Value): boolean {
  return value !== false && value !== null;
}

export function str(value: Value): string {
  return typeof value === 'string' ? value : repr(value);
}

export function repr(value: Value): string {
  const v = value;
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return '' + v;
    case 'string': return JSON.stringify(v);
    case 'function': return `<function>`;
    case 'object':
      if (v === null) return 'nil';
      if (Array.isArray(v)) return `[${v.map(x => repr(x)).join(', ')}]`;
      if (v instanceof YALClass) return `<class ${v.name}>`;
      return `<${v[CLASS_KEY].name} instance>`;
  }
}

ClassClass.addMethod('__call__', (recv: Value, args: Value[]): Value => {
  const cls = recv as YALClass;
  const instance: YALInstance = Object.create(null);
  instance[CLASS_KEY] = cls;
  return instance;
});
FunctionClass.addMethod('__call__', (recv: Value, args: Value[]): Value => {
  return (recv as YALFunction)(null, args);
});
; (() => {
  const pairs: [string, (lhs: number, rhs: number) => Value][] = [
    ['__add__', (lhs, rhs) => lhs + rhs],
    ['__sub__', (lhs, rhs) => lhs - rhs],
    ['__mul__', (lhs, rhs) => lhs * rhs],
    ['__div__', (lhs, rhs) => lhs / rhs],
  ];
  for (const [methodName, body] of pairs) {
    NumberClass.addMethod(methodName, (recv: Value, args: Value[]): Value => {
      if (args.length !== 1 || typeof args[0] !== 'number') {
        if (args.length !== 1) {
          throw new RuntimeError(`Expected exactly 1 args, but got ${args.length}`);
        }
        if (typeof args[0] !== 'number') {
          throw new RuntimeError(`Expected Number but got ${getClass(args[0]).name}`);
        }
      }
      return body(recv as number, args[0]);
    });
  }
})();
