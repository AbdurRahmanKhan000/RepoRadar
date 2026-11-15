// deps.dev client — 0.3.0.
// One GET per dependency (capped at 10 by the caller) to
// https://api.deps.dev/v3/systems/{system}/packages/{name}, to
// learn when the dependency was last released. A 404 means
// deps.dev has no record of the package — that is "unknown",
// never "abandoned" and never an error. Any other failure throws
// ProviderError and the caller records that dependency as unknown.

import { z } from 'zod';

import { ProviderError } from '../domain/repository';
import { DEPS_DEV_SYSTEM, type Ecosystem } from './types';

const DEPS_DEV_API = 'https://api.deps.dev/v3';
const DEPS_DEV_TIMEOUT_MS = 10_000;

const DepsDevPackageSchema = z
  .object({
    versions: z
      .array(
        z
          .object({
            // The version string lives under versionKey.version —
            // the real API has no flat `version` field.
            versionKey: z.object({ version: z.string() }).passthrough().optional(),
            publishedAt: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** Latest release timestamp in a deps.dev package payload: the
 *  maximum publishedAt across versions. Null when no version
 *  carries a date. */
export function latestReleaseAt(versions: { publishedAt?: string }[] | undefined): string | null {
  if (!versions) return null;
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const version of versions) {
    if (!version.publishedAt) continue;
    const ms = Date.parse(version.publishedAt);
    if (Number.isNaN(ms)) continue;
    if (best === null || ms > best) {
      best = ms;
      bestIso = version.publishedAt;
    }
  }
  return bestIso;
}

export class DepsDevClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn.bind(globalThis);
  }

  /** Latest release ISO timestamp for a package, or null when
   *  deps.dev has no record of it. Throws ProviderError on
   *  network/HTTP failures other than 404. */
  async getLatestRelease(ecosystem: Ecosystem, name: string): Promise<string | null> {
    const url = `${DEPS_DEV_API}/systems/${DEPS_DEV_SYSTEM[ecosystem]}/packages/${encodeURIComponent(name)}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, { signal: AbortSignal.timeout(DEPS_DEV_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('NETWORK_ERROR', 'The dependency lookup timed out.', {
          detail: 'AbortError: deps.dev lookup timed out',
        });
      }
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new ProviderError('NETWORK_ERROR', 'Could not reach the dependency index (api.deps.dev).', {
        detail,
      });
    }
    // 404: the package is not in the index (private name, typo,
    // brand-new package). Unknown — never abandoned, never an error.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ProviderError('UNKNOWN', `The dependency index answered ${response.status}.`, {
        status: response.status,
      });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ProviderError('INVALID_RESPONSE', 'The dependency index returned unreadable data.', {
        status: response.status,
      });
    }
    const parsed = DepsDevPackageSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'The dependency index returned data in an unexpected shape.',
        { status: response.status },
      );
    }
    return latestReleaseAt(parsed.data.versions);
  }
}
