// Beat effects with detailed options: particles (7 shapes, amount, direction, beat reaction, colour), punch
// (strength, target, length), ripple rings, sway, moving background, colour flow.
const { test, expect } = require('@playwright/test');
const { openTab } = require('./helpers');

function beatSong(sec = 5, period = 0.25, sr = 22050) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / sr, d = t % period; b.writeInt16LE(Math.round(22000 * ((d < 0.12 ? Math.sin(2 * Math.PI * 60 * d) * Math.exp(-d * 25) : 0) * 0.85 + 0.2 * Math.sin(2 * Math.PI * 330 * t))), 44 + i * 2); }
  return { name: 'beat.wav', mimeType: 'audio/wav', buffer: b };
}
const ALL_MAX = { avDust: true, avDustShape: 'star', avDustAmount: '160', avDustDir: 'burst', avDustReact: '1.4', avDustColor: 'mix', avPunch: true, avPunchAmt: '0.06', avPunchTarget: 'both', avPunchLen: 'long', avRipple: true, avSway: true, avSwayAmt: '5', avBgMove: true, avColorFlow: true };
const setAll = (page, set) => page.evaluate((set) => { for (const [id, v] of Object.entries(set)) Templates.setControl(id, v); }, set);
async function capture(page) {
  await page.evaluate(() => { window.__sc = null; VideoEngine.render = async (sc) => { window.__sc = sc; throw new DOMException('x', 'AbortError'); }; });
  await page.click('#avRender');
  await expect.poll(() => page.evaluate(() => !!window.__sc)).toBe(true);
}
const sample = (page, t, step = 17) => page.evaluate(([t, step]) => {
  const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
  const x = c.getContext('2d'); sc.draw(x, t); const d = x.getImageData(0, 0, c.width, c.height).data;
  const out = []; for (let i = 0; i < d.length; i += 4 * step) out.push(d[i], d[i + 1], d[i + 2]); return out;
}, [t, step]);
const diff = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 10 ? 1 : 0), 0);

test('phone UI: an effect\'s options show only when it is on; every effect is saved in "Mẫu của tôi"', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, 'audiovideo');
  await page.click('#avTemplates [data-tpl=neon]');
  await expect(page.locator('#avDustShape')).toBeHidden();
  await page.check('#avDust');
  await expect(page.locator('#avDustShape')).toBeVisible();
  await page.uncheck('#avPunch');
  await expect(page.locator('#avPunchAmt')).toBeHidden();
  await setAll(page, ALL_MAX);
  page.once('dialog', (d) => d.accept('Tất cả hiệu ứng'));
  await page.click('#avTemplates [data-role=save-template]');
  await page.click('#avTemplates .chips button >> nth=0');
  await page.click('#avTemplates [data-tpl=neon]');
  await expect(page.locator('#avRipple')).not.toBeChecked();
  await page.click('#avTemplates [data-tpl^="my-"]');
  for (const [id, v] of Object.entries(ALL_MAX)) {
    if (typeof v === 'boolean') await expect(page.locator('#' + id), id).toBeChecked({ checked: v });
    else await expect(page.locator('#' + id), id).toHaveValue(v);
  }
});

test('particles: 7 shapes all look different; "Nhiều" draws more than "Ít"; colour option applies', async ({ page }) => {
  await openTab(page, 'audiovideo');
  const r = await page.evaluate(() => {
    const data = (fx) => AVTest.frame('none', { fx: { dust: true, amount: 90, dir: 'drift', react: 0, color: 'ink', shape: 'dot', ...fx }, W: 360, H: 640 }).canvas.getContext('2d').getImageData(0, 0, 360, 640).data;
    const hash = (d) => { let h = 0; for (let i = 0; i < d.length; i += 4 * 3) h = (h * 31 + d[i] + d[i + 1] * 3) >>> 0; return h; };
    const base = data({ dust: false });
    const changed = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) > 12) n++; return n; };
    const shapes = ['dot', 'snow', 'petal', 'heart', 'star', 'note', 'bubble'].map((s) => hash(data({ shape: s })));
    return { shapes, few: changed(data({ amount: 40 })), many: changed(data({ amount: 160 })), ink: hash(data({ color: 'ink' })), mix: hash(data({ color: 'mix' })) };
  });
  expect(new Set(r.shapes).size, 'distinct shapes').toBe(7);
  expect(r.many, `${r.many} vs ${r.few}`).toBeGreaterThan(r.few * 2);
  expect(r.mix).not.toBe(r.ink);
});

test('punch target: "Tên bài" moves the title, not the cover; "Ảnh bìa" the reverse', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(4, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.click('#avTemplates [data-tpl=neon]');
  await page.fill('#avTitle', 'TÊN BÀI HÁT RẤT DÀI');
  const g = await page.evaluate(() => Core.avGeometry(1080, 1920, 'cover', 'bars'));
  const region = (arr, z) => arr.filter((_, i) => { const p = Math.floor(i / 3) * 17, y = Math.floor(p / 1080); return y >= z[0] && y < z[1]; });
  const at = async (target) => {
    await setAll(page, { avPunch: !!target, avPunchAmt: '0.06', avPunchTarget: target || 'art' });
    await capture(page);
    return sample(page, 2.04);
  };
  const off = await at(null), art = await at('art'), text = await at('text');
  expect(diff(region(art, g.zones.art), region(off, g.zones.art)), 'cover moves with "Ảnh bìa"').toBeGreaterThan(50);
  expect(diff(region(art, g.zones.text), region(off, g.zones.text)), 'title still with "Ảnh bìa"').toBe(0);
  expect(diff(region(text, g.zones.text), region(off, g.zones.text)), 'title moves with "Tên bài"').toBeGreaterThan(20);
  expect(diff(region(text, g.zones.art), region(off, g.zones.art)), 'cover still with "Tên bài"').toBe(0);
});

test('every effect at its strongest, at 4 kicks/s: still no flashes (global and per screen area)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(4, 0.25));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  for (const id of ['sannhay', 'neon', 'paper', 'bekechuyen', 'vinyl', 'chualanh']) {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    await setAll(page, ALL_MAX);
    await capture(page);
    const r = await page.evaluate(() => {
      const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height;
      const x = c.getContext('2d');
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const G = 4, frames = [];
      for (let f = 0; f < 90; f++) {
        sc.draw(x, f / 30);
        const d = x.getImageData(0, 0, c.width, c.height).data, tiles = new Array(G * G + 1).fill(0), cnt = new Array(G * G + 1).fill(0);
        for (let i = 0; i < d.length; i += 4 * 41) {
          const p = i / 4, tx = Math.min(G - 1, Math.floor(((p % c.width) / c.width) * G)), ty = Math.min(G - 1, Math.floor((Math.floor(p / c.width) / c.height) * G));
          const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
          tiles[ty * G + tx] += L; cnt[ty * G + tx]++; tiles[G * G] += L; cnt[G * G]++;
        }
        frames.push(tiles.map((v, k) => v / cnt[k]));
      }
      let globalStep = 0, worstFlashesPerSec = 0;
      for (let k = 0; k <= G * G; k++) {
        let flashes = 0, dir = 0;
        for (let f = 1; f < frames.length; f++) {
          const dl = frames[f][k] - frames[f - 1][k];
          if (k === G * G) globalStep = Math.max(globalStep, Math.abs(dl));
          if (Math.abs(dl) >= 0.1) { if (dir && Math.sign(dl) !== dir) flashes++; dir = Math.sign(dl); }
        }
        worstFlashesPerSec = Math.max(worstFlashesPerSec, flashes / 3);
      }
      return { globalStep, worstFlashesPerSec };
    });
    expect(r.globalStep, `${id}: frame-to-frame brightness change`).toBeLessThan(0.1);
    expect(r.worstFlashesPerSec, `${id}: flashes per second in any 1/16 of the screen`).toBeLessThanOrEqual(3);
  }
});

test('all effects together stay deterministic (preview = export) on a pure style', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(5, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  await page.click('#avTemplates [data-tpl=vinyl]');
  await setAll(page, ALL_MAX);
  await capture(page);
  const direct = await page.evaluate(() => { const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; const x = c.getContext('2d'); sc.draw(x, 3.3); const d = x.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 13) h = (h * 31 + d[i] + 3 * d[i + 1]) >>> 0; return h; });
  const seq = await page.evaluate(() => { const sc = window.__sc, c = document.createElement('canvas'); c.width = sc.width; c.height = sc.height; const x = c.getContext('2d'); for (let f = 0; f < 99; f++) sc.draw(x, f / 30); sc.draw(x, 3.3); const d = x.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 13) h = (h * 31 + d[i] + 3 * d[i + 1]) >>> 0; return h; });
  expect(seq).toBe(direct);
});

test('the moving background and colour flow change slowly (≤ 2 % of pixels per frame from them alone)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(10, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.click('#avTemplates [data-tpl=paper]');
  await setAll(page, { avStyle: 'none', avBgMove: true, avColorFlow: true });
  await page.setInputFiles('#avImg', require('./helpers').fx('photo.jpg'));
  await page.selectOption('#avBgMode', 'image');
  await page.uncheck('#avProgress');
  await capture(page);
  const a = await sample(page, 2.0, 7), b = await sample(page, 2.0 + 1 / 30, 7), c = await sample(page, 9.0, 7);
  const n = a.length / 3;
  expect(diff(a, b) / n, 'one frame apart: barely changes').toBeLessThan(0.02 * 3);
  expect(diff(a, c), 'seconds apart: it does move').toBeGreaterThan(n * 0.05);
});

test('"Nhún" visibly moves something on a kick for EVERY template that turns it on (QC: Sàn nhảy / Đường neon did nothing)', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', beatSong(4, 0.5));
  await expect(page.locator('#avAudioInfo')).toContainText('beat.wav');
  await page.selectOption('#avSize', '720x1280');
  const ids = await page.evaluate(() => [...document.querySelectorAll('#avTemplates [data-tpl]')].map((b) => b.dataset.tpl));
  let checked = 0;
  for (const id of ids) {
    await page.click(`#avTemplates [data-tpl=${id}]`);
    if (!(await page.isChecked('#avPunch'))) continue;
    checked++;
    await setAll(page, { avDust: false, avRipple: false, avSway: false, avBgMove: false, avColorFlow: false });
    await capture(page);
    const on = await sample(page, 2.04);
    await page.uncheck('#avPunch');
    await capture(page);
    const off = await sample(page, 2.04);
    expect(diff(on, off), `${id}: punch changes the frame on a kick`).toBeGreaterThan(100);
  }
  expect(checked, 'templates with punch on').toBeGreaterThanOrEqual(3);
});
