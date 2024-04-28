import { Variable } from "./annotation";
import { printFunction, reprFunction, strFunction } from "./functions";
import {
  AnyType,
  AnyTypeType,
  BoolType,
  BoolTypeType,
  NeverType,
  NeverTypeType,
  NullType,
  NullTypeType,
  NumberType,
  NumberTypeType,
  StringType,
  StringTypeType,
  newLambdaType,
} from "./type";

export type Scope = { [key: string]: Variable; };

export const BASE_SCOPE: Scope = Object.create(null);
BASE_SCOPE['Any'] =
  { identifier: AnyType.identifier, type: AnyTypeType };
BASE_SCOPE['Never'] =
  { identifier: NeverType.identifier, type: NeverTypeType };
BASE_SCOPE['Null'] =
  { identifier: NullType.identifier, type: NullTypeType };
BASE_SCOPE['Bool'] =
  { identifier: BoolType.identifier, type: BoolTypeType };
BASE_SCOPE['Number'] =
  { identifier: NumberType.identifier, type: NumberTypeType };
BASE_SCOPE['String'] =
  { identifier: StringType.identifier, type: StringTypeType };

BASE_SCOPE['print'] = {
  identifier: { name: 'print' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], AnyType),
  value: printFunction,
};

BASE_SCOPE['repr'] = {
  identifier: { name: 'repr' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], StringType),
  value: reprFunction,
};

BASE_SCOPE['str'] = {
  identifier: { name: 'str' },
  type: newLambdaType([{ identifier: { name: 'value' }, type: AnyType }], StringType),
  value: strFunction,
};
