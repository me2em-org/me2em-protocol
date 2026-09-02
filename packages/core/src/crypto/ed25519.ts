import { ed } from './init.js';

/**
 * @internal
 * Low-level Ed25519 implementation wrapper.
 */
export const getPublicKey = ed.getPublicKey;
export const sign = ed.sign;
export const verify = ed.verify;
export const getPublicKeyAsync = ed.getPublicKeyAsync;
export const signAsync = ed.signAsync;
export const verifyAsync = ed.verifyAsync;