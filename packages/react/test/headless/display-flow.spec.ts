// packages/react/test/headless/display-flow.spec.ts
import { describe, it, expect, vi } from 'vitest';
import {
  displayFlowReducer,
  initialDisplayState,
} from '../../src/headless/display-flow.js';

describe('displayFlowReducer', () => {
  it('initial state is hidden with copyCount=0', () => {
    expect(initialDisplayState.status).toBe('hidden');
    expect(initialDisplayState.copyCount).toBe(0);
    expect(initialDisplayState.revealedAt).toBeNull();
  });

  it('REVEAL transitions hidden → revealed', () => {
    const at = Date.now();
    const result = displayFlowReducer(initialDisplayState, {
      type: 'REVEAL',
      at,
    });
    expect(result.status).toBe('revealed');
    expect(result.revealedAt).toBe(at);
    expect(result.copyCount).toBe(0);
  });

  it('COPY from revealed sets copied with copyCount=1', () => {
    const state = displayFlowReducer(initialDisplayState, {
      type: 'REVEAL',
      at: Date.now(),
    });
    const result = displayFlowReducer(state, { type: 'COPY', at: Date.now() });
    expect(result.status).toBe('copied');
    expect(result.copyCount).toBe(1);
  });

  it('second COPY from copied does not change state', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = displayFlowReducer(initialDisplayState, {
      type: 'REVEAL',
      at: Date.now(),
    });
    const copied = displayFlowReducer(state, { type: 'COPY', at: Date.now() });
    const unchanged = displayFlowReducer(copied, { type: 'COPY', at: Date.now() });
    expect(unchanged).toBe(copied);
    expect(unchanged.copyCount).toBe(1);
    spy.mockRestore();
  });

  it('COPY from hidden does not change state', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unchanged = displayFlowReducer(initialDisplayState, {
      type: 'COPY',
      at: Date.now(),
    });
    expect(unchanged).toBe(initialDisplayState);
    spy.mockRestore();
  });

  it('DISMISS from revealed → dismissed', () => {
    const state = displayFlowReducer(initialDisplayState, {
      type: 'REVEAL',
      at: Date.now(),
    });
    const result = displayFlowReducer(state, { type: 'DISMISS' });
    expect(result.status).toBe('dismissed');
  });

  it('DISMISS from copied → dismissed', () => {
    const state = displayFlowReducer(
      displayFlowReducer(initialDisplayState, { type: 'REVEAL', at: Date.now() }),
      { type: 'COPY', at: Date.now() }
    );
    const result = displayFlowReducer(state, { type: 'DISMISS' });
    expect(result.status).toBe('dismissed');
  });

  it('RESET from any non-hidden state → initial', () => {
    const states = [
      displayFlowReducer(initialDisplayState, { type: 'REVEAL', at: Date.now() }),
      displayFlowReducer(
        displayFlowReducer(initialDisplayState, { type: 'REVEAL', at: Date.now() }),
        { type: 'COPY', at: Date.now() }
      ),
      displayFlowReducer(
        displayFlowReducer(initialDisplayState, { type: 'REVEAL', at: Date.now() }),
        { type: 'DISMISS' }
      ),
    ];
    for (const s of states) {
      const result = displayFlowReducer(s, { type: 'RESET' });
      expect(result).toEqual(initialDisplayState);
    }
  });

  it('invariant: copyCount never exceeds 1 on any transition', () => {
    let state = initialDisplayState;
    state = displayFlowReducer(state, { type: 'REVEAL', at: Date.now() });
    state = displayFlowReducer(state, { type: 'COPY', at: Date.now() });
    state = displayFlowReducer(state, { type: 'COPY', at: Date.now() });
    state = displayFlowReducer(state, { type: 'DISMISS' });
    state = displayFlowReducer(state, { type: 'RESET' });
    state = displayFlowReducer(state, { type: 'REVEAL', at: Date.now() });
    expect(state.copyCount).toBeLessThanOrEqual(1);
  });
});
