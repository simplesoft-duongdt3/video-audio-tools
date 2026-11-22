// Genre templates for Audio → Video (audiobook, podcast, healing, stories, learning, faith…).
const { test, expect } = require('@playwright/test');
const { fx, openTab, renderAndDownload, probe, hasFfprobe, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

const GENRES = ['Sách & Thơ', 'Podcast & Radio', 'Chữa lành & Thư giãn', 'Học tập', 'Kể chuyện', 'Tâm linh', 'Âm nhạc'];

/** RGB of the preview canvas at fractional (x, y). */
const px = (page, fx_, fy) => page.evaluate(([a, b]) => {
  const c = document.getElementById('avCanvas');
  return [...c.getContext('2d').getImageData(Math.floor(a * c.width), Math.floor(b * c.height), 1, 1).data.slice(0, 3)];
}, [fx_, fy]);

test('every genre has its own category chip and its templates', async ({ page }) => {
  await openTab(page, 'audiovideo');
  const chips = await page.locator('#avTemplates .chips button').allTextContents();
  for (const g of GENRES) expect(chips, g).toContain(g);
  await page.click(`#avTemplates .chips button:text-is("Sách & Thơ")`);
  const ids = await page.locator('#avTemplates [data-tpl]').evaluateAll((els) => els.map((e) => e.dataset.tpl));
  expect(ids).toEqual(['sachnoi', 'tuduy', 'doctho']);
});

test('genre fonts (Lora, Noto Serif, Dancing Script, Baloo 2) are really loaded, Vietnamese included', async ({ page }) => {
  await openTab(page, 'audiovideo');
  for (const id of ['sachnoi', 'truyenma', 'doctho', 'bekechuyen']) await page.click(`#avTemplates [data-tpl=${id}]`);
  await expect.poll(() => page.evaluate(() => ['600 40px "Lora"', '800 40px "Noto Serif"', '700 40px "Dancing Script"', '800 40px "Baloo 2"']
    .every((f) => document.fonts.check(f, 'Đắc Nhân Tâm ỔẶỸ'))), { timeout: 15000 }).toBe(true);
});

test('top label: template fills it, user can edit or clear it, it is drawn at the top', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.click('#avTemplates [data-tpl=tuduy]'); // dark solid background → easy pixel check
  await expect(page.locator('#avBadge')).toHaveValue('Bài học từ sách');
  const g = await page.evaluate(() => Core.avGeometry(1080, 1920, 'minimal', 'overview', { badge: true }));
  const y = g.badgeY / 1920;
  const withBadge = await px(page, 0.5, y);
  await page.fill('#avBadge', '');
  await expect.poll(() => px(page, 0.5, y)).not.toEqual(withBadge);
  const bg = await px(page, 0.5, y);
  expect(Math.max(...bg), 'no badge: plain dark background there').toBeLessThan(40);
  await page.click('#avTemplates [data-tpl=neon]');
  await expect(page.locator('#avBadge'), 'music templates have no label').toHaveValue('');
  await page.fill('#avBadge', 'Tập 5'); // typed by the user → kept when switching templates
  await page.click('#avTemplates [data-tpl=sachnoi]');
  await expect(page.locator('#avBadge')).toHaveValue('Tập 5');
});

test('suggested subtitle is a placeholder, never burned into the video', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.click('#avTemplates [data-tpl=sachnoi]');
  await expect(page.locator('#avSub')).toHaveAttribute('placeholder', /Chương 1 · Tên tác giả/);
  await expect(page.locator('#avSub')).toHaveValue('');
  // what is exported has no subtitle
  await page.evaluate(() => { window.__real = VideoEngine.render; VideoEngine.render = async (sc) => { window.__sc = sc; throw new DOMException('x', 'AbortError'); }; });
  await page.setInputFiles('#avAudio', fx('tone.wav'));
  await expect(page.locator('#avAudioInfo')).toContainText('0:03');
  await page.click('#avRender');
  await expect.poll(() => page.evaluate(() => !!window.__sc)).toBe(true);
  // render the scene twice: with the real subtitle field empty vs filled → only the filled one differs
  const diff = await page.evaluate(async () => {
    const draw = () => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; window.__sc.draw(c.getContext('2d'), 0.5); return c.getContext('2d').getImageData(0, 0, 1080, 1920).data; };
    const a = draw();
    document.getElementById('avSub').value = 'Chương 1 · Tên tác giả';
    window.__sc = null;
    document.getElementById('avRender').click();
    await new Promise((r) => { const iv = setInterval(() => { if (window.__sc) { clearInterval(iv); r(); } }, 20); });
    const b = draw();
    let n = 0; for (let i = 0; i < a.length; i += 4 * 97) if (a[i] !== b[i]) n++;
    return n;
  });
  expect(diff, 'typing the subtitle changes the video; leaving it empty draws nothing').toBeGreaterThan(20);
});

test('book cover shape: a 2:3 book, not a disc', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.click('#avTemplates [data-tpl=sachnoi]');
  const g = await page.evaluate(() => Core.avGeometry(1080, 1920, 'cover', 'overview', { badge: true }));
  // inside the art square but outside the book (left 17 %): background, not cover colour
  const side = await px(page, (g.ax + g.A * 0.06) / 1080, (g.ay + g.A * 0.5) / 1920);
  const centre = await px(page, (g.ax + g.A * 0.3) / 1080, (g.ay + g.A * 0.2) / 1920);
  expect(Math.max(...side), `beside the book ${side}`).toBeLessThan(90);
  expect(centre[0], `on the book ${centre}`).toBeGreaterThan(150);
});

test('every genre template exports a valid video (sample of 4 with new features)', async ({ page }, ti) => {
  test.skip(!hasFfprobe, 'ffprobe not installed');
  await openTab(page, 'audiovideo');
  const c = await codecs(page);
  test.skip(!c.webcodecs, NO_EXPORT);
  test.skip(!c.aac, NO_AAC);
  await page.setInputFiles('#avAudio', fx('tone.wav'));
  await expect(page.locator('#avAudioInfo')).toContainText('0:03');
  await page.selectOption('#avSize', '720x1280');
  for (const id of ['sachnoi', 'radiodem', 'truyenma', 'doctho']) {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    const dl = await renderAndDownload(page, 'av', ti);
    const p = probe(dl.path);
    expect([id, p.video.codec, p.video.width, p.audio.codec]).toEqual([id, 'h264', 720, 'aac']);
  }
});

test('dark-text templates switch to light text on a (dark, blurred) cover photo background', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.fill('#avTitle', 'TIÊU ĐỀ RẤT DÀI ĐỂ ĐO MÀU CHỮ');
  await page.setInputFiles('#avImg', fx('photo.jpg'));
  await expect(page.locator('#avBgMode')).toHaveValue('image');
  for (const id of ['chualanh', 'doctho', 'podsang', 'bekechuyen']) {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    await expect(page.locator('#avBgMode'), id).toHaveValue('image');
    const brightest = await page.evaluate(() => {
      const c = document.getElementById('avCanvas'), x = c.getContext('2d');
      const tpl = document.querySelector('#avTemplates [data-tpl][aria-pressed=true]').dataset.tpl;
      const layout = { chualanh: 'minimal', doctho: 'minimal', podsang: 'top', bekechuyen: 'cover' }[tpl];
      const g = Core.avGeometry(c.width, c.height, layout, document.getElementById('avStyle').value, { badge: !!document.getElementById('avBadge').value, titleScale: tpl === 'doctho' ? 1.3 : 1 });
      const d = x.getImageData(0, Math.round(g.zones.text[0]), c.width, Math.round(g.zones.text[1] - g.zones.text[0])).data;
      let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.min(d[i], d[i + 1], d[i + 2])); return m;
    });
    expect(brightest, `${id}: white title on the darkened photo`).toBeGreaterThan(235);
  }
});

test('a "Mẫu của tôi" saved before labels existed clears the previous label', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vat.tpl.av', JSON.stringify([{ id: 'my-old', name: 'Mẫu cũ', cat: 'Mẫu của tôi', set: { avStyle: 'bars', avColor1: '#ffffff', avColor2: '#ff0000' }, style: {} }]));
  });
  await openTab(page, 'audiovideo');
  await page.click('#avTemplates [data-tpl=sachnoi]');
  await expect(page.locator('#avBadge')).toHaveValue('Sách nói');
  await page.click('#avTemplates [data-tpl=my-old]');
  await expect(page.locator('#avBadge')).toHaveValue('');
});

test('"calm" genres really move less frame to frame (wave and bars), measured on rendered frames', async ({ page }) => {
  // speech-like audio: syllable envelope × two tones
  const sr = 22050, n = sr * 4, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr, env = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) ** 2;
    b.writeInt16LE(Math.round(20000 * env * (Math.sin(2 * Math.PI * 170 * t) * 0.6 + Math.sin(2 * Math.PI * 520 * t) * 0.4)), 44 + i * 2);
  }
  // the SAME look twice, only `motion` differs (fair comparison): saved as "Mẫu của tôi"
  await page.addInitScript(() => {
    const set = (st) => ({ avStyle: st, avColor1: '#c084fc', avColor2: '#f9a8d4', avBgMode: 'gradient', avBadge: '' });
    const look = { stops: ['#2e1065', '#831843'], angle: 120, layout: 'minimal' };
    localStorage.setItem('vat.tpl.av', JSON.stringify([
      { id: 'my-bars', name: 'b', cat: 'Mẫu của tôi', set: set('mirror'), style: look },
      { id: 'my-bars-calm', name: 'bc', cat: 'Mẫu của tôi', set: set('mirror'), style: { ...look, motion: 'calm' } },
      { id: 'my-wave', name: 'w', cat: 'Mẫu của tôi', set: set('wave'), style: look },
      { id: 'my-wave-calm', name: 'wc', cat: 'Mẫu của tôi', set: set('wave'), style: { ...look, motion: 'calm' } },
    ]));
  });
  await openTab(page, 'audiovideo');
  await page.uncheck('#avProgress'); // only the visualizer moves
  await page.setInputFiles('#avAudio', { name: 'noi.wav', mimeType: 'audio/wav', buffer: b });
  await expect(page.locator('#avAudioInfo')).toContainText('noi.wav'); // (WebKit decodes it as 3.99 s → "0:03")
  await page.selectOption('#avSize', '720x1280');
  await page.evaluate(() => { VideoEngine.render = async (sc) => { window.__sc = sc; throw new DOMException('x', 'AbortError'); }; });
  const motion = async (id) => {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    await page.evaluate(() => { window.__sc = null; });
    await page.click('#avRender');
    await expect.poll(() => page.evaluate(() => !!window.__sc)).toBe(true);
    return page.evaluate(() => {
      const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
      const x = c.getContext('2d');
      let prev = null, sum = 0, k = 0;
      for (let f = 30; f < 90; f++) {
        sc.draw(x, f / 30);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        if (prev) { let s = 0; for (let i = 0; i < d.length; i += 4 * 7) s += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]); sum += s; k++; }
        prev = d.slice();
      }
      return sum / k;
    });
  };
  const waveNormal = await motion('my-wave'), waveCalm = await motion('my-wave-calm');
  expect(waveCalm, `wave: calm ${waveCalm.toFixed(0)} vs normal ${waveNormal.toFixed(0)}`).toBeLessThan(waveNormal * 0.6);
  const barsNormal = await motion('my-bars'), barsCalm = await motion('my-bars-calm');
  expect(barsCalm, `bars: calm ${barsCalm.toFixed(0)} vs normal ${barsNormal.toFixed(0)}`).toBeLessThan(barsNormal * 0.6);
});
