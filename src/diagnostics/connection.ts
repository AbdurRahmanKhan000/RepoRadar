// Connection diagnostics — fixes 0.2.1.
// The panel's NETWORK_ERROR used to hide the real cause. These
// probes run in the background worker (which owns the network) and
// answer one question per host: can this browser reach it, and if
// not, what exactly failed? They use only hosts the extension is
// already permitted for (github.com, api.github.com) — no new
// permissions. They cannot fix a blocked host; they only prove
// where the failure is.

export interface ConnectionProbeResult {
  /** 'api.github.com' or 'github.com'. */
  host: string;
  ok: boolean;
  /** HTTP status when the host answered, null when it never did. */
  status: number | null;
  /** Raw failure, e.g. "TypeError: Failed to fetch", null on success. */
  error: string | null;
  /** Wall-clock ms for the probe. */
  elapsedMs: number;
}

export const CONNECTION_PROBE_TIMEOUT_MS = 10_000;

export interface ConnectionProbeOptions {
  timeoutMs?: number;
}

/** Probe one host: a HEAD request with a hard timeout. A response —
 *  any status, including 404/401 — counts as reachable; only a
 *  thrown fetch error counts as unreachable. */
export async function probeHost(
  fetchFn: typeof fetch,
  url: string,
  options: ConnectionProbeOptions = {},
): Promise<ConnectionProbeResult> {
  const host = new URL(url).host;
  const started = Date.now();
  try {
    const response = await fetchFn(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(options.timeoutMs ?? CONNECTION_PROBE_TIMEOUT_MS),
    });
    return { host, ok: true, status: response.status, error: null, elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { host, ok: false, status: null, error: message, elapsedMs: Date.now() - started };
  }
}

/** Probe both hosts the extension depends on, API first. The split
 *  is the point: api.github.com unreachable while github.com answers
 *  means the API host is blocked (or down), not the connection. */
export async function testConnection(
  fetchFn: typeof fetch,
  options: ConnectionProbeOptions = {},
): Promise<ConnectionProbeResult[]> {
  return Promise.all([
    probeHost(fetchFn, 'https://api.github.com/rate_limit', options),
    probeHost(fetchFn, 'https://github.com/', options),
  ]);
}
