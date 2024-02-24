import { Location } from "./ast";

export const errorStack: Location[] = [];

export class RuntimeError {
  message: string;
  stack: Location[];
  constructor(message: string, location: Location | null = null) {
    this.message = message;
    this.stack = Array.from(errorStack);
    if (location) {
      this.stack.push(location);
    }
  }
  toString() {
    const locs = this.stack.map(
      loc => `  ${loc.uri}:${loc.range.start.line}:${loc.range.start.column}\n`);
    return `${this.message}\n${locs.join('')}`;
  }
}

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
type MethodMap = { [name: string]: YALMethod; };

export class YALClass {
  readonly name: string;
  readonly methodMap: MethodMap;
  constructor(name: string, methodMap: MethodMap | null = null) {
    this.name = name;
    this.methodMap = methodMap || Object.create(null);
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
}

export function callMethod(recv: Value, methodName: string, args: Value[]): Value {
  const cls = getClass(recv);
  const method = cls.methodMap[methodName];
  if (!method) {
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
