# Project rules (video-audio-tools)

Static, browser-only media toolbox for GitHub Pages (no backend, no build). UI copy is Vietnamese; design is
mobile-first (iPhone Safari first, then Android, then desktop).

## Every change
1. **Cache-busting:** after editing `js/` or `assets/`, run `npm run stamp` (a unit test fails otherwise).
2. **User guide (required when a feature or screen changes):** update the Vietnamese steps in
   `scripts/make-help.mjs` (text + screenshots/marks for the changed feature), then run `npm run help` to
   regenerate `Help/huong-dan-iphone.html` (one self-contained file, base64 screenshots). The guide stores a
   fingerprint of the UI; the unit test "PROJECT RULE …" (also in CI) fails if the UI changed and the guide
   was not regenerated. The script also fails if a numbered mark is off-screen.
3. **Tests:** `npm run test:unit` and `npx playwright test` (desktop Chrome, Android Chrome, iPhone WebKit).
   New behaviour gets an e2e test that names the user-visible problem it prevents; check that the test fails
   when the code is broken (mutation check) for important fixes.
4. **README.md** feature table stays in sync with what the app does.

## Conventions
- Pure logic goes in `js/core.js` (UMD, unit-tested in Node); UI in the per-tab scripts.
- Touch targets ≥ 44 px; text contrast ≥ 4.5:1 (colour sets are contrast-tested); 9:16 video content stays
  inside the TikTok safe zone (6 %–78 % of the height).
- Never upload user files anywhere; the privacy page (`#about`) must stay true.
- Don't touch other guides in `Help/` that belong to other work (e.g. `bitwarden-huong-dan.html`).
