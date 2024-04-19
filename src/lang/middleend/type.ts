import { Identifier } from "../frontend/ast";
import * as ast from "../frontend/ast";
import type { Annotation, EnumConstVariable, Variable } from "./annotation";

type TypeConstructorParameters = {
  readonly identifier: Identifier;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly classTypeTypeData?: ClassTypeTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly interfaceTypeTypeData?: InterfaceTypeTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly enumTypeTypeData?: EnumTypeTypeData;
};

type NullableTypeData = {
  readonly itemType: Type;
};

type ListTypeData = {
  readonly itemType: Type;
};

type FunctionTypeData = {
  readonly parameterTypes: Type[];
  readonly returnType: Type;
};

type LambdaTypeData = {
  readonly parameters: Parameter[];
  readonly functionType: FunctionType;
  readonly returnType: Type;
};

type ModuleTypeData = {
  readonly annotation: Annotation;
};

type ClassTypeData = {
  readonly superClassType?: ClassType;
  readonly fields: Field[];
};

type ClassTypeTypeData = {
  readonly classType: ClassType;
};

type InterfaceTypeData = {
  readonly superTypes: InterfaceType[];
  readonly cache: WeakMap<Type, boolean>;
};

type InterfaceTypeTypeData = {
  readonly interfaceType: InterfaceType;
};

type EnumTypeData = {
  readonly values: Map<string, EnumConstVariable>;
};

type EnumTypeTypeData = {
  readonly enumType: EnumType;
};

export type NullableType = Type & { readonly nullableTypeData: NullableTypeData; };
export type ListType = Type & { readonly listTypeData: ListTypeData; };
export type LambdaType = Type & { readonly lambdaTypeData: LambdaTypeData; };
export type FunctionType = Type & { readonly functionTypeData: FunctionTypeData; };
export type ModuleType = Type & { readonly moduleTypeData: ModuleTypeData; };
export type ClassType = Type & { readonly classTypeData: ClassTypeData; };
export type ClassTypeType = Type & { readonly classTypeTypeData: ClassTypeTypeData; };
export type InterfaceType = Type & { readonly interfaceTypeData: InterfaceTypeData; };
export type InterfaceTypeType = Type & { readonly interfaceTypeTypeData: InterfaceTypeTypeData; };
export type EnumType = Type & { readonly enumTypeData: EnumTypeData; };
export type EnumTypeType = Type & { readonly enumTypeTypeData: EnumTypeTypeData; };

export class Type {
  readonly identifier: Identifier;
  private _list?: ListType;
  private _nullable?: NullableType;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly classTypeTypeData?: ClassTypeTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly interfaceTypeTypeData?: InterfaceTypeTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly enumTypeTypeData?: EnumTypeTypeData;
  private readonly _methods: Method[] = [];
  private readonly _methodMap = new Map<string, Method>();

  constructor(parameters: TypeConstructorParameters) {
    const params = parameters;
    this.identifier = params.identifier;
    if (params.nullableTypeData) {
      this.nullableTypeData = params.nullableTypeData;
    }
    if (params.listTypeData) {
      this.listTypeData = params.listTypeData;
    }
    if (params.functionTypeData) {
      this.functionTypeData = params.functionTypeData;
    }
    if (params.lambdaTypeData) {
      this.lambdaTypeData = params.lambdaTypeData;
    }
    if (params.moduleTypeData) {
      this.moduleTypeData = params.moduleTypeData;
    }
    if (params.classTypeData) {
      this.classTypeData = params.classTypeData;
    }
    if (params.classTypeTypeData) {
      this.classTypeTypeData = params.classTypeTypeData;
    }
    if (params.interfaceTypeData) {
      this.interfaceTypeData = params.interfaceTypeData;
    }
    if (params.interfaceTypeTypeData) {
      this.interfaceTypeTypeData = params.interfaceTypeTypeData;
    }
    if (params.enumTypeData) {
      this.enumTypeData = params.enumTypeData;
    }
    if (params.enumTypeTypeData) {
      this.enumTypeTypeData = params.enumTypeTypeData;
    }
  }

  private lambdaErasure(): Type {
    return this.lambdaTypeData?.functionType || this;
  }

  isAssignableTo(givenTarget: Type): boolean {
    const source = this.lambdaErasure();
    const target = givenTarget.lambdaErasure();
    if (source === target || target === AnyType || source === NeverType) return true;
    if (target.nullableTypeData) {
      const targetCore = target.nullableTypeData.itemType;
      if (source === NullType) return true;
      if (source.nullableTypeData) return source.nullableTypeData.itemType.isAssignableTo(targetCore);
      return source.isAssignableTo(targetCore);
    }
    if (target.interfaceTypeData) {
      // if the target is an interface, we need to check if source implements all the methods
      // required by the interface
      const cached = target.interfaceTypeData.cache.get(source);
      if (typeof cached === 'boolean') return cached;

      // To prevent infinite recursion, optimistically assume
      // it *is* assignable while we try to test
      // TODO: consider the consequences
      target.interfaceTypeData.cache.set(source, true);

      for (const method of target.getAllMethods()) {
        if (!source.implementsMethod(method)) {
          target.interfaceTypeData.cache.set(source, false);
          return false;
        }
      }
      return true;
    }
    return source.classTypeData?.superClassType?.isAssignableTo(target) || false;
  }

  getCommonType(givenRhs: Type): Type {
    const lhs = this.lambdaErasure();
    const rhs = givenRhs.lambdaErasure();

    if (lhs === NullType) return rhs.nullable();
    if (rhs === NullType) return lhs.nullable();

    // if either type is nullable, get the common type without null first, then
    // re-apply nullable to it
    if (lhs.nullableTypeData || rhs.nullableTypeData) {
      return (lhs.nullableTypeData?.itemType || lhs).getCommonType(
        rhs.nullableTypeData?.itemType || rhs).nullable();
    }

    return lhs.isAssignableTo(rhs) ? rhs :
      rhs.isAssignableTo(lhs) ? lhs : AnyType;
  }

  toString(): string { return this.identifier.name; }

  list(): ListType {
    const cached = this._list;
    if (cached) return cached;
    const listType = new Type({
      identifier: { name: `List[${this.identifier.name}]` },
      listTypeData: { itemType: this },
    }) as ListType;
    addListMethods(listType);
    this._list = listType;
    return listType;
  }

  nullable(): Type {
    if (this === NullType || this === AnyType || this.nullableTypeData) return this;
    if (this === NeverType) return NullType;
    const cached = this._nullable;
    if (cached) return cached;
    const nullableType = new Type({
      identifier: { name: `Nullable[${this.identifier.name}]` },
      nullableTypeData: { itemType: this },
    }) as NullableType;
    addNullableMethods(nullableType);
    this._nullable = nullableType;
    return nullableType;
  }

  getMethod(key: string): Method | null { return this._methodMap.get(key) || null; }

  /** Returns all methods of this type, including those inherited from super class or interfaces */
  getAllMethods(): Method[] { return [...this._methods]; }

  addMethod(params: NewMethodParameters) {
    const method = newMethod(params);
    this._methods.push(method);
    this._methodMap.set(method.identifier.name, method);
  }

  implementsMethod(targetMethod: Method): boolean {
    const method = this.getMethod(targetMethod.identifier.name);
    if (!method) return false;

    // If there is any sort of method aliasing going on, the methods must match exactly.
    // Otherwise, there could be strange errors at runtime.
    if (method.aliasFor !== targetMethod.aliasFor) return false;

    if (method.parameters.length !== targetMethod.parameters.length) return false;
    for (let i = 0; i < method.parameters.length; i++) {
      if (!targetMethod.parameters[i].type.isAssignableTo(method.parameters[i].type)) return false;
    }
    return method.returnType.isAssignableTo(targetMethod.returnType);
  }
}

export type Field = {
  readonly isMutable?: boolean;
  readonly identifier: Identifier;
  readonly type: Type;
};

export type Parameter = {
  readonly isMutable?: boolean;
  readonly identifier: Identifier;
  readonly type: Type;
  readonly defaultValue?: ast.Literal;
};

export type Method = {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;

  /**
   * Type of this method, if this method were a function.
   * This can be reconstructed from `parameters` and `returnType`,
   * but is provided here so that it doesn't always have to be reconstructed
   */
  readonly functionType: FunctionType;

  /**
   * The "source" variable associated with this method.
   * 
   * This is the Variable that this method "comes from".
   * 
   * In some cases, a single "Variable" can be associated with multiple
   * methods (e.g. with __set_* and __get_* style Methods).
   */
  readonly sourceVariable: Variable;

  /**
   * If present, this field has a method name that this method is an 'alias' for.
   * 
   * When this method is invoked, the annotator will replace the method name with
   * the value provided here.
   */
  readonly aliasFor?: string;

  /**
   * If true, indicates that this is a 'control-flow' method.
   * 
   * That is to say, not actually a method, but more like control flow.
   * 
   * This means that some of the arguments to this method may not be
   * evaluated based on the result of earlier arguments.
   */
  readonly isControlFlow: boolean;
};

export const AnyType = new Type({ identifier: { name: 'Any' } });
export const NeverType = new Type({ identifier: { name: 'Never' } });

export const NullType = new Type({ identifier: { name: 'Null' } });
export const BoolType = new Type({ identifier: { name: 'Bool' } });
export const NumberType = new Type({ identifier: { name: 'Number' } });
export const StringType = new Type({ identifier: { name: 'String' } });

type Cache = {
  type?: FunctionType,
  readonly map: WeakMap<Type, Cache>,
};

const cache: Cache = { map: new WeakMap() };

export function newFunctionType(parameterTypes: Type[], returnType: Type): FunctionType {
  const types = [...parameterTypes, returnType];
  let c = cache;
  for (const type of types) {
    const foundChild = c.map.get(type);
    if (foundChild) {
      c = foundChild;
    } else {
      const newChild: Cache = { map: new WeakMap() };
      c.map.set(type, newChild);
      c = newChild;
    }
  }
  const cached = c.type;
  if (cached) return cached;
  const name = `Function[${types.map(t => t.toString()).join(',')}]`;
  const functionTypeData: FunctionTypeData = { parameterTypes: [...parameterTypes], returnType };
  const functionType = new Type({ identifier: { name }, functionTypeData }) as FunctionType;
  functionType.addMethod({
    identifier: { name: '__call__' },
    parameters: parameterTypes.map((ptype, i) => ({ identifier: { name: `arg${i}` }, type: ptype })),
    returnType,
    functionType,
  });
  c.type = functionType;
  return functionType;
}

export function newLambdaType(parameters: Parameter[], returnType: Type): LambdaType {
  const functionType = newFunctionType(parameters.map(p => p.type), returnType);
  const lambdaType = new Type({
    identifier: functionType.identifier,
    lambdaTypeData: {
      functionType,
      parameters: [...parameters],
      returnType,
    },
  });
  lambdaType.addMethod({
    identifier: { name: '__call__' },
    parameters: [...parameters],
    returnType: returnType,
    functionType,
  });
  return lambdaType as LambdaType;
}

const moduleTypeCache = new WeakMap<Annotation, ModuleType>();

export function newModuleType(annotation: Annotation): ModuleType {
  const cached = moduleTypeCache.get(annotation);
  if (cached) return cached;
  const identifier: Identifier = {
    name: '(module)',
    location: {
      uri: annotation.uri, range: {
        start: { line: 0, column: 0, index: 0 },
        end: { line: 0, column: 0, index: 0 }
      },
    },
  };
  const moduleType = new Type({ identifier, moduleTypeData: { annotation } }) as ModuleType;
  for (const variable of annotation.exportMap.values()) {
    moduleType.addMethod({
      identifier: { name: `__get_${variable.identifier.name}` },
      parameters: [],
      returnType: variable.type,
      sourceVariable: variable,
    });
    if (variable.isMutable) {
      moduleType.addMethod({
        identifier: { name: `__set_${variable.identifier.name}` },
        parameters: [{ identifier: variable.identifier, type: variable.type }],
        returnType: NullType,
        sourceVariable: variable,
      });
    } else {
      const lambdaTypeData = variable.type.lambdaTypeData;
      if (lambdaTypeData) {
        const { parameters, returnType } = lambdaTypeData;
        moduleType.addMethod({
          identifier: variable.identifier,
          parameters: [...parameters],
          returnType,
          functionType: lambdaTypeData.functionType,
          sourceVariable: variable,
        });
      }
    }
  }
  return moduleType;
}

interface NewMethodParameters {
  readonly identifier: Identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;

  /**
   * Type of this method, if this method were a function.
   * This can be reconstructed from `parameters` and `returnType`,
   * but is provided here so that it doesn't always have to be reconstructed
   */
  readonly functionType?: FunctionType;

  /**
   * The "source" variable associated with this method.
   * 
   * This is the Variable that this method "comes from".
   * 
   * In some cases, a single "Variable" can be associated with multiple
   * methods (e.g. with __set_* and __get_* style Methods).
   */
  readonly sourceVariable?: Variable;

  /**
   * If present, this field has a method name that this method is an 'alias' for.
   * 
   * When this method is invoked, the annotator will replace the method name with
   * the value provided here.
   */
  readonly aliasFor?: string;

  /**
   * If true, indicates that this is a 'control-flow' method.
   * 
   * That is to say, not actually a method, but more like control flow.
   * 
   * This means that some of the arguments to this method may not be
   * evaluated based on the result of earlier arguments.
   */
  readonly isControlFlow?: boolean;
};

function newMethod(params: NewMethodParameters): Method {
  const functionType: FunctionType =
    params.functionType || newFunctionType(params.parameters.map(p => p.type), params.returnType);
  const sourceVariable: Variable = params.sourceVariable || {
    identifier: params.identifier,
    type: functionType,
  };
  return {
    identifier: params.identifier,
    parameters: params.parameters,
    returnType: params.returnType,
    functionType,
    sourceVariable,
    aliasFor: params.aliasFor,
    isControlFlow: !!params.isControlFlow,
  };
}

export function newClassTypeType(identifier: Identifier, superClassType?: ClassType): ClassTypeType {
  const classType = new Type({
    identifier,
    classTypeData: { superClassType, fields: [] },
  }) as ClassType;
  const classTypeType = new Type({
    identifier: { location: identifier.location, name: `(class ${identifier.name})` },
    classTypeTypeData: { classType },
  }) as ClassTypeType;
  return classTypeType;
}

export function newInterfaceTypeType(identifier: Identifier, superTypes: InterfaceType[]): InterfaceTypeType {
  const interfaceType = new Type({
    identifier,
    interfaceTypeData: { superTypes, cache: new WeakMap() },
  }) as InterfaceType;
  const interfaceTypeType = new Type({
    identifier: { location: identifier.location, name: `(interface ${identifier.name})` },
    interfaceTypeTypeData: { interfaceType },
  }) as InterfaceTypeType;
  return interfaceTypeType;
}

export function newEnumTypeType(identifier: Identifier): EnumTypeType {
  const enumType = new Type({
    identifier,
    enumTypeData: { values: new Map() },
  }) as EnumType;
  const enumTypeType = new Type({
    identifier: { location: identifier.location, name: `(enum ${identifier.name})` },
    enumTypeTypeData: { enumType },
  }) as EnumTypeType;
  addEnumMethods(enumType);
  return enumTypeType;
}

////////////////////////
// BUILTIN TYPE METHODS
////////////////////////

function addBinaryOperatorMethod(type: Type, operatorName: string, returnType: Type) {
  type.addMethod({
    identifier: { name: `__${operatorName}__` },
    parameters: [{ identifier: { name: 'other' }, type }],
    returnType,
    aliasFor: `__op_${operatorName}__`,
  });
}

function addEqualityOperatorMethods(type: Type) {
  addBinaryOperatorMethod(type, 'eq', BoolType);
  addBinaryOperatorMethod(type, 'ne', BoolType);
}

function addComparisonOperatorMethods(type: Type) {
  addEqualityOperatorMethods(type);
  addBinaryOperatorMethod(type, 'lt', BoolType);
  addBinaryOperatorMethod(type, 'le', BoolType);
  addBinaryOperatorMethod(type, 'gt', BoolType);
  addBinaryOperatorMethod(type, 'ge', BoolType);
}


// NumberType

addBinaryOperatorMethod(NumberType, 'add', NumberType);
addBinaryOperatorMethod(NumberType, 'sub', NumberType);
addBinaryOperatorMethod(NumberType, 'mul', NumberType);
addBinaryOperatorMethod(NumberType, 'div', NumberType);
addBinaryOperatorMethod(NumberType, 'mod', NumberType);
addBinaryOperatorMethod(NumberType, 'pow', NumberType);
addComparisonOperatorMethods(NumberType);

NumberType.addMethod({
  identifier: { name: '__pos__' },
  parameters: [],
  returnType: NumberType,
  aliasFor: '__op_pos__',
});

NumberType.addMethod({
  identifier: { name: '__neg__' },
  parameters: [],
  returnType: NumberType,
  aliasFor: '__op_neg__',
});

// StringType

addBinaryOperatorMethod(StringType, 'add', StringType);
addComparisonOperatorMethods(StringType);

StringType.addMethod({
  identifier: { name: '__get_size' },
  parameters: [],
  returnType: NumberType,
  aliasFor: '__get___js_length',
});

// NullableType

function addNullableMethods(nullableType: NullableType) {
  const itemType = nullableType.nullableTypeData.itemType;
  nullableType.addMethod({
    identifier: { name: 'get' },
    parameters: [],
    returnType: itemType,
    aliasFor: '__op_nullget__',
  });
  nullableType.addMethod({
    identifier: { name: 'getOrElse' },
    parameters: [{ identifier: { name: 'alternative' }, type: itemType }],
    returnType: itemType,
    aliasFor: '__op_nullish_coalescing__',
    isControlFlow: true,
  });
  nullableType.addMethod({
    identifier: { name: 'orElse' },
    parameters: [{ identifier: { name: 'alternative' }, type: nullableType }],
    returnType: nullableType,
    aliasFor: '__op_nullish_coalescing__',
    isControlFlow: true,
  });
  nullableType.addMethod({
    identifier: { name: 'hasValue' },
    parameters: [],
    returnType: nullableType,
    aliasFor: '__op_hasvalue__',
  });
}

// ListType

function addListMethods(listType: ListType) {
  const itemType = listType.listTypeData.itemType;
  listType.addMethod({
    identifier: { name: '__get_size' },
    parameters: [],
    returnType: NumberType,
    aliasFor: '__get___js_length',
  });
  listType.addMethod({
    identifier: { name: '__getitem__' },
    parameters: [{ identifier: { name: 'index' }, type: NumberType }],
    returnType: itemType,
    aliasFor: '__op_getitem__',
  });
  listType.addMethod({
    identifier: { name: '__setitem__' },
    parameters: [
      { identifier: { name: 'index' }, type: NumberType },
      { identifier: { name: 'value' }, type: itemType },
    ],
    returnType: itemType,
    aliasFor: '__op_setitem__',
  });
}

// EnumType

function addEnumMethods(enumType: EnumType) {
  addEqualityOperatorMethods(enumType);
  enumType.addMethod({
    identifier: { name: '__get_value' },
    parameters: [],
    returnType: StringType,
    aliasFor: '__op_noop__',
  });
}
