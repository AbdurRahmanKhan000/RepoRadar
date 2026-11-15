import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile-v03';
fs.rmSync(profile, { recursive: true, force: true });

// 0.3.0 "Trust" verification:
//  (a) verdict banner renders with reasons in ALL FOUR states
//      (Use it / Use with caution / Stay away / Not enough data).
//  (b) supply-chain section renders with seeded OSV data
//      (vulnerability list + risk label + counts).
//  (c) trajectory chart + trend label render with seeded 52-week data.
//  (d) popup Save/Remove toggle works.
//  (e) regression: verify-build4, verify-build5, verify-build6,
//      verify-fixes all still pass.
//  (f) zero page/console errors.
// Same constraint as earlier builds: Playwright interception does
// not reach the service worker's fetch and local Chromium has no
// external internet, so the panel is verified on the cache path
// (seeded via the service worker). The live OSV / GitHub /
// deps.dev paths are covered by the one-off live checks.
const context = await chromium.launchPersistentContext(profile, {
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--no-sandbox', '--disable-gpu'],
});
await context.route('https://github.com/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head><title>GitHub</title></head><body><h1>Fake GitHub page</h1></body></html>' });
});

const errors = [];
function watch(p) {
  p.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
}
const page = await context.newPage();
watch(page);

function check(name, cond) {
  console.log((cond ? 'OK: ' : 'FAIL: ') + name);
  if (!cond) process.exitCode = 1;
}
async function waitForText(p, needle, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}

async function waitForGone(p, needle, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (!t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed caches for five repos: huge (Use it), declining (caution),
// archived (Stay away), tiny (Not enough data), vuln (supply chain).
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const weekSecondsAgo = (weeks) => Math.floor((Date.now() - weeks * 7 * 86_400_000) / 1000);
  /** 52 weeks of commit activity from a totals array (oldest first). */
  const commitActivity = (totals) => totals.map((total, i) => {
    const base = Math.floor(total / 7);
    const days = [base, base, base, base, base, base, base];
    days[0] += total - base * 7;
    return { week: weekSecondsAgo(51 - i), total, days };
  });
  // Growing: stepped acceleration (20×2, 12×5, 12×12, 8×40) —
  // slope ≈ +0.69, momentum ≈ 1.54 → Growing, forecast ≈ 48.3.
  const growing = commitActivity([
    ...Array.from({ length: 20 }, () => 2),
    ...Array.from({ length: 12 }, () => 5),
    ...Array.from({ length: 12 }, () => 12),
    ...Array.from({ length: 8 }, () => 40),
  ]);
  // Declining: 60, 59, …, 9 — slope −1, momentum ≈ 0.64.
  const falling = commitActivity(Array.from({ length: 52 }, (_, i) => 60 - i));

  const baseFacts = (owner, repo, overrides) => ({
    id: `github:${owner}/${repo}`, platform: 'github', owner, name: repo, fullName: `${owner}/${repo}`,
    htmlUrl: `https://github.com/${owner}/${repo}`, description: 'Seeded fixture.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt, ...overrides,
  });
  const languages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  const baseActivity = (commitWeeks) => {
    const commits = [];
    for (let i = 0; i < 50; i++) commits.push({ sha: `sha${i}`, authorLogin: `dev${i % 12}`, committedAt: isoDaysAgo((i % 30) + 0.5) });
    const issues = [];
    for (let i = 0; i < 20; i++) issues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(20), closedAt: null, isPullRequest: false });
    for (let i = 0; i < 80; i++) issues.push({ number: 21 + i, state: 'closed', createdAt: isoDaysAgo(30), closedAt: isoDaysAgo(5), isPullRequest: false });
    const pulls = [];
    for (let i = 0; i < 15; i++) pulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
    for (let i = 0; i < 5; i++) pulls.push({ number: 16 + i, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
    const contributors = [{ login: 'lead', contributions: 120 }];
    for (let i = 1; i < 100; i++) contributors.push({ login: `dev${i}`, contributions: 8 });
    return {
      contributors, commits,
      releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
      issues, pulls,
      communityProfile: { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 },
      ciWorkflowsPresent: true,
      commitActivity: commitWeeks,
      truncated: { contributors: true, commits: false, releases: false, issues: false, pulls: false },
      errors: {},
      fetchedAt,
    };
  };
  const cleanSupplyChain = {
    status: 'ok', manifests: [{ path: 'package.json', ecosystem: 'npm', depCount: 12 }],
    dependencies: Array.from({ length: 12 }, (_, i) => ({
      name: `dep${i}`, ecosystem: 'npm', versionSpec: '^1.0.0', checkVersion: '1.0.0', dev: false,
      manifestPath: 'package.json', osvChecked: true, latestReleaseAt: '2026-09-01T00:00:00Z', abandoned: false,
    })),
    vulnerabilities: [], riskScore: 100, riskLabel: 'low', depsScanned: 12, vulnerableDeps: 0,
    totalVulnerabilities: 0, abandonedDeps: 0, hasLockfile: true, truncated: false, error: null, fetchedAt,
  };
  const noManifest = {
    status: 'no-manifest', manifests: [], dependencies: [], vulnerabilities: [],
    riskScore: null, riskLabel: null, depsScanned: 0, vulnerableDeps: 0, totalVulnerabilities: 0,
    abandonedDeps: null, hasLockfile: false, truncated: false, error: null, fetchedAt,
  };
  const vulnSupplyChain = {
    status: 'ok', manifests: [{ path: 'package.json', ecosystem: 'npm', depCount: 12 }],
    dependencies: Array.from({ length: 12 }, (_, i) => ({
      name: i === 0 ? 'lodash' : i === 1 ? 'express' : `dep${i}`, ecosystem: 'npm',
      versionSpec: i === 0 ? '^4.17.20' : '^4.16.0', checkVersion: i === 0 ? '4.17.20' : '4.16.0', dev: false,
      manifestPath: 'package.json', osvChecked: true,
      latestReleaseAt: i < 2 ? '2020-01-01T00:00:00Z' : '2026-09-01T00:00:00Z', abandoned: i < 2,
    })),
    // Critical −25, High −15, Medium −7 = −47; 2 abandoned −10;
    // no lockfile −5 → risk 38, High.
    vulnerabilities: [
      { id: 'CVE-2020-8203', packageName: 'lodash', ecosystem: 'npm', version: '4.17.20', severity: 'critical', cvssScore: 9.8, summary: 'Prototype pollution in lodash.' },
      { id: 'GHSA-29mw-wpgm-hmr9', packageName: 'lodash', ecosystem: 'npm', version: '4.17.20', severity: 'high', cvssScore: 7.4, summary: 'Regular Expression Denial of Service (ReDoS) in lodash.' },
      { id: 'GHSA-35jh-r3h4-6jhm', packageName: 'express', ecosystem: 'npm', version: '4.16.0', severity: 'medium', cvssScore: 5.3, summary: 'Command injection in express.' },
    ],
    riskScore: 38, riskLabel: 'high', depsScanned: 12, vulnerableDeps: 2,
    totalVulnerabilities: 3, abandonedDeps: 2, hasLockfile: false, truncated: false, error: null, fetchedAt,
  };
  const archivedIssues = [];
  for (let i = 0; i < 8; i++) archivedIssues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(400), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 2; i++) archivedIssues.push({ number: 9 + i, state: 'closed', createdAt: isoDaysAgo(410), closedAt: isoDaysAgo(5), isPullRequest: false });
  const archivedActivity = {
    contributors: [{ login: 'lead', contributions: 30 }, { login: 'dev1', contributions: 8 }, { login: 'dev2', contributions: 4 }],
    commits: [],
    releases: [{ tagName: 'v1.0.0', publishedAt: isoDaysAgo(800) }],
    issues: archivedIssues,
    pulls: [],
    communityProfile: { readme: true, license: true, contributing: false, codeOfConduct: false, issueTemplate: false, pullRequestTemplate: false, healthPercentage: 30 },
    ciWorkflowsPresent: false,
    commitActivity: null,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };
  const emptyActivity = {
    contributors: null, commits: null, releases: null, issues: null, pulls: null,
    communityProfile: null, ciWorkflowsPresent: null, commitActivity: null,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };
  const key = (owner, repo, kind) => `reporadar:cache:v1:github:${owner}/${repo}:${kind}`;
  const entry = (value) => ({ value, fetchedAt, etag: null });
  return chrome.storage.local.set({
    [key('big', 'huge-repo', 'repo')]: entry(baseFacts('big', 'huge-repo', {})),
    [key('big', 'huge-repo', 'languages')]: entry(languages),
    [key('big', 'huge-repo', 'activity')]: entry(baseActivity(growing)),
    [key('big', 'huge-repo', 'supplychain')]: entry(cleanSupplyChain),
    [key('big', 'declining-repo', 'repo')]: entry(baseFacts('big', 'declining-repo', {})),
    [key('big', 'declining-repo', 'languages')]: entry(languages),
    [key('big', 'declining-repo', 'activity')]: entry(baseActivity(falling)),
    [key('big', 'declining-repo', 'supplychain')]: entry(cleanSupplyChain),
    [key('old', 'archived-lib', 'repo')]: entry(baseFacts('old', 'archived-lib', {
      description: 'An old archived library.', stars: 500, forks: 40, watchers: 500, openIssuesCount: 8,
      primaryLanguage: 'TypeScript', updatedAt: isoDaysAgo(900), pushedAt: isoDaysAgo(900), archived: true,
    })),
    [key('old', 'archived-lib', 'languages')]: entry({ entries: [{ name: 'TypeScript', bytes: 100, percent: 100 }], totalBytes: 100, fetchedAt }),
    [key('old', 'archived-lib', 'activity')]: entry(archivedActivity),
    [key('old', 'archived-lib', 'supplychain')]: entry(noManifest),
    [key('tiny', 'new-repo', 'repo')]: entry(baseFacts('tiny', 'new-repo', {
      description: null, stars: 3, forks: 0, watchers: 3, openIssuesCount: 0, primaryLanguage: null,
      licenseSpdxId: null, licenseName: null, createdAt: isoDaysAgo(5), pushedAt: fetchedAt,
    })),
    [key('tiny', 'new-repo', 'languages')]: entry({ entries: [], totalBytes: 0, fetchedAt }),
    [key('tiny', 'new-repo', 'activity')]: entry(emptyActivity),
    [key('tiny', 'new-repo', 'supplychain')]: entry(noManifest),
    [key('vuln', 'vuln-lib', 'repo')]: entry(baseFacts('vuln', 'vuln-lib', {
      description: 'A library with vulnerable dependencies.', stars: 120, forks: 15, watchers: 120, openIssuesCount: 4,
    })),
    [key('vuln', 'vuln-lib', 'languages')]: entry(languages),
    [key('vuln', 'vuln-lib', 'activity')]: entry(baseActivity(growing)),
    [key('vuln', 'vuln-lib', 'supplychain')]: entry(vulnSupplyChain),
  });
}, now);

/** Open the side panel for a repo (via lastRepo + a fresh tab) and
 *  wait for its verdict title. Returns the panel page + full text. */
async function openPanelFor(owner, repo, verdictTitle) {
  await sw.evaluate(([o, r]) => chrome.storage.local.set({
    'reporadar:lastRepo': {
      platform: 'github', host: 'github.com', owner: o, repo: r,
      url: `https://github.com/${o}/${r}`, detectedAt: new Date().toISOString(),
    },
  }), [owner, repo]);
  const panel = await context.newPage();
  watch(panel);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const text = await waitForText(panel, verdictTitle, 30000);
  return { panel, text };
}

// --- (a) Verdict banner in all four states. ---
let res = await openPanelFor('big', 'huge-repo', 'Use it');
check('verdict "Use it" renders for the healthy repo', res.text.includes('Use it'));
check('verdict banner carries the adoption-signal wording', res.text.includes('Adoption signal based on public repository evidence'));
check('Use-it reasons cite the score', res.text.includes('Health score 94.3 (grade A)'));
await res.panel.close();

res = await openPanelFor('big', 'declining-repo', 'Use with caution');
check('verdict "Use with caution" renders for the declining repo', res.text.includes('Use with caution'));
check('caution reasons name the declining trend', /declining/i.test(res.text));
await res.panel.close();

res = await openPanelFor('old', 'archived-lib', 'Stay away');
check('verdict "Stay away" renders for the archived repo', res.text.includes('Stay away'));
check('Stay-away reasons name the archive', /archived/i.test(res.text));
await res.panel.close();

res = await openPanelFor('tiny', 'new-repo', 'Not enough data');
check('verdict "Not enough data" renders for the thin repo', res.text.includes('Not enough data'));
check('Not-enough-data reasons name the low coverage', /Coverage is only/i.test(res.text));
await res.panel.close();

// --- (b) Supply-chain section with seeded OSV data. ---
res = await openPanelFor('vuln', 'vuln-lib', 'Stay away');
check('supply-chain section renders', res.text.includes('Supply chain'));
check('supply-chain risk label is High with score 38', res.text.includes('Risk: High') && res.text.includes('38 / 100'));
check('supply-chain counts are shown', res.text.includes('12 dependencies scanned') && res.text.includes('2 vulnerable') && res.text.includes('3 vulnerabilities') && res.text.includes('2 abandoned'));
check('vulnerability list shows CVE id + Critical + CVSS', res.text.includes('CVE-2020-8203') && res.text.includes('Critical') && res.text.includes('CVSS 9.8'));
check('vulnerability list shows High and Medium severities', res.text.includes('GHSA-29mw-wpgm-hmr9') && res.text.includes('High') && res.text.includes('Medium'));
check('supply-chain notes the missing lockfile', res.text.includes('no lockfile'));
check('Critical vulnerability also drives the verdict to Stay away', res.text.includes('critical vulnerability'));
await res.panel.close();

// --- (c) Trajectory chart + trend label with seeded 52-week data. ---
res = await openPanelFor('big', 'huge-repo', 'Use it');
check('trajectory section renders with the Growing label', res.text.includes('Trajectory') && res.text.includes('Growing'));
check('trajectory slope is stated in plain words', /Growing by about 0\.69 commits a week/.test(res.text));
check('trajectory forecast sentence renders', /If this continues, about 48\.3 commits a week in 3 months/.test(res.text));
check('trajectory momentum is shown', /Recent activity is 1\.54× the previous two months/.test(res.text));
const trajSvg = await res.panel.evaluate(() => document.querySelector('#trajectory-section')?.querySelectorAll('svg').length ?? 0);
check('trajectory chart renders as SVG', trajSvg >= 1);
const totalSvg = await res.panel.evaluate(() => document.querySelectorAll('svg').length);
check('panel renders gauge + charts as SVG (4+)', totalSvg >= 4);
await res.panel.close();

// --- (d) Popup Save/Remove toggle. ---
await page.goto('https://github.com/big/huge-repo', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const popup = await context.newPage();
watch(popup);
await popup.goto(`chrome-extension://${extId}/popup.html`);
await waitForText(popup, '94.3', 30000);
check('popup shows the cached score summary', (await popup.evaluate(() => document.body.innerText)).includes('94.3'));
await popup.click('text=Save');
let popupText = await waitForText(popup, 'Saved ✓', 10000);
check('popup Save shows Saved ✓', popupText.includes('Saved ✓'));
let saved = await sw.evaluate(() => chrome.storage.local.get('reporadar:savedRepos'));
check('Save writes the repo to storage', Array.isArray(saved['reporadar:savedRepos']) && saved['reporadar:savedRepos'].some((e) => e.repoId === 'github:big/huge-repo'));
await popup.click('text=Remove');
// "Save" is a substring of "Saved ✓", so waiting for 'Save' would
// return the stale text immediately — wait for the badge to go away.
popupText = await waitForGone(popup, 'Saved ✓', 10000);
check('popup Remove returns the row to Save', popupText.includes('Save') && !popupText.includes('Saved ✓'));
saved = await sw.evaluate(() => chrome.storage.local.get('reporadar:savedRepos'));
check('Remove deletes the repo from storage', !saved['reporadar:savedRepos'] || saved['reporadar:savedRepos'].length === 0);
await popup.close();

// --- (e) Regression: verify-build4/5/6 + verify-fixes still pass. ---
for (const script of ['verify-build4.mjs', 'verify-build5.mjs', 'verify-build6.mjs', 'verify-fixes.mjs']) {
  try {
    execFileSync('node', [`tests/browser/${script}`], {
      cwd: '/home/hatch/workspace/RepoRadar', stdio: 'pipe', timeout: 300000,
    });
    check(`regression ${script} passes`, true);
  } catch (error) {
    check(`regression ${script} passes`, false);
    console.log('  ' + script + ' output tail:');
    console.log(String(error.stdout ?? '').split('\n').slice(-15).join('\n'));
    console.log(String(error.stderr ?? '').split('\n').slice(-5).join('\n'));
  }
}

// --- (f) Zero page/console errors. ---
check('no page/console errors during v03 run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'V03 BROWSER VERIFICATION FAILED' : 'V03 BROWSER VERIFICATION PASSED');
