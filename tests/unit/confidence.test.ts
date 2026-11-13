import { describe, expect, it } from 'vitest';

import { confidenceFor } from '../../src/analysis/confidence';

describe('confidenceFor', () => {
  it('is high at ≥85% coverage with a complete sample', () => {
    expect(confidenceFor(100, false)).toEqual({ confidence: 'high', provisional: false });
    expect(confidenceFor(85, false)).toEqual({ confidence: 'high', provisional: false });
  });
  it('is medium at 65–84%', () => {
    expect(confidenceFor(84.9, false)).toEqual({ confidence: 'medium', provisional: false });
    expect(confidenceFor(65, false)).toEqual({ confidence: 'medium', provisional: false });
  });
  it('is low below 65% but not provisional at ≥40%', () => {
    expect(confidenceFor(64.9, false)).toEqual({ confidence: 'low', provisional: false });
    expect(confidenceFor(40, false)).toEqual({ confidence: 'low', provisional: false });
  });
  it('is provisional below 40% coverage', () => {
    expect(confidenceFor(39.9, false)).toEqual({ confidence: 'low', provisional: true });
    expect(confidenceFor(0, false)).toEqual({ confidence: 'low', provisional: true });
  });
  it('caps at medium when any sample was truncated, even at 100% coverage', () => {
    expect(confidenceFor(100, true)).toEqual({ confidence: 'medium', provisional: false });
    expect(confidenceFor(90, true)).toEqual({ confidence: 'medium', provisional: false });
  });
});
