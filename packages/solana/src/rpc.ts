// packages/solana/src/rpc.ts
//
// Minimal JSON-RPC 2.0 client for Solana (Ф4).
//
// Supports three RPC methods used by `verifyPayment`:
// - `getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' })`
// - `getSignaturesForAddress(address, { limit: 100, commitment: 'confirmed' })`
// - `getAccountInfo(address, { encoding: 'base64' })`
//
// Error contract: any JSON-RPC error (`{ error: { code, message } }`),
// network failure, or timeout throws a bare `Error` — never returns
// a `PaymentResult`. The caller is responsible for retry logic.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A JSON-RPC 2.0 error response. */
interface RpcError {
  readonly code: number;
  readonly message: string;
}

/** A JSON-RPC 2.0 response (success or error). */
interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: RpcError;
}

/**
 * Parsed `getTransaction` response — the shape returned by the Solana
 * RPC with `encoding: 'jsonParsed'`. Only the fields we consume are
 * typed; the rest is `unknown`.
 *
 * Note: `instructions` is intentionally not typed here — it is
 * added by the adapter layer (`ParsedTransactionWithInstructions`)
 * because the RPC response shape varies between v0/v1 transactions.
 */
export interface ParsedTransactionResponse {
  /** `null` when the transaction is not found. */
  readonly transaction: {
    readonly message: {
      readonly accountKeys: readonly {
        readonly pubkey: string;
        readonly signer: boolean;
        readonly writable: boolean;
        readonly source: string;
      }[];
      readonly addressTableLookups?: readonly {
        readonly accountKey: string;
        readonly readonlyIndexes: readonly number[];
        readonly writableIndexes: readonly number[];
      }[];
    };
    readonly signatures: readonly string[];
  };
  readonly meta?: {
    readonly loadedAddresses?: {
      readonly writable: readonly string[];
      readonly readonly: readonly string[];
    };
    readonly blockTime?: number | null;
  };
  /** The transaction version (0 = legacy/v0, 1 = v1). */
  readonly version?: number | string;
}

/**
 * A signature info entry returned by `getSignaturesForAddress`.
 */
export interface SignatureInfo {
  readonly signature: string;
  readonly slot: number;
  readonly err: unknown;
  readonly memo: string | null;
  readonly blockTime: number | null;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
}

/**
 * Base64-decoded LUT account data: a resolved list of pubkey addresses
 * (each 32 bytes, base58-encoded).
 */
export type LutAddresses = readonly Uint8Array[];

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Options for the JSON-RPC client.
 */
export interface RpcClientOptions {
  /** RPC endpoint URL. */
  readonly endpoint: string;
  /** Fetch implementation (default: `globalThis.fetch`). */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A minimal JSON-RPC 2.0 client for Solana RPC methods.
 *
 * All public methods throw a bare `Error` on JSON-RPC errors, network
 * failures, or timeouts — never return `null` or a sentinel for errors
 * (except where explicitly documented, e.g. `getTransaction` returning
 * `null` for NOT_FOUND).
 */
export class RpcClient {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #id = { value: 0 };

  constructor(opts: RpcClientOptions) {
    this.#endpoint = opts.endpoint;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  #nextId(): number {
    return ++this.#id.value;
  }

  /**
   * Send a JSON-RPC 2.0 request. Throws on network errors or
   * JSON-RPC error responses.
   */
  async #request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.#nextId(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `RPC ${method} HTTP ${response.status}: ${response.statusText}`
      );
    }

    const body: RpcResponse<T> = await response.json();

    if (body.error) {
      throw new Error(
        `RPC ${method} error [code ${body.error.code}]: ${body.error.message}`
      );
    }

    if (body.result === undefined) {
      throw new Error(`RPC ${method}: empty result`);
    }

    return body.result;
  }

  /**
   * Fetch a transaction by signature.
   *
   * Returns `null` when the transaction is not found (RPC returns
   * `{ result: null }`). Throws on network/JSON-RPC errors.
   *
   * Parameters: `encoding: 'jsonParsed'`,
   * `maxSupportedTransactionVersion: 1`, `commitment: 'confirmed'`.
   */
  async getTransaction(
    signature: string
  ): Promise<ParsedTransactionResponse | null> {
    const result = await this.#request<ParsedTransactionResponse | null>(
      'getTransaction',
      [
        signature,
        {
          encoding: 'jsonParsed' as const,
          maxSupportedTransactionVersion: 1,
          commitment: 'confirmed' as const,
        },
      ]
    );
    return result;
  }

  /**
   * Get signatures for an address (forward search).
   *
   * Returns at most `limit` signatures, filtered to
   * `confirmed`/`finalized` status.
   */
  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number }
  ): Promise<SignatureInfo[]> {
    const limit = options?.limit ?? 100;
    const result = await this.#request<{ signatures: SignatureInfo[] }>(
      'getSignaturesForAddress',
      [
        address,
        {
          limit,
          commitment: 'confirmed' as const,
        },
      ]
    );
    return result.signatures;
  }

  /**
   * Fetch an account's data. Returns `null` when the account does not
   * exist.
   *
   * Encoding: `base64`.
   */
  async getAccountInfo(
    address: string
  ): Promise<{ data: [string, string]; owner: string } | null> {
    const result = await this.#request<
      { data: [string, string]; owner: string } | null
    >('getAccountInfo', [address, { encoding: 'base64' as const }]);
    return result;
  }

  /**
   * Fetch the latest blockhash and the last block height it remains
   * valid for (`pay` builds the transaction lifetime from it — a fresh
   * blockhash per call, no injection, В-7/A). Commitment: `confirmed`.
   */
  async getLatestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const result = await this.#request<{
      value: { blockhash: string; lastValidBlockHeight: number } | null;
    }>('getLatestBlockhash', [{ commitment: 'confirmed' as const }]);
    if (result === null || result.value === null) {
      throw new Error('RPC getLatestBlockhash: empty result');
    }
    return result.value;
  }

  /**
   * Submit a base64-encoded signed transaction. Returns the
   * transaction signature. `skipPreflight: false` — the preflight
   * simulation rejects (and therefore throws on) transactions that
   * would obviously fail (e.g. insufficient funds). No confirmation
   * wait — checking execution is `verifyPayment`'s job.
   */
  async sendTransaction(wireBase64: string): Promise<string> {
    const result = await this.#request<string>('sendTransaction', [
      wireBase64,
      {
        encoding: 'base64' as const,
        skipPreflight: false,
        preflightCommitment: 'confirmed' as const,
      },
    ]);
    if (typeof result !== 'string' || result.length === 0) {
      throw new Error('RPC sendTransaction: empty signature');
    }
    return result;
  }
}
