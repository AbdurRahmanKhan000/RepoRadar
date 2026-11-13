import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile1';
fs.rmSync(profile, { recursive: true, force: true });

// Note: local Playwright Chromium has no external internet in this VM
// (egress proxy works for curl, not for Chromium). So github.com pages
// are served by Playwright route interception with minimal fake HTML;
// the URL, host and path are real, so the content script, SPA handling
// and storage behaviour are exercised exactly as on the live site.
// Live-GitHub verification remains an owner/manual step (see README).
const context = await chromium.launchPersistentContext(profile, {
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-sandbox',
    '--disable-gpu',
  ],
});

await context.route('https://github.com/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><head><title>GitHub</title></head><body><h1>Fake GitHub page</h1><p>Route-intercepted for RepoRadar Build 1 verification.</p></body></html>',
  });
});

const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function lastRepo() {
  const sw = context.serviceWorkers().find((w) => w.url().includes('background.js'));
  if (!sw) return null;
  return sw.evaluate(() =>
    chrome.storage.local.get('reporadar:lastRepo').then((r) => r['reporadar:lastRepo'] ?? null),
  );
}
async function buttonPresent() {
  return page.evaluate(() => !!document.getElementById('reporadar-entrypoint'));
}
function check(name, cond) {
  console.log((cond ? 'OK: ' : 'FAIL: ') + name);
  if (!cond) process.exitCode = 1;
}

await page.goto('https://github.com/facebook/react', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
check('repo page shows Analyze button', await buttonPresent());
let lr = await lastRepo();
check('storage lastRepo is facebook/react', lr?.owner === 'facebook' && lr?.repo === 'react');

await page.evaluate(() => history.pushState({}, '', '/facebook'));
await page.waitForTimeout(1200);
check('SPA to profile removes button', !(await buttonPresent()));

await page.evaluate(() => history.pushState({}, '', '/facebook/react/issues/1'));
await page.waitForTimeout(1200);
check('SPA to repo issues page restores button', await buttonPresent());

await page.goto('https://github.com/facebook', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('profile page has no button', !(await buttonPresent()));
await page.goto('https://github.com/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('settings page has no button', !(await buttonPresent()));
await page.goto('https://github.com/facebook/react/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('repo settings page has no button', !(await buttonPresent()));

await page.goto('https://github.com/AbdurRahmanKhan000/arkConvert', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
check('arkConvert page shows button', await buttonPresent());
lr = await lastRepo();
check('storage lastRepo is AbdurRahmanKhan000/arkConvert', lr?.owner === 'AbdurRahmanKhan000' && lr?.repo === 'arkConvert');

await page.click('#reporadar-entrypoint');
await page.waitForTimeout(2000);
const sw = context.serviceWorkers().find((w) => w.url().includes('background.js'));
const panelErr = sw
  ? await sw.evaluate(() => chrome.storage.local.get('reporadar:lastPanelError').then((r) => r['reporadar:lastPanelError'] ?? null))
  : null;
check('clicking Analyze records no panel-open error', panelErr === null);
if (panelErr) console.log('  panel error:', panelErr);

const extId = new URL(sw.url()).hostname;
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForTimeout(1200);
const panelText = await panel.evaluate(() => document.body.innerText);
check('sidepanel.html shows arkConvert', panelText.includes('AbdurRahmanKhan000/arkConvert'));

const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(1200);
const popupText = await popup.evaluate(() => document.body.innerText);
check('popup shows arkConvert + Open analysis', popupText.includes('AbdurRahmanKhan000/arkConvert') && popupText.includes('Open analysis'));

check('no page/console errors during detection run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));

await context.close();
console.log(process.exitCode ? 'BUILD 1 BROWSER VERIFICATION FAILED' : 'BUILD 1 BROWSER VERIFICATION PASSED');
