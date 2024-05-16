import * as ast from '../frontend/ast';

/**
 * Sorts a block of statements such that interfaces come in the "correct" order.
 * @param statements 
 */
export function sortInterfaces(statements: ast.Statement[]) {

  // check where everything is first
  const map = new Map<string, number>(); // maps interface names to their index in 'statements'
  for (let i = 0; i < statements.length; i++) {
    const defn = statements[i];
    if (defn instanceof ast.InterfaceDefinition) {
      map.set(defn.identifier.name, i);
    }
  }

  // extract dependencies, and determine if interfaces are all already topologically sorted
  const dmap = new Map<string, Set<string>>(); // dependency map
  {
    let ordered = true; // check to see if everything is already ordered (if so, we can exit early)
    for (const [name, index] of map) {
      const defn = statements[index] as ast.InterfaceDefinition;
      const deps = new Set<string>();
      dmap.set(name, deps);
      for (const base of defn.superTypes) {
        if (base instanceof ast.Typename && !base.qualifier && map.has(base.identifier.name)) {
          const dep = base.identifier.name;
          deps.add(dep);
          if (!dmap.has(dep)) ordered = false;
        }
      }
    }
    if (ordered) return;
  }

  // (naive) topological sort
  const sorted = topologicalSort(dmap);

  // Assign the nodes to their proper locations
  const nodes = sorted.map(name => statements[map.get(name)!]);
  Array.from(map.values()).map((index, i) => statements[index] = nodes[i]);
}

/**
 * Sorts a block of statements such that interfaces come in the "correct" order.
 * @param statements 
 */
export function sortTypedefs(statements: ast.Statement[]) {

  // check where everything is first
  const map = new Map<string, number>(); // maps typedef names to their index in 'statements'
  for (let i = 0; i < statements.length; i++) {
    const defn = statements[i];
    if (defn instanceof ast.Typedef) {
      map.set(defn.identifier.name, i);
    }
  }

  const extractor: ast.TypeExpressionVisitor<Generator<string, any, any>> = {
    visitTypename: function* (n: ast.Typename): Generator<string, any, any> {
      const name = n.identifier.name;
      if (!n.qualifier && map.has(name)) yield name;
    },
    visitSpecialTypeDisplay: function* (n: ast.SpecialTypeDisplay): Generator<string, any, any> {
      for (const arg of n.args) yield* arg.accept(extractor);
    },
    visitFunctionTypeDisplay: function* (n: ast.FunctionTypeDisplay): Generator<string, any, any> {
      for (const parameter of n.parameters) {
        const ptype = parameter.type;
        if (ptype) yield* ptype.accept(extractor);
      }
      if (n.returnType) yield* n.returnType.accept(extractor);
    }
  };

  // extract dependencies, and determine if typedefs are all already topologically sorted
  const dmap = new Map<string, Set<string>>(); // dependency map
  {
    let ordered = true; // check to see if everything is already ordered (if so, we can exit early)
    for (const [name, index] of map) {
      const defn = statements[index] as ast.Typedef;
      const deps = new Set(defn.type.accept(extractor));
      dmap.set(name, deps);
      for (const dep of deps) {
        if (!dmap.has(dep)) {
          ordered = false;
          break;
        }
      }
    }
    if (ordered) return;
  }

  // (naive) topological sort
  const sorted = topologicalSort(dmap);

  // Assign the nodes to their proper locations
  const nodes = sorted.map(name => statements[map.get(name)!]);
  Array.from(map.values()).map((index, i) => statements[index] = nodes[i]);
}

/** (naive) topological sort */
function topologicalSort(map: Map<string, Set<string>>) {
  const dmap = map;
  const sorted: string[] = [];
  while (true) {
    let change = false;
    for (const [name, deps] of dmap) {
      if (deps.size === 0) {
        change = true;
        sorted.push(name);
        dmap.delete(name);
        for (const otherDeps of dmap.values()) otherDeps.delete(name);
      }
    }
    if (!change) break; // either done, or there is a cycle
  }
  // If dmap is non-empty, there's a cycle.
  // But we still need to put these back in
  sorted.push(...dmap.keys());
  return sorted;
}
