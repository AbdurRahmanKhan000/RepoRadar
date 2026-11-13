# Changelog

## 0.2.1 — Owner-reported fixes — 2026-11-13

- **Panel now opens.** Popup "Open analysis" and the "Analyze with
  RepoRadar" button call `sidePanel.open()` directly in the click
  context (the gesture does not survive the runtime-message hop to
  the background worker, so open() threw there and nothing visible
  happened). Background OPEN_PANEL stays as the fallback route with
  its full-tab fallback. Browser-verified 18/18
  (`tests/browser/verify-fixes.mjs`): both entry points open the
  panel with no `reporadar:lastPanelError` recorded.
- **Root cause of "Could not reach GitHub" found and fixed.**
  `GitHubApiClient` invoked `fetch` as a method of itself, which
  throws "Illegal invocation" in a service worker — every request
  failed even on a perfect connection. `fetch` is now bound to the
  global scope in the client constructor (and in the background's
  connection probe). Regression test with a receiver-sensitive
  fetch (`tests/unit/diagnostics.test.ts`); live api.github.com
  check re-run and passing after the fix.
- **Diagnostics.** ProviderError now carries the raw failure
  (`detail`, e.g. "TypeError: Failed to fetch") through
  `toErrorData` to the panel, which shows it as "Technical detail"
  on the error card, with "Copy diagnostics" (JSON: repo, code,
  message, detail, time, extension version) and "Test connection"
  (`TEST_CONNECTION` message → per-host probe of api.github.com
  and github.com, 10 s timeout, raw outcome + elapsed ms shown
  inline, including the split "API blocked, github.com reachable"
  reading). No new host permissions — the probe uses permitted
  hosts only. The diagnostics prove reachability; they cannot
  unblock a host.
- **New premium logo.** "RR" monogram removed from both headers
  (real logo image instead). Radar mark redesigned from a
  generated reference (glassy scope, glowing rings, tick ring,
  sweep, signal blip) and redrawn as vector SVG per size
  (`public/icon/src/icon-{16,32,48,96,128}.svg`, detail density
  adapted per size), rendered natively to PNG at exact sizes
  (verified 16/32/48/96/128; 16 px checked legible).
- **Popup footer removed** at the owner's request (verify-build0
  and verify-build6 expectations updated accordingly).
- Version 0.2.1 in package.json, constants, and wxt.config.ts
  (manifest verified 0.2.1, host_permissions unchanged).
  Store package `dist/RepoRadar-0.2.1-chrome.zip` (manifest at ZIP
  root). Gates: typecheck/lint pass, 136/136 unit tests (19 files),
  build 859.09 kB. Regression: verify-build0–6 all pass.

## 0.2.0 — Build 6 fixes (post-verification) — 2026-11-13

- Manifest version fixed: `wxt.config.ts` pinned 0.1.0 while
  package.json and constants were 0.2.0, so the built manifest
  said 0.1.0. Now 0.2.0 everywhere, verified in the built
  manifest and the store ZIP.
- Rate-limit UX (`src/shared/rate-limit-ui.ts`, side panel): the
  Refresh button is now disabled while the GitHub rate limit is
  exhausted (with the reset time in its title), and "Try again"
  after a rate-limit failure is cache-first instead of forcing
  another live request. Unit-tested (`tests/unit/rate-limit-ui.test.ts`,
  7 tests). The live countdown itself is still covered at
  unit/service level only — it needs the owner's live-Chrome check.
- Store ZIP rebuilt with `manifest.json` at the ZIP root (the
  first Build 6 ZIP nested everything under `chrome-mv3/`, which
  the stores reject) and with the 0.2.0 manifest.

## 0.2.0 — Build 6 (Hardening + browser QA + packaging) — 2026-11-13

- Final icons (`public/icon/`): navy/teal radar mark — concentric
  rings, sweep wedge, blip dot — each size drawn natively at its
  own size from a vector source (`public/icon/src/icon-{16,32,48,96,
128}.svg`, rendered by Chromium's vector renderer and cropped,
  never resized from a raster master). The media-generated reference
  artwork is 1600×1600 and cannot be produced at exact icon sizes,
  so the vector redraw is what ships; dimensions verified
  (16/32/48/96/128) and the mark checked legible at 16 px.
- Error boundary (`src/shared/ErrorBoundary.tsx`) wraps the side
  panel and popup main entrypoints: a render crash shows
  "Something went wrong" + Try again (reload) instead of a blank
  surface; saved data is untouched. Unit-tested with jsdom client
  rendering (new devDependency `jsdom`) — React's server renderers
  do not honour error boundaries for a synchronously throwing
  child, so that path was verified in the environment that matches
  the browser. Vitest include widened to `**/*.test.{ts,tsx}`.
- URL hardening (`src/shared/repo-url.ts`): owner/repo segments
  must match GitHub's name rules (owner 1–39 chars, no dots;
  repo 1–100 chars). Rejects percent-encoded traversal, over-long
  segments, control characters, and non-folding homograph hosts.
- Rate-limit exhaustion verified at client + service level (403
  with no budget → RATE_LIMITED with reset time; bounded retries
  respect Retry-After; `resetInLabel`/`isRateLimitExhausted` edge
  cases). Live panel countdown is covered at unit/service level
  only — see README.
- Browser verification 14/14 (`tests/browser/verify-build6.mjs`):
  archived repo 18.1/F with badge + observation, truncated large
  repo 94.3 with confidence capped Medium + sample note, offline
  error state, popup footer Build 6 · 0.2.0, error-boundary fallback
  in the built bundle, icons at exact sizes. Full regression re-run:
  verify-build0 through verify-build5 all pass.
- Tests: 121 unit tests (was 102 — new `error-boundary.test.tsx`
  4 tests, `hardening.test.ts` 15 tests: hostile URLs, client
  403/429 mapping, service FORBIDDEN/RATE_LIMITED propagation,
  archived observation, truncated-sample confidence cap).
- Packaging: production build 819.11 kB total (sidepanel entry
  34.49 kB, lazy charts chunk 382.69 kB, background ~120 kB; owner
  has said 3–4 MB does not matter, so size is recorded, not
  optimised). Store package `dist/RepoRadar-0.2.0-chrome.zip`.
- Docs: `docs/store-listing.md` (category, descriptions, 7 search
  terms, permissions rationale, screenshots plan),
  `docs/privacy-policy.md` (local-first, GitHub API only, exact
  local storage), `docs/qa-checklist.md` (Chrome verified; Edge /
  Brave owner steps; release checklist).
- Known gaps found, not fixed (App.tsx was frozen while Build 5
  landed): Refresh is not disabled when the rate limit is
  exhausted, and "Try again" on a RATE_LIMITED error
  force-refreshes instead of waiting for cached data. Also:
  `wxt.config.ts` still pins the manifest version to 0.1.0 (frozen
  during Build 5) — one line to fix before store submission.
- Version bumped to 0.2.0 in `package.json` + `src/shared/constants.ts`
  (`BUILD_LABEL` "Build 6"); `wxt.config.ts` manifest version is
  the one remaining 0.1.0 (see above).

## 0.1.0 — Build 5 (Compare, save, export) — 2026-11-13

- Save (`src/storage/saved-repos.ts`): SavedReposStore over an
  injectable KeyValueStore (chrome.storage.local in the panel,
  in-memory in tests); entries hold repoId, owner/repo, score,
  grade, coverage, confidence, fetchedAt, savedAt under
  `reporadar:savedRepos`; dedup by repoId (re-saving refreshes),
  hard cap of 50 with a clear refusal message, malformed stored
  entries ignored. Saved section lists score + grade + save date,
  opens a repo in place (cache-first re-analysis) and removes it.
- Compare (`src/compare/compare.ts`, pure): up to 3 repositories,
  same metric definitions; rows for overall, grade, coverage,
  confidence, all six categories, stars, forks, days since push
  (lower is better), contributor sample size, issue closure ratio
  (PRs excluded). Best value per row marked "★ Best" in text as
  well as style; null values can never be best; ties all win.
  Selecting a 4th repo is refused with "Compare is limited to 3
  repositories". Comparison runs getReport per repo cache-first,
  so no wasted API calls.
- Export (`src/export/json.ts`, `src/export/markdown.ts`,
  `src/export/download.ts`): Download JSON (full report + facts +
  languages + evidence + activity + model version + generatedAt,
  pretty-printed) and Download Markdown (score/grade/coverage/
  confidence, categories, observations, key evidence with sources,
  sampling notes, limitations) for the current report; Download
  comparison (Markdown) for the compare view. A provisional report
  exports "Not enough data" instead of a score. Downloads via the
  chrome.downloads API (`downloads` permission added — the only
  new permission) with an anchor/blob fallback and a surfaced
  error if both fail. Filenames like
  `reporadar-react-react-2026-11-13.json`.
- UI (Build 4 design system untouched otherwise): Save / Add to
  compare / Download JSON / Download Markdown actions on the score
  card, Saved section, compare table view. Evidence drawer and
  charts unchanged and still verified working.
- Tests: 102 unit tests (was 86; new markdown-export, compare,
  saved-repos suites — exact Markdown output, provisional
  "Not enough data", best-in-row incl. ties and nulls, 3-repo cap,
  save dedup/cap/removal). Browser verification 23/23, including
  downloaded files saved and content-checked (JSON carries the
  81.9 score + model version; Markdown carries the report title,
  grade and evidence sources).
- No scoring, provider or service behaviour changed.

## 0.1.0 — Build 4 (Professional UI) — 2026-11-13

- Design system (`src/shared/design.css`): CSS custom properties
  for colours, spacing, radius and typography, shared by the side
  panel and the popup. Light + dark themes; default follows the OS
  preference, manual toggle persists in `chrome.storage.local`
  (`reporadar:theme`), stored choice wins, invalid values fall back
  to the OS. Text labels accompany every colour-coded value.
- Side panel redesign (no scoring/provider/service changes): radial
  Recharts score gauge with grade/coverage/confidence; six category
  rows (keyboard-focusable buttons) opening an evidence drawer with
  exact value, source endpoint, observed-at, formula and limitation
  per signal — closes via button, Escape or backdrop, focus returns
  to the triggering row; weekly commit bars for the last 12 weeks
  from the 90-day sample (truncation labelled); language donut with
  a text legend; observations with text-safe markers; loading
  skeletons for the score hero and categories.
- Recharts 3.10.1 added; chart components lazy-loaded
  (`entrypoints/sidepanel/charts.tsx`) — the sidepanel entry chunk
  is 19.05 kB, the charts chunk 382.69 kB loads on demand. Total
  build 779.11 kB (was 375.30 kB in Build 3).
- Popup restyled on the same tokens and theme: shows the cached
  score summary (score, grade, coverage, confidence) when an
  analysis exists, plus Open analysis.
- Wiring only: `ANALYSIS_COMPLETE` now also carries the activity
  samples the report was scored from (service + background +
  message type); no scoring, provider or service behaviour changed.
- Tests: 86 unit tests (new `theme.test.ts`: stored choice wins
  over OS, invalid stored value falls back to OS). Fixed a
  time-bomb in `repository-service.test.ts`: the fixture's fixed
  `fetchedAt` had aged out of the 12-minute core TTL, so the
  "fresh cache" test started refetching — the mock now reports
  the current time. Browser verification 18/18.
- Known limitation: overview and report arrive in a single
  ANALYSIS_COMPLETE message, so progressive rendering is
  skeleton → full render rather than staged section streaming.

## 0.1.0 — Build 3 (Analytics + scoring v1) — 2026-11-13

- Scoring engine (`src/analysis/`): pure, deterministic, `nowMs`-
  parameterized. Model 1.0.0 weights Maintenance 25 / Community 20 /
  Issue & PR 20 / Release 15 / Docs 10 / Adoption 10; every formula
  documented in `scoring.ts` and the README. Missing signals are null
  (never 0); category = mean of available signals; overall = weighted
  sum over available categories, weights renormalized; coverage =
  available signal weight / total; confidence High ≥85 / Medium
  65–84 / Low <65, capped Medium on truncated samples; provisional
  (no overall score) below 40% coverage. Grades A–F.
- L2 observations (`observations.ts`): good / caution / unknown lists
  with exact evidence ("Pushed 4 days ago", "Top contributor wrote
  62% of commits"); archived repos get the hard observation
  "Archived — no longer maintained". Never claims secure/safe/
  production-ready/high-quality code.
- Provider extended with 7 activity endpoints (contributors,
  commits since 90d, releases, issues state=all with PRs split out,
  pulls state=all, community profile, CI via contents endpoint with
  404→absent). Zod schemas added; per-endpoint `truncated` flags.
- RepositoryService.getReport: overview + activity in parallel,
  activity cached 45 min, per-endpoint failure isolation, stale-cache
  fallback labelled stale. ANALYSIS_COMPLETE now carries
  `{ overview, report }`.
- Side panel shows a score card (overall, grade, coverage,
  confidence, provisional banner), six category bars with
  partial/unknown notes, observations, and sample notes.
- Tests: 82 unit tests (metrics, scoring, confidence, report
  service, 9-profile benchmark corpus in
  `tests/fixtures/benchmark-repos.json`). Browser verification 9/9.

## 0.1.0 — Build 2 (Data layer) — 2026-11-13

- Provider abstraction (`src/providers/types.ts`, `src/providers/registry.ts`):
  `RepoProvider` interface; GitHub is the only implementation. GitLab
  is the next platform (registry fails loudly with UNSUPPORTED_PLATFORM
  for gitlab.com today — never silently falls back to GitHub).
- Typed GitHub client (`src/providers/github/`): Zod schemas, rate-limit
  header parsing, bounded retries (429/5xx/network, backoff + jitter,
  Retry-After), request coalescing, ETag/304 support. No token in V1.
- Repository service (`src/services/repository-service.ts`): cache-first
  (TTL 12 min core / 45 min languages), parallel repo + languages fetch,
  partial failure (languages error -> repo still renders), stale-cache
  fallback labelled stale, evidence items with source/observedAt/limitation.
- Background worker now runs the service on ANALYZE_REPOSITORY and
  replies ANALYSIS_COMPLETE / ANALYSIS_ERROR; OPEN_PANEL (renamed from
  the Build 1 click message) only opens the panel.
- Side panel shows the real overview: metrics, badges, language bars,
  evidence list, rate-limit state, Cached/stale banners, Refresh
  (force), and graceful 404/rate-limit/offline error states with guidance.
- Tests: 32 unit tests (schemas, rate limit, cache, service incl. cache
  hit, force refresh, partial failure, 404, stale fallback). One-off live
  check against real api.github.com passed (react/react 252,573 stars,
  MIT, JavaScript top language, clean 404). Browser verification 8/8.
- Known limitation: Playwright route interception does not reach the
  service worker's fetch, so browser verification uses the cache path;
  live fetch is covered by the live check + owner live-Chrome test.

## 0.1.0 — Build 1 (GitHub detection) — 2026-11-13

- Repository URL parsing (`src/shared/repo-url.ts`): resolves
  `github.com/{owner}/{repo}` and repo sub-pages; ignores profiles,
  global routes and repo settings pages. 9 unit tests.
- Content script on `https://github.com/*`: detects context, stores
  last repo in `chrome.storage.local`, sends `REPOSITORY_CONTEXT`,
  injects a fixed-position “Analyze with RepoRadar” button, removes
  it off-repo. SPA navigation handled via history patching,
  popstate, title observation and a 500 ms URL check (the interval is
  the reliable signal — history patching in a content script only
  affects its isolated world, not the page's Turbo code).
- Side panel entrypoint (`entrypoints/sidepanel/`): shows the
  detected repository, GitHub link, and a Build 1 status note.
  Manifest now has the `sidePanel` permission and
  `side_panel.default_path`.
- Popup now shows the detected repository and an “Open analysis”
  button; background opens the side panel on `ANALYZE_REPOSITORY`
  (full-tab fallback if the Side Panel API is unavailable) and
  records panel-open failures in storage for diagnosis.
- Message contracts defined (`src/messaging/messages.ts`, spec §16.2).
- Browser verification: all 13 Build 1 checks passed in headless
  Chromium (detection, SPA in/out, profile/settings exclusion,
  storage, Analyze click with no panel-open error, side panel and
  popup rendering, no console errors). GitHub pages were served by
  Playwright route interception — see README note on live-GitHub
  verification.
- Note: after adding an entrypoint, run `npx wxt prepare` before
  `npm run typecheck`, or generated types go stale.

## 0.1.0 — Build 0 (Foundation) — 2026-11-13

- Scaffolded with WXT 0.21.5 + React 19 + TypeScript, Manifest V3.
- Stack locked: WXT (not Vite + CRXJS), Recharts for charts (Build 4),
  direct fetch + Zod for the GitHub client (Build 2).
- Manifest: name RepoRadar, `storage` permission, host permissions
  `https://github.com/*` and `https://api.github.com/*`.
- Toolbar popup opens with a Build 0 status card (dark theme default).
- Service worker registers; no long-lived global state.
- Tooling: `typecheck`, `lint`, `format`, `test` (Vitest) scripts;
  ESLint + Prettier configs; GitHub Actions CI (lint, type-check,
  tests, production build).
- Foundation unit test: product name, version, scoring model version.
- Known limitations: template placeholder icons; no detection, data,
  scoring, side panel, compare or export yet.
