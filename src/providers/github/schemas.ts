// Zod schemas for GitHub REST API payloads — spec §11 (Zod
// recommended: runtime validation of external API payloads).
// The API returns far more fields than we use; .passthrough() keeps
// validation strict on the fields we rely on and tolerant of the
// rest. Nullable fields stay nullable — unknown is null, never zero.

import { z } from 'zod';

export const GitHubRepositorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    description: z.string().nullable(),
    stargazers_count: z.number(),
    forks_count: z.number(),
    watchers_count: z.number(),
    open_issues_count: z.number(),
    language: z.string().nullable(),
    license: z
      .object({
        key: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        spdx_id: z.string().nullable().optional(),
      })
      .nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    pushed_at: z.string().nullable(),
    archived: z.boolean(),
    fork: z.boolean(),
    default_branch: z.string(),
  })
  .passthrough();

export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;

/** Languages endpoint: { "TypeScript": 12345, "JavaScript": 678 } */
export const GitHubLanguagesSchema = z.record(z.string(), z.number().nonnegative());

export type GitHubLanguages = z.infer<typeof GitHubLanguagesSchema>;

// --- Activity endpoints (Build 3). Each schema validates only the
// fields RepoRadar uses; .passthrough() tolerates the rest. Nullable
// fields stay nullable — unknown is null, never zero.

export const GitHubContributorSchema = z
  .object({
    login: z.string(),
    contributions: z.number(),
  })
  .passthrough();

export type GitHubContributor = z.infer<typeof GitHubContributorSchema>;

export const GitHubContributorsSchema = z.array(GitHubContributorSchema);

export const GitHubCommitSchema = z
  .object({
    sha: z.string(),
    author: z.object({ login: z.string().nullable() }).nullable(),
    committer: z.object({ login: z.string().nullable() }).nullable(),
    commit: z.object({
      author: z.object({ date: z.string().nullable() }).nullable(),
      committer: z.object({ date: z.string().nullable() }).nullable(),
    }),
  })
  .passthrough();

export type GitHubCommit = z.infer<typeof GitHubCommitSchema>;

export const GitHubCommitsSchema = z.array(GitHubCommitSchema);

export const GitHubReleaseSchema = z
  .object({
    tag_name: z.string(),
    published_at: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
  })
  .passthrough();

export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

export const GitHubReleasesSchema = z.array(GitHubReleaseSchema);

export const GitHubIssueSchema = z
  .object({
    number: z.number(),
    state: z.enum(['open', 'closed']),
    created_at: z.string(),
    closed_at: z.string().nullable(),
    // Present on pull requests returned by the issues endpoint.
    pull_request: z.object({}).passthrough().optional(),
  })
  .passthrough();

export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;

export const GitHubIssuesSchema = z.array(GitHubIssueSchema);

export const GitHubPullSchema = z
  .object({
    number: z.number(),
    state: z.enum(['open', 'closed']),
    merged_at: z.string().nullable(),
    closed_at: z.string().nullable(),
  })
  .passthrough();

export type GitHubPull = z.infer<typeof GitHubPullSchema>;

export const GitHubPullsSchema = z.array(GitHubPullSchema);

/** Community profile: files.* is an object with url/html_url when
 *  the file exists, null when it does not, and may be absent. */
const GitHubCommunityFileSchema = z
  .object({
    url: z.string(),
    html_url: z.string(),
  })
  .nullable()
  .optional();

export const GitHubCommunityProfileSchema = z
  .object({
    health_percentage: z.number().nullable().optional(),
    files: z
      .object({
        readme: GitHubCommunityFileSchema,
        license: GitHubCommunityFileSchema,
        contributing: GitHubCommunityFileSchema,
        code_of_conduct: GitHubCommunityFileSchema,
        issue_template: GitHubCommunityFileSchema,
        pull_request_template: GitHubCommunityFileSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type GitHubCommunityProfile = z.infer<typeof GitHubCommunityProfileSchema>;

/** Directory listing from /contents/.github/workflows: an array of
 *  entries. A file (single object) would fail this schema — the
 *  service treats that as an unknown CI state, not as "present". */
export const GitHubContentsSchema = z.array(
  z.object({ name: z.string(), type: z.string() }).passthrough(),
);

export type GitHubContents = z.infer<typeof GitHubContentsSchema>;

// --- 0.3.0: commit activity (trajectory), git tree + file
// contents (supply chain). ---

/** GET /stats/commit_activity: 52 weeks of {total, week (Unix
 *  seconds), days[7]}. A 202 ("still computing") returns {} —
 *  that fails this schema on purpose; the provider catches the
 *  202 and retries once (see provider.ts). */
export const GitHubCommitActivitySchema = z.array(
  z
    .object({
      total: z.number(),
      week: z.number(),
      days: z.array(z.number()),
    })
    .passthrough(),
);

export type GitHubCommitActivity = z.infer<typeof GitHubCommitActivitySchema>;

/** GET /git/trees/{branch}?recursive=1: every path in the repo.
 *  `truncated` means GitHub capped the listing — manifest
 *  discovery may have missed files, and the evidence says so. */
export const GitHubTreeSchema = z
  .object({
    tree: z.array(
      z
        .object({
          path: z.string(),
          type: z.string(),
          sha: z.string(),
        })
        .passthrough(),
    ),
    truncated: z.boolean(),
  })
  .passthrough();

export type GitHubTree = z.infer<typeof GitHubTreeSchema>;

/** GET /contents/{path} for a single file: base64 content. A
 *  directory listing (array) fails this schema — the caller
 *  treats that as an unreadable manifest, not as content. */
export const GitHubFileContentSchema = z
  .object({
    content: z.string(),
    encoding: z.string(),
    size: z.number(),
  })
  .passthrough();

export type GitHubFileContent = z.infer<typeof GitHubFileContentSchema>;
