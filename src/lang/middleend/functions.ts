
/** Just needs to be defined somewhere in such a way as not to produce
 * inadvertent circular dependencies
 */

export const printFunction = (function print(x: any) { console.log(strFunction(x)); return null; });

export const reprFunction = (function repr(x: any): String {
  switch (typeof x) {
    case 'undefined': return 'undefined';
    case 'function':
      return x.name ? x.name.startsWith('YAL') ? `<function ${x.name.substring(3)}>` :
        `<function ${x.name}>` : '<function>';
    case 'object':
      if (x === null) return 'null';
      if (Array.isArray(x)) return '[' + x.map(i => reprFunction(i)).join(', ') + ']';
      if (x.YAL__repr__) return x.YAL__repr__();
      break;
  }
  return JSON.stringify(x);
});

export const strFunction = (function str(x: any): String {
  return typeof x === 'string' ? x : reprFunction(x);
});
