export function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? left.length;
}

export function fuzzyToken(tokens: readonly string[], targets: readonly string[]): boolean {
  return tokens.some((token) => targets.some((target) => {
    if (token === target || token.includes(target) || (target.includes(token) && token.length >= 5)) return true;
    const tolerance = target.length >= 9 ? 2 : 1;
    return token.length >= 4 && Math.abs(token.length - target.length) <= tolerance
      && editDistance(token, target) <= tolerance;
  }));
}

export function tokenize(message: string): string[] {
  return message
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

/** Typo-tolerant replacement for `\b(?:word1|word2)\b` intent regexes: catches near-misses like "producty" for "product". */
export function fuzzyIntent(message: string, targets: readonly string[]): boolean {
  return fuzzyToken(tokenize(message), targets);
}
