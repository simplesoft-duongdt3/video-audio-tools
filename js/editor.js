/* Crop / rotate / flip / aspect ratio / resize using Cropper.js */
(() => {
  let cropper = null;
  let srcName = 'image';
  let srcUrl = null;
  // Output size chosen by the user (preset or typed). null = same as the crop box.
  let target = null;
  fillFormatSelect($('edFormat'), 'image/jpeg');

  onFiles('edFile', async ([f]) => {
    try {
      let { img, w, h, url } = await readImage(f);
      // Phones cap canvas area (~16.7 MP on iOS): Cropper builds a full-size canvas, so downscale first.
      const s = safeScale(w, h);
      if (s < 1) {
        const c = makeCanvas(w * s, h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        url = URL.createObjectURL(await canvasToBlob(c, 'image/png'));
        c.width = c.height = 0;
        toast(`Ảnh lớn (${w}×${h}) đã được thu nhỏ để chỉnh trên thiết bị này`);
      }
      srcName = baseName(f.name);
      if (srcUrl) URL.revokeObjectURL(srcUrl);
      srcUrl = url;
      const el = $('edImg');
      if (cropper) cropper.destroy();
      el.src = url;
      await new Promise((r) => (el.complete ? r() : (el.onload = r)));
      target = null;
      cropper = new Cropper(el, {
        viewMode: 1,
        autoCropArea: 1,
        responsive: true,
        background: false,
        crop: updateInfo,
      });
      const active = document.querySelector('#edRatios .active');
      cropper.setAspectRatio(active ? parseFloat(active.dataset.r) : NaN);
      $('edExport').disabled = false;
      $('edEmpty').hidden = true;
      document.querySelector('.drop[data-input="edFile"] span').textContent = `🔄 Đổi ảnh · ${f.name}`;
    } catch (e) {
      toast(e.message);
    }
  });

  function updateInfo() {
    if (!cropper) return;
    const d = cropper.getData(true);
    $('edCropInfo').textContent = `${d.width}×${d.height}`;
    // Mirror the crop size into the fields only while the user hasn't chosen an output size.
    if (!target) {
      $('edW').value = d.width;
      $('edH').value = d.height;
    }
  }

  function setTarget(w, h) {
    target = { w, h };
    $('edW').value = w;
    $('edH').value = h;
  }

  $('edRatios').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('edRatios').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    target = null;
    if (cropper) { cropper.setAspectRatio(parseFloat(b.dataset.r)); updateInfo(); }
  };

  document.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (!cropper) return;
      const d = cropper.getData();
      // Cropper applies rotate() before scaleX(), so after a 90° turn the image's X axis is vertical on screen.
      const sideways = Math.abs((d.rotate || 0) % 180) === 90;
      switch (b.dataset.act) {
        case 'rotL': cropper.rotate(-90); break;
        case 'rotR': cropper.rotate(90); break;
        case 'flipH': sideways ? cropper.scaleY(-(d.scaleY || 1)) : cropper.scaleX(-(d.scaleX || 1)); break;
        case 'flipV': sideways ? cropper.scaleX(-(d.scaleX || 1)) : cropper.scaleY(-(d.scaleY || 1)); break;
        case 'reset': cropper.reset(); target = null; updateInfo(); break;
      }
    };
  });

  const cropRatio = () => {
    const d = cropper.getData();
    return d.width / d.height;
  };
  $('edW').oninput = () => {
    if (!cropper) return;
    const w = +$('edW').value || 1;
    setTarget(w, $('edLock').checked ? Math.round(w / cropRatio()) : +$('edH').value || 1);
  };
  $('edH').oninput = () => {
    if (!cropper) return;
    const h = +$('edH').value || 1;
    setTarget($('edLock').checked ? Math.round(h * cropRatio()) : +$('edW').value || 1, h);
  };

  // Presets: lock the crop to the preset's ratio and fix the output size.
  $('edPresets').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || !cropper) return;
    const [w, h] = b.dataset.wh.split('x').map(Number);
    const r = w / h;
    $('edRatios').querySelectorAll('button').forEach((x) => x.classList.toggle('active', Math.abs(parseFloat(x.dataset.r) - r) < 0.01));
    cropper.setAspectRatio(r);
    setTarget(w, h);
  };

  $('edExport').onclick = async () => {
    if (!cropper) return;
    const btn = $('edExport');
    btn.disabled = true;
    try {
      const d = cropper.getData(true);
      const w = Math.max(1, Math.round(target ? target.w : d.width));
      const h = Math.max(1, Math.round(target ? target.h : d.height));
      const s = safeScale(w, h);
      const ow = Math.round(w * s), oh = Math.round(h * s);
      const type = $('edFormat').value;
      // Cropper keeps the crop's aspect ratio ("contain"), so draw into our own canvas to honour exactly W×H.
      const crop = cropper.getCroppedCanvas({ imageSmoothingQuality: 'high', maxWidth: 4096, maxHeight: 4096 });
      if (!crop) throw new Error('Không tạo được ảnh (ảnh quá lớn cho thiết bị này?)');
      const out = makeCanvas(ow, oh);
      const ctx = out.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ow, oh); }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(crop, 0, 0, ow, oh);
      crop.width = crop.height = 0;
      const blob = await canvasToBlob(out, type, $('edQ').value / 100);
      out.width = out.height = 0;
      const name = `${srcName}-${ow}x${oh}.${FORMAT_INFO[type].ext}`;
      clearResults($('edOut'));
      resultCard($('edOut'), { blob, name, info: `${ow}×${oh}${s < 1 ? ' (đã giới hạn theo thiết bị)' : ''}` });
      download(blob, name);
    } catch (e) {
      toast('Lỗi: ' + e.message, 5000);
    } finally {
      btn.disabled = false;
    }
  };
})();
