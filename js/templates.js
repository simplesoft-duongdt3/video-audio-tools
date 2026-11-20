/*
 * Shared template picker for the video tabs.
 * A template is { id, name, cat, set: { controlId: value }, style: { … tab-specific } }.
 *  - `set` is applied to the visible controls (so the user can still tweak everything afterwards);
 *  - `style` holds what has no control (fonts, gradients, layouts…), interpreted by the tab.
 * "Mẫu của tôi": the user's current settings saved as a template in localStorage (this browser only).
 */
const Templates = (() => {
  const MINE = 'Của tôi';
  const load = (key) => { try { return JSON.parse(localStorage.getItem('vat.tpl.' + key) || '[]'); } catch (_) { return []; } };
  const save = (key, list) => { try { localStorage.setItem('vat.tpl.' + key, JSON.stringify(list)); return true; } catch (_) { return false; } };

  /** Set a control's value and fire the events the tab listens to. */
  function setControl(id, v) {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Read the current values of `ids` → { id: value } */
  function readControls(ids) {
    const o = {};
    for (const id of ids) { const el = $(id); if (el) o[id] = el.type === 'checkbox' ? el.checked : el.value; }
    return o;
  }

  /**
   * box: container element; key: storage key ('tv' | 'av' | 'iv'); builtins: template list;
   * thumb(t, ctx, W, H): draw template `t` at W×H; apply(t): tab applies `style`;
   * controls: ids captured by "Lưu mẫu"; captureStyle(): current `style`; skipControl(id, t): keep the user's value.
   */
  function mount({ box, key, builtins, thumb, apply, controls, captureStyle, skipControl = () => false, activeId }) {
    let active = activeId || (builtins[0] && builtins[0].id);
    let cat = 'Tất cả';
    const all = () => [...builtins, ...load(key)];

    function use(t) {
      active = t.id;
      for (const [id, v] of Object.entries(t.set || {})) if (!skipControl(id, t)) setControl(id, v);
      apply(t);
      render();
    }

    function card(t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = t.id === active ? 'active' : '';
      b.dataset.tpl = t.id;
      b.title = t.name;
      b.setAttribute('aria-pressed', t.id === active);
      const c = makeCanvas(180, 320);
      const ctx = c.getContext('2d');
      ctx.setTransform(1 / 3, 0, 0, 1 / 3, 0, 0); // drawn at 540×960, shown at 180×320
      try { thumb(t, ctx, 540, 960); } catch (e) { console.warn('template thumbnail', t.id, e); }
      b.appendChild(c);
      const s = document.createElement('span');
      s.textContent = t.name;
      b.appendChild(s);
      b.onclick = () => use(t);
      if (t.cat === MINE) {
        const x = document.createElement('i');
        x.className = 'del';
        x.textContent = '×';
        x.title = 'Xoá mẫu này';
        x.setAttribute('role', 'button');
        x.setAttribute('aria-label', 'Xoá mẫu ' + t.name);
        x.onclick = (e) => {
          e.stopPropagation();
          if (!confirm(`Xoá mẫu "${t.name}"?`)) return;
          save(key, load(key).filter((m) => m.id !== t.id));
          if (active === t.id) active = builtins[0].id;
          render();
        };
        b.appendChild(x);
      }
      return b;
    }

    function render() {
      const list = all();
      const cats = ['Tất cả', ...new Set(list.map((t) => t.cat).filter(Boolean))];
      if (!cats.includes(cat)) cat = 'Tất cả';
      box.innerHTML = '';
      if (cats.length > 2) {
        const chips = document.createElement('div');
        chips.className = 'chips';
        for (const c of cats) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = c;
          b.className = c === cat ? 'active' : '';
          b.setAttribute('aria-pressed', c === cat);
          b.onclick = () => { cat = c; render(); };
          chips.appendChild(b);
        }
        box.appendChild(chips);
      }
      const grid = document.createElement('div');
      grid.className = 'templates';
      for (const t of list) if (cat === 'Tất cả' || t.cat === cat) grid.appendChild(card(t));
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add';
      add.dataset.role = 'save-template';
      add.innerHTML = '<b>＋</b><span>Lưu cài đặt hiện tại thành mẫu</span>';
      add.onclick = () => {
        const mine = load(key);
        const name = (prompt('Tên mẫu:', `Mẫu của tôi ${mine.length + 1}`) || '').trim();
        if (!name) return;
        const base = all().find((t) => t.id === active) || builtins[0];
        const t = { id: 'my-' + Date.now().toString(36), name: name.slice(0, 40), cat: MINE, set: readControls(controls), style: { ...base.style, ...captureStyle() } };
        if (!save(key, [...mine, t])) return toast('Không lưu được (trình duyệt chặn bộ nhớ trang)');
        active = t.id;
        cat = MINE;
        render();
        toast('Đã lưu mẫu "' + t.name + '" trên trình duyệt này');
      };
      grid.appendChild(add);
      box.appendChild(grid);
    }

    render();
    return { refresh: render, get active() { return all().find((t) => t.id === active); }, use: (id) => { const t = all().find((x) => x.id === id); if (t) use(t); } };
  }

  /** A built-in sample photo (sky, sun, hills, sea) so photo templates can be previewed before choosing photos. */
  let sample = null;
  function samplePhoto() {
    if (sample) return sample;
    const W = 600, H = 800;
    const c = makeCanvas(W, H);
    const x = c.getContext('2d');
    let g = x.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, '#5aa9e6'); g.addColorStop(1, '#ffd6a5');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff3b0'; x.beginPath(); x.arc(W * 0.68, H * 0.36, 70, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6a994e';
    x.beginPath(); x.moveTo(0, H * 0.6); x.quadraticCurveTo(W * 0.25, H * 0.42, W * 0.55, H * 0.58); x.quadraticCurveTo(W * 0.8, H * 0.48, W, H * 0.56); x.lineTo(W, H); x.lineTo(0, H); x.fill();
    g = x.createLinearGradient(0, H * 0.66, 0, H);
    g.addColorStop(0, '#2a9d8f'); g.addColorStop(1, '#264653');
    x.fillStyle = g; x.fillRect(0, H * 0.66, W, H * 0.34);
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 9; i++) x.fillRect(W * 0.1 + i * 55, H * 0.7 + (i % 3) * 30, 40, 3);
    sample = { img: c, w: W, h: H, url: 'sample' };
    return sample;
  }

  return { mount, setControl, readControls, samplePhoto, MINE };
})();
