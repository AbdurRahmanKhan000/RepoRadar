import { describe, expect, it } from 'vitest';
import {
  APP_NAME,
  APP_VERSION,
  BUILD_LABEL,
  SCORE_MODEL_VERSION,
} from '../../src/shared/constants';

describe('RepoRadar foundation constants', () => {
  it('names the product RepoRadar', () => {
    expect(APP_NAME).toBe('RepoRadar');
  });

  it('is on Build 6, version 0.3.0', () => {
    expect(BUILD_LABEL).toBe('Build 6');
    expect(APP_VERSION).toBe('0.3.0');
  });

  it('pins the scoring model version from spec §6.1', () => {
    // Every saved report must carry this, so a score is traceable
    // to the model that produced it.
    expect(SCORE_MODEL_VERSION).toBe('1.0.0');
  });
});
