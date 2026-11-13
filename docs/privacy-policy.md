# RepoRadar Privacy Policy

Effective: 13 November 2026 · Version 0.2.0

RepoRadar is a local-first browser extension. It has no account
system, no backend server, no analytics, and no telemetry. This
policy describes exactly what the extension does with data.

## What RepoRadar collects

**Nothing about you.** RepoRadar does not collect, store, or transmit
your identity, your browsing history, the contents of pages other
than GitHub repository pages you choose to analyse, or any analytics
or crash data.

## Network requests

When you analyse a repository, RepoRadar calls GitHub's public REST
API (`https://api.github.com`) directly from your browser to read
public repository metadata: repository facts, language breakdown,
contributors, commits, releases, issues, pull requests, community
profile, and CI workflow presence. No other network destination is
contacted. No data is sent to any RepoRadar server — there is none.

GitHub receives the repository names you analyse and your IP address,
as with any direct request to GitHub. GitHub's own privacy policy
applies to those requests.

No GitHub token is used in this version, so requests are
unauthenticated and subject to GitHub's 60-requests-per-hour limit.
A future version may offer an optional token you supply yourself;
it would be stored only on your device and sent only to GitHub.

## What is stored on your device

All data lives in your browser's local extension storage
(`chrome.storage.local`) and never leaves the device:

- **Cached analyses** — repository facts, language breakdowns, and
  activity samples, with the time they were fetched. Core data
  expires after 12 minutes, activity data after 45 minutes.
- **Saved repositories** — the repos you explicitly save, with their
  last score, grade, coverage, and the time they were saved.
  Capped at 50. You can remove any entry at any time.
- **Theme choice** — light or dark, if you change it from the
  operating-system default.
- **Last viewed repository** — owner and name, so the panel can
  reopen on the repo you were looking at.

There is no cloud sync. Uninstalling the extension deletes all of it.

## Exports

If you download a report (JSON or Markdown), the file is written to
your own downloads folder by your browser. RepoRadar does not keep
a copy and does not upload it anywhere.

## Permissions

- `storage` — the local data listed above.
- `sidePanel` — showing the analysis panel.
- `downloads` — saving the exports you request.
- `https://github.com/*` — detecting the repository page you are on.
- `https://api.github.com/*` — the GitHub API calls above.

## Changes

If this policy changes, the new version will ship with the extension
update and the effective date above will change.

## Contact

Abdur Rahman Khan — arkmfk27@gmail.com
