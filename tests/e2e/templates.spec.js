// Templates: every built-in renders, applying one sets the controls + changes the picture, categories filter,
// "Mẫu của tôi" saves / restores / deletes, and videos exported with template features are valid files.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { fx, probe, hasFfprobe, openTab, renderAndDownload, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

const TABS = [
  { tab: 'imgvideo', box: '#ivTemplates', canvas: '#ivCanvas', min: 9 },
  { tab: 'textvideo', box: '#tvTemplates', canvas: '#tvCanvas', min: 19 },
  { tab: 'audiovideo', box: '#avTemplates', canvas: '#avCanvas', min: 9 },
];

/** Cheap fingerprint of a canvas (sampled pixels) to tell two renders apart. */
const fingerprint = (page, sel) => page.evaluate((sel) => {
  const c = document.querySelector(sel);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4 * 997) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
  return h;
}, sel);

/** How many distinct colours a thumbnail has (blank / failed thumbnails have ~1). */
const thumbColours = (page, box) => page.evaluate((box) => [...document.querySelectorAll(box + ' [data-tpl] canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4 * 53) set.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4);
  return set.size;
}), box);

for (const { tab, box, canvas, min } of TABS) {
  test.describe(`${tab} templates`, () => {
    test('every built-in has a real thumbnail; picking one changes the preview', async ({ page }) => {
      const errors = await openTab(page, tab);
      const cards = page.locator(`${box} [data-tpl]`);
      await expect(cards).toHaveCount(min);
      const colours = await thumbColours(page, box);
      expect(colours.every((n) => n > 6), `thumbnail colours ${colours}`).toBe(true);
      const ids = await cards.evaluateAll((els) => els.map((e) => e.dataset.tpl));
      expect(new Set(ids).size, 'unique ids').toBe(ids.length);

      const before = await fingerprint(page, canvas);
      await cards.nth(min - 1).click();
      await expect(cards.nth(min - 1)).toHaveClass(/active/);
      await expect(cards.nth(min - 1)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => fingerprint(page, canvas)).not.toBe(before);
      expect(errors).toEqual([]);
    });

    test('category chips filter the cards', async ({ page }) => {
      await openTab(page, tab);
      const chips = page.locator(`${box} .chips button`);
      expect(await chips.count()).toBeGreaterThan(2);
      const all = await page.locator(`${box} [data-tpl]`).count();
      await chips.nth(1).click();
      const some = await page.locator(`${box} [data-tpl]`).count();
      expect(some).toBeGreaterThan(0);
      expect(some).toBeLessThan(all);
      await chips.nth(0).click();
      await expect(page.locator(`${box} [data-tpl]`)).toHaveCount(all);
    });
  });
}

test.describe('applying templates sets the controls', () => {
  test('photo templates: Polaroid, cinema bars, filters, transitions', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.click('#ivTemplates [data-tpl=polaroid]');
    await expect(page.locator('#ivFit')).toHaveValue('polaroid');
    await expect(page.locator('#ivBg')).toHaveValue('#efe6d8');
    await page.click('#ivTemplates [data-tpl=bw]');
    await expect(page.locator('#ivFilter')).toHaveValue('bw');
    // black & white really is grey: sample the preview (sample photo is shown before photos are chosen)
    const grey = await page.evaluate(() => {
      const c = document.querySelector('#ivCanvas'); const d = c.getContext('2d').getImageData(0, c.height * 0.3, c.width, 40).data;
      let worst = 0; for (let i = 0; i < d.length; i += 4 * 31) worst = Math.max(worst, Math.abs(d[i] - d[i + 2]), Math.abs(d[i] - d[i + 1]));
      return worst;
    });
    expect(grey, 'max channel difference in B&W').toBeLessThanOrEqual(2);
    await page.click('#ivTemplates [data-tpl=cinema]');
    // cinema: black bars top and bottom
    const bars = await page.evaluate(() => {
      const c = document.querySelector('#ivCanvas'); const x = c.getContext('2d');
      const top = x.getImageData(c.width / 2, 5, 1, 1).data, bottom = x.getImageData(c.width / 2, c.height - 5, 1, 1).data;
      return [...top.slice(0, 3), ...bottom.slice(0, 3)];
    });
    expect(Math.max(...bars)).toBeLessThan(8);
    await page.click('#ivTemplates [data-tpl=travel]');
    await expect(page.locator('#ivTrans')).toHaveValue('slide');
  });

  test('audio templates: light "Tối giản sáng" sets colour background; a chosen cover keeps the image background', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.click('#avTemplates [data-tpl=paper]');
    await expect(page.locator('#avBgMode')).toHaveValue('color');
    await expect(page.locator('#avBgColor')).toHaveValue('#f4f1ea');
    await expect(page.locator('#avStyle')).toHaveValue('overview');
    await page.setInputFiles('#avImg', fx('photo.jpg'));
    await expect(page.locator('#avImgInfo')).toContainText('photo.jpg');
    await page.selectOption('#avBgMode', 'image');
    await page.click('#avTemplates [data-tpl=lofi]');
    await expect(page.locator('#avStyle')).toHaveValue('mirror');
    await expect(page.locator('#avBgMode'), 'cover photo stays the background').toHaveValue('image');
  });
});

test.describe('"Mẫu của tôi"', () => {
  test('save current settings, restore them later (after reload), delete', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.click('#avTemplates [data-tpl=hacker]');
    await page.fill('#avSub', '@kenh_cua_toi');
    await page.selectOption('#avStyle', 'circle');
    page.once('dialog', (d) => d.accept('Kênh nhạc'));
    await page.click('#avTemplates [data-role=save-template]');
    const mine = page.locator('#avTemplates [data-tpl^="my-"]');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('Kênh nhạc');
    await expect(page.locator('#avTemplates .chips button.active')).toHaveText('Của tôi');

    await page.reload();
    await page.waitForFunction(() => typeof Templates !== 'undefined');
    await page.click('#tabs button[data-tab="audiovideo"]');
    await page.click('#avTemplates [data-tpl=neon]');
    await expect(page.locator('#avStyle')).toHaveValue('bars');
    await page.fill('#avSub', '');
    await page.click('#avTemplates [data-tpl^="my-"]');
    await expect(page.locator('#avStyle')).toHaveValue('circle');
    await expect(page.locator('#avSub')).toHaveValue('@kenh_cua_toi');
    await expect(page.locator('#avColor1')).toHaveValue('#39ff88'); // from the Hacker base
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vat.tpl.av'))[0].style.font)).toBe('Roboto Mono');

    page.once('dialog', (d) => d.accept());
    await page.click('#avTemplates [data-tpl^="my-"] .del');
    await expect(page.locator('#avTemplates [data-tpl^="my-"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vat.tpl.av'))).toBe('[]');
  });

  test('cancelling the name prompt saves nothing', async ({ page }) => {
    await openTab(page, 'textvideo');
    page.once('dialog', (d) => d.dismiss());
    await page.click('#tvTemplates [data-role=save-template]');
    await expect(page.locator('#tvTemplates [data-tpl^="my-"]')).toHaveCount(0);
  });
});

test.describe('export with template features', () => {
  test('Polaroid + vintage filter + slide transition + title → valid MP4', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    await openTab(page, 'imgvideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#ivImages', [fx('photo.jpg'), fx('photo.png'), fx('photo-exif.jpg')]);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(3);
    await page.click('#ivTemplates [data-tpl=polaroid]');
    await page.selectOption('#ivFilter', 'vintage');
    await page.selectOption('#ivTrans', 'slide');
    await page.fill('#ivTitle', 'Đà Lạt 2026 – kỷ niệm');
    await page.setInputFiles('#ivAudio', fx('tone.m4a'));
    await expect(page.locator('#ivAudioInfo')).toContainText('0:03');
    await page.selectOption('#ivSize', '720x1280');
    const dl = await renderAndDownload(page, 'iv', ti);
    const p = probe(dl.path);
    expect([p.video.codec, p.video.width, p.video.height, p.audio.codec]).toEqual(['h264', 720, 1280, 'aac']);
    expect(Math.abs(p.duration - 3)).toBeLessThan(0.25);
  });

  test('light audio template exports a light video (not the default dark one)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffmpeg not installed');
    await openTab(page, 'audiovideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.click('#avTemplates [data-tpl=paper]');
    await page.selectOption('#avSize', '720x1280');
    const dl = await renderAndDownload(page, 'av', ti);
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', dl.path, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    expect(Math.min(...rgb), `average colour ${[...rgb]}`).toBeGreaterThan(190);
  });

  test('new text template exports', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    await openTab(page, 'textvideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.click('#tvTemplates [data-tpl=news]');
    await page.fill('#tvSlideDur', '1');
    await page.selectOption('#tvSizeSel', '720x1280');
    const dl = await renderAndDownload(page, 'tv', ti);
    const p = probe(dl.path);
    expect([p.video.width, p.video.height]).toEqual([720, 1280]);
  });
});
