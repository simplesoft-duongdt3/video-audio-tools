const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { fx, imageSize, hasFfprobe, openTab, grabDownload } = require('./helpers');

test.describe('convert', () => {
  test('PNG + JPG + EXIF JPG → PNG, zip with all files', async ({ page }, ti) => {
    const errors = await openTab(page, 'convert');
    await page.selectOption('#convFormat', 'image/png');
    await page.setInputFiles('#convFiles', [fx('photo.png'), fx('photo.jpg'), fx('photo-exif.jpg')]);
    await page.click('#convRun');
    await expect(page.locator('#convResults .card')).toHaveCount(3);
    await expect(page.locator('#convZip')).toBeEnabled();
    await expect(page.locator('#convResults')).toContainText('300×400'); // EXIF orientation applied
    const one = await grabDownload(page, () => page.locator('#convResults .card [data-a=dl]').first().click(), ti);
    expect(one.name).toBe('photo.png');
    expect(readFileSync(one.path).subarray(1, 4).toString()).toBe('PNG');
    const zip = await grabDownload(page, () => page.click('#convZip'), ti);
    const names = execFileSync('python3', ['-c', 'import sys,zipfile;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', zip.path]).toString().trim().split('\n');
    expect(names.sort()).toEqual(['photo-1.png', 'photo-exif.png', 'photo.png']);
    await page.click('#convClear');
    await expect(page.locator('#convResults .card')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('compress', () => {
  test('lossless JPG drops metadata, keeps orientation, is smaller', async ({ page }, ti) => {
    await openTab(page, 'compress');
    await page.selectOption('#cmpMode', 'lossless');
    await page.setInputFiles('#cmpFiles', [fx('photo-exif.jpg')]);
    await page.click('#cmpRun');
    await expect(page.locator('#cmpResults .card')).toHaveCount(1);
    await expect(page.locator('#cmpResults')).toContainText('Lossless');
    const dl = await grabDownload(page, () => page.locator('#cmpResults [data-a=dl]').click(), ti);
    const out = readFileSync(dl.path), src = readFileSync(fx('photo-exif.jpg'));
    expect(out.length).toBeLessThan(src.length);
    const s = out.toString('latin1');
    expect(s).not.toContain('secret GPS');
    expect(s).not.toContain('private comment');
    // decoded size in the browser must still be the rotated one
    const size = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { w, h } = await loadImgFromBlob(new Blob([bytes], { type: 'image/jpeg' }));
      return `${w}x${h}`;
    }, out.toString('base64'));
    expect(size).toBe('300x400');
  });

  test('lossless PNG keeps pixels; lossy PNG quantises', async ({ page }) => {
    await openTab(page, 'compress');
    await page.selectOption('#cmpMode', 'lossless');
    await page.setInputFiles('#cmpFiles', [fx('photo.png')]);
    await page.click('#cmpRun');
    await expect(page.locator('#cmpResults .card')).toHaveCount(1);
    await page.selectOption('#cmpMode', 'lossy');
    await page.setInputFiles('#cmpFiles', [fx('photo.png')]);
    await page.click('#cmpRun');
    await expect(page.locator('#cmpResults .card')).toHaveCount(2);
    await expect(page.locator('#cmpResults .card').nth(1)).toContainText(/PNG \d+ màu|không nhỏ hơn/);
    await expect(page.locator('#cmpZip')).toBeEnabled();
  });

  test('max side resizes', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    await openTab(page, 'compress');
    await page.selectOption('#cmpMode', 'lossy');
    await page.fill('#cmpMax', '200');
    await page.setInputFiles('#cmpFiles', [fx('photo.jpg')]);
    await page.click('#cmpRun');
    const dl = await grabDownload(page, () => page.locator('#cmpResults [data-a=dl]').click(), ti);
    expect(imageSize(dl.path)).toEqual({ width: 200, height: 150 });
  });
});

test.describe('editor', () => {
  test('TikTok preset exports exactly 1080×1920', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    const errors = await openTab(page, 'edit');
    await page.setInputFiles('#edFile', fx('photo.png'));
    await expect(page.locator('#edExport')).toBeEnabled();
    await page.click('#edPresets button[data-wh="1080x1920"]');
    await expect(page.locator('#edW')).toHaveValue('1080');
    await page.selectOption('#edFormat', 'image/png');
    const dl = await grabDownload(page, () => page.click('#edExport'), ti);
    expect(dl.name).toBe('photo-1080x1920.png');
    expect(imageSize(dl.path)).toEqual({ width: 1080, height: 1920 });
    expect(errors).toEqual([]);
  });

  test('unlocked custom size and rotate', async ({ page }, ti) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    await openTab(page, 'edit');
    await page.setInputFiles('#edFile', fx('photo.png'));
    await expect(page.locator('#edExport')).toBeEnabled();
    await page.click('[data-act=rotR]');
    await page.uncheck('#edLock');
    await page.fill('#edW', '500');
    await page.fill('#edH', '500');
    await page.selectOption('#edFormat', 'image/jpeg');
    const dl = await grabDownload(page, () => page.click('#edExport'), ti);
    expect(imageSize(dl.path)).toEqual({ width: 500, height: 500 });
  });
});
