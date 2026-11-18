// packages/x402/src/b402.ts — subpath `./b402`
//
// `B402Facilitator` — the first `FacilitatorClient` implementation: an
// HTTP client to an external B402 service (ТЗ @me2em/x402 v1.2 §3.5).
// The endpoint request shape follows the x402 v2 specification §7
// (`{ x402Version, paymentPayload, paymentRequirements }`; GET
// `/supported`); the final B402 contract is pending (ТЗ §8) — hence
// `@experimental`. The main entry `@me2em/x402` does NOT import this
// module: transport users never pull a concrete facilitator.
//
// Fail-closed (ТЗ §3.5): an auth failure, network error, timeout, 4xx /
// 5xx or a non-conforming response body all throw `X402Error` with
// `code: 'FACILITATOR_ERROR'` and `details: { phase, kind }` — never a
// success. `settle` returns the response as-is (including
// `success: false`) — throwing `SETTLEMENT_FAILED` is the application's
// decision (ТЗ §3.5).

import {
  X402_VERSION,
  isX402SettleResponse,
  isX402Supported,
  isX402VerifyResponse,
  type X402PaymentPayload,
  type X402PaymentRequirements,
  type X402SettleResponse,
  type X402Supported,
  type X402VerifyResponse,
} from '@me2em/core';
import { X402Error } from './errors.js';
import type {
  FacilitatorAuth,
  FacilitatorClient,
  FacilitatorFailureKind,
  FacilitatorOptions,
  FacilitatorPhase,
} from './facilitator.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Upstream §7.1/§7.2 request body for /verify and /settle. */
interface VerifySettleBody {
  readonly x402Version: typeof X402_VERSION;
  readonly paymentPayload: X402PaymentPayload;
  readonly paymentRequirements: X402PaymentRequirements;
}

/**
 * HTTP client to a B402 facilitator. `@experimental` until the final
 * B402 contract arrives (ТЗ §8).
 */
export class B402Facilitator implements FacilitatorClient {
  readonly #baseUrl: string;
  readonly #auth: FacilitatorAuth;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(opts: FacilitatorOptions) {
    if (typeof opts.baseUrl !== 'string' || opts.baseUrl.length === 0) {
      throw new TypeError(`B402Facilitator: baseUrl must be an absolute http(s) URL, got ${JSON.stringify(opts.baseUrl)}`);
    }
    try {
      const parsed = new URL(opts.baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError(`B402Facilitator: baseUrl must be an http(s) URL, got ${JSON.stringify(opts.baseUrl)}`);
      }
    } catch {
      throw new TypeError(`B402Facilitator: baseUrl must be an absolute http(s) URL, got ${JSON.stringify(opts.baseUrl)}`);
    }
    const auth = opts.auth as Partial<FacilitatorAuth> | undefined;
    if (
      !auth ||
      typeof auth !== 'object' ||
      auth.headers === undefined ||
      (typeof auth.headers !== 'function' && (typeof auth.headers !== 'object' || auth.headers === null))
    ) {
      throw new TypeError('B402Facilitator: opts.auth.headers must be a record or a header factory');
    }
    if (opts.timeoutMs !== undefined && (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)) {
      throw new TypeError(`B402Facilitator: timeoutMs must be a positive finite number, got ${String(opts.timeoutMs)}`);
    }
    if (opts.fetch !== undefined && typeof opts.fetch !== 'function') {
      throw new TypeError('B402Facilitator: opts.fetch must be a function when present');
    }
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#auth = opts.auth;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = opts.fetch ?? fetch.bind(globalThis);
  }

  /** GET `${baseUrl}/supported` (upstream §7.3). */
  async supported(): Promise<X402Supported> {
    return this.#exchange('supported', 'GET', undefined, isX402Supported);
  }

  /** POST `${baseUrl}/verify` (upstream §7.1). */
  async verify(
    requirements: X402PaymentRequirements,
    payload: X402PaymentPayload
  ): Promise<X402VerifyResponse> {
    return this.#exchange(
      'verify',
      'POST',
      { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements },
      isX402VerifyResponse
    );
  }

  /** POST `${baseUrl}/settle` (upstream §7.2). */
  async settle(
    requirements: X402PaymentRequirements,
    payload: X402PaymentPayload
  ): Promise<X402SettleResponse> {
    return this.#exchange(
      'settle',
      'POST',
      { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements },
      isX402SettleResponse
    );
  }

  /** Resolves the auth headers — the factory is called on EVERY request. */
  async #resolveAuthHeaders(phase: FacilitatorPhase): Promise<Record<string, string>> {
    const raw = this.#auth.headers;
    if (typeof raw !== 'function') return { ...raw };
    let resolved: unknown;
    try {
      resolved = await raw();
    } catch (e) {
      throw new X402Error('FACILITATOR_ERROR', 'auth header factory failed', {
        phase,
        kind: 'auth' satisfies FacilitatorFailureKind,
        cause: e,
      });
    }
    if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new X402Error('FACILITATOR_ERROR', 'auth header factory returned a non-record', {
        phase,
        kind: 'auth' satisfies FacilitatorFailureKind,
      });
    }
    return resolved as Record<string, string>;
  }

  async #exchange<T>(
    phase: FacilitatorPhase,
    method: 'GET' | 'POST',
    body: VerifySettleBody | undefined,
    check: (v: unknown) => v is T
  ): Promise<T> {
    let response: Response;
    let text: string;
    try {
      const headers = new Headers(await this.#resolveAuthHeaders(phase));
      headers.set('accept', 'application/json');
      if (body !== undefined) headers.set('content-type', 'application/json');
      response = await this.#fetch(`${this.#baseUrl}/${phase}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      text = await response.text();
    } catch (e) {
      if (e instanceof X402Error) throw e; // auth failures keep their kind — never remapped to network
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new X402Error('FACILITATOR_ERROR', `facilitator ${phase} timed out after ${this.#timeoutMs}ms`, {
          phase,
          kind: 'timeout' satisfies FacilitatorFailureKind,
          cause: e,
        });
      }
      throw new X402Error('FACILITATOR_ERROR', `facilitator ${phase} network failure`, {
        phase,
        kind: 'network' satisfies FacilitatorFailureKind,
        cause: e,
      });
    }
    if (!response.ok) {
      const kind: FacilitatorFailureKind =
        response.status >= 500 ? 'http_5xx' : response.status === 401 || response.status === 403 ? 'auth' : 'http_4xx';
      throw new X402Error('FACILITATOR_ERROR', `facilitator ${phase} responded ${response.status}`, {
        phase,
        kind,
        status: response.status,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (e) {
      throw new X402Error('FACILITATOR_ERROR', `facilitator ${phase} returned a non-JSON body`, {
        phase,
        kind: 'invalid_response' satisfies FacilitatorFailureKind,
        cause: String(e),
      });
    }
    if (!check(parsed)) {
      throw new X402Error('FACILITATOR_ERROR', `facilitator ${phase} response does not conform to the x402 v2 shape`, {
        phase,
        kind: 'invalid_response' satisfies FacilitatorFailureKind,
      });
    }
    return parsed;
  }
}
