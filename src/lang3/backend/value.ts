import type { State } from "./state";


export type Value =
  null | boolean | number | string |
  Value[] | { [key: string]: Value; } |
  ((state: State, args: Value[]) => Value);
