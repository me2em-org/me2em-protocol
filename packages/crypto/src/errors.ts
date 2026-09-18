// packages/crypto/src/errors.ts

export type CryptoErrorCode =
  | 'INVALID_LENGTH'
  | 'INVALID_KEY'
  | 'INVALID_SALT'
  | 'INVALID_IV'
  | 'INVALID_ARGUMENT'
  | 'DERIVATION_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'SIGNATURE_FAILED'
  | 'VERIFICATION_FAILED'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_ALGORITHM';

export type CryptoErrorLevel = 'KEY' | 'CIPHER' | 'SIGNATURE' | 'KDF' | 'FORMAT' | 'IDENTITY';

export class CryptoError extends Error {
  constructor(
    public readonly code: CryptoErrorCode,
    public readonly level: CryptoErrorLevel,
    message: string
  ) {
    super(`[${level}/${code}] ${message}`);
    this.name = 'CryptoError';
  }
}

export function throwCryptoError(
  code: CryptoErrorCode,
  level: CryptoErrorLevel,
  message: string
): never {
  throw new CryptoError(code, level, message);
}
