# Changelog

## [1.0.0-rc.1] — 2026-11-17

M1: the x402 v2 transport (ТЗ `@me2em/x402` v1.2). New package — pure
transport, no policy: attestation and Pact decisions stay with the
application. No runtime dependencies; `@me2em/core` is a peer
(`>=1.0.0-rc.8` — the settle-guard fix rc.7 plus the `PaymentSigner`
contract, which moved from this package into core rc.8).

### Added
- **Codec** (`codec.ts`) — base64-JSON for `PAYMENT-REQUIRED` /
  `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` (x402 v2). Decode validates
  against the core structural guards and fails closed:
  `…_MALFORMED` codes, `VERSION_UNSUPPORTED` for well-formed JSON with
  `x402Version !== 2`; header limit 8 KiB (configurable
  `maxHeaderBytes`) — encode overflow → `TypeError`, decode overflow →
  `…_MALFORMED`. Padding-less base64 accepted.
- **Client** (`client.ts`) — `createPaymentFetch` (signer injected;
  default selection by `capabilities`; `NO_VIABLE_OPTION`;
  `SIGNER_REJECTED` with `details.cause`; exactly one paid attempt —
  no retry after `PAYMENT-SIGNATURE`) and `readSettlement` (`null` /
  parsed / throws `PAYMENT_RESPONSE_MALFORMED` — a broken settlement is
  never treated as "no settlement").
- **Server helpers** (`server.ts`) — `paymentRequiredResponse`,
  `readPaymentHeader` (`RESOURCE_MISMATCH` on a resource mismatch),
  `settlementHeader`; `X402Config` + `assertValidX402Config`
  (fail-fast `X402ConfigError`, `code: 'CONFIG_INVALID'`; unknown enums
  fail closed; `stateless` + a real regulatory profile is a
  contradiction). Declaration only — x402 never enforces per payment.
- **`extra.me2em`** (`me2em-extra.ts`) — `withMe2emExtra` (nested-key
  merge; reserved x402 keys untouched), `readMe2emExtra` (fail-tolerant
  → `null` on anything malformed), `X402_RESERVED_EXTRA_KEYS`. Core's
  `Me2emExtra` (application, `Uint8Array`) vs wire `X402Me2emExtra`
  (base64, `sellerId` required) — two formats, two names.
- **`FacilitatorClient`** contract (`facilitator.ts`) + **`B402Facilitator`**
  (`b402.ts`, subpath `./b402`, `@experimental` — the final B402
  contract is pending, ТЗ §8): auth injected per request (JWT rotation),
  per-request timeout (default 10 s), fail-closed
  `FACILITATOR_ERROR` with `details: { phase, kind }` — kinds
  `network | timeout | http_5xx | http_4xx | auth | invalid_response`
  (the last two are an M1 amendment to the ТЗ §3.5 kind list: client
  error statuses and non-conforming bodies must also fail closed).
  The main entry does not import `b402.ts`.
- **Golden vectors** — verbatim examples of the upstream x402 v2
  specification (`x402-foundation/x402` @ `51a0664c`, 2026-10-26) in
  `test/fixtures/spec-vectors.json`.
- **dist-artifact spec** — main entry stays transport-only (no B402);
  `@me2em/core` stays external (guards are not inlined).

### Notes
- Peer floor `@me2em/core >=1.0.0-rc.8`: `isX402SettleResponse` must
  accept the upstream §5.3.2 empty-transaction failure settles (fixed
  in core rc.7; spotted by these golden vectors), and the
  `PaymentSigner`/`SignerCapability` contract moved into core rc.8 —
  the client imports it from core and re-exports both types, so
  existing `@me2em/x402` imports keep working.
- x402 v1 payloads and non-CAIP-2 networks are refused (fail-closed).
- `SETTLEMENT_FAILED` is thrown by the application on
  `success: false` — the facilitator client returns the response as-is.
