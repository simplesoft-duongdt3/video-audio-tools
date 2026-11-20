const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { audioLevel, fx, probe, hasFfprobe, openTab, renderAndDownload, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

test.skip(!hasFfprobe, 'ffprobe not installed');

const caps = codecs;

/** The source fixtures peak at about −19…−22 dBFS: the exported track must be just as loud (not silent). */
const SOURCE_PEAK_DB = -22.5;

function expectVideo(file, { width, height, duration, audio = true, fast = true }) {
  const p = probe(file);
  expect(p.video, 'video stream').not.toBeNull();
  if (fast) {
    expect(p.format).toContain('mp4');
    expect(p.video.codec).toBe('h264');
  }
  expect(p.video.width).toBe(width);
  expect(p.video.height).toBe(height);
  if (audio) {
    expect(p.audio, 'audio stream').not.toBeNull();
    expect(p.audio.channels).toBe(2);
    // AAC only: Opus-in-MP4 is silent on iPhone Photos / QuickTime / Windows players
    if (fast) expect(p.audio.codec, 'audio codec').toBe('aac');
    const lvl = audioLevel(file);
    expect(lvl.max, 'audio peak dBFS (silent output?)').toBeGreaterThan(SOURCE_PEAK_DB - 3);
    expect(lvl.mean, 'audio mean dBFS').toBeGreaterThan(-40);
  }
  if (duration && Number.isFinite(p.duration)) expect(Math.abs(p.duration - duration)).toBeLessThan(fast ? 0.25 : 0.8);
}

test.describe('image + audio → video', () => {
  test('1 photo + m4a, 2 s, TikTok 1080×1920', async ({ page }, ti) => {
    const errors = await openTab(page, 'imgvideo');
    const c = await caps(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#ivImages', [fx('photo.jpg'), fx('photo.png')]);
    await expect(page.locator('#ivThumbs .t')).toHaveCount(2);
    await page.setInputFiles('#ivAudio', fx('tone.m4a'));
    await expect(page.locator('#ivAudioInfo')).toContainText('0:03');
    await page.fill('#ivDur', '2');
    const dl = await renderAndDownload(page, 'iv', ti);
    expect(dl.name).toMatch(/^tone-video\.(mp4|webm)$/);
    expectVideo(dl.path, { width: 1080, height: 1920, duration: 2, fast: c.webcodecs });
    expect(errors).toEqual([]);
  });

  test('start offset past the end is rejected', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await page.setInputFiles('#ivAudio', fx('tone.mp3'));
    await expect(page.locator('#ivAudioInfo')).toContainText('0:03');
    await page.fill('#ivStart', '10');
    await page.click('#ivRender');
    await expect(page.locator('#toast')).toContainText('phải nhỏ hơn');
    await expect(page.locator('#ivOut video')).toHaveCount(0);
  });
});

test.describe('text + audio → video', () => {
  test('3 slides + mp3 → 3 s video', async ({ page }, ti) => {
    const errors = await openTab(page, 'textvideo');
    const c = await caps(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.click('#tvTemplates [data-tpl] >> nth=2');
    await page.setInputFiles('#tvAudio', fx('tone.mp3'));
    await expect(page.locator('#tvAudioInfo')).toContainText('3 slide');
    await page.selectOption('#tvSizeSel', '720x1280');
    const dl = await renderAndDownload(page, 'tv', ti);
    expectVideo(dl.path, { width: 720, height: 1280, duration: 3, fast: c.webcodecs });
    expect(errors).toEqual([]);
  });

  test('slide PNG export', async ({ page }) => {
    await openTab(page, 'textvideo');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tvPng')]);
    expect(dl.suggestedFilename()).toBe('slide-1.png');
  });
});

test.describe('audio → video', () => {
  for (const [file, type] of [['tone.m4a', 'm4a'], ['tone.mp3', 'mp3'], ['tone.wav', 'wav'], ['tone.flac', 'flac'], ['tone.ogg', 'ogg/opus'], ['clip.mp4', 'video mp4']]) {
    test(`decodes ${type}`, async ({ page }, ti) => {
      await openTab(page, 'audiovideo');
      if (/m4a|mp4/.test(file)) test.skip(!(await codecs(page)).aac, NO_AAC);
      await page.setInputFiles('#avAudio', fx(file));
      const info = page.locator('#avAudioInfo');
      await expect(info).not.toHaveText('Đang đọc audio…');
      const text = await info.textContent();
      // Safari has never decoded Ogg Vorbis/Opus on every version: allowed to fail there, with a clear message.
      if (file === 'tone.ogg' && ti.project.name.startsWith('iphone') && !text.includes('0:03')) {
        expect(text).toContain('Không giải mã được');
        return;
      }
      expect(text).toContain('0:03');
      expect(text).toContain(file);
    });
  }

  test('rejects a non-audio file with a clear message', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('notaudio.txt'));
    await expect(page.locator('#avAudioInfo')).toContainText(/không phải file audio|Không giải mã được/);
    await page.click('#avRender');
    await expect(page.locator('#toast')).toContainText('Hãy chọn file audio');
  });

  test('preview draws a live visualizer for the loaded audio', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('tone.mp3'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await expect(page.locator('#avTitle')).toHaveAttribute('placeholder', /Tự lấy/);
    // the 1 kHz / 440 Hz tones must light up some bars: count bright, saturated pixels in the visualizer strip
    const lit = await page.evaluate(() => {
      const c = document.getElementById('avCanvas');
      const ctx = c.getContext('2d');
      const y0 = Math.round(c.height * 0.62), y1 = Math.round(c.height * 0.8);
      const d = ctx.getImageData(0, y0, c.width, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 180) n++;
      return n;
    });
    expect(lit).toBeGreaterThan(500);
  });

  test('m4a → MP4 1080×1920 with bars (default)', async ({ page }, ti) => {
    const errors = await openTab(page, 'audiovideo');
    const c = await caps(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#avAudio', fx('tone.m4a'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.fill('#avTitle', 'Bài hát thử – Tiếng Việt có dấu');
    await page.fill('#avSub', '@duong');
    const dl = await renderAndDownload(page, 'av', ti);
    expect(dl.name).toMatch(/^tone-video\.(mp4|webm)$/);
    expectVideo(dl.path, { width: 1080, height: 1920, duration: 3, fast: c.webcodecs });
    expect(errors).toEqual([]);
  });

  test('every style + cover image + landscape renders, with start offset', async ({ page }, ti) => {
    await openTab(page, 'audiovideo');
    const c = await caps(page);
    test.skip(!c.webcodecs, 'needs the fast WebCodecs path (real-time recording would take too long)');
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.setInputFiles('#avImg', fx('photo.jpg'));
    await expect(page.locator('#avBgMode')).toHaveValue('image');
    await page.selectOption('#avSize', '1920x1080');
    await page.selectOption('#avFps', '24');
    await page.fill('#avStart', '1');
    for (const style of ['mirror', 'wave', 'circle', 'overview', 'none']) {
      await page.selectOption('#avStyle', style);
      const dl = await renderAndDownload(page, 'av', ti);
      expectVideo(dl.path, { width: 1920, height: 1080, duration: 2 });
    }
  });

  test('cancel stops the render', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const c = await caps(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.selectOption('#avFps', '60');
    await page.click('#avRender');
    await expect(page.locator('#avRender')).toHaveText('Huỷ');
    await page.click('#avRender');
    await expect(page.locator('#avRender')).toHaveText('Xuất video MP4');
    await expect(page.locator('#avOut video')).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Đã huỷ');
    await expect(page.locator('#avOut .errbox'), 'cancel is not an error').toHaveCount(0);
  });

  test('play preview starts and stops', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('tone.mp3'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.click('#avPlay');
    await expect(page.locator('#avPlay')).toHaveText('■ Dừng');
    await page.waitForTimeout(800);
    await expect(page.locator('#avPlay'), 'still playing after 0.8 s').toHaveText('■ Dừng');
    await page.click('#avPlay');
    await expect(page.locator('#avPlay')).toHaveText('▶ Xem thử');
  });

  for (const [tab, prefix, setup] of [
    ['imgvideo', 'iv', async (page) => { await page.setInputFiles('#ivImages', [fx('photo.jpg')]); await page.setInputFiles('#ivAudio', fx('tone.mp3')); await expect(page.locator('#ivAudioInfo')).toContainText('0:03'); }],
    ['textvideo', 'tv', async (page) => { await page.fill('#tvSlideDur', '0.5'); }],
    ['audiovideo', 'av', async (page) => { await page.setInputFiles('#avAudio', fx('tone.mp3')); await expect(page.locator('#avAudioInfo')).toContainText('0:03'); await page.fill('#avDur', '1.5'); }],
  ]) {
    test(`${tab}: preview plays to the end and resets the button`, async ({ page }) => {
      await openTab(page, tab);
      await setup(page);
      await page.click(`#${prefix}Play`);
      await expect(page.locator(`#${prefix}Play`)).toHaveText('■ Dừng');
      await page.waitForTimeout(500);
      await expect(page.locator(`#${prefix}Play`)).toHaveText('■ Dừng');
      await expect(page.locator(`#${prefix}Play`)).toHaveText('▶ Xem thử', { timeout: 10_000 });
    });
  }
});

test.describe('export path robustness (TikTok stutter / slow export)', () => {
  test('exported video has a perfectly constant frame rate', async ({ page }, ti) => {
    await openTab(page, 'textvideo');
    const c = await caps(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    await page.setInputFiles('#tvAudio', fx('tone.mp3'));
    await expect(page.locator('#tvAudioInfo')).toContainText('3 slide');
    const dl = await renderAndDownload(page, 'tv', ti);
    const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', dl.path])
      .toString().trim().split('\n').map(Number).sort((a, b) => a - b);
    const deltas = new Set(pts.slice(1).map((p, i) => (p - pts[i]).toFixed(4)));
    expect([...deltas]).toEqual(['0.0333']);
    expect(pts.length).toBe(90);
  });

  test('an encoder setting the device rejects is retried on the fast path, not recorded in real time', async ({ page }, ti) => {
    await openTab(page, 'audiovideo');
    const c = await caps(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    // On machines without a hardware H.264 encoder this makes the first attempt fail.
    await page.evaluate(() => { VideoEngine.tuning.hardwareAcceleration = 'prefer-hardware'; });
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    const t0 = Date.now();
    const dl = await renderAndDownload(page, 'av', ti);
    expect(Date.now() - t0, 'faster than real time').toBeLessThan(15000);
    await expect(page.locator('#avOut .warn')).toHaveCount(0);
    expectVideo(dl.path, { width: 1080, height: 1920, duration: 3 });
  });

  test('when there is no WebCodecs, the real-time fallback says why', async ({ page }, ti) => {
    test.skip(!ti.project.name.startsWith('desktop'), 'one browser is enough');
    await page.addInitScript(() => { window.VideoEncoder = undefined; });
    await openTab(page, 'textvideo');
    await expect(page.locator('#caps')).toContainText('ghi thời gian thực', { timeout: 15000 });
    await page.fill('#tvSlideDur', '0.7');
    await page.click('#tvRender');
    await expect(page.locator('#tvOut .warn')).toContainText('không có WebCodecs', { timeout: 30000 });
  });
});

test.describe('file size (iPhone "Failed to download" on big files)', () => {
  test('a size cap keeps the file under the limit; moving content stays well under the old 4.4 Mbps', async ({ page }, ti) => {
    await openTab(page, 'imgvideo');
    const c = await caps(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await page.selectOption('#ivFx', 'kenburns'); // every pixel moves every frame: worst case for size
    await page.setInputFiles('#ivAudio', fx('tone.wav'));
    await expect(page.locator('#ivAudioInfo')).toContainText('0:03');
    await page.fill('#ivDur', '3');
    // Cap 1.0 MB for 3 s (same ratio as 80 MB for ~4 min)
    await page.evaluate(() => { VideoEngine.tuning.maxBytes = 1.0e6; });
    const dl = await renderAndDownload(page, 'iv', ti);
    const size = require('node:fs').statSync(dl.path).size;
    expect(size, 'capped size').toBeLessThanOrEqual(1.0e6);
    expectVideo(dl.path, { width: 1080, height: 1920, duration: 3 });
  });
});
