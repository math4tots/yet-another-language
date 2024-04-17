import * as ast from '../frontend/ast';
import { Completion } from './annotation';
import { Solver } from './solver';
import {
  AnyType,
  BoolType,
  NeverType,
  NilType,
  NumberType,
  StringType,
  Type,
  newFunctionType,
} from './type';

export class TypeSolver extends Solver {
  private readonly typeSolverCache = new Map<ast.TypeExpression, Type>();

  private _solveType(e: ast.TypeExpression): Type {
    // class or interface from an imported module
    if (e.qualifier) {
      const parent = this.scope[e.qualifier.name];
      if (!parent) {
        this.error(e.qualifier.location, `${e.qualifier.name} not found`);
        return AnyType;
      }
      this.markReference(parent, e.qualifier.location.range);
      const moduleTypeData = parent.type.moduleTypeData;
      if (!moduleTypeData) {
        this.error(e.qualifier.location, `${e.qualifier.name} is not a module`);
        return AnyType;
      }

      // completion based on member of module
      this.annotation.completionPoints.push({
        range: e.identifier.location.range,
        getCompletions() {
          return Array.from(moduleTypeData.annotation.moduleVariableMap.values())
            .filter(v => v.type.classTypeTypeData || v.type.interfaceTypeTypeData)
            .map(v => ({ name: v.identifier.name }));
        },
      });

      const variable = moduleTypeData.annotation.moduleVariableMap.get(e.identifier.name);
      if (!variable) {
        this.error(e.identifier.location, `Type ${e.identifier.name} not found in module`);
        return AnyType;
      }

      this.markReference(variable, e.identifier.location.range);
      const type = variable.type.classTypeTypeData?.classType ||
        variable.type.interfaceTypeTypeData?.interfaceType;
      if (!type) {
        this.error(e.identifier.location, `${e.identifier.name} is not a class or interface`);
        return AnyType;
      }
      return type;
    }

    // autocomplete for typenames without a qualifier
    const scopeAtLocation = this.scope;
    this.annotation.completionPoints.push({
      range: e.identifier.location.range,
      getCompletions: () => {
        const completions: Completion[] = [];
        for (const key in scopeAtLocation) {
          const variable = scopeAtLocation[key];
          const type = variable.type;
          if (type.classTypeTypeData || type.interfaceTypeTypeData || type.moduleTypeData) {
            completions.push({ name: key });
          }
        }
        // Provide completions for builtin generic types
        completions.push({ name: 'Any' });
        completions.push({ name: 'Never' });
        completions.push({ name: 'Nil' });
        completions.push({ name: 'Bool' });
        completions.push({ name: 'Number' });
        completions.push({ name: 'String' });
        completions.push({ name: 'List' });
        completions.push({ name: 'Function' });
        return completions;
      },
    });

    // builtin types
    if (e.args.length === 0) {
      switch (e.identifier.name) {
        case 'Any': return AnyType;
        case 'Never': return NeverType;
        case 'Nil': return NilType;
        case 'Bool': return BoolType;
        case 'Number': return NumberType;
        case 'String': return StringType;
      }
    }
    if (e.args.length === 1 && e.identifier.name === 'List') {
      return this.solveType(e.args[0]).list();
    }
    if (e.args.length > 0 && e.identifier.name === 'Function') {
      const argTypes = e.args.map(arg => this.solveType(arg));
      const parameterTypes = argTypes.slice(0, argTypes.length - 1);
      const returnType = argTypes[argTypes.length - 1];
      return newFunctionType(parameterTypes, returnType);
    }

    // locally declared class or interface
    const variable = this.scope[e.identifier.name];
    if (!variable) {
      this.error(e.identifier.location, `Type ${e.identifier.name} not found`);
      return AnyType;
    }
    this.markReference(variable, e.identifier.location.range);
    const type = variable.type.classTypeTypeData?.classType ||
      variable.type.interfaceTypeTypeData?.interfaceType;
    if (!type) {
      this.error(e.identifier.location, `${e.identifier.name} is not a class or interface`);
      return AnyType;
    }
    return type;
  }

  solve(e: ast.TypeExpression): Type {
    const cached = this.typeSolverCache.get(e);
    if (cached) return cached;
    const type = this._solveType(e);
    this.typeSolverCache.set(e, type);
    return type;
  }
}
