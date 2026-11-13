// JSON export — spec §7 FR-12 (Build 5).
// The export is the full report plus the facts it was scored from,
// the evidence trail, and the activity samples — with the score
// model version and generation time so a saved file can always be
// traced back to the model that produced it. A score is never
// exported without its coverage, confidence and limitations.

import type { ActivityData } from '../domain/activity';
import type { RepositoryReport } from '../domain/report';
import type { OverviewResult } from '../domain/repository';

export interface ReportExport {
  exportedBy: 'RepoRadar';
  /** Score model version that produced the report (spec §6.1). */
  scoreModelVersion: string;
  generatedAt: string;
  repoId: string;
  report: RepositoryReport;
  overview: {
    facts: OverviewResult['facts'];
    languages: OverviewResult['languages'];
    fromCache: boolean;
    stale: boolean;
    fetchedAt: string;
  };
  activity: ActivityData;
  limitations: string[];
}

export function buildReportExport(
  overview: OverviewResult,
  report: RepositoryReport,
  activity: ActivityData,
): ReportExport {
  const limitations = [
    'A score is an evidence-based heuristic, not proof of code quality, security, or safety.',
    'GitHub counts open issues and open pull requests together in the open-issues field.',
    ...report.sampleNotes,
  ];
  return {
    exportedBy: 'RepoRadar',
    scoreModelVersion: report.scoreModelVersion,
    generatedAt: report.generatedAt,
    repoId: report.repoId,
    report,
    overview: {
      facts: overview.facts,
      languages: overview.languages,
      fromCache: overview.fromCache,
      stale: overview.stale,
      fetchedAt: overview.fetchedAt,
    },
    activity,
    limitations,
  };
}

/** Pretty-printed JSON string for the download. */
export function toReportJson(
  overview: OverviewResult,
  report: RepositoryReport,
  activity: ActivityData,
): string {
  return JSON.stringify(buildReportExport(overview, report, activity), null, 2);
}
