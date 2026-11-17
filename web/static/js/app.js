/* iwantpdf - interfaz principal */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const app = $('#app');
let CAPS = { office: {}, ocr: { languages: [] }, ai: {}, lan: false };

// ----------------------------------------------------------------- utilidades de UI
function toast(msg, err = false, ms = 4200) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms);
}
function busy(on, msg = 'Procesando…') { $('#overlay').hidden = !on; $('#overlayMsg').textContent = msg; }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento no disponible */ } }

// ----------------------------------------------------------------- API
// Versión web: en vez de un servidor local, el motor IW procesa todo en este navegador.
const api = {
  upload(fileList, onProgress) { return IW.upload(fileList, onProgress); },
  json(url, body) { return IW.request(url, body); },
  tool(name, files, options) { return api.json('/api/tool/' + name, { files, options }); },
  thumb(id, page = 0, scale = 0.35) { return IW.thumb(id, page, scale); },
};

// ----------------------------------------------------------------- cabecera
function buildMenus() {
  const link = t => `<a href="#/${t.slug}">${toolIcon(t, 22)}<span>${esc(t.name)}</span></a>`;
  $('.dd-convert').innerHTML =
    `<div class="dd-col"><h6>Convertir a PDF</h6>${TOOLS.filter(t => t.cat === 'toPdf').map(link).join('')}</div>
     <div class="dd-col"><h6>Convertir desde PDF</h6>${TOOLS.filter(t => t.cat === 'fromPdf').map(link).join('')}</div>`;
  const groups = [['organize', 'optimize'], ['toPdf', 'fromPdf'], ['edit', 'workflow'], ['security']];
  $('.dd-all').innerHTML = groups.map(g => `<div class="dd-col">${g.map(c =>
    `<h6>${CAT[c].name}</h6>${TOOLS.filter(t => t.cat === c).map(link).join('')}`).join('')}</div>`).join('');
  $('#btnMenu').onclick = () => $('.mainnav').classList.toggle('open');
  $$('.mainnav a').forEach(a => a.addEventListener('click', () => { $('.mainnav').classList.remove('open'); document.activeElement.blur(); }));
  $('#btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; lsSet('theme', next);
  };
}

// ----------------------------------------------------------------- portada
function renderHome() {
  document.title = 'iwantpdf | Herramientas PDF en tu navegador';
  const filter = lsGet('filter', 'all');
  app.innerHTML = `
    <section class="hero">
      <h1>Tus PDF, resueltos sin complicaciones</h1>
      <p>Unir, dividir, comprimir, convertir, editar, firmar y proteger PDF. Todo se procesa en tu navegador: tus archivos no se suben a ningún servidor.</p>
    </section>
    <div class="filters">${FILTERS.map(([k, n]) => `<button class="pill${k === filter ? ' active' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
    <div class="grid" id="grid"></div>
    <div class="extras">
      <div class="extra"><h4>100 % en tu navegador</h4><p>Tus archivos no salen de este dispositivo: no hay servidor que los reciba ni los guarde.</p></div>
      <div class="extra"><h4>Sin límites</h4><p>Sin cuentas, sin número de tareas por hora y sin marcas de agua añadidas. El límite lo pone la memoria de tu equipo.</p></div>
      <div class="extra"><h4>Encadena herramientas</h4><p>Al terminar puedes seguir con otra herramienta, o crear un flujo de trabajo reutilizable.</p></div>
    </div>`;
  const draw = f => {
    const cats = FILTER_CATS[f];
    $('#grid').innerHTML = TOOLS.filter(t => !cats || cats.includes(t.cat)).map(t => `
      <a class="card${t.featured ? ' featured' : ''}" href="#/${t.slug}">
        ${t.badge ? `<span class="badge">${t.badge}</span>` : ''}${toolIcon(t)}
        <h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p></a>`).join('');
  };
  draw(filter);
  $$('.pill').forEach(b => b.onclick = () => {
    $$('.pill').forEach(x => x.classList.toggle('active', x === b)); lsSet('filter', b.dataset.f); draw(b.dataset.f);
  });
}

// ----------------------------------------------------------------- página de herramienta
function needsWarning(t) {
  if (t.api === 'ppt_to_pdf')
    return 'PowerPoint a PDF no está disponible en la versión web: el navegador no puede abrir presentaciones.';
  if (t.api === 'word_to_pdf')
    return 'En la versión web se convierten archivos .docx y .txt. El PDF conserva el texto y el formato básico (no el diseño exacto de Word) y sus páginas son imágenes.';
  if (t.api === 'excel_to_pdf')
    return 'En la versión web las hojas se convierten como imagen de la tabla, con formato básico.';
  if (t.api === 'ocr')
    return 'La primera vez se descargan los datos del idioma (unos MB). El reconocimiento puede tardar en documentos largos.';
  return '';
}

function renderTool(t, preset) {
  document.title = `${t.name} | iwantpdf`;
  if (preset && preset.length) return openWorkspace(t, preset);
  if (t.custom === 'html') return EXTRAS.htmlLanding(t);
  if (t.custom === 'scan') return EXTRAS.scanLanding(t);
  if (t.custom === 'workflow') return EXTRAS.workflowLanding(t);
  const warn = needsWarning(t);
  const kind = t.accept === IMAGES ? 'imágenes' : t.accept.includes('.doc') ? 'archivos WORD' : t.accept.includes('.ppt') ? 'archivos POWERPOINT'
    : t.accept.includes('.xls') ? 'archivos EXCEL' : t.multiple ? 'archivos PDF' : 'archivo PDF';
  app.innerHTML = `
    <section class="tool-landing">
      <h1>${esc(t.name)}</h1><p>${esc(t.desc)}</p>
      <div class="dropzone" id="dz">
        <button class="btn-big" id="pick">Seleccionar ${kind}</button>
        <div class="drop-hint">o arrastra y suelta ${t.multiple ? 'los archivos' : 'el archivo'} aquí</div>
      </div>
      ${warn ? `<div class="warnbox">${esc(warn)}</div>` : ''}
    </section>`;
  bindPicker($('#pick'), $('#dz'), t, files => openWorkspace(t, files));
}

function bindPicker(btn, zone, t, done) {
  const inp = h(`<input type="file" hidden ${t.multiple ? 'multiple' : ''} accept="${t.accept}">`);
  document.body.appendChild(inp);
  btn.onclick = () => inp.click();
  const go = async files => {
    if (!files.length) return;
    try {
      busy(true, 'Subiendo… 0 %');
      const metas = await api.upload(files, p => busy(true, `Subiendo… ${Math.round(p * 100)} %`));
      busy(false); inp.remove(); done(metas);
    } catch (e) { busy(false); toast(e.message, true); }
  };
  inp.onchange = () => go(inp.files);
  if (zone) {
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', e => go(t.multiple ? e.dataTransfer.files : [...e.dataTransfer.files].slice(0, 1)));
  }
}

// ----------------------------------------------------------------- espacio de trabajo
function openWorkspace(t, files) {
  const enc = files.filter(f => f.encrypted);
  if (enc.length && !['unlock', 'repair'].includes(t.api)) {
    toast('Algún PDF está protegido con contraseña. Usa primero "Desbloquear PDF".', true, 6000);
  }
  const ctx = { tool: t, files: [...files], opts: {} };
  if (t.custom && EXTRAS[t.custom]) return EXTRAS[t.custom](ctx);
  if (t.custom === 'editor') return EDITOR.open(ctx);
  app.innerHTML = `
    <div class="workspace">
      <section class="ws-main" id="dzw">
        ${t.hint ? `<p class="ws-hint">${esc(t.hint)}</p>` : ''}
        <div class="files" id="files"></div>
        ${t.multiple ? '<button class="addmore" id="addmore" title="Añadir más archivos">+</button>' : ''}
      </section>
      <aside class="ws-side">
        <h2>${esc(t.name)}</h2>
        <div class="side-body" id="opts"></div>
        <div class="side-foot"><button class="btn-big" id="run">${esc(t.action || t.name)} <span>➜</span></button></div>
      </aside>
    </div>`;
  const drawFiles = () => renderFileCards($('#files'), ctx, t.sortable, drawFiles);
  drawFiles();
  if (t.multiple) bindPicker($('#addmore'), $('#dzw'), t, metas => { ctx.files.push(...metas); drawFiles(); });
  const warn = needsWarning(t);
  if (warn) $('#opts').appendChild(h(`<div class="warnbox" style="margin:0 0 14px">${esc(warn)}</div>`));
  if (t.options) renderOptions($('#opts'), t.options, ctx.opts);
  else if (!warn) $('#opts').appendChild(h(`<p class="note">${t.sortable ? 'Ordena los archivos arrastrándolos y pulsa el botón.' : 'No hay opciones adicionales. Pulsa el botón para continuar.'}</p>`));
  $('#run').onclick = () => {
    if (t.min && ctx.files.length < t.min) return toast(`Selecciona al menos ${t.min} archivos.`, true);
    if (t.max && ctx.files.length > t.max) return toast(`Selecciona como máximo ${t.max} archivos.`, true);
    const err = validate(t, ctx.opts); if (err) return toast(err, true);
    runTool(t, ctx.files, ctx.opts);
  };
}

function validate(t, o) {
  if (t.api === 'protect') {
    if (!o.password) return 'Escribe una contraseña.';
    if (o.password !== o.confirm) return 'Las contraseñas no coinciden.';
  }
  if (t.api === 'watermark' && o.type === 'image' && !o.image) return 'Elige una imagen.';
  if (t.api === 'split' && o.mode === 'select' && !o.pages) return 'Indica las páginas a extraer.';
  return '';
}

function fileThumb(f) {
  const ext = (f.ext || '').replace('.', '').toUpperCase();
  if (f.pages && !f.encrypted && !f.damaged) return `<img loading="lazy" src="${api.thumb(f.id)}" alt="">`;
  const col = { DOC: '#2B579A', DOCX: '#2B579A', XLS: '#217346', XLSX: '#217346', CSV: '#217346', PPT: '#D24726', PPTX: '#D24726', HTML: '#E8A21A' }[ext] || '#888';
  return `<div class="fileicon" style="background:${col}">${f.encrypted ? '🔒' : esc(ext || '?')}</div>`;
}

function renderFileCards(box, ctx, sortable, redraw) {
  box.innerHTML = '';
  ctx.files.forEach((f, i) => {
    const c = h(`<div class="fcard${sortable ? ' sortable' : ''}" draggable="${!!sortable}">
      <div class="fbtns"><button class="rbtn" title="Quitar">✕</button></div>
      <div class="fthumb">${fileThumb(f)}</div>
      <div class="fname">${esc(f.name)}</div>
      <div class="fmeta">${fmtSize(f.size)}${f.pages ? ' · ' + f.pages + (f.pages === 1 ? ' pág.' : ' págs.') : ''}${f.encrypted ? ' · protegido' : ''}</div></div>`);
    $('.rbtn', c).onclick = () => { ctx.files.splice(i, 1); redraw(); if (!ctx.files.length) renderTool(ctx.tool); };
    if (sortable) dragSort(c, i, ctx.files, redraw);
    box.appendChild(c);
  });
}

let dragIdx = null;
function dragSort(el, i, arr, redraw) {
  el.addEventListener('dragstart', e => { dragIdx = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
    if (dragIdx === null || dragIdx === i) return;
    const [m] = arr.splice(dragIdx, 1); arr.splice(i, 0, m); dragIdx = null; redraw();
  });
}

// ----------------------------------------------------------------- formulario de opciones
function renderOptions(box, schema, opts) {
  const rows = [];
  schema.forEach(f => {
    if (opts[f.key] === undefined && f.default !== undefined) opts[f.key] = f.default;
  });
  const update = () => rows.forEach(([f, el]) => { el.hidden = f.show ? !f.show(opts) : false; });
  let half = null;
  schema.forEach(f => {
    const el = renderField(f, opts, update);
    if (f.half) {
      if (!half) { half = h('<div class="fields-row"></div>'); box.appendChild(half); }
      half.appendChild(el); if (half.children.length === 2) half = null;
    } else { half = null; box.appendChild(el); }
    rows.push([f, el]);
  });
  update();
  return update;
}

function renderField(f, opts, onChange) {
  const set = v => { opts[f.key] = v; onChange(); };
  const wrap = h(`<div class="field"></div>`);
  const label = f.label ? `<span class="flabel">${esc(f.label)}</span>` : '';
  switch (f.type) {
    case 'check': {
      const el = h(`<label class="check"><input type="checkbox" ${opts[f.key] ? 'checked' : ''}><span>${esc(f.label)}</span></label>`);
      $('input', el).onchange = e => set(e.target.checked);
      wrap.appendChild(el); break;
    }
    case 'cards': {
      wrap.innerHTML = label + `<div class="cards${f.vertical ? ' vertical' : ''}">${f.choices.map(([v, n, d]) =>
        `<div class="copt${opts[f.key] === v ? ' sel' : ''}" data-v="${v}"><b>${esc(n)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>`).join('')}</div>`;
      $$('.copt', wrap).forEach(c => c.onclick = () => { $$('.copt', wrap).forEach(x => x.classList.toggle('sel', x === c)); set(c.dataset.v); });
      break;
    }
    case 'select': {
      let choices = f.choices;
      if (choices === 'ocrLangs') {
        const names = { 'es-ES': 'Español (España)', 'es-MX': 'Español (México)', 'en-US': 'Inglés (EE. UU.)', 'en-GB': 'Inglés (R. U.)', 'pt-BR': 'Portugués (Brasil)', 'fr-FR': 'Francés', 'de-DE': 'Alemán', 'it-IT': 'Italiano' };
        choices = (CAPS.ocr.languages || []).map(l => [l, names[l] || l]);
        if (!opts[f.key] && choices.length) opts[f.key] = choices[0][0];
      }
      wrap.innerHTML = label + `<select class="input">${choices.map(([v, n]) => `<option value="${esc(v)}" ${String(opts[f.key]) === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      $('select', wrap).onchange = e => set(e.target.value); break;
    }
    case 'combo': {
      const id = 'dl' + Math.random().toString(36).slice(2);
      wrap.innerHTML = label + `<input class="input" list="${id}" value="${esc(opts[f.key] ?? '')}"><datalist id="${id}">${f.choices.map(c => `<option value="${esc(c)}">`).join('')}</datalist>${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}`;
      $('input', wrap).oninput = e => set(e.target.value); break;
    }
    case 'number': case 'text': case 'password': case 'color': {
      const tp = f.type;
      wrap.innerHTML = label + `<input class="input" type="${tp}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''}
        placeholder="${esc(f.placeholder || '')}" value="${esc(opts[f.key] ?? '')}" ${tp === 'password' ? 'autocomplete="new-password"' : ''}>${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}`;
      $('input', wrap).oninput = e => set(tp === 'number' ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value); break;
    }
    case 'textarea':
      wrap.innerHTML = label + `<textarea class="input">${esc(opts[f.key] ?? '')}</textarea>`;
      $('textarea', wrap).oninput = e => set(e.target.value); break;
    case 'range': {
      wrap.innerHTML = `<span class="flabel">${esc(f.label)}: <b>${opts[f.key]}</b></span><input type="range" min="${f.min}" max="${f.max}" value="${opts[f.key]}">`;
      $('input', wrap).oninput = e => { $('b', wrap).textContent = e.target.value; set(+e.target.value); }; break;
    }
    case 'pos': {
      const six = f.positions.length === 6;
      const cells = six ? [...f.positions.slice(0, 3), 'gap', ...f.positions.slice(3)] : f.positions;
      wrap.innerHTML = label + `<div class="posgrid${six ? ' six' : ''}">${cells.map(p => p === 'gap' ? '<div class="gap"></div>' :
        `<button type="button" data-p="${p}" class="${opts[f.key] === p ? 'sel' : ''}" title="${p}"></button>`).join('')}</div>`;
      $$('button', wrap).forEach(b => b.onclick = () => { $$('button', wrap).forEach(x => x.classList.toggle('sel', x === b)); set(b.dataset.p); });
      break;
    }
    case 'image': {
      wrap.innerHTML = label + `<div class="imgpick"><button class="btn" type="button">Elegir imagen…</button>${opts[f.key] ? `<img src="${opts[f.key]}">` : ''}</div>`;
      const inp = h('<input type="file" accept="image/*" hidden>'); wrap.appendChild(inp);
      $('button', wrap).onclick = () => inp.click();
      inp.onchange = () => { const r = new FileReader(); r.onload = () => { set(r.result); $('.imgpick img', wrap)?.remove(); $('.imgpick', wrap).appendChild(h(`<img src="${r.result}">`)); }; r.readAsDataURL(inp.files[0]); };
      break;
    }
    case 'perms': {
      opts[f.key] = opts[f.key] || { print: true, copy: true, modify: true, annotate: true, forms: true };
      const P = [['print', 'Imprimir'], ['copy', 'Copiar texto e imágenes'], ['modify', 'Modificar el documento'], ['annotate', 'Añadir comentarios'], ['forms', 'Rellenar formularios']];
      wrap.innerHTML = label + P.map(([k, n]) => `<label class="check"><input type="checkbox" data-k="${k}" ${opts[f.key][k] ? 'checked' : ''}><span>${n}</span></label>`).join('');
      $$('input', wrap).forEach(i => i.onchange = () => { opts[f.key][i.dataset.k] = i.checked; onChange(); });
      break;
    }
    case 'ranges': {
      opts[f.key] = opts[f.key] || [{ from: 1, to: 1 }];
      const draw = () => {
        wrap.innerHTML = label + `<div class="rangelist">${opts[f.key].map((r, i) => `<div class="rrow">Rango ${i + 1}: de
          <input class="input" type="number" min="1" data-i="${i}" data-k="from" value="${r.from}"> a
          <input class="input" type="number" min="1" data-i="${i}" data-k="to" value="${r.to}">
          ${opts[f.key].length > 1 ? `<button class="btn small ghost" data-del="${i}">✕</button>` : ''}</div>`).join('')}</div>
          <button class="btn small" type="button" data-add>+ Añadir rango</button>`;
        $$('input', wrap).forEach(inp => inp.oninput = () => { opts[f.key][+inp.dataset.i][inp.dataset.k] = +inp.value; });
        $$('[data-del]', wrap).forEach(b => b.onclick = () => { opts[f.key].splice(+b.dataset.del, 1); draw(); });
        $('[data-add]', wrap).onclick = () => { const l = opts[f.key].at(-1); opts[f.key].push({ from: l.to + 1, to: l.to + 1 }); draw(); };
      };
      draw(); break;
    }
  }
  return wrap;
}

// ----------------------------------------------------------------- ejecutar y resultado
async function runTool(t, files, options, apiName) {
  busy(true, `${t.action || t.name}…`);
  try {
    const res = await api.tool(apiName || t.api, files.map(f => f.id), options);
    busy(false); renderResult(t, res, { files, options });
  } catch (e) { busy(false); toast(e.message, true, 7000); }
}

const DONE_TITLES = {
  merge: '¡Los PDF se han unido!', split: '¡El PDF se ha dividido!', compress: '¡Los PDF se han comprimido!',
  pdf_to_word: '¡Convertido a Word!', pdf_to_ppt: '¡Convertido a PowerPoint!', pdf_to_excel: '¡Convertido a Excel!',
  word_to_pdf: '¡Convertido a PDF!', excel_to_pdf: '¡Convertido a PDF!', html_to_pdf: '¡Página convertida a PDF!',
  edit: '¡PDF editado!', sign: '¡PDF firmado!', watermark: '¡Marca de agua añadida!', rotate: '¡PDF rotado!', unlock: '¡PDF desbloqueado!',
  protect: '¡PDF protegido!', organize: '¡PDF ordenado!', pdfa: '¡Convertido a PDF/A!', repair: '¡PDF reparado!',
  page_numbers: '¡Números de página añadidos!', scan_to_pdf: '¡Escaneo convertido a PDF!', ocr: '¡OCR aplicado!',
  compare: 'Resultado de la comparación', redact: '¡PDF censurado!', crop: '¡PDF recortado!', forms: '¡Formulario guardado!',
  summarize: 'Resumen', translate: '¡PDF traducido!', pdf_to_markdown: '¡Convertido a Markdown!', pdf_to_jpg: '¡Imágenes listas!', jpg_to_pdf: '¡Imágenes convertidas a PDF!',
};

function renderResult(t, res, prev) {
  const main = res.zip || res.files[0];
  const d = res.data || {};
  const apiName = t.api || 'workflow';
  app.innerHTML = `<section class="result">
    <h1>${DONE_TITLES[apiName] || '¡Listo!'}</h1>
    ${main ? `<div class="dl-row"><a class="btn-big btn-dl" href="${main.url}" download="${esc(main.name)}">⬇ Descargar ${res.zip ? 'todo (ZIP)' : esc(shortExt(main.name))}</a>
      ${main.name.endsWith('.pdf') ? `<a class="btn" href="${main.url}" target="_blank" rel="noopener">Ver</a>` : ''}</div>` : ''}
    ${res.files.length > 1 ? `<div class="filelist">${res.files.map(f => `<a href="${f.url}" download="${esc(f.name)}"><span>${esc(f.name)}</span><small>${fmtSize(f.size)}</small></a>`).join('')}</div>`
      : main ? `<p class="drop-hint">${esc(main.name)} · ${fmtSize(main.size)}</p>` : ''}
    <div id="extra"></div>
    <div class="next" id="next"></div>
    <div class="restart"><button class="btn" id="again">↺ Volver a empezar</button> <a class="btn ghost" href="#/">Todas las herramientas</a></div>
  </section>`;
  $('#again').onclick = () => renderTool(t);
  const ex = $('#extra');
  if (d.stats) {
    const b = d.stats.reduce((a, s) => a + s.before, 0), a = d.stats.reduce((x, s) => x + s.after, 0);
    const pct = b ? Math.round(100 * (1 - a / b)) : 0;
    ex.innerHTML = `<div class="stats"><div class="stat"><b>${pct} %</b><span>de ahorro</span></div>
      <div class="stat"><b style="color:var(--text)">${fmtSize(b)} → ${fmtSize(a)}</b><span>tamaño</span></div></div>
      ${pct <= 0 ? '<p class="drop-hint">Este PDF ya estaba optimizado; se mantiene el original.</p>' : ''}`;
  }
  if (d.count !== undefined) ex.innerHTML += `<p class="drop-hint">${d.count} zonas censuradas de forma permanente.</p>`;
  if (d.notes?.length) ex.innerHTML += `<div class="preview">${d.notes.map(esc).join('<br>')}</div>`;
  if (d.warnings?.length) ex.innerHTML += `<div class="warnbox">${d.warnings.map(esc).join('<br>')}</div>`;
  if (d.engine) ex.innerHTML += `<p class="drop-hint">Generado con: ${esc(d.engine)}</p>`;
  if (d.preview) ex.innerHTML += `<div class="preview">${apiName === 'summarize' || apiName === 'pdf_to_markdown' ? mdToHtml(d.preview) : `<pre>${esc(d.preview)}</pre>`}</div>`;
  if (d.log) ex.innerHTML += `<div class="preview">${d.log.map((l, i) => `<div>${i + 1}. <b>${esc(byApi[l.step]?.name || l.step)}</b> → ${esc(l.outputs.join(', '))}</div>`).join('')}</div>`;
  if (apiName === 'compare') EXTRAS.compareView(ex, res, prev);
  // continuar con otra herramienta
  const pdfs = res.files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length && apiName !== 'compare') {
    $('#next').innerHTML = `<h3>Continuar con…</h3><div class="next-list">${NEXT_TOOLS.filter(a => a !== apiName).map(a =>
      `<button data-a="${a}">${toolIcon(byApi[a], 26)}${esc(byApi[a].name)}</button>`).join('')}</div>`;
    $$('#next button').forEach(b => b.onclick = async () => {
      const nt = byApi[b.dataset.a];
      const list = nt.multiple ? pdfs : pdfs.slice(0, 1);
      try {
        const metas = await Promise.all(list.map(f => api.json('/api/reuse', { rid: res.id, name: f.name })));
        location.hash = '#/' + nt.slug; pendingPreset = metas;
      } catch (e) { toast(e.message, true); }
    });
  }
}
const shortExt = n => { const e = n.split('.').pop().toUpperCase(); return e === 'PDF' ? 'PDF' : e; };

function mdToHtml(md) {
  const lines = esc(md).split('\n'); let out = '', inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(\W|$)/g, '$1<i>$2</i>$3').replace(/`(.+?)`/g, '<code>$1</code>');
    const m = l.match(/^(#{1,6})\s+(.*)/), li = l.match(/^\s*[-*+]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (m) out += `<h${Math.min(6, m[1].length + 1)}>${m[2]}</h${Math.min(6, m[1].length + 1)}>`;
    else if (l.trim().startsWith('|')) out += `<div style="font-family:monospace;white-space:pre">${l}</div>`;
    else if (l.trim()) out += `<p>${l}</p>`;
  }
  return out + (inList ? '</ul>' : '');
}

// ----------------------------------------------------------------- router
let pendingPreset = null;
function route() {
  const slug = location.hash.replace(/^#\/?/, '').split('?')[0];
  window.scrollTo(0, 0);
  document.body.classList.toggle('home', !slug);
  const preset = pendingPreset; pendingPreset = null;
  if (!slug) return renderHome();
  const t = bySlug[slug];
  if (!t) return renderHome();
  renderTool(t, preset);
}

(async function init() {
  const th = lsGet('theme', null); if (th) document.documentElement.dataset.theme = th;
  buildMenus();
  try { CAPS = await api.json('/api/capabilities'); } catch { /* el servidor responderá más tarde */ }
  window.addEventListener('hashchange', route);
  route();
})();
