/*
 * Waveform trimmer: pick the part of the song with two drag handles instead of typing seconds.
 * Kept in sync both ways with the tab's "start" / "duration" number inputs (they stay, for precision).
 * Touch: 44 px handle hit areas, tap the wave to move the selection there. Keyboard: arrows on the handles.
 */
const AudioTrim = (() => {
  const round1 = (v) => Math.round(v * 10) / 10;

  /**
   * onAudio(buffer): called when the user removes silences (new, shorter buffer) or undoes it (the original),
   * so the tab exports exactly what the user chose.
   */
  function mount({ box, startId, durId, onAudio = () => {} }) {
    const startEl = $(startId), durEl = $(durId);
    box.classList.add('trim');
    box.innerHTML = `
      <div class="trim-head"><b>Chọn đoạn nhạc</b><span class="trim-times" aria-live="polite"></span></div>
      <div class="trim-wave">
        <canvas aria-hidden="true"></canvas>
        <div class="trim-sel"></div>
        <div class="trim-h" data-h="start" role="slider" tabindex="0" aria-label="Điểm bắt đầu đoạn nhạc"></div>
        <div class="trim-h" data-h="end" role="slider" tabindex="0" aria-label="Điểm kết thúc đoạn nhạc"></div>
        <div class="trim-play" hidden></div>
      </div>
      <div class="row tight trim-actions">
        <button type="button" data-a="play">▶ Nghe đoạn này</button>
        <button type="button" data-a="all">Cả bài</button>
      </div>
      <p class="hint">Kéo 2 tay cầm để chọn đoạn, hoặc chạm vào sóng nhạc để dời đoạn tới đó.</p>
      <div class="sil">
        <button type="button" data-a="scan">✂️ Tìm đoạn im lặng thừa</button>
        <div class="sil-res" hidden>
          <p class="sil-sum" aria-live="polite"></p>
          <label class="sil-sens">Độ nhạy
            <select data-a="sens">
              <option value="1.5">Chỉ khoảng lặng dài (≥ 1,5 giây)</option>
              <option value="0.8" selected>Vừa (≥ 0,8 giây)</option>
              <option value="0.4">Cả khoảng lặng ngắn (≥ 0,4 giây)</option>
            </select>
          </label>
          <ul class="sil-list"></ul>
          <div class="row tight"><button type="button" class="primary" data-a="cut"></button><button type="button" data-a="close">Không bỏ</button></div>
          <p class="hint">Giữ lại một nhịp ngắn quanh lời nói để nghe vẫn tự nhiên. Có thể hoàn tác.</p>
        </div>
        <div class="sil-done" hidden><span></span><button type="button" data-a="undo">↩︎ Hoàn tác</button></div>
      </div>`;
    const wave = box.querySelector('.trim-wave'), cv = box.querySelector('canvas');
    const selEl = box.querySelector('.trim-sel'), playEl = box.querySelector('.trim-play');
    const times = box.querySelector('.trim-times');
    const hs = { start: box.querySelector('[data-h=start]'), end: box.querySelector('[data-h=end]') };
    const playBtn = box.querySelector('[data-a=play]');
    let audio = null, channels = null, pk = null, pkN = 0, src = null, raf = 0;
    let original = null; // the decoded song as chosen; `audio` may be it with silences removed
    let found = []; // silences found in `original` (shown while choosing)
    const sil = {
      scan: box.querySelector('[data-a=scan]'), res: box.querySelector('.sil-res'), sum: box.querySelector('.sil-sum'),
      sens: box.querySelector('[data-a=sens]'), list: box.querySelector('.sil-list'), cut: box.querySelector('[data-a=cut]'),
      done: box.querySelector('.sil-done'),
    };

    /** Current selection from the inputs. */
    function sel() {
      const d = audio.duration;
      const s = Math.min(Math.max(0, +startEl.value || 0), Math.max(0, d - 0.5));
      const len = Core.clipDuration({ start: s, dur: durEl.value, audioDur: d });
      return { s, e: Math.min(d, s + len), d };
    }

    function draw() {
      if (!audio || box.hidden) return;
      const w = wave.clientWidth, h = wave.clientHeight;
      if (!w) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const n = Math.max(20, Math.floor(w / 3));
      if (!pk || pkN !== n) { pk = Core.peaks(channels, n); pkN = n; }
      const { s, e, d } = sel();
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // silences being chosen: red bands where the cut will be
      if (!sil.res.hidden) {
        ctx.fillStyle = 'rgba(254,44,85,0.28)';
        for (const c of chosenCuts()) ctx.fillRect((c.from / d) * w, 0, Math.max(1, ((c.to - c.from) / d) * w), h);
      }
      const step = w / n, bw = Math.max(1, step * 0.6);
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * d;
        const bh = Math.max(2, pk[i] * (h - 10));
        ctx.fillStyle = t >= s && t <= e ? '#25f4ee' : 'rgba(255,255,255,0.28)';
        ctx.fillRect(i * step + (step - bw) / 2, (h - bh) / 2, bw, bh);
      }
      const xs = (s / d) * w, xe = (e / d) * w;
      selEl.style.left = xs + 'px';
      selEl.style.width = Math.max(0, xe - xs) + 'px';
      hs.start.style.left = xs + 'px';
      hs.end.style.left = xe + 'px';
      for (const [k, v] of [['start', s], ['end', e]]) {
        hs[k].setAttribute('aria-valuemin', 0);
        hs[k].setAttribute('aria-valuemax', round1(d));
        hs[k].setAttribute('aria-valuenow', round1(v));
        hs[k].setAttribute('aria-valuetext', formatTime(v));
      }
      const ft = (v) => (d < 60 ? v.toFixed(1) + 's' : formatTime(v)); // short clips need tenths
      times.textContent = `${ft(s)} → ${ft(e)} · dài ${round1(e - s)}s`;
    }

    /** Write a new selection to the inputs (the tab listens to them: preview, estimate). */
    function apply(ns, ne) {
      const d = audio.duration;
      const keepToEnd = durEl.value === '' && ne >= d - 0.05;
      startEl.value = round1(ns);
      durEl.value = keepToEnd ? '' : round1(ne - round1(ns));
      for (const el of [startEl, durEl]) el.dispatchEvent(new Event('input', { bubbles: true }));
      draw();
    }

    // ---- pointer: drag a handle, slide the window, or tap to move it there ----
    let drag = null;
    const timeAt = (clientX) => {
      const r = wave.getBoundingClientRect();
      return (Math.min(r.width, Math.max(0, clientX - r.left)) / r.width) * audio.duration;
    };
    wave.addEventListener('pointerdown', (ev) => {
      if (!audio) return;
      const { s, e, d } = sel();
      const r = wave.getBoundingClientRect();
      const x = ev.clientX - r.left, xs = (s / d) * r.width, xe = (e / d) * r.width;
      const t = timeAt(ev.clientX);
      const near = (a) => Math.abs(x - a) <= 22;
      if (near(xs) && (!near(xe) || Math.abs(x - xs) <= Math.abs(x - xe))) drag = { mode: 'start' };
      else if (near(xe)) drag = { mode: 'end' };
      else if (t > s && t < e) drag = { mode: 'move', grab: t - s };
      else {
        drag = { mode: 'move', grab: 0 };
        const n = Core.trimDrag({ s, e, d, mode: 'move', t, grab: 0 });
        apply(n.s, n.e);
      }
      wave.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    wave.addEventListener('pointermove', (ev) => {
      if (!drag || !audio) return;
      const { s, e, d } = sel();
      const n = Core.trimDrag({ s, e, d, mode: drag.mode, t: timeAt(ev.clientX), grab: drag.grab });
      apply(n.s, n.e);
    });
    const end = () => { drag = null; };
    wave.addEventListener('pointerup', end);
    wave.addEventListener('pointercancel', end);

    // ---- keyboard on the handles ----
    for (const k of ['start', 'end']) {
      hs[k].addEventListener('keydown', (ev) => {
        if (!audio) return;
        const { s, e, d } = sel();
        const v = k === 'start' ? s : e;
        const stepS = ev.shiftKey ? 1 : 0.1;
        const map = { ArrowLeft: v - stepS, ArrowDown: v - stepS, ArrowRight: v + stepS, ArrowUp: v + stepS, Home: 0, End: d };
        if (!(ev.key in map)) return;
        ev.preventDefault();
        const n = Core.trimDrag({ s, e, d, mode: k, t: map[ev.key] });
        apply(n.s, n.e);
      });
    }

    // ---- listen to the chosen part ----
    function stop() {
      if (src) { try { src.stop(); } catch (_) {} src = null; }
      cancelAnimationFrame(raf);
      playEl.hidden = true;
      playBtn.textContent = '▶ Nghe đoạn này';
    }
    playBtn.onclick = async () => {
      if (src) return stop();
      if (!audio) return;
      const actx = audioCtx();
      const { s, e, d } = sel();
      src = actx.createBufferSource();
      src.buffer = audio;
      src.connect(actx.destination);
      const t0 = actx.currentTime + 0.03;
      src.start(t0, s, e - s);
      src.onended = stop;
      playBtn.textContent = '■ Dừng nghe';
      playEl.hidden = false;
      await actx.resume();
      const tick = () => {
        const t = Math.min(e, s + Math.max(0, actx.currentTime - t0));
        playEl.style.left = (t / d) * wave.clientWidth + 'px';
        if (src) raf = requestAnimationFrame(tick);
      };
      tick();
    };
    box.querySelector('[data-a=all]').onclick = () => { if (!audio) return; stop(); durEl.value = ''; apply(0, audio.duration); };

    // ---- silences: find → user chooses → cut (or not) → undo ----
    const KIND = { lead: 'Đầu bài', gap: 'Khoảng lặng', tail: 'Cuối bài' };
    const sec = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',') + ' giây';
    const chosenCuts = () => Core.silenceCuts(found.filter((_, i) => { const cb = sil.list.querySelector(`[data-i="${i}"]`); return cb && cb.checked; }));
    function updateCut() {
      const cuts = chosenCuts();
      const total = cuts.reduce((t, c) => t + c.to - c.from, 0);
      sil.cut.textContent = cuts.length ? `Bỏ ${cuts.length} đoạn đã chọn (−${sec(total)})` : 'Chọn ít nhất 1 đoạn';
      sil.cut.disabled = !cuts.length;
      draw();
    }
    function scan() {
      if (!original) return;
      const chs = Array.from({ length: original.numberOfChannels }, (_, i) => original.getChannelData(i));
      found = Core.findSilences(chs, original.sampleRate, { minGap: +sil.sens.value });
      sil.list.innerHTML = '';
      found.forEach((g, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<label class="check"><input type="checkbox" checked><span></span></label>';
        const cb = li.querySelector('input');
        cb.dataset.i = i;
        cb.onchange = updateCut;
        li.querySelector('span').textContent = `${KIND[g.kind]} · ${g.kind === 'gap' ? 'lúc ' + formatTime(g.start) + ' · ' : ''}${sec(g.end - g.start)}`;
        sil.list.appendChild(li);
      });
      const total = found.reduce((t, g) => t + g.end - g.start, 0);
      sil.sum.textContent = found.length ? `Tìm thấy ${found.length} đoạn im lặng (tổng ${sec(total)}). Bỏ chọn đoạn nào bạn muốn giữ:` : '✓ Không thấy đoạn im lặng nào đáng bỏ ở độ nhạy này.';
      sil.cut.parentElement.hidden = !found.length;
      sil.res.hidden = false;
      sil.scan.hidden = true;
      updateCut();
    }
    function setCurrent(buf, keepToEnd) {
      stop();
      audio = buf;
      channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      pk = null;
      // the timeline changed: start again from the beginning, whole (shortened) song
      startEl.value = 0;
      if (keepToEnd) durEl.value = '';
      for (const el of [startEl, durEl]) el.dispatchEvent(new Event('input', { bubbles: true }));
      onAudio(buf);
      draw();
    }
    sil.scan.onclick = () => {
      sil.scan.textContent = 'Đang tìm…';
      setTimeout(() => { scan(); sil.scan.textContent = '✂️ Tìm đoạn im lặng thừa'; }, 30); // let the label paint first
    };
    sil.sens.onchange = scan;
    box.querySelector('[data-a=close]').onclick = () => { sil.res.hidden = true; sil.scan.hidden = false; found = []; draw(); };
    sil.cut.onclick = () => {
      const cuts = chosenCuts();
      if (!cuts.length) return;
      const chs = Array.from({ length: original.numberOfChannels }, (_, i) => original.getChannelData(i));
      const out = Core.removeRanges(chs, original.sampleRate, cuts);
      const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: original.sampleRate });
      out.forEach((c, i) => buf.copyToChannel(c, i));
      const removed = original.duration - buf.duration;
      sil.res.hidden = true;
      sil.done.hidden = false;
      sil.done.querySelector('span').textContent = `✂️ Đã bỏ ${cuts.length} đoạn im lặng (−${sec(removed)}) · còn ${formatTime(buf.duration)}`;
      found = [];
      setCurrent(buf, true);
      toast(`Đã bỏ ${sec(removed)} im lặng`);
    };
    box.querySelector('[data-a=undo]').onclick = () => {
      sil.done.hidden = true;
      sil.scan.hidden = false;
      setCurrent(original, true);
      toast('Đã khôi phục bài gốc');
    };

    [startEl, durEl].forEach((el) => el.addEventListener('input', () => { if (!drag) draw(); }));
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(wave);
    window.addEventListener('tabshown', () => requestAnimationFrame(draw));

    return {
      /** Show the trimmer for a decoded song (null hides it). */
      setAudio(buf) {
        stop();
        audio = buf;
        original = buf;
        found = [];
        sil.res.hidden = true;
        sil.done.hidden = true;
        sil.scan.hidden = false;
        channels = buf ? Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)) : null;
        pk = null;
        box.hidden = !buf;
        requestAnimationFrame(draw);
      },
      stop,
      redraw: draw,
    };
  }

  return { mount };
})();
