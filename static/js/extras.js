/* Vistas especiales: rotar, ordenar, HTML a PDF, escanear, flujos de trabajo y visor de comparación. */
const FILE_COLORS = ['#F2683C', '#2D7FF9', '#3FA45B', '#A15CDB', '#E8A21A', '#E0457B', '#2B5C9E', '#6C47FF'];

const EXTRAS = {
  // ------------------------------------------------------------------ ROTAR
  rotate(ctx) {
    const t = ctx.tool;
    const rot = {}; // "fi:pi" -> grados
    app.innerHTML = `<div class="workspace">
      <section class="ws-main" id="dzw"><div class="groupbar">
        <button class="btn" id="allL">⟲ Rotar todo a la izquierda</button><button class="btn" id="allR">⟳ Rotar todo a la derecha</button>
        <button class="btn ghost" id="reset">Restablecer</button><span class="help">Pasa el ratón por una página para rotarla individualmente.</span></div>
        <div class="pages-grid" id="pg"></div><button class="addmore" id="addmore" title="Añadir archivos">+</button></section>
      <aside class="ws-side"><h2>Rotar PDF</h2><div class="side-body"><p class="note">Las rotaciones se aplican a cada página que hayas girado. Puedes rotar varios PDF a la vez.</p></div>
        <div class="side-foot"><button class="btn-big" id="run">Rotar PDF <span>➜</span></button></div></aside></div>`;
    const draw = () => {
      const g = $('#pg'); g.innerHTML = '';
      ctx.files.forEach((f, fi) => {
        for (let pi = 0; pi < (f.pages || 0); pi++) {
          const k = fi + ':' + pi;
          const c = h(`<div class="pcard" style="cursor:default"><span class="fdot" style="background:${FILE_COLORS[fi % 8]}"></span>
            <div class="fbtns"><button class="rbtn" data-d="-90" title="Izquierda">⟲</button><button class="rbtn" data-d="90" title="Derecha">⟳</button></div>
            <div class="fthumb"><img loading="lazy" src="${api.thumb(f.id, pi, 0.3)}" style="transform:rotate(${rot[k] || 0}deg)"></div>
            <div class="plabel">${esc(f.name.slice(0, 18))} · ${pi + 1}</div></div>`);
          $$('[data-d]', c).forEach(b => b.onclick = () => { rot[k] = ((rot[k] || 0) + +b.dataset.d + 360) % 360; $('img', c).style.transform = `rotate(${rot[k]}deg)`; });
          g.appendChild(c);
        }
      });
    };
    const all = d => { ctx.files.forEach((f, fi) => { for (let pi = 0; pi < f.pages; pi++) { const k = fi + ':' + pi; rot[k] = ((rot[k] || 0) + d + 360) % 360; } }); draw(); };
    $('#allL').onclick = () => all(-90); $('#allR').onclick = () => all(90);
    $('#reset').onclick = () => { Object.keys(rot).forEach(k => delete rot[k]); draw(); };
    bindPicker($('#addmore'), $('#dzw'), t, m => { ctx.files.push(...m); draw(); });
    draw();
    $('#run').onclick = () => {
      if (!Object.values(rot).some(Boolean)) return toast('Gira al menos una página.', true);
      const per = {};
      Object.entries(rot).forEach(([k, v]) => { const [fi, pi] = k.split(':'); (per[fi] = per[fi] || {})[pi] = v; });
      ctx.files.forEach((f, fi) => { per[fi] = per[fi] || {}; });
      runTool(t, ctx.files, { per_page: per });
    };
  },

  // ------------------------------------------------------------------ ORDENAR
  organize(ctx) {
    const t = ctx.tool;
    let seq = [];
    const rebuild = () => { seq = []; ctx.files.forEach((f, fi) => { for (let p = 0; p < (f.pages || 0); p++) seq.push({ f: fi, p, r: 0 }); }); };
    rebuild();
    app.innerHTML = `<div class="workspace">
      <section class="ws-main" id="dzw"><div class="groupbar"><button class="btn" id="srtAsc">Ordenar por archivo</button>
        <button class="btn" id="rev">Invertir orden</button><button class="btn ghost" id="reset">Restablecer</button>
        <span class="help">Arrastra las páginas para reordenarlas. Usa ✕ para eliminar, ⟳ para rotar y ＋ para insertar una página en blanco.</span></div>
        <div class="pages-grid" id="pg"></div><button class="addmore" id="addmore" title="Añadir otro PDF">+</button></section>
      <aside class="ws-side"><h2>Ordenar PDF</h2><div class="side-body"><p class="note" id="cnt"></p></div>
        <div class="side-foot"><button class="btn-big" id="run">Ordenar <span>➜</span></button></div></aside></div>`;
    const draw = () => {
      const g = $('#pg'); g.innerHTML = '';
      seq.forEach((it, i) => {
        const f = ctx.files[it.f];
        const c = h(`<div class="pcard${it.blank ? ' blank' : ''}" draggable="true">${it.blank ? '' : `<span class="fdot" style="background:${FILE_COLORS[it.f % 8]}"></span>`}
          <div class="fbtns">${it.blank ? '' : '<button class="rbtn" data-a="rot" title="Rotar">⟳</button>'}<button class="rbtn" data-a="del" title="Eliminar">✕</button></div>
          <div class="fthumb">${it.blank ? '<span class="help">Página en blanco</span>' : `<img loading="lazy" src="${api.thumb(f.id, it.p, 0.3)}" style="transform:rotate(${it.r}deg)">`}</div>
          <div class="plabel">${i + 1}${it.blank ? '' : ` · ${esc(f.name.slice(0, 14))} p.${it.p + 1}`}</div>
          <button class="insert-btn" title="Insertar página en blanco después">＋</button></div>`);
        $('[data-a=del]', c).onclick = () => { seq.splice(i, 1); draw(); };
        const rb = $('[data-a=rot]', c); if (rb) rb.onclick = () => { it.r = (it.r + 90) % 360; $('img', c).style.transform = `rotate(${it.r}deg)`; };
        $('.insert-btn', c).onclick = () => { seq.splice(i + 1, 0, { blank: true }); draw(); };
        dragSort(c, i, seq, draw);
        g.appendChild(c);
      });
      $('#cnt').textContent = `${seq.length} páginas en el documento final.`;
    };
    $('#srtAsc').onclick = () => { seq.sort((a, b) => (a.blank ? 1 : 0) - (b.blank ? 1 : 0) || a.f - b.f || a.p - b.p); draw(); };
    $('#rev').onclick = () => { seq.reverse(); draw(); };
    $('#reset').onclick = () => { rebuild(); draw(); };
    bindPicker($('#addmore'), $('#dzw'), t, m => { const start = ctx.files.length; ctx.files.push(...m); m.forEach((f, k) => { for (let p = 0; p < (f.pages || 0); p++) seq.push({ f: start + k, p, r: 0 }); }); draw(); });
    draw();
    $('#run').onclick = () => {
      if (!seq.length) return toast('No quedan páginas.', true);
      runTool(t, ctx.files, { pages: seq.map(s => s.blank ? { blank: true } : { f: s.f, p: s.p, r: s.r }) });
    };
  },

  // ------------------------------------------------------------------ HTML A PDF
  htmlLanding(t) {
    app.innerHTML = `<section class="tool-landing"><h1>${esc(t.name)}</h1><p>${esc(t.desc)}</p>
      <div class="dropzone" id="dz" style="max-width:640px;margin:0 auto">
        <div style="display:flex;gap:8px"><input class="input" id="url" placeholder="https://ejemplo.com" style="font-size:18px;padding:14px">
          <button class="btn-big" id="go" style="padding:14px 26px;font-size:18px">Añadir</button></div>
        <div class="drop-hint">o <a href="#" id="pickHtml">sube un archivo .html</a></div></div></section>`;
    const go = () => { const u = $('#url').value.trim(); if (!u) return toast('Escribe una dirección web', true); EXTRAS.html({ tool: t, files: [], url: u }); };
    $('#go').onclick = go; $('#url').onkeydown = e => e.key === 'Enter' && go(); $('#url').focus();
    bindPicker($('#pickHtml'), $('#dz'), t, files => EXTRAS.html({ tool: t, files }));
  },
  html(ctx) {
    const t = ctx.tool, opts = {};
    app.innerHTML = `<div class="workspace"><section class="ws-main"><div class="files"><div class="fcard" style="width:320px">
      <div class="fthumb" style="height:120px"><div class="fileicon" style="background:#E8A21A">HTML</div></div>
      <div class="fname">${esc(ctx.url || ctx.files[0].name)}</div></div></div></section>
      <aside class="ws-side"><h2>${esc(t.name)}</h2><div class="side-body" id="opts"></div>
      <div class="side-foot"><button class="btn-big" id="run">Convertir a PDF <span>➜</span></button></div></aside></div>`;
    renderOptions($('#opts'), t.options, opts);
    $('#run').onclick = () => runTool(t, ctx.files, { ...opts, url: ctx.url });
  },

  // ------------------------------------------------------------------ ESCANEAR
  async scanLanding(t) { EXTRAS.scan({ tool: t, files: [] }); },
  async scan(ctx) {
    const t = ctx.tool, opts = {};
    app.innerHTML = `<div class="workspace"><section class="ws-main" id="dzw">
      <div class="scan-wrap">
        <div class="scan-box"><h3>📷 Cámara de este equipo</h3><video id="vid" autoplay playsinline muted hidden></video>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" id="cam">Activar cámara</button><button class="btn" id="snap" disabled>Capturar página</button></div></div>
        <div class="scan-box"><h3>📱 Desde el móvil</h3><div id="mob"><span class="help">Preparando…</span></div></div>
        <div class="scan-box"><h3>🖼 Desde archivos</h3><p class="help">Fotos o escaneos ya guardados (JPG, PNG…)</p><button class="btn" id="pick">Seleccionar imágenes</button></div>
      </div>
      <h3 style="margin-top:26px">Páginas capturadas</h3><div class="files" id="files"></div></section>
      <aside class="ws-side"><h2>Escanea a PDF</h2><div class="side-body" id="opts"></div>
      <div class="side-foot"><button class="btn-big" id="run">Crear PDF <span>➜</span></button></div></aside></div>`;
    renderOptions($('#opts'), t.options, opts);
    const draw = () => { renderFileCards($('#files'), ctx, true, draw); if (!ctx.files.length) $('#files').innerHTML = '<span class="help">Aún no hay páginas.</span>'; };
    draw();
    bindPicker($('#pick'), $('#dzw'), t, m => { ctx.files.push(...m); draw(); });
    // cámara local
    let stream = null;
    $('#cam').onclick = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } } });
        $('#vid').srcObject = stream; $('#vid').hidden = false; $('#snap').disabled = false; $('#cam').disabled = true;
      } catch (e) { toast('No se pudo acceder a la cámara: ' + e.message, true); }
    };
    $('#snap').onclick = () => {
      const v = $('#vid'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob(async b => { const m = await api.upload([new File([b], `captura_${ctx.files.length + 1}.jpg`, { type: 'image/jpeg' })]); ctx.files.push(...m); draw(); toast('Página capturada'); }, 'image/jpeg', 0.92);
    };
    // móvil
    try {
      const s = await api.json('/api/scan/session', {});
      if (s.lan) {
        $('#mob').innerHTML = `<div class="qr">${s.qr}</div><p class="help">Escanea el código con el móvil (misma red Wi-Fi) o abre:<br><b>${esc(s.url)}</b></p>`;
        let seen = 0;
        const poll = setInterval(async () => {
          if (!$('#mob')) return clearInterval(poll);
          try { const list = await api.json('/api/scan/' + s.session); if (list.length > seen) { ctx.files.push(...list.slice(seen)); seen = list.length; draw(); toast('Nueva página recibida del móvil'); } } catch { clearInterval(poll); }
        }, 2000);
      } else {
        $('#mob').innerHTML = `<p class="help">Para escanear con el móvil, cierra iwantpdf y ábrelo con <b>iniciar-red-local.bat</b>. Así el móvil podrá conectarse por la red Wi-Fi de tu casa (solo dentro de tu red).</p>`;
      }
    } catch { $('#mob').innerHTML = '<span class="help">No disponible.</span>'; }
    $('#run').onclick = () => {
      if (stream) stream.getTracks().forEach(tr => tr.stop());
      if (!ctx.files.length) return toast('Captura o añade al menos una página.', true);
      runTool(t, ctx.files, opts);
    };
  },

  // ------------------------------------------------------------------ FLUJOS DE TRABAJO
  workflowLanding(t) { EXTRAS.workflow({ tool: t, files: [] }); },
  workflow(ctx) {
    const t = ctx.tool;
    let steps = [];
    const saved = () => lsGet('iw_workflows', []);
    app.innerHTML = `<div class="workspace"><section class="ws-main" id="dzw">
      <h2 style="margin-top:0">Crea un flujo de trabajo</h2>
      <p class="help">Encadena herramientas: el resultado de cada paso pasa al siguiente. Guarda el flujo para reutilizarlo cuando quieras.</p>
      <div class="wf-saved" id="saved"></div>
      <div class="wf-steps" id="steps"></div>
      <div style="display:flex;gap:8px;margin-top:14px"><select class="input" id="addSel" style="max-width:320px"><option value="">+ Añadir paso…</option>
        ${CHAINABLE.map(a => `<option value="${a}">${esc(byApi[a].name)}</option>`).join('')}</select></div>
      <h3 style="margin-top:30px">Archivos</h3><div class="files" id="files"></div>
      <button class="btn" id="pick" style="margin-top:12px">Seleccionar archivos PDF</button></section>
      <aside class="ws-side"><h2>Flujo de trabajo</h2><div class="side-body">
        <div class="field"><span class="flabel">Nombre del flujo</span><input class="input" id="wfName" placeholder="Mi flujo"></div>
        <button class="btn" id="save" style="width:100%">Guardar flujo</button>
        <p class="note" style="margin-top:14px">Los flujos se guardan en este navegador.</p></div>
        <div class="side-foot"><button class="btn-big" id="run">Ejecutar flujo <span>➜</span></button></div></aside></div>`;
    const drawSaved = () => {
      const s = saved();
      $('#saved').innerHTML = s.length ? s.map((w, i) => `<span class="chip"><a href="#" data-l="${i}" style="text-decoration:none">▶ ${esc(w.name)}</a><button data-d="${i}">✕</button></span>`).join('') : '';
      $$('[data-l]').forEach(a => a.onclick = e => { e.preventDefault(); const w = saved()[+a.dataset.l]; steps = structuredClone(w.steps); $('#wfName').value = w.name; drawSteps(); });
      $$('#saved [data-d]').forEach(b => b.onclick = () => { const s2 = saved(); s2.splice(+b.dataset.d, 1); lsSet('iw_workflows', s2); drawSaved(); });
    };
    const drawSteps = () => {
      const box = $('#steps'); box.innerHTML = '';
      if (!steps.length) box.innerHTML = '<p class="help">Añade el primer paso con el selector de abajo.</p>';
      steps.forEach((s, i) => {
        const tool = byApi[s.tool];
        if (i) box.appendChild(h('<div class="wf-arrow">↓</div>'));
        const el = h(`<div class="wf-step"><div class="wf-step-head">${toolIcon(tool, 30)}<b>${i + 1}. ${esc(tool.name)}</b>
          <button class="btn small ghost" data-a="up" ${i ? '' : 'disabled'}>↑</button><button class="btn small ghost" data-a="down" ${i < steps.length - 1 ? '' : 'disabled'}>↓</button>
          ${tool.options ? '<button class="btn small" data-a="opt">Opciones</button>' : ''}<button class="btn small ghost" data-a="del">✕</button></div>
          <div class="wf-opts" hidden></div></div>`);
        const ob = $('.wf-opts', el);
        if (tool.options) renderOptions(ob, tool.options, s.options);
        $('[data-a=opt]', el)?.addEventListener('click', () => ob.hidden = !ob.hidden);
        $('[data-a=del]', el).onclick = () => { steps.splice(i, 1); drawSteps(); };
        $('[data-a=up]', el).onclick = () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); };
        $('[data-a=down]', el).onclick = () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; drawSteps(); };
        box.appendChild(el);
      });
    };
    $('#addSel').onchange = e => { if (e.target.value) { steps.push({ tool: e.target.value, options: {} }); e.target.value = ''; drawSteps(); } };
    const drawFiles = () => { renderFileCards($('#files'), ctx, true, drawFiles); if (!ctx.files.length) $('#files').innerHTML = '<span class="help">Sin archivos.</span>'; };
    bindPicker($('#pick'), $('#dzw'), { ...t, multiple: true }, m => { ctx.files.push(...m); drawFiles(); });
    $('#save').onclick = () => {
      if (!steps.length) return toast('El flujo está vacío.', true);
      const name = $('#wfName').value.trim() || 'Flujo ' + (saved().length + 1);
      const s = saved().filter(w => w.name !== name); s.unshift({ name, steps }); lsSet('iw_workflows', s); drawSaved(); toast('Flujo guardado');
    };
    $('#run').onclick = async () => {
      if (!steps.length) return toast('Añade al menos un paso.', true);
      if (!ctx.files.length) return toast('Selecciona archivos PDF.', true);
      for (const s of steps) { const err = validate(byApi[s.tool], s.options); if (err) return toast(`${byApi[s.tool].name}: ${err}`, true); }
      busy(true, 'Ejecutando flujo…');
      try {
        const res = await api.json('/api/workflow', { files: ctx.files.map(f => f.id), steps });
        busy(false); renderResult({ ...t, api: null }, res, {});
      } catch (e) { busy(false); toast(e.message, true, 7000); }
    };
    drawSaved(); drawSteps(); drawFiles();
  },

  // ------------------------------------------------------------------ VISOR DE COMPARACIÓN
  compareView(box, res, prev) {
    const d = res.data, [fa, fb] = prev.files;
    if (d.identical) { box.innerHTML += '<div class="stats"><div class="stat"><b>Idénticos</b><span>No hay diferencias de texto</span></div></div>'; }
    else box.innerHTML += `<div class="stats"><div class="stat"><b>${d.changes.length}</b><span>cambios de texto</span></div>
      <div class="stat"><b style="color:#C0392B">${d.marks_a.length}</b><span>palabras eliminadas/cambiadas</span></div>
      <div class="stat"><b>${d.marks_b.length}</b><span>palabras añadidas/cambiadas</span></div></div>`;
    const col = (f, n, marks, title) => `<div class="cmp-col"><h4>${title}: ${esc(f.name)}</h4>${Array.from({ length: n }, (_, i) =>
      `<div class="cmp-page" data-p="${i}"><img loading="lazy" src="${api.thumb(f.id, i, 1)}">${marks.filter(m => m.page === i).map(m => `<span class="mk ${m.kind}" data-r="${m.rect.join(',')}"></span>`).join('')}</div>`).join('')}</div>`;
    const wrap = h(`<div class="cmp">${col(fa, d.pages_a, d.marks_a, 'Original')}${col(fb, d.pages_b, d.marks_b, 'Nuevo')}
      <div class="cmp-changes"><b>Cambios</b>${d.changes.map(c => `<div class="chg"><b>${c.type}</b> ${c.page_a ? 'p.' + c.page_a : ''}${c.page_b ? ' → p.' + c.page_b : ''}<br>
        ${c.old ? `<span class="o">${esc(c.old)}</span><br>` : ''}${c.new ? `<span class="n">${esc(c.new)}</span>` : ''}</div>`).join('') || '<p class="help">Sin cambios.</p>'}
        ${d.visual_diff_pct?.length ? `<p class="help" style="margin-top:10px">Diferencia visual por página: ${d.visual_diff_pct.map((v, i) => `p.${i + 1}: ${v}%`).join(' · ')}</p>` : ''}</div></div>`);
    box.appendChild(wrap);
    // posicionar marcas cuando cargan las imágenes (coordenadas en puntos -> %)
    const place = async (f, colEl) => {
      const info = await api.json('/api/pagesinfo/' + f.id);
      $$('.cmp-page', colEl).forEach(pg => {
        const p = info.pages[+pg.dataset.p];
        $$('.mk', pg).forEach(m => { const [x0, y0, x1, y1] = m.dataset.r.split(',').map(Number);
          Object.assign(m.style, { left: x0 / p.w * 100 + '%', top: y0 / p.h * 100 + '%', width: (x1 - x0) / p.w * 100 + '%', height: (y1 - y0) / p.h * 100 + '%' }); });
      });
    };
    const cols = $$('.cmp-col', wrap); place(fa, cols[0]); place(fb, cols[1]);
    // desplazamiento sincronizado
    let lock = false;
    cols.forEach((c, i) => c.addEventListener('scroll', () => { if (lock) return; lock = true; const o = cols[1 - i]; o.scrollTop = c.scrollTop / (c.scrollHeight - c.clientHeight || 1) * (o.scrollHeight - o.clientHeight); requestAnimationFrame(() => lock = false); }));
  },
};
