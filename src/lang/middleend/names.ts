/**
 * Logic for how variable, field and method names are translated from YAL to JS.
 * 
 * This functionality arguably belongs in the backend, but is needed to properly handle
 * values in the middle-end, and for properly resolving "methods" on modules as fields
 * rather than as true methods when calling them.
 */

export function translateVariableName(name: string): string {
  if (name === 'this') return 'this';
  if (name.startsWith('__js_')) return name.substring('__js_'.length);
  return 'YAL' + name;
}

export function translateMethodName(name: string, argc: number): string {
  if (name.startsWith('__js_')) return name.substring('__js_'.length);

  // There's no need for a separator character between argc and name
  // because argc is an integer and name cannot start with a digit.
  return `YAL${argc}${name}`;
}

export function translateFieldName(name: string): string {
  if (name.startsWith('__js_')) return name.substring('__js_'.length);
  return `YAL${name}`;
}
