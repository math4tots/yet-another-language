
export interface Value {
  // returns true if nil, otherwise returns false
  isNil(): boolean;

  // Test if this value is truthy (all values are truthy except nil and false)
  test(): boolean;

  // Returns true if this and rhs are considered equal
  equals(rhs: Value): boolean;

  toString(): string;
  toRepr(): string;
}

export class YALError extends Error { }

export class NilValue implements Value {
  static cast(value: Value): NilValue {
    if (value instanceof NilValue) return value;
    throw new YALError(`Expected NilValue but got ${value.constructor.name}`);
  }

  static readonly INSTANCE = new NilValue();

  private constructor() { }
  isNil(): boolean { return true; }
  test(): boolean { return false; }
  equals(rhs: Value): boolean { return this === rhs || rhs instanceof NilValue; }
  toString(): string { return 'nil'; }
  toRepr(): string { return 'nil'; }
}

export class BoolValue implements Value {
  static cast(value: Value): BoolValue {
    if (value instanceof BoolValue) return value;
    throw new YALError(`Expected BoolValue but got ${value.constructor.name}`);
  }

  static readonly TRUE = new BoolValue(true);
  static readonly FALSE = new BoolValue(false);

  static of(value: boolean): BoolValue { return value ? BoolValue.TRUE : BoolValue.FALSE; }

  readonly value: boolean;
  private constructor(value: boolean) { this.value = value; }
  isNil(): boolean { return false; }
  test(): boolean { return this.value; }
  equals(rhs: Value): boolean { return this === rhs || (rhs instanceof BoolValue && rhs.value === this.value); }
  toString(): string { return this.value ? 'true' : 'false'; }
  toRepr(): string { return this.value ? 'true' : 'false'; }
  valueOf() { return this.value; }
}

export class NumberValue implements Value {
  static cast(value: Value): NumberValue {
    if (value instanceof NumberValue) return value;
    throw new YALError(`Expected NumberValue but got ${value.constructor.name}`);
  }

  private static cachedNonNegativeIntegers = Array(100).fill(0).map((_, i) => new NumberValue(i));
  private static cachedNegativeIntegers = Array(100).fill(0).map((_, i) => new NumberValue(-i - 1));

  static of(value: number): NumberValue {
    if (Number.isInteger(value)) {
      if (value >= 0 && value < NumberValue.cachedNonNegativeIntegers.length) {
        return NumberValue.cachedNonNegativeIntegers[value];
      } else if (value < 0 && value >= -NumberValue.cachedNegativeIntegers.length) {
        return NumberValue.cachedNegativeIntegers[-value - 1];
      }
    }
    return new NumberValue(value);
  }

  readonly value: number;
  private constructor(value: number) { this.value = value; }
  isNil(): boolean { return false; }
  test(): boolean { return true; }
  equals(rhs: Value): boolean { return this === rhs || (rhs instanceof NumberValue && rhs.value === this.value); }
  toString(): string { return '' + this.value; }
  toRepr(): string { return '' + this.value; }
  valueOf() { return this.value; }

  YAL__add__(rhs: Value): NumberValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return NumberValue.of(this.value + rhs.value);
  }

  YAL__sub__(rhs: Value): NumberValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return NumberValue.of(this.value - rhs.value);
  }

  YAL__mul__(rhs: Value): NumberValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return NumberValue.of(this.value * rhs.value);
  }

  YAL__div__(rhs: Value): NumberValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return NumberValue.of(this.value / rhs.value);
  }

  YAL__mod__(rhs: Value): NumberValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return NumberValue.of(this.value % rhs.value);
  }

  YAL__lt__(rhs: Value): BoolValue {
    if (!(rhs instanceof NumberValue)) throw new YALError(`Expected NumberValue but got ${rhs.constructor.name}`);
    return BoolValue.of(this.value < rhs.value);
  }
}

export class StringValue implements Value {
  static cast(value: Value): StringValue {
    if (value instanceof StringValue) return value;
    throw new YALError(`Expected StringValue but got ${value.constructor.name}`);
  }

  static of(value: string): StringValue { return new StringValue(value); }

  readonly value: string;
  private constructor(value: string) { this.value = value; }
  isNil(): boolean { return false; }
  test(): boolean { return true; }
  equals(rhs: Value): boolean { return this === rhs || (rhs instanceof StringValue && rhs.value === this.value); }
  toString(): string { return this.value; }
  toRepr(): string { return JSON.stringify(this.value); }
  valueOf() { return this.value; }

  YALget_size(): NumberValue { return NumberValue.of(this.value.length); }

  YAL__add__(rhs: Value): StringValue {
    if (!(rhs instanceof StringValue)) throw new YALError(`Expected StringValue but got ${rhs.constructor.name}`);
    return new StringValue(this.value + rhs.value);
  }
}

export class ListValue implements Value {
  static cast(value: Value): ListValue {
    if (value instanceof ListValue) return value;
    throw new YALError(`Expected ListValue but got ${value.constructor.name}`);
  }

  static of(values: Value[]) { return new ListValue([...values]); }
  static using(values: Value[]) { return new ListValue(values); }

  readonly value: Value[];
  private constructor(value: Value[]) { this.value = value; }
  isNil(): boolean { return false; }
  test(): boolean { return true; }
  equals(rhs: Value): boolean {
    return this === rhs ||
      (rhs instanceof ListValue &&
        this.value.length === rhs.value.length &&
        this.value.every((v, i) => v.equals(rhs.value[i])));
  }
  toString(): string { return this.toRepr(); }
  toRepr(): string { return `[${this.value.map(v => v.toRepr()).join(', ')}]`; }

  YALget_size(): NumberValue { return NumberValue.of(this.value.length); }

  YAL__add__(rhs: Value): ListValue {
    if (!(rhs instanceof ListValue)) throw new YALError(`Expected ListValue but got ${rhs.constructor.name}`);
    return new ListValue([...this.value, ...rhs.value]);
  }

  YALflatten(): ListValue {
    const values: Value[] = [];
    for (const value of this.value) {
      if (value instanceof ListValue) values.push(...value.value);
      else values.push(value);
    }
    return new ListValue(values);
  }
}

export class FunctionValue implements Value {
  static cast(value: Value): FunctionValue {
    if (value instanceof FunctionValue) return value;
    throw new YALError(`Expected FunctionValue but got ${value.constructor.name}`);
  }

  readonly value: (...args: Value[]) => Value;
  constructor(value: (...args: Value[]) => Value) { this.value = value; }
  isNil(): boolean { return false; }
  test(): boolean { return true; }
  equals(rhs: Value): boolean { return this === rhs; }
  toString(): string { return this.toRepr(); }
  toRepr(): string { return `<function ${this.value.name}>`; }

  YAL__call__(...values: Value[]): Value { return this.value(...values); }
}

export class ClassValue implements Value {
  readonly name: string;
  readonly proto: Value = Object.create(INSTANCE_BASE_PROTOTYPE);
  readonly fields: string[] = [];
  constructor(name: string) {
    this.name = name;
    Object.defineProperty(this.proto, 'yalClass', {
      value: this,
      writable: false,
      enumerable: false,
    });
  }
  isNil(): boolean { return false; }
  test(): boolean { return true; }
  equals(rhs: Value): boolean { return this === rhs; }
  toString(): string { return this.toRepr(); }
  toRepr(): string { return `<class ${this.name}>`; }
  newInstance(...args: Value[]): InstanceValue {
    if (args.length !== this.fields.length) {
      throw new YALError(`new ${this.name} requires ${this.fields.length} args but got ${args.length}`);
    }
    const instance: InstanceValue = Object.create(this.proto);
    for (let i = 0; i < args.length; i++) {
      instance[`FIELD${this.fields[i]}`] = args[i];
    }
    return instance;
  }
  addField(field: string, isMutable: boolean) {
    this.fields.push(field);
    Object.defineProperty(this.proto, `YALget_${field}`, {
      value: Function(`"use strict"; return this.FIELD${field}`),
      writable: false,
      enumerable: false,
    });
    if (isMutable) {
      Object.defineProperty(this.proto, `YALset_${field}`, {
        value: Function("value", `"use strict"; return this.FIELD${field} = value`),
        writable: false,
        enumerable: false,
      });
    }
  }
}

export type InstanceValue = Value & {
  readonly yalClass: ClassValue;
  [key: string]: any;
};

const INSTANCE_BASE_PROTOTYPE: InstanceValue = Object.assign(Object.create(null), {
  isNil(): boolean { return false; },
  test(): boolean { return true; },
  equals(rhs: Value): boolean { return (rhs as any).yalClass === (this as any).yalClass; },
  toString(): string { return this.toRepr(); },
  toRepr(): string { return `<${(this as any).yalClass.name} instance>`; },
});
Object.defineProperties(INSTANCE_BASE_PROTOTYPE, {
  isNil: { enumerable: false },
  test: { enumerable: false },
  equals: { enumerable: false },
  toString: { enumerable: false },
  toRepr: { enumerable: false },
});

export const NIL = NilValue.INSTANCE;
export const TRUE = BoolValue.TRUE;
export const FALSE = BoolValue.FALSE;
