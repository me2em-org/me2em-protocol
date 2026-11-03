import type { IdentityFlowState, IdentityFlowEvent } from './types.js';

export const initialIdentityFlowState: IdentityFlowState = {
  status: 'idle',
  seedWords: null,
  identitySeed: null,
  error: null,
};

const UNEXPECTED_EVENTS: Record<string, string> = {
  CONFIRM_WORDS: 'CONFIRM_WORDS called from idle — no seed to confirm',
  DISCARD_SEED: 'DISCARD_SEED called from idle — no seed to discard',
  RESET: 'RESET called from idle — nothing to reset',
};

function flowFailure(event: Extract<IdentityFlowEvent, { type: 'FAIL' }>): IdentityFlowState {
  return {
    status: 'error',
    seedWords: null,
    identitySeed: null,
    // BL-50 (v1.1): structured failure — match on code, not message.
    error: { code: event.code ?? 'APP_FAILURE', message: event.message },
  };
}

export function identityFlowReducer(
  state: IdentityFlowState,
  event: IdentityFlowEvent
): IdentityFlowState {
  const { type } = event;

  switch (state.status) {
    case 'idle': {
      if (type === 'GENERATE') {
        return {
          status: 'seed-generated',
          seedWords: event.words,
          identitySeed: event.seed,
          error: null,
        };
      }
      if (type === 'IMPORT') {
        return {
          status: 'imported',
          seedWords: null,
          identitySeed: event.seed,
          error: null,
        };
      }
      if (type === 'FAIL') {
        return flowFailure(event);
      }
      if (UNEXPECTED_EVENTS[type]) {
        console.warn(UNEXPECTED_EVENTS[type]);
        return state;
      }
      return state;
    }

    case 'seed-generated': {
      if (type === 'CONFIRM_WORDS') {
        return {
          status: 'verified',
          seedWords: null,
          identitySeed: state.identitySeed,
          error: null,
        };
      }
      if (type === 'FAIL') {
        return flowFailure(event);
      }
      if (type === 'RESET') {
        return initialIdentityFlowState;
      }
      console.warn(`Unexpected event ${type} in seed-generated`);
      return state;
    }

    case 'verified':
    case 'imported': {
      if (type === 'DISCARD_SEED') {
        // BL-48 (v1.1): drop the retained seed material on the app's
        // explicit request. The buffer itself is not zeroed (mixed
        // caller/library ownership, R6); the flow simply stops holding
        // a reference, making the bytes GC-eligible.
        return { ...state, identitySeed: null };
      }
      if (type === 'RESET') {
        return initialIdentityFlowState;
      }
      if (type === 'FAIL') {
        return flowFailure(event);
      }
      console.warn(`Unexpected event ${type} in ${state.status}`);
      return state;
    }

    case 'error': {
      if (type === 'RESET') {
        return initialIdentityFlowState;
      }
      console.warn(`Unexpected event ${type} in error`);
      return state;
    }

    default:
      return state;
  }
}
