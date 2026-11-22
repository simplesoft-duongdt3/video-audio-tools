/*
 * Colour sets for people who don't pick hex codes: named, harmonious, contrast-checked sets (Core.PALETTES).
 *  - Palettes.mount: a mood filter + a scrolling row of swatches (background, 2 visualizer bars, "Aa" in the
 *    text colour, name) that calls onPick(palette).
 *  - every `.swatches[data-for=inputId]` gets a row of suggested background colours for a single colour input.
 */
const Palettes = (() => {
  function swatchHtml(p) {
    return `<span class="pal-chip" style="background:linear-gradient(160deg,${p.bg[0]},${p.bg[1]})">
      <i style="background:${p.c1}"></i><i style="background:${p.c2}"></i><b style="color:${p.ink}">Aa</b></span>`;
  }

  function mount({ box, onPick }) {
    let mood = 'Tất cả', active = null;
    function render() {
      const moods = ['Tất cả', ...new Set(Core.PALETTES.map((p) => p.mood))];
      box.innerHTML = '';
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const m of moods) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = m;
        b.className = m === mood ? 'active' : '';
        b.setAttribute('aria-pressed', m === mood);
        b.onclick = () => { mood = m; render(); };
        chips.appendChild(b);
      }
      const row = document.createElement('div');
      row.className = 'pal-row';
      for (const p of Core.PALETTES) {
        if (mood !== 'Tất cả' && p.mood !== mood) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pal' + (p.id === active ? ' active' : '');
        b.dataset.pal = p.id;
        b.setAttribute('aria-pressed', p.id === active);
        b.setAttribute('aria-label', 'Bộ màu ' + p.name);
        b.innerHTML = swatchHtml(p) + '<span class="pal-name"></span>';
        b.querySelector('.pal-name').textContent = p.name;
        b.onclick = () => {
          active = p.id;
          row.querySelectorAll('.pal').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
          onPick(p);
        };
        row.appendChild(b);
      }
      box.append(chips, row);
    }
    render();
    return { clear() { active = null; render(); } };
  }

  /** Suggested backgrounds for a single colour input (photo / text tabs). */
  function wireSwatches() {
    const seen = new Set();
    const colours = Core.PALETTES.map((p) => [p.bg[0], p.name]).filter(([c]) => !seen.has(c) && seen.add(c)).slice(0, 18);
    document.querySelectorAll('.swatches[data-for]').forEach((box) => {
      const input = $(box.dataset.for), mode = box.dataset.mode && $(box.dataset.mode);
      // a colour only shows in some modes (photo tab: "Nền màu" / Polaroid): switch to one if needed
      const okModes = (box.dataset.modeOk || '').split(',').filter(Boolean), modeValue = box.dataset.modeValue || 'color';
      const mark = () => box.querySelectorAll('.sw').forEach((b) => { const on = b.dataset.c === input.value.toLowerCase(); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
      input.addEventListener('input', mark);
      for (const [c, name] of [['#000000', 'Đen'], ['#ffffff', 'Trắng'], ...colours]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw';
        b.style.background = c;
        b.dataset.c = c.toLowerCase();
        b.title = name;
        b.setAttribute('aria-label', 'Màu nền ' + name);
        b.onclick = () => {
          if (mode && !okModes.includes(mode.value)) {
            mode.value = modeValue;
            mode.dispatchEvent(new Event('input', { bubbles: true }));
            mode.dispatchEvent(new Event('change', { bubbles: true }));
          }
          input.value = c;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        box.appendChild(b);
      }
      mark();
    });
  }
  wireSwatches();

  return { mount, swatchHtml };
})();
