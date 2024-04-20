
type SymbolKind = "module" | "member";

export type Symbol = {
  readonly name: string;
  readonly uri: string;
  readonly kind: SymbolKind;
};

const nameToUriToSymbol = new Map<string, Map<string, Symbol>>();
const uriToNameToSymbol = new Map<string, Map<string, Symbol>>();

function getMapBySymbolName(symbolName: string): Map<string, Symbol> {
  const cached = nameToUriToSymbol.get(symbolName);
  if (cached) return cached;
  const map = new Map<string, Symbol>();
  nameToUriToSymbol.set(symbolName, map);
  return map;
}

function getMapByUri(uriString: string): Map<string, Symbol> {
  const cached = uriToNameToSymbol.get(uriString);
  if (cached) return cached;
  const map = new Map<string, Symbol>();
  uriToNameToSymbol.set(uriString, map);
  return map;
}

export function registerSymbol(name: string, uri: string, kind: SymbolKind) {
  const symbol = { name, uri, kind };
  getMapBySymbolName(name).set(uri, symbol);
  getMapByUri(uri).set(name, symbol);
}

export function removeUriFromSymbolRegistry(uri: string) {
  const symbols = uriToNameToSymbol.get(uri);
  if (symbols) {
    uriToNameToSymbol.delete(uri);
    for (const symbol of symbols.values()) {
      const uriToSymbol = nameToUriToSymbol.get(symbol.name);
      if (uriToSymbol) {
        uriToSymbol.delete(uri);
        if (uriToSymbol.size === 0) {
          nameToUriToSymbol.delete(symbol.name);
        }
      }
    }
  }
}

/** Maps symbols to a set containing Uri strings */
export function getSymbolTable() {
  return nameToUriToSymbol;
}
