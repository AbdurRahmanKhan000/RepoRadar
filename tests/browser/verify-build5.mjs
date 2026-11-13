import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile5';
fs.rmSync(profile, { recursive: true, force: true });

// NOTE (same as Builds 2–4): Playwright route interception does NOT
// reach an extension service worker's fetch, and local Chromium has
// no external internet. The live client was validated against the
// real api.github.com in Build 2, and scoring is covered by unit
// tests. This script verifies Build 5 end to end on the cache path:
// save, saved list, compare (3-repo cap, best marking), export
// buttons, open-saved and remove — all from seeded caches.
// Downloads: chrome.downloads in an extension page may not surface
// as a Playwright download event; the script tries waitForEvent and
// records honestly whether a download surfaced. The generated
// content itself is verified exactly by the unit tests.
const context = await chromium.launchPersistentContext(profile, {
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--no-sandbox', '--disable-gpu'],
});
await context.route('https://github.com/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head><title>GitHub</title></head><body><h1>Fake GitHub page</h1></body></html>' });
});

const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

function check(name, cond) {
  console.log((cond ? 'OK: ' : 'FAIL: ') + name);
  if (!cond) process.exitCode = 1;
}
async function waitForText(p, needle, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed FRESH repo + languages + activity caches for four repos:
// react/react (active, expected 94.3), test/tiny (~30.8),
// test/old (archived, ~18.1), test/plain (active, no releases, ~81.9).
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const seed = (owner, repo, facts, activity) => {
    const langs = { entries: [{ name: 'TypeScript', bytes: 900, percent: 90 }], totalBytes: 1000, fetchedAt };
    const out = {};
    out[`reporadar:cache:v1:github:${owner}/${repo}:repo`] = { value: facts, fetchedAt, etag: null };
    out[`reporadar:cache:v1:github:${owner}/${repo}:languages`] = { value: langs, fetchedAt, etag: null };
    out[`reporadar:cache:v1:github:${owner}/${repo}:activity`] = { value: activity, fetchedAt, etag: null };
    return out;
  };
  const factsFor = (owner, repo, o) => ({
    id: `github:${owner}/${repo}`, platform: 'github', owner, name: repo, fullName: `${owner}/${repo}`,
    htmlUrl: `https://github.com/${owner}/${repo}`, description: 'Seeded repo.',
    stars: 0, forks: 0, watchers: 0, openIssuesCount: 0, primaryLanguage: 'TypeScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: isoDaysAgo(365),
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt, ...o,
  });
  const fullCommunity = { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 };
  const activityFor = (o) => ({
    contributors: [], commits: [], releases: [], issues: [], pulls: [],
    communityProfile: fullCommunity, ciWorkflowsPresent: true,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {}, fetchedAt, ...o,
  });
  const contrib = (total, topShare) => {
    const totalC = total * 10;
    const top = Math.max(1, Math.round(totalC * topShare));
    const rest = totalC - top;
    const per = total > 1 ? Math.floor(rest / (total - 1)) : 0;
    const list = [{ login: 'lead', contributions: top }];
    for (let i = 1; i < total; i++) list.push({ login: `dev${i}`, contributions: per });
    if (total > 1) list[1].contributions += totalC - list.reduce((s, c) => s + c.contributions, 0);
    return list;
  };
  const commits = (count, span, authors) => Array.from({ length: count }, (_, i) => ({
    sha: `sha${i}`, authorLogin: `dev${i % authors}`, committedAt: isoDaysAgo((i % span) + 0.5),
  }));
  const issues = (open, closed, age) => [
    ...Array.from({ length: open }, (_, i) => ({ number: i + 1, state: 'open', createdAt: isoDaysAgo(age), closedAt: null, isPullRequest: false })),
    ...Array.from({ length: closed }, (_, i) => ({ number: open + i + 1, state: 'closed', createdAt: isoDaysAgo(age + 10), closedAt: isoDaysAgo(5), isPullRequest: false })),
  ];
  const pulls = (merged, unmerged) => [
    ...Array.from({ length: merged }, (_, i) => ({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) })),
    ...Array.from({ length: unmerged }, (_, i) => ({ number: merged + i + 1, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) })),
  ];

  const activeActivity = activityFor({
    contributors: contrib(200, 0.12),
    commits: commits(50, 30, 12),
    releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
    issues: issues(20, 80, 20),
    pulls: pulls(15, 5),
  });
  const all = {
    ...seed('react', 'react',
      // pushedAt = now (as in verify-build4) gives 94.3; 1 day ago gives 94.2.
      factsFor('react', 'react', { stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript' }),
      activeActivity),
    ...seed('test', 'tiny',
      factsFor('test', 'tiny', { stars: 3, forks: 0, watchers: 3, pushedAt: isoDaysAgo(2) }),
      activityFor({
        contributors: contrib(1, 1),
        commits: commits(3, 30, 1),
        communityProfile: { readme: true, license: false, contributing: false, codeOfConduct: false, issueTemplate: false, pullRequestTemplate: false, healthPercentage: 15 },
        ciWorkflowsPresent: false,
      })),
    ...seed('test', 'old',
      factsFor('test', 'old', { stars: 500, forks: 40, watchers: 500, openIssuesCount: 8, pushedAt: isoDaysAgo(900), archived: true, createdAt: isoDaysAgo(1825) }),
      activityFor({
        contributors: contrib(5, 0.6),
        releases: [{ tagName: 'v1.0.0', publishedAt: isoDaysAgo(800) }],
        issues: issues(8, 2, 400),
        communityProfile: { readme: true, license: true, contributing: false, codeOfConduct: false, issueTemplate: false, pullRequestTemplate: false, healthPercentage: 30 },
        ciWorkflowsPresent: false,
      })),
    ...seed('test', 'plain',
      factsFor('test', 'plain', { stars: 250000, forks: 50000, watchers: 250000, openIssuesCount: 20, pushedAt: isoDaysAgo(1) }),
      { ...activeActivity, releases: [] }),
  };
  return chrome.storage.local.set(all);
}, now);

async function saveCurrent(panel, label) {
  await panel.getByRole('button', { name: 'Save this repo' }).click();
  const text = await waitForText(panel, 'Saved ✓');
  check(`save ${label}: button flips to Saved`, text.includes('Saved ✓'));
}

await page.goto('https://github.com/react/react', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
let text = await waitForText(panel, '94.3');
check('react/react report loads (94.3)', text.includes('94.3'));

// Save react/react.
await saveCurrent(panel, 'react/react');
text = await panel.evaluate(() => document.body.innerText);
check('Saved section lists react/react with score', text.includes('Saved repositories (1/50)') && text.includes('94.3'));

// Save test/tiny.
await page.goto('https://github.com/test/tiny', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, 'test/tiny');
await saveCurrent(panel, 'test/tiny');
text = await panel.evaluate(() => document.body.innerText);
check('Saved section lists 2 repos', text.includes('Saved repositories (2/50)'));

// Save test/old and test/plain.
await page.goto('https://github.com/test/old', { waitUntil: 'domcontentloaded' });
await waitForText(panel, 'test/old');
await saveCurrent(panel, 'test/old');
await page.goto('https://github.com/test/plain', { waitUntil: 'domcontentloaded' });
await waitForText(panel, 'test/plain');
await saveCurrent(panel, 'test/plain');
text = await panel.evaluate(() => document.body.innerText);
check('Saved section lists 4 repos', text.includes('Saved repositories (4/50)'));

// Compare: select 3, then attempt a 4th.
await panel.check('input[aria-label="Select react/react for comparison"]');
await panel.check('input[aria-label="Select test/tiny for comparison"]');
await panel.check('input[aria-label="Select test/old for comparison"]');
// The 4th click is refused by design, so the checkbox state does
// not change — page.check() would throw on that, use click().
await panel.click('input[aria-label="Select test/plain for comparison"]');
text = await panel.evaluate(() => document.body.innerText);
const plainChecked = await panel.evaluate(() => document.querySelector('input[aria-label="Select test/plain for comparison"]').checked);
check('4th selection refused with limit message', text.includes('Compare is limited to 3 repositories') && plainChecked === false);

await panel.getByRole('button', { name: /^Compare \(3 selected\)/ }).click();
text = await waitForText(panel, 'Overall score');
check('compare table renders with all three repos', text.includes('react/react') && text.includes('test/tiny') && text.includes('test/old'));
check('compare table highlights a best value', text.includes('★ Best'));
check('compare table shows overall scores', text.includes('94.3') && text.includes('18.1'));
check('compare table has all six category rows', ['Maintenance', 'Community', 'Issue & PR workflow', 'Release hygiene', 'Documentation & hygiene', 'Adoption context'].every((l) => text.includes(l)));

// Download comparison (Markdown): observe the download, save it,
// and verify its actual content.
fs.mkdirSync('/tmp/rr-downloads5', { recursive: true });
async function downloadAndCheck(buttonName, savePath, mustContain) {
  const dl = panel.waitForEvent('download', { timeout: 8000 });
  await panel.getByRole('button', { name: buttonName, exact: true }).click();
  const download = await dl;
  await download.saveAs(savePath);
  const content = fs.readFileSync(savePath, 'utf8');
  return mustContain.every((needle) => content.includes(needle));
}

let compareDownloadOk = false;
try {
  compareDownloadOk = await downloadAndCheck(
    'Download comparison (Markdown)',
    '/tmp/rr-downloads5/comparison.md',
    ['# RepoRadar comparison', 'react/react', 'test/tiny', 'Overall score', '★ Best', '94.3', '18.1'],
  );
  console.log('  comparison download saved to /tmp/rr-downloads5/comparison.md');
} catch (e) {
  console.log('  NOTE: comparison download did not surface:', String(e).slice(0, 120));
}
text = await panel.evaluate(() => document.body.innerText);
check('comparison export downloads with correct content', compareDownloadOk);
check('comparison export produces no error', !text.includes('Export failed'));

// Back to the report, then export JSON + Markdown for the current
// repo (test/plain, 81.9) and verify the downloaded content.
await panel.getByRole('button', { name: 'Back to report' }).click();
await waitForText(panel, 'Download JSON');
let jsonOk = false;
try {
  jsonOk = await downloadAndCheck('Download JSON', '/tmp/rr-downloads5/report.json', [
    '"overallScore": 81.9',
    '"scoreModelVersion": "1.0.0"',
    '"repoId": "github:test/plain"',
    'not proof of code quality',
  ]);
} catch (e) {
  console.log('  NOTE: JSON download did not surface:', String(e).slice(0, 120));
}
check('Download JSON downloads with correct content', jsonOk);
let mdOk = false;
try {
  mdOk = await downloadAndCheck('Download Markdown', '/tmp/rr-downloads5/report.md', [
    '# RepoRadar report: test/plain',
    '**Score:** 81.9 / 100, grade B',
    '**Coverage:**',
    'GET /repos/{owner}/{repo}',
    'not proof of code quality, security, or safety',
  ]);
} catch (e) {
  console.log('  NOTE: Markdown download did not surface:', String(e).slice(0, 120));
}
check('Download Markdown downloads with correct content', mdOk);
text = await panel.evaluate(() => document.body.innerText);
check('report exports produce no error', !text.includes('Export failed'));

// Open a saved repo in place, then remove one.
await panel.getByRole('button', { name: 'test/tiny', exact: true }).click();
text = await waitForText(panel, '30.8');
check('opening a saved repo re-analyzes it in place (30.8)', text.includes('30.8'));
await panel.getByRole('button', { name: 'Remove test/plain from saved repositories' }).click();
text = await waitForText(panel, 'Saved repositories (3/50)');
check('removing a saved repo updates the list', text.includes('Saved repositories (3/50)'));

// Saved list persists in storage.
const stored = await sw.evaluate(() => chrome.storage.local.get('reporadar:savedRepos').then((r) => r['reporadar:savedRepos']));
check('saved repos persist in chrome.storage.local', Array.isArray(stored) && stored.length === 3);

check('no page/console errors during Build 5 run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'BUILD 5 BROWSER VERIFICATION FAILED' : 'BUILD 5 BROWSER VERIFICATION PASSED');
