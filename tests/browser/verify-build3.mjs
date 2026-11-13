import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile3';
fs.rmSync(profile, { recursive: true, force: true });

// NOTE (same as Build 2): Playwright route interception does NOT
// reach an extension service worker's fetch, and local Chromium has
// no external internet. The live client was validated separately
// against the real api.github.com in Build 2, and the scoring engine
// is covered by 50 unit tests. This script verifies the panel end
// to end on the cache path: overview + activity seeded in
// chrome.storage.local, the score card renders, and the offline
// error state is still graceful.
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
async function waitForText(p, needle, timeout = 12000) {
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

// Seed FRESH repo + languages + activity caches for react/react.
// Activity mirrors the active-repo fixture: 200 contributors (top
// share 12%), 50 commits in 30 days by 12 authors, 6 releases,
// 20 open / 80 closed issues, 15 of 20 PRs merged, all docs files,
// CI present. Expected report: overall 94.3, grade A, coverage 100%,
// high confidence.
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const facts = {
    id: 'github:react/react', platform: 'github', owner: 'react', name: 'react', fullName: 'react/react',
    htmlUrl: 'https://github.com/react/react', description: 'The library for web and native user interfaces.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const languages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  const contributors = [{ login: 'lead', contributions: 240 }];
  for (let i = 1; i < 200; i++) contributors.push({ login: `dev${i}`, contributions: i === 1 ? 176 : 8 });
  const commits = [];
  for (let i = 0; i < 50; i++) {
    commits.push({ sha: `sha${i}`, authorLogin: `dev${i % 12}`, committedAt: isoDaysAgo((i % 30) + 0.5) });
  }
  const issues = [];
  for (let i = 0; i < 20; i++) issues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(20), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 80; i++) issues.push({ number: 21 + i, state: 'closed', createdAt: isoDaysAgo(30), closedAt: isoDaysAgo(5), isPullRequest: false });
  const pulls = [];
  for (let i = 0; i < 15; i++) pulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
  for (let i = 0; i < 5; i++) pulls.push({ number: 16 + i, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
  const activity = {
    contributors,
    commits,
    releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
    issues,
    pulls,
    communityProfile: { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 },
    ciWorkflowsPresent: true,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };
  return chrome.storage.local.set({
    'reporadar:cache:v1:github:react/react:repo': { value: facts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:react/react:languages': { value: languages, fetchedAt, etag: null },
    'reporadar:cache:v1:github:react/react:activity': { value: activity, fetchedAt, etag: null },
  });
}, now);

await page.goto('https://github.com/react/react', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
let text = await waitForText(panel, '94.3');
check('score card shows overall 94.3', text.includes('94.3'));
check('score card shows grade A Excellent', text.includes('A · Excellent'));
check('score card shows coverage 100% and high confidence', text.includes('Coverage 100%') && text.includes('High confidence'));
check('category bars show all six categories with scores', text.includes('Maintenance') && text.includes('Community') && text.includes('Issue & PR workflow') && text.includes('Release hygiene') && text.includes('Documentation & hygiene') && text.includes('Adoption context') && text.includes('81.5') && text.includes('92.3'));
check('observations show evidence-backed good signs', text.includes('50 commits in the last 30 days.') && text.includes('12 distinct contributors in the last 90 days.') && text.includes('6 releases in the last 12 months.'));
check('cached overview still renders below the score card', text.includes('Cached') && text.includes('252.6k') && text.includes('MIT'));
check('no provisional banner for a fully-scored repo', !text.includes('Not enough data to score'));

// Unknown repo, no cache, Chromium offline -> graceful network-error state.
await page.goto('https://github.com/unknown/nope', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, 'Could not reach GitHub', 15000);
check('offline unknown repo shows graceful error state', text.includes('Could not reach GitHub') && text.includes('Try again'));

check('no page/console errors during scoring run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'BUILD 3 BROWSER VERIFICATION FAILED' : 'BUILD 3 BROWSER VERIFICATION PASSED');
