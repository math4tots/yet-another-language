
export function translateVariableName(name: string): string {
  if (name === 'this') return 'this';
  if (name.startsWith('__js_')) return name.substring(5);
  return 'YAL' + name;
}
