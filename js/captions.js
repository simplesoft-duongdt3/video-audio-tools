/*
 * Burned-in captions (phụ đề) for the audio-based video tabs. Shared by "Audio → Video" and "Ảnh + Audio".
 * Input: an .srt / .vtt file, or pasted lines timed by holding a button while each line is said
 * (or spread evenly over the clip). No speech-to-text: nothing leaves the device.
 * Times are kept in the ORIGINAL song's timeline, so moving the clip start or removing silences keeps every
 * caption on its words. Drawing is one pure function of the clip time: preview = export.
 */
const Captions = (() => {
  const SIZES = { s: 0.05, m: 0.062, l: 0.076 };
  const INK = '#ffffff', HI = '#ffe14d', OUTLINE = '#000000'; // ≥ 4.5:1 on the outline (unit-tested)

  /** Font size and wrapped lines of one cue (long text shrinks first, then is cut to 3 lines). */
  function layoutCue(ctx, text, W, H, size, scale = 1) {
    const r = Core.captionRect(W, H);
    const fs0 = Math.round(Math.min(W, H) * (SIZES[size] || SIZES.m) * scale);
    const pad = Math.round(fs0 * 0.35), maxW = r.w - pad * 2;
    let fs = fs0, lines;
    for (;;) {
      ctx.font = `800 ${fs}px "Be Vietnam Pro", sans-serif`;
      lines = Core.wrap(ctx, text, maxW, true).filter(Boolean);
      if (lines.length <= 3 || fs <= fs0 * 0.6) break;
      fs = Math.round(fs * 0.9);
    }
    if (lines.length > 3) lines = Core.clampLines(ctx, text, maxW, 3);
    return { fs, lines, lh: Math.round(fs * 1.28), pad, r };
  }

  /**
   * Layout of every cue, and ONE band for all of them (as tall as the tallest cue), placed once per video:
   * captions no longer jump between the bottom and the top from one line to the next. `avoid` = layers of rows
   * ([[y0, y1], …] per layer, most protected first) — or a plain list of rows.
   */
  function prepare(cues, W, H, style = {}) {
    const ctx = makeCanvas(1, 1).getContext('2d');
    const av = style.avoid || [];
    const layers = av.length && Array.isArray(av[0]) && Array.isArray(av[0][0]) ? av : [av];
    const at = (scale) => {
      const lay = cues.map((c) => layoutCue(ctx, c.text, W, H, style.size, scale));
      const first = lay[0] || layoutCue(ctx, 'A', W, H, style.size, scale);
      const bandH = Math.max(...lay.map((L) => L.lh * L.lines.length), first.lh);
      const r = first.r, pad = first.pad;
      return { lay, bandH, rect: { x: r.x, y: r.y + pad, w: r.w, h: r.h - 2 * pad }, gap: pad * 0.5 };
    };
    // most protected layer first; inside a layer, a slightly smaller font before giving up that layer
    // (9:16 cover: 3 lines at full size only fit over the art — at 85 % they fit over the visualizer)
    const tries = [1, 0.85, 0.72].map(at);
    for (const avoid of layers) {
      for (const T of tries) {
        const top = Core.captionSpot(T.rect, T.bandH, avoid, T.gap);
        if (top !== null) return { lay: T.lay, top, bandH: T.bandH };
      }
    }
    const T = tries[0];
    return { lay: T.lay, top: T.rect.y + T.rect.h - T.bandH, bandH: T.bandH };
  }

  /**
   * Draw the caption showing at song time `songT`. cues: sorted, in the current song timeline.
   * style: { size: 's'|'m'|'l', highlight: bool, box: bool, avoid: rows or layers of rows of the video's own content }.
   * `prep` (from prepare) makes it cheap per frame and keeps the position fixed for the whole video.
   */
  function draw(ctx, cues, songT, W, H, style = {}, prep = null) {
    const i = Core.cueAt(cues, songT);
    if (i < 0) return;
    const P = prep || prepare([cues[i]], W, H, style);
    const L = prep ? P.lay[i] : P.lay[0];
    const c = cues[i], { fs, lines, lh, pad, r } = L;
    ctx.save();
    ctx.font = `800 ${fs}px "Be Vietnam Pro", sans-serif`;
    const top = P.top + P.bandH - lh * lines.length; // bottom-aligned in the band
    const on = style.highlight ? Core.activeWord(lines.join(' '), c.start, c.end, songT) : -1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fs * 0.17);
    ctx.strokeStyle = OUTLINE;
    let k = 0; // word index across lines
    lines.forEach((line, li) => {
      const words = line.split(' ');
      const lw = ctx.measureText(line).width;
      // centred on the video when it fits in the safe box (the box is not centred: the right-hand buttons)
      const x0 = Math.min(Math.max(W / 2 - lw / 2, r.x + pad), r.x + r.w - pad - lw);
      const y = top + lh * li + lh / 2;
      if (style.box) {
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        const bx = x0 - pad * 0.7, bw = lw + pad * 1.4, bh = lh * 0.96;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx, y - bh / 2, bw, bh, bh * 0.22) : ctx.rect(bx, y - bh / 2, bw, bh);
        ctx.fill();
      }
      ctx.strokeText(line, x0, y);
      let x = x0;
      for (const w of words) {
        ctx.fillStyle = k === on ? HI : INK;
        ctx.fillText(w, x, y);
        x += ctx.measureText(w + ' ').width;
        k++;
      }
    });
    ctx.restore();
  }

  // rounded to tenths BEFORE splitting minutes: 59.96 s read "0:60.0"
  const fmt = (t) => { const x = Math.round(t * 10) / 10, m = Math.floor(x / 60), s = x - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

  /**
   * box: an empty <div>; id: element id prefix (e.g. 'av' → avCapText, avCapFile…);
   * getClip() → { audio, start, duration } of the tab; trim: the tab's AudioTrim (cue marks on its waveform);
   * onChange(): redraw the preview.
   */
  function mount({ box, id, getClip, trim, onChange = () => {} }) {
    box.classList.add('caps');
    box.innerHTML = `
      <label class="drop small" data-input="${id}CapFile">
        <input type="file" id="${id}CapFile" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" data-kind="subtitle" hidden>
        <span>📄 Nhập file phụ đề .srt / .vtt</span>
      </label>
      <label>Hoặc dán lời / kịch bản — mỗi dòng là một câu phụ đề
        <textarea id="${id}CapText" rows="4" placeholder="Câu thứ nhất&#10;Câu thứ hai…"></textarea>
      </label>
      <div class="row tight cap-actions">
        <button type="button" id="${id}CapTap">👆 Bắt nhịp theo nhạc</button>
        <button type="button" id="${id}CapSpread">Chia đều theo đoạn nhạc</button>
      </div>
      <div class="cap-tap" id="${id}CapTapBox" hidden>
        <p class="cap-now" aria-live="polite"></p>
        <button type="button" class="primary cap-hold" id="${id}CapHold">Giữ khi đang nói câu này</button>
        <div class="row tight"><button type="button" id="${id}CapStop">■ Dừng bắt nhịp</button></div>
        <p class="hint">Nhạc phát từ đầu đoạn đã chọn. <b>Nhấn giữ</b> nút khi câu bắt đầu, <b>thả</b> khi câu hết — rồi giữ tiếp cho câu sau. Bàn phím: giữ phím cách.</p>
      </div>
      <p class="hint cap-status" id="${id}CapStatus" aria-live="polite"></p>
      <ol class="cap-list" id="${id}CapList" hidden></ol>
      <div class="row tight">
        <label>Cỡ chữ <select id="${id}CapSize"><option value="s">Nhỏ</option><option value="m" selected>Vừa</option><option value="l">Lớn</option></select></label>
        <label>Lệch giờ (giây) <input type="number" id="${id}CapShift" value="0" step="0.1" inputmode="decimal"></label>
      </div>
      <label class="check"><input type="checkbox" id="${id}CapHi" checked> Tô vàng từng chữ đang nói</label>
      <label class="check"><input type="checkbox" id="${id}CapBox"> Nền tối sau chữ (dễ đọc trên ảnh sáng)</label>
      <div class="row tight">
        <button type="button" id="${id}CapSrt">⬇︎ Tải file .srt</button>
        <button type="button" id="${id}CapClear">Xoá phụ đề</button>
      </div>
      <p class="hint">Phụ đề luôn nằm trong vùng an toàn của TikTok, Reels và Shorts (không bị nút bấm che).</p>`;
    const el = (s) => $(id + s);
    const text = el('CapText'), status = el('CapStatus'), list = el('CapList');
    let times = null; // null = spread evenly; else [{start, end} | null] per line, ORIGINAL song timeline
    let cuts = null; // silences removed from the song (original timeline)

    const lines = () => Core.captionLines(text.value);
    const style = () => ({ size: el('CapSize').value, highlight: el('CapHi').checked, box: el('CapBox').checked });

    /** Per pasted line: its cue in the current song timeline (after removed silences and the sync shift) or null. */
    function perLine(clip = getClip()) {
      const ls = lines();
      if (!times) return clip.duration > 0 ? Core.spreadCues(ls, clip.start, clip.start + clip.duration) : ls.map(() => null);
      const shift = +el('CapShift').value || 0;
      return ls.map((t, i) => (times[i] && Core.shiftCues(Core.remapCues([{ ...times[i], text: t }], cuts), shift)[0]) || null);
    }
    /** Cues to draw, sorted by start. */
    const cues = (clip) => perLine(clip).filter(Boolean).sort((a, b) => a.start - b.start);

    function refresh() {
      const ls = lines(), pl = perLine(), n = pl.filter(Boolean).length;
      if (!ls.length) status.textContent = 'Chưa có phụ đề.';
      else if (!times) status.textContent = `${ls.length} câu, chia đều theo độ dài đoạn nhạc. Bấm “Bắt nhịp” để khớp đúng lời.`;
      else status.textContent = `${n} câu có giờ${n < ls.length ? ` · ⚠️ ${ls.length - n} câu chưa có giờ (không hiện) — bấm “Bắt nhịp” lại` : ''}.`;
      list.hidden = !ls.length;
      list.innerHTML = '';
      ls.slice(0, 200).forEach((t, i) => {
        const li = document.createElement('li'), c = pl[i];
        li.textContent = `${c ? fmt(c.start) + '–' + fmt(c.end) : '— chưa có giờ'} · ${t}`;
        if (!c) li.className = 'off';
        list.appendChild(li);
      });
      if (trim && trim.setMarks) trim.setMarks(pl.filter(Boolean));
    }
    const changed = () => { refresh(); onChange(); };

    onFiles(id + 'CapFile', async ([f]) => {
      let cs;
      try { cs = Core.parseSubtitles(await f.text()); } catch (e) { return toast(`Không đọc được “${f.name}”: ${e.message}`); }
      if (!cs.length) return toast(`“${f.name}” không có câu phụ đề nào đọc được (cần file .srt hoặc .vtt)`);
      text.value = cs.map((c) => c.text).join('\n');
      const clip = getClip();
      // the .srt this app downloads counts from the clip start: put it back on the song (it landed early before)
      const rel = Core.srtLooksClipRelative(cs, clip.start, clip.duration);
      const at = rel ? Core.shiftCues(cs, clip.start) : cs;
      // a file made for the shortened song: back to the original timeline
      times = at.map((c) => ({ start: Core.unmapTime(c.start, cuts), end: Core.unmapTime(c.end, cuts) }));
      if (clip.audio && cs[0].start > clip.audio.duration) toast('⚠️ Giờ trong file phụ đề vượt quá độ dài bài — kiểm tra lại file');
      else toast(`Đã nhập ${cs.length} câu phụ đề${rel ? ` (giờ trong file tính từ đầu đoạn đã chọn, ${fmt(clip.start)})` : ''}`);
      changed();
    });
    // typing in a long script: one refresh per pause, not per key (60k lines took 1.3 s per key)
    let tm = 0;
    text.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(changed, 200); });
    el('CapSpread').onclick = () => { times = null; changed(); };
    el('CapClear').onclick = () => { text.value = ''; times = null; stopTap(); changed(); };
    for (const k of ['CapSize', 'CapShift', 'CapHi', 'CapBox']) el(k).addEventListener('input', changed);
    el('CapSrt').onclick = () => {
      const clip = getClip();
      // times of the exported video: 0 = the clip start, captions outside the clip are left out
      const cs = Core.shiftCues(cues(clip), -clip.start).filter((c) => c.start < clip.duration).map((c) => ({ ...c, end: Math.min(c.end, clip.duration) }));
      if (!cs.length) return toast('Chưa có phụ đề nào trong đoạn nhạc đã chọn');
      download(new Blob([Core.toSRT(cs)], { type: 'application/x-subrip' }), 'phu-de.srt');
    };

    /* ---- "Bắt nhịp": hold the button while each line is being said ---- */
    let tap = null; // { src, t0, start, i, down }
    const tapBox = el('CapTapBox'), hold = el('CapHold'), now = tapBox.querySelector('.cap-now');
    function showNow() {
      const ls = lines();
      if (!tap) return;
      now.textContent = tap.i < ls.length ? `Câu ${tap.i + 1}/${ls.length}: ${ls[tap.i]}` : '✓ Đã bắt nhịp hết các câu';
      hold.disabled = tap.i >= ls.length;
    }
    function stopTap() {
      if (!tap) return;
      if (tap.down != null) up(); // released by stopping: keep that line
      if (tap.i === 0 && tap.before !== undefined) times = tap.before; // stopped before any line: keep the old timings
      try { tap.src.stop(); } catch (_) {}
      tap = null;
      tapBox.hidden = true;
      el('CapTap').textContent = '👆 Bắt nhịp theo nhạc';
      changed();
    }
    // what the user HEARS now: Bluetooth / AirPods play 150–250 ms after currentTime
    const songNow = () => { const actx = audioCtx(); return tap.start + Math.max(0, actx.currentTime - (actx.outputLatency || 0) - tap.t0); };
    function down() {
      if (!tap || tap.down != null || tap.i >= lines().length) return;
      tap.down = songNow();
      hold.classList.add('on');
    }
    function up() {
      if (!tap || tap.down == null) return;
      const s = tap.down, e = Math.max(songNow(), s + 0.3);
      tap.down = null;
      hold.classList.remove('on');
      times[tap.i] = { start: Core.unmapTime(s, cuts), end: Core.unmapTime(e, cuts) };
      tap.i++;
      showNow();
      refresh();
    }
    el('CapTap').onclick = async () => {
      if (tap) return stopTap();
      const clip = getClip(), ls = lines();
      if (!clip.audio) return toast('Hãy chọn file audio trước');
      if (!ls.length) return toast('Dán lời vào ô phía trên trước, mỗi dòng một câu');
      const actx = audioCtx();
      actx.resume(); // inside the tap (iOS)
      if (trim) trim.stop();
      const src = actx.createBufferSource();
      src.buffer = clip.audio;
      src.connect(actx.destination);
      const t0 = actx.currentTime + 0.05;
      src.start(t0, clip.start, clip.duration);
      src.onended = () => { if (tap && tap.src === src) stopTap(); };
      const before = times;
      times = new Array(ls.length).fill(null);
      tap = { src, t0, start: clip.start, i: 0, down: null, before };
      tapBox.hidden = false;
      el('CapTap').textContent = '■ Dừng bắt nhịp';
      showNow();
      refresh();
      hold.focus();
    };
    el('CapStop').onclick = stopTap;
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); hold.setPointerCapture && hold.setPointerCapture(e.pointerId); down(); });
    hold.addEventListener('pointerup', up);
    hold.addEventListener('pointercancel', up);
    hold.addEventListener('contextmenu', (e) => e.preventDefault()); // long press on phones
    hold.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(); } });
    hold.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); } });
    hold.addEventListener('click', (e) => e.preventDefault());

    refresh();
    return {
      /** (ctx, clipT, W, H) drawer for a scene, or null when there is nothing to draw. Cues are frozen per scene. avoid: see draw(). */
      painter(clip, avoid = []) {
        const cs = cues(clip), st = { ...style(), avoid };
        if (!cs.length) return null;
        let P = null; // layouts + the fixed band, made once per frame size
        const fn = (ctx, t, W, H) => {
          if (!P || P.W !== W || P.H !== H) P = { ...prepare(cs, W, H, st), W, H };
          draw(ctx, cs, clip.start + t, W, H, st, P);
        };
        fn.band = () => P && [P.top, P.top + P.bandH]; // where captions go (tests / self-test)
        return fn;
      },
      /** A clip time where a caption shows (for the still preview), or null. */
      previewTime(clip) {
        const cs = cues(clip).filter((c) => c.end > clip.start && c.start < clip.start + clip.duration);
        if (!cs.length) return null;
        const c = cs[0];
        return Math.max(0, Math.min(clip.duration - 0.05, (Math.max(c.start, clip.start) + Math.min(c.end, clip.start + clip.duration)) / 2 - clip.start));
      },
      /** The song changed: silences removed (cuts, original timeline) or restored (null). */
      setCuts(c) { cuts = c && c.length ? c : null; refresh(); },
      /** A new song was chosen (timings are kept: the file may have been imported first). */
      reset() { stopTap(); cuts = null; refresh(); },
      stop: stopTap,
      refresh,
    };
  }

  return { mount, draw, prepare, SIZES, INK, HI, OUTLINE };
})();
