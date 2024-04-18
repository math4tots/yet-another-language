import { Variable } from "./annotation";
import { printFunction, reprFunction, strFunction } from "./functions";
import { AnyType, BoolType, NeverType, NullType, NumberType, StringType, newLambdaType } from "./type";

export type Scope = { [key: string]: Variable; };

export const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyType };
BASE_SCOPE['Never'] =
  { identifier: NeverType.identifier, type: NeverType };
BASE_SCOPE['Null'] =
  { identifier: NullType.identifier, type: AnyType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: AnyType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: AnyType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: AnyType };

BASE_SCOPE['print'] = {
  identifier: { name: 'print' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: printFunction,
};

BASE_SCOPE['repr'] = {
  identifier: { name: 'repr' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: reprFunction,
};

BASE_SCOPE['str'] = {
  identifier: { name: 'str' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: strFunction,
};
