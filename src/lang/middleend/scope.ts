import { Variable } from "./annotation";
import { AnyType, BoolType, NeverType, NilType, NumberType, StringType, newLambdaType } from "./type";

export type Scope = { [key: string]: Variable; };

export const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyType };
BASE_SCOPE['Never'] =
  { identifier: NeverType.identifier, type: NeverType };
BASE_SCOPE['Nil'] =
  { identifier: NilType.identifier, type: AnyType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: AnyType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: AnyType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: AnyType };

// Dummy 'print' function
export const printFunction = (function print(x: any) { console.log('' + x); return null; }) as any;
BASE_SCOPE['print'] = {
  identifier: { name: 'print' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: printFunction,
};
