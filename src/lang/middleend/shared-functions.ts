

// Definitions for functions that are shared between the backend and middle end evaluator.


export const REPR_FUNCTION_DEFINITION = `function YALrepr(x) {
  switch (typeof x) {
    case 'undefined': return 'undefined';
    case 'function':
      return x.name ? x.name.startsWith('YAL') ? '<function ' + x.name.substring(3) + '>' :
        '<function ' + x.name + '>' : '<function>';
    case 'object':
      if (x === null) return 'null';
      if (Array.isArray(x)) return '[' + x.map(i => YALrepr(i)).join(', ') + ']';
      if (x.YAL__repr__) return x.YAL__repr__();
      break;
  }
  return JSON.stringify(x);
}`;

export const STR_FUNCTION_DEFINITION = `function YALstr(x) {
  return typeof x === 'string' ? x : YALrepr(x);
}`;

export const PRINT_FUNCTION_DEFINITION = `function YALprint(x) {
  console.log(YALstr(x));
  return null;
}`;
