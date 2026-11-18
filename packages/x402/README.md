[![npm version](https://img.shields.io/npm/v/@me2em/x402.svg)](https://www.npmjs.com/package/@me2em/x402)
[![License](https://img.shields.io/npm/l/@me2em/x402.svg)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-x402.me2em.com-blue)](https://x402.me2em.com)

# @me2em/x402

x402 v2 payment transport for the Me2eM payment layer: the base64 header codec (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`), a payment-aware `fetch` client, server helpers, the facilitator contract and the Me2eM `extra.me2em` extension.

x402 is **transport, not policy**: who pays is attestation / Pact, how much is `PaymentRequest`, how it executes is a `PaymentAdapter` (`@me2em/solana`), who confirms is the facilitator. This package moves the signed artifacts over HTTP — nothing else. Everything is fail-closed: an unknown version, scheme, network or error reason is always a refusal, never a success.

## Status

**M1 release (rc.1).** Codec, client, server helpers, `extra.me2em`, the `FacilitatorClient` contract and `B402Facilitator` (opt-in subpath, `@experimental`) are shipped. The Solana `PaymentSigner` arrives in `@me2em/solana` `1.1.0-rc.1` (M2). x402 v1 is not supported.

## Install

```sh
pnpm add @me2em/x402 @me2em/core
```

> 💡 `@me2em/core` is a **peer** dependency (`>=1.0.0-rc.7 <2.0.0-0`) — the x402 wire types, the structural guards and the error codes live there. The floor is rc.7 because `isX402SettleResponse` accepts the upstream §5.3.2 empty-transaction failure settles only since then. There are **no runtime dependencies** — the transport uses the global `fetch` (Node ≥ 22.6, browsers). `B402Facilitator` is opt-in: `import { B402Facilitator } from '@me2em/x402/b402'` — the main entry stays free of any concrete facilitator.

## Client — pay for a resource

```ts
import { createPaymentFetch, readSettlement, type PaymentSigner } from '@me2em/x402';

const signer: PaymentSigner = {
  capabilities: [{ scheme: 'exact', network: 'solana:devnet' }],
  async signPayment(requirements, resource) {
    // chain-specific signing — e.g. @me2em/solana's SolanaX402Signer (M2)
    return myWallet.signTransfer(requirements, resource);
  },
};

const pay = createPaymentFetch({ signer });
const res = await pay('https://api.example.com/premium-data');
if (res.status === 402) throw new Error('payment refused — see the 402 body');

const settle = readSettlement(res); // null | X402SettleResponse (throws on a broken header)
if (settle && !settle.success) {
  throw new Error(`settlement failed: ${settle.errorReason}`);
}
```

Behavior: a 200 or any non-402 response passes through untouched; a 402 with a parseable `PAYMENT-REQUIRED` selects the first option covered by `signer.capabilities` (or your `selectRequirements`), signs it and replays **exactly once** with `PAYMENT-SIGNATURE` — the wrapper never retries after the payment attempt, so you can never pay twice by accident. Errors: `PAYMENT_REQUIRED_MALFORMED`, `VERSION_UNSUPPORTED`, `NO_VIABLE_OPTION`, `SIGNER_REJECTED` (the original error rides in `details.cause`).

## Server — sell a resource

```ts
import {
  paymentRequiredResponse, readPaymentHeader, settlementHeader,
  assertValidX402Config, type X402Config,
} from '@me2em/x402';
import { B402Facilitator } from '@me2em/x402/b402';

const config: X402Config = {
  facilitator: new B402Facilitator({
    baseUrl: process.env.B402_URL!,              // §8 of the ТЗ — pending, @experimental
    auth: { headers: () => ({ authorization: `Bearer ${getJwt()}` }) },
  }),
  mode: 'pact-aware',
  regulatoryProfile: 'none',
};
assertValidX402Config(config); // once at startup — X402ConfigError (TypeError) on contradictions

server.on('GET /premium-data', async (req) => {
  const payload = readPaymentHeader(req.headers, 'https://api.example.com/premium-data');
  if (!payload) return paymentRequiredResponse(buildPaymentRequired()); // 402 + header

  // your checks: accepted ∈ accepts[], attestation policy, Pact (agreementProof)…
  const verify = await config.facilitator.verify(payload.accepted, payload);
  if (!verify.isValid) return new Response('invalid payment', { status: 402 });

  const settle = await config.facilitator.settle(payload.accepted, payload);
  if (!settle.success) throw new SettlementError(settle.errorReason); // your policy

  return new Response(premiumData, { status: 200, headers: settlementHeader(settle) });
});
```

The verify → resource → settle orchestration is the application's (ТЗ §3.4 table). `X402Config` declares policy; it is never enforced per payment and never passed to the client API.

## `extra.me2em` — Me2eM metadata on the wire

```ts
import { withMe2emExtra, readMe2emExtra } from '@me2em/x402';

const requirements = withMe2emExtra(option, {
  sellerId: 'base64url(SellerPubkey)',
  reference: 'base58-reference',
  agreementProof: base64(pactProofBytes), // opaque — x402 never interprets it
});
const me2em = readMe2emExtra(buyerAccepted); // null when absent/malformed — never throws
```

Two formats, two names: core's `Me2emExtra` is the application-side shape (all fields optional, `agreementProof?: Uint8Array`); `X402Me2emExtra` is the wire shape (`sellerId` required, base64 strings). The nested `me2em` key never collides with the x402-reserved `extra` keys (`assetTransferMethod`, `paymentFlow`, `name`, `version`).

## Errors

Every transport failure is `X402Error` (`code` + optional `details`); configuration mistakes are `X402ConfigError` (a `TypeError`). Unknown runtime `errorReason` / `me2emError` values are surfaced in `details` and treated as failures — never mapped to success.

| Code | Thrown by |
|---|---|
| `PAYMENT_REQUIRED_MALFORMED` | codec/client — bad base64/JSON/shape, 402 without a header, size overflow on decode |
| `PAYMENT_PAYLOAD_MALFORMED` | codec — broken `PAYMENT-SIGNATURE` |
| `PAYMENT_RESPONSE_MALFORMED` | `readSettlement` — broken `PAYMENT-RESPONSE` (never silently `null`) |
| `VERSION_UNSUPPORTED` | codec — well-formed JSON with `x402Version !== 2` |
| `NO_VIABLE_OPTION` | client — no `accepts` entry covered by capabilities |
| `SIGNER_REJECTED` | client — `signPayment` threw (`details.cause`) |
| `RESOURCE_MISMATCH` | `readPaymentHeader` — payload resource ≠ expected URL |
| `FACILITATOR_ERROR` | facilitators — `details: { phase, kind: network\|timeout\|http_5xx\|http_4xx\|auth\|invalid_response }` |
| `SETTLEMENT_FAILED` | application — `settle` returned `success: false` (your policy, your throw) |
| `ME2EM_EXTRA_INVALID` | `withMe2emExtra` — malformed Me2eM extra |

## Golden vectors

`test/fixtures/spec-vectors.json` carries the verbatim JSON examples of the upstream x402 v2 specification (`x402-foundation/x402`, `specs/x402-specification-v2.md`, commit `51a0664c2b7826e3cb02595481eb6848a1b11815`, 2026-10-26) — the codec is pinned to the real wire examples, not only to our own fixtures.

## Roadmap

- M2 — `SolanaX402Signer` in `@me2em/solana` `1.1.0-rc.1` (blockhash injection, explicit CAIP-2 capabilities).
- `@me2em/facilitator` — self-hosted facilitator, separate ТЗ; `FacilitatorClient` here is contract-only.
- `@me2em/pact` — Pact negotiations; only the opaque `agreementProof` format touches this package.
