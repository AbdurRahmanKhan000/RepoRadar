# RepoRadar — store listing (draft, Build 6)

Prepared for Chrome Web Store and Microsoft Edge Add-ons submission.
Do not submit until the privacy policy page is published (see below)
and the Edge/Brave smoke tests in `docs/qa-checklist.md` are done.

## Name

**RepoRadar** — kept knowingly by the owner (2026-11-13) after a name
check found at least five live exact-name "RepoRadar" products in the
GitHub-repo space. Search discoverability will suffer; the listing
copy below leans on "evidence" and "maintenance signals" to stand
apart. This is a public-web-search finding, not legal clearance.

## Category

- Chrome Web Store: **Productivity**
- Edge Add-ons: **Productivity**

## Short description (132 characters max — this is 131)

Evidence-based health scores for GitHub repos — every number traced to its source, nothing hidden.

## Long description

RepoRadar adds an evidence-based maintenance layer to public GitHub
repositories. Open any public repo and the side panel shows a
transparent 0–100 health score with the exact evidence behind every
number: when it was last pushed, how releases, issues and pull
requests behave, how concentrated the contributors are, whether the
docs and CI files exist — and what could _not_ be concluded from the
available data.

What makes it different:

- **Evidence first.** Every score links to its raw metric, source
  endpoint, collection time, formula and limitation. No black box.
- **Honest about limits.** Missing data lowers coverage and is shown
  as unknown — never silently scored 0 or 100. Below 40% coverage
  there is no score at all, just "not enough data".
- **Compare up to 3 repos** on the same metric definitions, with
  missing-data warnings per column.
- **Save repos locally and export reports** as JSON or Markdown,
  with methodology, timestamps and the score-model version included.
- **Local-first and private.** No account, no backend, no analytics,
  no telemetry. RepoRadar talks directly to GitHub's public API from
  your browser and stores everything on your device.

A score is an evidence-based heuristic about observable maintenance
signals. It is not proof of code quality, security, or safety, and
RepoRadar never claims otherwise.

## Search terms (7)

1. github repository health
2. repo maintenance score
3. github analyzer
4. open source due diligence
5. repository evidence
6. github side panel
7. repo comparison

## Permissions and why (shown in the listing)

- `storage` — settings, cached analyses, saved repositories.
- `sidePanel` — the analysis panel beside GitHub.
- `downloads` — saving JSON/Markdown report exports.
- `https://github.com/*` — detecting the repository you are viewing.
- `https://api.github.com/*` — reading public repository metadata.

RepoRadar runs only on GitHub. It never touches other websites.

## Screenshots plan (capture from the real extension in a real browser)

Chrome Web Store: 1280×800 (or 640×400). Edge Add-ons: 1366×768
recommended. One image per shot, drawn from a live run — never
mocked or resized from another size:

1. Side panel on a public repo — score gauge, grade, coverage, confidence.
2. Evidence drawer open on one category (value, source, formula, limitation).
3. Compare view — two repos side by side with best-in-row marks.
4. Commit activity chart + language donut.
5. Light theme panel (same repo as shot 1, for the theme contrast).

## Privacy policy URL (publish before submitting)

`https://abdurrahmankhan000.github.io/RepoRadar/privacy-policy.html`
— publish `docs/privacy-policy.md` to GitHub Pages from the RepoRadar
repository first (same pattern as CodeSnag). Until it is live, the
store submission cannot be completed.

## Support contact

arkmfk27@gmail.com (contact email on the author's GitHub profile).
