import { describe, expect, it, vi } from 'vitest';

import { probeHost, testConnection } from '../../src/diagnostics/connection';
import { ProviderError } from '../../src/domain/repository';
import { GitHubApiClient } from '../../src/providers/github/client';
import { GitHubRepositorySchema } from '../../src/providers/github/schemas';
import { toErrorData } from '../../src/services/repository-service';

describe('diagnostics: raw failure detail is preserved', () => {
  it('toErrorData carries the detail through the message boundary', () => {
    const error = new ProviderError('NETWORK_ERROR', 'Could not reach GitHub.', {
      detail: 'TypeError: Failed to fetch',
    });
    expect(toErrorData(error)).toEqual({
      code: 'NETWORK_ERROR',
      message: 'Could not reach GitHub.',
      status: null,
      detail: 'TypeError: Failed to fetch',
    });
  });

  it('the client maps a throwing fetch to NETWORK_ERROR with the raw detail', async () => {
    const throwingFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = new GitHubApiClient(throwingFetch as unknown as typeof fetch);
    const caught = await client
      .request('/repos/react/react', GitHubRepositorySchema)
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(caught).toBeInstanceOf(ProviderError);
    const providerError = caught as ProviderError;
    expect(providerError.code).toBe('NETWORK_ERROR');
    expect(providerError.detail).toBe('TypeError: Failed to fetch');
    // Bounded retries: the failing fetch ran 3 times, then gave up.
    expect(throwingFetch).toHaveBeenCalledTimes(3);
  });

  it('calls fetch with the global scope as receiver (no Illegal invocation)', async () => {
    // Regression for the owner's live-Chrome failure: in a service
    // worker, calling fetch as a method of another object throws
    // "Illegal invocation". The client must bind fetch to the
    // global scope, so a receiver-sensitive fetch reaches the
    // network (and fails there with "Failed to fetch" when offline).
    function receiverSensitiveFetch(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
        );
      }
      throw new TypeError('Failed to fetch');
    }
    const client = new GitHubApiClient(
      receiverSensitiveFetch as unknown as typeof fetch,
    );
    const caught = (await client
      .request('/repos/react/react', GitHubRepositorySchema)
      .then(
        () => null,
        (error: unknown) => error,
      )) as ProviderError;
    expect(caught.code).toBe('NETWORK_ERROR');
    expect(caught.detail).toBe('TypeError: Failed to fetch');
  });

  it('a non-Error throw is stringified into the detail', async () => {
    const throwingFetch = vi.fn(async () => {
      throw 'network is down';
    });
    const client = new GitHubApiClient(throwingFetch as unknown as typeof fetch);
    const caught = (await client
      .request('/repos/react/react', GitHubRepositorySchema)
      .then(
        () => null,
        (error: unknown) => error,
      )) as ProviderError;
    expect(caught.code).toBe('NETWORK_ERROR');
    expect(caught.detail).toBe('network is down');
  });
});

describe('diagnostics: testConnection result shaping', () => {
  const okFetch = vi.fn(async () => ({ status: 200 }) as Response);

  it('reports both hosts reachable with status and timing', async () => {
    const results = await testConnection(okFetch as unknown as typeof fetch);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ host: 'api.github.com', ok: true, status: 200, error: null });
    expect(results[1]).toMatchObject({ host: 'github.com', ok: true, status: 200, error: null });
    expect(results[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('separates a blocked API host from a reachable github.com', async () => {
    const splitFetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes('api.github.com')) throw new TypeError('Failed to fetch');
      return { status: 200 } as Response;
    });
    const results = await testConnection(splitFetch as unknown as typeof fetch);
    expect(results[0]).toMatchObject({
      host: 'api.github.com',
      ok: false,
      status: null,
      error: 'TypeError: Failed to fetch',
    });
    expect(results[1]).toMatchObject({ host: 'github.com', ok: true, status: 200 });
  });

  it('reports both hosts unreachable when the network is down', async () => {
    const downFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const results = await testConnection(downFetch as unknown as typeof fetch);
    expect(results.every((r) => r.ok === false)).toBe(true);
    expect(results.every((r) => r.error === 'TypeError: Failed to fetch')).toBe(true);
  });

  it('probeHost treats any HTTP status as reachable', async () => {
    const result = await probeHost(
      (async () => ({ status: 404 }) as Response) as unknown as typeof fetch,
      'https://api.github.com/rate_limit',
    );
    expect(result).toMatchObject({ host: 'api.github.com', ok: true, status: 404 });
  });
});
