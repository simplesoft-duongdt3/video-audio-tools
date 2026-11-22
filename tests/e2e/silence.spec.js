// "Bỏ đoạn im lặng": found automatically, removed only when the user says so, undoable, and the exported
// video really is shorter (the cut audio is what gets encoded).
const { test, expect } = require('@playwright/test');
const { fx, probe, hasFfprobe, openTab, renderAndDownload, codecs, NO_AAC, NO_EXPORT } = require('./helpers');

/** voice-like recording: [[seconds, amplitude]] → WAV upload payload */
function wav(parts, sr = 22050) {
  const n = parts.reduce((s, [d]) => s + Math.round(d * sr), 0), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let o = 0;
  for (const [d, a] of parts) { const m = Math.round(d * sr); for (let i = 0; i < m; i++) b.writeInt16LE(Math.round(a * 30000 * Math.sin((2 * Math.PI * 200 * i) / sr)), 44 + (o + i) * 2); o += m; }
  return { name: 'ghi-am.wav', mimeType: 'audio/wav', buffer: b };
}
// 1.2 s silence · 2 s voice · 2 s pause · 2 s voice · 0.4 s breath · 1.5 s voice · 1 s silence  = 10.1 s
const VOICE = wav([[1.2, 0], [2, 0.4], [2, 0], [2, 0.4], [0.4, 0], [1.5, 0.4], [1, 0]]);
// cuts with the default padding: 1.12 (start) + 1.7 (pause) + 0.92 (end) = 3.74 s → 6.36 s left
const AFTER = 10.1 - 3.74;

const durOf = (page) => page.evaluate(() => {
  const el = document.querySelector('#avTrim .trim-times');
  return el.textContent;
});

test('find → choose → cut → export is shorter → undo restores', async ({ page }, ti) => {
  const errors = await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', VOICE);
  await expect(page.locator('#avTrim')).toBeVisible();
  await expect(page.locator('#avAudioInfo')).toContainText('0:10');
  await page.click('#avTrim [data-a=scan]');
  const items = page.locator('#avTrim .sil-list input[type=checkbox]');
  await expect(items).toHaveCount(3); // start, the 2 s pause, end — NOT the 0.4 s breath
  await expect(page.locator('#avTrim .sil-list')).toContainText('Đầu bài');
  await expect(page.locator('#avTrim .sil-list')).toContainText('Cuối bài');
  await expect(page.locator('#avTrim [data-a=cut]')).toContainText('Bỏ 3 đoạn');
  // the waveform shows red bands where it will cut
  const red = await page.evaluate(() => {
    const c = document.querySelector('#avTrim canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4 * 5) if (d[i + 3] > 40 && d[i + 3] < 140 && d[i] > 200 && d[i + 1] < 90) n++; return n; // the translucent red band
  });
  expect(red, 'red bands on the waveform').toBeGreaterThan(50);
  // the user keeps the start silence
  await items.nth(0).uncheck();
  await expect(page.locator('#avTrim [data-a=cut]')).toContainText('Bỏ 2 đoạn');
  // "higher sensitivity" also finds the breath
  await page.selectOption('#avTrim [data-a=sens]', '0.4');
  await expect(items).toHaveCount(4);
  await page.selectOption('#avTrim [data-a=sens]', '0.8');
  await expect(items).toHaveCount(3);
  await page.click('#avTrim [data-a=cut]');
  await expect(page.locator('#avTrim .sil-done')).toContainText('Đã bỏ 3 đoạn');
  await expect(page.locator('#avStart')).toHaveValue('0');
  await expect(page.locator('#avDur')).toHaveValue('');
  const left = await page.evaluate(() => {
    const t = document.querySelector('#avTrim .trim-times').textContent; return +t.match(/→ ([\d.]+)s/)[1];
  });
  expect(Math.abs(left - AFTER), `left ${left}s`).toBeLessThan(0.1);

  const c = await codecs(page);
  if (c.webcodecs && c.aac && hasFfprobe) {
    const dl = await renderAndDownload(page, 'av', ti);
    const p = probe(dl.path);
    expect(Math.abs(p.duration - AFTER), `video ${p.duration}s`).toBeLessThan(0.25);
  }
  await page.click('#avTrim [data-a=undo]');
  await expect(page.locator('#avTrim .sil-done')).toBeHidden();
  await expect(page.locator('#avAudioInfo')).toContainText('0:10');
  expect(errors).toEqual([]);
});

test('"Không bỏ" keeps everything; a song without silences says so; photo tab has it too', async ({ page }) => {
  await openTab(page, 'imgvideo');
  await page.setInputFiles('#ivAudio', VOICE);
  await expect(page.locator('#ivTrim')).toBeVisible();
  await page.click('#ivTrim [data-a=scan]');
  await expect(page.locator('#ivTrim .sil-list input')).toHaveCount(3);
  await page.click('#ivTrim [data-a=close]');
  await expect(page.locator('#ivTrim .sil-res')).toBeHidden();
  await expect(page.locator('#ivAudioInfo')).toContainText('0:10'); // nothing removed
  await page.setInputFiles('#ivAudio', fx('tone.wav'));
  await expect(page.locator('#ivAudioInfo')).toContainText('0:03');
  await page.click('#ivTrim [data-a=scan]');
  await expect(page.locator('#ivTrim .sil-sum')).toContainText('Không thấy');
  await expect(page.locator('#ivTrim [data-a=cut]')).toBeHidden();
});

test('loading a new song resets a previous cut', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avAudio', VOICE);
  await page.click('#avTrim [data-a=scan]');
  await page.click('#avTrim [data-a=cut]');
  await expect(page.locator('#avTrim .sil-done')).toBeVisible();
  await page.setInputFiles('#avAudio', fx('tone.wav'));
  await expect(page.locator('#avTrim .sil-done')).toBeHidden();
  await expect(page.locator('#avTrim [data-a=scan]')).toBeVisible();
});
