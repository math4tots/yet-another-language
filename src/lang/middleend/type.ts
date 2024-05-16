import { Identifier } from "../frontend/ast";
import * as ast from "../frontend/ast";
import type { Annotation, EnumConstVariable, TypeParameterVariable, Variable } from "./annotation";
import { translateFieldName } from "./names";

type TypeConstructorParameters = {
  readonly identifier: Identifier;
  readonly comment?: ast.StringLiteral;
  readonly typeTypeData?: TypeTypeData;
  readonly basicTypeData?: BasicTypeData;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly tupleTypeData?: TupleTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly unionTypeData?: UnionTypeData;
  readonly valueTypeData?: ValueTypeData;
  readonly iterableTypeData?: IterableTypeData;
  readonly promiseTypeData?: PromiseTypeData;
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

type TupleTypeData = {
  readonly itemTypes: Type[];
};

type FunctionTypeData = {
  readonly parameterTypes: Type[];
  readonly returnType: Type;
};

type LambdaTypeData = {
  readonly typeParameters: TypeParameterVariable[] | undefined;
  readonly parameters: Parameter[];
  readonly functionType: FunctionType;
  readonly returnType: Type;
};

type ModuleTypeData = {
  readonly annotation: Annotation;
};

type ClassTypeData = {
  readonly isAbstract: boolean;
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

type ValueTypeData = {
  readonly variable: { identifier: Identifier, type: Type, value: number | string; };
  readonly decayType: Type;
};

type IterableTypeData = {
  readonly itemType: Type;
};

type PromiseTypeData = {
  readonly valueType: Type;
};

type TypeParameterTypeData = {
  readonly constraint: Type;
};

/** The basic types are Bool, Number and String. Null was intentionally excluded */
export type BasicType = Type & { readonly basicTypeData: BasicTypeData; };
export type BasicTypeType = Type & { readonly typeTypeData: BasicType; };

export type TypeType = Type & { readonly typeTypeData: TypeTypeData; };
export type NullableType = Type & { readonly nullableTypeData: NullableTypeData; };
export type ListType = Type & { readonly listTypeData: ListTypeData; };
export type TupleType = Type & { readonly tupleTypeData: TupleTypeData; };
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
export type ValueType = Type & { readonly valueTypeData: ValueTypeData; };
export type IterableType = Type & { readonly iterableTypeData: IterableTypeData; };
export type PromiseType = Type & { readonly promiseTypeData: PromiseTypeData; };

export type TypeParameterType = Type & { readonly typeParameterTypeData: TypeParameterTypeData; };
export type TypeParameterTypeType = Type & { readonly typeTypeData: { readonly type: TypeParameterType; }; };

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
  private _iterable?: IterableType;
  private _promise?: PromiseType;
  private _addMethods?: (() => void);
  readonly typeTypeData?: TypeTypeData;
  readonly basicTypeData?: BasicTypeData;
  readonly nullableTypeData?: NullableTypeData;
  readonly listTypeData?: ListTypeData;
  readonly tupleTypeData?: TupleTypeData;
  readonly functionTypeData?: FunctionTypeData;
  readonly lambdaTypeData?: LambdaTypeData;
  readonly moduleTypeData?: ModuleTypeData;
  readonly classTypeData?: ClassTypeData;
  readonly interfaceTypeData?: InterfaceTypeData;
  readonly enumTypeData?: EnumTypeData;
  readonly unionTypeData?: UnionTypeData;
  readonly valueTypeData?: ValueTypeData;
  readonly iterableTypeData?: IterableTypeData;
  readonly promiseTypeData?: PromiseTypeData;
  readonly typeParameterTypeData?: TypeParameterTypeData;
  private readonly _methods: Method[] = [];
  private readonly _methodMap = new Map<string, Method[]>();

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
    if (params.tupleTypeData) {
      this.tupleTypeData = params.tupleTypeData;
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
    if (params.valueTypeData) {
      this.valueTypeData = params.valueTypeData;
    }
    if (params.iterableTypeData) {
      this.iterableTypeData = params.iterableTypeData;
    }
    if (params.promiseTypeData) {
      this.promiseTypeData = params.promiseTypeData;
    }
    if (params.typeParameterTypeData) {
      this.typeParameterTypeData = params.typeParameterTypeData;
      const constraint = params.typeParameterTypeData.constraint;
      this._addMethods = () => {
        for (const method of constraint.getAllMethods()) {
          this.addMethod(method);
        }
      };
    }
  }

  isTypeType(): boolean { return !!this.typeTypeData; }
  isClassTypeType(): boolean { return !!this.typeTypeData?.type.classTypeData; }
  isInterfaceTypeType(): boolean { return !!this.typeTypeData?.type.interfaceTypeData; }
  isEnumTypeType(): boolean { return !!this.typeTypeData?.type.enumTypeData; }

  isUnionElementType(): boolean {
    return !!(
      this.basicTypeData ||
      this.valueTypeData ||
      this.listTypeData ||
      this.tupleTypeData ||
      this.promiseTypeData ||
      this.classTypeData ||
      this.interfaceTypeData ||
      this.enumTypeData);
  }

  hasTypeVariable(): boolean {
    return !!(this.typeParameterTypeData ||
      this.listTypeData?.itemType.hasTypeVariable() ||
      this.tupleTypeData?.itemTypes.some(e => e.hasTypeVariable()) ||
      this.nullableTypeData?.itemType.hasTypeVariable() ||
      this.unionTypeData?.types.some(t => t.hasTypeVariable()) ||
      this.promiseTypeData?.valueType.hasTypeVariable() ||
      this.iterableTypeData?.itemType.hasTypeVariable() ||
      this.functionTypeData?.returnType.hasTypeVariable() ||
      this.functionTypeData?.parameterTypes.some(p => p.hasTypeVariable()));
  }

  lambdaErasure(): Type {
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

    if (source.tupleTypeData) {
      const sourceTypes = source.tupleTypeData.itemTypes;
      if (target.tupleTypeData) {
        const targetTypes = target.tupleTypeData.itemTypes;
        return sourceTypes.length === targetTypes.length && sourceTypes.every(
          (s, i) => s.isAssignableTo(targetTypes[i]));
      } else if (target.listTypeData) {
        const targetItemType = target.listTypeData.itemType;
        return sourceTypes.every(s => s.isAssignableTo(targetItemType));
      }
    }

    if (target.iterableTypeData) {
      const sourceItemType = this.getIterableItemType();
      if (sourceItemType === undefined) return false;
      return sourceItemType.isAssignableTo(target.iterableTypeData.itemType);
    }

    if (source.promiseTypeData && target.promiseTypeData) {
      return source.promiseTypeData.valueType.isAssignableTo(target.promiseTypeData.valueType);
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

    if (source.functionTypeData && target.functionTypeData) {
      const sourceParameterTypes = source.functionTypeData.parameterTypes;
      const sourceReturnType = source.functionTypeData.returnType;
      const targetParameterTypes = target.functionTypeData.parameterTypes;
      const targetReturnType = target.functionTypeData.returnType;
      if (sourceParameterTypes.length > targetParameterTypes.length) return false;
      if (!sourceReturnType.isAssignableTo(targetReturnType)) return false;
      for (let i = 0; i < sourceParameterTypes.length; i++) {
        if (!targetParameterTypes[i].isAssignableTo(sourceParameterTypes[i])) return false;
      }
      return true;
    }

    if (source.valueTypeData) {
      const sourceValue = source.valueTypeData.variable.value;
      if (target.valueTypeData) {
        return sourceValue === target.valueTypeData.variable.value;
      }
      if (source.valueTypeData.decayType.isAssignableTo(target)) {
        return true;
      }
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

    // TODO: Make this play well with unions of Iterables
    if (lhs.iterableTypeData && rhs.iterableTypeData) {
      return lhs.iterableTypeData.itemType.getCommonType(rhs.iterableTypeData.itemType).iterable();
    }

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

  getIterableItemType(): Type | undefined {
    return (this === StringType ? StringType : null) ||
      this.iterableTypeData?.itemType ||
      this.listTypeData?.itemType ||
      this.tupleTypeData?.itemTypes.reduce((a, b) => a.getCommonType(b)) ||
      undefined;
  }

  toString(): string { return this.identifier.name; }

  mayHaveEnumConstVariables(): boolean {
    return !!this.enumTypeData ||
      !!this.valueTypeData ||
      this.nullableTypeData?.itemType.mayHaveEnumConstVariables() ||
      this.unionTypeData?.types.some(t => t.mayHaveEnumConstVariables()) ||
      false;
  }

  *getEnumConstVariables(): IterableIterator<Variable> {
    if (this.enumTypeData) yield* this.enumTypeData.valueToVariableMap.values();
    else if (this.valueTypeData) yield this.valueTypeData.variable;
    else if (this.nullableTypeData) yield* this.nullableTypeData.itemType.getEnumConstVariables();
    else if (this.unionTypeData) {
      for (const member of this.unionTypeData.types) {
        yield* member.getEnumConstVariables();
      }
    }
  }

  getEnumConstVariableByValue(value: string | number): Variable | undefined {
    if (this.enumTypeData) return this.enumTypeData.valueToVariableMap.get(value);
    if (this.valueTypeData?.variable.value === value) return this.valueTypeData.variable;
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
    listType._addMethods = () => addListMethods(listType);
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
    nullableType._addMethods = () => addNullableMethods(nullableType);
    this._nullable = nullableType;
    return nullableType;
  }

  iterable(): IterableType {
    const cached = this._iterable;
    if (cached) return cached;
    const iterableType = new Type({
      identifier: { name: `Iterable[${this.identifier.name}]` },
      iterableTypeData: { itemType: this },
    }) as IterableType;
    this._iterable = iterableType;
    return iterableType;
  }

  promise(): PromiseType {
    const cached = this._promise;
    if (cached) return cached;
    const promiseType = new Type({
      identifier: { name: `Promise[${this.identifier.name}]` },
      promiseTypeData: { valueType: this },
    }) as PromiseType;
    promiseType._addMethods = () => addPromiseMethods(promiseType);
    this._promise = promiseType;
    return promiseType;
  }

  private prepareMethods() {
    if (this._addMethods) {
      this._addMethods();
      this._addMethods = undefined;
    }
  }

  /**
   * Find and return a list of methods that can handle the given number of
   * arguments.
   * 
   * If there are multiple methods that could potentially handle the given number
   * of arguments, the search is done again, but all methods with type parameters
   * and those that satisfied the requirements only by removing default parameters
   * are ruled out.
   * 
   * If this second search removes all candidates, a list with just the first result
   * from the initial search is returned.
   * 
   * If you need a method that has exactly the given number of parameters,
   * use the method 'getMethodWithExactParameterCount' instead.
   */
  getMethodsHandlingArgumentCount(methodName: string, argumentCount: number): Method[] {
    this.prepareMethods();
    const methods = this._methodMap.get(methodName);
    const results = [];
    if (methods) {
      for (const method of methods) {
        let argc = method.parameters.length;
        while (argc > argumentCount && method.parameters[argc - 1].defaultValue) {
          argc--;
        }
        if (argc === argumentCount) results.push(method);
      }
      if (results.length > 1) {
        const backup = results[0];

        // if there's more than one matching method, filter some of the methods
        results.length = 0;
        for (const method of methods) {
          // when being picky, only pick methods with exact argument count match and
          // exlude methods with type parameters
          if (method.parameters.length === argumentCount && !method.typeParameters) {
            results.push(method);
          }
        }

        if (results.length === 0) results.push(backup);
      }
    }
    return results;
  }

  /**
   * Find and return the first method with exactly the given parameter count.
   * 
   * This does not take into account default parameters, so a method that could potentially
   * handle the given number of arguments may be passed over because it does not match
   * exactly the given number of arguments.
   * 
   * If you need any method that can handle the given number of arguments even
   * if the parameter count does not match exactly, use the method
   * 'getMethodHandlingArgumentCount' instead.
   */
  getMethodWithExactParameterCount(methodName: string, parameterCount: number): Method | undefined {
    this.prepareMethods();
    const methods = this._methodMap.get(methodName);
    if (methods) {
      for (const method of methods) {
        if (method.parameters.length === parameterCount) return method;
      }
    }
    return undefined;
  }

  getAnyMethodWithName(methodName: string): Method | undefined {
    this.prepareMethods();
    const methods = this._methodMap.get(methodName);
    return methods?.length ? methods[0] : undefined;
  }

  getAllMethodsWithName(methodName: string): Method[] {
    this.prepareMethods();
    return this._methodMap.get(methodName) || [];
  }

  /** Returns all methods of this type, including those inherited from super class or interfaces */
  getAllMethods(): Method[] {
    this.prepareMethods();
    return [...this._methods];
  }

  *getAllMethodsWithDedupedNames(): Generator<Method> {
    this.prepareMethods();
    const seen = new Set<string>();
    for (const method of this._methods) {
      if (!seen.has(method.identifier.name)) {
        seen.add(method.identifier.name);
        yield method;
      }
    }
  }

  addMethod(params: NewMethodParameters) {
    const method = newMethod(params);
    this._methods.push(method);
    const methods = this._methodMap.get(method.identifier.name);
    if (methods) {
      methods.push(method);
    } else {
      this._methodMap.set(method.identifier.name, [method]);
    }
  }

  implementsMethod(targetMethod: Method): boolean {
    // template methods cannot be implemented (yet)
    if (targetMethod.typeParameters) return false;

    // Due to the way default parameters work, when implementing methods,
    // exact parameter count match is required.
    const method = this.getMethodWithExactParameterCount(
      targetMethod.identifier.name, targetMethod.parameters.length);
    if (!method) {
      // If we have a non-abstract class, and the required method is a nullable field,
      // it's ok if the method is entirely missing.
      if (this.classTypeData?.isAbstract === false &&
        targetMethod.identifier.name.startsWith('__get_') &&
        targetMethod.parameters.length === 0 &&
        targetMethod.returnType.nullableTypeData) {
        return true;
      }
      return false;
    }

    // template methods cannot implement interface methods (yet)
    if (method.typeParameters) return false;

    // If there is any sort of method aliasing going on, the methods must match exactly.
    // Otherwise, there could be strange errors at runtime.
    if (method.aliasFor !== targetMethod.aliasFor) return false;

    for (let i = 0; i < targetMethod.parameters.length; i++) {
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
  readonly typeParameters?: TypeParameterTypeType[];
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

export const AnyTypeType = new Type({
  identifier: { name: '(type Any)' },
  typeTypeData: { type: AnyType, isCompileTimeOnly: true },
}) as TypeType;

export const NeverTypeType = new Type({
  identifier: { name: '(type Never)' },
  typeTypeData: { type: NeverType, isCompileTimeOnly: true },
}) as TypeType;

export const NullTypeType = new Type({
  identifier: { name: '(type Null)' },
  typeTypeData: { type: NullType, isCompileTimeOnly: true },
}) as TypeType;

export const BoolTypeType = new Type({
  identifier: { name: '(type Bool)' },
  typeTypeData: { type: BoolType, isCompileTimeOnly: true },
}) as BasicTypeType;

export const NumberTypeType = new Type({
  identifier: { name: '(type Number)' },
  typeTypeData: { type: NumberType, isCompileTimeOnly: true },
}) as BasicTypeType;

export const StringTypeType = new Type({
  identifier: { name: '(type String)' },
  typeTypeData: { type: StringType, isCompileTimeOnly: true },
}) as BasicTypeType;

type Cache<T extends Type> = {
  type?: T,
  readonly map: WeakMap<Type, Cache<T>>,
};

function getCache<T extends Type>(c: Cache<T>, types: Type[]): Cache<T> {
  for (const type of types) {
    const foundChild = c.map.get(type);
    if (foundChild) {
      c = foundChild;
    } else {
      const newChild: Cache<T> = { map: new WeakMap() };
      c.map.set(type, newChild);
      c = newChild;
    }
  }
  return c;
}

const tupleCacheRoot: Cache<TupleType> = { map: new WeakMap() };

export function newTupleType(types: Type[]): TupleType {
  const c = getCache<TupleType>(tupleCacheRoot, types);
  const cached = c.type;
  if (cached) return cached;
  const name = `Tuple[${types.map(t => t.toString()).join(',')}]`;
  const tupleTypeData: TupleTypeData = { itemTypes: [...types] };
  const tupleType = new Type({ identifier: { name }, tupleTypeData }) as TupleType;
  addTupleMethods(tupleType);
  c.type = tupleType;
  return tupleType;
}

const functionCacheRoot: Cache<FunctionType> = { map: new WeakMap() };

export function newFunctionType(parameterTypes: Type[], returnType: Type): FunctionType {
  const types = [...parameterTypes, returnType];
  const c = getCache<FunctionType>(functionCacheRoot, types);
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

export function newLambdaType(
  typeParameters: TypeParameterVariable[] | undefined,
  parameters: Parameter[],
  returnType: Type): LambdaType {
  const functionType = newFunctionType(parameters.map(p => p.type), returnType);
  const name =
    (typeParameters ? '[' + typeParameters.map(
      tp => tp.type.typeTypeData.type.typeParameterTypeData.constraint !== AnyType ?
        `${tp.identifier.name}: ${tp.type.typeTypeData.type.typeParameterTypeData.constraint}` :
        `${tp.identifier.name}`).join(', ') + ']' : '') +
    '(' + parameters.map(p => `${p.identifier.name}: ${p.type}`).join(', ') + ') => ' +
    returnType;
  const lambdaType = new Type({
    identifier: { name },
    lambdaTypeData: {
      functionType,
      typeParameters,
      parameters: [...parameters],
      returnType,
    },
  });
  lambdaType.addMethod({
    identifier: { name: '__call__' },
    typeParameters: typeParameters?.map(tp => tp.type),
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

          // Because we qualify method names with the number of parameters it has,
          // by default, the field names on a module will not match the automatically
          // inferred method name.
          // So instead we explicitly specify the method name here so that we
          // do not need to specially handle module "methods"
          aliasFor: `__js_${translateFieldName(variable.identifier.name)}`,
        });
      }
    }
  }
  return moduleType;
}

interface NewMethodParameters {
  readonly identifier: Identifier;
  readonly typeParameters?: TypeParameterTypeType[];
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
    typeParameters: params.typeParameters,
    parameters: params.parameters,
    returnType: params.returnType,
    sourceVariable,
    aliasFor: params.aliasFor,
    inlineValue: params.inlineValue,
    isControlFlow: !!params.isControlFlow,
  };
}

export function newClassTypeType(
  isAbstract: boolean,
  identifier: Identifier,
  superClassType: ClassType | undefined,
  comment: ast.StringLiteral | undefined): ClassTypeType {
  const classType = new Type({
    identifier,
    classTypeData: { isAbstract, superClassType, fields: [] },
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

function addRecordTypeMembers(type: Type, entryVariables: Variable[]) {
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
}

function getRecordLiteralName(entryVariables: Variable[]) {
  const parts = ['{'];
  for (let i = 0; i < entryVariables.length; i++) {
    if (i > 0) parts.push(',');
    const v = entryVariables[i];
    if (v.isMutable) parts.push('var ');
    parts.push(v.identifier.name, ': ', v.type.toString());
  }
  parts.push('}');
  return parts.join('');
}

export function newRecordLiteralType(location: ast.Location, entryVariables: Variable[]) {
  const name = getRecordLiteralName(entryVariables);
  const typeType = newInterfaceTypeType({ name, location }, [], undefined);
  const type = typeType.typeTypeData.type;
  addRecordTypeMembers(type, entryVariables);
  return type;
}

export function newRecordClassType(entryVariables: Variable[]) {
  const name = getRecordLiteralName(entryVariables);
  const typeType = newClassTypeType(false, { name }, undefined, undefined);
  const type = typeType.typeTypeData.type;
  addRecordTypeMembers(type, entryVariables);
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

export function newTypeParameterTypeType(identifier: Identifier, constraint: Type): TypeParameterTypeType {
  const typeParameterType = new Type({
    identifier,
    typeParameterTypeData: { constraint },
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
addBinaryOperatorMethod(NumberType, 'or', NumberType);
addBinaryOperatorMethod(NumberType, 'and', NumberType);
addBinaryOperatorMethod(NumberType, 'lshift', NumberType);
addBinaryOperatorMethod(NumberType, 'rshift', NumberType);
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
    identifier: { name: 'map' },
    parameters: [{ identifier: { name: 'f' }, type: newFunctionType([itemType], itemType) }],
    returnType: nullableType,
    aliasFor: '__op_nullmap__',
  });
  nullableType.addMethod({
    identifier: { name: 'flatMap' },
    parameters: [{ identifier: { name: 'f' }, type: newFunctionType([itemType], nullableType) }],
    returnType: nullableType,
    aliasFor: '__op_nullmap__',
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
    sourceVariable: { identifier: { name: 'size' }, type: NumberType },
  });
  listType.addMethod({
    identifier: { name: 'clear' },
    parameters: [],
    returnType: AnyType,
    aliasFor: '__op_clearlength__',
  });
  listType.addMethod({
    identifier: { name: '__getitem__' },
    parameters: [{ identifier: { name: 'index' }, type: NumberType }],
    returnType: itemType,
    aliasFor: '__op_getitem__',
  });
  listType.addMethod({
    identifier: { name: 'at' },
    parameters: [{ identifier: { name: 'index' }, type: NumberType }],
    returnType: itemType,
    aliasFor: '__js_at',
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
  listType.addMethod({
    identifier: { name: 'push' },
    parameters: [
      { identifier: { name: 'value' }, type: itemType },
    ],
    returnType: itemType,
    aliasFor: '__js_push',
  });
  listType.addMethod({
    identifier: { name: 'extend' },
    parameters: [
      { identifier: { name: 'values' }, type: listType },
    ],
    returnType: itemType,
    aliasFor: '__fn_Array.prototype.push.apply',
  });
  listType.addMethod({
    identifier: { name: 'filter' },
    parameters: [
      { identifier: { name: 'f' }, type: newFunctionType([itemType], BoolType) },
    ],
    returnType: listType,
    aliasFor: '__js_filter',
  });
  {
    const RType = newTypeParameterTypeType({ name: 'R' }, AnyType);
    const R = RType.typeTypeData.type;
    listType.addMethod({
      identifier: { name: 'map' },
      typeParameters: [RType],
      parameters: [
        { identifier: { name: 'f' }, type: newFunctionType([itemType, NumberType], R) },
      ],
      returnType: R.list(),
      aliasFor: '__js_map',
    });
  }
}

// TupleType

function addTupleMethods(tupleType: TupleType) {
  const itemTypes = tupleType.tupleTypeData.itemTypes;
  itemTypes.forEach((itemType, i) => {
    tupleType.addMethod({
      identifier: { name: `__get_v${i}` },
      parameters: [],
      returnType: itemType,
      aliasFor: `__op_${i}__`,
    });
  });
}

// PromiseType

function addPromiseMethods(promiseType: PromiseType) {
  const valueType = promiseType.promiseTypeData.valueType;
  {
    const RType = newTypeParameterTypeType({ name: 'R' }, AnyType);
    const R = RType.typeTypeData.type;
    promiseType.addMethod({
      identifier: { name: 'map' },
      typeParameters: [RType],
      parameters: [
        { identifier: { name: 'f' }, type: newFunctionType([valueType], R) },
      ],
      returnType: promiseType,
      aliasFor: '__js_then',
    });
  }
  {
    const RType = newTypeParameterTypeType({ name: 'R' }, AnyType);
    const R = RType.typeTypeData.type;
    promiseType.addMethod({
      identifier: { name: 'flatMap' },
      parameters: [
        { identifier: { name: 'f' }, type: newFunctionType([valueType], R.promise()) },
      ],
      returnType: promiseType,
      aliasFor: '__js_then',
    });
  }
  {
    const RType = newTypeParameterTypeType({ name: 'R' }, AnyType);
    const R = RType.typeTypeData.type;
    promiseType.addMethod({
      identifier: { name: 'catch' },
      parameters: [
        { identifier: { name: 'f' }, type: newFunctionType([AnyType], R.promise().nullable()) },
      ],
      returnType: R.promise(),
      aliasFor: '__js_catch',
    });
  }
  promiseType.addMethod({
    identifier: { name: 'finally' },
    parameters: [{ identifier: { name: 'f' }, type: newFunctionType([], AnyType) }],
    returnType: promiseType,
    aliasFor: '__js_finally',
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
