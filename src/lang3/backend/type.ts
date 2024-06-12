import { Typedef } from "../frontend/ast";


export type BasicType =
  'any' | 'void' | 'never' |
  'null' | 'bool' | 'number' | 'string';

export type NonNullableType =
  'never' | 'bool' | 'number' | 'string' |
  ['list', Type] |
  ['table', [string, Type][]] |
  ['function', Type[], Type];

export type Type =
  'any' | 'void' | 'never' |
  'null' | 'bool' | 'number' | 'string' |
  ['list', Type] |
  ['nullable', Type] |
  ['table', [string, Type][]] |
  ['function', Type[], Type] |
  ['typedef', Typedef, Type | undefined];


/**
 * Tests whether the two types may be considered "equal".
 * NOTE: even if the types are 'equivalent' (i.e. through typedefs), they may compare unequal.
 * Typedefs are considered opaque
 */
export function typeeq(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (typeof a === 'string' || typeof b === 'string') return false;
  const ka = a[0];
  const kb = b[0];
  switch (ka) {
    case 'list': return kb === ka && typeeq(a[1], b[1]);
    case 'nullable': return kb === ka && typeeq(a[1], b[1]);
    case 'table': return kb === ka && a[1].length === b[1].length && a[1].every((pa, i) => {
      const pb = b[1][i];
      return pa[0] === pb[0] && typeeq(pa[1], pb[1]);
    });
    case 'function': return kb === ka && a[1].length === b[1].length && a[1].every((pa, i) => typeeq(pa, b[1][i]));
    case 'typedef': return kb === ka && a[1] === b[1];
  }
  return false;
}

/**
 * Tests whether a value of type `src` can be assigned to a variable of type `dst`.
 */
export function assignable(src: Type, dst: Type): boolean | undefined {
  if (src === dst) return true;
  if (dst === 'any' || dst === 'void' || src === 'never') return true;
  if (dst === 'never' || src === 'any' || src === 'void') return false;
  if (typeof dst !== 'string' && dst[0] === 'typedef' && dst[2] !== undefined) return assignable(src, dst[2]);
  if (typeof src !== 'string' && src[0] === 'typedef' && src[2] !== undefined) return assignable(src[2], dst);
  if (typeof dst !== 'string' && dst[0] === 'nullable') {
    if (src === 'null') return true;
    if (typeof src !== 'string' && src[0] === 'nullable') return assignable(src[1], dst[1]);
    return false;
  }
  return undefined;
}
