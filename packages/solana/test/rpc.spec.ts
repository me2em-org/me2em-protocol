// packages/solana/test/rpc.spec.ts
//
// Ф4: RpcClient — mock-fetch: success, JSON-RPC error, HTTP error, null result.
import { describe, it, expect, vi } from 'vitest';
import { RpcClient } from '../src/rpc.js';

function makeMockFetch(response: {
  status?: number;
  ok?: boolean;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}): typeof globalThis.fetch {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const res: Response = {
      status: response.status ?? 200,
      ok: response.ok ?? true,
      json: response.json ?? (() => Promise.resolve({})),
      text: response.text ?? (() => Promise.resolve('')),
      headers: new Headers(),
      clone: () => res,
      body: null,
      bodyUsed: false,
      redirected: false,
      type: 'basic' as ResponseType,
      url: '',
    } as Response;
    return res;
  });
}

function makeJsonRpcResponse(result?: unknown, error?: unknown) {
  return {
    json: () =>
      Promise.resolve(
        error
          ? { jsonrpc: '2.0', error, id: 1 }
          : { jsonrpc: '2.0', result, id: 1 }
      ),
  };
}

describe('RpcClient — success', () => {
  it('getTransaction returns the parsed transaction', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse({
        transaction: { message: { accountKeys: [] } },
        meta: { blockTime: 1700000000 },
      }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await rpc.getTransaction('sig123');
    expect(result).not.toBeNull();
    expect((result as unknown as Record<string, unknown>).transaction).toBeDefined();
  });

  it('getSignaturesForAddress returns signature list', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse({
        signatures: [
          { signature: 'sig1', slot: 1, blockTime: 1700000000, confirmationStatus: 'confirmed', err: undefined, memo: null },
        ],
      }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await rpc.getSignaturesForAddress('addr123', { limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].signature).toBe('sig1');
  });

  it('getAccountInfo returns account data', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse({
        data: ['dGVzdA==', 'base64'],
        owner: '11111111111111111111111111111111',
      }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await rpc.getAccountInfo('addr123');
    expect(result).not.toBeNull();
    expect(result!.data[0]).toBe('dGVzdA==');
  });
});

describe('RpcClient — JSON-RPC error', () => {
  it('getTransaction throws on JSON-RPC error', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(undefined, {
        code: -32600,
        message: 'Invalid request',
      }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getTransaction('sig123')).rejects.toThrow();
  });

  it('getSignaturesForAddress throws on JSON-RPC error', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(undefined, {
        code: -32601,
        message: 'Method not found',
      }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getSignaturesForAddress('addr123', { limit: 10 })).rejects.toThrow();
  });
});

describe('RpcClient — HTTP error', () => {
  it('throws on HTTP 500', async () => {
    const mockFetch = makeMockFetch({
      status: 500,
      ok: false,
      text: () => Promise.resolve('Internal Server Error'),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getTransaction('sig123')).rejects.toThrow();
  });

  it('throws on HTTP 404', async () => {
    const mockFetch = makeMockFetch({
      status: 404,
      ok: false,
      text: () => Promise.resolve('Not Found'),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getAccountInfo('addr123')).rejects.toThrow();
  });
});

describe('RpcClient — null result', () => {
  it('getTransaction returns null when result is null', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(null),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await rpc.getTransaction('nonexistent');
    expect(result).toBeNull();
  });

  it('getAccountInfo returns null when result is null', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(null),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await rpc.getAccountInfo('emptyAccount');
    expect(result).toBeNull();
  });
});

describe('RpcClient — Ф5 methods (pay)', () => {
  it('getLatestBlockhash returns blockhash and lastValidBlockHeight', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse({ value: { blockhash: 'BLOCKHASHx', lastValidBlockHeight: 12345 } }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const bh = await rpc.getLatestBlockhash();
    expect(bh).toEqual({ blockhash: 'BLOCKHASHx', lastValidBlockHeight: 12345 });
  });

  it('getLatestBlockhash throws on JSON-RPC error', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(undefined, { code: -32000, message: 'node is behind' }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getLatestBlockhash()).rejects.toThrow(/node is behind/);
  });

  it('getLatestBlockhash throws on null value', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse({ value: null }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.getLatestBlockhash()).rejects.toThrow(/empty result/);
  });

  it('sendTransaction returns the signature and sends preflight-on base64 params', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse('sig456'),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    const sig = await rpc.sendTransaction('QUJD');
    expect(sig).toBe('sig456');
    const body = JSON.parse(String((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(body.method).toBe('sendTransaction');
    expect(body.params[1]).toEqual({
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  });

  it('sendTransaction throws on JSON-RPC error (e.g. failed preflight)', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(undefined, { code: -32002, message: 'Transaction simulation failed' }),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.sendTransaction('QUJD')).rejects.toThrow(/simulation failed/);
  });

  it('sendTransaction throws on an empty signature (txRef is non-empty by contract)', async () => {
    const mockFetch = makeMockFetch({
      ...makeJsonRpcResponse(''),
    });
    const rpc = new RpcClient({ endpoint: 'http://localhost:8899', fetch: mockFetch as unknown as typeof globalThis.fetch });
    await expect(rpc.sendTransaction('QUJD')).rejects.toThrow(/empty signature/);
  });
});
