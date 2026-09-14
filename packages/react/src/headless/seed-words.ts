// packages/react/src/headless/seed-words.ts

export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let currentSeed = seed;
  function nextRand(): number {
    currentSeed = (currentSeed * 1664525 + 1013904223) >>> 0;
    return currentSeed;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextRand() % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildVerificationGrid(
  realWords: string[],
  gridSize: number,
  randomSeed: number,
  allWords: readonly string[]
): { words: string[]; correctIndices: number[] } {
  if (gridSize < realWords.length) {
    throw new Error(
      `gridSize (${gridSize}) must be >= realWords.length (${realWords.length})`
    );
  }

  const shuffled = shuffleWithSeed(realWords, randomSeed);
  const realSet = new Set(realWords);
  const available = allWords.filter((w) => !realSet.has(w));
  const shuffledDecoys = shuffleWithSeed(available, randomSeed + 1);

  const needed = gridSize - realWords.length;
  const decoys = shuffledDecoys.slice(0, needed);

  const words = [...shuffled, ...decoys];
  if (words.length !== gridSize) {
    throw new Error(
      `Cannot fill grid: wordlist too small (got ${words.length}, need ${gridSize})`
    );
  }

  // Map each word occurrence to a DISTINCT grid position, so
  // repeated words in the phrase get their own cells.
  const positions = new Map<string, number[]>();
  words.forEach((w, i) => {
    const list = positions.get(w);
    if (list) list.push(i);
    else positions.set(w, [i]);
  });

  const correctIndices = realWords.map((w) => {
    const list = positions.get(w);
    if (!list || list.length === 0) {
      throw new Error(`Internal error: word "${w}" missing from grid`);
    }
    return list.shift() as number;
  });

  return { words, correctIndices };
}

/**
 * Selection is compared IN ORDER: selected[i] must equal
 * correctIndices[i]. The i-th click must be the i-th word of the
 * phrase. Repeated phrase words map to distinct grid cells.
 */
export function isGridSelectionCorrect(
  grid: { words: string[]; correctIndices: number[] },
  selected: number[]
): boolean {
  if (selected.length !== grid.correctIndices.length) return false;
  return selected.every((v, i) => v === grid.correctIndices[i]);
}
