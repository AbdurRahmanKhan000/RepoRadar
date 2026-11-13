import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile';
fs.rmSync(profile, { recursive: true, force: true });

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

// Wait for the service worker to register.
let sw = null;
for (let i = 0; i < 30; i++) {
  sw = context.serviceWorkers().find((w) => w.url().includes('background.js'));
  if (sw) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!sw) {
  console.log('FAIL: no background service worker found');
  console.log('service workers:', context.serviceWorkers().map((w) => w.url()));
  await context.close();
  process.exit(1);
}
console.log('OK: service worker registered:', sw.url());
const extId = new URL(sw.url()).hostname;
console.log('OK: extension id:', extId);

// Open the popup page as a tab and check it renders with no console errors.
const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`chrome-extension://${extId}/popup.html`);
await page.waitForTimeout(1500);
const text = await page.evaluate(() => document.body.innerText);
console.log('OK: popup text:', JSON.stringify(text));
// Build 6: the popup footer now reads "Build 6 · Version 0.2.0".
// Fixes 0.2.1: the popup footer line ("Build 6 · Version 0.2.0 ·
// Local-first, no account or backend in V1.") was removed at the
// owner's request, so "Build 6" no longer appears in the popup.
// The popup must still render the app name and its main action.
if (!text.includes('RepoRadar') || !text.includes('Open analysis')) {
  console.log('FAIL: popup did not render expected content');
  await context.close();
  process.exit(1);
}
if (errors.length) {
  console.log('FAIL: console/page errors:', errors);
  await context.close();
  process.exit(1);
}
console.log('OK: popup renders, no console errors');
await context.close();
console.log('BUILD 0 BROWSER VERIFICATION PASSED');
