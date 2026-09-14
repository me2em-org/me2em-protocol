// packages/react/test/headless/import-flow.spec.ts
import { describe, it, expect, vi } from 'vitest';
import {
  importFlowReducer,
  initImportState,
} from '../../src/headless/import-flow.js';
import { generateSeedPhrase } from '@me2em/core';

describe('importFlowReducer', () => {
  it('init 12 → words length 12, all null', () => {
    const state = initImportState(12);
    expect(state.expectedCount).toBe(12);
    expect(state.words.length).toBe(12);
    expect(state.words.every((w) => w === null)).toBe(true);
    expect(state.status).toBe('entering');
  });

  it('init 24 → words length 24', () => {
    const state = initImportState(24);
    expect(state.expectedCount).toBe(24);
    expect(state.words.length).toBe(24);
  });

  it('SET_WORD normalizes whitespace and case', () => {
    let state = initImportState(12);
    state = importFlowReducer(state, {
      type: 'SET_WORD',
      position: 0,
      word: '  ABANDON  ',
    });
    expect(state.words[0]).toBe('abandon');
  });

  it('SET_WORD out of bounds warns and keeps state', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = initImportState(12);
    const result = importFlowReducer(state, {
      type: 'SET_WORD',
      position: 99,
      word: 'abandon',
    });
    expect(result).toBe(state);
    spy.mockRestore();
  });

  it('CHECK with null position → invalid', () => {
    const state = initImportState(12);
    const result = importFlowReducer(state, { type: 'CHECK' });
    expect(result.status).toBe('invalid');
  });

  it('CHECK with valid phrase → valid', () => {
    const words = generateSeedPhrase(128);
    let state = initImportState(12);
    for (let i = 0; i < 12; i++) {
      state = importFlowReducer(state, {
        type: 'SET_WORD',
        position: i,
        word: words[i],
      });
    }
    state = importFlowReducer(state, { type: 'CHECK' });
    expect(state.status).toBe('valid');
  });

  it('CHECK with invalid checksum → invalid', () => {
    // Use the TEST_MNEMONIC but change one word to break checksum
    let state = initImportState(12);
    const words = [
      'abandon', 'ability', 'able', 'about', 'above', 'absent',
      'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
    ];
    // Replace last word with a valid word that breaks checksum
    words[11] = 'actor';
    for (let i = 0; i < 12; i++) {
      state = importFlowReducer(state, {
        type: 'SET_WORD',
        position: i,
        word: words[i],
      });
    }
    state = importFlowReducer(state, { type: 'CHECK' });
    expect(state.status).toBe('invalid');
  });

  it('SET_WORD after invalid → entering', () => {
    let state = initImportState(12);
    state = importFlowReducer(state, { type: 'CHECK' });
    expect(state.status).toBe('invalid');
    state = importFlowReducer(state, {
      type: 'SET_WORD',
      position: 0,
      word: 'abandon',
    });
    expect(state.status).toBe('entering');
  });

  it('RESET resets state', () => {
    let state = initImportState(12);
    state = importFlowReducer(state, {
      type: 'SET_WORD',
      position: 0,
      word: 'abandon',
    });
    state = importFlowReducer(state, { type: 'CHECK' });
    state = importFlowReducer(state, { type: 'RESET' });
    expect(state.status).toBe('entering');
    expect(state.words.every((w) => w === null)).toBe(true);
  });

  it('CLEAR_WORD sets position to null', () => {
    let state = initImportState(12);
    state = importFlowReducer(state, {
      type: 'SET_WORD',
      position: 0,
      word: 'abandon',
    });
    state = importFlowReducer(state, { type: 'CLEAR_WORD', position: 0 });
    expect(state.words[0]).toBeNull();
  });
});
