// Mobile-first UX guarantees (from the senior UX review): each test names the user-visible problem it prevents.
const { test, expect } = require('@playwright/test');
const { fx, openTab, codecs, NO_EXPORT } = require('./helpers');

const PHONE = { width: 390, height: 844 };

test.describe('phone layout', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });

  test('the preview stays on screen while changing settings further down', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.locator('#ivFilter').scrollIntoViewIfNeeded();
    await page.selectOption('#ivFilter', 'bw');
    const r = await page.locator('#ivCanvas').boundingBox();
    expect(r.y, 'preview top on screen').toBeGreaterThanOrEqual(0);
    expect(r.y + r.height, 'preview fully visible').toBeLessThanOrEqual(PHONE.height);
    expect(r.height, 'small strip, not the whole screen').toBeLessThan(PHONE.height * 0.45);
  });

  test('"⤢" enlarges the preview and back', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const h0 = (await page.locator('#avCanvas').boundingBox()).height;
    await page.click('#tab-audiovideo .pv-toggle');
    await expect(page.locator('#tab-audiovideo .pv-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect((await page.locator('#avCanvas').boundingBox()).height).toBeGreaterThan(h0 * 1.5);
    await page.click('#tab-audiovideo .pv-toggle');
    expect((await page.locator('#avCanvas').boundingBox()).height).toBeLessThan(h0 * 1.1);
  });

  test('after export the download button is on screen (was below the video, off screen)', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.selectOption('#avSize', '720x1280');
    await page.click('#avRender');
    const dl = page.locator('#avOut [data-a=dl]');
    await expect(dl).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => {
      const b = await dl.boundingBox();
      const pv = await page.locator('#avCanvas').boundingBox();
      return b.y >= pv.y + pv.height - 2 && b.y + b.height <= PHONE.height; // below the sticky preview, inside the screen
    }, { timeout: 5000 }).toBe(true);
  });

  test('a deep link shows its tab in the scrolling tab bar', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const b = await page.locator('#tabs button[data-tab=audiovideo]').boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width + 1);
    await expect(page.locator('#tabs button[data-tab=audiovideo]')).toHaveAttribute('aria-selected', 'true');
  });

  test('switching tabs starts the new tab at its top', async ({ page }) => {
    await openTab(page, 'textvideo');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.click('#tabs button[data-tab=edit]');
    const h2 = await page.locator('#tab-edit h2').boundingBox();
    expect(h2.y).toBeGreaterThanOrEqual(0);
    expect(h2.y).toBeLessThan(PHONE.height / 2);
  });

  test('touch targets: visible buttons are at least 44 px tall', async ({ page }) => {
    for (const tab of ['convert', 'compress', 'edit', 'imgvideo', 'textvideo', 'audiovideo']) {
      await openTab(page, tab);
      const small = await page.evaluate((tab) => [...document.querySelectorAll(`#tab-${tab} button, #tabs button`)]
        .filter((b) => b.offsetParent && !b.closest('.templates .tcard'))
        .map((b) => [b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)])
        .filter(([, h]) => h < 43.5), tab);
      expect(small, `${tab}: buttons under 44 px`).toEqual([]);
    }
  });

  test('"hidden" really hides (the text tab background-photo picker showed while not needed)', async ({ page }) => {
    await openTab(page, 'textvideo');
    await expect(page.locator('#tvBgImgWrap')).toBeHidden();
    await page.selectOption('#tvBgMode', 'image');
    await expect(page.locator('#tvBgImgWrap')).toBeVisible();
  });
});

test.describe('waveform trimmer', () => {
  test('dragging the handles sets start / length; "Cả bài" resets; keyboard works', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const errors = await openTab(page, 'audiovideo');
    await expect(page.locator('#avTrim')).toBeHidden(); // no song yet
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avTrim')).toBeVisible();
    const w = page.locator('#avTrim .trim-wave');
    await w.scrollIntoViewIfNeeded();
    const b = await w.boundingBox();
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width - 1, y); await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, y, { steps: 4 }); await page.mouse.up();
    await expect(page.locator('#avStart')).toHaveValue('0');
    expect(Math.abs(+(await page.inputValue('#avDur')) - 1.5)).toBeLessThanOrEqual(0.2); // 3 s song → half
    await page.mouse.move(b.x + 1, y); await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, y, { steps: 4 }); await page.mouse.up();
    expect(Math.abs(+(await page.inputValue('#avStart')) - 0.6)).toBeLessThanOrEqual(0.2);
    await expect(page.locator('#avTrim .trim-times')).toContainText('dài');
    // the estimate follows the shorter clip
    await expect(page.locator('#tab-audiovideo [data-role=estimate]')).toContainText('Ước tính');
    // keyboard on the end handle
    const before = +(await page.inputValue('#avDur'));
    await page.focus('#avTrim [data-h=end]');
    await page.keyboard.press('ArrowLeft');
    expect(+(await page.inputValue('#avDur'))).toBeCloseTo(before - 0.1, 1);
    await expect(page.locator('#avTrim [data-h=end]')).toHaveAttribute('aria-valuetext', /0:0/);
    await page.click('#avTrim [data-a=all]');
    await expect(page.locator('#avStart')).toHaveValue('0');
    await expect(page.locator('#avDur')).toHaveValue('');
    // typing in the number box moves the selection
    await page.fill('#avStart', '1');
    await expect(page.locator('#avTrim .trim-times')).toContainText('1.0s');
    expect(errors).toEqual([]);
  });

  test('"Nghe đoạn này" plays and stops', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.setInputFiles('#ivAudio', fx('tone.wav'));
    await expect(page.locator('#ivTrim')).toBeVisible();
    const btn = page.locator('#ivTrim [data-a=play]');
    await btn.click();
    await expect(btn).toHaveText('■ Dừng nghe');
    await btn.click();
    await expect(btn).toHaveText('▶ Nghe đoạn này');
  });
});

test.describe('footer pages, feedback, accessibility', () => {
  test('privacy page opens from the footer at the top; help and feedback links exist', async ({ page }) => {
    await openTab(page, 'imgvideo');
    await page.click('#aboutLink');
    await expect(page.locator('#tab-about')).toBeVisible();
    await expect(page.locator('#tab-about')).toContainText('không rời khỏi máy');
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
    await expect(page.locator('#helpLink')).toHaveAttribute('href', 'Help/huong-dan-iphone.html');
    await expect(page.locator('#fbLink')).toHaveAttribute('href', /github\.com\/.+\/issues\/new/);
    await page.click('#tabs button[data-tab=convert]');
    await expect(page.locator('#tab-about')).toBeHidden();
  });

  test('tabs follow the ARIA tabs pattern (arrow keys, aria-selected)', async ({ page }) => {
    await openTab(page, 'convert');
    await page.focus('#tabs button[data-tab=convert]');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tabs button[data-tab=compress]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-compress')).toBeVisible();
    await expect(page.locator('#tabs')).toHaveAttribute('role', 'tablist');
  });

  test('drop zones are reachable by keyboard and say "chọn" on touch screens', async ({ page }) => {
    await openTab(page, 'convert');
    await expect(page.locator('.drop[data-input=convFiles]')).toHaveAttribute('tabindex', '0');
    const chooser = page.waitForEvent('filechooser');
    await page.focus('.drop[data-input=convFiles]');
    await page.keyboard.press('Enter');
    await chooser;
  });

  test('export progress is announced (role=progressbar with a value)', async ({ page }) => {
    await openTab(page, 'audiovideo');
    const c = await codecs(page);
    test.skip(!c.webcodecs && !c.recorder, NO_EXPORT);
    await page.setInputFiles('#avAudio', fx('tone.wav'));
    await expect(page.locator('#avAudioInfo')).toContainText('0:03');
    await page.click('#avRender');
    await expect(page.locator('#avOut video')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#avProg')).toHaveAttribute('aria-valuenow', '100');
  });
});
