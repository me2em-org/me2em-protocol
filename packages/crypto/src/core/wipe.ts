// packages/crypto/src/core/wipe.ts

/**
 * Securely overwrite a Uint8Array containing secret material.
 *
 * Two-pass wipe: random bytes first (defeats simple memory-dump
 * recovery of the original pattern), then zeros (defeats the dump
 * of the random pass).
 *
 * ⚠️ Honest limitation: JavaScript GC may retain copies of the
 * buffer (JIT optimization, closure capture). This function
 * mitigates casual memory inspection; it is NOT a guarantee
 * against a determined attacker with core-dump access. For
 * strong guarantees use non-extractable CryptoKey (WebCrypto)
 * or hardware-backed keys.
 *
 * @param array - The Uint8Array to overwrite. Modified in place.
 *
 * @example
 * ```ts
 * const seed = deriveFromMnemonic(words);
 * // ... use the seed
 * secureWipe(seed); // immediately before it goes out of scope
 * ```
 */
export function secureWipe(array: Uint8Array): void {
  if (array.length === 0) return;
  const noise = crypto.getRandomValues(new Uint8Array(array.length));
  array.set(noise);
  array.fill(0);
}

/**
 * Runs an async operation with secret bytes and wipes them
 * afterwards — even if the operation throws.
 *
 * Guarantees that `data` is zeroed in the `finally` block regardless
 * of whether `operation` succeeds or throws.
 *
 * @param data - Secret byte array to wipe after operation.
 * @param operation - Async function receiving the data.
 * @returns The result of the operation.
 * @throws Whatever the operation throws, after wiping `data`.
 *
 * @example
 * ```ts
 * const result = await withSecureWipe(privateKey, async (key) => {
 *   return await encrypt(payload, key);
 * });
 * // privateKey is wiped now
 * ```
 */
export async function withSecureWipe<T>(
  data: Uint8Array,
  operation: (data: Uint8Array) => Promise<T>
): Promise<T> {
  try {
    return await operation(data);
  } finally {
    secureWipe(data);
  }
}

/**
 * Securely wipes multiple byte arrays in sequence.
 *
 * @param arrays - Byte arrays to wipe. Each is modified in place.
 *
 * @example
 * ```ts
 * secureWipeMultiple(sessionKey, iv, tag);
 * ```
 */
export function secureWipeMultiple(...arrays: Uint8Array[]): void {
  for (const a of arrays) secureWipe(a);
}
