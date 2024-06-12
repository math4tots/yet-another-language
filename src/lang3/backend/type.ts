import { Typedef } from "../frontend/ast";


export type DirectNonNullableType =
  'never' |
  'bool' | 'float' | 'string' |
  ['list', Type] |
  ['table', [string, Type][]] |
  ['function', Type[], Type];

export type IndirectNonNullableType =
  ['typedef', Typedef, DirectNonNullableType | undefined];

export type NonNullableType = DirectNonNullableType | IndirectNonNullableType;

export type NullableType =
  'any' | 'void' | 'null' |
  ['nullable', NonNullableType];

export type Type = NonNullableType | NullableType;

export function isNullableType(type: Type): type is NullableType {
  switch (type) {
    case 'any':
    case 'void':
    case 'null':
      return true;
  }
  return typeof type !== 'string' && type[0] === 'nullable';
}

export function isNonNullableType(type: Type): type is NonNullableType {
  return !isNullableType(type);
}

export function isIndirectNonNullableType(type: Type): type is IndirectNonNullableType {
  return typeof type !== 'string' && type[0] === 'typedef';
}

export function isDirectNonNullableType(type: Type): type is DirectNonNullableType {
  return isNonNullableType(type) && !isIndirectNonNullableType(type);
}

export function nullableTypeOf(type: Type): Type {
  if (isNullableType(type)) return type;
  return ['nullable', type];
}

/**
 * Tests whether the two types may be considered "equal".
 * NOTE: even if the types are 'equivalent' (i.e. through typedefs), they may compare unequal.
 * Typedefs are considered opaque
 */
export function typesAreEqual(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (typeof a === 'string' || typeof b === 'string') return false;
  const ka = a[0];
  const kb = b[0];
  switch (ka) {
    case 'list': return kb === ka && typesAreEqual(a[1], b[1]);
    case 'nullable': return kb === ka && typesAreEqual(a[1], b[1]);
    case 'table': return kb === ka && a[1].length === b[1].length && a[1].every((pa, i) => {
      const pb = b[1][i];
      return pa[0] === pb[0] && typesAreEqual(pa[1], pb[1]);
    });
    case 'function': return kb === ka && a[1].length === b[1].length &&
      a[1].every((pa, i) => typesAreEqual(pa, b[1][i]));
    case 'typedef': return kb === ka && a[1] === b[1];
  }
  return false;
}

/**
 * Tests whether a value of type `src` can be assigned to a variable of type `dst`.
 * Returns 'undefined' if assignability could not be determined
 */
export function isAssignable(src: Type, dst: Type): boolean | undefined {
  if (src === dst) return true;
  if (dst === 'any' || dst === 'void' || src === 'never') return true;
  if (dst === 'never' || src === 'any' || src === 'void') return false;
  if (src === 'null') return isNullableType(dst);
  if (isIndirectNonNullableType(dst)) {
    return dst[2] === undefined ? undefined : isAssignable(src, dst[2]);
  }
  if (isIndirectNonNullableType(src)) {
    return src[2] === undefined ? undefined : isAssignable(src[2], dst);
  }
  if (dst === 'null') return false; // at this point, there is no way src can fit into just 'null'
  if (isNullableType(src)) return isNullableType(dst) ? isAssignable(src[1], dst[1]) : false;
  if (isNullableType(dst)) return isAssignable(src, dst[1]);

  // at this point, all types are 'direct', so the form must match
  if (typeof src === 'string' || typeof dst === 'string') return src === dst;
  if (src[0] === 'list' || dst[0] === 'list') {
    return src[0] === 'list' && dst[0] === 'list' && typesAreEqual(src[1], dst[1]);
  }
  src;
  dst;
  return undefined;
}
