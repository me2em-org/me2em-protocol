
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
    throw new Error(`gridSize (${gridSize}) must be >= realWords.length (${realWords.length})`);
  }

  const shuffled = shuffleWithSeed(realWords, randomSeed);
  const realSet = new Set(realWords);
  const available = allWords.filter((w) => !realSet.has(w));
  const shuffledDecoys = shuffleWithSeed(available, randomSeed + 1);

  const needed = gridSize - realWords.length;
  const decoys = shuffledDecoys.slice(0, needed);

  const words = [...shuffled, ...decoys];
  const wordSet = new Set(words);
  const correctIndices = realWords
    .map((w) => words.indexOf(w))
    .sort((a, b) => a - b);

  return { words, correctIndices };
}

export function isGridSelectionCorrect(
  grid: { words: string[]; correctIndices: number[] },
  selected: number[]
): boolean {
  if (selected.length !== grid.correctIndices.length) return false;
  const sortedSel = [...selected].sort((a, b) => a - b);
  const sortedCorr = [...grid.correctIndices].sort((a, b) => a - b);
  return sortedSel.every((v, i) => v === sortedCorr[i]);
}
