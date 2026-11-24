// Text + Audio → Video for creators: beat-synced / tap-synced slide changes, music start, *keyword* boxes,
// hook + counter, reading-time warnings. Each test names the user-visible problem it prevents.
const { test, expect } = require('@playwright/test');
const { probe, hasFfprobe, openTab, renderAndDownload, codecs, NO_EXPORT } = require('./helpers');

const KICK0 = 0.3, KICK_EVERY = 0.5; // synthetic song: a kick drum every 0.5 s from 0.3 s

/** Give #tvAudio a 12 s WAV made in the page: kick drums (55 Hz thump) at known times over a soft pad. */
async function loadKickSong(page, seconds = 12) {
  await page.evaluate(async ({ seconds, KICK0, KICK_EVERY }) => {
    const sr = 22050, n = seconds * sr, d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = 0.02 * Math.sin((2 * Math.PI * 440 * i) / sr); // quiet pad: not a beat
    for (let t = KICK0; t < seconds; t += KICK_EVERY) {
      const a = Math.round(t * sr);
      for (let j = 0; j < 0.18 * sr && a + j < n; j++) d[a + j] += 0.9 * Math.exp(-j / (0.05 * sr)) * Math.sin((2 * Math.PI * 55 * j) / sr);
    }
    const wav = Core.encodeWav([d], sr);
    const dt = new DataTransfer();
    dt.items.add(new File([wav], 'kick-song.wav', { type: 'audio/wav' }));
    const inp = document.getElementById('tvAudio');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  }, { seconds, KICK0, KICK_EVERY });
  await expect(page.locator('#tvAudioInfo')).toContainText('kick-song.wav');
}

const setVal = (page, sel, v) => page.locator(sel).evaluate((e, v) => {
  if (e.type === 'checkbox') e.checked = v; else e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const FOUR = 'Một\n\nHai\n\nBa\n\nBốn';

test.describe('Text + Audio → Video: timing', () => {
  test('"Khớp nhịp trống": every slide change lands on a drum hit (even split cut between beats, off-rhythm)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', FOUR);
    await loadKickSong(page);
    const offBeat = (s) => s.slice(1).map((t) => Math.abs(((t - KICK0) / KICK_EVERY) - Math.round((t - KICK0) / KICK_EVERY)) * KICK_EVERY);
    const even = await page.evaluate(() => TextVideo.timing().starts);
    expect(Math.max(...offBeat(even)), 'even split (3, 6, 9 s) is between kicks').toBeGreaterThan(0.15);
    await page.selectOption('#tvSync', 'beat');
    const beat = await page.evaluate(() => TextVideo.timing());
    expect(beat.starts.length).toBe(4);
    for (const d of offBeat(beat.starts)) expect(d, `starts ${beat.starts}`).toBeLessThan(0.07); // within ~1.5 hops
    await expect(page.locator('#tvSyncInfo')).toContainText('3/3');
    // the drawn video follows the plan: just before / after a change shows the old / new slide
    const shown = await page.evaluate(() => {
      const T = TextVideo.timing();
      return [T.starts[2] - 0.05, T.starts[2] + 0.05].map((t) => Core.slideAt(T.starts, t));
    });
    expect(shown).toEqual([1, 2]);
  });

  test('"Theo lúc tôi bấm": slides change where the user tapped while listening', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    await page.selectOption('#tvSync', 'tap');
    await expect(page.locator('#tvTapRow')).toBeVisible();
    await page.click('#tvTapStart');
    await expect(page.locator('#tvTap')).toBeVisible();
    await expect(page.locator('#tvTap')).toContainText('2/3');
    // tap ~1.2 s and ~2.6 s into the song (measured on the page's own audio clock)
    const taps = await page.evaluate(async () => {
      const btn = document.getElementById('tvTap'), at = [];
      const waitUntil = (s) => new Promise((r) => { const f = () => (TextVideo.clock() >= s ? r() : setTimeout(f, 5)); f(); });
      for (const s of [1.2, 2.6]) { await waitUntil(s); at.push(TextVideo.clock()); btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }
      return at;
    });
    test.skip(taps[1] < 2, `${browserName}: the audio clock does not run in this headless build`);
    await expect(page.locator('#tvTap')).toBeHidden(); // stops by itself after the last change
    const T = await page.evaluate(() => TextVideo.timing());
    expect(T.starts[0]).toBe(0);
    expect(Math.abs(T.starts[1] - taps[0]), `starts ${T.starts} taps ${taps}`).toBeLessThan(0.05);
    expect(Math.abs(T.starts[2] - taps[1])).toBeLessThan(0.05);
    expect(T.duration).toBeCloseTo(12, 1);
    await expect(page.locator('#tvSyncInfo')).toContainText('2/2');
    // moving the music start invalidates the taps (they were relative to the old start)
    await setVal(page, '#tvStart', 2);
    expect((await page.evaluate(() => TextVideo.timing().starts))[1]).toBeCloseTo(10 / 3, 1); // even again: 10 s / 3
  });

  test('"Bắt đầu nhạc từ": the video uses the chosen part of the song, not always its intro', async ({ page }, ti) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', FOUR);
    await loadKickSong(page);
    await setVal(page, '#tvStart', 4);
    const sc = await page.evaluate(() => { const s = TextVideo.scene(); return { off: s.audioOffset, dur: s.duration }; });
    expect(sc.off).toBe(4);
    expect(sc.dur).toBeCloseTo(8, 2);
    await expect(page.locator('#tvSlidesSum')).toContainText('0:08');
    test.skip(!hasFfprobe, 'needs ffprobe');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    await page.selectOption('#tvSizeSel', '720x1280');
    const dl = await renderAndDownload(page, 'tv', ti);
    expect(Math.abs(probe(dl.path).duration - 8)).toBeLessThan(0.3);
  });

  test('a slide shown too briefly to read is flagged in the slide list (viewers scroll away from unreadable text)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Ngắn\n\nMột câu khá dài có rất nhiều chữ mà người xem cần thời gian để đọc cho hết được');
    await setVal(page, '#tvSlideDur', 1.5);
    const items = page.locator('#tvSlides .slide-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).not.toHaveClass(/warn/);
    await expect(items.nth(1)).toHaveClass(/warn/);
    await expect(items.nth(1)).toContainText('cần ~');
    await expect(page.locator('#tvSlidesSum')).toContainText('1 slide quá nhanh');
    await setVal(page, '#tvSlideDur', 8);
    await expect(items.nth(1)).not.toHaveClass(/warn/);
    // the list picks what the preview shows
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveAttribute('aria-current', 'true');
  });
});

/** Pixels of the preview canvas matching `test(r,g,b)`, and how many of them fall outside a rect. */
async function canvasPixels(page, rect, fn) {
  return page.evaluate(({ rect, fn }) => {
    const c = document.getElementById('tvCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const f = new Function('r', 'g', 'b', 'return ' + fn);
    const R = rect && Core.safeRect(rect, c.width, c.height);
    let all = 0, out = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (!f(d[i], d[i + 1], d[i + 2])) continue;
      all++;
      if (R && (x < R.x - 3 || x > R.x + R.w + 3 || y < R.y - 3 || y > R.y + R.h + 3)) out++;
    }
    return { all, out };
  }, { rect, fn });
}

test.describe('Text + Audio → Video: look', () => {
  test('*keyword* is drawn in a coloured box (and the stars themselves are not shown)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.selectOption('#tvSizeSel', '1080x1920');
    await setVal(page, '#tvBgMode', 'color');
    await setVal(page, '#tvBgColor', '#000000');
    await setVal(page, '#tvHi', '#00ff00');
    await setVal(page, '#tvText', 'Kiếm tiền *online* dễ');
    const green = 'g > 200 && r < 60 && b < 60';
    await expect.poll(async () => (await canvasPixels(page, null, green)).all, { message: 'green keyword box' }).toBeGreaterThan(2000);
    await setVal(page, '#tvText', 'Kiếm tiền online dễ');
    await expect.poll(async () => (await canvasPixels(page, null, green)).all, { message: 'no stars → no box' }).toBe(0);
    expect(await page.evaluate(() => Core.highlightWords('Kiếm tiền *online* dễ').plain), 'stars are never drawn').toBe('Kiếm tiền online dễ');
  });

  test('9:16: hook, slide counter, handle and long text all stay inside the TikTok safe zone', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.selectOption('#tvSizeSel', '1080x1920');
    await setVal(page, '#tvBgMode', 'color');
    await setVal(page, '#tvBgColor', '#000000');
    await setVal(page, '#tvHook', 'Ba mẹo đọc sách mỗi ngày mà ai cũng nên biết sớm');
    await setVal(page, '#tvCounter', true);
    await setVal(page, '#tvHandle', '@kenh_doc_sach_moi_ngay');
    await setVal(page, '#tvText', 'Một câu rất dài với nhiều chữ để chữ phải xuống dòng nhiều lần và dùng hết chỗ trống trên màn hình điện thoại *thật nhiều*\n\nHai');
    await page.waitForTimeout(150);
    const white = 'r > 200 && g > 200 && b > 200';
    const p = await canvasPixels(page, 'tiktok', white);
    expect(p.all, 'text drawn').toBeGreaterThan(3000);
    expect(p.out, 'white pixels under TikTok buttons / caption').toBe(0);
  });
});

/** Start "Nghe & bấm", tap at the given seconds of the page's audio clock. → the moments really tapped. */
async function recordTaps(page, at) {
  await page.selectOption('#tvSync', 'tap');
  await page.click('#tvTapStart');
  await expect(page.locator('#tvTap')).toBeVisible();
  return page.evaluate(async (at) => {
    const btn = document.getElementById('tvTap'), got = [];
    // the song's own clock (the player's), so the expected moments are exactly what the user heard
    const waitUntil = (s) => new Promise((r) => { const f = () => (TextVideo.clock() >= s ? r() : setTimeout(f, 5)); f(); });
    for (const s of at) { await waitUntil(s); got.push(TextVideo.clock()); btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }
    return got;
  }, at);
}

test.describe('Text + Audio → Video: review fixes', () => {
  test('taps recorded for 3 slides are not silently re-used after a slide is added (every slide would shift)', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    const got = await recordTaps(page, [1.2, 2.6]);
    test.skip(got[1] < 2, `${browserName}: the audio clock does not run in this headless build`);
    await expect(page.locator('#tvTap')).toBeHidden();
    expect((await page.evaluate(() => TextVideo.timing().starts))[1]).toBeLessThan(2);
    await setVal(page, '#tvText', 'Mới\n\nMột\n\nHai\n\nBa');
    const T = await page.evaluate(() => TextVideo.timing());
    expect(T.stale).toBe(true);
    expect(T.starts.map((x) => +x.toFixed(2)), 'old taps ignored → even split').toEqual([0, 3, 6, 9]);
    await expect(page.locator('#tvSyncInfo')).toContainText('Số slide đã đổi');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa'); // back to 3 slides: the taps fit again
    expect((await page.evaluate(() => TextVideo.timing().starts))[1]).toBeLessThan(2);
  });

  test('while tapping, the mode / text / music cannot be changed (it hid the stop button while music kept playing)', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    const got = await recordTaps(page, [0.8]);
    test.skip(got[0] < 0.6, `${browserName}: the audio clock does not run in this headless build`);
    for (const id of ['#tvSync', '#tvText', '#tvStart', '#tvAudio']) await expect(page.locator(id)).toBeDisabled();
    await expect(page.locator('#tvSyncInfo')).toContainText('Đang ghi');
    await expect(page.locator('#tvTapStart')).toContainText('Dừng ghi');
    // leaving the tab stops the music and keeps what was tapped
    await page.click('#tabs button[data-tab=thumb]');
    await page.click('#tabs button[data-tab=textvideo]');
    await expect(page.locator('#tvTap')).toBeHidden();
    await expect(page.locator('#tvSync')).toBeEnabled();
    expect(await page.evaluate(() => TextVideo.timing().starts[1])).toBeLessThan(1);
  });

  test('phone: the "Chuyển slide" button stays on screen while scrolling during recording', async ({ page, browserName }, ti) => {
    test.skip(ti.project.name === 'desktop-chrome', 'phone layout only');
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    await recordTaps(page, []);
    for (const where of ['top', 'down 400', 'bottom']) {
      await page.evaluate((w) => (w === 'top' ? scrollTo(0, 0) : w === 'bottom' ? scrollTo(0, document.body.scrollHeight) : scrollBy(0, 400)), where);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const b = document.getElementById('tvTap').getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, h: innerHeight };
      });
      expect(r.top, `${where}: ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, where).toBeLessThanOrEqual(r.h);
    }
    await page.click('#tvTapStart'); // stop
  });

  test('"Mỗi slide" is clearly unused in tap mode (the video length jumped from 6 s to 12 s after tapping)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    await setVal(page, '#tvSlideDur', 2);
    await expect(page.locator('#tvDurHint')).toContainText('Video dài 6,0s');
    await page.selectOption('#tvSync', 'tap');
    await expect(page.locator('#tvSlideDur')).toBeDisabled();
    await expect(page.locator('#tvDurHint')).toContainText('Không dùng khi tự bấm');
    expect(await page.evaluate(() => TextVideo.timing().duration)).toBeCloseTo(12, 1); // before taps too
  });

  test('"Bắt đầu nhạc từ" past the end is corrected visibly (it made a silent 1-second video)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await loadKickSong(page);
    const max = +(await page.locator('#tvStart').getAttribute('max'));
    expect(max).toBeGreaterThan(10.8); // song 12 s → at most ~11 s
    expect(max).toBeLessThanOrEqual(11);
    await page.fill('#tvStart', '30');
    await page.locator('#tvStart').blur();
    expect(+(await page.locator('#tvStart').inputValue())).toBeCloseTo(max, 1);
    await expect(page.locator('#toast, .toast').first()).toContainText('muộn nhất');
  });

  test('beat sync measures the chosen part of the song (start 1.1 s: changes still land on kicks)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', FOUR);
    await loadKickSong(page);
    await setVal(page, '#tvStart', 1.1);
    await page.selectOption('#tvSync', 'beat');
    const T = await page.evaluate(() => TextVideo.timing());
    expect(T.snapped).toBe(3);
    for (const t of T.starts.slice(1)) {
      const song = t + 1.1; // position in the song
      const d = Math.abs(((song - KICK0) / KICK_EVERY) - Math.round((song - KICK0) / KICK_EVERY)) * KICK_EVERY;
      expect(d, `start ${t}`).toBeLessThan(0.07);
    }
  });

  test('the exported frames follow the plan: the slide changes exactly at the beat, not at the even point', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.selectOption('#tvSizeSel', '720x1280');
    await setVal(page, '#tvAnim', 'none');
    await setVal(page, '#tvText', FOUR);
    await loadKickSong(page);
    await page.selectOption('#tvSync', 'beat');
    const same = await page.evaluate(() => {
      const T = TextVideo.timing(), sc = TextVideo.scene();
      const frame = (t) => { const c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; sc.draw(c.getContext('2d'), t); return c.getContext('2d').getImageData(0, 200, sc.width, 800).data; };
      const eq = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 16) d += Math.abs(a[i] - b[i]); return d < 1000; };
      const k = 2, s = T.starts[k];
      const slide = (i) => { const c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; TextVideo.drawSlide(c.getContext('2d'), sc.width, sc.height, T.sl[i], { ...TextVideo.opts(), progress: false }, 1, true, undefined, undefined, i, T.n); return c.getContext('2d').getImageData(0, 200, sc.width, 800).data; };
      return { before: eq(frame(s - 0.03), slide(1)), after: eq(frame(s + 0.03), slide(2)), s };
    });
    expect(same.before, `slide 2 just before ${same.s}`).toBe(true);
    expect(same.after, `slide 3 just after ${same.s}`).toBe(true);
  });

  test('"Gõ chữ" half-way: the keyword box only covers letters already typed (no empty box ahead of the text)', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => {
      const o = { ...TextVideo.opts(), bgMode: 'color', bgColor: '#000000', hiColor: '#00ff00', anim: 'type', hook: '', handle: '', counter: false };
      const green = (a) => { const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d'); TextVideo.drawSlide(x, 540, 960, 'aaaa bbbb cccc *dddd*', o, a); const d = x.getImageData(0, 0, 540, 960).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 200 && d[i] < 60 && d[i + 2] < 60) n++; return n; };
      return { half: green(0.5), full: green(1) };
    });
    expect(r.half, 'keyword not typed yet → no box').toBe(0);
    expect(r.full).toBeGreaterThan(300);
  });

  test('handle text keeps contrast ≥ 4.5:1 on the light templates (it was drawn at 85 % opacity)', async ({ page }) => {
    await openTab(page, 'textvideo');
    const worst = await page.evaluate(() => {
      const out = [];
      for (const id of ['clean', 'quote']) {
        document.querySelector(`#tvTemplates [data-tpl=${id}]`).click();
        const o = { ...TextVideo.opts(), handle: '@WWWWWWWWWW', hook: '', counter: false };
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
        TextVideo.drawSlide(x, 1080, 1920, '', o);
        const row = x.getImageData(200, Math.round(1920 * 0.74) - 14, 680, 28).data;
        let dark = 255 * 3, bg = 0, dk = null, bk = null;
        for (let i = 0; i < row.length; i += 4) { const s = row[i] + row[i + 1] + row[i + 2]; if (s < dark) { dark = s; dk = [row[i], row[i + 1], row[i + 2]]; } if (s > bg) { bg = s; bk = [row[i], row[i + 1], row[i + 2]]; } }
        const hex = (a) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('');
        out.push(Core.contrast(hex(dk), hex(bk)));
      }
      return Math.min(...out);
    });
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('Text + Audio → Video: code review fixes', () => {
  test('removing / replacing the song while tapping stops the recording and does not keep its taps', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa');
    await loadKickSong(page);
    const got = await recordTaps(page, [0.8]);
    test.skip(got[0] < 0.6, `${browserName}: the audio clock does not run in this headless build`);
    await page.click('#tvAudioInfo button'); // "Bỏ audio"
    // at once — not when the old song finally ends (it kept playing with a disabled "Dừng ghi" button)
    await expect(page.locator('#tvTap')).toBeHidden({ timeout: 1000 });
    expect(await page.evaluate(() => TextVideo.clock()), 'music stopped').toBe(-1);
    await expect(page.locator('#tvTapStart')).toContainText('Nghe');
    expect((await page.evaluate(() => TextVideo.timing().starts)).map((x) => +x.toFixed(2))).toEqual([0, 3, 6]);
  });

  test('upper-case templates keep punctuation outside the keyword box too (TikTok template boxed "SÁCH,")', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.locator('#tvTemplates [data-tpl=tiktok]').evaluate((e) => e.click());
    const lines = await page.evaluate(() => TextVideo.runs('Đọc *sách*, mỗi ngày'));
    expect(lines.flat().filter((r) => r.hi).map((r) => r.t)).toEqual(['SÁCH']);
    expect(lines.map((l) => l.map((r) => r.t).join('')).join(' ')).toBe('ĐỌC SÁCH, MỖI NGÀY');
  });

  test('a 2-line hook never overlaps the slide counter in any frame size', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => [[1080, 1920], [1080, 1350], [1080, 1080], [1920, 1080]].map(([W, H]) => {
      const h = TextVideo.header(W, H, { hook: 'Ba mẹo đọc sách mỗi ngày mà ai cũng nên biết thật sớm', counter: true }, 12);
      return { W, H, lines: h.hook.lines.length, hookEnd: h.hook.top + h.hook.h, counterTop: h.counter.top, top: h.hook.top / H };
    }));
    for (const x of r) {
      expect(x.lines, `${x.W}×${x.H}`).toBe(2);
      expect(x.counterTop, `${x.W}×${x.H}`).toBeGreaterThan(x.hookEnd);
    }
    expect(r[0].top, '9:16 header below TikTok top bar').toBeGreaterThan(0.068);
  });

  test('9:16 at the biggest text size: line boxes and keyword boxes stay out of TikTok\'s right-hand button column', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(async () => {
      const out = {};
      for (const id of ['caption', 'classic']) {
        document.querySelector(`#tvTemplates [data-tpl=${id}]`).click();
        const o = { ...TextVideo.opts(), bgMode: 'color', bgColor: '#000000', hiColor: '#00ff00', maxSize: 240, hook: '', handle: '', counter: false, anim: 'none' };
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
        TextVideo.drawSlide(x, 1080, 1920, 'Mỗi ngày đọc *mười trang* sách *thật đều*', o);
        const R = Core.safeRect('tiktok', 1080, 1920);
        const d = x.getImageData(0, 0, 1080, 1920).data;
        let bad = 0, drawn = 0;
        for (let y = 0; y < 1920; y += 2) for (let xx = 0; xx < 1080; xx += 2) {
          const i = (y * 1080 + xx) * 4;
          if (d[i] + d[i + 1] + d[i + 2] < 90) continue;
          drawn++;
          if (xx > R.x + R.w + 2 || xx < R.x - 2) bad++;
        }
        out[id] = { bad, drawn };
      }
      return out;
    });
    for (const [id, v] of Object.entries(r)) {
      expect(v.drawn, id).toBeGreaterThan(5000);
      expect(v.bad, `${id}: pixels under the button column`).toBe(0);
    }
  });

  test('keyword ink keeps ≥ 4.5:1 on a mid-grey highlight colour (#7a7a7a got #111 ink at 4.3:1)', async ({ page }) => {
    await openTab(page, 'textvideo');
    const ink = await page.evaluate(() => {
      const o = { ...TextVideo.opts(), bgMode: 'color', bgColor: '#ffffff', hiColor: '#7a7a7a', hook: '', handle: '', counter: false, anim: 'none' };
      const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d');
      TextVideo.drawSlide(x, 540, 960, '*WWWW*', o);
      const d = x.getImageData(0, 0, 540, 960).data;
      const n = { black: 0, g111: 0 };
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) n.black++;
        if (d[i] === 17 && d[i + 1] === 17 && d[i + 2] === 17) n.g111++;
      }
      return { ...n, vsBlack: Core.contrast('#7a7a7a', '#000000'), vs111: Core.contrast('#7a7a7a', '#111111') };
    });
    expect(ink.vs111, 'why #111 is not allowed here').toBeLessThan(4.5);
    expect(ink.vsBlack).toBeGreaterThanOrEqual(4.5);
    expect(ink.g111, '#111 ink (a few anti-aliased edge pixels may match by chance)').toBeLessThan(30);
    expect(ink.black, 'pure black ink drawn').toBeGreaterThan(200);
  });

  test('taps land exactly where tapped even when the phone draws slowly (frames 0.3 s apart)', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai');
    await loadKickSong(page);
    await page.evaluate(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 300); });
    const got = await recordTaps(page, [1.45]);
    test.skip(got[0] < 1, `${browserName}: the audio clock does not run in this headless build`);
    await expect(page.locator('#tvTap')).toBeHidden({ timeout: 3000 });
    const s = await page.evaluate(() => TextVideo.timing().starts[1]);
    expect(Math.abs(s - got[0]), `start ${s} tapped ${got[0]}`).toBeLessThan(0.05);
  });

  test('stopping and restarting right after the last tap: the new recording is not cut off by the old auto-stop', async ({ page, browserName }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai');
    await loadKickSong(page);
    const got = await recordTaps(page, [0.8]); // last change → auto-stop in 0.6 s
    test.skip(got[0] < 0.6, `${browserName}: the audio clock does not run in this headless build`);
    await page.click('#tvTapStart'); // stop now
    await page.click('#tvTapStart'); // and record again
    await expect(page.locator('#tvTap')).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.locator('#tvTap'), 'still recording').toBeVisible();
    await page.click('#tvTapStart');
  });

  test('slide list: choosing a row keeps keyboard focus on it; deleting slides keeps a highlighted row', async ({ page }) => {
    await openTab(page, 'textvideo');
    await setVal(page, '#tvText', 'Một\n\nHai\n\nBa\n\nBốn');
    await page.locator('#tvSlides button[data-k="3"]').click();
    expect(await page.evaluate(() => document.activeElement.dataset.k)).toBe('3');
    await setVal(page, '#tvText', 'Một\n\nHai');
    await page.waitForTimeout(100);
    await expect(page.locator('#tvSlides .active')).toHaveAttribute('data-k', '1');
  });
});

/* ---------------- templates & effects (36 templates, 11 effects) ---------------- */
test.describe('Text + Audio → Video: templates & effects', () => {
  test('36 templates, each with its own look: none blank, no two alike, all shown in the picker', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => {
      const ids = TextVideo.templates().map((t) => t.id), sigs = new Map();
      for (const id of ids) {
        const c = document.createElement('canvas'); c.width = 270; c.height = 480; const x = c.getContext('2d');
        TextVideo.drawTemplate(id, x, 270, 480, 'Xin chào *TikTok*', { ...TextVideo.opts(), bgMode: 'tpl', hook: '', handle: '', counter: false, anim: 'none' });
        const d = x.getImageData(0, 0, 270, 480).data; let h = 0; const cols = new Set();
        for (let i = 0; i < d.length; i += 4 * 37) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0; cols.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); }
        sigs.set(id, { h, cols: cols.size });
      }
      const inPicker = [...document.querySelectorAll('#tvTemplates [data-tpl]')].map((b) => b.dataset.tpl);
      return { ids, sigs: [...sigs], inPicker };
    });
    expect(r.ids.length).toBeGreaterThanOrEqual(36);
    expect(new Set(r.ids).size).toBe(r.ids.length);
    for (const [id, s] of r.sigs) expect(s.cols, `${id} draws something`).toBeGreaterThan(3);
    expect(new Set(r.sigs.map(([, s]) => s.h)).size, 'every template looks different').toBe(r.ids.length);
    for (const id of r.ids) expect(r.inPicker, id).toContain(id);
  });

  test('text stays readable on every template background: contrast ≥ 4.5:1 (project rule)', async ({ page }) => {
    await openTab(page, 'textvideo');
    const bad = await page.evaluate(() => {
      const out = [];
      const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      for (const t of TextVideo.templates()) {
        if (t.stroke) continue; // an outline carries the contrast (checked: stroke vs fill below)
        const inks = t.gradText || [t.color];
        // what is right behind the letters: the box / note, else the background where text goes (worst block, several moments)
        let backs = [];
        if (t.box || t.note) backs = [t.box || t.note];
        else for (const time of t.moving ? [0, 1.3, 2.7, 4.1] : [0]) {
          const c = document.createElement('canvas'); c.width = 270; c.height = 480; const x = c.getContext('2d');
          TextVideo.drawTemplate(t.id, x, 270, 480, '', { ...TextVideo.opts(), bgMode: 'tpl', hook: '', handle: '', counter: false }, 1, time);
          for (let by = 150; by < 330; by += 12) for (let bx = 40; bx < 230; bx += 12) {
            const d = x.getImageData(bx, by, 12, 12).data; let r = 0, g = 0, b = 0;
            for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
            const n = d.length / 4; backs.push(hex(r / n, g / n, b / n));
          }
        }
        let worst = 99, at = '';
        for (const ink of inks) for (const bk of backs) { const k = Core.contrast(ink, bk); if (k < worst) { worst = k; at = `${ink} on ${bk}`; } }
        if (worst < 4.5) out.push(`${t.id}: ${worst.toFixed(2)} (${at})`);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('moving backgrounds move, and the same moment always draws the same frame (preview = export)', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => {
      const sig = (id, time) => {
        const c = document.createElement('canvas'); c.width = 216; c.height = 384; const x = c.getContext('2d');
        TextVideo.drawTemplate(id, x, 216, 384, 'Chữ', { ...TextVideo.opts(), bgMode: 'tpl', hook: '', handle: '', counter: false }, 1, time);
        return c.toDataURL();
      };
      return TextVideo.templates().filter((t) => t.moving).map((t) => ({ id: t.id, moves: sig(t.id, 0.2) !== sig(t.id, 2.2), same: sig(t.id, 1.7) === sig(t.id, 1.7) }));
    });
    expect(r.length).toBeGreaterThanOrEqual(6);
    for (const x of r) { expect(x.moves, `${x.id} moves`).toBe(true); expect(x.same, `${x.id} deterministic`).toBe(true); }
  });

  test('every effect: half-way looks different, and the end frame is exactly the finished slide', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => {
      const frame = (anim, a) => {
        const c = document.createElement('canvas'); c.width = 270; c.height = 480; const x = c.getContext('2d');
        TextVideo.drawTemplate('classic', x, 270, 480, 'Mỗi ngày đọc *mười trang* sách thật đều', { ...TextVideo.opts(), bgMode: 'tpl', hook: '', handle: '', counter: false, anim }, a);
        return c.toDataURL();
      };
      const done = frame('none', 1);
      const list = ['pop', 'fade', 'slide', 'type', 'word', 'wordpop', 'karaoke', 'zoom', 'rise', 'glitch'].map((anim) => ({ anim, half: frame(anim, 0.5) !== done, end: frame(anim, 1) === done }));
      // "bật to" is not just "từng từ": the newest word is growing in
      list.push({ anim: 'wordpop ≠ word', half: frame('wordpop', 0.45) !== frame('word', 0.45), end: true }); // 8 words: 3.6 shown → word 4 growing
      return list;
    });
    for (const x of r) { expect(x.half, `${x.anim} animates`).toBe(true); expect(x.end, `${x.anim} ends on the finished slide`).toBe(true); }
    const options = await page.locator('#tvAnim option').evaluateAll((os) => os.map((o) => o.value));
    for (const a of ['wordpop', 'karaoke', 'zoom', 'rise', 'glitch']) expect(options).toContain(a);
  });

  test('karaoke: the words still to come are shown dimmed (not hidden), the sung ones in full', async ({ page }) => {
    await openTab(page, 'textvideo');
    const r = await page.evaluate(() => {
      const count = (a) => {
        const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d');
        TextVideo.drawTemplate('classic', x, 540, 960, 'một hai ba bốn năm sáu bảy tám', { ...TextVideo.opts(), bgMode: 'color', bgColor: '#000000', hook: '', handle: '', counter: false, anim: 'karaoke' }, a);
        const d = x.getImageData(0, 0, 540, 960).data; let full = 0, dim = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] > 235 && d[i + 1] > 235) full++; else if (d[i] > 50 && d[i] < 110 && Math.abs(d[i] - d[i + 2]) < 10) dim++; }
        return { full, dim };
      };
      return { half: count(0.5), end: count(1) };
    });
    expect(r.half.dim, 'upcoming words visible, dimmed').toBeGreaterThan(500);
    expect(r.half.full).toBeGreaterThan(r.end.full * 0.25);
    expect(r.half.full).toBeLessThan(r.end.full * 0.75);
    expect(r.end.dim, 'all sung at the end').toBeLessThan(r.half.dim / 4);
  });

  test('choosing a template also chooses its effect (Karaoke → karaoke; a classic one → "Bật lên")', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.locator('#tvTemplates [data-tpl=karaoke]').evaluate((e) => e.click());
    await expect(page.locator('#tvAnim')).toHaveValue('karaoke');
    await page.locator('#tvTemplates [data-tpl=vhs]').evaluate((e) => e.click());
    await expect(page.locator('#tvAnim')).toHaveValue('glitch');
    await page.locator('#tvTemplates [data-tpl=classic]').evaluate((e) => e.click());
    await expect(page.locator('#tvAnim')).toHaveValue('pop');
  });

  test('a moving-background template exports a valid video whose background really moves', async ({ page }, ti) => {
    await openTab(page, 'textvideo');
    await page.locator('#tvTemplates [data-tpl=flow]').evaluate((e) => e.click());
    await setVal(page, '#tvText', 'Một\n\nHai');
    await setVal(page, '#tvSlideDur', 1.5);
    await setVal(page, '#tvProgress', false); // the time bar alone would make the frames differ
    await page.selectOption('#tvSizeSel', '720x1280');
    const moves = await page.evaluate(() => {
      const sc = TextVideo.scene(), f = (t) => { const c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; sc.draw(c.getContext('2d'), t); return c.toDataURL(); };
      return f(1.0) !== f(1.4); // same slide, fully shown: only the background changed
    });
    expect(moves, 'background animates while the text is still (not one cached frame)').toBe(true);
    test.skip(!hasFfprobe, 'needs ffprobe');
    const c = await codecs(page);
    test.skip(!c.webcodecs, NO_EXPORT);
    const dl = await renderAndDownload(page, 'tv', ti);
    const p = probe(dl.path);
    expect(p.video).toEqual({ codec: 'h264', width: 720, height: 1280 });
    expect(Math.abs(p.duration - 3)).toBeLessThan(0.3);
  });
});
