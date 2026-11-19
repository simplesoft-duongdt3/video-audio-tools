const { execFileSync, spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');

/*
 * CDN responses are cached on disk between runs: tests stay fast and don't flake on network hiccups.
 * The site itself still loads the real CDN URLs (pinned versions), so this only removes latency.
 */
const CDN_CACHE = join(__dirname, '..', '.cdn-cache');
const CDN_RE = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
async function useCdnCache(page) {
  mkdirSync(CDN_CACHE, { recursive: true });
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => '');
  await page.route(CDN_RE, async (route) => {
    const url = route.request().url();
    // Google Fonts CSS depends on the browser: key it by user agent too
    const key = createHash('sha1').update(url + (url.includes('googleapis') ? ua : '')).digest('hex');
    const body = join(CDN_CACHE, key), meta = body + '.json';
    if (existsSync(meta)) {
      const m = JSON.parse(readFileSync(meta, 'utf8'));
      return route.fulfill({ status: 200, body: readFileSync(body), headers: { 'content-type': m.type, 'access-control-allow-origin': '*' } });
    }
    const res = await route.fetch();
    const buf = await res.body();
    if (res.ok()) {
      writeFileSync(body, buf);
      writeFileSync(meta, JSON.stringify({ url, type: res.headers()['content-type'] || 'application/octet-stream' }));
    }
    return route.fulfill({ response: res, body: buf });
  });
}
const { expect } = require('@playwright/test');

const FIX = join(__dirname, '..', 'fixtures');
const fx = (name) => join(FIX, name);

const hasFfprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** ffprobe a file → { duration, video: {codec,width,height}|null, audio: {codec,channels,sampleRate}|null } */
function probe(file) {
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
  const v = out.streams.find((s) => s.codec_type === 'video');
  const a = out.streams.find((s) => s.codec_type === 'audio');
  return {
    format: out.format.format_name,
    duration: +out.format.duration,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: +a.sample_rate } : null,
  };
}

/** Peak and mean level of the audio track in dBFS (ffmpeg volumedetect). */
function audioLevel(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const num = (k) => { const m = r.stderr.match(new RegExp(k + ': (-?[0-9.]+|-inf) dB')); return m ? (m[1] === '-inf' ? -Infinity : +m[1]) : -Infinity; };
  return { max: num('max_volume'), mean: num('mean_volume') };
}

/** Mean level (dBFS) of [start, start+dur) seconds of the audio track. */
function segmentLevel(file, start, dur) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/mean_volume: (-?[0-9.]+|-inf) dB/);
  return m ? (m[1] === '-inf' ? -Infinity : +m[1]) : -Infinity;
}

/** Image size via ffprobe. */
function imageSize(file) {
  const p = probe(file);
  return { width: p.video.width, height: p.video.height };
}

/** Open the app on a tab, failing the test on any uncaught page error or console error. */
async function openTab(page, tab) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // fonts / CDN hiccups are not app errors
    if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  await useCdnCache(page);
  await page.goto('index.html' + (tab ? '#' + tab : ''));
  await page.waitForFunction(() => typeof Core !== 'undefined' && typeof VideoEngine !== 'undefined' && typeof SelfTest !== 'undefined' && window.JSZip);
  if (tab) await expect(page.locator('#tab-' + tab)).toHaveClass(/active/);
  return errors;
}

/** Save the download triggered by `action` and return its path + suggested name. */
async function grabDownload(page, action, testInfo) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 110_000 }), action()]);
  const path = testInfo.outputPath(dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
}

/** Click "render", wait for the output video, download it. */
async function renderAndDownload(page, prefix, testInfo) {
  await page.click(`#${prefix}Render`);
  const out = page.locator(`#${prefix}Out video`);
  await expect(out).toBeVisible({ timeout: 110_000 });
  return grabDownload(page, () => page.click(`#${prefix}Out [data-a=dl]`), testInfo);
}

/**
 * Codecs of the browser under test. Playwright's Linux WebKit has no AAC/H.264 at all
 * (real iPhone Safari has both), so tests that need them are skipped there, with that reason.
 */
async function codecs(page) {
  return page.evaluate(async () => ({
    ...(await VideoEngine.capabilities()), // its `aac` (encoder kind) is replaced below by "can decode AAC"
    aac: !!document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    h264: !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
    recorder: !!window.MediaRecorder,
  }));
}
const NO_AAC = 'this browser build has no AAC decoder (Playwright Linux WebKit); real iPhone Safari has one';
const NO_EXPORT = 'this browser build cannot encode video (no H.264 / MediaRecorder)';

module.exports = { segmentLevel, audioLevel, codecs, NO_AAC, NO_EXPORT, fx, probe, imageSize, hasFfprobe, openTab, grabDownload, renderAndDownload };
