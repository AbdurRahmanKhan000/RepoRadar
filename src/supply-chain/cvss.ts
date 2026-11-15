// CVSS 3.1 base-score calculator — 0.3.0.
// Pure functions, no network, no clock. Needed because OSV
// reports severity as a CVSS *vector* string (e.g.
// "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H"), never as a
// number. The formula below is the FIRST.org CVSS v3.1
// specification (base score only — temporal/environmental
// metrics are not used). CVSS v4 vectors are not scored here;
// they fall back to the advisory's database_specific severity
// (see osv-client.ts), never to a guessed number.

import type { SeverityLevel } from './types';

/** CVSS v3.1 metric weights (FIRST.org specification). */
const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { N: 0, L: 0.22, H: 0.56 },
} as const;

type MetricKey = keyof typeof WEIGHTS.AV;

/** Roundup per the CVSS v3.1 spec: the smallest number with one
 *  decimal place that is >= the input. */
export function cvssRoundup(value: number): number {
  const scaled = Math.round(value * 100000);
  if (scaled % 10000 === 0) return scaled / 100000;
  return (Math.floor(scaled / 10000) * 10000 + 10000) / 100000;
}

/** Parse a CVSS:3.1 vector string into its metric values, or null
 *  when the string is not a well-formed CVSS 3.1 vector. */
export function parseCvss31Vector(
  vector: string,
): { av: MetricKey; ac: 'L' | 'H'; pr: 'N' | 'L' | 'H'; ui: 'N' | 'R'; s: 'U' | 'C'; c: 'N' | 'L' | 'H'; i: 'N' | 'L' | 'H'; a: 'N' | 'L' | 'H' } | null {
  if (!vector.startsWith('CVSS:3.1/')) return null;
  const parts = new Map<string, string>();
  for (const segment of vector.slice('CVSS:3.1/'.length).split('/')) {
    const [key, value] = segment.split(':');
    if (!key || !value) return null;
    parts.set(key, value);
  }
  const av = parts.get('AV');
  const ac = parts.get('AC');
  const pr = parts.get('PR');
  const ui = parts.get('UI');
  const s = parts.get('S');
  const c = parts.get('C');
  const i = parts.get('I');
  const a = parts.get('A');
  if (
    !av || !ac || !pr || !ui || !s || !c || !i || !a ||
    !(av in WEIGHTS.AV) || !(ac in WEIGHTS.AC) || !(pr in WEIGHTS.PR_U) ||
    !(ui in WEIGHTS.UI) || (s !== 'U' && s !== 'C') ||
    !(c in WEIGHTS.CIA) || !(i in WEIGHTS.CIA) || !(a in WEIGHTS.CIA)
  ) {
    return null;
  }
  return {
    av: av as MetricKey,
    ac: ac as 'L' | 'H',
    pr: pr as 'N' | 'L' | 'H',
    ui: ui as 'N' | 'R',
    s: s as 'U' | 'C',
    c: c as 'N' | 'L' | 'H',
    i: i as 'N' | 'L' | 'H',
    a: a as 'N' | 'L' | 'H',
  };
}

/** CVSS 3.1 base score (0.0–10.0) for a vector string, or null
 *  when the vector is not a CVSS 3.1 vector. */
export function cvssBaseScore(vector: string): number | null {
  const m = parseCvss31Vector(vector);
  if (!m) return null;
  const iss = 1 - (1 - WEIGHTS.CIA[m.c]) * (1 - WEIGHTS.CIA[m.i]) * (1 - WEIGHTS.CIA[m.a]);
  const prWeights = m.s === 'U' ? WEIGHTS.PR_U : WEIGHTS.PR_C;
  const exploitability = 8.22 * WEIGHTS.AV[m.av] * WEIGHTS.AC[m.ac] * prWeights[m.pr] * WEIGHTS.UI[m.ui];
  if (m.s === 'U') {
    const impact = 6.42 * iss;
    if (impact <= 0) return 0;
    return cvssRoundup(Math.min(impact + exploitability, 10));
  }
  const impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  if (impact <= 0) return 0;
  return cvssRoundup(Math.min(1.08 * (impact + exploitability), 10));
}

/** Severity level for a CVSS vector string, with the numeric
 *  score. Null when the string is not a CVSS 3.1 vector. */
export function severityForCvssVector(
  vector: string,
): { level: SeverityLevel; score: number } | null {
  const score = cvssBaseScore(vector);
  if (score === null) return null;
  if (score >= 9) return { level: 'critical', score };
  if (score >= 7) return { level: 'high', score };
  if (score >= 4) return { level: 'medium', score };
  return { level: 'low', score };
}

/** Map the severity word some advisory databases attach to a
 *  record (database_specific.severity) to a level. Unknown words
 *  map to 'unknown', never to a guessed level. */
export function severityForDbSpecific(value: string | undefined): SeverityLevel {
  switch ((value ?? '').toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MODERATE':
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'unknown';
  }
}
