

// Definitions for functions that are shared between the backend and middle end evaluator.


export const RAISE_FUNCTION_DEFINITION = `function raise(x) { throw new Error(x) }`;

export const NULL_GET_FUNCTION_DEFINITION = `function nullGet(x) { return x ?? raise('nullish value error'); }`;

export const NULL_MAP_FUNCTION_DEFINITION = `function nullMap(x, f) { return ((x ?? null) === null) ? x : f(x); }`;

export const REPR_FUNCTION_DEFINITION = `function YALrepr(x) {
  switch (typeof x) {
    case 'undefined': return 'undefined';
    case 'function':
      return x.name ? x.name.startsWith('YAL') ? '<function ' + x.name.substring(3) + '>' :
        '<function ' + x.name + '>' : '<function>';
    case 'object':
      if (x === null) return 'null';
      if (Array.isArray(x)||ArrayBuffer.isView(x)) return '[' + x.map(i => YALrepr(i)).join(', ') + ']';
      if (x.YAL__repr__) return x.YAL__repr__();
      if (x.toString && x.toString !== Object.prototype.toString) return x.toString();
      break;
  }
  return JSON.stringify(x);
}`;

export const STR_FUNCTION_DEFINITION = `function YALstr(x) {
  return typeof x === 'string' ? x : 
         (typeof x === 'object' && x && x.YAL__str__) ? x.YAL__str__() :
         YALrepr(x);
}`;

export const PRINT_FUNCTION_DEFINITION = `function YALprint(x) {
  console.log(YALstr(x));
  return null;
}`;
