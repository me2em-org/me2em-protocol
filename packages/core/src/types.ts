// types.ts
//
// Cross-cutting public interfaces of @me2em/core that are not tied to a
// single class file (PLAN-LTS-v1 PR-6, task 1.2 / DR D2).

/**
 * An object capable of producing Ed25519 signatures.
 *
 * The normative v1.0 issuance contract (specs/v1.0.md §8): raw private
 * keys never cross a trust boundary as function arguments —
 * `Attestation.issue` accepts a `Signer`, not key bytes. `Identity` and
 * `Handle` implement this interface; custom implementations (e.g.
 * remote- or HSM-backed signing) are accepted structurally — no
 * inheritance from a base class is required.
 *
 * @category Types
 */
export interface Signer {
  /**
   * Signs `data` with the signer's own private key.
   *
   * @param data - The bytes to sign.
   * @returns A promise resolving to the 64-byte Ed25519 signature.
   */
  sign(data: Uint8Array): Promise<Uint8Array>;
}
