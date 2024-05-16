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

  // Assign the nodes to their proper locations
  const nodes = sorted.map(name => statements[map.get(name)!]);
  Array.from(map.values()).map((index, i) => statements[index] = nodes[i]);
}
