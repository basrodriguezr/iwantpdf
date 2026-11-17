/* iwantpdf web: conversiones de formato y OCR (equivalentes a core/convert.py y core/ocr.py). */
'use strict';
(() => {
  const { L, TOOLS: T, u } = IW;
  const { stem, openLib, save, geom } = u;
  const pdf = (name, data) => ({ name, data });

  // =================================================================== HTML -> PDF (render en el navegador)
  const PAPER_PT = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A3: [841.89, 1190.55] };

  /** Renderiza HTML en un iframe aislado (sin scripts) y lo pagina como imágenes en un PDF. */
  async function htmlToPdf(html, o = {}) {
    const html2canvas = await L.html2canvas();
    const { PDFDocument } = await L.pdfLib();
    const widthPx = o.widthPx || 794;
    const ifr = document.createElement('iframe');
    ifr.setAttribute('sandbox', 'allow-same-origin');
    Object.assign(ifr.style, { position: 'fixed', left: '-20000px', top: '0', width: widthPx + 'px', height: '1200px', border: '0', background: '#fff' });
    document.body.appendChild(ifr);
    try {
      await new Promise(res => { ifr.onload = res; ifr.srcdoc = html; });
      const d = ifr.contentDocument;
      if (o.blockPopups) {
        d.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=gdpr i],[id*=gdpr i],[aria-modal=true]').forEach(e => {
          const s = ifr.contentWindow.getComputedStyle(e);
          if (s.position === 'fixed' || s.position === 'sticky' || e.getAttribute('aria-modal')) e.remove();
        });
      }
      try { await d.fonts.ready; } catch { /* sin API de fuentes */ }
      await Promise.all([...d.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 4000); })));
      let contentW = widthPx;
      if (o.fitWidth) contentW = Math.max(widthPx, d.documentElement.scrollWidth);
      ifr.style.width = contentW + 'px';
      ifr.style.height = '10px'; // medir el contenido, no el alto del iframe
      const height = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0, 50);
      ifr.style.height = height + 'px';
      const scale = 2;
      const canvas = await html2canvas(d.documentElement, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
        width: contentW, height, windowWidth: contentW, windowHeight: height });
      const doc = await PDFDocument.create();
      const m = o.marginPt || 0;
      if (o.onePage) {
        const pw = contentW * 0.75 + 2 * m, ph = Math.min(14400, height * 0.75 + 2 * m);
        const img = await doc.embedJpg(await u.canvasBytes(canvas, 'image/jpeg', 0.9));
        doc.addPage([pw, ph]).drawImage(img, { x: m, y: ph - m - height * 0.75, width: contentW * 0.75, height: height * 0.75 });
        return doc;
      }
      let [pw, ph] = PAPER_PT[o.pageSize] || PAPER_PT.A4;
      if (o.landscape) [pw, ph] = [ph, pw];
      const k = (pw - 2 * m) / (canvas.width);            // pt por píxel del canvas
      const sliceH = Math.floor((ph - 2 * m) / k);         // píxeles de canvas por página
      const cx = canvas.getContext('2d', { willReadFrequently: true });
      const whiteRow = y => {
        const row = cx.getImageData(0, y, canvas.width, 1).data;
        for (let i = 0; i < row.length; i += 8) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) return false;
        return true;
      };
      let y = 0;
      while (y < canvas.height) {
        let end = Math.min(canvas.height, y + sliceH);
        if (end < canvas.height) { // cortar en una fila en blanco para no partir líneas de texto
          for (let t = end; t > y + sliceH * 0.75; t -= 2) if (whiteRow(t)) { end = t; break; }
        }
        const part = document.createElement('canvas');
        part.width = canvas.width; part.height = end - y;
        part.getContext('2d').drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
        const img = await doc.embedJpg(await u.canvasBytes(part, 'image/jpeg', 0.85));
        const h = (end - y) * k;
        doc.addPage([pw, ph]).drawImage(img, { x: m, y: ph - m - h, width: pw - 2 * m, height: h });
        y = end;
      }
      return doc;
    } finally {
      ifr.remove();
    }
  }
  const BASE_CSS = `body{font-family:Calibri,Carlito,Arial,sans-serif;font-size:14.5px;line-height:1.4;color:#000;margin:0;padding:0 2px;background:#fff}
    img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:3px 6px;vertical-align:top}
    h1{font-size:26px}h2{font-size:21px}h3{font-size:18px}p{margin:0 0 9px}`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  T.word_to_pdf = async inputs => {
    const files = [];
    for (const inp of inputs) {
      let body;
      if (inp.ext === '.docx') {
        const mammoth = await L.mammoth();
        const r = await mammoth.convertToHtml({ arrayBuffer: inp.bytes.slice().buffer });
        body = r.value;
      } else if (inp.ext === '.txt') {
        body = `<pre style="white-space:pre-wrap;font-family:Consolas,monospace;font-size:13px">${esc(new TextDecoder().decode(inp.bytes))}</pre>`;
      } else throw new Error(`${inp.name}: en la versión web solo se convierten archivos .docx y .txt.`);
      const doc = await htmlToPdf(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${body}</body></html>`,
        { widthPx: 650, marginPt: 54, pageSize: 'A4' });
      files.push(pdf(`${stem(inp.name)}.pdf`, await save(doc)));
    }
    return { files, data: { engine: 'navegador (las páginas del PDF son imágenes)' } };
  };

  T.ppt_to_pdf = async () => {
    throw new Error('PowerPoint a PDF no está disponible en la versión web: el navegador no puede abrir presentaciones.');
  };

  T.excel_to_pdf = async (inputs, o) => {
    const XLSX = await L.xlsx();
    const files = [];
    for (const inp of inputs) {
      let wb;
      try { wb = XLSX.read(inp.bytes, { type: 'array', cellStyles: true }); } catch { throw new Error(`${inp.name}: no se pudo leer la hoja de cálculo.`); }
      const parts = wb.SheetNames.map(n => {
        const ws = wb.Sheets[n];
        if (!ws['!ref']) return '';
        return `<h3 style="font-family:Arial;margin:14px 0 6px">${esc(n)}</h3>` + XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
      }).join('');
      if (!parts) throw new Error(`${inp.name}: la hoja está vacía.`);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS} table{font-size:12px} td{white-space:nowrap}</style></head><body>${parts}</body></html>`;
      // orientación "original": horizontal si la tabla es ancha
      let landscape = o.orientation === 'landscape';
      if (o.orientation !== 'portrait' && o.orientation !== 'landscape') landscape = /<td/.test(parts) && (parts.match(/<td/g).length / Math.max(1, (parts.match(/<tr/g) || []).length)) > 7;
      const doc = await htmlToPdf(html, { widthPx: landscape ? 1000 : 700, marginPt: 28, pageSize: 'A4', landscape, fitWidth: o.fit_width !== false });
      files.push(pdf(`${stem(inp.name)}.pdf`, await save(doc)));
    }
    return { files, data: { engine: 'navegador (las páginas del PDF son imágenes)' } };
  };

  const SCREENS = { desktop: 1440, tablet: 768, mobile: 390 };
  T.html_to_pdf = async (inputs, o) => {
    if (!inputs.length) throw new Error('En la versión web no se pueden convertir direcciones web. Guarda la página como archivo .html y súbela.');
    const inp = inputs[0];
    const html = new TextDecoder().decode(inp.bytes);
    const margin = { none: 0, small: 29, big: 58 }[o.margin || 'small'] ?? 29;
    const doc = await htmlToPdf(html, { widthPx: SCREENS[o.screen] || 1440, marginPt: margin, pageSize: o.page_size || 'A4',
      landscape: o.orientation === 'landscape', onePage: !!o.one_page, blockPopups: o.block_popups !== false });
    return { files: [pdf(`${stem(inp.name)}.pdf`, await save(doc))], data: { engine: 'navegador (las páginas del PDF son imágenes)' } };
  };

  // =================================================================== OCR (Tesseract.js)
  const TESS = { es: 'spa', en: 'eng', pt: 'por', fr: 'fra', de: 'deu', it: 'ita' };
  const workers = {};
  async function tessWorker(lang) {
    if (!workers[lang]) {
      const Tesseract = await L.tesseract();
      workers[lang] = Tesseract.createWorker(lang, 1).catch(e => { delete workers[lang]; throw new Error('No se pudo iniciar el OCR (¿sin conexión?): ' + (e.message || e)); });
    }
    return workers[lang];
  }
  const tessLang = tag => TESS[String(tag || 'es').slice(0, 2)] || 'spa';
  const setBusy = msg => { try { if (typeof busy === 'function' && !document.getElementById('overlay').hidden) busy(true, msg); } catch { /* sin interfaz */ } };

  /** Añade una capa de texto invisible a las páginas escaneadas. Devuelve {bytes, text}. */
  async function makeSearchable(inp, lang, skipText = true) {
    const js = await u.jsOpen(inp.bytes);
    const doc = await openLib(inp);
    const worker = await tessWorker(lang);
    const full = [];
    for (let i = 0; i < js.numPages; i++) {
      const jp = await js.getPage(i + 1);
      const items = await u.textItems(jp);
      const existing = u.toLines(items).map(l => l.text).join('\n');
      if (skipText && existing.replace(/\s/g, '').length > 30) { full.push(existing); continue; }
      setBusy(`Reconociendo texto… página ${i + 1} de ${js.numPages}`);
      const vp = jp.getViewport({ scale: 1 });
      const z = Math.min(300 / 72, 5000 / Math.max(vp.width, vp.height));
      const c = await u.renderJsPage(jp, z);
      const { data } = await worker.recognize(c, {}, { text: true, blocks: true });
      const k = c.width / vp.width;
      const ws = [], lines = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
        lines.push(l.text.trim());
        for (const w of l.words || []) {
          const { x0, y0, x1, y1 } = w.bbox, h = (y1 - y0) / k;
          ws.push({ text: w.text, x0: x0 / k, x1: x1 / k, base: y1 / k - h * 0.2, size: Math.max(4, h * 0.85) });
        }
      }
      const page = doc.getPage(i);
      await u.invisibleText(doc, page, geom(page), ws);
      full.push(lines.join('\n'));
    }
    js.destroy();
    return { bytes: await save(doc), text: full.join('\n\n') };
  }

  T.ocr = async (inputs, o) => {
    const lang = tessLang(o.lang);
    const files = [], texts = [];
    for (const inp of inputs) {
      const { bytes, text } = await makeSearchable(inp, lang, !o.force);
      files.push(pdf(`${stem(inp.name)}_ocr.pdf`, bytes));
      if (o.txt !== false) files.push({ name: `${stem(inp.name)}_ocr.txt`, data: text });
      texts.push(text);
    }
    return { files, data: { preview: texts.join('\n\n').slice(0, 20000) } };
  };

  // =================================================================== PDF -> estructura de texto
  /** Párrafos de una página: líneas cercanas con el mismo tamaño se unen. */
  function paragraphs(lines) {
    const out = [];
    const right = lines.length ? Math.max(...lines.map(l => l.x1)) : 0, left = lines.length ? Math.min(...lines.map(l => l.x0)) : 0;
    const wraps = l => l.x1 > left + (right - left) * 0.8;
    for (const l of lines) {
      const prev = out[out.length - 1];
      const last = prev && prev.lines[prev.lines.length - 1];
      if (prev && Math.abs(last.size - l.size) < 0.6 && l.top - last.bottom < l.size * 0.9 && Math.abs(l.x0 - prev.x0) < l.size * 4 && wraps(last) && !bulletOf(l.text) && cells(l).length < 2) {
        prev.lines.push(l); prev.x1 = Math.max(prev.x1, l.x1); prev.bottom = l.bottom;
      } else out.push({ lines: [l], x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom, size: l.size });
    }
    out.forEach(p => {
      p.text = p.lines.reduce((acc, l) => !acc ? l.text : /-$/.test(acc) && /^\p{Ll}/u.test(l.text) ? acc.slice(0, -1) + l.text : acc + ' ' + l.text, '');
      p.bold = p.lines.every(l => l.bold); p.italic = p.lines.every(l => l.italic);
    });
    return out;
  }
  const bulletOf = t => /^\s*([•●▪◦‣∙·\-–*]|\d{1,3}[.)])\s+/.exec(t);
  function bodySize(allLines) {
    const w = new Map();
    for (const l of allLines) { const s = Math.round(l.size * 2) / 2; w.set(s, (w.get(s) || 0) + l.text.length); }
    let best = 11, bw = -1;
    for (const [s, c] of w) if (c > bw) { best = s; bw = c; }
    return best;
  }
  async function pagesText(inp, { fonts = true } = {}) {
    const js = await u.jsOpen(inp.bytes);
    const pages = [];
    for (let i = 0; i < js.numPages; i++) {
      const jp = await js.getPage(i + 1);
      const vp = jp.getViewport({ scale: 1 });
      const lines = u.toLines(await u.textItems(jp, { fonts }));
      pages.push({ jp, w: vp.width, h: vp.height, lines });
    }
    return { js, pages };
  }

  T.pdf_to_word = async (inputs, o) => {
    const D = await L.docx();
    const files = [];
    for (let inp of inputs) {
      if (o.mode === 'ocr') {
        const r = await makeSearchable(inp, tessLang(o.lang), true);
        inp = { ...inp, bytes: r.bytes };
      }
      const { js, pages } = await pagesText(inp);
      const body = bodySize(pages.flatMap(p => p.lines));
      const children = [];
      for (let pi = 0; pi < pages.length; pi++) {
        const pg = pages[pi];
        const paras = paragraphs(pg.lines);
        if (!paras.length) { // página sin texto (escaneada): se inserta como imagen
          const c = await u.renderJsPage(pg.jp, 150 / 72);
          const w = 600, h = Math.round(w * c.height / c.width);
          children.push(new D.Paragraph({ pageBreakBefore: pi > 0, children: [new D.ImageRun({ type: 'png', data: await u.canvasBytes(c, 'image/png'), transformation: { width: w, height: h } })] }));
          continue;
        }
        paras.forEach((p, k) => {
          const ratio = p.size / body;
          const heading = ratio >= 1.6 ? D.HeadingLevel.HEADING_1 : ratio >= 1.3 ? D.HeadingLevel.HEADING_2 : ratio >= 1.15 && p.bold ? D.HeadingLevel.HEADING_3 : undefined;
          const b = bulletOf(p.text);
          const text = b ? p.text.slice(b[0].length) : p.text;
          children.push(new D.Paragraph({
            pageBreakBefore: pi > 0 && k === 0, heading, bullet: b && !/\d/.test(b[1]) ? { level: 0 } : undefined,
            children: [new D.TextRun({ text: b && /\d/.test(b[1]) ? b[0].trim() + ' ' + text : text, bold: p.bold, italics: p.italic, size: Math.round(p.size * 2) })],
          }));
        });
      }
      js.destroy();
      const first = pages[0] || { w: 595, h: 842 };
      const doc = new D.Document({ sections: [{ properties: { page: { size: { width: Math.round(first.w * 20), height: Math.round(first.h * 20) },
        margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }] });
      files.push({ name: `${stem(inp.name)}.docx`, data: await D.Packer.toBlob(doc) });
    }
    return { files };
  };

  T.pdf_to_ppt = async (inputs, o) => {
    const PptxGenJS = await L.pptx();
    const editable = o.editable !== false;
    const files = [];
    for (const inp of inputs) {
      const { js, pages } = await pagesText(inp);
      const pres = new PptxGenJS();
      const first = pages[0];
      pres.defineLayout({ name: 'PDF', width: first.w / 72, height: first.h / 72 });
      pres.layout = 'PDF';
      for (const pg of pages) {
        const slide = pres.addSlide();
        const sx = first.w / pg.w, sy = first.h / pg.h;
        const c = await u.renderJsPage(pg.jp, 150 / 72, { noText: editable });
        slide.addImage({ data: 'data:image/png;base64,' + u.b64(await u.canvasBytes(c, 'image/png')), x: 0, y: 0, w: first.w / 72, h: first.h / 72 });
        if (editable) {
          for (const p of paragraphs(pg.lines)) {
            const fam = (p.lines[0].items[0].font || '').split('+').pop().split(/[-,]/)[0] || 'Arial';
            slide.addText(p.lines.map(l => l.text).join('\n'), {
              x: p.x0 * sx / 72, y: p.top * sy / 72, w: ((p.x1 - p.x0) * sx + 8) / 72, h: Math.max(p.size, (p.bottom - p.top)) * sy / 72,
              fontSize: Math.max(4, p.size * Math.min(sx, sy)), bold: p.bold, italic: p.italic, fontFace: fam, color: '000000',
              margin: 0, valign: 'top', fit: 'none', paraSpaceAfter: 0,
            });
          }
        }
      }
      js.destroy();
      files.push({ name: `${stem(inp.name)}.pptx`, data: await pres.write({ outputType: 'blob' }) });
    }
    return { files };
  };

  function num(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return parseInt(s.replace(/\./g, ''), 10); // 1.500 = mil quinientos
    const t = (s.split(',').length === 2 && (s.match(/\./g) || []).length <= 3) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
    return s;
  }
  /** Celdas de una línea: se separan los elementos de texto donde hay un hueco grande. */
  function cells(line) {
    const out = [];
    let cur = '', prev = null;
    for (const it of line.items) {
      const gap = prev ? it.x0 - prev.x1 : 0;
      if (prev && gap > Math.max(it.size * 0.75, 6)) { out.push(cur); cur = ''; }
      for (const [k, part] of it.str.split(/\s{3,}/).entries()) { if (k) { out.push(cur); cur = ''; } cur += (cur && gap > it.size * 0.12 && !k ? ' ' : '') + part; }
      prev = it;
    }
    out.push(cur);
    return out.map(c => c.trim());
  }

  T.pdf_to_excel = async inputs => {
    const XLSX = await L.xlsx();
    const files = [];
    for (const inp of inputs) {
      const { js, pages } = await pagesText(inp, { fonts: false });
      const wb = XLSX.utils.book_new();
      pages.forEach((pg, i) => {
        const rows = pg.lines.map(l => cells(l).map(num));
        if (!rows.length) return;
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const ncol = Math.max(...rows.map(r => r.length));
        ws['!cols'] = Array.from({ length: ncol }, (_, c) => ({ wch: Math.min(60, Math.max(8, ...rows.map(r => String(r[c] ?? '').length + 2))) }));
        XLSX.utils.book_append_sheet(wb, ws, `Pag${i + 1}`);
      });
      js.destroy();
      if (!wb.SheetNames.length) throw new Error(`${inp.name}: el PDF no tiene texto (¿es escaneado? Aplica primero "OCR PDF").`);
      files.push({ name: `${stem(inp.name)}.xlsx`, data: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) });
    }
    return { files };
  };

  T.pdf_to_markdown = async inputs => {
    const files = [];
    let preview = '';
    for (const inp of inputs) {
      const { js, pages } = await pagesText(inp);
      const all = pages.flatMap(p => p.lines);
      const body = bodySize(all);
      const big = [...new Set(all.filter(l => l.size > body * 1.15).map(l => Math.round(l.size)))].sort((a, b) => b - a).slice(0, 4);
      const out = [];
      for (const pg of pages) {
        const paras = paragraphs(pg.lines);
        for (let k = 0; k < paras.length; k++) {
          const p = paras[k];
          // tablas: líneas seguidas con el mismo número (≥2) de celdas
          const row = p.lines.length === 1 ? cells(p.lines[0]) : null;
          if (row && row.length >= 2) {
            const table = [row];
            while (k + 1 < paras.length && paras[k + 1].lines.length === 1 && cells(paras[k + 1].lines[0]).length === row.length) table.push(cells(paras[++k].lines[0]));
            if (table.length >= 2) {
              const cellMd = c => c.replace(/\|/g, '\\|');
              out.push('| ' + table[0].map(cellMd).join(' | ') + ' |', '| ' + table[0].map(() => '---').join(' | ') + ' |',
                ...table.slice(1).map(r => '| ' + r.map(cellMd).join(' | ') + ' |'), '');
              continue;
            }
          }
          const lvl = big.indexOf(Math.round(p.size));
          const b = bulletOf(p.text);
          if (lvl >= 0) out.push('#'.repeat(lvl + 1) + ' ' + p.text, '');
          else if (b) out.push((/\d/.test(b[1]) ? b[1] + ' ' : '- ') + p.text.slice(b[0].length), '');
          else out.push(p.bold && p.text.length < 200 ? `**${p.text}**` : p.italic && p.text.length < 200 ? `*${p.text}*` : p.text, '');
        }
        out.push('');
      }
      js.destroy();
      const md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
      files.push({ name: `${stem(inp.name)}.md`, data: md });
      preview = preview || md.slice(0, 20000);
    }
    return { files, data: { preview } };
  };
})();
