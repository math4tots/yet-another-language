

export type Value =
  null | boolean | number | string |
  Value[] | { [key: string]: Value; } |
  ((args: Value[]) => Value);
