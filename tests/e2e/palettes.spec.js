// Colour sets: non-designers pick named, harmonious, contrast-checked colours instead of hex codes.
const { test, expect } = require('@playwright/test');
const { openTab } = require('./helpers');

const corner = (page, id) => page.evaluate((id) => {
  const c = document.getElementById(id); return [...c.getContext('2d').getImageData(4, 4, 1, 1).data.slice(0, 3)];
}, id);

test('picking a colour set changes only the colours: the template keeps its layout and label', async ({ page }) => {
  const errors = await openTab(page, 'audiovideo');
  const sets = page.locator('#avPalettes [data-pal]');
  expect(await sets.count()).toBeGreaterThanOrEqual(24);
  await page.click('#avTemplates [data-tpl=sachnoi]');
  await page.click('#avPalettes [data-pal=trang-den]'); // white
  await expect(page.locator('#avColor1')).toHaveValue('#111111');
  await expect(page.locator('#avBgColor')).toHaveValue('#fafafa');
  await expect(page.locator('#avBadge'), 'label kept').toHaveValue('Sách nói');
  await expect(page.locator('#avPalettes [data-pal=trang-den]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Math.min(...(await corner(page, 'avCanvas'))), { message: 'light background drawn' }).toBeGreaterThan(220);
  await page.click('#avPalettes [data-pal=dem-saigon]'); // dark
  await expect.poll(async () => Math.max(...(await corner(page, 'avCanvas')))).toBeLessThan(60);
  // choosing another template brings its own colours and clears the colour-set highlight
  await page.click('#avTemplates [data-tpl=neon]');
  await expect(page.locator('#avPalettes .pal.active')).toHaveCount(0);
  await expect(page.locator('#avColor1')).toHaveValue('#25f4ee');
  expect(errors).toEqual([]);
});

test('mood filter, names, and "Tự chọn mã màu" still available', async ({ page }) => {
  await openTab(page, 'audiovideo');
  const chips = await page.locator('#avPalettes .chips button').allTextContents();
  expect(chips).toEqual(expect.arrayContaining(['Tất cả', 'Tối', 'Sáng & Pastel', 'Rực rỡ', 'Lễ hội']));
  await page.click('#avPalettes .chips button:text-is("Lễ hội")');
  await expect(page.locator('#avPalettes [data-pal=tet]')).toHaveAttribute('aria-label', 'Bộ màu Tết');
  expect(await page.locator('#avPalettes [data-pal]').count()).toBe(4);
  await expect(page.locator('#avColor1')).toBeVisible(); // helpers open "Nâng cao"/"Tự chọn" sections
});

test('a light colour set keeps text readable on a blurred cover photo background', async ({ page }) => {
  await openTab(page, 'audiovideo');
  await page.setInputFiles('#avImg', require('./helpers').fx('photo.jpg'));
  await expect(page.locator('#avBgMode')).toHaveValue('image');
  await page.click('#avPalettes [data-pal=trang-den]');
  await expect(page.locator('#avBgMode'), 'background mode unchanged').toHaveValue('image');
});

test('photo and text tabs: tap a suggested background colour', async ({ page }) => {
  await openTab(page, 'textvideo');
  const sw = page.locator('.swatches[data-for=tvBgColor] .sw');
  expect(await sw.count()).toBeGreaterThanOrEqual(12);
  await expect(page.locator('#tvBgMode')).toHaveValue('tpl');
  await sw.nth(1).click(); // white
  await expect(page.locator('#tvBgMode'), 'switches to a plain colour background').toHaveValue('color');
  await expect(page.locator('#tvBgColor')).toHaveValue('#ffffff');
  await expect.poll(async () => Math.min(...(await corner(page, 'tvCanvas')))).toBeGreaterThan(240);
  await expect(sw.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.click('#tabs button[data-tab=imgvideo]');
  await expect(page.locator('#ivFit')).toHaveValue('blur'); // colour hidden behind the blurred photo…
  await page.locator('.swatches[data-for=ivBg] .sw').nth(1).click();
  await expect(page.locator('#ivBg')).toHaveValue('#ffffff');
  await expect(page.locator('#ivFit'), '…so a swatch switches to a plain colour background').toHaveValue('contain');
  await page.selectOption('#ivFit', 'polaroid');
  await page.locator('.swatches[data-for=ivBg] .sw').nth(0).click();
  await expect(page.locator('#ivFit'), 'Polaroid already shows the colour').toHaveValue('polaroid');
});
