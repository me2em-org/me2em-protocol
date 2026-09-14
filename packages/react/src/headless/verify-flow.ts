// packages/react/src/headless/verify-flow.ts
import {
  buildVerificationGrid,
  isGridSelectionCorrect,
} from './seed-words.js';

export type VerifyStatus = 'collecting' | 'correct' | 'incorrect';

export interface VerifyState {
  status: VerifyStatus;
  grid: { words: string[]; correctIndices: number[] };
  selected: number[];
  attempts: number;
}

export type VerifyEvent =
  | { type: 'SELECT'; index: number }
  | { type: 'DESELECT'; index: number }
  | { type: 'CHECK' }
  | {
      type: 'RESET';
      realWords: string[];
      gridSize: number;
      randomSeed: number;
      allWords: readonly string[];
    };

export function initVerifyState(
  realWords: string[],
  gridSize: number,
  randomSeed: number,
  allWords: readonly string[]
): VerifyState {
  const grid = buildVerificationGrid(realWords, gridSize, randomSeed, allWords);
  return {
    status: 'collecting',
    grid,
    selected: [],
    attempts: 0,
  };
}

export function verifyFlowReducer(
  state: VerifyState,
  event: VerifyEvent
): VerifyState {
  const { type } = event;

  if (type === 'RESET') {
    return initVerifyState(
      event.realWords,
      event.gridSize,
      event.randomSeed,
      event.allWords
    );
  }

  // Terminal states: only RESET allowed
  if (state.status === 'correct' || state.status === 'incorrect') {
    console.warn(
      `Cannot ${type} in ${state.status} state — use RESET to retry`
    );
    return state;
  }

  // collecting state
  if (type === 'SELECT') {
    const { index } = event;
    const { grid, selected } = state;
    if (selected.includes(index)) {
      console.warn(`Index ${index} already selected — use DESELECT`);
      return state;
    }
    if (index < 0 || index >= grid.words.length) {
      console.warn(`Index ${index} out of grid bounds`);
      return state;
    }
    return { ...state, selected: [...selected, index] };
  }

  if (type === 'DESELECT') {
    const { index } = event;
    const idx = state.selected.indexOf(index);
    if (idx === -1) {
      console.warn(`Index ${index} not selected`);
      return state;
    }
    return {
      ...state,
      selected: state.selected.filter((_, i) => i !== idx),
    };
  }

  if (type === 'CHECK') {
    const { grid, selected, attempts } = state;
    if (selected.length !== grid.correctIndices.length) {
      console.warn(
        `Cannot check: selected ${selected.length}, need ${grid.correctIndices.length}`
      );
      return state;
    }
    const correct = isGridSelectionCorrect(grid, selected);
    return {
      ...state,
      status: correct ? 'correct' : 'incorrect',
      attempts: attempts + 1,
    };
  }

  console.warn(`Unexpected event ${type} in collecting`);
  return state;
}
