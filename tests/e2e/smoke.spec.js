const { test, expect } = require('@playwright/test');
const { openTab, codecs } = require('./helpers');

const TABS = ['convert', 'compress', 'edit', 'imgvideo', 'textvideo', 'audiovideo'];

test('loads with no errors and every tab opens', async ({ page }) => {
  const errors = await openTab(page);
  for (const t of TABS) {
    await page.click(`#tabs button[data-tab="${t}"]`);
    await expect(page.locator('#tab-' + t)).toBeVisible();
    await expect(page).toHaveURL(new RegExp('#' + t + '$'));
  }
  expect(errors).toEqual([]);
});

test('no horizontal page scroll on any tab', async ({ page }) => {
  await openTab(page);
  for (const t of TABS) {
    await page.click(`#tabs button[data-tab="${t}"]`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, t).toBeLessThanOrEqual(1);
  }
});

test('audio pickers: iOS gets no accept filter, others get the audio list', async ({ page }, testInfo) => {
  await openTab(page, 'audiovideo');
  const isIOS = testInfo.project.name.startsWith('iphone');
  for (const id of ['ivAudio', 'tvAudio', 'avAudio']) {
    const accept = await page.getAttribute('#' + id, 'accept');
    if (isIOS) expect(accept, id).toBeNull();
    else expect(accept, id).toContain('.m4a');
  }
  for (const tab of ['imgvideo', 'textvideo', 'audiovideo']) {
    await page.click(`#tabs button[data-tab="${tab}"]`);
    await expect(page.locator(`#tab-${tab} .ios-only`), tab).toBeVisible({ visible: isIOS });
    if (isIOS) await expect(page.locator(`#tab-${tab} .ios-only`)).toContainText('Lưu vào Tệp');
  }
});

test('self test: every required check passes', async ({ page }, testInfo) => {
  await openTab(page);
  await page.click('#stLink');
  await expect(page.locator('#stOut')).toHaveAttribute('data-done', /pass|fail/, { timeout: 110_000 });
  const results = await page.evaluate(() => SelfTest.results.map(({ name, level, status, detail }) => ({ name, level, status, detail })));
  await testInfo.attach('selftest.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  // Checks that can only fail because this browser BUILD lacks a codec (Linux WebKit), never because of our code:
  const c = await codecs(page);
  const envLimited = (r) => (!c.aac && /M4A|MP4/.test(r.name)) || (!c.webcodecs && !c.recorder && /Xuất video/.test(r.name));
  const failedRequired = results.filter((r) => r.level === 'required' && r.status !== 'pass' && !envLimited(r));
  expect(failedRequired).toEqual([]);
  // "Sao chép kết quả": the copied report carries every check + device info (what users send us)
  await page.evaluate(() => { window.copyText = async (t) => { window.__copied = await t; return true; }; });
  await page.click('#stCopy');
  await expect.poll(() => page.evaluate(() => window.__copied || '')).toContain('Tự kiểm tra:');
  const copied = await page.evaluate(() => window.__copied);
  for (const r of results) expect(copied).toContain(r.name);
  expect(copied).toMatch(/Thiết bị: (iOS|Android|Desktop)/);
  expect(copied).toMatch(/bản [0-9a-f]{10}/);
  if (results.some((r) => r.status !== 'pass' && envLimited(r))) testInfo.annotations.push({ type: 'env-limited', description: 'codec checks skipped: browser build has no AAC/H.264' });
});
