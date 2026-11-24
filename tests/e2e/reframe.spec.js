// "Cắt & đổi khung video": a 16:9 clip → 9:16 / 1:1 / 4:5 for TikTok, Reels, Shorts.
const { test, expect } = require('@playwright/test');
const { execFileSync, spawnSync } = require('node:child_process');
const { fx, probe, hasFfprobe, openTab, grabDownload, codecs, NO_EXPORT } = require('./helpers');

/** One RGB frame at `t` seconds → { w, h, px(x, y) → [r, g, b] }. */
function frameAt(file, t, w, h) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
  return { px: (x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; } };
}
const isRed = ([r, g, b]) => r > 180 && g < 80 && b < 80;
const isGreen = ([r, g, b]) => g > 180 && r < 80 && b < 80;
const isBlue = ([r, g, b]) => b > 180 && r < 80 && g < 80;
/** Integrated loudness (LUFS) via ffmpeg ebur128. */
function lufs(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/Integrated loudness:\s*I:\s*(-?[0-9.]+) LUFS/);
  return m ? +m[1] : NaN;
}

async function open(page, file) {
  const errors = await openTab(page, 'reframe');
  const c = await codecs(page);
  test.skip(!c.webcodecs, NO_EXPORT + ' — this tool needs WebCodecs (Playwright Linux WebKit has no H.264; real iPhone Safari does)');
  test.skip(!c.h264, 'this browser build cannot decode H.264 (Playwright Linux WebKit); real iPhone Safari can');
  await page.setInputFiles('#rfFile', fx(file));
  await expect(page.locator('#rfInfo')).toContainText('fps');
  await expect(page.locator('#rfRender')).toBeEnabled();
  return errors;
}
const setSelect = (page, id, v) => page.selectOption('#' + id, v);
async function setPos(page, v) {
  await page.locator('#rfPos').evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(v));
}
async function exportVideo(page, ti) {
  await page.click('#rfRender');
  await expect(page.locator('#rfOut video')).toBeVisible({ timeout: 110_000 });
  return grabDownload(page, () => page.click('#rfOut [data-a=dl]'), ti);
}

test.describe('Cắt & đổi khung video', () => {
  test('16:9 → 9:16: a 1080×1920 H.264 + AAC MP4 of exactly the chosen part (TikTok rejects odd sizes and Opus is silent on iPhone)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    const errors = await open(page, 'clip.mp4');
    await page.fill('#rfStart', '0.5');
    await page.fill('#rfEnd', '2.5');
    await expect(page.locator('#rfSegInfo')).toHaveText('Đoạn đã chọn: 0:00,5 → 0:02,5 (2,0 giây)');
    const { path, name } = await exportVideo(page, ti);
    expect(name).toBe('clip-9x16.mp4');
    const p = probe(path);
    expect(p.video).toMatchObject({ codec: 'h264', width: 1080, height: 1920 });
    expect(p.audio.codec).toBe('aac');
    expect(p.duration).toBeGreaterThan(1.85);
    expect(p.duration).toBeLessThan(2.2);
    expect(errors).toEqual([]);
  });

  test('crop position: left / right of a wide video is really what ends up in the vertical video (not always the centre)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await open(page, 'wide.mp4'); // red | green | blue thirds
    await setSelect(page, 'rfLoud', 'off');
    await setPos(page, 0);
    await expect(page.locator('#rfPosOut')).toHaveText('Trái');
    // the preview shows the same part as the export
    await expect.poll(() => page.evaluate(() => [...document.getElementById('rfCanvas').getContext('2d').getImageData(135, 240, 1, 1).data].slice(0, 3)).then(isRed)).toBe(true);
    const left = await exportVideo(page, ti);
    let f = frameAt(left.path, 1, 1080, 1920);
    expect(isRed(f.px(540, 960)), 'centre of a left crop is red ' + f.px(540, 960)).toBe(true);
    expect(isRed(f.px(20, 960)) && isRed(f.px(1060, 960))).toBe(true); // the whole width: red only

    await setPos(page, 100);
    const right = await exportVideo(page, ti);
    f = frameAt(right.path, 1, 1080, 1920);
    expect(isBlue(f.px(540, 960)), 'centre of a right crop is blue ' + f.px(540, 960)).toBe(true);
    expect(isBlue(f.px(20, 960)) && isBlue(f.px(1060, 960))).toBe(true);
  });

  test('dragging the preview moves the crop (phones: no fiddly slider needed)', async ({ page }) => {
    await open(page, 'wide.mp4');
    const box = await page.locator('#rfCanvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + box.width * 0.6, y, { steps: 5 }); // picture to the right = its left part
    await page.mouse.up();
    expect(await page.evaluate(() => Reframe.pos)).toBeLessThan(0.2);
    expect(+(await page.locator('#rfPos').inputValue())).toBeLessThan(20);
    await page.waitForTimeout(100);
    const px = await page.evaluate(() => [...document.getElementById('rfCanvas').getContext('2d').getImageData(135, 240, 1, 1).data]);
    expect(px[0] > 180 && px[1] < 80, 'preview now shows the red left part ' + px).toBe(true);
  });

  test('"Nền mờ": the whole wide picture in the middle, a blurred (not black) background above and below', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await open(page, 'wide.mp4');
    await setSelect(page, 'rfLoud', 'off');
    await setSelect(page, 'rfFit', 'blur');
    await expect(page.locator('#rfPosWrap')).toBeHidden();
    const { path } = await exportVideo(page, ti);
    expect(probe(path).video).toMatchObject({ width: 1080, height: 1920 });
    const f = frameAt(path, 1, 1080, 1920);
    // the picture (608 px high) is centred: all three stripes are visible across the middle row
    expect(isRed(f.px(100, 960)) && isGreen(f.px(540, 960)) && isBlue(f.px(980, 960))).toBe(true);
    // above it: the blurred, darkened picture — coloured, not black, not the sharp stripe
    const top = f.px(100, 200);
    expect(Math.max(...top), 'background is not black ' + top).toBeGreaterThan(40);
    expect(isRed(top), 'background is darkened / blurred, not the picture itself').toBe(false);
  });

  test('"Nền màu" in a 1:1 frame: the chosen colour fills the empty space', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await open(page, 'wide.mp4');
    await setSelect(page, 'rfLoud', 'off');
    await setSelect(page, 'rfFrame', '1:1');
    await setSelect(page, 'rfFit', 'color');
    await expect(page.locator('#rfBgWrap')).toBeVisible();
    await page.locator('#rfBg').evaluate((el) => { el.value = '#ffffff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const { path, name } = await exportVideo(page, ti);
    expect(name).toBe('wide-1x1.mp4');
    expect(probe(path).video).toMatchObject({ width: 1080, height: 1080 });
    const f = frameAt(path, 1, 1080, 1080);
    expect(Math.min(...f.px(540, 60)), 'white above the picture ' + f.px(540, 60)).toBeGreaterThan(230);
    expect(isGreen(f.px(540, 540))).toBe(true);
  });

  test('sound is normalised to −14 LUFS by default and copied untouched when "Giữ nguyên"', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await open(page, 'wide.mp4'); // about −31.7 LUFS
    await expect(page.locator('#rfLoudInfo')).toContainText('LUFS');
    const loud = await exportVideo(page, ti);
    expect(probe(loud.path).audio.codec).toBe('aac');
    expect(Math.abs(lufs(loud.path) + 14), 'normalised: ' + lufs(loud.path)).toBeLessThan(1.5);

    await setSelect(page, 'rfLoud', 'off');
    const asIs = await exportVideo(page, ti);
    expect(Math.abs(lufs(asIs.path) - lufs(fx('wide.mp4'))), 'kept: ' + lufs(asIs.path)).toBeLessThan(1);
  });

  test('"Giữ khung gốc" only cuts the part, same size', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await open(page, 'clip.mp4');
    await setSelect(page, 'rfFrame', 'keep');
    await expect(page.locator('#rfFitWrap')).toBeHidden();
    await page.fill('#rfStart', '1');
    const { path, name } = await exportVideo(page, ti);
    expect(name).toBe('clip-doan.mp4');
    const p = probe(path);
    expect(p.video).toMatchObject({ codec: 'h264', width: 320, height: 240 });
    expect(p.duration).toBeGreaterThan(1.85);
    expect(p.duration).toBeLessThan(2.2);
  });

  test('a wrong part or a file that is not a video gives a clear message (no stuck "Đang đọc")', async ({ page }) => {
    await open(page, 'clip.mp4');
    await page.fill('#rfStart', '2');
    await page.fill('#rfEnd', '2.2');
    await expect(page.locator('#rfSegInfo')).toContainText('0,5 giây');
    await page.click('#rfRender');
    await expect(page.locator('#toast')).toContainText('0,5 giây');
    await expect(page.locator('#rfOut video')).toHaveCount(0);

    await page.setInputFiles('#rfFile', fx('notaudio.txt'));
    await expect(page.locator('#rfInfo')).toContainText('⚠️');
    await expect(page.locator('#rfRender')).toBeDisabled();
  });

  test('export can be cancelled (a long video on a phone must not lock the page)', async ({ page }) => {
    await open(page, 'wide.mp4');
    await setSelect(page, 'rfLoud', 'off');
    await setSelect(page, 'rfFit', 'blur');
    // slow every drawn frame down (like a phone) so "Huỷ" lands mid-export
    await page.evaluate(() => {
      const draw = (window.__draw = CanvasRenderingContext2D.prototype.drawImage);
      CanvasRenderingContext2D.prototype.drawImage = function (...a) { const t = performance.now() + 15; while (performance.now() < t); return draw.apply(this, a); };
    });
    await page.click('#rfRender');
    await expect(page.locator('#rfProg')).toContainText('%');
    await page.click('#rfRender');
    await expect(page.locator('#toast')).toContainText('Đã huỷ');
    await expect(page.locator('#rfRender')).toHaveText('Xuất video');
    await expect(page.locator('#rfOut video')).toHaveCount(0);
    // and the next export still works
    await page.evaluate(() => { CanvasRenderingContext2D.prototype.drawImage = window.__draw; });
    await page.click('#rfRender');
    await expect(page.locator('#rfOut video')).toBeVisible({ timeout: 60_000 });
  });
});

/* ---------------- review fixes (each names the problem it prevents) ---------------- */
test.describe('Cắt & đổi khung video: review fixes', () => {
  test('opening a video never builds a sample buffer of its whole soundtrack (40 min ≈ 1 GB reloaded iPhone tabs)', async ({ page }) => {
    await page.addInitScript(() => {
      window.__bufs = [];
      const Orig = window.AudioBuffer;
      window.AudioBuffer = function (o) { window.__bufs.push(o.length * (o.numberOfChannels || 1)); return new Orig(o); };
      window.AudioBuffer.prototype = Orig.prototype;
    });
    await open(page, 'wide.mp4');
    await expect(page.locator('#rfLoudInfo')).toContainText('LUFS', { timeout: 20000 });
    const bufs = await page.evaluate(() => window.__bufs);
    // the decoder's own slices are small (tens of ms); nothing as long as the part (wide.mp4 is ~4 s stereo)
    expect(Math.max(0, ...bufs), `largest AudioBuffer (samples × channels) of ${bufs.length}`).toBeLessThan(48000 * 2 * 2);
  });

  test('"Giữ nguyên như video gốc" copies the AAC sound bit for bit (it was re-encoded: quality loss, 96 → 181 kbps)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffmpeg');
    await open(page, 'wide.mp4');
    await page.selectOption('#rfLoud', 'off');
    const dl = await exportVideo(page, ti);
    const md5 = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:a', '-c', 'copy', '-f', 'md5', '-']).toString().trim();
    const br = (f) => +execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', f]).toString().trim();
    expect(md5(dl.path), 'same AAC packets as the source').toBe(md5(fx('wide.mp4')));
    expect(Math.abs(br(dl.path) - br(fx('wide.mp4'))) / br(fx('wide.mp4'))).toBeLessThan(0.1);
  });

  test('typing "1,5" and "2,5" (Vietnamese comma) cuts 1.5 → 2.5 s, not 15 → 25 s', async ({ page }) => {
    await open(page, 'wide.mp4');
    await page.fill('#rfStart', '1,5');
    await page.fill('#rfEnd', '2,5');
    await expect(page.locator('#rfSegInfo')).toContainText('0:01,5 → 0:02,5');
  });

  test('a second export frees the first one\'s memory (each held up to 80 MB until reload)', async ({ page }) => {
    await open(page, 'wide.mp4');
    await page.fill('#rfEnd', '1');
    await page.click('#rfRender');
    await expect(page.locator('#rfOut video')).toBeVisible({ timeout: 110_000 });
    const first = await page.locator('#rfOut video').getAttribute('src');
    await page.click('#rfRender');
    await expect(page.locator('#rfOut video')).toBeVisible({ timeout: 110_000 });
    const gone = await page.evaluate((u) => fetch(u).then(() => false, () => true), first);
    expect(gone, 'the first export\'s blob URL was revoked').toBe(true);
  });

  test('choosing another file during an export cancels it (the old video came out under the new name)', async ({ page }) => {
    await open(page, 'wide.mp4');
    await page.click('#rfRender');
    await expect(page.locator('#rfRender')).toHaveText('Huỷ');
    await page.setInputFiles('#rfFile', fx('clip.mp4'));
    await expect(page.locator('#toast'), 'the running export is cancelled at once').toContainText('Đã huỷ', { timeout: 5000 });
    await expect(page.locator('#rfRender')).not.toHaveText('Huỷ', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#rfOut video')).toHaveCount(0);
  });

  test('phone: dragging the crop sideways keeps vertical swipes for scrolling the page (the preview felt frozen)', async ({ page }) => {
    await open(page, 'wide.mp4');
    await page.selectOption('#rfFrame', '9:16');
    await page.selectOption('#rfFit', 'crop');
    await expect(page.locator('#rfCanvas')).toHaveClass(/rf-drag/);
    expect(await page.locator('#rfCanvas').evaluate((c) => getComputedStyle(c).touchAction)).toBe('pan-y');
  });

  test('a video whose sound the browser cannot read says BEFORE export that the result will be silent', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffmpeg');
    const src = ti.outputPath('ac3.mp4');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', fx('wide.mp4'), '-c:v', 'copy', '-c:a', 'ac3', src]);
    test.skip(r.status !== 0, 'this ffmpeg has no AC-3 encoder');
    const errors = await openTab(page, 'reframe');
    const c = await codecs(page);
    test.skip(!c.webcodecs || !c.h264, NO_EXPORT);
    await page.setInputFiles('#rfFile', src);
    await expect(page.locator('#rfInfo')).toContainText('fps');
    const canAc3 = await page.evaluate(() => !!document.createElement('audio').canPlayType('audio/mp4; codecs="ac-3"'));
    if (!canAc3) await expect(page.locator('#rfInfo')).toContainText('KHÔNG có tiếng');
    await expect(page.locator('#rfInfo')).not.toContainText('tiếng được giữ nguyên');
  });
});
