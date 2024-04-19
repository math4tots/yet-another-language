
const symbolToUriSet = new Map<string, Set<string>>();
const uriToSymbolsSet = new Map<string, Set<string>>();

function getSetForSymbol(symbol: string): Set<string> {
  const cached = symbolToUriSet.get(symbol);
  if (cached) return cached;
  const set = new Set<string>();
  symbolToUriSet.set(symbol, set);
  return set;
}

function getSetForUri(uriString: string): Set<string> {
  const cached = uriToSymbolsSet.get(uriString);
  if (cached) return cached;
  const set = new Set<string>();
  uriToSymbolsSet.set(uriString, set);
  return set;
}

export function registerSymbol(symbol: string, uriString: string) {
  getSetForSymbol(symbol).add(uriString);
  getSetForUri(uriString).add(symbol);
}

export function removeUriFromSymbolRegistry(uriString: string) {
  const symbols = uriToSymbolsSet.get(uriString);
  if (symbols) {
    uriToSymbolsSet.delete(uriString);
    for (const symbol of symbols) {
      const uriSet = symbolToUriSet.get(symbol);
      if (uriSet) {
        uriSet.delete(uriString);
        if (uriSet.size === 0) {
          symbolToUriSet.delete(symbol);
        }
      }
    }
  }
}

/** Maps symbols to a set containing Uri strings */
export function getSymbolTable() {
  return symbolToUriSet;
}
