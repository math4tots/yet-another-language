import { ModuleValue } from "./annotator-defs";

export function reprStaticValue(x: any): string {
  if (typeof x === 'function') return x.name ? `<function ${x.name}>` : '<function>';
  if (x instanceof ModuleValue) return '<module>';
  return JSON.stringify(x);
}

export function strStaticValue(x: any): string {
  return typeof x === 'string' ? x : reprStaticValue(x);
}
