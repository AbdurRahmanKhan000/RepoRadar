// Coverage / confidence / provisional logic — spec §6.3.
// Coverage is the weight of the signals that could be scored,
// divided by the total signal weight, expressed 0–100. Confidence
// is qualitative: High ≥85%, Medium 65–84%, Low <65%. Two caps:
//   - any endpoint returning a full page (sample truncated) caps
//     confidence at Medium — the sample may not represent the repo.
//   - coverage below 40% makes the report provisional: the overall
//     score is withheld (null) because there is not enough data to
//     score, and confidence is Low.

import { CONFIDENCE_THRESHOLDS } from './model-v1';
import type { Confidence } from '../domain/report';

export interface ConfidenceResult {
  confidence: Confidence;
  /** True when coverage < 40%: no overall score is published. */
  provisional: boolean;
}

export function confidenceFor(coverage: number, anySampleTruncated: boolean): ConfidenceResult {
  if (coverage < CONFIDENCE_THRESHOLDS.provisionalBelow) {
    return { confidence: 'low', provisional: true };
  }
  if (coverage >= CONFIDENCE_THRESHOLDS.high) {
    // A capped sample means the evidence may be incomplete even
    // when coverage is nominally high.
    return { confidence: anySampleTruncated ? 'medium' : 'high', provisional: false };
  }
  if (coverage >= CONFIDENCE_THRESHOLDS.medium) {
    return { confidence: 'medium', provisional: false };
  }
  return { confidence: 'low', provisional: false };
}
