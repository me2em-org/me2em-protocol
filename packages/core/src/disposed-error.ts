// disposed-error.ts
//
// Thrown by Identity/Handle/SubHandle methods that require key material
// after the object has been disposed. Informational getters (name, path,
// public key, metadata) deliberately keep working after dispose() — only
// capabilities are revoked.

/**
 * Thrown when a method that requires key material is called on an
 * {@link Identity} or a {@link Handle}/{@link SubHandle} that has been
 * disposed via {@link Identity.dispose} / {@link Handle.dispose}.
 *
 * The private key bytes are zeroized by `dispose()`; calling a capability
 * method afterwards is always a programming error, never a recoverable
 * state — match on `e.name === 'DisposedError'` (or `instanceof`).
 *
 * @category Errors
 */
export class DisposedError extends Error {
  /** Name of the disposed class, e.g. `'Identity'`, `'Handle'`, `'SubHandle'`. */
  public readonly className: string;

  /**
   * @param className - Name of the disposed class, used in the message and
   *   exposed as {@link DisposedError.className}.
   */
  constructor(className: string) {
    super(`${className} has been disposed; its key material has been zeroized`);
    this.name = 'DisposedError';
    this.className = className;
  }
}
