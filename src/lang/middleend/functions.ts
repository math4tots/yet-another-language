
/**
 * Just needs to be defined somewhere in such a way as to create
 * unique identities for each function and not to introduce
 * inadvertent circular dependencies
 */

import {
  REPR_FUNCTION_DEFINITION,
  STR_FUNCTION_DEFINITION,
  PRINT_FUNCTION_DEFINITION,
  NULL_GET_FUNCTION_DEFINITION,
  NULL_MAP_FUNCTION_DEFINITION,
} from "./shared-functions";


export const nullGetFunction = Function(`const nullGet = ${NULL_GET_FUNCTION_DEFINITION}; return nullGet`)();
export const nullMapFunction = Function(`const nullMap = ${NULL_MAP_FUNCTION_DEFINITION}; return nullMap`)();
export const reprFunction = Function(`const YALrepr = ${REPR_FUNCTION_DEFINITION}; return YALrepr`)();
export const strFunction = Function('YALrepr', `return ${STR_FUNCTION_DEFINITION}`)(reprFunction);
export const printFunction = Function('YALstr', `return ${PRINT_FUNCTION_DEFINITION}`)(strFunction);
