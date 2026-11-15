// 0.3.0 — supply-chain orchestration: manifest discovery,
// OSV batching, deps.dev abandonment, and failure isolation.
// The network is fully mocked (mock fetch + mock provider) —
// nothing here touches the real internet.

import { describe, expect, it, vi } from 'vitest';

import { ProviderError, type RepoRef } from '../../src/domain/repository';
import { DepsDevClient } from '../../src/supply-chain/depsdev-client';
import { OsvClient } from '../../src/supply-chain/osv-client';
import { SupplyChainService } from '../../src/supply-chain/service';
import { FIXED_NOW } from './scoring-fixtures';

const ref: RepoRef = { platform: 'github', host: 'github.com', owner: 'test', repo: 'repo' };

const PACKAGE_JSON = JSON.stringify({
  dependencies: { lodash: '^4.17.20', react: '^19.0.0' },
  devDependencies: { vitest: '^3.0.0' },
});

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

interface OsvVuln {
  id: string;
  summary: string;
  severity: { type: string; score: string }[];
}

interface OsvDetail {
  summary?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
}

/** Mock fetch that answers OSV (batch + detail) and deps.dev from canned data. */
function makeFetch(opts: {
  osv?: Record<string, OsvVuln[]>;
  osvDetails?: Record<string, OsvDetail>;
  depsDev?: Record<string, string | null>;
  osvFails?: boolean;
} = {}) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.osv.dev/v1/vulns/')) {
      const id = decodeURIComponent(href.split('/vulns/')[1] ?? '');
      const detail = opts.osvDetails?.[id];
      if (!detail) return mockResponse({ message: 'not found' }, 404);
      return mockResponse({ id, ...detail });
    }
    if (href.includes('api.osv.dev')) {
      if (opts.osvFails) throw new TypeError('Failed to fetch');
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        queries: { package: { name: string; ecosystem: string }; version: string }[];
      };
      return mockResponse({
        results: body.queries.map((q) => ({
          // The real batch reply carries only the id — no
          // severity, no summary (those come from the detail
          // fetch). The mock mirrors that.
          vulns: (opts.osv?.[q.package.name] ?? []).map((v) => ({ id: v.id })),
        })),
      });
    }
    if (href.includes('api.deps.dev')) {
      const name = decodeURIComponent(href.split('/packages/')[1] ?? '');
      const released = opts.depsDev?.[name];
      if (released === undefined) return mockResponse({}, 404);
      return mockResponse({
        versions: released === null ? [] : [{ version: '1.0.0', publishedAt: released }],
      });
    }
    throw new Error(`unexpected fetch: ${href}`);
  });
}

function mockProvider(treePaths: string[], files: Record<string, string>, treeFails = false) {
  return {
    getRepoTree: vi.fn(async () => {
      if (treeFails) throw new ProviderError('NETWORK_ERROR', 'tree unreachable');
      return {
        data: {
          entries: treePaths.map((path) => ({ path, type: 'blob' })),
          truncated: false,
        },
        etag: null,
        rateLimit: null,
        notModified: false,
        fetchedAt: new Date(FIXED_NOW).toISOString(),
      };
    }),
    getFileContent: vi.fn(async (_ref: RepoRef, path: string) => {
      const text = files[path];
      if (text === undefined) throw new ProviderError('NOT_FOUND', 'file not found');
      return {
        data: text,
        etag: null,
        rateLimit: null,
        notModified: false,
        fetchedAt: new Date(FIXED_NOW).toISOString(),
      };
    }),
  };
}

function makeService(
  provider: ReturnType<typeof mockProvider>,
  fetchFn: ReturnType<typeof makeFetch>,
) {
  return new SupplyChainService(
    provider as never,
    new OsvClient(fetchFn as unknown as typeof fetch),
    new DepsDevClient(fetchFn as unknown as typeof fetch),
  );
}

describe('SupplyChainService', () => {
  it('scores a clean repo Low with no vulnerabilities', async () => {
    const fetchFn = makeFetch({
      depsDev: { lodash: '2026-06-01T00:00:00Z', react: '2026-09-01T00:00:00Z', vitest: '2026-10-01T00:00:00Z' },
    });
    const provider = mockProvider(['package.json', 'package-lock.json'], { 'package.json': PACKAGE_JSON });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.riskScore).toBe(100);
    expect(result.riskLabel).toBe('low');
    expect(result.depsScanned).toBe(3);
    expect(result.vulnerabilities).toEqual([]);
    expect(result.abandonedDeps).toBe(0);
    expect(result.hasLockfile).toBe(true);
    expect(result.manifests).toEqual([{ path: 'package.json', ecosystem: 'npm', depCount: 3 }]);
  });

  it('flags vulnerabilities with real severities from the detail records', async () => {
    const fetchFn = makeFetch({
      osv: {
        lodash: [
          { id: 'GHSA-p6mc-m468-83gw', summary: '', severity: [] },
          { id: 'GHSA-29mw-wpgm-hmr9', summary: '', severity: [] },
        ],
      },
      osvDetails: {
        'GHSA-p6mc-m468-83gw': {
          summary: 'Prototype Pollution in lodash',
          severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }],
        },
        'GHSA-29mw-wpgm-hmr9': {
          summary: 'Regular Expression Denial of Service (ReDoS) in lodash',
          severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L' }],
        },
      },
      depsDev: { lodash: '2020-01-01T00:00:00Z', react: '2026-09-01T00:00:00Z', vitest: '2026-10-01T00:00:00Z' },
    });
    const provider = mockProvider(['package.json'], { 'package.json': PACKAGE_JSON });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.totalVulnerabilities).toBe(2);
    expect(result.vulnerableDeps).toBe(1);
    expect(result.vulnerabilities[0]).toMatchObject({
      id: 'GHSA-p6mc-m468-83gw',
      packageName: 'lodash',
      severity: 'high',
      cvssScore: 7.4,
      summary: 'Prototype Pollution in lodash',
    });
    expect(result.vulnerabilities[1]).toMatchObject({
      id: 'GHSA-29mw-wpgm-hmr9',
      severity: 'medium',
      cvssScore: 5.3,
    });
    // High −15, Medium −7, abandoned lodash −5, no lockfile −5 → 68.
    expect(result.riskScore).toBe(68);
    expect(result.riskLabel).toBe('moderate');
    expect(result.abandonedDeps).toBe(1);
  });

  it('keeps the batch record when a detail fetch fails (unknown severity)', async () => {
    const fetchFn = makeFetch({
      osv: {
        lodash: [{ id: 'GHSA-unknown-detail', summary: '', severity: [] }],
      },
      // No osvDetails entry → the detail GET 404s.
      depsDev: { lodash: '2026-06-01T00:00:00Z', react: '2026-09-01T00:00:00Z', vitest: '2026-10-01T00:00:00Z' },
    });
    const provider = mockProvider(['package.json', 'package-lock.json'], { 'package.json': PACKAGE_JSON });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0]).toMatchObject({
      id: 'GHSA-unknown-detail',
      severity: 'unknown',
      cvssScore: null,
      summary: 'No summary provided.',
    });
  });

  it('reports no-manifest when the tree has no supported manifest', async () => {
    const fetchFn = makeFetch();
    const provider = mockProvider(['README.md', 'index.js'], {});
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('no-manifest');
    expect(result.riskScore).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns unknown when the tree fetch fails', async () => {
    const fetchFn = makeFetch();
    const provider = mockProvider([], {}, true);
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('unknown');
    expect(result.error?.code).toBe('NETWORK_ERROR');
  });

  it('returns unknown (keeping parsed deps) when OSV fails', async () => {
    const fetchFn = makeFetch({ osvFails: true });
    const provider = mockProvider(['package.json'], { 'package.json': PACKAGE_JSON });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('unknown');
    expect(result.riskScore).toBeNull();
    expect(result.depsScanned).toBe(3);
    expect(result.error?.code).toBe('NETWORK_ERROR');
  });

  it('skips a failed manifest and still checks the others', async () => {
    const fetchFn = makeFetch({
      depsDev: { requests: '2026-01-01T00:00:00Z' },
    });
    // package.json exists in the tree but its content fetch fails.
    const provider = mockProvider(['package.json', 'requirements.txt'], {
      'requirements.txt': 'requests==2.31.0\n',
    });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.depsScanned).toBe(1);
    expect(result.dependencies[0]?.name).toBe('requests');
    expect(result.manifests.find((m) => m.path === 'package.json')?.depCount).toBe(0);
  });

  it('never counts a deps.dev 404 as abandoned', async () => {
    const fetchFn = makeFetch({ depsDev: {} });
    const provider = mockProvider(['package.json'], { 'package.json': PACKAGE_JSON });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.abandonedDeps).toBeNull();
    expect(result.dependencies.every((d) => d.abandoned === null)).toBe(true);
  });

  it('caps dependencies at 50 and marks truncated', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 60; i++) many[`dep${i}`] = '^1.0.0';
    const fetchFn = makeFetch({ depsDev: {} });
    const provider = mockProvider(['package.json'], {
      'package.json': JSON.stringify({ dependencies: many }),
    });
    const result = await makeService(provider, fetchFn).analyze(ref, 'main', FIXED_NOW);
    expect(result.depsScanned).toBe(50);
    expect(result.truncated).toBe(true);
  });
});
