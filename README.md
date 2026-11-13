# RepoRadar

Evidence-based repository intelligence for GitHub — a Chromium browser
extension (Manifest V3) that adds a transparent maintenance-signal layer
to public GitHub repositories.

> **A score is an evidence-based heuristic, not an objective measure of
> code quality, security, business viability, or suitability for every
> use case.** RepoRadar shows exactly which evidence produced each score
> and what cannot be concluded from the available data.

Full specification: `RepoRadar_Development_Specification.docx`, v1.0,
13 November 2026. Working name — before public release, perform a
trademark, domain, GitHub organization, Chrome Web Store and Edge
Add-ons name search. Similar names and products already exist.

## Status

**Fixes 0.2.1 — owner-reported bugs, fixed and verified.**
After testing 0.2.0 in his live Chrome, the owner found the panel
would not open and every repo failed with "Could not reach GitHub".
Both are fixed in 0.2.1:
- **Panel opens.** `sidePanel.open()` needs the user gesture in the
  context where the click happened. The popup and the "Analyze with
  RepoRadar" button now call it directly; the background message
  route remains only as a fallback (full-tab fallback when the API
  is unavailable).
- **The "Could not reach GitHub" error was a code bug, not the
  owner's network.** `GitHubApiClient` called `fetch` as a method
  of itself (`this.fetchFn(...)`), which throws "Illegal invocation"
  in a service worker — so every request failed, even online. The
  client now binds `fetch` to the global scope, and a regression
  test with a receiver-sensitive fetch guards it. Verified against
  the live api.github.com after the fix.
- **Failures are now diagnosable.** The raw fetch failure is
  threaded through to the error card ("Technical detail:
  TypeError: Failed to fetch"), with a "Copy diagnostics" button
  (repo, error, detail, time, extension version — no tokens or
  personal data) and a "Test connection" button that probes
  api.github.com and github.com separately from the background
  worker and reports the raw outcome per host. If github.com
  answers but api.github.com does not, the panel says so plainly:
  the API host looks blocked, not the whole connection. The
  diagnostics prove reachability; they cannot unblock a host.
- **New premium logo.** The "RR" monogram is gone from both
  headers — they show the real logo image. The radar mark was
  redesigned (glassy scope, glowing rings, sweep, signal blip) and
  redrawn as vector SVG per size, with fresh PNGs at exactly
  16/32/48/96/128 px.
- **Popup footer removed** at the owner's request.

**Build 6 — Hardening, cross-browser QA, packaging — done and verified.**
Builds 0–5 are also done. This is the first packaged release
candidate (0.2.0): final radar icons, an error boundary around the
side panel and popup, hardened repository-URL validation, verified
handling of archived / huge (sample-truncated) / rate-limited /
offline repositories, store listing + privacy policy drafts, and a
QA checklist. Chrome is verified locally; **Edge and Brave are not
verified** — see `docs/qa-checklist.md` for the exact owner steps.

**Build 5 — Compare, save, export — done and verified.**
Builds 0–4 are also done. The side panel now has a Save toggle on the
current report, a Saved repositories section (score + grade + save
date, open in place, remove, capped at 50 with a clear note at the
cap), comparison of up to 3 repositories in a side-by-side table
(overall, grade, coverage, confidence, all six categories, stars,
forks, days since push, contributor sample, issue closure — best
value in each row marked "★ Best" in text as well as style), and
JSON + Markdown export of the current report and Markdown export of
a comparison. Exports always carry coverage, confidence, evidence
sources and limitations; a provisional report exports "Not enough
data" instead of a number. Downloads use the chrome.downloads API
with an anchor/blob fallback, and a failed export shows an error
instead of failing silently.
Builds 0–3 are also done. The side panel is a full professional UI
on the Build 3 engine: a radial score gauge with grade, coverage and
confidence; six category rows that open an evidence drawer (exact
value, source endpoint, observed-at time, formula, limitation per
signal); a weekly commit-activity chart for the last 12 weeks from
the 90-day sample (labelled as a sample when truncated); a language
donut with a text legend; good / possible concern / could-not-conclude
observations; and the repository overview, evidence list, and
rate-limit state — all on a shared design-token system.

### Themes (Build 4)

Light and dark themes. The default follows the OS preference
(`prefers-color-scheme`); a Theme toggle in the panel header (and in
the popup) switches explicitly and persists the choice in
`chrome.storage.local` under `reporadar:theme`. A stored choice wins
over the OS; an invalid or missing value falls back to the OS.
Both themes use the same tokens (`src/shared/design.css`) and keep
text labels next to every colour-coded value, so no meaning is
conveyed by colour alone. Keyboard: every category row is a button,
the drawer closes with Escape or the backdrop and returns focus to
its row, and focus is always visible.

### Scoring model v1.0.0 (spec §6.1)

Weights: Maintenance 25%, Community 20%, Issue & PR workflow 20%,
Release hygiene 15%, Documentation & hygiene 10%, Adoption context
10%. Every signal is scored 0–100 or null when its evidence is
missing — missing is never silently 0. Category score = mean of its
available signals; overall = weighted sum over available categories
only, weights renormalized. Coverage = weight of available signals /
total signal weight (signal weight = category weight / signals in
category). Confidence: High ≥85%, Medium 65–84%, Low <65%, capped at
Medium when any endpoint returned a full page (sample truncated).

Formulas (all pure and deterministic — scoring takes `now` as a
parameter; see `src/analysis/scoring.ts` for the full list):

- Maintenance: days since push → 100·exp(−days/120); commits in the
  last 30 days → 100·log₁₀(1+n)/log₁₀(21), capped 100.
- Community: contributors → 100·log₁₀(1+n)/log₁₀(101); concentration
  → 100·(1 − top contributor share); distinct committers in 90 days
  → 0/1/2–3/4–9/10+ maps to 0/30/60/85/100.
- Issue & PR: issue closure ratio → ratio·100; median open-issue age
  → 100·exp(−days/180); PR merge ratio → merged/(merged+closed
  unmerged)·100, null when no PRs in the sample.
- Release: days since latest release → 100·exp(−days/180), null when
  no releases; releases in 12 months → 0/1/2–3/4+ maps to 10/50/75/100
  (0 releases is evidence of poor release hygiene, not missing data).
- Docs: README, license, CONTRIBUTING, code of conduct, issue
  template, PR template, CI workflows in `.github/workflows` — each
  present 100 / absent 0 / uncheckable null.
- Adoption: stars → 100·log₁₀(1+stars)/log₁₀(10001); forks →
  100·log₁₀(1+forks)/log₁₀(1001), both capped 100.

### Sample limits (spec §10.1)

One page per endpoint: contributors 100, commits 100 (since 90 days
ago), releases 20, issues 100 (state=all, PRs split out via the
`pull_request` field), pulls 100 (state=all), community profile 1
call, CI via `GET /contents/.github/workflows` (404 = absent, other
errors = unknown). A page returning exactly its limit is recorded as
truncated and caps confidence at Medium. Activity data is cached 45
min (core metadata 12 min, languages 45 min). One failed activity
endpoint yields null signals for its category — never a blank report.

Verification: 82 unit tests pass, including exact-score fixtures
(active react-like repo 94.2/A, archived repo 18.1/F, tiny new repo
30.8/F, no-release active repo 81.9/B, truncated-sample and
provisional cases, determinism, and a 9-profile benchmark corpus in
`tests/fixtures/benchmark-repos.json` asserting each profile lands in
its expected grade band — the seed of the §14.3 corpus, which grows
to ≥30 real repos in Build 6). Browser verification
(`tests/browser/verify-build3.mjs`) passed 9/9: score card 94.3/A,
all six category bars, evidence-backed observations, Cached banner,
graceful offline error state. Note: Playwright route interception
does not reach an extension service worker's fetch, and local
Chromium has no external internet, so the browser script verifies the
panel on the cache path — the live fetch path was covered by the
Build 2 live api.github.com check and by the owner's live-Chrome
test before release.

Architecture (multi-platform, per the owner's 2026-11-13 direction):
every platform implements `RepoProvider` (`src/providers/types.ts`);
the UI and the scoring engine only talk to that interface. GitHub is
the only provider in Build 2; GitLab is next, then other Git-hosting
platforms. The extension runs only on GitHub (and, later, GitLab and
other Git hosts) — never on other websites.

Data layer details: typed GitHub client with Zod-validated payloads,
rate-limit header parsing, bounded retries (429/5xx/network only,
exponential backoff + jitter, Retry-After respected), request
coalescing, ETag/304 support, and a TTL cache (core metadata 12 min,
languages 45 min) in `chrome.storage.local` behind a `CacheStore`
interface. One failed endpoint never blanks the panel: a languages
failure returns the repo with a recorded error, and a repo failure
with a stale cache returns the cached facts labelled stale.
No token in V1 — unauthenticated, 60 requests/hour.

Verification (Build 2): 32 unit tests passed at the time; a one-off
live check against the real api.github.com passed (react/react,
languages, 404); browser verification
(`tests/browser/verify-build2.mjs`) passed 8/8. Note: Playwright
route interception does not reach an extension service worker's
fetch, and local Chromium has no external internet, so the browser
script verifies the panel on the cache path plus the graceful offline
error state — the live fetch path is covered by the live check and by
the owner's live-Chrome test before release.

Detection rule: `github.com/{owner}/{repo}` and its sub-pages
(including issues/pulls) resolve to that repository; profile pages,
global `/issues`, `/settings`, `/explore` and similar routes, and
repository settings pages, do not. See `src/shared/repo-url.ts`
and `tests/unit/repo-url.test.ts`.

Browser verification: `tests/browser/verify-build0.mjs` and
`tests/browser/verify-build1.mjs` (Playwright + headless Chromium).
Note: local Playwright Chromium has no external internet in this VM,
so Build 1 verification serves github.com pages via Playwright route
interception with the real URL/host/path — live-GitHub checking in a
real Chrome/Edge remains an owner step before release.

Build plan (spec §13): 0 Foundation · 1 GitHub detection · 2 Data layer ·
3 Analytics engine · 4 Professional UI · 5 Compare and export ·
6 Hardening and browser QA · 7 Optional advanced intelligence.

## Stack (locked, spec §11)

- TypeScript + React 19, Manifest V3
- **WXT** (chosen over Vite + CRXJS — one build system, MV3 + side
  panel + HMR handled)
- Charts: Recharts (chosen, arrives Build 4) — not installed in Build 0
- API validation: Zod (arrives Build 2) — not installed in Build 0
- Tests: Vitest · Lint/format: ESLint + Prettier · CI: GitHub Actions
- No backend in V1. Local-first: `chrome.storage` for settings,
  IndexedDB for cache/history (arrives Build 2).

## Develop

```bash
npm install
npm run dev        # WXT dev server with reload
npm run build      # production build -> .output/chrome-mv3
npm run zip        # production build + store ZIP
npm run typecheck  # tsc --noEmit
npm run lint
npm run test       # vitest run
```

## Load unpacked (Chrome / Edge / Brave)

1. `npm run build`
2. Open `chrome://extensions` (or `edge://extensions`), enable
   Developer mode.
3. **Load unpacked** → select `.output/chrome-mv3`.
4. Click the RepoRadar toolbar icon — the Build 0 popup opens.
   The service worker must register with no console errors.

## Permissions (spec §12.1)

- `storage` — settings, cache references, saved repositories.
- `https://github.com/*` — repository-context detection (Build 1).
- `https://api.github.com/*` — GitHub REST API calls (Build 2).

No broad host access, no `activeTab`, no alarms/notifications, no
identity/OAuth in V1. No account, no telemetry, no backend.

### Hardening (Build 6)

- **Error boundary** (`src/shared/ErrorBoundary.tsx`) wraps the side
  panel and popup: a render crash shows "Something went wrong" with
  a Try again action (a reload) instead of a blank surface. Verified
  by unit tests with client rendering — React's server renderers do
  not honour error boundaries for a synchronously throwing child,
  so that path was tested in jsdom, which matches the browser.
- **URL validation** (`src/shared/repo-url.ts`): owner/repo segments
  must match GitHub's name rules (owner 1–39 chars, letters/digits/
  hyphens; repo 1–100 chars, letters/digits/dots/hyphens/
  underscores). This rejects percent-encoded traversal, over-long
  segments, control characters, and non-folding homograph hosts in
  one place. (A fullwidth host folds to `github.com` under IDNA, as
  the browser itself does — resolving it is correct.)
- **Rate-limit exhaustion** is handled end to end at the client and
  service layers (403 with no budget → RATE_LIMITED, reset time
  attached, bounded retries respect Retry-After) and covered by
  unit tests. The live countdown text in the panel is verified at
  unit/service level only — local Chromium has no external internet,
  so a live 429 cannot be produced here; the owner's live-Chrome
  check in `docs/qa-checklist.md` is the final step.
- **Final icons** in `public/icon/`: a navy/teal radar mark, each
  size drawn natively at its own size from a vector source
  (`public/icon/src/icon-{16,32,48,96,128}.svg`, rendered by
  Chromium's vector renderer and cropped — never resized from a
  raster master). Verified dimensions and legibility at 16 px.

## Known limitations (Build 6)

- **Manifest version lag:** `package.json` and
  `src/shared/constants.ts` are 0.2.0, but `wxt.config.ts` still
  pins the manifest version to 0.1.0 — it was frozen while Build 5
  landed, so the built `manifest.json` says 0.1.0. One line to fix
  (`version: '0.2.0'` in `wxt.config.ts`) before store submission.
- **Rate-limit UX gaps (found in Build 6, not fixed — App.tsx was
  frozen while Build 5 landed):** (1) Refresh stays enabled when
  the rate limit is exhausted — the panel shows the reset countdown
  when rate-limit data is present, but the button is not disabled;
  (2) on a RATE_LIMITED error the "Try again" button force-refreshes,
  which re-hits the limit, while the guidance says to wait or use
  cached data.
- **Edge and Brave are untested** — no Edge/Brave browser is
  available in this VM. Owner steps are in `docs/qa-checklist.md`.
- **Private repos:** GitHub returns 404 to unauthenticated callers
  for private repos, so the panel reports "not found" rather than
  "private" — the FORBIDDEN guidance covers real 403s (secondary
  limits, blocked requests). Private-repo support needs the optional
  token in Build 7.
- No AI explanation or PAT yet (Build 7, only if approved).
- Scores are computed from bounded samples (see Sample limits above),
  never from full history — and they are maintenance-signal
  heuristics, never proof of code quality, security, or safety.
- Scoring model version pinned in `src/shared/constants.ts`:
  `SCORE_MODEL_VERSION = '1.0.0'` (spec §6.1).
