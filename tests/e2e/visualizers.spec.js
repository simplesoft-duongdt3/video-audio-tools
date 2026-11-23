// Trending visualizer styles (neon line, LED, soft layers, voice-note capsules, orb, spinning record) and
// beat effects (dust, punch). Each test names the risk it covers.
const { test, expect } = require('@playwright/test');
const { openTab, renderAndDownload, probe, hasFfprobe, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

/** WAV with a kick every `period` s (60 Hz thump) + a melody — beat effects have something to react to. */
function beatSong(sec = 6, period = 0.5, sr = 22050) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr, d = t % period;
    const v = (d < 0.12 ? Math.sin(2 * Math.PI * 60 * d) * Math.exp(-d * 25) : 0) * 0.85 + 0.2 * Math.sin(2 * Math.PI * 330 * t) * (0.5 + 0.5 * Math.sin(t * 3));
    b.writeInt16LE(Math.round(v * 22000), 44 + i * 2);
  }
  return { name: 'beat.wav', mimeType: 'audio/wav', buffer: b };
}

/** Capture the scene the export would render, for the current template. */
async function capture(page, id) {
  if (id) await page.click(`#avTemplates [data-tpl=${id}]`);
  await page.evaluate(() => { window.__sc = null; VideoEngine.render = async (sc) => { window.__sc = sc; throw new DOMException('x', 'AbortError'); }; });
  await page.click('#avRender');
  await expect.poll(() => page.evaluate(() => !!window.__sc)).toBe(true);
}

test('every visualizer style draws something, and each looks different (the self-test check, in CI)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  const styles = await page.evaluate(() => AVTest.styles());
  for (const s of ['line', 'led', 'layers', 'capsules', 'orb', 'vinyl']) expect(styles).toContain(s);
  const sigs = await page.evaluate(() => AVTest.styles().map((s) => {
    const { canvas } = AVTest.frame(s);
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0; const cols = new Set();
    for (let i = 0; i < d.length; i += 4 * 61) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0; cols.add(d[i] >> 5 << 6 | d[i + 1] >> 5 << 3 | d[i + 2] >> 5); }
    return [s, h, cols.size];
  }));
  for (const [s, , n] of sigs) expect(n, `${s} draws`).toBeGreaterThan(4);
  expect(new Set(sigs.map(([, h]) => h)).size, 'all styles distinct').toBe(sigs.length);
});

test('photosensitive safety: beat effects never flash (mean brightness changes < 10 % per frame, 0 flash pairs)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(4, 0.25)); // 4 hits/s: worst case for "punch"
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  for (const id of ['sannhay', 'neon', 'duongneon', 'quacau', 'chualanh', 'vinyl']) {
    await capture(page, id);
    await page.check('#avDust'); await page.check('#avPunch'); // every effect on
    await capture(page);
    const r = await page.evaluate(() => {
      const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
      const x = c.getContext('2d'), lum = [];
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      for (let f = 0; f < 90; f++) {
        sc.draw(x, f / 30);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let s = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 53) { s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); n++; }
        lum.push(s / n);
      }
      let maxStep = 0, flashes = 0, dir = 0;
      for (let i = 1; i < lum.length; i++) {
        const dl = lum[i] - lum[i - 1];
        maxStep = Math.max(maxStep, Math.abs(dl));
        if (Math.abs(dl) >= 0.1) { if (dir && Math.sign(dl) !== dir) flashes++; dir = Math.sign(dl); }
      }
      return { maxStep, flashes };
    });
    expect(r.maxStep, `${id}: biggest frame-to-frame brightness change`).toBeLessThan(0.1);
    expect(r.flashes, `${id}: flash pairs in 3 s`).toBe(0);
  }
});

test('"Nhún theo nhịp" really moves on the beat; effects are deterministic (preview = export, seekable)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(6, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  await page.click('#avTemplates [data-tpl=vinyl]');
  const frameAt = (times) => page.evaluate((times) => {
    const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
    const x = c.getContext('2d'); let d;
    for (const t of times) { sc.draw(x, t); d = x.getImageData(0, 0, c.width, c.height).data; }
    let h = 0; for (let i = 0; i < d.length; i += 4 * 29) h = (h * 31 + d[i] + 3 * d[i + 1]) >>> 0; return h;
  }, times);
  const pixels = (t) => page.evaluate((t) => {
    const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
    const x = c.getContext('2d'); sc.draw(x, t); const d = x.getImageData(0, 0, c.width, c.height).data;
    const out = []; for (let i = 0; i < d.length; i += 4 * 17) out.push(d[i]); return out;
  }, t);
  const diff = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 8 ? 1 : 0), 0);
  await page.uncheck('#avPunch'); await page.uncheck('#avDust'); await capture(page);
  const offA = await pixels(2.04), offB = await pixels(2.4);
  await page.check('#avPunch'); await capture(page); // ONLY the punch differs
  const onA = await pixels(2.04), onB = await pixels(2.4);
  const dOn = diff(onA, offA), dLate = diff(onB, offB);
  expect(dOn, 'punch changes the frame right on a kick').toBeGreaterThan(200);
  expect(dLate, `…and has mostly died away 0.36 s later (${dLate} vs ${dOn}): short, not a constant zoom`).toBeLessThan(dOn * 0.5);
  await page.check('#avDust'); await capture(page);
  // seekable: jumping straight to t equals playing up to t
  const direct = await frameAt([3.3]);
  expect(await frameAt([3.0]), 'sanity: different times differ').not.toBe(direct);
  const seqTo = await frameAt([...Array.from({ length: 99 }, (_, i) => i / 30), 3.3]);
  expect(seqTo, 'record + dust + punch depend only on t').toBe(direct);
});

test('the red horror template never "punches" (photosensitive rule for saturated red)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(4, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.click('#avTemplates [data-tpl=truyenma]');
  const frame = async () => { await capture(page); return page.evaluate(() => { const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; const x = c.getContext('2d'); sc.draw(x, 2.04); const d = x.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 29) h = (h * 31 + d[i]) >>> 0; return h; }); };
  const off = await frame();
  await page.check('#avPunch');
  expect(await frame()).toBe(off);
});

test('templates using the new styles export valid MP4s', async ({ page }, ti) => {
  test.skip(!hasFfprobe, 'ffprobe not installed');
  await openTab(page, 'audiovideo');
  const c = await codecs(page);
  test.skip(!c.webcodecs, NO_EXPORT);
  test.skip(!c.aac, NO_AAC);
  await page.setInputFiles('#avAudio', beatSong(3, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  for (const id of ['sannhay', 'vinyl', 'quacau', 'podcast']) {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    const dl = await renderAndDownload(page, 'av', ti);
    const p = probe(dl.path);
    expect([id, p.video.codec, p.audio.codec, Math.abs(p.duration - 3) < 0.3]).toEqual([id, 'h264', 'aac', true]);
  }
});
