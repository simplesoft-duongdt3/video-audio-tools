// Sprint 1: export estimate, plain-language errors + retry, debug report, streamed audio + same fade on
// every export path, cache-busting. Each test names the user-visible risk it guards.
const { test, expect } = require('@playwright/test');
const { writeFileSync } = require('node:fs');
const { fx, probe, hasFfprobe, openTab, renderAndDownload, segmentLevel, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

/** Replace the clipboard writer with a spy (works on every engine, no permission prompts). */
const spyCopy = (page) => page.evaluate(() => { window.__copied = null; window.copyText = async (t) => { window.__copied = t; return true; }; });
const copied = (page) => page.evaluate(() => window.__copied || '');

test.describe('estimate before export', () => {
  test('each video tab shows size before the first export and time after it', async ({ page }, ti) => {
    await openTab(page, 'audiovideo');
    const est = page.locator('#tab-audiovideo [data-role=estimate]');
    await expect(est).toHaveText('', { timeout: 5000 }); // nothing to estimate without audio
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await expect(est).toContainText(/Ước tính: ~[\d.,]+ (KB|MB)/);
    const c = await codecs(page);
    // fast encoder: time unknown until measured (never made up); real-time recording: takes the video length
    await expect(est).toContainText(c.webcodecs ? 'đo ở lần đầu' : 'xuất ~0:03');
    await page.selectOption('#avSize', '720x1280');
    const small = await est.textContent();
    await page.selectOption('#avSize', '1080x1920');
    expect(await est.textContent(), 'estimate follows the frame size').not.toBe(small);

    test.skip(!c.webcodecs, NO_EXPORT);
    await renderAndDownload(page, 'av', ti);
    await expect(est).toContainText(/xuất ~\d+:\d\d/); // measured speed is now used
    // the measured speed is kept for the next visit
    expect(await page.evaluate(() => +localStorage.getItem('vat.exportFps'))).toBeGreaterThan(0);
  });

  test('image and text tabs show an estimate too; the iPhone size cap is announced', async ({ page }) => {
    await openTab(page, 'imgvideo');
    const iv = page.locator('#tab-imgvideo [data-role=estimate]');
    await expect(iv).toHaveText('');
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await expect(iv).toContainText('Ước tính');
    await page.evaluate(() => { VideoEngine.tuning.maxBytes = 1e5; });
    await page.fill('#ivDur', '30');
    await expect(iv).toContainText('đã giảm chất lượng');

    await page.click('#tabs button[data-tab="textvideo"]');
    await expect(page.locator('#tab-textvideo [data-role=estimate]')).toContainText('Ước tính');
  });
});

test.describe('errors: plain language, retry, copy debug info', () => {
  test('an export failure shows why, "Thử lại" re-runs it, and the report has the error + log', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.evaluate(() => {
      window.__realRender = VideoEngine.render;
      window.__calls = 0;
      VideoEngine.render = async () => { window.__calls++; throw new RangeError('Array buffer allocation failed'); };
    });
    await page.click('#avRender');
    const box = page.locator('#avOut .errbox');
    await expect(box).toBeVisible();
    await expect(box).toContainText('hết bộ nhớ');
    await expect(box).toContainText('720×1280'); // tells the user what to do
    await expect(box).toContainText('Array buffer allocation failed');
    await expect(page.locator('#avRender')).toHaveText('Xuất video MP4'); // button usable again

    await spyCopy(page);
    await box.locator('[data-a=copy]').click();
    await expect.poll(() => copied(page)).toContain('Lỗi: RangeError: Array buffer allocation failed');
    const report = await copied(page);
    expect(report).toContain('Nhật ký gần nhất');
    expect(report).toMatch(/Thiết bị: .+Mozilla/);
    expect(report).not.toContain(await page.evaluate(() => location.hash)); // page fragment not needed

    await box.locator('[data-a=retry]').click();
    await expect.poll(() => page.evaluate(() => window.__calls)).toBe(2);

    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.evaluate(() => { VideoEngine.render = window.__realRender; });
    await page.locator('#avOut .errbox [data-a=retry]').click();
    await expect(page.locator('#avOut video')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#avOut .errbox')).toHaveCount(0);
  });

  test('when the clipboard is blocked the report is shown to copy by hand', async ({ page }) => {
    await openTab(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
      document.execCommand = () => false;
      console.error('boom from test');
    });
    await page.evaluate(() => DebugInfo.copy());
    const ta = page.locator('dialog.copybox textarea');
    await expect(ta).toBeVisible();
    expect(await ta.inputValue()).toContain('error boom from test'); // console errors are logged
    await page.click('dialog.copybox button');
    await expect(page.locator('dialog.copybox')).toHaveCount(0);
  });

  test('real clipboard works (Chrome)', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are a Chromium feature in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTab(page);
    await page.evaluate(() => DebugInfo.copy());
    await expect(page.locator('#toast')).toContainText('Đã sao chép');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Video & Audio Tools');
  });
});

test.describe('audio on every export path (streamed, faded, no gaps)', () => {
  /**
   * Export `seconds` of a 440 Hz sine made in the page (sample rate / channels chosen by the test) and return
   * windowed RMS of the decoded result. Catches gaps or clicks at the 1-second chunk joins, missing fade, mono→stereo.
   */
  async function sineExport(page, { sr, ch, seconds, offset, src }) {
    return page.evaluate(async ({ sr, ch, seconds, offset, src }) => {
      const n = Math.round(src * sr);
      const ab = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
      for (let c = 0; c < ch; c++) ab.copyToChannel(Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)), c);
      const scene = { width: 320, height: 568, fps: 30, duration: seconds, audio: ab, audioOffset: offset, draw: (ctx) => { ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 320, 568); } };
      const r = await VideoEngine.render(scene, () => {});
      const back = await decodeAudioFile(new File([r.blob], 'x.mp4', { type: 'video/mp4' }));
      const win = Math.round(back.sampleRate * 0.025);
      const rmsAt = (data, t) => Core.rms(data.subarray(Math.round(t * back.sampleRate), Math.round(t * back.sampleRate) + win));
      const L = back.getChannelData(0), R = back.getChannelData(back.numberOfChannels - 1);
      const mid = [];
      for (let t = 0.2; t < seconds - 0.6; t += 0.025) mid.push(rmsAt(L, t));
      const bytes = new Uint8Array(await r.blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        mode: r.mode, channels: back.numberOfChannels, min: Math.min(...mid), max: Math.max(...mid),
        right: rmsAt(R, 1.0), tail: rmsAt(L, seconds - 0.06), b64: btoa(bin),
      };
    }, { sr, ch, seconds, offset, src });
  }

  for (const [label, sr, ch] of [['44.1 kHz mono (streamed path)', 44100, 1], ['48 kHz stereo (streamed path)', 48000, 2], ['22.05 kHz (resampled path)', 22050, 2]]) {
    test(`${label}: steady level across chunk joins, fade-out at the end, stereo out`, async ({ page }, ti) => {
      await openTab(page, 'audiovideo');
      const c = await codecs(page);
      test.skip(!c.webcodecs, NO_EXPORT);
      test.skip(!c.aac, NO_AAC);
      const r = await sineExport(page, { sr, ch, seconds: 3.2, offset: 0.3, src: 4 });
      expect(r.mode).toBe('fast');
      expect(r.channels).toBe(2);
      expect(r.min / r.max, `RMS ${r.min.toFixed(3)}…${r.max.toFixed(3)}: a gap/click at a 1 s join would dip`).toBeGreaterThan(0.9);
      expect(r.right, 'mono source is copied to both channels').toBeGreaterThan(0.25);
      expect(r.tail, 'faded out at the end').toBeLessThan(r.max * 0.4);
      const file = ti.outputPath('sine.mp4');
      writeFileSync(file, Buffer.from(r.b64, 'base64'));
      const p = probe(file);
      expect(p.audio.codec).toBe('aac');
      expect(Math.abs(p.duration - 3.2)).toBeLessThan(0.25);
    });
  }

  test('fast path: a clip that ends before the song fades out (file-level check)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffmpeg not installed');
    await openTab(page, 'audiovideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.fill('#avDur', '2');
    const dl = await renderAndDownload(page, 'av', ti);
    const mid = segmentLevel(dl.path, 0.5, 0.9), end = segmentLevel(dl.path, 1.92, 0.07);
    expect(end, `end ${end} dB vs middle ${mid} dB`).toBeLessThan(mid - 8);
  });

  test('real-time fallback gets the same fade-out as the fast path (was missing)', async ({ page }, ti) => {
    test.skip(!ti.project.name.startsWith('desktop'), 'one browser is enough');
    await page.addInitScript(() => {
      window.VideoEncoder = undefined;
      window.__ramps = [];
      const orig = AudioParam.prototype.linearRampToValueAtTime;
      AudioParam.prototype.linearRampToValueAtTime = function (v, t) { window.__ramps.push([v, t]); return orig.call(this, v, t); };
    });
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.fill('#avDur', '1.5');
    await page.evaluate(() => { window.__ramps.length = 0; });
    await page.click('#avRender');
    await expect(page.locator('#avOut video')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#avOut .warn')).toContainText('thời gian thực');
    const ramps = await page.evaluate(() => window.__ramps);
    expect(ramps.some(([v]) => v === 0), 'a ramp to silence was scheduled').toBe(true);
  });
});

test.describe('cache-busting (stale JS after a deploy)', () => {
  test('every local script and stylesheet is requested with ?v=<content hash>', async ({ page }) => {
    const urls = [];
    page.on('request', (r) => { if (/\/(js|assets)\//.test(r.url())) urls.push(r.url()); });
    await openTab(page);
    expect(urls.length).toBeGreaterThanOrEqual(11);
    for (const u of urls) expect(u, u).toMatch(/\?v=[0-9a-f]{10}$/);
  });
});
