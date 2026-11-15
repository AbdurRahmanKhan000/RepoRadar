// OSV vulnerability client — 0.3.0.
// Two steps, both against the free unauthenticated OSV API:
//   1. One POST to https://api.osv.dev/v1/querybatch for every
//      dependency at once (no per-package requests).
//   2. One GET to https://api.osv.dev/v1/vulns/{id} per
//      vulnerability found (capped at MAX_VULN_DETAILS, in
//      parallel, failure-isolated) — because the batch reply
//      carries only the id: severity and summary live in the
//      detail record. A failed detail fetch keeps the batch
//      record with unknown severity; it never fails the check.
// OSV reports severity as a CVSS *vector* string, never a
// number — the vector is scored by src/supply-chain/cvss.ts
// (FIRST.org CVSS 3.1 base formula). A record with no CVSS
// vector falls back to its database_specific.severity word.
// The extension sends OSV only package names + versions the
// user asked to check — no tokens, no repository data. fetch is
// bound to the global scope, the same lesson as
// GitHubApiClient: an unbound call throws "Illegal invocation"
// in a service worker.

import { z } from 'zod';

import { ProviderError } from '../domain/repository';
import { severityForCvssVector, severityForDbSpecific } from './cvss';
import { OSV_ECOSYSTEM, type Ecosystem, type SeverityLevel, type VulnerabilityInfo } from './types';

const OSV_API = 'https://api.osv.dev/v1';
const OSV_TIMEOUT_MS = 15_000;

/** Maximum detail fetches per analysis (a repo with more
 *  vulnerabilities keeps the batch records for the rest). */
export const MAX_VULN_DETAILS = 20;

const OsvVulnSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    severity: z
      .array(
        z.object({
          type: z.string(),
          score: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough();

const OsvBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(OsvVulnSchema).optional(),
    }),
  ),
});

const OsvDetailSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    severity: z
      .array(
        z.object({
          type: z.string(),
          score: z.string(),
        }),
      )
      .optional(),
    database_specific: z
      .object({ severity: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Map a CVSS numeric score to a severity level (CVSS v3 bands).
 *  A vulnerability with no CVSS score at all is 'unknown' — it is
 *  never silently treated as low. */
export function severityLevelForScore(score: number | null): SeverityLevel {
  if (score === null) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'low';
}

/** Highest CVSS score in OSV's severity list, or null when OSV
 *  reported no numeric CVSS score. Entries whose score is a
 *  vector string (CVSS:3.1/...) are NOT numeric — they are
 *  scored by cvss.ts instead; parseFloat on a vector is NaN
 *  and is ignored here. */
export function highestCvssScore(
  severity: { type: string; score: string }[] | undefined,
): number | null {
  if (!severity) return null;
  let best: number | null = null;
  for (const entry of severity) {
    if (!entry.type.startsWith('CVSS')) continue;
    const value = Number.parseFloat(entry.score);
    if (!Number.isNaN(value) && (best === null || value > best)) best = value;
  }
  return best;
}

/** Resolve a severity level + numeric score from a detail
 *  record, in order: (1) a CVSS 3.1 vector, scored by the
 *  FIRST.org formula; (2) a numeric CVSS score, if OSV ever
 *  sends one; (3) the advisory's database_specific severity
 *  word; (4) unknown — never guessed. */
export function severityFromDetail(detail: {
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
}): { level: SeverityLevel; score: number | null } {
  for (const entry of detail.severity ?? []) {
    if (entry.type.startsWith('CVSS') && entry.score.startsWith('CVSS:3.1/')) {
      const scored = severityForCvssVector(entry.score);
      if (scored) return { level: scored.level, score: scored.score };
    }
  }
  const numeric = highestCvssScore(detail.severity);
  if (numeric !== null) return { level: severityLevelForScore(numeric), score: numeric };
  return { level: severityForDbSpecific(detail.database_specific?.severity), score: null };
}

export interface OsvQuery {
  name: string;
  ecosystem: Ecosystem;
  version: string;
}

export class OsvClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn.bind(globalThis);
  }

  /** Query OSV for all dependencies in ONE request, then enrich
   *  each vulnerability found with its detail record (severity +
   *  summary). Results are aligned with the queries by index.
   *  Throws ProviderError only when the batch itself fails — the
   *  caller treats that as "vulnerability check unknown", never
   *  as "no vulnerabilities". A failed detail fetch is isolated
   *  to that one vulnerability. */
  async queryBatch(queries: OsvQuery[]): Promise<VulnerabilityInfo[]> {
    if (queries.length === 0) return [];
    let response: Response;
    try {
      response = await this.fetchFn(`${OSV_API}/querybatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: queries.map((q) => ({
            package: { name: q.name, ecosystem: OSV_ECOSYSTEM[q.ecosystem] },
            version: q.version,
          })),
        }),
        signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('NETWORK_ERROR', 'The vulnerability check timed out.', {
          detail: 'AbortError: OSV querybatch timed out',
        });
      }
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new ProviderError('NETWORK_ERROR', 'Could not reach the vulnerability database (api.osv.dev).', {
        detail,
      });
    }
    if (!response.ok) {
      throw new ProviderError(
        'UNKNOWN',
        `The vulnerability database answered ${response.status}.`,
        { status: response.status },
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ProviderError('INVALID_RESPONSE', 'The vulnerability database returned unreadable data.', {
        status: response.status,
      });
    }
    const parsed = OsvBatchResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'The vulnerability database returned data in an unexpected shape.',
        { status: response.status },
      );
    }
    const out: VulnerabilityInfo[] = [];
    parsed.data.results.forEach((result, i) => {
      const query = queries[i] as OsvQuery;
      for (const vuln of result.vulns ?? []) {
        // The batch reply carries only the id — severity and
        // summary are resolved from the detail record below.
        // Until then, unknown (never guessed) — and a numeric
        // score, if the batch ever sends one, is used directly.
        const cvss = highestCvssScore(vuln.severity);
        out.push({
          id: vuln.id,
          packageName: query.name,
          ecosystem: query.ecosystem,
          version: query.version,
          severity: cvss === null ? 'unknown' : severityLevelForScore(cvss),
          cvssScore: cvss,
          summary: vuln.summary ?? 'No summary provided.',
        });
      }
    });
    await this.enrichDetails(out);
    return out;
  }

  /** Fetch the detail record for each vulnerability (capped,
   *  parallel, failure-isolated) and fill in its real severity
   *  and summary. A detail fetch that fails, times out, or
   *  returns an unexpected shape leaves that vulnerability as
   *  the batch described it. */
  private async enrichDetails(vulns: VulnerabilityInfo[]): Promise<void> {
    const targets = vulns.slice(0, MAX_VULN_DETAILS);
    await Promise.all(
      targets.map(async (vuln) => {
        let response: Response;
        try {
          response = await this.fetchFn(`${OSV_API}/vulns/${encodeURIComponent(vuln.id)}`, {
            signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
          });
        } catch {
          return;
        }
        if (!response.ok) return;
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          return;
        }
        const parsed = OsvDetailSchema.safeParse(json);
        if (!parsed.success) return;
        const detail = parsed.data;
        const resolved = severityFromDetail(detail);
        vuln.severity = resolved.level;
        vuln.cvssScore = resolved.score;
        if (detail.summary) vuln.summary = detail.summary;
      }),
    );
  }
}
