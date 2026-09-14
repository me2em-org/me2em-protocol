// packages/react/src/headless/display-flow.ts

export type DisplayStatus =
  | 'hidden'
  | 'revealed'
  | 'copied'
  | 'dismissed';

export interface DisplayState {
  status: DisplayStatus;
  copyCount: number;
  revealedAt: number | null;
}

export type DisplayEvent =
  | { type: 'REVEAL'; at: number }
  | { type: 'COPY'; at: number }
  | { type: 'DISMISS' }
  | { type: 'RESET' };

export const initialDisplayState: DisplayState = {
  status: 'hidden',
  copyCount: 0,
  revealedAt: null,
};

export function displayFlowReducer(
  state: DisplayState,
  event: DisplayEvent
): DisplayState {
  const { type } = event;

  switch (state.status) {
    case 'hidden': {
      if (type === 'REVEAL') {
        return {
          status: 'revealed',
          copyCount: 0,
          revealedAt: event.at,
        };
      }
      if (type === 'COPY') {
        console.warn('Cannot copy while hidden');
        return state;
      }
      if (type === 'RESET') {
        return initialDisplayState;
      }
      if (type === 'DISMISS') {
        console.warn('Cannot dismiss while hidden');
        return state;
      }
      console.warn(`Unexpected event ${type} in hidden`);
      return state;
    }

    case 'revealed': {
      if (type === 'COPY') {
        if (state.copyCount === 0) {
          return {
            status: 'copied',
            copyCount: 1,
            revealedAt: state.revealedAt,
          };
        }
        console.warn('Already copied — duplicate copy blocked');
        return state;
      }
      if (type === 'DISMISS') {
        return {
          status: 'dismissed',
          copyCount: state.copyCount,
          revealedAt: state.revealedAt,
        };
      }
      if (type === 'RESET') {
        return initialDisplayState;
      }
      console.warn(`Unexpected event ${type} in revealed`);
      return state;
    }

    case 'copied': {
      if (type === 'COPY') {
        console.warn('Already copied — duplicate copy blocked');
        return state;
      }
      if (type === 'DISMISS') {
        return {
          status: 'dismissed',
          copyCount: 1,
          revealedAt: state.revealedAt,
        };
      }
      if (type === 'RESET') {
        return initialDisplayState;
      }
      console.warn(`Unexpected event ${type} in copied`);
      return state;
    }

    case 'dismissed': {
      if (type === 'RESET') {
        return initialDisplayState;
      }
      console.warn(`Unexpected event ${type} in dismissed`);
      return state;
    }

    default:
      return state;
  }
}
