// Templates: every built-in renders, applying one sets the controls + changes the picture, categories filter,
// "Mẫu của tôi" saves / restores / deletes, and videos exported with template features are valid files.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { fx, probe, hasFfprobe, openTab, renderAndDownload, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

const TABS = [
  { tab: 'imgvideo', box: '#ivTemplates', canvas: '#ivCanvas', min: 9 },
  { tab: 'textvideo', box: '#tvTemplates', canvas: '#tvCanvas', min: 19 },
  { tab: 'audiovideo', box: '#avTemplates', canvas: '#avCanvas', min: 23 },
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
    await expect(mine).toHaveAttribute('aria-label', 'Mẫu Kênh nhạc');
    await expect(page.locator('#avTemplates .tcard:has([data-tpl^="my-"]) .tname')).toHaveText('Kênh nhạc');
    await expect(page.locator('#avTemplates .chips button.active')).toHaveText('Mẫu của tôi');

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
    const del = page.locator('#avTemplates [data-del^="my-"]');
    await expect(del).toHaveAttribute('aria-label', /Xoá mẫu Kênh nhạc/);
    const box = await del.boundingBox();
    expect(box.width, 'delete target ≥ 32 px').toBeGreaterThanOrEqual(32);
    await del.focus(); // reachable by keyboard
    await page.keyboard.press('Enter');
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

/* ---------- regressions found in review + gaps ---------- */

/** Make a solid-colour PNG in the page and add it to a file input (no fixture needed). */
async function addColourPhotos(page, input, colours) {
  await page.evaluate(async ({ input, colours }) => {
    const dt = new DataTransfer();
    for (const [i, col] of colours.entries()) {
      const c = document.createElement('canvas'); c.width = 400; c.height = 700;
      const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 400, 700);
      const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      dt.items.add(new File([b], `c${i}.png`, { type: 'image/png' }));
    }
    const el = document.getElementById(input);
    el.files = dt.files;
    el.dispatchEvent(new Event('change'));
  }, { input, colours });
}

/** Capture the scene the export would render (render is replaced by a capture that cancels). */
async function captureScene(page, btn) {
  await page.evaluate(() => { window.__realRender = VideoEngine.render; VideoEngine.render = async (sc) => { window.__scene = sc; throw new DOMException('cap', 'AbortError'); }; });
  await page.click(btn);
  await expect.poll(() => page.evaluate(() => !!window.__scene)).toBe(true);
}
/** RGB at fractional (x, y) of the captured scene drawn at time t. */
const sceneRGB = (page, t, pts) => page.evaluate(({ t, pts }) => {
  const sc = window.__scene, c = document.createElement('canvas');
  c.width = sc.width; c.height = sc.height;
  const x = c.getContext('2d'); sc.draw(x, t);
  return pts.map(([fx, fy]) => [...x.getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data.slice(0, 3)]);
}, { t, pts });

test.describe('review regressions', () => {
  test('slide transition: the new photo enters from the right, the old one leaves to the left', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await addColourPhotos(page, 'ivImages', ['#ff0000', '#0000ff']);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(2);
    await page.selectOption('#ivFit', 'cover');
    await page.selectOption('#ivFx', 'none');
    await page.selectOption('#ivTrans', 'slide');
    await page.fill('#ivDur', '4'); // 2 s per photo, transition 0.67 s from t = 2
    await captureScene(page, '#ivRender');
    const [left, right] = await sceneRGB(page, 2.33, [[0.1, 0.5], [0.9, 0.5]]);
    expect(left[0] > 200 && left[2] < 60, `left ${left} is the old (red) photo`).toBe(true);
    expect(right[2] > 200 && right[0] < 60, `right ${right} is the new (blue) photo`).toBe(true);
    const [mid] = await sceneRGB(page, 3.0, [[0.5, 0.5]]);
    expect(mid[2] > 200 && mid[0] < 60, 'after the transition only the new photo').toBe(true);
  });

  test('zoom and fade transitions blend the two photos mid-way', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await addColourPhotos(page, 'ivImages', ['#ff0000', '#0000ff']);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(2);
    await page.selectOption('#ivFit', 'cover');
    await page.selectOption('#ivFx', 'none');
    await page.fill('#ivDur', '4');
    for (const tr of ['zoom', 'fade']) {
      await page.selectOption('#ivTrans', tr);
      await page.evaluate(() => { window.__scene = null; if (window.__realRender) VideoEngine.render = window.__realRender; });
      await captureScene(page, '#ivRender');
      const [m] = await sceneRGB(page, 2.33, [[0.5, 0.5]]);
      expect(m[0] > 40 && m[2] > 40, `${tr}: ${m} mixes red and blue`).toBe(true);
    }
  });

  test('photo preview shows the title fully (was ~2% opacity once photos were loaded)', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await addColourPhotos(page, 'ivImages', ['#202020']);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(1);
    await page.selectOption('#ivFit', 'cover');
    await page.fill('#ivTitle', 'TIÊU ĐỀ');
    await page.click('#ivTemplates [data-tpl=product]'); // white text on a red box at the top
    await page.selectOption('#ivFit', 'cover');
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('#ivCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height * 0.3).data;
      let red = 0; for (let i = 0; i < d.length; i += 4 * 7) if (d[i] > 200 && d[i + 1] < 90) red++;
      return red;
    }), 'title box visible in the still preview').toBeGreaterThan(200);
  });

  test('removing every photo keeps the sample preview and thumbnails working (sample canvas was wiped)', async ({ page }) => {
    const errors = await openTab(page, 'imgvideo');
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(1);
    await page.click('#ivThumbs .t button');
    await expect(page.locator('#ivThumbs .t')).toHaveCount(0);
    const sample = await page.evaluate(() => { const s = Templates.samplePhoto(); return [s.img.width, s.img.height]; });
    expect(sample).toEqual([600, 800]);
    const colours = await thumbColours(page, '#ivTemplates');
    expect(colours.every((n) => n > 6), `thumbnails after removal ${colours}`).toBe(true);
    expect(errors).toEqual([]);
  });

  test('B&W filter on a real photo (through the per-slide cache)', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(1);
    await page.selectOption('#ivFilter', 'bw');
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('#ivCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let worst = 0; for (let i = 0; i < d.length; i += 4 * 101) worst = Math.max(worst, Math.abs(d[i] - d[i + 2]), Math.abs(d[i] - d[i + 1]));
      return worst;
    })).toBeLessThanOrEqual(2);
  });

  test('a built-in text template resets what a saved template changed', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.selectOption('#tvBgMode', 'color');
    await page.selectOption('#tvAlign', 'left');
    page.once('dialog', (d) => d.accept('Nền màu'));
    await page.click('#tvTemplates [data-role=save-template]');
    await page.click('#tvTemplates .chips button >> nth=0');
    await page.click('#tvTemplates [data-tpl=classic]');
    await expect(page.locator('#tvBgMode')).toHaveValue('tpl');
    await expect(page.locator('#tvAlign')).toHaveValue('');
    await page.click('#tvTemplates [data-tpl^="my-"]');
    await expect(page.locator('#tvBgMode')).toHaveValue('color');
    await expect(page.locator('#tvAlign')).toHaveValue('left');
  });

  test('"Mẫu của tôi" in the photo tab keeps filter, transition and title style', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.click('#ivTemplates [data-tpl=cinema]');
    await page.selectOption('#ivFilter', 'vintage');
    page.once('dialog', (d) => d.accept('Phim cũ'));
    await page.click('#ivTemplates [data-role=save-template]');
    await page.click('#ivTemplates .chips button >> nth=0');
    await page.click('#ivTemplates [data-tpl=basic]');
    await expect(page.locator('#ivFilter')).toHaveValue('none');
    await page.click('#ivTemplates [data-tpl^="my-"]');
    await expect(page.locator('#ivFilter')).toHaveValue('vintage');
    await expect(page.locator('#ivFit')).toHaveValue('cover');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vat.tpl.iv'))[0].style.bars)).toBe(true);
  });

  test('templates keep the user\'s progress-bar choice', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.check('#ivProgress');
    await page.click('#ivTemplates [data-tpl=travel]');
    await expect(page.locator('#ivProgress')).toBeChecked();
  });

  test('with storage blocked the page still works and saving says why it failed', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    const errors = await openTab(page, 'audiovideo');
    await expect(page.locator('#avTemplates [data-tpl]')).toHaveCount(23);
    page.once('dialog', (d) => d.accept('X'));
    await page.click('#avTemplates [data-role=save-template]');
    await expect(page.locator('#toast')).toContainText('Không lưu được');
    await expect(page.locator('#avTemplates [data-tpl^="my-"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('picker on a phone is one horizontal row (preview stays near)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTab(page, 'textvideo');
    const tops = await page.locator('#tvTemplates .tcard').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops.length, 'all cards on one row').toBe(1);
    const h = await page.locator('#tvTemplates').evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeLessThan(330);
  });
});
