/* Editor visual de páginas: Editar, Firmar, Censurar, Recortar y Formularios PDF.
   Todas las coordenadas del modelo están en puntos PDF de la página (sin rotación). */
const CSS_FONTS = { 'Arial': 'Arial, sans-serif', 'Times New Roman': '"Times New Roman", serif', 'Courier New': '"Courier New", monospace',
  'Verdana': 'Verdana, sans-serif', 'Georgia': 'Georgia, serif', 'Comic Sans MS': '"Comic Sans MS", cursive', 'Segoe Script': '"Segoe Script", cursive' };
const SWATCHES = ['#000000', '#1a3fbf', '#d93025', '#188038', '#f9ab00', '#9334e6', '#ffffff'];

const MODE_CFG = {
  edit: {
    title: 'Editar PDF', tools: [['select', '⬚', 'Seleccionar'], ['text', 'T', 'Texto'], ['image', '🖼', 'Imagen'], ['draw', '✎', 'Dibujar'],
      ['rect', '▭', 'Rectángulo'], ['ellipse', '◯', 'Elipse'], ['line', '╱', 'Línea'], ['arrow', '➚', 'Flecha'], ['highlight', '▆', 'Resaltar'], ['whiteout', '▢', 'Tapar']],
  },
  sign: { title: 'Firmar PDF', tools: [['select', '⬚', 'Seleccionar']] },
  redact: { title: 'Censurar PDF', tools: [['select', '⬚', 'Seleccionar'], ['redact', '█', 'Censurar área']] },
  crop: { title: 'Recortar PDF', tools: [] },
  forms: {
    title: 'Formularios PDF', tools: [['select', '⬚', 'Seleccionar / rellenar'], ['f-text', 'Aa', 'Texto'], ['f-checkbox', '☑', 'Casilla'],
      ['f-radio', '◉', 'Opción'], ['f-combobox', '▾', 'Desplegable'], ['f-listbox', '☰', 'Lista'], ['f-signature', '✍', 'Firma']],
  },
};

const EDITOR = {
  async open(ctx) {
    const t = ctx.tool, mode = t.mode, cfg = MODE_CFG[mode];
    const file = ctx.files[0];
    if (file.encrypted) { toast('El PDF está protegido. Desbloquéalo primero.', true); return renderTool(t); }
    busy(true, 'Cargando páginas…');
    let info;
    try { info = await api.json('/api/pagesinfo/' + file.id); } catch (e) { busy(false); toast(e.message, true); return; }
    busy(false);
    const st = {
      ctx, mode, pages: info.pages, els: [], sel: null, tool: mode === 'crop' ? 'select' : 'select', S: 1, nid: 1,
      def: { color: '#000000', stroke: '#d93025', fill: '', width: 2, font: 'Arial', size: 16, bold: false, italic: false, opacity: 1 },
      pending: null, hits: [], opts: { clean_metadata: true, flatten: false, crop_mode: 'manual', crop_scope: 'all', terms: [], patterns: [] },
      fields: [],
    };
    EDITOR.st = st;
    app.innerHTML = `
      <div class="editor">
        <div class="ed-center">
          <div class="ed-toolbar" id="tb">${cfg.tools.map(([k, i, n]) => `<button class="tb" data-tool="${k}" title="${n}"><span>${i}</span>${n}</button>`).join('')}
            <span style="flex:1"></span>
            <button class="tb" id="zoomOut" title="Alejar">－</button><button class="tb" id="zoomIn" title="Acercar">＋</button></div>
          <div class="ed-pages" id="pages"></div>
        </div>
        <aside class="ed-side"><h2>${cfg.title}</h2><div class="side-body" id="side"></div>
          <div class="side-foot"><button class="btn-big" id="run">${esc(t.action)} <span>➜</span></button></div></aside>
      </div>`;
    const avail = Math.max(320, $('#pages').clientWidth - 90);
    const maxW = Math.max(...st.pages.map(p => p.w));
    st.S = Math.min(1.6, avail / maxW);
    $$('#tb [data-tool]').forEach(b => b.onclick = () => EDITOR.setTool(b.dataset.tool));
    $('#zoomIn').onclick = () => EDITOR.zoom(1.2);
    $('#zoomOut').onclick = () => EDITOR.zoom(1 / 1.2);
    EDITOR.renderPages();
    EDITOR.setTool(st.tool);
    document.onkeydown = e => {
      if (!$('.editor')) { document.onkeydown = null; return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel && !e.target.isContentEditable && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
        EDITOR.remove(st.sel); e.preventDefault();
      }
    };
    if (mode === 'crop') {
      const p = st.pages[0];
      EDITOR.add({ page: 0, type: 'crop', rect: [p.w * .08, p.h * .08, p.w * .92, p.h * .92] });
      st.sel = null;
    }
    if (mode === 'forms') await EDITOR.loadFields();
    EDITOR.renderSide();
    $('#run').onclick = EDITOR.run;
  },

  zoom(f) {
    const st = EDITOR.st; st.S = Math.max(0.3, Math.min(3, st.S * f));
    EDITOR.renderPages(); st.els.forEach(EDITOR.draw); st.hits.forEach(EDITOR.drawHit); st.fields.forEach(EDITOR.drawField);
  },

  renderPages() {
    const st = EDITOR.st, box = $('#pages'); box.innerHTML = '';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    st.pages.forEach((p, i) => {
      const pg = h(`<div class="ed-page" style="width:${p.w * st.S}px;height:${p.h * st.S}px">
        <span class="pnum">${i + 1}</span><img loading="lazy" src="${api.thumb(st.ctx.files[0].id, i, (st.S * dpr).toFixed(2))}" alt="">
        <div class="ed-layer" data-page="${i}"></div></div>`);
      box.appendChild(pg);
      EDITOR.bindLayer($('.ed-layer', pg), i);
    });
  },

  layer(i) { return $(`.ed-layer[data-page="${i}"]`); },
  pt(e, layer) { const r = layer.getBoundingClientRect(), S = EDITOR.st.S; return [(e.clientX - r.left) / S, (e.clientY - r.top) / S]; },

  setTool(k) {
    const st = EDITOR.st; st.tool = k;
    $$('#tb [data-tool]').forEach(b => b.classList.toggle('sel', b.dataset.tool === k));
    $$('.ed-layer').forEach(l => l.classList.toggle('crosshair', k !== 'select'));
  },

  // ------------------------------------------------------------- creación con el ratón
  bindLayer(layer, page) {
    layer.addEventListener('pointerdown', e => {
      if (e.target !== layer) return;
      const st = EDITOR.st, [x, y] = EDITOR.pt(e, layer), tool = st.tool, d = st.def;
      EDITOR.select(null);
      if (st.pending) { // colocar firma / elemento preparado
        const pd = st.pending; st.pending = null; EDITOR.setTool('select');
        if (pd.type === 'image') {
          const w = pd.w || 160, hgt = w / (pd.ratio || 3);
          EDITOR.add({ page, type: 'image', src: pd.src, rect: [x - w / 2, y - hgt / 2, x + w / 2, y + hgt / 2], keepRatio: true }, true);
        } else EDITOR.add({ page, type: 'text', text: pd.text, rect: [x, y - d.size * .6, x + 10, y + d.size * .6], color: d.color, font: d.font, size: pd.size || d.size }, true);
        return;
      }
      if (tool === 'select') return;
      if (tool === 'text') {
        const el = EDITOR.add({ page, type: 'text', text: 'Escribe aquí', rect: [x, y - d.size * .6, x + 10, y + d.size * .6], color: d.color, font: d.font, size: d.size, bold: d.bold, italic: d.italic }, true);
        EDITOR.setTool('select');
        setTimeout(() => { const tx = $('.txt', EDITOR.dom(el)); tx.focus(); document.execCommand('selectAll'); }, 30);
        return;
      }
      if (tool === 'image') {
        const inp = h('<input type="file" accept="image/*">');
        inp.onchange = () => readImage(inp.files[0], (src, ratio) => {
          const w = Math.min(220, st.pages[page].w * .4), hh = w / ratio;
          EDITOR.add({ page, type: 'image', src, rect: [x, y, x + w, y + hh], keepRatio: true }, true);
        });
        inp.click(); EDITOR.setTool('select'); return;
      }
      // herramientas de arrastre
      const base = { page, rect: [x, y, x, y] };
      let el;
      if (tool === 'draw') el = EDITOR.add({ ...base, type: 'path', points: [[x, y]], stroke: d.stroke, width: d.width, opacity: d.opacity });
      else if (tool === 'line' || tool === 'arrow') el = EDITOR.add({ ...base, type: tool, x1: x, y1: y, x2: x, y2: y, stroke: d.stroke, width: d.width, opacity: d.opacity });
      else if (tool.startsWith('f-')) el = EDITOR.add({ ...base, type: 'field', ftype: tool.slice(2), name: '' });
      else el = EDITOR.add({ ...base, type: tool, stroke: tool === 'rect' || tool === 'ellipse' ? d.stroke : '', fill: tool === 'highlight' ? '#ffeb3b' : d.fill, width: d.width, opacity: d.opacity });
      layer.setPointerCapture(e.pointerId);
      const move = ev => {
        const [mx, my] = EDITOR.pt(ev, layer);
        if (el.type === 'path') el.points.push([mx, my]);
        else if (el.type === 'line' || el.type === 'arrow') { el.x2 = mx; el.y2 = my; }
        else el.rect = [Math.min(x, mx), Math.min(y, my), Math.max(x, mx), Math.max(y, my)];
        EDITOR.fitBox(el); EDITOR.draw(el);
      };
      const up = () => {
        layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up);
        const [x0, y0, x1, y1] = el.rect;
        if (el.type !== 'path' && el.type !== 'line' && el.type !== 'arrow' && (x1 - x0 < 4 || y1 - y0 < 4)) {
          const dw = el.type === 'field' ? ({ checkbox: 14, radio: 14 }[el.ftype] || 160) : 120;
          const dh = el.type === 'field' ? ({ checkbox: 14, radio: 14, listbox: 60 }[el.ftype] || 20) : el.type === 'highlight' ? 16 : 70;
          el.rect = [x, y, x + dw, y + dh];
        }
        if ((el.type === 'line' || el.type === 'arrow') && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 4) { el.x2 = el.x1 + 100; }
        if (el.type === 'path' && el.points.length < 2) { EDITOR.remove(el.id); return; }
        EDITOR.fitBox(el); EDITOR.draw(el); EDITOR.select(el.id);
        if (el.type === 'field') EDITOR.renderSide();
      };
      layer.addEventListener('pointermove', move); layer.addEventListener('pointerup', up);
    });
  },

  fitBox(el) {
    if (el.type === 'path') {
      const xs = el.points.map(p => p[0]), ys = el.points.map(p => p[1]), pad = (el.width || 2) / 2;
      el.rect = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    } else if (el.type === 'line' || el.type === 'arrow') {
      el.rect = [Math.min(el.x1, el.x2), Math.min(el.y1, el.y2), Math.max(el.x1, el.x2), Math.max(el.y1, el.y2)];
    }
  },

  // ------------------------------------------------------------- modelo
  add(el, select) {
    const st = EDITOR.st; el.id = st.nid++; st.els.push(el); EDITOR.draw(el);
    if (select) EDITOR.select(el.id);
    return el;
  },
  get(id) { return EDITOR.st.els.find(e => e.id === id); },
  dom(el) { return $(`.el[data-id="${el.id}"]`); },
  remove(id) {
    const st = EDITOR.st, el = EDITOR.get(id); if (!el || el.type === 'crop') return;
    st.els = st.els.filter(e => e.id !== id); EDITOR.dom(el)?.remove();
    if (st.sel === id) st.sel = null; EDITOR.renderSide();
  },
  select(id) {
    const st = EDITOR.st; st.sel = id;
    $$('.el').forEach(d => d.classList.toggle('selected', +d.dataset.id === id && !d.classList.contains('hit')));
    EDITOR.renderProps();
  },

  // ------------------------------------------------------------- dibujo de elementos
  draw(el) {
    const S = EDITOR.st.S, layer = EDITOR.layer(el.page);
    let d = EDITOR.dom(el);
    if (!d) {
      d = h(`<div class="el move" data-id="${el.id}"><button class="del" title="Eliminar">✕</button><span class="handle"></span></div>`);
      layer.appendChild(d);
      $('.del', d).onclick = ev => { ev.stopPropagation(); EDITOR.remove(el.id); };
      EDITOR.bindMove(d, el);
      if (el.type === 'text') {
        const tx = h(`<div class="txt" contenteditable="true" spellcheck="false"></div>`);
        tx.textContent = el.text; d.insertBefore(tx, d.firstChild);
        tx.addEventListener('input', () => { el.text = tx.innerText.replace(/\n$/, ''); EDITOR.measureText(el); });
        tx.addEventListener('pointerdown', ev => { ev.stopPropagation(); EDITOR.select(el.id); });
      } else if (el.type === 'image') d.insertBefore(h(`<img src="${el.src}" alt="">`), d.firstChild);
      else if (el.type === 'field') {
        d.classList.add('field');
        d.insertBefore(h(`<span class="ftag"></span>`), d.firstChild);
      } else if (el.type === 'redact') d.classList.add('redact');
      else if (el.type === 'crop') { d.classList.add('cropbox'); $('.del', d).remove(); }
    }
    const [x0, y0, x1, y1] = el.rect;
    Object.assign(d.style, { left: x0 * S + 'px', top: y0 * S + 'px', width: Math.max(1, (x1 - x0) * S) + 'px', height: Math.max(1, (y1 - y0) * S) + 'px' });
    if (el.type === 'text') {
      const tx = $('.txt', d);
      Object.assign(tx.style, { fontFamily: CSS_FONTS[el.font] || 'Arial', fontSize: el.size * S + 'px', color: el.color, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal', opacity: el.opacity ?? 1 });
      d.style.width = 'auto'; d.style.height = 'auto';
      requestAnimationFrame(() => EDITOR.measureText(el));
    } else if (el.type === 'rect' || el.type === 'whiteout' || el.type === 'highlight' || el.type === 'ellipse') {
      Object.assign(d.style, {
        border: el.stroke ? `${Math.max(1, el.width * S)}px solid ${el.stroke}` : '0', background: el.type === 'whiteout' ? '#fff' : el.fill || 'transparent',
        opacity: el.type === 'highlight' ? .4 : (el.opacity ?? 1), borderRadius: el.type === 'ellipse' ? '50%' : '0', boxSizing: 'border-box',
        outlineColor: el.type === 'whiteout' ? '#999' : '',
      });
      if (el.type === 'whiteout') d.style.boxShadow = '0 0 0 1px #ddd';
    } else if (el.type === 'path' || el.type === 'line' || el.type === 'arrow') {
      let svg = $('svg', d);
      if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); d.insertBefore(svg, d.firstChild); }
      const ox = x0, oy = y0, sw = el.width * S, c = el.stroke || '#000';
      let inner;
      if (el.type === 'path') inner = `<polyline points="${el.points.map(p => `${(p[0] - ox) * S},${(p[1] - oy) * S}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      else {
        const ax = (el.x1 - ox) * S, ay = (el.y1 - oy) * S, bx = (el.x2 - ox) * S, by = (el.y2 - oy) * S;
        inner = `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
        if (el.type === 'arrow') {
          const ang = Math.atan2(by - ay, bx - ax), L = (8 + el.width * 3) * S;
          inner += [2.6, -2.6].map(dd => `<line x1="${bx}" y1="${by}" x2="${bx + L * Math.cos(ang + dd)}" y2="${by + L * Math.sin(ang + dd)}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`).join('');
        }
      }
      svg.innerHTML = inner; d.style.opacity = el.opacity ?? 1;
    } else if (el.type === 'field') {
      $('.ftag', d).textContent = ({ text: 'Texto', checkbox: 'Casilla', radio: 'Opción', combobox: 'Desplegable', listbox: 'Lista', signature: 'Firma' }[el.ftype]) + (el.name ? ': ' + el.name : '');
    }
  },

  measureText(el) {
    const d = EDITOR.dom(el); if (!d) return;
    const S = EDITOR.st.S, tx = $('.txt', d);
    el.rect[2] = el.rect[0] + tx.offsetWidth / S; el.rect[3] = el.rect[1] + tx.offsetHeight / S;
  },

  bindMove(d, el) {
    d.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('del')) return;
      const isHandle = e.target.classList.contains('handle');
      if (e.target.closest('.txt') && !isHandle) return;
      e.stopPropagation(); e.preventDefault();
      EDITOR.select(el.id);
      const layer = d.parentElement, [sx, sy] = EDITOR.pt(e, layer);
      const r0 = [...el.rect], pts0 = el.points ? el.points.map(p => [...p]) : null, l0 = [el.x1, el.y1, el.x2, el.y2], size0 = el.size;
      d.setPointerCapture(e.pointerId);
      const move = ev => {
        const [mx, my] = EDITOR.pt(ev, layer), dx = mx - sx, dy = my - sy;
        if (!isHandle) {
          el.rect = [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy];
          if (pts0) el.points = pts0.map(p => [p[0] + dx, p[1] + dy]);
          if (el.x1 !== undefined) [el.x1, el.y1, el.x2, el.y2] = [l0[0] + dx, l0[1] + dy, l0[2] + dx, l0[3] + dy];
        } else {
          const w0 = r0[2] - r0[0], h0 = r0[3] - r0[1];
          let nw = Math.max(6, w0 + dx), nh = Math.max(6, h0 + dy);
          if (el.keepRatio || el.type === 'text') { const k = Math.max(nw / w0, nh / h0); nw = w0 * k; nh = h0 * k; }
          if (el.type === 'text') { el.size = Math.max(4, Math.round(size0 * nh / h0 * 10) / 10); }
          const kx = nw / w0, ky = nh / h0;
          if (pts0) el.points = pts0.map(p => [r0[0] + (p[0] - r0[0]) * kx, r0[1] + (p[1] - r0[1]) * ky]);
          if (el.x1 !== undefined) { el.x1 = r0[0] + (l0[0] - r0[0]) * kx; el.y1 = r0[1] + (l0[1] - r0[1]) * ky; el.x2 = r0[0] + (l0[2] - r0[0]) * kx; el.y2 = r0[1] + (l0[3] - r0[1]) * ky; }
          el.rect = [r0[0], r0[1], r0[0] + nw, r0[1] + nh];
        }
        EDITOR.draw(el);
      };
      const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); EDITOR.renderProps(); };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
    });
  },

  // ------------------------------------------------------------- panel lateral
  renderSide() {
    const st = EDITOR.st, side = $('#side'); if (!side) return;
    side.innerHTML = '';
    const M = st.mode;
    if (M === 'edit') side.appendChild(h(`<p class="note">Elige una herramienta arriba y haz clic o arrastra sobre la página. Selecciona un elemento para cambiar sus propiedades; Supr lo elimina.</p>`));
    if (M === 'sign') EDITOR.sideSign(side);
    if (M === 'redact') EDITOR.sideRedact(side);
    if (M === 'crop') EDITOR.sideCrop(side);
    if (M === 'forms') EDITOR.sideForms(side);
    side.appendChild(h('<div id="props"></div>'));
    EDITOR.renderProps();
  },

  renderProps() {
    const st = EDITOR.st, box = $('#props'); if (!box) return;
    box.innerHTML = '';
    const el = st.sel ? EDITOR.get(st.sel) : null;
    if (st.mode === 'crop' || st.mode === 'redact') return;
    if (st.mode === 'forms') { if (el?.type === 'field') EDITOR.fieldProps(box, el); return; }
    if (st.mode === 'sign' && !el) return;
    const target = el || st.def, isNew = !el;
    const type = el?.type;
    const fields = [];
    const showText = !el || type === 'text', showStroke = !el || ['rect', 'ellipse', 'line', 'arrow', 'path'].includes(type), showFill = !el || ['rect', 'ellipse'].includes(type);
    box.appendChild(h(`<h4 style="margin:10px 0">${isNew ? 'Valores por defecto' : 'Elemento seleccionado'}</h4>`));
    if (showText) {
      fields.push({ key: 'font', type: 'select', label: 'Fuente', choices: FONTS.map(f => [f, f]) });
      fields.push({ key: 'size', type: 'number', label: 'Tamaño', min: 4, max: 300, half: true });
      fields.push({ key: 'color', type: 'color', label: 'Color del texto', half: true });
      fields.push({ key: 'bold', type: 'check', label: 'Negrita', half: true }, { key: 'italic', type: 'check', label: 'Cursiva', half: true });
    }
    if (showStroke) {
      fields.push({ key: 'stroke', type: 'color', label: 'Color del trazo', half: true });
      fields.push({ key: 'width', type: 'number', label: 'Grosor', min: 0.5, max: 30, step: 0.5, half: true });
    }
    if (showFill) fields.push({ key: 'fill', type: 'color', label: 'Relleno (vacío = sin relleno)' });
    if (el && type !== 'whiteout' && type !== 'highlight') fields.push({ key: 'opacity', type: 'range', label: 'Opacidad %', min: 10, max: 100 });
    const proxy = { ...target, opacity: Math.round((target.opacity ?? 1) * 100) };
    renderOptions(box, fields, new Proxy(proxy, {
      set(o, k, v) {
        o[k] = v; target[k] = k === 'opacity' ? v / 100 : v;
        if (el) EDITOR.draw(el); return true;
      },
    }));
    if (showFill) box.appendChild(h('<button class="btn small" id="nofill">Sin relleno</button>')).onclick = () => { target.fill = ''; if (el) EDITOR.draw(el); };
    if (el) {
      const row = h(`<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><button class="btn small" data-a="dup">Duplicar</button>
        ${st.pages.length > 1 ? '<button class="btn small" data-a="all">Copiar en todas las páginas</button>' : ''}<button class="btn small" data-a="del">Eliminar</button></div>`);
      box.appendChild(row);
      $('[data-a=del]', row).onclick = () => EDITOR.remove(el.id);
      $('[data-a=dup]', row).onclick = () => { const c = structuredClone({ ...el, id: undefined }); c.rect = c.rect.map((v, i) => v + 12); shiftPts(c, 12); EDITOR.add(c, true); };
      const all = $('[data-a=all]', row);
      if (all) all.onclick = () => { st.pages.forEach((p, i) => { if (i !== el.page) { const c = structuredClone({ ...el, id: undefined }); c.page = i; EDITOR.add(c); } }); toast('Copiado en todas las páginas'); };
    }
  },

  // ---------------------------------------------------- Firmar
  sideSign(side) {
    const st = EDITOR.st;
    const sigs = lsGet('iw_signatures', []), inits = lsGet('iw_initials', []);
    const name = lsGet('iw_name', '');
    const box = h(`<div>
      <div class="field"><span class="flabel">Tu nombre completo</span><input class="input" id="sgName" value="${esc(name)}" placeholder="Nombre y apellidos"></div>
      <div class="field"><span class="flabel">Firmas</span><div class="sig-list" id="sigList"></div>
        <button class="btn small" id="newSig" style="margin-top:8px">+ Crear firma</button></div>
      <div class="field"><span class="flabel">Iniciales</span><div class="sig-list" id="iniList"></div>
        <button class="btn small" id="newIni" style="margin-top:8px">+ Crear iniciales</button></div>
      <div class="field"><span class="flabel">Añadir campo</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-p="name">Nombre</button><button class="btn small" data-p="date">Fecha</button><button class="btn small" data-p="text">Texto</button></div></div>
      <p class="note">Haz clic en una firma y después en la página donde quieras colocarla. Arrastra la esquina azul para cambiar el tamaño.</p></div>`);
    side.appendChild(box);
    const list = (id, arr, key) => {
      const l = $('#' + id, box); l.innerHTML = '';
      arr.forEach((s, i) => {
        const it = h(`<div class="sig-item"><img src="${s.src}" alt=""><span style="flex:1"></span><button class="btn small ghost" title="Borrar">✕</button></div>`);
        it.onclick = () => { st.pending = { type: 'image', src: s.src, ratio: s.ratio, w: key === 'iw_initials' ? 70 : 160 }; EDITOR.setTool('place'); toast('Haz clic en la página para colocarla'); };
        $('button', it).onclick = ev => { ev.stopPropagation(); arr.splice(i, 1); lsSet(key, arr); list(id, arr, key); };
        l.appendChild(it);
      });
      if (!arr.length) l.innerHTML = '<span class="help">Todavía no hay ninguna.</span>';
    };
    list('sigList', sigs, 'iw_signatures'); list('iniList', inits, 'iw_initials');
    $('#sgName', box).oninput = e => lsSet('iw_name', e.target.value);
    $('#newSig', box).onclick = () => signatureDialog('Crear firma', $('#sgName', box).value, r => { sigs.unshift(r); lsSet('iw_signatures', sigs.slice(0, 6)); list('sigList', sigs, 'iw_signatures'); st.pending = { type: 'image', ...r, w: 160 }; toast('Haz clic en la página para colocar la firma'); });
    $('#newIni', box).onclick = () => {
      const n = $('#sgName', box).value.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase();
      signatureDialog('Crear iniciales', n, r => { inits.unshift(r); lsSet('iw_initials', inits.slice(0, 6)); list('iniList', inits, 'iw_initials'); st.pending = { type: 'image', ...r, w: 70 }; toast('Haz clic en la página para colocarlas'); });
    };
    $$('[data-p]', box).forEach(b => b.onclick = () => {
      const v = b.dataset.p;
      const text = v === 'name' ? ($('#sgName', box).value || 'Nombre') : v === 'date' ? new Date().toLocaleDateString('es') : 'Texto';
      st.pending = { type: 'text', text, size: 12 }; toast('Haz clic en la página para colocarlo');
    });
  },

  // ---------------------------------------------------- Censurar
  sideRedact(side) {
    const st = EDITOR.st, o = st.opts;
    const P = [['email', 'Correos electrónicos'], ['phone', 'Números de teléfono'], ['card', 'Tarjetas bancarias'], ['iban', 'IBAN / cuentas'], ['rut', 'RUT (Chile)'], ['dni', 'DNI (España)'], ['date', 'Fechas']];
    const box = h(`<div>
      <div class="field"><span class="flabel">Buscar texto a censurar</span>
        <div style="display:flex;gap:6px"><input class="input" id="rdTerm" placeholder="palabra o frase"><button class="btn" id="rdAdd">Añadir</button></div>
        <div class="chipbox" id="rdChips"></div></div>
      <div class="field"><span class="flabel">Censurar automáticamente</span>${P.map(([k, n]) => `<label class="check"><input type="checkbox" data-pat="${k}" ${o.patterns.includes(k) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <label class="check"><input type="checkbox" id="rdCase" ${o.case_sensitive ? 'checked' : ''}><span>Distinguir mayúsculas y minúsculas</span></label>
      <button class="btn" id="rdFind" style="width:100%">Buscar coincidencias</button>
      <div id="rdHits" style="margin-top:12px"></div>
      <label class="check" style="margin-top:14px"><input type="checkbox" id="rdMeta" ${o.clean_metadata ? 'checked' : ''}><span>Eliminar también los metadatos (autor, título…)</span></label>
      <p class="note">Usa "Censurar área" para tapar zonas a mano. La censura elimina el contenido de forma permanente: el texto debajo deja de existir.</p></div>`);
    side.appendChild(box);
    const chips = () => { $('#rdChips', box).innerHTML = o.terms.map((t, i) => `<span class="chip">${esc(t)}<button data-i="${i}">✕</button></span>`).join('');
      $$('#rdChips button', box).forEach(b => b.onclick = () => { o.terms.splice(+b.dataset.i, 1); chips(); }); };
    chips();
    const add = () => { const v = $('#rdTerm', box).value.trim(); if (v) { o.terms.push(v); $('#rdTerm', box).value = ''; chips(); } };
    $('#rdAdd', box).onclick = add; $('#rdTerm', box).onkeydown = e => e.key === 'Enter' && add();
    $$('[data-pat]', box).forEach(c => c.onchange = () => { o.patterns = $$('[data-pat]', box).filter(x => x.checked).map(x => x.dataset.pat); });
    $('#rdCase', box).onchange = e => o.case_sensitive = e.target.checked;
    $('#rdMeta', box).onchange = e => o.clean_metadata = e.target.checked;
    $('#rdFind', box).onclick = async () => {
      add();
      busy(true, 'Buscando…');
      try {
        const r = await api.tool('redact_preview', [st.ctx.files[0].id], { terms: o.terms, patterns: o.patterns, case_sensitive: o.case_sensitive });
        $$('.el.hit').forEach(x => x.remove());
        st.hits = r.data.hits.map((x, i) => ({ ...x, id: 'h' + i, on: true }));
        st.hits.forEach(EDITOR.drawHit);
        $('#rdHits', box).innerHTML = st.hits.length ? `<div class="flabel">${st.hits.length} coincidencias (desmarca las que no quieras censurar)</div>
          <div class="list-hits">${st.hits.map(x => `<label><input type="checkbox" data-h="${x.id}" checked> p.${x.page + 1}: ${esc(x.text)}</label>`).join('')}</div>` : '<span class="help">Sin coincidencias.</span>';
        $$('[data-h]', box).forEach(c => c.onchange = () => { const x = st.hits.find(y => y.id === c.dataset.h); x.on = c.checked; EDITOR.drawHit(x); });
        if (st.hits.length) EDITOR.layer(st.hits[0].page).scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) { toast(e.message, true); } finally { busy(false); }
    };
  },
  drawHit(x) {
    const S = EDITOR.st.S;
    let d = $(`.el.hit[data-hid="${x.id}"]`);
    if (!d) { d = h(`<div class="el hit" data-hid="${x.id}" title="Clic para incluir/excluir"></div>`); EDITOR.layer(x.page).appendChild(d);
      d.onclick = () => { x.on = !x.on; EDITOR.drawHit(x); const c = $(`[data-h="${x.id}"]`); if (c) c.checked = x.on; }; }
    const [x0, y0, x1, y1] = x.rect;
    Object.assign(d.style, { left: x0 * S + 'px', top: y0 * S + 'px', width: (x1 - x0) * S + 'px', height: (y1 - y0) * S + 'px' });
    d.classList.toggle('off', !x.on);
  },

  // ---------------------------------------------------- Recortar
  sideCrop(side) {
    const st = EDITOR.st, o = st.opts;
    const box = h(`<div>
      <div class="field"><span class="flabel">Modo</span><div class="cards"><div class="copt" data-m="manual"><b>Seleccionar área</b><small>Dibuja el recorte</small></div>
        <div class="copt" data-m="auto"><b>Quitar márgenes</b><small>Automático</small></div></div></div>
      <div id="cropManual"><div class="field"><span class="flabel">Aplicar a</span><div class="cards"><div class="copt" data-s="all"><b>Todas las páginas</b></div><div class="copt" data-s="page"><b>Solo esta página</b></div></div></div>
        <p class="note">Mueve el recuadro azul o arrastra su esquina para ajustarlo. Puedes moverlo a otra página haciendo clic en ella.</p></div>
      <div id="cropAuto"><div class="field"><span class="flabel">Margen a conservar (pt)</span><input class="input" type="number" id="cropPad" value="${o.padding ?? 10}" min="0"></div>
        <p class="note">Se detecta el contenido de cada página y se recortan los márgenes en blanco.</p></div></div>`);
    side.appendChild(box);
    const sync = () => {
      $$('[data-m]', box).forEach(c => c.classList.toggle('sel', c.dataset.m === o.crop_mode));
      $$('[data-s]', box).forEach(c => c.classList.toggle('sel', c.dataset.s === o.crop_scope));
      $('#cropManual', box).hidden = o.crop_mode !== 'manual'; $('#cropAuto', box).hidden = o.crop_mode !== 'auto';
      const cb = st.els.find(e => e.type === 'crop'); if (cb) EDITOR.dom(cb).style.display = o.crop_mode === 'manual' ? '' : 'none';
    };
    $$('[data-m]', box).forEach(c => c.onclick = () => { o.crop_mode = c.dataset.m; sync(); });
    $$('[data-s]', box).forEach(c => c.onclick = () => { o.crop_scope = c.dataset.s; sync(); });
    $('#cropPad', box).oninput = e => o.padding = +e.target.value;
    // clic en otra página -> mover el recuadro allí
    $$('.ed-layer').forEach(l => l.onclick = e => {
      if (e.target !== l || o.crop_mode !== 'manual') return;
      const cb = st.els.find(x => x.type === 'crop'), pg = +l.dataset.page;
      if (cb.page === pg) return;
      EDITOR.dom(cb).remove(); cb.page = pg; const p = st.pages[pg];
      cb.rect = [p.w * .08, p.h * .08, p.w * .92, p.h * .92]; EDITOR.draw(cb);
    });
    sync();
  },

  // ---------------------------------------------------- Formularios
  async loadFields() {
    const st = EDITOR.st;
    busy(true, 'Detectando campos…');
    try {
      const r = await api.tool('forms_detect', [st.ctx.files[0].id], { autodetect: true });
      st.fields = r.data.fields.map((f, i) => ({ ...f, id: 'x' + i }));
      st.suggest = r.data.suggested.map((f, i) => ({ ...f, id: 's' + i }));
      st.fields.forEach(EDITOR.drawField); st.suggest.forEach(EDITOR.drawSuggest);
      st.values = {};
    } catch (e) { toast(e.message, true); } finally { busy(false); }
  },
  drawField(f) {
    const st = EDITOR.st, S = st.S;
    let d = $(`.el[data-fid="${f.id}"]`);
    if (!d) {
      d = h(`<div class="el field" data-fid="${f.id}"><span class="ftag">${esc(f.name)}</span></div>`);
      let inp;
      if (f.type === 'checkbox' || f.type === 'radio') {
        inp = h(`<input type="checkbox" ${f.value && f.value !== 'Off' ? 'checked' : ''}>`);
        inp.onchange = () => st.values[f.name] = inp.checked;
      } else if (f.type === 'combobox' || f.type === 'listbox') {
        inp = h(`<select>${f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
        inp.onchange = () => st.values[f.name] = inp.value;
      } else if (f.type !== 'signature') {
        inp = h(`<input type="text" value="${esc(f.value || '')}">`);
        inp.oninput = () => st.values[f.name] = inp.value;
      }
      if (inp) d.appendChild(inp);
      EDITOR.layer(f.page).appendChild(d);
    }
    const [x0, y0, x1, y1] = f.rect;
    Object.assign(d.style, { left: x0 * S + 'px', top: y0 * S + 'px', width: (x1 - x0) * S + 'px', height: (y1 - y0) * S + 'px' });
  },
  drawSuggest(s) {
    const st = EDITOR.st, S = st.S;
    const d = h(`<div class="el field suggest" title="Clic para crear este campo"><span class="ftag" style="background:#C98A00">Sugerido: ${s.type === 'checkbox' ? 'casilla' : 'texto'}</span></div>`);
    const [x0, y0, x1, y1] = s.rect;
    Object.assign(d.style, { left: x0 * S + 'px', top: y0 * S + 'px', width: (x1 - x0) * S + 'px', height: (y1 - y0) * S + 'px' });
    d.onclick = e => { e.stopPropagation(); d.remove(); st.suggest = st.suggest.filter(x => x !== s); EDITOR.add({ page: s.page, type: 'field', ftype: s.type, rect: s.rect, name: '' }, true); EDITOR.renderSide(); };
    EDITOR.layer(s.page).appendChild(d);
  },
  sideForms(side) {
    const st = EDITOR.st;
    const nNew = st.els.filter(e => e.type === 'field').length;
    const box = h(`<div>
      <p class="note">${st.fields.length ? `Este PDF tiene <b>${st.fields.length}</b> campos: rellénalos directamente sobre la página.` : 'Este PDF no tiene campos rellenables.'}
       ${st.suggest?.length ? `Se han detectado <b>${st.suggest.length}</b> posibles campos (en amarillo): haz clic para crearlos.` : ''}
       Usa la barra superior para añadir campos nuevos.</p>
      ${st.suggest?.length ? '<button class="btn" id="fmAll" style="width:100%;margin-bottom:12px">Crear todos los campos sugeridos</button>' : ''}
      <p class="help">${nNew} campos nuevos añadidos.</p>
      <label class="check"><input type="checkbox" id="fmFlat" ${st.opts.flatten ? 'checked' : ''}><span>Aplanar formulario (los valores quedan fijos y ya no se pueden editar)</span></label></div>`);
    side.appendChild(box);
    $('#fmFlat', box).onchange = e => st.opts.flatten = e.target.checked;
    const all = $('#fmAll', box);
    if (all) all.onclick = () => { $$('.el.suggest').forEach(x => x.remove()); st.suggest.forEach(s => EDITOR.add({ page: s.page, type: 'field', ftype: s.type, rect: s.rect, name: '' })); st.suggest = []; EDITOR.renderSide(); };
  },
  fieldProps(box, el) {
    const fields = [
      { key: 'ftype', type: 'select', label: 'Tipo de campo', choices: [['text', 'Texto'], ['checkbox', 'Casilla'], ['radio', 'Opción'], ['combobox', 'Desplegable'], ['listbox', 'Lista'], ['signature', 'Firma']] },
      { key: 'name', type: 'text', label: 'Nombre del campo', placeholder: 'automático' },
      { key: 'optionsText', type: 'textarea', label: 'Opciones (una por línea)', show: o => o.ftype === 'combobox' || o.ftype === 'listbox' },
      { key: 'required', type: 'check', label: 'Obligatorio' },
    ];
    el.optionsText = el.optionsText ?? 'Opción 1\nOpción 2';
    box.appendChild(h('<h4 style="margin:14px 0 10px">Campo seleccionado</h4>'));
    renderOptions(box, fields, new Proxy(el, { set(o, k, v) { o[k] = v; EDITOR.draw(o); return true; } }));
    box.appendChild(h('<button class="btn small">Eliminar campo</button>')).onclick = () => EDITOR.remove(el.id);
  },

  // ------------------------------------------------------------- enviar
  async run() {
    const st = EDITOR.st, t = st.ctx.tool, fid = [st.ctx.files[0]];
    $$('.txt').forEach(x => x.blur());
    let opts;
    if (st.mode === 'edit' || st.mode === 'sign') {
      const els = st.els.filter(e => !['crop', 'field', 'redact'].includes(e.type));
      if (!els.length) return toast(st.mode === 'sign' ? 'Coloca al menos una firma.' : 'Añade algún elemento al PDF.', true);
      els.filter(e => e.type === 'text').forEach(EDITOR.measureText);
      opts = { elements: els.map(({ id, keepRatio, ...e }) => e) };
    } else if (st.mode === 'redact') {
      const areas = st.els.filter(e => e.type === 'redact').map(e => ({ page: e.page, rect: e.rect }));
      const searched = st.hits.length > 0;
      if (searched) areas.push(...st.hits.filter(x => x.on).map(x => ({ page: x.page, rect: x.rect })));
      opts = { areas, terms: searched ? [] : st.opts.terms, patterns: searched ? [] : st.opts.patterns, case_sensitive: st.opts.case_sensitive, clean_metadata: st.opts.clean_metadata };
      if (!areas.length && !opts.terms.length && !opts.patterns.length) return toast('Marca áreas o busca texto para censurar.', true);
    } else if (st.mode === 'crop') {
      const cb = st.els.find(e => e.type === 'crop');
      opts = st.opts.crop_mode === 'auto' ? { mode: 'auto', padding: st.opts.padding ?? 10 }
        : { mode: 'manual', rect: cb.rect, pages: st.opts.crop_scope === 'all' ? 'all' : String(cb.page + 1) };
    } else if (st.mode === 'forms') {
      opts = {
        values: st.values || {}, flatten: st.opts.flatten,
        new_fields: st.els.filter(e => e.type === 'field').map(e => ({ page: e.page, type: e.ftype, rect: e.rect, name: e.name, required: e.required,
          options: (e.optionsText || '').split('\n').map(s => s.trim()).filter(Boolean) })),
      };
    }
    runTool(t, fid, opts);
  },
};

function shiftPts(c, d) {
  if (c.points) c.points = c.points.map(p => [p[0] + d, p[1] + d]);
  if (c.x1 !== undefined) { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; }
}

function readImage(file, cb) {
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => cb(r.result, im.width / im.height); im.src = r.result; };
  r.readAsDataURL(file);
}

// ------------------------------------------------------------------ creador de firmas
function trimCanvas(c) {
  const ctx = c.getContext('2d'), { width: w, height: hh } = c, d = ctx.getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = 0, y1 = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const pad = 6, o = document.createElement('canvas');
  o.width = x1 - x0 + pad * 2; o.height = y1 - y0 + pad * 2;
  o.getContext('2d').drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height);
  return { src: o.toDataURL('image/png'), ratio: o.width / o.height };
}

function signatureDialog(title, name, done) {
  const d = $('#dlg');
  const fonts = ['Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Ink Free', 'Freestyle Script', 'Mistral', 'Gabriola', 'Segoe Print'];
  let color = '#1a3fbf', tab = 'draw';
  d.innerHTML = `<div class="dlg-head"><h3>${esc(title)}</h3><button class="btn ghost" data-close>✕</button></div>
    <div class="dlg-body">
      <div class="tabs"><button data-t="draw" class="sel">Dibujar</button><button data-t="type">Escribir</button><button data-t="upload">Subir imagen</button></div>
      <div data-p="draw"><canvas class="sig-pad" id="pad"></canvas><div style="display:flex;justify-content:space-between;margin-top:8px"><button class="btn small" id="clr">Borrar</button><span class="help">Dibuja con el ratón, el lápiz o el dedo</span></div></div>
      <div data-p="type" hidden><input class="input" id="sgTxt" value="${esc(name)}" placeholder="Escribe tu nombre" style="margin-bottom:10px">
        <div class="sig-fonts">${fonts.map((f, i) => `<label style="font-family:'${f}'"><input type="radio" name="sgf" value="${f}" ${i ? '' : 'checked'}><span class="sgprev">${esc(name || 'Tu firma')}</span></label>`).join('')}</div></div>
      <div data-p="upload" hidden><input type="file" accept="image/*" id="sgFile" class="input"><label class="check" style="margin-top:10px"><input type="checkbox" id="sgWhite" checked><span>Quitar el fondo blanco</span></label><div id="sgUp"></div></div>
      <div class="field" style="margin-top:14px"><span class="flabel">Color</span><div class="colors">${['#000000', '#1a3fbf', '#d93025'].map(c => `<button style="background:${c}" data-c="${c}" class="${c === color ? 'sel' : ''}"></button>`).join('')}</div></div>
    </div>
    <div class="dlg-foot"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="sgOk">Aplicar</button></div>`;
  d.showModal();
  $$('[data-close]', d).forEach(b => b.onclick = () => d.close());
  $$('.tabs button', d).forEach(b => b.onclick = () => { tab = b.dataset.t; $$('.tabs button', d).forEach(x => x.classList.toggle('sel', x === b)); $$('[data-p]', d).forEach(p => p.hidden = p.dataset.p !== tab); });
  $$('[data-c]', d).forEach(b => b.onclick = () => { color = b.dataset.c; $$('[data-c]', d).forEach(x => x.classList.toggle('sel', x === b)); $$('.sgprev', d).forEach(s => s.style.color = color); });
  $$('.sgprev', d).forEach(s => s.style.color = color);
  // dibujo
  const pad = $('#pad', d), pctx = pad.getContext('2d');
  const sizePad = () => { const r = pad.getBoundingClientRect(); pad.width = r.width * 2; pad.height = r.height * 2; pctx.scale(2, 2); pctx.lineCap = pctx.lineJoin = 'round'; };
  requestAnimationFrame(sizePad);
  let drawing = false, last = null;
  pad.onpointerdown = e => { drawing = true; pad.setPointerCapture(e.pointerId); const r = pad.getBoundingClientRect(); last = [e.clientX - r.left, e.clientY - r.top]; };
  pad.onpointermove = e => {
    if (!drawing) return; const r = pad.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top];
    pctx.strokeStyle = color; pctx.lineWidth = 2.6 * (e.pressure && e.pointerType === 'pen' ? e.pressure * 1.6 : 1);
    pctx.beginPath(); pctx.moveTo(...last); pctx.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2); pctx.lineTo(...p); pctx.stroke(); last = p;
  };
  pad.onpointerup = () => drawing = false;
  $('#clr', d).onclick = () => pctx.clearRect(0, 0, pad.width, pad.height);
  $('#sgTxt', d).oninput = e => $$('.sgprev', d).forEach(s => s.textContent = e.target.value || 'Tu firma');
  let upImg = null;
  $('#sgFile', d).onchange = e => readImage(e.target.files[0], src => { upImg = src; $('#sgUp', d).innerHTML = `<img src="${src}" style="max-width:100%;max-height:120px;margin-top:10px">`; });
  $('#sgOk', d).onclick = async () => {
    let res = null;
    if (tab === 'draw') {
      // recolorear trazos ya hechos con el color elegido
      res = trimCanvas(pad);
    } else if (tab === 'type') {
      const txt = $('#sgTxt', d).value.trim(); if (!txt) return toast('Escribe el texto de la firma', true);
      const font = $('input[name=sgf]:checked', d).value;
      await document.fonts.load(`96px "${font}"`).catch(() => {});
      const c = document.createElement('canvas'), cx = c.getContext('2d');
      cx.font = `96px "${font}"`; c.width = cx.measureText(txt).width + 60; c.height = 190;
      cx.font = `96px "${font}"`; cx.fillStyle = color; cx.textBaseline = 'middle'; cx.fillText(txt, 30, 95);
      res = trimCanvas(c);
    } else if (upImg) {
      const im = new Image(); im.src = upImg; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
      if ($('#sgWhite', d).checked) {
        const id = cx.getImageData(0, 0, c.width, c.height), p = id.data;
        for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3; if (l > 215) p[i + 3] = 0; else if (l > 160) p[i + 3] = Math.round(p[i + 3] * (215 - l) / 55); }
        cx.putImageData(id, 0, 0);
      }
      res = trimCanvas(c);
    }
    if (!res) return toast('La firma está vacía', true);
    d.close(); done(res);
  };
}
