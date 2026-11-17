// x402 v2 wire types and structural guards (ТЗ @me2em/x402 v1.1 §2.1).
import { describe, it, expect } from 'vitest';
import {
  X402_VERSION,
  BUYER_ATTESTATION_POLICY,
  REGULATORY_PROFILES,
  isX402PaymentRequired,
  isX402PaymentRequirements,
  isX402PaymentPayload,
  isX402SettleResponse,
  isX402VerifyResponse,
  isX402Supported,
  type X402PaymentRequirements,
  type Me2emErrorCode,
  type PaymentFailureReason,
  type PaymentRequest,
  type Me2emExtra,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequirements(overrides: Partial<X402PaymentRequirements> = {}): X402PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'solana:mainnet-beta',
    amount: '1000000',
    asset: 'So11111111111111111111111111111111111111112',
    payTo: '11111111111111111111111111111111',
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

function makeResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: 'https://example.com/resource',
    description: 'A test resource',
    mimeType: 'application/json',
    serviceName: 'TestService',
    tags: ['a', 'b'],
    iconUrl: 'https://example.com/icon.png',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// X402_VERSION
// ---------------------------------------------------------------------------

describe('X402_VERSION', () => {
  it('is 2', () => {
    expect(X402_VERSION).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isX402PaymentRequirements
// ---------------------------------------------------------------------------

describe('isX402PaymentRequirements', () => {
  it('valid → true', () => {
    expect(isX402PaymentRequirements(makeRequirements())).toBe(true);
  });

  it('valid with extra → true', () => {
    expect(isX402PaymentRequirements(makeRequirements({ extra: { me2em: { sellerId: 's1' } } }))).toBe(true);
  });

  it('network not CAIP-2 → false', () => {
    for (const network of ['solana', 'Solana:mainnet-beta', 'solana:', 's:mainnet-beta']) {
      expect(isX402PaymentRequirements(makeRequirements({ network }))).toBe(false);
    }
  });

  it('amount not /^[0-9]+$/ → false', () => {
    for (const amount of ['1.5', '0.5', 'abc', '', '-1']) {
      expect(isX402PaymentRequirements(makeRequirements({ amount }))).toBe(false);
    }
  });

  it('maxTimeoutSeconds not integer / < 1 → false', () => {
    for (const maxTimeoutSeconds of [0, -1, 1.5, '60']) {
      expect(isX402PaymentRequirements(makeRequirements({ maxTimeoutSeconds }))).toBe(false);
    }
  });

  it('scheme / asset / payTo not string or empty → false', () => {
    for (const field of ['scheme', 'asset', 'payTo'] as const) {
      expect(isX402PaymentRequirements(makeRequirements({ [field]: '' }))).toBe(false);
      expect(isX402PaymentRequirements(makeRequirements({ [field]: 42 }))).toBe(false);
    }
  });

  it('extra not object → false', () => {
    expect(isX402PaymentRequirements(makeRequirements({ extra: 'nope' }))).toBe(false);
    expect(isX402PaymentRequirements(makeRequirements({ extra: [1] }))).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402PaymentRequirements('garbage')).toBe(false);
    expect(isX402PaymentRequirements(null)).toBe(false);
    expect(isX402PaymentRequirements(undefined)).toBe(false);
    expect(isX402PaymentRequirements([1, 2])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isX402PaymentRequired
// ---------------------------------------------------------------------------

describe('isX402PaymentRequired', () => {
  it('valid → true', () => {
    expect(
      isX402PaymentRequired({
        x402Version: 2,
        resource: makeResource(),
        accepts: [makeRequirements()],
      })
    ).toBe(true);
  });

  it('valid with error and extensions → true', () => {
    expect(
      isX402PaymentRequired({
        x402Version: 2,
        error: 'insufficient balance',
        resource: makeResource(),
        accepts: [makeRequirements()],
        extensions: { me2em: { info: {}, schema: {} } },
      })
    ).toBe(true);
  });

  it('x402Version !== 2 → false', () => {
    expect(
      isX402PaymentRequired({ x402Version: 1, resource: makeResource(), accepts: [makeRequirements()] })
    ).toBe(false);
  });

  it('resource not object / without url → false', () => {
    expect(
      isX402PaymentRequired({ x402Version: 2, resource: 'nope', accepts: [makeRequirements()] })
    ).toBe(false);
    expect(
      isX402PaymentRequired({ x402Version: 2, resource: {}, accepts: [makeRequirements()] })
    ).toBe(false);
  });

  it('accepts not array / empty / contains invalid → false', () => {
    expect(isX402PaymentRequired({ x402Version: 2, resource: makeResource(), accepts: 'nope' })).toBe(false);
    expect(isX402PaymentRequired({ x402Version: 2, resource: makeResource(), accepts: [] })).toBe(false);
    expect(
      isX402PaymentRequired({ x402Version: 2, resource: makeResource(), accepts: [makeRequirements({ amount: '1.5' })] })
    ).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402PaymentRequired('garbage')).toBe(false);
    expect(isX402PaymentRequired(null)).toBe(false);
    expect(isX402PaymentRequired(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isX402PaymentPayload
// ---------------------------------------------------------------------------

describe('isX402PaymentPayload', () => {
  it('valid → true', () => {
    expect(
      isX402PaymentPayload({
        x402Version: 2,
        accepted: makeRequirements(),
        payload: { tx: 'abc' },
      })
    ).toBe(true);
  });

  it('valid with resource and extensions → true', () => {
    expect(
      isX402PaymentPayload({
        x402Version: 2,
        resource: makeResource(),
        accepted: makeRequirements(),
        payload: {},
        extensions: { me2em: { info: {}, schema: {} } },
      })
    ).toBe(true);
  });

  it('x402Version !== 2 → false', () => {
    expect(
      isX402PaymentPayload({ x402Version: 1, accepted: makeRequirements(), payload: {} })
    ).toBe(false);
  });

  it('accepted invalid → false', () => {
    expect(
      isX402PaymentPayload({ x402Version: 2, accepted: makeRequirements({ amount: 'x' }), payload: {} })
    ).toBe(false);
  });

  it('payload not object → false', () => {
    expect(isX402PaymentPayload({ x402Version: 2, accepted: makeRequirements(), payload: 'nope' })).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402PaymentPayload('garbage')).toBe(false);
    expect(isX402PaymentPayload(null)).toBe(false);
    expect(isX402PaymentPayload(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isX402SettleResponse
// ---------------------------------------------------------------------------

describe('isX402SettleResponse', () => {
  it('valid → true', () => {
    expect(
      isX402SettleResponse({
        success: true,
        transaction: 'tx123',
        network: 'solana:mainnet-beta',
      })
    ).toBe(true);
  });

  it('valid failure with all fields → true', () => {
    expect(
      isX402SettleResponse({
        success: false,
        errorReason: 'INSUFFICIENT_BALANCE',
        errorMessage: 'not enough',
        payer: 'payer1',
        transaction: 'tx123',
        network: 'solana:mainnet-beta',
        amount: '100',
        extra: { a: 1 },
        extensions: { b: 2 },
      })
    ).toBe(true);
  });

  it('success not boolean → false', () => {
    expect(isX402SettleResponse({ success: 'yes', transaction: 'tx', network: 'solana:mainnet-beta' })).toBe(false);
  });

  it('transaction not string → false', () => {
    expect(isX402SettleResponse({ success: true, transaction: 42, network: 'solana:mainnet-beta' })).toBe(false);
  });

  it('empty transaction: legal without settlement_pending, illegal with it (upstream §5.3.2)', () => {
    expect(isX402SettleResponse({ success: false, transaction: '', network: 'solana:mainnet-beta' })).toBe(true);
    expect(
      isX402SettleResponse({
        success: false,
        errorReason: 'insufficient_funds',
        transaction: '',
        network: 'solana:mainnet-beta',
      })
    ).toBe(true);
    expect(
      isX402SettleResponse({
        success: false,
        errorReason: 'settlement_pending',
        transaction: '',
        network: 'solana:mainnet-beta',
      })
    ).toBe(false);
    expect(
      isX402SettleResponse({
        success: false,
        errorReason: 'settlement_pending',
        transaction: '0xabc',
        network: 'solana:mainnet-beta',
      })
    ).toBe(true);
  });

  it('network not CAIP-2 → false', () => {
    expect(isX402SettleResponse({ success: true, transaction: 'tx', network: 'solana' })).toBe(false);
  });

  it('amount invalid → false', () => {
    expect(
      isX402SettleResponse({ success: true, transaction: 'tx', network: 'solana:mainnet-beta', amount: '-1' })
    ).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402SettleResponse('garbage')).toBe(false);
    expect(isX402SettleResponse(null)).toBe(false);
    expect(isX402SettleResponse(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isX402VerifyResponse
// ---------------------------------------------------------------------------

describe('isX402VerifyResponse', () => {
  it('valid → true', () => {
    expect(isX402VerifyResponse({ isValid: true })).toBe(true);
  });

  it('valid invalid-response with all fields → true', () => {
    expect(
      isX402VerifyResponse({
        isValid: false,
        invalidReason: 'BAD_SIGNATURE',
        invalidMessage: 'sig mismatch',
        payer: 'p1',
        extensions: {},
        extra: {},
      })
    ).toBe(true);
  });

  it('isValid not boolean → false', () => {
    expect(isX402VerifyResponse({ isValid: 'yes' })).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402VerifyResponse('garbage')).toBe(false);
    expect(isX402VerifyResponse(null)).toBe(false);
    expect(isX402VerifyResponse(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isX402Supported
// ---------------------------------------------------------------------------

describe('isX402Supported', () => {
  it('valid → true', () => {
    expect(
      isX402Supported({
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:mainnet-beta' }],
      })
    ).toBe(true);
  });

  it('valid with extensions and signers → true', () => {
    expect(
      isX402Supported({
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:mainnet-beta' }],
        extensions: ['me2em'],
        signers: { exact: ['solana'] },
      })
    ).toBe(true);
  });

  it('kinds not array → false', () => {
    expect(isX402Supported({ kinds: 'nope' })).toBe(false);
  });

  it('kind entry invalid → false', () => {
    expect(isX402Supported({ kinds: [{ x402Version: '2', scheme: 'exact', network: 'solana:mainnet-beta' }] })).toBe(false);
    expect(isX402Supported({ kinds: [{ x402Version: 2, scheme: '', network: 'solana:mainnet-beta' }] })).toBe(false);
    expect(isX402Supported({ kinds: [{ x402Version: 2, scheme: 'exact', network: 42 }] })).toBe(false);
  });

  it('extensions not string array → false', () => {
    expect(isX402Supported({ kinds: [], extensions: [1] })).toBe(false);
  });

  it('garbage → false, no throw', () => {
    expect(isX402Supported('garbage')).toBe(false);
    expect(isX402Supported(null)).toBe(false);
    expect(isX402Supported(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Me2emErrorCode — subtype of PaymentFailureReason (compile-time)
// ---------------------------------------------------------------------------

type _SubsetCheck = Me2emErrorCode extends PaymentFailureReason ? true : false;
const _isSubset: _SubsetCheck = true;

describe('Me2emErrorCode', () => {
  it('is a subset of PaymentFailureReason (compile-time)', () => {
    expect(_isSubset).toBe(true);
    const codes: Me2emErrorCode[] = [
      'REFERENCE_MISMATCH',
      'PACT_INVALID',
      'BUYER_NOT_ATTESTED',
      'SELLER_NOT_ATTESTED',
    ];
    expect(codes).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// PaymentRequest.extra? — optional
// ---------------------------------------------------------------------------

describe('PaymentRequest.extra', () => {
  it('compiles without extra', () => {
    const req: PaymentRequest = {
      chain: 'solana:mainnet-beta',
      payTo: '11111111111111111111111111111111',
      amount: '1.5',
      asset: 'So11111111111111111111111111111111111111112',
      reference: 'ref1',
      expiresAt: 1700000000,
    };
    expect(req.extra).toBeUndefined();
  });

  it('compiles with extra fields', () => {
    const req: PaymentRequest = {
      chain: 'solana:mainnet-beta',
      payTo: '11111111111111111111111111111111',
      amount: '1.5',
      asset: 'So11111111111111111111111111111111111111112',
      reference: 'ref1',
      expiresAt: 1700000000,
      extra: { sellerId: 's1', memo: 'm' },
    };
    expect(req.extra?.sellerId).toBe('s1');
  });

  it('compiles with agreementProof: Uint8Array', () => {
    const extra: Me2emExtra = { agreementProof: new Uint8Array([1, 2, 3]) };
    expect(extra.agreementProof).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// PaymentFailureReason — 12 values (compile-time)
// ---------------------------------------------------------------------------

describe('PaymentFailureReason', () => {
  it('has exactly 12 values', () => {
    const reasons: PaymentFailureReason[] = [
      'NOT_FOUND',
      'UNDERPAID',
      'WRONG_RECIPIENT',
      'WRONG_ASSET',
      'EXPIRED',
      'REPLAYED',
      'CHAIN_UNAVAILABLE',
      'REJECTED',
      'REFERENCE_MISMATCH',
      'PACT_INVALID',
      'BUYER_NOT_ATTESTED',
      'SELLER_NOT_ATTESTED',
    ];
    expect(new Set(reasons).size).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// BUYER_ATTESTATION_POLICY / REGULATORY_PROFILES — runtime values
// ---------------------------------------------------------------------------

describe('BUYER_ATTESTATION_POLICY', () => {
  it('exposes the three declared values', () => {
    expect(BUYER_ATTESTATION_POLICY.NONE).toBe('none');
    expect(BUYER_ATTESTATION_POLICY.OPTIONAL).toBe('optional');
    expect(BUYER_ATTESTATION_POLICY.REQUIRED).toBe('required');
  });
});

describe('REGULATORY_PROFILES', () => {
  it('exposes the five declared values', () => {
    expect(REGULATORY_PROFILES.NONE).toBe('none');
    expect(REGULATORY_PROFILES.KYC).toBe('kyc');
    expect(REGULATORY_PROFILES.AML).toBe('aml');
    expect(REGULATORY_PROFILES.AGE_GATED).toBe('age-gated');
    expect(REGULATORY_PROFILES.SANCTIONS).toBe('sanctions');
  });
});
