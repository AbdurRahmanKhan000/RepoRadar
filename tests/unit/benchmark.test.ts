import { describe, expect, it } from 'vitest';

import { buildReport } from '../../src/analysis/scoring';
import benchmark from '../fixtures/benchmark-repos.json';
import {
  FIXED_NOW,
  commitSamples,
  contributorSamples,
  issueSamples,
  isoDaysAgo,
  makeActivity,
  makeFacts,
  pullSamples,
  releaseSamples,
} from './scoring-fixtures';

interface BenchmarkProfile {
  id: string;
  label: string;
  expectedGrade: string;
  expectedScoreRange: [number, number];
  facts: { stars: number; forks: number; pushedDaysAgo: number; archived: boolean };
  activity: {
    contributors: { total: number; topShare: number };
    commits: { count: number; daysSpan: number; authors: number };
    releasesDaysAgo: number[];
    issues: { open: number; closed: number; medianOpenAgeDays: number };
    pulls: { merged: number; closedUnmerged: number };
    communityProfile: {
      readme: boolean;
      license: boolean;
      contributing: boolean;
      codeOfConduct: boolean;
      issueTemplate: boolean;
      pullRequestTemplate: boolean;
      healthPercentage: number;
    };
    ci: boolean;
  };
}

const profiles = (benchmark as unknown as { profiles: BenchmarkProfile[] }).profiles;

// Seed of the spec §14.3 benchmark corpus: each synthetic profile
// must land in its expected grade band. This catches scoring
// regressions and unfair incentives (e.g. popularity rescuing an
// abandoned repo) before the full ≥30-repo corpus lands in Build 6.
describe('benchmark corpus (seed)', () => {
  it('has at least 8 varied profiles', () => {
    expect(profiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const profile of profiles) {
    it(`${profile.id} (${profile.label}) lands in grade ${profile.expectedGrade}`, () => {
      const facts = makeFacts({
        stars: profile.facts.stars,
        forks: profile.facts.forks,
        pushedAt: isoDaysAgo(profile.facts.pushedDaysAgo),
        archived: profile.facts.archived,
      });
      const activity = makeActivity({
        contributors: contributorSamples(
          profile.activity.contributors.total,
          profile.activity.contributors.topShare,
        ),
        commits: commitSamples(
          profile.activity.commits.count,
          profile.activity.commits.daysSpan,
          profile.activity.commits.authors,
        ),
        releases: releaseSamples(profile.activity.releasesDaysAgo),
        issues: issueSamples(
          profile.activity.issues.open,
          profile.activity.issues.closed,
          profile.activity.issues.medianOpenAgeDays,
        ),
        pulls: pullSamples(
          profile.activity.pulls.merged,
          profile.activity.pulls.closedUnmerged,
        ),
        communityProfile: profile.activity.communityProfile,
        ciWorkflowsPresent: profile.activity.ci,
      });
      const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });
      expect(report.grade).toBe(profile.expectedGrade);
      // JSON imports widen the tuple to number[]; the fixture is
      // authored as a 2-element [min, max] range.
      const [min, max] = profile.expectedScoreRange as unknown as [number, number];
      expect(report.overallScore).not.toBeNull();
      expect(report.overallScore as number).toBeGreaterThanOrEqual(min);
      expect(report.overallScore as number).toBeLessThanOrEqual(max);
    });
  }
});
