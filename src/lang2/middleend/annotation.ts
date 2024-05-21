import * as ast from '../frontend/ast';
import { Location } from '../frontend/location';

export type AnnotationError = ast.ParseError;

export class Annotation {
  readonly uri: string;
  readonly ir: ast.ModuleDisplay;
  readonly errors: AnnotationError[];
  private _variable?: Variable;

  constructor(uri: string, ir: ast.ModuleDisplay, errors: AnnotationError[]) {
    this.uri = uri;
    this.ir = ir;
    this.errors = errors;
  }

  asVariable() {
    const cached = this._variable;
    if (cached) return cached;
    const uri = this.uri;
    const range = this.ir.range;
    const identifier = new Identifier('module', new Location(uri, range));
    const type = new SimpleType(identifier, { isNominal: true });
    const variable = new Variable(identifier, type);
    this._variable = variable;
    return variable;
  }
}

export class Identifier {
  static fromNameAndURI(name: ast.Name, uri: string) {
    return new Identifier(name.value, new Location(uri, name.range));
  }

  readonly name: string;
  readonly location?: Location;

  constructor(name: string, location?: Location) {
    this.name = name;
    this.location = location;
  }
}

export type VariableOptions = {
  readonly comment?: ast.StringLiteral;
};

export class Variable {
  readonly identifier: Identifier;
  readonly type: Type;
  readonly comment?: ast.StringLiteral;

  constructor(identifier: Identifier, type: Type, options?: VariableOptions) {
    const opts = options || {};
    this.identifier = identifier;
    this.type = type;
    this.comment = opts.comment;
  }
}

type BaseTypeOptions = {
  /** Is this type an interface or a class? */
  readonly isInterface?: boolean;

  /** Nominal vs structural type. Nominal types can only be implemented by explicit inheritance/lineage */
  readonly isNominal?: boolean;
};

export type TypeTemplateOptions = BaseTypeOptions;
export type SimpleTypeOptions = BaseTypeOptions;
export type ReifiedTypeOptions = {};

export class TypeParameter extends Variable {
  constructor(identifier: Identifier, options?: VariableOptions) {
    super(identifier, newTypeTypeOf(new SimpleType(identifier, { isNominal: true })), options);
  }
}

export class TypeTemplate {
  readonly identifier: Identifier;
  readonly typeParameters: TypeParameter[];

  /** Is this type an interface or a class? */
  readonly isInterface: boolean;

  /** Nominal vs structural type. Nominal types can only be implemented by explicit inheritance/lineage */
  readonly isNominal: boolean;

  constructor(identifier: Identifier, typeParameters: TypeParameter[], options?: TypeTemplateOptions) {
    const opts = options || {};
    this.identifier = identifier;
    this.typeParameters = typeParameters;
    this.isInterface = !!opts.isInterface;
    this.isNominal = !!opts.isNominal;
  }
}

export type Type = SimpleType | ReifiedType | FunctionType;

export class SimpleType {
  readonly identifier: Identifier;

  /** Is this type an interface or a class? */
  readonly isInterface: boolean;

  /** Nominal vs structural type. Nominal types can only be implemented by explicit inheritance/lineage */
  readonly isNominal: boolean;

  /** Simple types have no template or args but having this allows us to discriminate on Type types */
  readonly template: undefined;
  readonly args: undefined;

  constructor(identifier: Identifier, options?: SimpleTypeOptions) {
    const opts = options || {};
    this.identifier = identifier;
    this.isInterface = !!opts.isInterface;
    this.isNominal = !!opts.isNominal;
  }

  toString() { return this.identifier.name; }
}

export class ReifiedType {
  readonly identifier: Identifier;
  readonly template: TypeTemplate;
  readonly args: Type[];

  constructor(template: TypeTemplate, args: Type[], options?: ReifiedTypeOptions) {
    const name = `${template.identifier.name}[${args.join(', ')}]`;
    this.identifier = new Identifier(name, template.identifier.location);
    this.template = template;
    this.args = args;
  }

  get isInterface() { return this.template.isInterface; }
  get isNominal() { return this.template.isNominal; }

  toString() { return this.identifier.name; }
}

export class Parameter {
  readonly identifier: Identifier;
  readonly type: Type;
  readonly defaultValue?: ast.Expression;

  constructor(identifier: Identifier, type: Type, defaultValue?: ast.Expression) {
    this.identifier = identifier;
    this.type = type;
    this.defaultValue = defaultValue;
  }
}

export class FunctionType {
  static readonly identifier = new Identifier('function');

  readonly identifier = FunctionType.identifier;
  readonly parameters: Parameter[];
  readonly returnType: Type;

  constructor(parameters: Parameter[], returnType: Type) {
    this.parameters = parameters;
    this.returnType = returnType;
  }
}

function newTypeTypeOf(type: Type) {
  return new ReifiedType(typeTemplateType, [type]);
}

const identifierT = new Identifier('T');

const identifierType = new Identifier('Type');
export const typeTemplateType = new TypeTemplate(identifierType, [], { isNominal: true });

// We construct typeTemplateType first because 'new TypeParameter' needs to refer to
// typeTemplateType
typeTemplateType.typeParameters.push(new TypeParameter(identifierT));

const identifierAny = new Identifier('Any');
export const typeAny = new SimpleType(identifierAny);
export const typeAnyType = newTypeTypeOf(typeAny);
export const variableAny = new Variable(identifierAny, typeAnyType);
