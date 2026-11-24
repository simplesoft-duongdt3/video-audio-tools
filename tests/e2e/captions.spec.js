// Burned-in captions (phụ đề). Each test names the user-visible problem it prevents.
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { fx, hasFfprobe, openTab, grabDownload, renderAndDownload, codecs, NO_EXPORT } = require('./helpers');

const W = 720, H = 1280;
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nXIN CHÀO CÁC BẠN\n';

/** One decoded frame at `t` seconds → { at(x, y) → [r, g, b] }. */
function frameAt(file, t) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
  const b = r.stdout;
  if (b.length < W * H * 3) throw new Error('ffmpeg could not decode a frame: ' + r.stderr);
  return { at: (x, y) => [b[(y * W + x) * 3], b[(y * W + x) * 3 + 1], b[(y * W + x) * 3 + 2]] };
}
const white = ([r, g, b]) => r > 225 && g > 225 && b > 225;
const yellow = ([r, g, b]) => r > 215 && g > 190 && b < 130;
/** How many pixels of rows [y0, y1) match. */
function count(f, y0, y1, pred) {
  let n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < W; x += 2) if (pred(f.at(x, y))) n++;
  return n;
}

/** A plain dark frame (no visualizer, no time bar): only the title and the captions are light. */
async function plainAudioVideo(page) {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', fx('tone.wav'));
  await expect(page.locator('#avAudioInfo')).toContainText('tone.wav');
  await page.selectOption('#avSize', `${W}x${H}`);
  await page.selectOption('#avStyle', 'none');
  await page.selectOption('#avBgMode', 'color');
  await page.locator('#avBgColor').evaluate((e) => { e.value = '#203040'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.uncheck('#avProgress');
}
const importSrt = (page, id, text, name = 'phu-de.srt') => page.setInputFiles(`#${id}CapFile`, { name, mimeType: 'application/x-subrip', buffer: Buffer.from(text) });

test.describe('captions', () => {
  test('an imported .srt caption is burned into the exported video at its time — and only then — inside the TikTok/Reels/Shorts safe zone', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'needs ffmpeg');
    await plainAudioVideo(page);
    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await importSrt(page, 'av', SRT);
    await expect(page.locator('#avCapStatus')).toContainText('1 câu có giờ');
    await expect(page.locator('#avCapList li')).toHaveText(['0:01.0–0:02.0 · XIN CHÀO CÁC BẠN']);
    const dl = await renderAndDownload(page, 'av', ti);
    const safe = await page.evaluate(([w, h]) => Core.captionRect(w, h), [W, H]);
    const on = frameAt(dl.path, 1.5), before = frameAt(dl.path, 0.5), after = frameAt(dl.path, 2.5);
    const band = [Math.round(safe.y + safe.h * 0.75), safe.y + safe.h]; // the caption sits at the bottom of the safe box
    expect(count(on, ...band, white), 'caption text visible at 1.5 s').toBeGreaterThan(150);
    expect(count(on, ...band, yellow), 'the word being said is highlighted').toBeGreaterThan(20);
    expect(count(before, ...band, white), 'no caption before its start').toBeLessThan(10);
    expect(count(after, ...band, white), 'no caption after its end').toBeLessThan(10);
    // nothing of the caption is drawn where the app buttons / description cover the video
    expect(count(on, safe.y + safe.h, H, (p) => white(p) || yellow(p)), 'below the safe zone').toBe(0);
  });

  test('the still preview shows the caption the export will have (preview = export)', async ({ page }) => {
    await plainAudioVideo(page);
    await importSrt(page, 'av', SRT);
    // the preview redraws on the next animation frame: wait for it
    await expect.poll(() => page.evaluate(() => {
      const c = document.getElementById('avCanvas'), r = Core.captionRect(c.width, c.height);
      const y0 = Math.round(r.y + r.h * 0.75), d = c.getContext('2d').getImageData(0, y0, c.width, r.y + r.h - y0).data;
      let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) k++;
      return k / (c.width * c.width) * 1e4; // phones preview at a lower resolution: per 10 000 px²
    }), { message: 'white caption pixels in the preview' }).toBeGreaterThan(40);
  });

  test('pasted lines get their times from holding the button while each line is said', async ({ page, browserName }) => {
    await plainAudioVideo(page);
    await page.fill('#avCapText', 'Câu một\nCâu hai');
    await expect(page.locator('#avCapStatus')).toContainText('chia đều');
    await page.click('#avCapTap');
    await expect(page.locator('#avCapTapBox')).toBeVisible();
    const running = await page.evaluate(async () => { const a = audioCtx(); const t = a.currentTime; await new Promise((r) => setTimeout(r, 300)); return a.currentTime > t; });
    test.skip(!running, `the ${browserName} test build plays no audio clock`);
    const hold = page.locator('#avCapHold');
    await expect(page.locator('#avCapTapBox .cap-now')).toContainText('Câu 1/2');
    await hold.dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForTimeout(500);
    await hold.dispatchEvent('pointerup', { pointerId: 1 });
    await expect(page.locator('#avCapTapBox .cap-now')).toContainText('Câu 2/2');
    await page.waitForTimeout(200);
    await hold.dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForTimeout(500);
    await hold.dispatchEvent('pointerup', { pointerId: 1 });
    await expect(page.locator('#avCapTapBox .cap-now')).toContainText('Đã bắt nhịp hết');
    await page.click('#avCapStop');
    await expect(page.locator('#avCapStatus')).toContainText('2 câu có giờ');
    const t = await page.locator('#avCapList li').allTextContents();
    const nums = t.map((s) => s.match(/(\d+):([\d.]+)–(\d+):([\d.]+)/).slice(1).map(Number)).map(([a, b, c, d]) => [a * 60 + b, c * 60 + d]);
    expect(nums[0][1]).toBeGreaterThan(nums[0][0]);
    expect(nums[1][0]).toBeGreaterThanOrEqual(nums[0][1]);
    expect(nums[1][1] - nums[1][0], 'held ~0.5 s').toBeGreaterThan(0.25);
  });

  test('"Tải file .srt" gives times of the exported clip (0 = the chosen start), for uploading to YouTube', async ({ page }, ti) => {
    await plainAudioVideo(page);
    await page.fill('#avStart', '1');
    await page.locator('#avStart').dispatchEvent('input');
    await importSrt(page, 'av', SRT.replace('00:00:01,000 --> 00:00:02,000', '00:00:01,500 --> 00:00:02,500'));
    const dl = await grabDownload(page, () => page.click('#avCapSrt'), ti);
    expect(dl.name).toBe('phu-de.srt');
    expect(readFileSync(dl.path, 'utf8')).toBe('1\n00:00:00,500 --> 00:00:01,500\nXIN CHÀO CÁC BẠN\n');
  });

  test('a file that is not subtitles is refused with a message (nothing silently disappears)', async ({ page }) => {
    await plainAudioVideo(page);
    await importSrt(page, 'av', 'hello world', 'notes.srt');
    await expect(page.locator('#toast')).toContainText('không có câu phụ đề');
    await expect(page.locator('#avCapStatus')).toContainText('Chưa có phụ đề');
  });

  test('Ảnh + Audio: captions too, and the controls are big enough to tap', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.setInputFiles('#ivImages', [fx('photo.jpg')]);
    await page.setInputFiles('#ivAudio', fx('tone.wav'));
    await page.fill('#ivCapText', 'Một dòng phụ đề');
    await expect(page.locator('#ivCapStatus')).toContainText('1 câu');
    for (const id of ['#ivCapTap', '#ivCapSpread', '#ivCapSrt', '#ivCapClear']) {
      const b = await page.locator(id).boundingBox();
      expect(b.height, id).toBeGreaterThanOrEqual(44);
    }
    await expect.poll(() => page.evaluate(() => {
      const c = document.getElementById('ivCanvas'), r = Core.captionRect(c.width, c.height);
      const y0 = Math.round(r.y + r.h * 0.6), d = c.getContext('2d').getImageData(0, y0, c.width, r.y + r.h - y0).data;
      let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 215 && d[i + 1] > 190 && d[i + 2] < 130) k++; // the yellow word
      return k / (c.width * c.width) * 1e4;
    }), { message: 'highlighted caption word in the preview' }).toBeGreaterThan(5);
  });
});

/* ---------------- review fixes: placement, import, timing (each names the user-visible problem) ---------------- */
const TWO = '1\n00:00:00,300 --> 00:00:01,200\nNgắn thôi\n\n2\n00:00:01,500 --> 00:00:02,800\nMột câu phụ đề rất dài nhiều chữ để phải xuống ba dòng liền trên khung dọc của điện thoại nhé các bạn\n';

/** Rows [top, bottom] of the highlight-yellow pixels of a frame drawn from the tab's own scene at t. */
async function yellowRows(page, t) {
  return page.evaluate((t) => {
    const sc = AVTest.scene(), c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
    const x = c.getContext('2d'); sc.draw(x, t);
    const d = x.getImageData(0, 0, c.width, c.height).data; let top = -1, bot = -1;
    for (let y = 0; y < c.height; y++) for (let i = y * c.width * 4, e = i + c.width * 4; i < e; i += 8) {
      if (d[i] > 240 && d[i + 1] > 210 && d[i + 1] < 235 && d[i + 2] > 60 && d[i + 2] < 100) { if (top < 0) top = y; bot = y; break; }
    }
    return { top, bot, band: sc.captionBand && sc.captionBand(), zones: sc.zones, H: c.height };
  }, t);
}

test.describe('captions: review fixes', () => {
  for (const size of ['720x1280', '1080x1080']) {
    test(`${size}: captions keep ONE place for the whole video and stay off the cover art and time bar (they jumped over the art)`, async ({ page }) => {
      await openTab(page, 'audiovideo');
      await page.setInputFiles('#avAudio', fx('tone.wav'));
      await expect(page.locator('#avAudioInfo')).toContainText('tone.wav');
      await page.selectOption('#avSize', size);
      await importSrt(page, 'av', TWO);
      await expect(page.locator('#avCapStatus')).toContainText('2 câu có giờ');
      const a = await yellowRows(page, 0.75), b = await yellowRows(page, 2.4);
      expect(a.top, 'short caption drawn').toBeGreaterThan(0);
      expect(b.top, 'long caption drawn').toBeGreaterThan(0);
      const [b0, b1] = a.band;
      for (const r of [a, b]) { expect(r.top).toBeGreaterThanOrEqual(b0 - 2); expect(r.bot).toBeLessThanOrEqual(b1 + 2); }
      expect(Math.abs(a.bot - b.bot), 'both end on the same baseline (bottom-aligned band)').toBeLessThan(a.H * 0.05);
      const hit = (z) => z && z[1] > z[0] && b0 < z[1] && b1 > z[0];
      // 9:16 has room beside the art; a square frame may have to use the art as the last resort (never the bar)
      if (size === '720x1280') expect(hit(a.zones.art), `band ${a.band} vs art ${a.zones.art}`).toBe(false);
      expect(hit(a.zones.prog), `band ${a.band} vs time bar ${a.zones.prog}`).toBe(false);
      expect(hit(a.zones.text), 'never over the title').toBe(false);
    });
  }

  /** A captions block on its own (no tab): clip = { start, duration }. */
  async function sandbox(page, clip) {
    await openTab(page, 'audiovideo');
    await page.evaluate((clip) => {
      const box = document.createElement('div'); box.id = 'zzBox'; document.body.append(box);
      window.__cap = Captions.mount({ box, id: 'zz', getClip: () => ({ audio: null, ...clip }) });
    }, clip);
  }
  const list = (page) => page.locator('#zzCapList li').allTextContents();

  test('the .srt the app downloads comes back at the same time when imported again (it landed early)', async ({ page }, ti) => {
    await sandbox(page, { start: 1, duration: 8 });
    await importSrt(page, 'zz', '1\n00:00:01,500 --> 00:00:02,500\nMột\n');
    expect(await list(page)).toEqual(['0:01.5–0:02.5 · Một']); // song times
    const dl = await grabDownload(page, () => page.click('#zzCapSrt'), ti);
    const srt = readFileSync(dl.path, 'utf8');
    expect(srt).toContain('00:00:00,500 --> 00:00:01,500'); // the video's own times (0 = clip start)
    await importSrt(page, 'zz', srt);
    expect(await list(page), 'same song time after the round trip').toEqual(['0:01.5–0:02.5 · Một']);
    await expect(page.locator('#toast')).toContainText('tính từ đầu đoạn');
  });

  test('"Lệch giờ" moves every caption; removing silences moves later captions with the words', async ({ page }) => {
    await sandbox(page, { start: 0, duration: 20 });
    await importSrt(page, 'zz', '1\n00:00:05,000 --> 00:00:06,000\nA\n\n2\n00:00:10,000 --> 00:00:11,000\nB\n');
    await page.fill('#zzCapShift', '0.5');
    await page.locator('#zzCapShift').dispatchEvent('input');
    expect(await list(page)).toEqual(['0:05.5–0:06.5 · A', '0:10.5–0:11.5 · B']);
    await page.fill('#zzCapShift', '0');
    await page.locator('#zzCapShift').dispatchEvent('input');
    await page.evaluate(() => __cap.setCuts([{ from: 7, to: 9 }])); // 2 s of silence removed between A and B
    expect(await list(page)).toEqual(['0:05.0–0:06.0 · A', '0:08.0–0:09.0 · B']);
    // a file imported AFTER the cut is read on the shortened song, kept on the original one
    await importSrt(page, 'zz', '1\n00:00:08,000 --> 00:00:09,000\nB\n');
    await page.evaluate(() => __cap.setCuts(null));
    expect(await list(page)).toEqual(['0:10.0–0:11.0 · B']);
  });

  test('"Chia đều" spreads the lines over the CHOSEN part of the song, not from 0', async ({ page }) => {
    await sandbox(page, { start: 30, duration: 10 });
    await page.fill('#zzCapText', 'Một\nHai');
    await page.locator('#zzCapText').dispatchEvent('input');
    await expect.poll(() => list(page)).toEqual(['0:30.0–0:35.0 · Một', '0:35.0–0:40.0 · Hai']);
  });

  test('times are rounded before minutes: 59.96 s reads 1:00.0, not "0:60.0"', async ({ page }) => {
    await sandbox(page, { start: 0, duration: 120 });
    await importSrt(page, 'zz', '1\n00:00:00,500 --> 00:00:59,960\nA\n');
    expect(await list(page)).toEqual(['0:00.5–1:00.0 · A']);
  });

  test('a bad character code in the file shows a clear result instead of silently doing nothing', async ({ page }) => {
    await sandbox(page, { start: 0, duration: 10 });
    await importSrt(page, 'zz', '1\n00:00:01,000 --> 00:00:02,000\nA &#99999999; B\n');
    await expect(page.locator('#toast')).toContainText('Đã nhập 1 câu');
    expect(await list(page)).toEqual(['0:01.0–0:02.0 · A &#99999999; B']);
  });

  test('a huge subtitle file is refused with a message about subtitles (it froze typing for 1.3 s per key)', async ({ page }) => {
    await sandbox(page, { start: 0, duration: 10 });
    await page.setInputFiles('#zzCapFile', { name: 'to.srt', mimeType: 'application/x-subrip', buffer: Buffer.alloc(3 * 1048576, 'a') });
    await expect(page.locator('#toast')).toContainText('quá lớn');
    await expect(page.locator('#toast')).toContainText('file phụ đề');
    await expect(page.locator('#zzCapStatus')).toContainText('Chưa có phụ đề');
  });

  test('size, dark box and the 3-line limit really change the drawing', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const r = await page.evaluate(() => {
      const cue = [{ start: 0, end: 5, text: 'Một câu phụ đề rất rất dài, dài đến mức phải xuống dòng nhiều lần, nhiều hơn ba dòng rất nhiều lần nữa nhé các bạn ơi' }];
      const shot = (st) => {
        const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, 720, 1280);
        Captions.draw(x, cue, 1, 720, 1280, st);
        const d = x.getImageData(0, 0, 720, 1280).data; let dark = 0, grey = 0, rows = new Set();
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) { dark++; rows.add(Math.floor(i / 4 / 720)); }
          else if (d[i] > 80 && d[i] < 115 && Math.abs(d[i] - d[i + 2]) < 6) grey++; // the 62 % black box over white
        }
        return { dark, grey, h: Math.max(...rows) - Math.min(...rows) };
      };
      const P = Captions.prepare(cue, 720, 1280, { size: 'm' });
      return { s: shot({ size: 's' }), l: shot({ size: 'l' }), box: shot({ size: 'm', box: true }), nobox: shot({ size: 'm' }), lines: P.lay[0].lines.length };
    });
    expect(r.lines, 'cut to 3 lines').toBeLessThanOrEqual(3);
    expect(r.box.grey, 'the dark box is drawn').toBeGreaterThan(r.nobox.grey + 5000);
    expect(r.l.dark + r.l.h, 'Lớn is bigger than Nhỏ').toBeGreaterThan(r.s.dark + r.s.h);
  });

  test('"Bắt nhịp" stopped before the first line keeps the imported timings (one click wiped them)', async ({ page, browserName }) => {
    await openTab(page, 'audiovideo');
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('tone.wav');
    await importSrt(page, 'av', SRT);
    await expect(page.locator('#avCapList li')).toHaveText(['0:01.0–0:02.0 · XIN CHÀO CÁC BẠN']);
    await page.click('#avCapTap');
    await page.click('#avCapStop');
    await expect(page.locator('#avCapList li')).toHaveText(['0:01.0–0:02.0 · XIN CHÀO CÁC BẠN']);
  });
});
