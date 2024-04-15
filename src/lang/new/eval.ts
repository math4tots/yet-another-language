import {
  NIL,
  FALSE,
  TRUE,
  NilValue,
  BoolValue,
  NumberValue,
  StringValue,
  ListValue,
  FunctionValue,
  ClassValue,
  YALError,
} from "./value";

const SCOPE = [
  ['NIL', NIL],
  ['TRUE', TRUE],
  ['FALSE', FALSE],
  ['I0', NumberValue.of(0)],
  ['I1', NumberValue.of(1)],
  ['I2', NumberValue.of(2)],
  ['I3', NumberValue.of(3)],
  ['I4', NumberValue.of(4)],
  ['I5', NumberValue.of(5)],
  ['I6', NumberValue.of(6)],
  ['I7', NumberValue.of(7)],
  ['I8', NumberValue.of(8)],
  ['I9', NumberValue.of(9)],
  ['I10', NumberValue.of(10)],
  ['I_1', NumberValue.of(-1)],
  ['I_2', NumberValue.of(-2)],
  ['I_3', NumberValue.of(-3)],
  ['I_4', NumberValue.of(-4)],
  ['I_5', NumberValue.of(-5)],
  ['I_6', NumberValue.of(-6)],
  ['I_7', NumberValue.of(-7)],
  ['I_8', NumberValue.of(-8)],
  ['I_9', NumberValue.of(-9)],
  ['I_10', NumberValue.of(-10)],
  ['NilValue', NilValue],
  ['BoolValue', BoolValue],
  ['NumberValue', NumberValue],
  ['StringValue', StringValue],
  ['ListValue', ListValue],
  ['FunctionValue', FunctionValue],
  ['ClassValue', ClassValue],
  ['YALError', YALError],
] as const;

const SCOPE_KEYS = SCOPE.map(p => p[0]);
const SCOPE_VALUES = SCOPE.map(p => p[1]);

/**
 * A helper function that allows creating new functions like with the Function constructor,
 * but with some helper values added to the scope
 * 
 * @param {string} name name of the created function
 */
export function newClosure(name: string, params: string[], body: string): Function {
  return Function(
    ...SCOPE_KEYS,
    `"use strict"; return function ${name}(${params.join(',')}){${body}}`)(
      ...SCOPE_VALUES);
}
