/* iwantpdf web: motor que corre en el navegador y reemplaza al servidor Python.
   Mantiene el mismo contrato que la API local (/api/upload, /api/tool/<x>, /api/render…), así la
   interfaz (app.js, editor.js, extras.js) casi no cambia. Los archivos nunca salen del navegador. */
'use strict';

const IW = (() => {
  const VENDOR = new URL('vendor/', document.baseURI).href;
  const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.webp']);
  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp', '.gif': 'image/gif',
    '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf' };

  // ------------------------------------------------------------------ carga perezosa de librerías
  const scripts = {};
  function loadScript(file) {
    if (!scripts[file]) {
      scripts[file] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = VENDOR + file;
        s.onload = resolve;
        s.onerror = () => { delete scripts[file]; reject(new Error('No se pudo cargar un componente (' + file + '). Revisa tu conexión.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[file];
  }
  const once = fn => { let p; return () => (p = p || fn().catch(e => { p = null; throw e; })); };
  const L = {
    pdfLib: once(async () => { await loadScript('pdf-lib.min.js'); return window.PDFLib; }),
    pdfjs: once(async () => {
      const m = await import(VENDOR + 'pdfjs/pdf.min.mjs');
      m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';
      return m;
    }),
    jszip: once(async () => { await loadScript('jszip.min.js'); return window.JSZip; }),
    tesseract: once(async () => { await loadScript('tesseract.min.js'); return window.Tesseract; }),
    docx: once(async () => { await loadScript('docx.iife.js'); return window.docx; }),
    pptx: once(async () => { await loadScript('pptxgen.bundle.js'); return window.PptxGenJS; }),
    xlsx: once(async () => { await loadScript('xlsx.full.min.js'); return window.XLSX; }),
    mammoth: once(async () => { await loadScript('mammoth.browser.min.js'); return window.mammoth; }),
    html2canvas: once(async () => { await loadScript('html2canvas.min.js'); return window.html2canvas; }),
    qpdf: once(async () => {
      await loadScript('qpdf/qpdf.js');
      const factory = window.Module;
      return factory({ locateFile: f => VENDOR + 'qpdf/' + f, print: () => {}, printErr: s => qpdfErr.push(String(s)) });
    }),
  };
  const qpdfErr = [];

  // ------------------------------------------------------------------ utilidades
  const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const extOf = name => { const m = /\.[^./\\]+$/.exec(name || ''); return m ? m[0].toLowerCase() : ''; };
  const stem = name => (name || 'archivo').replace(/\.[^./\\]+$/, '').slice(0, 80);
  const isImage = inp => IMAGE_EXT.has(inp.ext || extOf(inp.name));
  const isPdf = inp => (inp.ext || extOf(inp.name)) === '.pdf';
  function safeName(name) {
    const n = String(name || 'archivo').normalize('NFC').split(/[\\/]/).pop().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
    return n || 'archivo';
  }
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const toU8 = async d => d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new TextEncoder().encode(String(d));
  const canvasBlob = (c, type = 'image/jpeg', q = 0.92) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo generar la imagen (¿página demasiado grande?).')), type, q));
  const canvasBytes = async (c, type, q) => new Uint8Array(await (await canvasBlob(c, type, q)).arrayBuffer());
  function hexColor(h, def = [0, 0, 0]) {
    if (!h) return def;
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return def;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  async function rgbOf(h, def) { const { rgb } = await L.pdfLib(); const c = hexColor(h, def); return c ? rgb(c[0], c[1], c[2]) : undefined; }

  /** '1-3,5,8-' -> índices 0-based. Vacío/'all' -> todas. */
  function parsePages(spec, n, defaultAll = true) {
    if (spec === undefined || spec === null || spec === '' || spec === 'all' || spec === 'todas') return defaultAll ? range(0, n) : [];
    if (Array.isArray(spec)) return spec.map(Number).filter(i => i >= 0 && i < n);
    const res = [];
    for (const part of String(spec).replace(/\s/g, '').split(',')) {
      if (!part) continue;
      if (part.includes('-')) {
        const [a, b] = part.split('-', 2);
        const ia = a ? parseInt(a, 10) : 1, ib = b ? parseInt(b, 10) : n;
        if (Number.isNaN(ia) || Number.isNaN(ib)) throw new Error(`Rango de páginas no válido: "${part}"`);
        res.push(...range(ia - 1, Math.min(ib, n)));
      } else {
        const i = parseInt(part, 10) - 1;
        if (Number.isNaN(i)) throw new Error(`Página no válida: "${part}"`);
        if (i >= 0 && i < n) res.push(i);
      }
    }
    return res.filter(i => i >= 0 && i < n);
  }

  // ------------------------------------------------------------------ almacén en memoria
  const FILES = new Map();   // id -> { id, name, size, ext, pages, encrypted, damaged?, bytes }
  const RESULTS = new Map(); // rid -> { files: Map(name -> Blob), urls: [] }
  const metaOf = f => { const { bytes, ...m } = f; return m; };

  async function describe(name, bytes) {
    const ext = extOf(name);
    const f = { id: newId(), name: safeName(name), size: bytes.length, ext, pages: null, encrypted: false, bytes };
    if (ext === '.pdf') {
      try {
        const d = await jsOpen(bytes);
        f.pages = d.numPages;
        d.destroy();
      } catch (e) {
        if (e && e.name === 'PasswordException') f.encrypted = true;
        else f.damaged = true;
      }
    } else if (IMAGE_EXT.has(ext)) f.pages = 1;
    FILES.set(f.id, f);
    return f;
  }

  async function upload(fileList, onProgress) {
    const list = [...fileList], out = [];
    const total = list.reduce((a, f) => a + f.size, 0) || 1;
    let done = 0;
    for (const file of list) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      out.push(metaOf(await describe(file.name, bytes)));
      done += file.size;
      onProgress && onProgress(done / total);
    }
    return out;
  }

  function input(id) {
    const f = FILES.get(id);
    if (!f) throw new Error('El archivo ya no está disponible (se recargó la página). Vuelve a seleccionarlo.');
    return f;
  }

  // ------------------------------------------------------------------ pdf.js (vista y texto)
  async function jsOpen(bytes, password) {
    const pdfjs = await L.pdfjs();
    return pdfjs.getDocument({
      data: bytes.slice(), password, isEvalSupported: false,
      cMapUrl: VENDOR + 'pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/',
    }).promise;
  }
  const jsCache = new Map();
  function jsDoc(id) {
    if (!jsCache.has(id)) jsCache.set(id, jsOpen(input(id).bytes).catch(e => { jsCache.delete(id); throw e; }));
    return jsCache.get(id);
  }

  /** Dibuja una página de pdf.js en un canvas. opts.noText: sin texto (fondo para texto editable). */
  async function renderJsPage(page, scale, opts = {}) {
    const pdfjs = await L.pdfjs();
    const vp = page.getViewport({ scale });
    const max = 16000, area = 160e6;
    let s = scale;
    if (vp.width > max || vp.height > max || vp.width * vp.height > area) s = scale * Math.min(max / vp.width, max / vp.height, Math.sqrt(area / (vp.width * vp.height)));
    const v = page.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(v.width)); c.height = Math.max(1, Math.ceil(v.height));
    const ctx = c.getContext('2d', { willReadFrequently: !!opts.read });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (opts.noText) { ctx.fillText = () => {}; ctx.strokeText = () => {}; }
    await page.render({ canvasContext: ctx, viewport: v,
      annotationMode: opts.annots === false ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE }).promise;
    return c;
  }

  // Miniaturas: api.thumb() devuelve un marcador; un observador lo cambia por la imagen renderizada
  // cuando entra en pantalla (la interfaz original pedía /api/render/<id>/<pág>?scale=…).
  const PH = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const thumbUrl = (id, page = 0, scale = 0.35) => `${PH}#iw=${id}:${page}:${scale}`;
  const thumbCache = new Map();
  let thumbQueue = [], thumbBusy = 0;
  async function thumbFor(key) {
    if (thumbCache.has(key)) return thumbCache.get(key);
    const p = (async () => {
      const [id, pg, sc] = key.split(':');
      const f = input(id);
      if (isImage(f)) return URL.createObjectURL(new Blob([f.bytes], { type: MIME[f.ext] || 'image/*' }));
      const doc = await jsDoc(id);
      const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, +pg + 1)));
      const c = await renderJsPage(page, Math.min(4, +sc || 0.35));
      return URL.createObjectURL(await canvasBlob(c, 'image/png'));
    })();
    thumbCache.set(key, p);
    p.catch(() => thumbCache.delete(key));
    return p;
  }
  function pumpThumbs() {
    while (thumbBusy < 2 && thumbQueue.length) {
      const img = thumbQueue.shift();
      const src = img.getAttribute('src') || '';
      const m = /#iw=(.+)$/.exec(src);
      if (!m || !img.isConnected) continue;
      thumbBusy++;
      thumbFor(m[1]).then(u => { if (img.getAttribute('src') === src) img.src = u; })
        .catch(() => { img.alt = '⚠'; })
        .finally(() => { thumbBusy--; pumpThumbs(); });
    }
  }
  const thumbIO = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { thumbIO.unobserve(e.target); thumbQueue.push(e.target); } });
    pumpThumbs();
  }, { rootMargin: '400px' });
  const watchImg = img => { if ((img.getAttribute('src') || '').startsWith(PH + '#iw=')) thumbIO.observe(img); };
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes') { watchImg(m.target); continue; }
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') watchImg(n);
        n.querySelectorAll && n.querySelectorAll('img').forEach(watchImg);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  async function pagesInfo(id) {
    const f = input(id);
    if (isImage(f)) {
      const bm = await decodeImage(f.bytes, f.ext);
      return { pages: [{ w: bm.width * 0.75, h: bm.height * 0.75, rotation: 0 }] };
    }
    const doc = await jsDoc(id);
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const v = p.getViewport({ scale: 1 });
      pages.push({ w: v.width, h: v.height, rotation: p.rotate });
    }
    return { pages };
  }

  // ------------------------------------------------------------------ imágenes
  async function decodeImage(bytes, ext) {
    if (ext === '.tif' || ext === '.tiff') throw new Error('El navegador no puede abrir imágenes TIFF. Conviértelas antes a JPG o PNG.');
    try {
      return await createImageBitmap(new Blob([bytes], { type: MIME[ext] || 'image/*' }), { imageOrientation: 'from-image' });
    } catch {
      throw new Error('No se pudo leer la imagen (formato no compatible o archivo dañado).');
    }
  }
  /** Imagen -> canvas RGB con fondo blanco (como PIL: transparencia sobre blanco, EXIF aplicado). */
  function bitmapCanvas(bm, maxPx = 12000) {
    const k = Math.min(1, maxPx / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bm, 0, 0, c.width, c.height);
    return c;
  }
  function dataUrlBytes(s) {
    const [head, b64] = String(s).split(',', 2);
    const bin = atob(b64 || '');
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return { bytes: u, mime: (/data:([^;,]+)/.exec(head) || [])[1] || '' };
  }
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ------------------------------------------------------------------ qpdf (cifrado, reparación)
  async function qpdf(args, bytes) {
    const q = await L.qpdf();
    qpdfErr.length = 0;
    q.FS.writeFile('/in.pdf', bytes);
    try { q.FS.unlink('/out.pdf'); } catch { /* no existía */ }
    let rc;
    try { rc = q.callMain(args); } catch (e) { rc = typeof e?.status === 'number' ? e.status : 2; qpdfErr.push(String(e?.message || e)); }
    let out = null;
    if (rc === 0 || rc === 3) { try { out = q.FS.readFile('/out.pdf'); } catch { out = null; } }
    try { q.FS.unlink('/in.pdf'); } catch { /* */ }
    try { q.FS.unlink('/out.pdf'); } catch { /* */ }
    return { rc, out, err: qpdfErr.join('\n') };
  }

  // ------------------------------------------------------------------ pdf-lib
  /** Abre un PDF (o imagen convertida a PDF) para editarlo. Quita el cifrado de "solo permisos". */
  async function openLib(inp, password = '') {
    const { PDFDocument } = await L.pdfLib();
    if (isImage(inp)) return imageDoc(inp);
    try {
      return await PDFDocument.load(inp.bytes, { updateMetadata: false });
    } catch (e) {
      if (/encrypted/i.test(e.message)) {
        const r = await qpdf(['--password=' + password, '--decrypt', '/in.pdf', '/out.pdf'], inp.bytes);
        if (!r.out) throw new Error(`${inp.name}: el PDF está protegido con contraseña. Usa primero "Desbloquear PDF".`);
        return PDFDocument.load(r.out, { updateMetadata: false });
      }
      const r = await qpdf(['/in.pdf', '/out.pdf'], inp.bytes).catch(() => ({}));
      if (r.out) {
        try { return await PDFDocument.load(r.out, { updateMetadata: false }); } catch { /* sigue */ }
      }
      throw new Error(`No se pudo abrir ${inp.name}: el PDF está dañado. Prueba con "Reparar PDF".`);
    }
  }
  async function imageDoc(inp) {
    const { PDFDocument } = await L.pdfLib();
    const bm = await decodeImage(inp.bytes, inp.ext || extOf(inp.name));
    const c = bitmapCanvas(bm);
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(await canvasBytes(c, 'image/jpeg', 0.92));
    const w = bm.width * 0.75, h = bm.height * 0.75;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    return doc;
  }
  async function save(doc, opts = {}) {
    if (!opts.keepMeta) { doc.setProducer('iwantpdf'); doc.setModificationDate(new Date()); }
    return doc.save({ useObjectStreams: opts.objectStreams !== false });
  }

  /** Geometría visible de una página: tamaño como se ve (con rotación) y conversión de coordenadas
      "visibles" (puntos, origen arriba a la izquierda, como en el editor) <-> espacio de usuario PDF. */
  function geom(page) {
    const cb = page.getCropBox();
    const r = ((page.getRotation().angle % 360) + 360) % 360;
    const swap = r === 90 || r === 270;
    const W = swap ? cb.height : cb.width, H = swap ? cb.width : cb.height;
    const toUser = (x, y) => {
      switch (r) {
        case 90: return [cb.x + y, cb.y + x];
        case 180: return [cb.x + cb.width - x, cb.y + y];
        case 270: return [cb.x + cb.width - y, cb.y + cb.height - x];
        default: return [cb.x + x, cb.y + cb.height - y];
      }
    };
    const toVis = (ux, uy) => {
      switch (r) {
        case 90: return [uy - cb.y, ux - cb.x];
        case 180: return [cb.x + cb.width - ux, uy - cb.y];
        case 270: return [cb.y + cb.height - uy, cb.x + cb.width - ux];
        default: return [ux - cb.x, cb.y + cb.height - uy];
      }
    };
    const rectToUser = ([x0, y0, x1, y1]) => {
      const a = toUser(x0, y0), b = toUser(x1, y1);
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
    };
    const rectToVis = ({ x, y, width, height }) => {
      const a = toVis(x, y), b = toVis(x + width, y + height);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    return { W, H, r, swap, toUser, toVis, rectToUser, rectToVis, cb };
  }

  // Fuentes: las del sistema de Windows no existen en el navegador; se usan las 14 estándar de PDF.
  const FONT_FAMILY = { 'Times New Roman': 'Times', 'Georgia': 'Times', 'Courier New': 'Courier' };
  const STD = {
    Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  };
  const CSS_FAMILY = { Helvetica: 'Arial, Helvetica, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
  const fontCache = new WeakMap();
  async function stdFont(doc, name = 'Arial', bold = false, italic = false) {
    const { StandardFonts } = await L.pdfLib();
    const fam = FONT_FAMILY[name] || 'Helvetica';
    const key = STD[fam][(bold ? 1 : 0) + (italic ? 2 : 0)];
    let m = fontCache.get(doc);
    if (!m) fontCache.set(doc, m = {});
    if (!m[key]) m[key] = doc.embedFont(StandardFonts[key]);
    const font = await m[key];
    font.__css = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}{size}px ${CSS_FAMILY[fam]}`;
    return font;
  }
  const encCache = new WeakMap();
  function canEncode(font, text) {
    let m = encCache.get(font);
    if (!m) encCache.set(font, m = new Map());
    for (const ch of String(text)) {
      if (ch === '\n') continue;
      if (!m.has(ch)) { try { font.encodeText(ch); m.set(ch, true); } catch { m.set(ch, false); } }
      if (!m.get(ch)) return false;
    }
    return true;
  }
  const cleanText = (font, text) => [...String(text)].map(ch => canEncode(font, ch) ? ch : '?').join('');
  function textWidth(font, text, size) {
    if (canEncode(font, text)) return font.widthOfTextAtSize(text, size);
    const c = textWidth.c || (textWidth.c = document.createElement('canvas').getContext('2d'));
    c.font = font.__css.replace('{size}', size);
    return c.measureText(text).width;
  }

  /** Escribe una línea de texto con su línea base en (x, y) visibles, girada `angle` grados (positivo =
      sube hacia la derecha). Si la fuente estándar no admite algún carácter (chino, árabe, emoji…),
      lo dibuja como imagen con las fuentes del navegador. */
  async function drawLine(doc, page, g, text, x, y, { font, size, color = [0, 0, 0], opacity = 1, angle = 0 }) {
    const { rgb, degrees } = await L.pdfLib();
    if (!text) return;
    const rot = angle + g.r;
    if (canEncode(font, text)) {
      const [ux, uy] = g.toUser(x, y);
      page.drawText(text, { x: ux, y: uy, size, font, color: rgb(...color), opacity, rotate: degrees(rot) });
      return;
    }
    const k = 4;
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    const css = font.__css.replace('{size}', size * k);
    ctx.font = css;
    const w = Math.ceil(ctx.measureText(text).width) + 2, h = Math.ceil(size * 1.25 * k);
    c.width = w; c.height = h;
    ctx.font = css; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgb(${color.map(v => Math.round(v * 255)).join(',')})`;
    ctx.fillText(text, 1, size * 0.95 * k);
    const img = await doc.embedPng(await canvasBytes(c, 'image/png'));
    // esquina inferior izquierda de la imagen, en el sistema del texto (y hacia abajo)
    const dx = 0, dy = size * 0.3, th = angle * Math.PI / 180;
    const vx = x + dx * Math.cos(th) + dy * Math.sin(th), vy = y - dx * Math.sin(th) + dy * Math.cos(th);
    const [ux, uy] = g.toUser(vx, vy);
    page.drawImage(img, { x: ux, y: uy, width: w / k, height: h / k, opacity, rotate: degrees(rot) });
  }

  /** Dibuja con `draw()` y mueve lo dibujado debajo del contenido existente de la página. */
  async function drawUnder(page, draw) {
    const { PDFName, PDFArray } = await L.pdfLib();
    await draw();
    const ref = page.contentStreamRef;
    if (!ref) return;
    const node = page.node;
    const contents = node.normalizedEntries().Contents;
    if (!(contents instanceof PDFArray)) return;
    const arr = contents.asArray();
    const idx = arr.findIndex(x => x === ref);
    if (idx > 0) { contents.remove(idx); contents.insert(0, ref); node.set(PDFName.of('Contents'), contents); }
    page.contentStream = undefined; page.contentStreamRef = undefined; // lo siguiente irá encima
  }

  /** Texto invisible (seleccionable y buscable) — capa de OCR o de páginas convertidas en imagen. */
  async function invisibleText(doc, page, g, words) {
    const P = await L.pdfLib();
    if (!words.length) return;
    const font = await stdFont(doc, 'Arial');
    const key = page.node.newFontDictionary(font.name, font.ref);
    const ops = [P.pushGraphicsState(), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)];
    for (const w of words) {
      const t = cleanText(font, w.text).trim();
      if (!t) continue;
      const size = Math.max(1, w.size);
      const [ux, uy] = g.toUser(w.x0, w.base);
      const tw = font.widthOfTextAtSize(t, size);
      const sc = tw > 0 ? Math.max(1, Math.min(1000, (w.x1 - w.x0) / tw * 100)) : 100;
      ops.push(P.setFontAndSize(key, size), P.PDFOperator.of('Tz', [P.PDFNumber.of(sc)]),
        P.rotateAndSkewTextDegreesAndTranslate(g.r, 0, 0, ux, uy), P.showText(font.encodeText(t)));
    }
    ops.push(P.endText(), P.popGraphicsState());
    page.pushOperators(...ops);
  }

  // ------------------------------------------------------------------ texto con posiciones (pdf.js)
  const fontNameCache = new WeakMap();
  /** Elementos de texto de una página en coordenadas visibles: {str, x0, x1, top, bottom, base, size, bold, italic}. */
  async function textItems(page, { fonts = false } = {}) {
    const tc = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    if (fonts) await page.getOperatorList(); // carga las fuentes para conocer su nombre real
    const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) { if (it.hasEOL && out.length) out[out.length - 1].eol = true; continue; }
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10;
      const th = Math.atan2(t[1], t[0]);
      const [ax, ay] = vp.convertToViewportPoint(t[4], t[5]);
      const [bx, by] = vp.convertToViewportPoint(t[4] + it.width * Math.cos(th), t[5] + it.width * Math.sin(th));
      const vertical = Math.abs(by - ay) > Math.abs(bx - ax) + 0.01;
      let bold = false, italic = false, fname = '';
      if (fonts) {
        try {
          let m = fontNameCache.get(page);
          if (!m) fontNameCache.set(page, m = {});
          if (!(it.fontName in m)) m[it.fontName] = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName)?.name || '') : '';
          fname = m[it.fontName];
        } catch { fname = ''; }
        bold = /bold|black|heavy|semibold|demi/i.test(fname);
        italic = /italic|oblique/i.test(fname);
      }
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      out.push({ str: it.str, x0, x1: vertical ? x0 + size : Math.max(x1, x0 + 0.5), base: ay, top: vertical ? Math.min(ay, by) : ay - size * 0.85,
        bottom: vertical ? Math.max(ay, by) : ay + size * 0.22, size, bold, italic, font: fname, vertical, eol: !!it.hasEOL });
    }
    return out;
  }
  /** Agrupa elementos en líneas (orden de lectura). Cada línea: {text, items, spans, x0,x1,top,bottom,size}. */
  function toLines(items) {
    const hz = items.filter(i => !i.vertical).sort((a, b) => a.base - b.base || a.x0 - b.x0);
    const lines = [];
    for (const it of hz) {
      const ln = lines.find(l => Math.abs(l.base - it.base) < Math.min(l.size, it.size) * 0.45 && it.x0 > l.x1 - it.size * 0.5);
      if (ln) { ln.items.push(it); ln.x1 = Math.max(ln.x1, it.x1); ln.size = Math.max(ln.size, it.size); }
      else lines.push({ base: it.base, size: it.size, x0: it.x0, x1: it.x1, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x0 - b.x0);
      let text = '';
      l.spans = [];
      l.items.forEach((it, k) => {
        if (k) {
          const prev = l.items[k - 1], gap = it.x0 - prev.x1;
          if (gap > it.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
        }
        l.spans.push([text.length, text.length + it.str.length, it]);
        text += it.str;
      });
      l.text = text;
      l.top = Math.min(...l.items.map(i => i.top));
      l.bottom = Math.max(...l.items.map(i => i.bottom));
      l.x0 = Math.min(...l.items.map(i => i.x0));
      l.bold = l.items.every(i => i.bold);
      l.italic = l.items.every(i => i.italic);
    }
    lines.sort((a, b) => a.base - b.base || a.x0 - b.x0);
    // texto vertical (raro): una línea por elemento, al final
    items.filter(i => i.vertical).forEach(it => lines.push({ text: it.str, items: [it], spans: [[0, it.str.length, it]], x0: it.x0, x1: it.x1, top: it.top, bottom: it.bottom, base: it.base, size: it.size }));
    return lines;
  }
  const measureCtx = document.createElement('canvas').getContext('2d');
  /** Rectángulo (visible) aproximado de los caracteres [a, b) de un elemento de texto. */
  function subRect(it, a, b) {
    if (it.vertical || a <= 0 && b >= it.str.length) return [it.x0, it.top, it.x1, it.bottom];
    measureCtx.font = `${it.bold ? 'bold ' : ''}100px Arial, sans-serif`;
    const full = measureCtx.measureText(it.str).width || 1;
    const k = (it.x1 - it.x0) / full;
    const xa = it.x0 + measureCtx.measureText(it.str.slice(0, a)).width * k;
    const xb = it.x0 + measureCtx.measureText(it.str.slice(0, b)).width * k;
    return [xa, it.top, Math.max(xb, xa + 0.5), it.bottom];
  }
  /** Rectángulos de los caracteres [s, e) de una línea (uno por elemento afectado, unidos). */
  function lineRange(line, s, e) {
    let r = null;
    for (const [a, b, it] of line.spans) {
      if (a < e && b > s) {
        const q = subRect(it, Math.max(0, s - a), Math.min(it.str.length, e - a));
        r = r ? [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])] : q;
      }
    }
    return r;
  }
  /** Palabras con rectángulo (para comparar y para capas de texto invisibles). */
  function words(items) {
    const out = [];
    for (const it of items) {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(it.str))) {
        const r = subRect(it, m.index, m.index + m[0].length);
        out.push({ text: m[0], x0: r[0], top: r[1], x1: r[2], bottom: r[3], base: it.base, size: it.size, vertical: it.vertical });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ resultados
  const MIME_OUT = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.zip': 'application/zip', '.txt': 'text/plain;charset=utf-8',
    '.md': 'text/markdown;charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const resultOrder = [];
  async function packageResult(res) {
    const rid = newId();
    const used = new Set(), files = new Map(), items = [], urls = [];
    for (const f of res.files || []) {
      let name = safeName(f.name), i = 1;
      while (used.has(name)) { const e = extOf(f.name); name = `${stem(f.name)} (${i++})${e}`; }
      used.add(name);
      const blob = f.data instanceof Blob ? f.data : new Blob([await toU8(f.data)], { type: MIME_OUT[extOf(name)] || 'application/octet-stream' });
      files.set(name, blob);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      items.push({ name, size: blob.size, url });
    }
    const payload = { id: rid, files: items, data: res.data || {} };
    if (items.length > 1) {
      const JSZip = await L.jszip();
      const z = new JSZip();
      for (const [n, b] of files) z.file(n, b);
      const zb = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const zn = res.zip_name || 'iwantpdf.zip';
      const url = URL.createObjectURL(zb);
      urls.push(url);
      payload.zip = { name: zn, size: zb.size, url };
    }
    RESULTS.set(rid, { files, urls });
    resultOrder.push(rid);
    while (resultOrder.length > 8) { // liberar memoria de resultados antiguos
      const old = RESULTS.get(resultOrder.shift());
      old && old.urls.forEach(u => URL.revokeObjectURL(u));
    }
    return payload;
  }
  async function reuse({ rid, name }) {
    const r = RESULTS.get(rid);
    const b = r && r.files.get(name);
    if (!b) throw new Error('El resultado ya no existe.');
    return metaOf(await describe(name, new Uint8Array(await b.arrayBuffer())));
  }

  // ------------------------------------------------------------------ herramientas y flujos
  const TOOLS = {};
  async function runTool(name, ids, opts) {
    const fn = TOOLS[name];
    if (!fn) throw new Error('Herramienta desconocida: ' + name);
    const inputs = (ids || []).map(input);
    return packageResult(await fn(inputs, opts || {}));
  }
  async function runWorkflow(ids, steps) {
    if (!steps || !steps.length) throw new Error('El flujo de trabajo no tiene pasos.');
    let inputs = (ids || []).map(input);
    const log = [];
    for (let k = 0; k < steps.length; k++) {
      const fn = TOOLS[steps[k].tool];
      if (!fn) throw new Error('Paso desconocido: ' + steps[k].tool);
      const res = await fn(inputs, steps[k].options || {});
      const produced = [];
      for (const f of res.files || []) {
        const bytes = await toU8(f.data);
        produced.push({ name: f.name, ext: extOf(f.name), bytes, size: bytes.length });
      }
      log.push({ step: steps[k].tool, outputs: produced.map(f => f.name) });
      const pdfs = produced.filter(f => f.ext === '.pdf');
      inputs = pdfs.length && k < steps.length - 1 ? pdfs : produced;
    }
    return packageResult({ files: inputs.map(f => ({ name: f.name, data: f.bytes })), data: { log }, zip_name: 'iwantpdf_flujo.zip' });
  }

  // ------------------------------------------------------------------ ajustes / capacidades
  const capabilities = () => ({
    web: true, office: { com: false, libreoffice: false, web: true },
    ocr: { windows: false, tesseract: true, languages: ['es-ES', 'en-US', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT'] },
    ai: { configured: false }, lan: false,
  });

  /** Sustituye a fetch('/api/...') de la versión local. */
  async function request(url, body) {
    const path = String(url).split('?')[0];
    let m;
    if (path === '/api/capabilities') return capabilities();
    if ((m = /^\/api\/pagesinfo\/([0-9a-f]+)$/.exec(path))) return pagesInfo(m[1]);
    if (path === '/api/reuse') return reuse(body || {});
    if ((m = /^\/api\/tool\/(\w+)$/.exec(path))) return runTool(m[1], body?.files, body?.options);
    if (path === '/api/workflow') return runWorkflow(body?.files, body?.steps);
    if (path === '/api/scan/session') return { session: null, url: null, qr: null, lan: false, web: true };
    if (/^\/api\/file\/([0-9a-f]+)$/.test(path)) return metaOf(input(path.split('/').pop()));
    throw new Error('Operación no disponible en la versión web: ' + path);
  }

  return {
    VENDOR, L, upload, request, thumb: thumbUrl, TOOLS,
    // utilidades para los módulos de herramientas
    u: { extOf, stem, isImage, isPdf, range, toU8, canvasBlob, canvasBytes, hexColor, rgbOf, parsePages, jsOpen, renderJsPage,
      decodeImage, bitmapCanvas, dataUrlBytes, b64, qpdf, openLib, save, geom, stdFont, canEncode, cleanText, textWidth, drawLine,
      drawUnder, invisibleText, textItems, toLines, lineRange, subRect, words, MIME },
  };
})();
