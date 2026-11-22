/*
 * Waveform trimmer: pick the part of the song with two drag handles instead of typing seconds.
 * Kept in sync both ways with the tab's "start" / "duration" number inputs (they stay, for precision).
 * Touch: 44 px handle hit areas, tap the wave to move the selection there. Keyboard: arrows on the handles.
 */
const AudioTrim = (() => {
  const round1 = (v) => Math.round(v * 10) / 10;

  function mount({ box, startId, durId }) {
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
      <p class="hint">Kéo 2 tay cầm để chọn đoạn, hoặc chạm vào sóng nhạc để dời đoạn tới đó.</p>`;
    const wave = box.querySelector('.trim-wave'), cv = box.querySelector('canvas');
    const selEl = box.querySelector('.trim-sel'), playEl = box.querySelector('.trim-play');
    const times = box.querySelector('.trim-times');
    const hs = { start: box.querySelector('[data-h=start]'), end: box.querySelector('[data-h=end]') };
    const playBtn = box.querySelector('[data-a=play]');
    let audio = null, channels = null, pk = null, pkN = 0, src = null, raf = 0;

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

    [startEl, durEl].forEach((el) => el.addEventListener('input', () => { if (!drag) draw(); }));
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(wave);
    window.addEventListener('tabshown', () => requestAnimationFrame(draw));

    return {
      /** Show the trimmer for a decoded song (null hides it). */
      setAudio(buf) {
        stop();
        audio = buf;
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
