# RepoRadar — QA checklist (Build 6, release candidate 0.2.0)

Spec §14/§15. Chrome is verified locally in this VM. **Edge and
Brave cannot be tested locally and are NOT verified** — the owner
steps below are the remaining gate before any store submission.
Do not claim Edge/Brave pass until they are run.

## Verified locally (Chromium 156, Playwright, 2026-11-13)

- Gates: typecheck, lint, unit tests, production build — all green
  (see CHANGELOG for the exact counts).
- Browser verifications, all passing:
  - verify-build0 — popup renders, service worker registers.
  - verify-build1 — detection, SPA navigation, profile/settings exclusion.
  - verify-build2 — data layer on the cache path, graceful offline error.
  - verify-build3 — scoring 94.3/A on the react-like fixture.
  - verify-build4 — gauge, drawer, theme toggle + persistence, charts.
  - verify-build5 — save (50-cap), compare ≤3, JSON/Markdown downloads.
  - verify-build6 — archived repo 18.1/F + banner + observation,
    truncated large repo 94.3 with confidence capped Medium,
    offline error state, popup footer Build 6 · 0.2.0, error-boundary
    fallback in the built bundle, icons at exact sizes.
- Live API: the GitHub client was validated against the real
  api.github.com in Build 2 (react/react, languages, clean 404).
  Local Chromium has no external internet, so all browser scripts
  verify the panel on the cache path; the live fetch path is covered
  by that check plus the owner's live-browser steps below.

## Not verified locally — owner steps (do before release)

### Chrome (real, signed-in browser)

1. `npm run build`, load `.output/chrome-mv3` unpacked.
2. Open a public repo (e.g. github.com/facebook/react), click
   "Analyze with RepoRadar", confirm the score, gauge, categories,
   evidence drawer, charts, and rate-limit line render.
3. Open an archived repo, confirm the Archived badge + observation.
4. Open a private repo you own, confirm the error state names the
   problem (GitHub returns 404 to unauthenticated callers for
   private repos; the panel's FORBIDDEN guidance is for 403s).
5. Leave the panel open past the 60/hour unauthenticated limit if
   practical, or force it with repeated Refreshes: confirm the
   reset countdown appears. (Known gap: Refresh is not disabled
   while exhausted — see README Known limitations, Build 6.)
6. Save a repo, compare two, download JSON + Markdown, confirm the
   files contain the score, coverage, evidence and limitations.

### Microsoft Edge (owner)

1. `npm run build`, open `edge://extensions`, Developer mode,
   Load unpacked → `.output/chrome-mv3`.
2. Repeat Chrome steps 2–6 in Edge. Note any side-panel API
   differences (Edge's sidePanel support has lagged Chrome's).
3. Confirm the toolbar popup opens and the theme toggle persists.

### Brave (owner)

1. Same unpacked load (Brave accepts Chrome Web Store extensions
   and unpacked Chromium extensions).
2. Repeat Chrome steps 2–6. Note any Shields interference with
   api.github.com calls (Shields is the known Brave-specific risk).

## Release checklist (spec §15)

- [x] All P0 functional requirements pass in Chrome (local).
- [x] Every score shows methodology + evidence trail in-app.
- [x] Privacy policy matches actual network/storage (this build).
- [x] No hardcoded secrets, tokens, or API keys in the tree.
- [x] No remotely hosted executable code.
- [x] Icons final (16/32/48/96/128, each drawn at its own size).
- [x] Version + changelog updated (0.2.0; see the manifest-version
      note in README — wxt.config.ts still says 0.1.0).
- [ ] Edge smoke test done (owner).
- [ ] Brave smoke test done (owner).
- [ ] Privacy policy page published to GitHub Pages (owner).
- [ ] Store screenshots captured at exact sizes (owner).
- [ ] Chrome Web Store + Edge Add-ons listings submitted.
