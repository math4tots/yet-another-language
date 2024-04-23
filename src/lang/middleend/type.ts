import { Identifier } from "../frontend/ast";
import * as ast from "../frontend/ast";
import type { Annotation, EnumConstVariable, Variable } from "./annotation";

type TypeConstructorParameters = {
  readonly identifier: Identifier;
  readonly comment?: ast.StringLiteral;
  readonly typeTypeData?: TypeTypeData;
  readonly basicTypeData?: BasicTypeData;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly unionTypeData?: UnionTypeData;
  readonly typeParameterTypeData?: TypeParameterTypeData;
};

type TypeTypeData = {
  readonly type: Type;

  /**
   * Indicates whether this TypeType is compile time only or actually has a runtime value.
   * 
   * Currently, classes are the only TypeTypes that have runtime values.
   * This runtime value is required when calling the constructor for a class.
   * 
   * interfaces, enums, and all other TypeTypes currently do not have runtime values.
   * 
   * NOTE: this is false for type aliases - so an alias of a class type cannot be
   * used to construct instances of a class.
   */
  readonly isCompileTimeOnly: boolean;
};

/** Bool, Number or String */
type BasicTypeData = {};

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

type InterfaceTypeData = {
  readonly typeType: InterfaceTypeType;
  readonly superTypes: InterfaceType[];
  readonly cache: WeakMap<Type, boolean>;
};

type InterfaceTypeDataWIP = InterfaceTypeData & {
  typeType: InterfaceTypeType;
};

type EnumTypeData = {
  readonly underlyingType: Type;
  readonly valueToVariableMap: Map<(string | number), EnumConstVariable>;
};

type UnionTypeData = {
  readonly types: UnionElementType[];
};

type TypeParameterTypeData = {};

/** The basic types are Bool, Number and String. Null was intentionally excluded */
export type BasicType = Type & { readonly basicTypeData: BasicTypeData; };

export type TypeType = Type & { readonly typeTypeData: TypeTypeData; };
export type NullableType = Type & { readonly nullableTypeData: NullableTypeData; };
export type ListType = Type & { readonly listTypeData: ListTypeData; };
export type LambdaType = Type & { readonly lambdaTypeData: LambdaTypeData; };
export type FunctionType = Type & { readonly functionTypeData: FunctionTypeData; };
export type ModuleType = Type & { readonly moduleTypeData: ModuleTypeData; };
export type ClassType = Type & { readonly classTypeData: ClassTypeData; };
export type ClassTypeType = Type & { readonly typeTypeData: { readonly type: ClassType; }; };
export type InterfaceType = Type & { readonly interfaceTypeData: InterfaceTypeData; };
export type InterfaceTypeType = Type & { readonly typeTypeData: { readonly type: InterfaceType; }; };
export type EnumType = Type & { readonly enumTypeData: EnumTypeData; };
export type EnumTypeType = Type & { readonly typeTypeData: { readonly type: EnumType; }; };
export type UnionType = Type & { readonly unionTypeData: UnionTypeData; };

export type TypeParameterType = Type & { readonly typeParameterTypeData: TypeParameterTypeData; };
export type TypeParameterTypeType = Type & { readonly typeTypeData: { readonly type: TypeParameterTypeType; }; };

/**
 * Types that are allowed to be part of a union type.
 * 
 * Null and Nullable types are not allowed.
 * 
 * Interface types are allowed because the Null type is not allowed to implement any interface.
 */
export type UnionElementType = BasicType | ListType | ClassType | InterfaceType | EnumType;

export class Type {
  readonly identifier: Identifier;
  readonly comment?: ast.StringLiteral;
  private _list?: ListType;
  private _nullable?: NullableType;
  readonly typeTypeData?: TypeTypeData;
  readonly basicTypeData?: BasicTypeData;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly unionTypeData?: UnionTypeData;
  readonly typeParameterTypeData?: TypeParameterTypeData;
  private readonly _methods: Method[] = [];
  private readonly _methodMap = new Map<string, Method>();

  constructor(parameters: TypeConstructorParameters) {
    const params = parameters;
    this.identifier = params.identifier;
    this.comment = params.comment;
    if (params.typeTypeData) {
      this.typeTypeData = params.typeTypeData;
    }
    if (params.basicTypeData) {
      this.basicTypeData = params.basicTypeData;
    }
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
    if (params.interfaceTypeData) {
      this.interfaceTypeData = params.interfaceTypeData;
    }
    if (params.enumTypeData) {
      this.enumTypeData = params.enumTypeData;
    }
    if (params.unionTypeData) {
      this.unionTypeData = params.unionTypeData;
    }
    if (params.typeParameterTypeData) {
      this.typeParameterTypeData = params.typeParameterTypeData;
    }
  }

  isTypeType(): boolean { return !!this.typeTypeData; }
  isClassTypeType(): boolean { return !!this.typeTypeData?.type.classTypeData; }
  isInterfaceTypeType(): boolean { return !!this.typeTypeData?.type.interfaceTypeData; }
  isEnumTypeType(): boolean { return !!this.typeTypeData?.type.enumTypeData; }

  isUnionElementType(): boolean {
    return !!(
      this.basicTypeData ||
      this.listTypeData ||
      this.classTypeData ||
      this.interfaceTypeData ||
      this.enumTypeData);
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

    // Null is treated specially, and cannot implement any interface.
    // Excluding nullable types, the Any type and the Null type itself, nothing can accept null.
    // So at this point, if the source type contains null, assignment must fail.
    if (source === AnyType || source === NullType || source.nullableTypeData) return false;

    // If the source is a union, we should succeed by checking each member of the union
    // are ok for assignment
    if (source.unionTypeData) {
      for (const element of source.unionTypeData.types) {
        if (!element.isAssignableTo(target)) return false;
      }
      return true;
    }

    // At this point we know that the source cannot be a union because we just tested for it.
    // So if the target is a union, we should be able to test by checking if source
    // can be assigned to any of the target's members.
    if (target.unionTypeData) {
      for (const element of target.unionTypeData.types) {
        if (source.isAssignableTo(element)) return true;
      }
      return false;
    }

    if (target.interfaceTypeData) {

      // Only unions or types that are allowed as part of unions are allowed to implement interfaces.
      if (!source.isUnionElementType()) return false;

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

    // If the source and destination are class types, we can check based on
    // class hierarchy
    if (source.classTypeData && target.classTypeData) {
      for (let sup = source.classTypeData.superClassType; sup; sup = sup?.classTypeData.superClassType) {
        if (sup === target) return true;
      }
      return false;
    }

    // no other claim to assignability
    return false;
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

    // If one is a generalization of the other, return the more general type
    if (lhs.isAssignableTo(rhs)) return rhs;
    if (rhs.isAssignableTo(lhs)) return lhs;

    // try to form a union type
    const unionElements = new Set<UnionElementType>();
    for (const arg of [lhs, rhs]) {
      if (arg.isUnionElementType()) {
        unionElements.add(arg as UnionElementType);
      } else if (arg.unionTypeData) {
        for (const member of arg.unionTypeData.types) unionElements.add(member);
      } else {
        return AnyType; // not eligible for union
      }
    }

    switch (unionElements.size) {
      case 0: return NeverType;
      case 1: return [...unionElements][0];
    }
    return newUnionType([...unionElements]);
  }

  toString(): string { return this.identifier.name; }

  mayHaveEnumConstVariables(): boolean {
    return !!this.enumTypeData ||
      this.nullableTypeData?.itemType.mayHaveEnumConstVariables() ||
      this.unionTypeData?.types.some(t => t.mayHaveEnumConstVariables()) ||
      false;
  }

  *getEnumConstVariables(): IterableIterator<EnumConstVariable> {
    if (this.enumTypeData) yield* this.enumTypeData.valueToVariableMap.values();
    else if (this.nullableTypeData) yield* this.nullableTypeData.itemType.getEnumConstVariables();
    else if (this.unionTypeData) {
      for (const member of this.unionTypeData.types) {
        yield* member.getEnumConstVariables();
      }
    }
  }

  getEnumConstVariableByValue(value: string | number): EnumConstVariable | undefined {
    if (this.enumTypeData) return this.enumTypeData.valueToVariableMap.get(value);
    if (this.nullableTypeData) return this.nullableTypeData.itemType.getEnumConstVariableByValue(value);
    if (this.unionTypeData) {
      for (const member of this.unionTypeData.types) {
        const variable = member.getEnumConstVariableByValue(value);
        if (variable) return variable;
      }
    }
  }

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
   * If present, means that invocations of this method can be inlined by replacing
   * them with the given value.
   */
  readonly inlineValue?: number | string;

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

export const BoolType = new Type({ identifier: { name: 'Bool' }, basicTypeData: {} }) as BasicType;
export const NumberType = new Type({ identifier: { name: 'Number' }, basicTypeData: {} }) as BasicType;
export const StringType = new Type({ identifier: { name: 'String' }, basicTypeData: {} }) as BasicType;

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

    // newFunctionType must provide a source variable - otherwise newMethod will create
    // a source variable and call newFunctionType
    sourceVariable: { identifier: { name }, type: functionType },
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
    sourceVariable: { identifier: { name: '__call__' }, type: functionType },
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
   * If present, means that invocations of this method can be inlined by replacing
   * them with the given value.
   */
  readonly inlineValue?: number | string;

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
  const sourceVariable: Variable = params.sourceVariable || {
    identifier: params.identifier,
    type: newFunctionType(params.parameters.map(p => p.type), params.returnType),
  };
  return {
    identifier: params.identifier,
    parameters: params.parameters,
    returnType: params.returnType,
    sourceVariable,
    aliasFor: params.aliasFor,
    inlineValue: params.inlineValue,
    isControlFlow: !!params.isControlFlow,
  };
}

export function newClassTypeType(
  identifier: Identifier,
  superClassType: ClassType | undefined,
  comment: ast.StringLiteral | undefined): ClassTypeType {
  const classType = new Type({
    identifier,
    classTypeData: { superClassType, fields: [] },
    comment,
  }) as ClassType;
  const classTypeType = new Type({
    identifier: { location: identifier.location, name: `(class ${identifier.name})` },
    typeTypeData: { type: classType, isCompileTimeOnly: false },
  }) as ClassTypeType;
  return classTypeType;
}

export function newInterfaceTypeType(
  identifier: Identifier,
  superTypes: InterfaceType[],
  comment: ast.StringLiteral | undefined): InterfaceTypeType {
  const interfaceTypeData: InterfaceTypeDataWIP = {
    superTypes,
    cache: new WeakMap(),

    // We put an invalid type here first, so that we can have a cyclic reference between
    // InterfaceTypeType and InterfaceType
    typeType: new Type({ identifier: { name: '(fake)' } }) as InterfaceTypeType,
  };
  const interfaceType = new Type({
    identifier,
    interfaceTypeData,
    comment,
  }) as InterfaceType;
  const interfaceTypeType = new Type({
    identifier: { location: identifier.location, name: `(interface ${identifier.name})` },
    typeTypeData: { type: interfaceType, isCompileTimeOnly: true },
  }) as InterfaceTypeType;
  interfaceTypeData.typeType = interfaceTypeType;
  return interfaceTypeType;
}

export type RecordEntry = {
  readonly identifier: Identifier;
  readonly type: Type;
  readonly isMutable: boolean;
};

export function newRecordType(identifier: Identifier, entryVariables: Variable[]) {
  const name = `${identifier.name}[${entryVariables.map(v =>
    v.identifier.name + (v.isMutable ? '*' : '')).join(',')}]`;
  const typeType = newInterfaceTypeType({ name, location: identifier.location }, [], undefined);
  const type = typeType.typeTypeData.type;
  for (const variable of entryVariables) {
    type.addMethod({
      identifier: { name: `__get_${variable.identifier.name}`, location: variable.identifier.location },
      parameters: [],
      returnType: variable.type,
      sourceVariable: variable,
    });
    if (variable.isMutable) {
      type.addMethod({
        identifier: { name: `__set_${variable.identifier.name}`, location: variable.identifier.location },
        parameters: [{ identifier: { name: 'value' }, type: variable.type }],
        returnType: variable.type,
        sourceVariable: variable,
      });
    }
  }
  return type;
}

export function newEnumTypeType(
  identifier: Identifier,
  underlyingType: Type,
  comment: ast.StringLiteral | undefined): EnumTypeType {
  const enumType = new Type({
    identifier,
    enumTypeData: { underlyingType, valueToVariableMap: new Map() },
    comment,
  }) as EnumType;
  const enumTypeType = new Type({
    identifier: { location: identifier.location, name: `(enum ${identifier.name})` },
    typeTypeData: { type: enumType, isCompileTimeOnly: true },
  }) as EnumTypeType;
  addEnumMethods(enumType);
  return enumTypeType;
}

export function newTypeParameterTypeType(identifier: Identifier): TypeParameterTypeType {
  const typeParameterType = new Type({
    identifier,
    typeParameterTypeData: {},
  }) as TypeParameterType;
  const typeParameterTypeType = new Type({
    identifier: { name: `(typevar ${identifier.name})`, location: identifier.location },
    typeTypeData: { type: typeParameterType, isCompileTimeOnly: true },
  }) as TypeParameterTypeType;
  return typeParameterTypeType;
}

export function newAliasType(identifier: Identifier, aliasedType: Type): TypeType {
  const aliasType = new Type({
    identifier: {
      location: identifier.location,
      name: `(typedef ${identifier.name}=${aliasedType.identifier.name})`,
    },
    typeTypeData: { type: aliasedType, isCompileTimeOnly: true },
    comment: aliasedType.comment,
  }) as TypeType;
  return aliasType;
}

/**
 * This function is not public because there's an implicit contract with using this function.
 * 
 * The argument `types` must have only unique values and must have length at least 2.
 */
function newUnionType(types: UnionElementType[]): UnionType {
  if (types.length < 1) {
    throw new Error('newUnionType with fewer than 2 elements');
  }
  const unionType = new Type({
    identifier: { name: `Union[${types.map(t => t.identifier.name).join(',')}]` },
    unionTypeData: { types: types },
  }) as UnionType;
  return unionType;
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
  const underlyingType = enumType.enumTypeData.underlyingType;
  addEqualityOperatorMethods(enumType);
  enumType.addMethod({
    identifier: { name: '__get_value' },
    parameters: [],
    returnType: underlyingType,
    aliasFor: '__op_noop__',
  });
}
