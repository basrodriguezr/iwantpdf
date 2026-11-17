/* iwantpdf web: herramientas PDF (equivalentes a core/pdf_ops.py, en el navegador).
   Firma común: fn(inputs, opts) -> { files: [{name, data}], data?, zip_name? } */
'use strict';
(() => {
  const { L, TOOLS: T, u } = IW;
  const { stem, range, parsePages, openLib, save, geom, stdFont, drawLine, textWidth, hexColor } = u;

  const A4 = [595.28, 841.89];
  const PAPER = { A4, Letter: [612, 792], Legal: [612, 1008], A3: [841.89, 1190.55], A5: [419.53, 595.28] };
  const MARGINS = { none: 0, small: 20, big: 50 };
  const POSITIONS = {
    'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0],
    'middle-left': [0, 0.5], 'center': [0.5, 0.5], 'middle-right': [1, 0.5],
    'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1],
  };
  const pdf = (name, data) => ({ name, data });

  async function newDoc() { const { PDFDocument } = await L.pdfLib(); return PDFDocument.create(); }
  async function copyInto(out, src, indices) { (await out.copyPages(src, indices)).forEach(p => out.addPage(p)); }

  // =================================================================== ORGANIZAR
  T.merge = async (inputs, o) => {
    const out = await newDoc();
    for (const inp of inputs) { const src = await openLib(inp); await copyInto(out, src, src.getPageIndices()); }
    return { files: [pdf(o.filename || 'iwantpdf_unido.pdf', await save(out))] };
  };

  T.split = async (inputs, o) => {
    const mode = o.mode || 'ranges';
    const files = [];
    for (const inp of inputs) {
      const src = await openLib(inp);
      const n = src.getPageCount();
      let groups = [];
      if (mode === 'ranges') {
        for (const r of o.ranges || [{ from: 1, to: n }]) {
          const a = Math.max(1, parseInt(r.from, 10) || 1), b = Math.min(n, parseInt(r.to, 10) || n);
          if (a <= b) groups.push([`${a}-${b}`, range(a - 1, b)]);
        }
        if (o.merge_all) groups = [['rangos', groups.flatMap(g => g[1])]];
      } else if (mode === 'fixed') {
        const k = Math.max(1, parseInt(o.every, 10) || 1);
        for (let i = 0; i < n; i += k) groups.push([`${i + 1}-${Math.min(i + k, n)}`, range(i, Math.min(i + k, n))]);
      } else if (mode === 'all') {
        groups = range(0, n).map(i => [String(i + 1), [i]]);
      } else if (mode === 'select') {
        const sel = parsePages(o.pages, n, false);
        if (!sel.length) throw new Error('Indica qué páginas extraer, p. ej. 1,3,5-7');
        groups = o.separate ? sel.map(i => [String(i + 1), [i]]) : [['extraidas', sel]];
      } else if (mode === 'size') {
        const limit = (parseFloat(o.max_mb) || 5) * 1048576;
        const sizeOf = async pages => { const d = await newDoc(); await copyInto(d, src, pages); return (await d.save({ useObjectStreams: true })).length; };
        let cur = [];
        for (let i = 0; i < n; i++) {
          if (cur.length && await sizeOf([...cur, i]) > limit) { groups.push([`${cur[0] + 1}-${cur[cur.length - 1] + 1}`, cur]); cur = []; }
          cur.push(i);
        }
        if (cur.length) groups.push([`${cur[0] + 1}-${cur[cur.length - 1] + 1}`, cur]);
      }
      for (const [label, pages] of groups) {
        const d = await newDoc();
        await copyInto(d, src, pages);
        files.push(pdf(`${stem(inp.name)}_${label}.pdf`, await save(d)));
      }
    }
    if (!files.length) throw new Error('Los rangos indicados no contienen páginas.');
    return { files, zip_name: 'iwantpdf_dividido.zip' };
  };

  T.rotate = async (inputs, o) => {
    const { degrees } = await L.pdfLib();
    const per = o.per_page || {}, hasPer = Object.keys(per).length > 0;
    const files = [];
    for (let fi = 0; fi < inputs.length; fi++) {
      const doc = await openLib(inputs[fi]);
      const glob = parseInt((o.angles || {})[fi] ?? o.angle ?? 90, 10) || 0;
      doc.getPages().forEach((pg, i) => {
        const a = hasPer ? parseInt((per[fi] || {})[i] || 0, 10) || 0 : glob;
        pg.setRotation(degrees((((pg.getRotation().angle + a) % 360) + 360) % 360));
      });
      files.push(pdf(`${stem(inputs[fi].name)}_rotado.pdf`, await save(doc)));
    }
    return { files };
  };

  T.organize = async (inputs, o) => {
    const { degrees } = await L.pdfLib();
    const srcs = [];
    for (const inp of inputs) srcs.push(await openLib(inp));
    const out = await newDoc();
    const seq = o.pages || range(0, srcs[0].getPageCount()).map(p => ({ f: 0, p }));
    for (const it of seq) {
      if (it.blank) {
        const n = out.getPageCount();
        const ref = n ? geom(out.getPage(n - 1)) : null;
        out.addPage(ref ? [ref.W, ref.H] : A4);
        continue;
      }
      const [pg] = await out.copyPages(srcs[+it.f], [+it.p]);
      out.addPage(pg);
      if (it.r) pg.setRotation(degrees((pg.getRotation().angle + +it.r) % 360));
    }
    return { files: [pdf(`${stem(inputs[0].name)}_ordenado.pdf`, await save(out))] };
  };

  // =================================================================== OPTIMIZAR
  const LEVELS = { low: { dpi: 200, q: 0.85 }, recommended: { dpi: 130, q: 0.65 }, extreme: { dpi: 72, q: 0.4 } };

  async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /** Recomprime las imágenes del documento como JPEG (reduce resolución y calidad). */
  async function recompressImages(doc, cfg, gray) {
    const P = await L.pdfLib();
    const { PDFName, PDFRawStream, PDFArray, PDFNumber, PDFRef } = P;
    const ctx = doc.context;
    let maxPage = 0;
    for (const pg of doc.getPages()) { const { width, height } = pg.getSize(); maxPage = Math.max(maxPage, width, height); }
    const maxPx = Math.ceil(maxPage / 72 * cfg.dpi);
    const N = k => PDFName.of(k);
    const smasks = new Set();
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image')) {
        const sm = obj.dict.get(N('SMask'));
        if (sm instanceof PDFRef) smasks.add(sm.toString());
      }
    }
    let changed = 0;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (d.get(N('Subtype')) !== N('Image') || smasks.has(ref.toString())) continue;
      if (d.get(N('ImageMask')) || d.get(N('Mask')) instanceof PDFArray || d.get(N('Decode'))) continue;
      const bpc = d.lookup(N('BitsPerComponent'));
      if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
      let cs = d.lookup(N('ColorSpace'));
      let comps = 0;
      if (cs === N('DeviceRGB')) comps = 3;
      else if (cs === N('DeviceGray')) comps = 1;
      else if (cs instanceof PDFArray && cs.lookup(0) === N('ICCBased')) {
        const icc = cs.lookup(1);
        const n = icc && icc.dict && icc.dict.lookup(N('N'));
        comps = n instanceof PDFNumber ? n.asNumber() : 0;
        if (comps !== 1 && comps !== 3) comps = 0;
      }
      if (!comps) continue;
      let filter = d.lookup(N('Filter'));
      if (filter instanceof PDFArray) { if (filter.size() !== 1) continue; filter = filter.lookup(0); }
      const w = d.lookup(N('Width'))?.asNumber?.(), h = d.lookup(N('Height'))?.asNumber?.();
      if (!w || !h) continue;
      let bitmap;
      try {
        if (filter === N('DCTDecode')) {
          bitmap = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        } else if (filter === N('FlateDecode')) {
          const parms = d.lookup(N('DecodeParms'));
          if (parms && parms.lookup && parms.lookup(N('Predictor')) && parms.lookup(N('Predictor')).asNumber() > 1) continue;
          const raw = await inflate(obj.contents);
          if (raw.length < w * h * comps) continue;
          const id = new ImageData(w, h);
          for (let i = 0, j = 0; i < w * h; i++, j += comps) {
            const o4 = i * 4;
            if (comps === 3) { id.data[o4] = raw[j]; id.data[o4 + 1] = raw[j + 1]; id.data[o4 + 2] = raw[j + 2]; }
            else id.data[o4] = id.data[o4 + 1] = id.data[o4 + 2] = raw[j];
            id.data[o4 + 3] = 255;
          }
          bitmap = await createImageBitmap(id);
        } else continue;
      } catch { continue; }
      const k = Math.max(w, h) > maxPx * 1.1 ? maxPx / Math.max(w, h) : 1;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      const cx = c.getContext('2d');
      if (gray) cx.filter = 'grayscale(1)';
      cx.drawImage(bitmap, 0, 0, c.width, c.height);
      const jpg = await u.canvasBytes(c, 'image/jpeg', cfg.q);
      if (jpg.length >= obj.contents.length && k === 1 && !gray) continue;
      const nd = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: c.width, Height: c.height, ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8, Filter: 'DCTDecode', Length: jpg.length });
      const smask = d.get(N('SMask'));
      if (smask) nd.set(N('SMask'), smask);
      const interp = d.get(N('Interpolate'));
      if (interp) nd.set(N('Interpolate'), interp);
      ctx.assign(ref, PDFRawStream.of(nd, jpg));
      changed++;
    }
    return changed;
  }

  T.compress = async (inputs, o) => {
    const { PDFName } = await L.pdfLib();
    const cfg = LEVELS[o.level] || LEVELS.recommended;
    const files = [], stats = [];
    for (const inp of inputs) {
      const before = inp.bytes.length;
      const doc = await openLib(inp);
      await recompressImages(doc, cfg, !!o.grayscale);
      if (o.level === 'extreme') {
        doc.catalog.delete(PDFName.of('Metadata'));
        doc.getPages().forEach(p => p.node.delete(PDFName.of('Thumb')));
      }
      let bytes = await doc.save({ useObjectStreams: true });
      if (bytes.length >= before) bytes = inp.bytes; // no empeorar nunca el archivo
      files.push(pdf(`${stem(inp.name)}_comprimido.pdf`, bytes));
      stats.push({ name: inp.name, before, after: bytes.length });
    }
    return { files, data: { stats } };
  };

  T.repair = async inputs => {
    const { PDFDocument } = await L.pdfLib();
    const files = [], notes = [];
    for (const inp of inputs) {
      const r = await u.qpdf(['--object-streams=generate', '/in.pdf', '/out.pdf'], inp.bytes);
      if (r.out) { files.push(pdf(`${stem(inp.name)}_reparado.pdf`, r.out)); notes.push(`${inp.name}: estructura reconstruida con qpdf`); continue; }
      try {
        const doc = await PDFDocument.load(inp.bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
        files.push(pdf(`${stem(inp.name)}_reparado.pdf`, await doc.save()));
        notes.push(`${inp.name}: reconstruido con pdf-lib`);
      } catch (e) {
        throw new Error(`No se pudo reparar ${inp.name}: ${(r.err || '').split('\n').pop() || e.message}`);
      }
    }
    return { files, data: { notes } };
  };

  T.pdfa = async (inputs, o) => {
    const P = await L.pdfLib();
    const { PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFRawStream } = P;
    const N = k => PDFName.of(k);
    const part = String(o.level || '2b')[0];
    const icc = new Uint8Array(await (await fetch(IW.VENDOR + 'srgb.icc')).arrayBuffer());
    const files = [], warnings = [];
    for (const inp of inputs) {
      const doc = await openLib(inp);
      const ctx = doc.context, cat = doc.catalog;
      // JavaScript, acciones automáticas y (salvo PDF/A-3) archivos adjuntos
      const names = cat.lookup(N('Names'));
      if (names instanceof PDFDict) { names.delete(N('JavaScript')); if (part !== '3') names.delete(N('EmbeddedFiles')); }
      cat.delete(N('AA'));
      const oa = cat.lookup(N('OpenAction'));
      if (oa instanceof PDFDict && oa.lookup(N('S')) === N('JavaScript')) cat.delete(N('OpenAction'));
      doc.getPages().forEach(p => p.node.delete(N('AA')));
      // fuentes sin incrustar y transparencias (avisos)
      for (const [, obj] of ctx.enumerateIndirectObjects()) {
        const dict = obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? null : null;
        if (!dict) continue;
        if (dict.lookup(N('Type')) === N('Font')) {
          const sub = dict.lookup(N('Subtype'));
          if (sub === N('Type3') || sub === N('Type0')) continue;
          const fd = dict.lookup(N('FontDescriptor'));
          const embedded = fd instanceof PDFDict && (fd.get(N('FontFile')) || fd.get(N('FontFile2')) || fd.get(N('FontFile3')));
          if (!embedded) warnings.push(`${inp.name}: la fuente '${(dict.lookup(N('BaseFont')) || '').toString().replace('/', '')}' no está incrustada`);
        }
        if (part === '1' && dict.lookup(N('Type')) === N('ExtGState')) {
          const ca = dict.lookup(N('ca')), CA = dict.lookup(N('CA'));
          if ((ca && ca.asNumber() < 1) || (CA && CA.asNumber() < 1) || (dict.lookup(N('SMask')) && dict.lookup(N('SMask')) !== N('None')))
            warnings.push(`${inp.name}: contiene transparencias, que PDF/A-1b no permite (usa PDF/A-2b)`);
        }
      }
      // metadatos XMP con la identificación PDF/A, coherentes con el diccionario Info
      const now = new Date();
      const title = doc.getTitle() || stem(inp.name);
      doc.setTitle(title); doc.setProducer('iwantpdf'); doc.setCreationDate(doc.getCreationDate() || now); doc.setModificationDate(now);
      const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xe(title)}</rdf:li></rdf:Alt></dc:title>
<pdf:Producer>iwantpdf</pdf:Producer><xmp:CreateDate>${iso(doc.getCreationDate() || now)}</xmp:CreateDate>
<xmp:ModifyDate>${iso(now)}</xmp:ModifyDate></rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
      const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
      cat.set(N('Metadata'), ctx.register(meta));
      // OutputIntent sRGB
      const profile = ctx.register(ctx.flateStream(icc, { N: 3 }));
      const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', DestOutputProfile: profile });
      intent.set(N('OutputConditionIdentifier'), PDFString.of('sRGB IEC61966-2.1'));
      intent.set(N('Info'), PDFString.of('sRGB IEC61966-2.1'));
      cat.set(N('OutputIntents'), ctx.obj([ctx.register(intent)]));
      // identificador de archivo (obligatorio en PDF/A)
      const idHex = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(idHex), PDFHexString.of(idHex)]);
      ctx.header = P.PDFHeader.forVersion(1, part === '1' ? 4 : 7);
      files.push(pdf(`${stem(inp.name)}_pdfa.pdf`, await doc.save({ useObjectStreams: false })));
    }
    warnings.push('Conversión de "mejor esfuerzo" hecha en el navegador: si necesitas certificar la conformidad, valida el archivo con veraPDF.');
    return { files, data: { warnings: [...new Set(warnings)].sort() } };
  };

  // =================================================================== IMÁGENES
  T.pdf_to_jpg = async (inputs, o) => {
    const { PDFName, PDFRawStream, PDFArray, PDFNumber, PDFDict } = await L.pdfLib();
    const N = k => PDFName.of(k);
    const mode = o.mode || 'pages', dpi = parseInt(o.dpi, 10) || 150, fmt = o.format || 'jpg', q = (parseInt(o.quality, 10) || 90) / 100;
    const files = [];
    for (const inp of inputs) {
      if (mode === 'images') {
        const doc = await openLib(inp);
        const seen = new Set();
        let pi = 0;
        for (const page of doc.getPages()) {
          pi++;
          const res = page.node.Resources();
          const xo = res && res.lookup(N('XObject'));
          if (!(xo instanceof PDFDict)) continue;
          let k = 0;
          for (const [, ref] of xo.entries()) {
            const obj = doc.context.lookup(ref);
            if (!(obj instanceof PDFRawStream) || obj.dict.lookup(N('Subtype')) !== N('Image')) continue;
            k++;
            const key = ref.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            const d = obj.dict, w = d.lookup(N('Width'))?.asNumber?.() || 0, h = d.lookup(N('Height'))?.asNumber?.() || 0;
            if (w < 16) continue;
            let filter = d.lookup(N('Filter'));
            if (filter instanceof PDFArray && filter.size() === 1) filter = filter.lookup(0);
            const name = `${stem(inp.name)}_p${pi}_img${k}`;
            if (filter === N('DCTDecode') && !d.get(N('SMask'))) { files.push({ name: name + '.jpg', data: obj.contents }); continue; }
            // resto: decodificar con el navegador vía JPEG o datos crudos y guardar como PNG
            try {
              let bm;
              if (filter === N('DCTDecode')) bm = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
              else if (filter === N('FlateDecode') && d.lookup(N('BitsPerComponent'))?.asNumber?.() === 8) {
                const cs = d.lookup(N('ColorSpace'));
                const comps = cs === N('DeviceGray') ? 1 : cs === N('DeviceRGB') ? 3 : cs instanceof PDFArray && cs.lookup(0) === N('ICCBased') ? (cs.lookup(1)?.dict?.lookup(N('N'))?.asNumber?.() || 0) : 0;
                if (comps !== 1 && comps !== 3) continue;
                const parms = d.lookup(N('DecodeParms'));
                if (parms instanceof PDFDict && parms.lookup(N('Predictor')) instanceof PDFNumber && parms.lookup(N('Predictor')).asNumber() > 1) continue;
                const raw = await new Response(new Blob([obj.contents]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer().then(b => new Uint8Array(b));
                const id = new ImageData(w, h);
                for (let i = 0, j = 0; i < w * h; i++, j += comps) {
                  id.data[i * 4] = raw[j]; id.data[i * 4 + 1] = raw[comps === 3 ? j + 1 : j]; id.data[i * 4 + 2] = raw[comps === 3 ? j + 2 : j]; id.data[i * 4 + 3] = 255;
                }
                bm = await createImageBitmap(id);
              } else continue;
              const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
              c.getContext('2d').drawImage(bm, 0, 0);
              files.push({ name: name + '.png', data: await u.canvasBytes(c, 'image/png') });
            } catch { /* formato no soportado: se omite */ }
          }
        }
      } else {
        const js = await u.jsOpen(inp.bytes);
        for (let i = 1; i <= js.numPages; i++) {
          const c = await u.renderJsPage(await js.getPage(i), dpi / 72);
          const png = fmt === 'png';
          files.push({ name: `${stem(inp.name)}_pagina_${i}.${png ? 'png' : 'jpg'}`, data: await u.canvasBytes(c, png ? 'image/png' : 'image/jpeg', q) });
        }
        js.destroy();
      }
    }
    if (!files.length) throw new Error('No se encontraron imágenes en el PDF.');
    return { files, zip_name: 'iwantpdf_imagenes.zip' };
  };

  async function imagePage(doc, canvas, o) {
    const img = await doc.embedJpg(await u.canvasBytes(canvas, 'image/jpeg', (parseInt(o.quality, 10) || 92) / 100));
    const iw = canvas.width, ih = canvas.height;
    const size = o.page_size || 'A4', margin = MARGINS[o.margin || 'none'] || 0, orient = o.orientation || 'portrait';
    let pw, ph;
    if (size === 'fit') { pw = iw * 0.75 + 2 * margin; ph = ih * 0.75 + 2 * margin; }
    else {
      const [a, b] = PAPER[size] || A4;
      const land = orient === 'landscape' || (orient === 'auto' && iw > ih);
      [pw, ph] = land ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
    }
    const page = doc.addPage([pw, ph]);
    const bw = pw - 2 * margin, bh = ph - 2 * margin;
    const k = Math.min(bw / iw, bh / ih);
    const w = iw * k, h = ih * k;
    page.drawImage(img, { x: margin + (bw - w) / 2, y: margin + (bh - h) / 2, width: w, height: h });
  }

  T.jpg_to_pdf = async (inputs, o) => {
    const imgs = inputs.filter(u.isImage);
    if (!imgs.length) throw new Error('Sube imágenes (JPG, PNG, …).');
    const canvasOf = async inp => inp.canvas || u.bitmapCanvas(await u.decodeImage(inp.bytes, inp.ext || u.extOf(inp.name)));
    if (o.merge !== false) {
      const doc = await newDoc();
      for (const inp of imgs) await imagePage(doc, await canvasOf(inp), o);
      return { files: [pdf(o.filename || 'iwantpdf_imagenes.pdf', await save(doc))] };
    }
    const files = [];
    for (const inp of imgs) {
      const doc = await newDoc();
      await imagePage(doc, await canvasOf(inp), o);
      files.push(pdf(`${stem(inp.name)}.pdf`, await save(doc)));
    }
    return { files };
  };

  /** Autocontraste estilo PIL (recorta `cutoff` % de cada extremo del histograma). */
  function autocontrast(data, channels, cutoff) {
    for (const ch of channels) {
      const hist = new Uint32Array(256);
      for (let i = ch; i < data.length; i += 4) hist[data[i]]++;
      const total = data.length / 4, cut = total * cutoff / 100;
      let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hist[lo]) <= cut) lo++;
      acc = 0;
      while (hi > 0 && (acc += hist[hi]) <= cut) hi--;
      if (hi <= lo) continue;
      const sc = 255 / (hi - lo);
      for (let i = ch; i < data.length; i += 4) data[i] = Math.max(0, Math.min(255, (data[i] - lo) * sc));
    }
  }

  T.scan_to_pdf = async (inputs, o) => {
    const filt = o.filter || 'color';
    const prepared = [];
    for (const inp of inputs) {
      const c = u.bitmapCanvas(await u.decodeImage(inp.bytes, inp.ext || u.extOf(inp.name)));
      const cx = c.getContext('2d', { willReadFrequently: true });
      const id = cx.getImageData(0, 0, c.width, c.height), d = id.data;
      if (filt === 'gray' || filt === 'bw') {
        for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        autocontrast(d, [0], 2);
        for (let i = 0; i < d.length; i += 4) {
          const v = filt === 'bw' ? (d[i] > 150 ? 255 : 0) : d[i];
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      } else autocontrast(d, [0, 1, 2], 1);
      cx.putImageData(id, 0, 0);
      prepared.push({ name: inp.name, ext: '.jpg', canvas: c });
    }
    return T.jpg_to_pdf(prepared, { ...o, merge: true, quality: 88, page_size: o.page_size || 'A4', orientation: 'auto',
      margin: o.margin || 'none', filename: o.filename || 'iwantpdf_escaneo.pdf' });
  };

  // =================================================================== EDITAR
  T.watermark = async (inputs, o) => {
    const { degrees } = await L.pdfLib();
    const kind = o.type || 'text', pos = o.position || 'center';
    const opacity = Math.max(0.05, Math.min(1, (parseFloat(o.opacity ?? 50)) / 100));
    const angle = parseFloat(o.rotation || 0) || 0;
    const under = o.layer === 'under', mosaic = !!o.mosaic;
    let imgCanvas = null;
    if (kind === 'image') {
      if (!o.image) throw new Error('Elige una imagen para la marca de agua.');
      const { bytes, mime } = u.dataUrlBytes(o.image);
      const bm = await createImageBitmap(new Blob([bytes], { type: mime }));
      // girar la imagen (expandiendo el lienzo) como PIL
      const th = angle * Math.PI / 180, cos = Math.abs(Math.cos(th)), sin = Math.abs(Math.sin(th));
      imgCanvas = document.createElement('canvas');
      imgCanvas.width = Math.ceil(bm.width * cos + bm.height * sin); imgCanvas.height = Math.ceil(bm.width * sin + bm.height * cos);
      const cx = imgCanvas.getContext('2d');
      cx.translate(imgCanvas.width / 2, imgCanvas.height / 2); cx.rotate(-th); cx.drawImage(bm, -bm.width / 2, -bm.height / 2);
    }
    const scale = (parseFloat(o.image_scale) || 30) / 100;
    const size = parseFloat(o.font_size) || 48;
    const color = hexColor(o.color || '#d93025');
    const text = o.text || 'CONFIDENCIAL';
    const files = [];
    for (const inp of inputs) {
      const doc = await openLib(inp);
      const font = await stdFont(doc, o.font || 'Arial', !!o.bold, !!o.italic);
      const img = imgCanvas ? await doc.embedPng(await u.canvasBytes(imgCanvas, 'image/png')) : null;
      const lines = text.split('\n');
      for (const i of parsePages(o.pages, doc.getPageCount())) {
        const page = doc.getPage(i), g = geom(page);
        let bw, bh;
        if (kind === 'text') { bw = Math.max(...lines.map(l => textWidth(font, l, size))); bh = size * 1.2 * lines.length; }
        else { bw = g.W * scale; bh = bw * imgCanvas.height / imgCanvas.width; }
        let centers = [];
        if (mosaic) {
          const sx = bw * 1.6 + 40, sy = bh * 3 + 60;
          for (let y = sy / 2; y < g.H; y += sy) for (let x = sx / 2; x < g.W; x += sx) centers.push([x, y]);
        } else {
          const [fx, fy] = POSITIONS[pos] || [0.5, 0.5], m = 36;
          centers = [[m + bw / 2 + fx * (g.W - 2 * m - bw), m + bh / 2 + fy * (g.H - 2 * m - bh)]];
        }
        const draw = async () => {
          for (const [cx, cy] of centers) {
            if (kind === 'text') {
              const th = angle * Math.PI / 180;
              let y = cy - bh / 2 + size * 0.95;
              for (const line of lines) {
                const lw = textWidth(font, line, size);
                const dx = cx - lw / 2 - cx, dy = y - cy;
                const rx = cx + dx * Math.cos(th) + dy * Math.sin(th), ry = cy - dx * Math.sin(th) + dy * Math.cos(th);
                await drawLine(doc, page, g, line, rx, ry, { font, size, color, opacity, angle });
                y += size * 1.2;
              }
            } else {
              const [ux, uy] = g.toUser(cx - bw / 2, cy + bh / 2);
              page.drawImage(img, { x: ux, y: uy, width: bw, height: bh, opacity, rotate: degrees(g.r) });
            }
          }
        };
        if (under) await u.drawUnder(page, draw); else await draw();
      }
      files.push(pdf(`${stem(inp.name)}_marca_agua.pdf`, await save(doc)));
    }
    return { files };
  };

  T.page_numbers = async (inputs, o) => {
    const pos = o.position || 'bottom-center';
    const margin = { small: 18, recommended: 30, big: 50 }[o.margin || 'recommended'] || 30;
    const first = parseInt(o.first_number ?? 1, 10);
    const tmpl = o.text || '{n}';
    const size = parseFloat(o.font_size) || 12;
    const color = hexColor(o.color || '#000000');
    const files = [];
    for (const inp of inputs) {
      const doc = await openLib(inp);
      const font = await stdFont(doc, o.font || 'Arial', !!o.bold, !!o.italic);
      const n = doc.getPageCount();
      const frm = Math.max(1, parseInt(o.from, 10) || 1), to = Math.min(n, parseInt(o.to, 10) || n);
      const total = to - frm + 1 + (Number.isNaN(first) ? 1 : first) - 1;
      for (let k = 0, i = frm - 1; i < to; k++, i++) {
        const page = doc.getPage(i), g = geom(page);
        const num = (Number.isNaN(first) ? 1 : first) + k;
        const label = tmpl.split('{n}').join(String(num)).split('{p}').join(String(total));
        const w = textWidth(font, label, size);
        let [fx, fy] = POSITIONS[pos] || [0.5, 1];
        if (o.facing && fx !== 0.5 && num % 2 === 0) fx = 1 - fx;
        const x = margin + fx * (g.W - 2 * margin - w);
        const y = margin + size + fy * (g.H - 2 * margin - size);
        await drawLine(doc, page, g, label, x, y - size * 0.2, { font, size, color });
      }
      files.push(pdf(`${stem(inp.name)}_numerado.pdf`, await save(doc)));
    }
    return { files };
  };

  T.edit = async (inputs, o) => {
    const P = await L.pdfLib();
    const { rgb, degrees, LineCapStyle } = P;
    const inp = inputs[0];
    const doc = await openLib(inp);
    const col = h => { const c = hexColor(h, null); return c ? rgb(...c) : undefined; };
    for (const el of o.elements || []) {
      const page = doc.getPage(+el.page), g = geom(page);
      const t = el.type;
      const r = el.rect || [0, 0, 0, 0];
      let stroke = el.stroke ? col(el.stroke) : undefined;
      let fill = el.fill ? col(el.fill) : undefined;
      const width = parseFloat(el.width ?? 2);
      let op = parseFloat(el.opacity ?? 1);
      if (t === 'text') {
        const font = await stdFont(doc, el.font || 'Arial', !!el.bold, !!el.italic);
        const size = parseFloat(el.size) || 14;
        const color = hexColor(el.color || '#000000');
        let y = r[1] + size * 0.95;
        for (const line of String(el.text || '').split('\n')) {
          const lw = textWidth(font, line, size);
          const x = el.align !== 'center' ? r[0] : r[0] + (r[2] - r[0] - lw) / 2;
          await drawLine(doc, page, g, line, x, y, { font, size, color, opacity: op });
          y += size * 1.2;
        }
      } else if (t === 'image') {
        const { bytes, mime } = u.dataUrlBytes(el.src);
        const img = /png/.test(mime) ? await doc.embedPng(bytes) : /jpe?g/.test(mime) ? await doc.embedJpg(bytes)
          : await doc.embedPng(await u.canvasBytes(u.bitmapCanvas(await createImageBitmap(new Blob([bytes], { type: mime }))), 'image/png'));
        const [ux, uy] = g.toUser(r[0], r[3]);
        page.drawImage(img, { x: ux, y: uy, width: r[2] - r[0], height: r[3] - r[1], rotate: degrees(g.r) });
      } else if (t === 'rect' || t === 'whiteout' || t === 'highlight') {
        if (t === 'whiteout') { stroke = undefined; fill = rgb(1, 1, 1); op = 1; }
        if (t === 'highlight') { stroke = undefined; fill = col(el.fill || '#ffeb3b'); op = 0.4; }
        const R = g.rectToUser(r);
        page.drawRectangle({ ...R, color: fill, borderColor: stroke, borderWidth: stroke ? width : 0, opacity: op, borderOpacity: op });
      } else if (t === 'ellipse') {
        const [ux, uy] = g.toUser((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
        const rx = (r[2] - r[0]) / 2, ry = (r[3] - r[1]) / 2;
        page.drawEllipse({ x: ux, y: uy, xScale: g.swap ? ry : rx, yScale: g.swap ? rx : ry, color: fill, borderColor: stroke,
          borderWidth: stroke ? width : 0, opacity: op, borderOpacity: op });
      } else if (t === 'line' || t === 'arrow') {
        const c = stroke || rgb(0, 0, 0);
        const seg = (x1, y1, x2, y2) => {
          const [a, b] = g.toUser(x1, y1), [cc, d] = g.toUser(x2, y2);
          page.drawLine({ start: { x: a, y: b }, end: { x: cc, y: d }, thickness: width, color: c, opacity: op, lineCap: LineCapStyle.Round });
        };
        seg(el.x1, el.y1, el.x2, el.y2);
        if (t === 'arrow') {
          const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1), Lh = 8 + width * 3;
          for (const dd of [2.6, -2.6]) seg(el.x2, el.y2, el.x2 + Lh * Math.cos(ang + dd), el.y2 + Lh * Math.sin(ang + dd));
        }
      } else if (t === 'path') {
        const pts = (el.points || []).map(([x, y]) => g.toUser(x, y));
        if (pts.length > 1) {
          const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' L ');
          page.drawSvgPath(d, { x: 0, y: 0, borderColor: stroke || rgb(0, 0, 0), borderWidth: width, borderOpacity: op, borderLineCap: LineCapStyle.Round });
        }
      }
    }
    return { files: [pdf(`${stem(inp.name)}_${o.suffix || 'editado'}.pdf`, await save(doc))] };
  };

  T.sign = (inputs, o) => T.edit(inputs, { ...o, suffix: 'firmado' });

  // =================================================================== SEGURIDAD
  T.protect = async (inputs, o) => {
    const pw = o.password || '';
    if (!pw) throw new Error('Escribe una contraseña.');
    if (o.confirm !== undefined && o.confirm !== null && o.confirm !== pw) throw new Error('Las contraseñas no coinciden.');
    const p = o.permissions || {};
    const yn = k => (p[k] ?? true) ? 'y' : 'n';
    const owner = o.owner_password || pw;
    const files = [];
    for (const inp of inputs) {
      const r = await u.qpdf(['--password=' + (o.current_password || ''), '--encrypt', pw, owner, '256',
        '--print=' + ((p.print ?? true) ? 'full' : 'none'), '--extract=' + yn('copy'), '--modify-other=' + yn('modify'),
        '--assemble=' + yn('modify'), '--annotate=' + yn('annotate'), '--form=' + yn('forms'), '--accessibility=y',
        '--', '/in.pdf', '/out.pdf'], inp.bytes);
      if (!r.out) throw new Error(inp.encrypted || /password/i.test(r.err) ? `${inp.name}: ya está protegido con contraseña; desbloquéalo primero.` : `No se pudo proteger ${inp.name}.`);
      files.push(pdf(`${stem(inp.name)}_protegido.pdf`, r.out));
    }
    return { files };
  };

  T.unlock = async (inputs, o) => {
    const files = [];
    for (const inp of inputs) {
      const r = await u.qpdf(['--password=' + (o.password || ''), '--decrypt', '/in.pdf', '/out.pdf'], inp.bytes);
      if (!r.out) throw new Error(inp.encrypted || /password/i.test(r.err) ? `${inp.name}: se necesita la contraseña correcta para abrirlo.` : `No se pudo desbloquear ${inp.name} (¿está dañado? prueba "Reparar PDF").`);
      files.push(pdf(`${stem(inp.name)}_desbloqueado.pdf`, r.out));
    }
    return { files };
  };

  const PATTERNS = {
    email: `[\\p{L}\\p{N}_.+-]+@[\\p{L}\\p{N}_-]+\\.[\\p{L}\\p{N}_.-]+`,
    phone: `\\+?\\d[\\d\\s().-]{7,}\\d`,
    card: `\\b(?:\\d[ -]?){13,19}\\b`,
    rut: `\\b\\d{1,2}\\.?\\d{3}\\.?\\d{3}-[\\dkK]\\b`,
    dni: `\\b\\d{8}[A-Za-z]\\b`,
    iban: `\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b`,
    date: `\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b`,
  };

  /** Coincidencias de texto/patrones: [{page, rect (visible), text}] */
  async function findRedactions(js, o) {
    const terms = (o.terms || []).filter(t => String(t).trim());
    const cs = !!o.case_sensitive;
    const pats = (o.patterns || []).filter(k => PATTERNS[k]).map(k => new RegExp(PATTERNS[k], 'gu'));
    const found = [];
    for (let i = 0; i < js.numPages; i++) {
      const lines = u.toLines(await u.textItems(await js.getPage(i + 1)));
      for (const line of lines) {
        const hay = cs ? line.text : line.text.toLowerCase();
        for (const t of terms) {
          const needle = cs ? t : t.toLowerCase();
          let k = hay.indexOf(needle);
          while (k >= 0) {
            const r = u.lineRange(line, k, k + needle.length);
            if (r) found.push({ page: i, rect: r, text: line.text.slice(k, k + needle.length) });
            k = hay.indexOf(needle, k + Math.max(1, needle.length));
          }
        }
        for (const rx of pats) {
          rx.lastIndex = 0;
          let m;
          while ((m = rx.exec(line.text))) {
            if (!m[0]) { rx.lastIndex++; continue; }
            const r = u.lineRange(line, m.index, m.index + m[0].length);
            if (r) found.push({ page: i, rect: r, text: m[0] });
          }
        }
      }
    }
    return found;
  }

  T.redact_preview = async (inputs, o) => {
    const js = await u.jsOpen(inputs[0].bytes);
    const hits = await findRedactions(js, o);
    js.destroy();
    return { files: [], data: { hits } };
  };

  /** Censura real: las páginas afectadas se convierten en imagen con las zonas tapadas (el contenido
      debajo deja de existir) y se les añade una capa de texto invisible con el resto del texto. */
  T.redact = async (inputs, o) => {
    const { PDFName } = await L.pdfLib();
    const inp = inputs[0];
    const fill = hexColor(o.fill || '#000000');
    const js = await u.jsOpen(inp.bytes);
    const boxes = [...await findRedactions(js, o), ...(o.areas || []).map(a => ({ page: +a.page, rect: a.rect }))];
    if (!boxes.length) { js.destroy(); throw new Error('No hay nada que censurar: marca áreas o busca texto.'); }
    const doc = await openLib(inp);
    const byPage = new Map();
    boxes.forEach(b => { if (!byPage.has(b.page)) byPage.set(b.page, []); byPage.get(b.page).push(b.rect); });
    const dpi = 200, z = dpi / 72;
    for (const [pi, rects] of byPage) {
      const jp = await js.getPage(pi + 1);
      const c = await u.renderJsPage(jp, z);
      const k = c.width / jp.getViewport({ scale: 1 }).width;
      const cx = c.getContext('2d');
      cx.fillStyle = `rgb(${fill.map(v => Math.round(v * 255)).join(',')})`;
      rects.forEach(([x0, y0, x1, y1]) => cx.fillRect(Math.floor(x0 * k) - 1, Math.floor(y0 * k) - 1, Math.ceil((x1 - x0) * k) + 2, Math.ceil((y1 - y0) * k) + 2));
      const old = doc.getPage(pi), g = geom(old);
      const page = doc.insertPage(pi, [g.W, g.H]);
      doc.removePage(pi + 1);
      const img = await doc.embedJpg(await u.canvasBytes(c, 'image/jpeg', 0.9));
      page.drawImage(img, { x: 0, y: 0, width: g.W, height: g.H });
      const hit = w => rects.some(([x0, y0, x1, y1]) => w.x0 < x1 && w.x1 > x0 && w.top < y1 && w.bottom > y0);
      const keep = u.words(await u.textItems(jp)).filter(w => !w.vertical && !hit(w));
      await u.invisibleText(doc, page, geom(page), keep);
    }
    js.destroy();
    if (o.clean_metadata !== false) {
      const info = doc.context.lookup(doc.context.trailerInfo.Info);
      if (info && info.keys) info.keys().forEach(k => info.delete(k));
      doc.catalog.delete(PDFName.of('Metadata'));
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return { files: [pdf(`${stem(inp.name)}_censurado.pdf`, bytes)], data: { count: boxes.length } };
  };

  // =================================================================== RECORTAR
  T.crop = async (inputs, o) => {
    const mode = o.mode || 'auto', pad = parseFloat(o.padding ?? 10);
    const files = [];
    for (const inp of inputs) {
      const doc = await openLib(inp);
      const js = mode === 'auto' ? await u.jsOpen(inp.bytes) : null;
      const targets = o.pages && o.pages !== 'all' ? parsePages(o.pages, doc.getPageCount()) : range(0, doc.getPageCount());
      for (const i of targets) {
        const page = doc.getPage(i), g = geom(page);
        let r;
        if (mode === 'auto') {
          const c = await u.renderJsPage(await js.getPage(i + 1), 1, { read: true });
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            const p = (y * c.width + x) * 4;
            if (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114 < 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) continue;
          const sx = g.W / c.width, sy = g.H / c.height;
          r = [x0 * sx - pad, y0 * sy - pad, (x1 + 1) * sx + pad, (y1 + 1) * sy + pad];
        } else r = o.rect;
        if (!r) continue;
        r = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(g.W, r[2]), Math.min(g.H, r[3])];
        if (r[2] - r[0] < 10 || r[3] - r[1] < 10) continue;
        const R = g.rectToUser(r);
        page.setCropBox(R.x, R.y, R.width, R.height);
      }
      js && js.destroy();
      files.push(pdf(`${stem(inp.name)}_recortado.pdf`, await save(doc)));
    }
    return { files };
  };

  // =================================================================== COMPARAR
  /** Diferencias entre dos listas de palabras al estilo difflib: [[tag, i1, i2, j1, j2], …] */
  function diffOps(a, b) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
    const n = A.length, m = B.length, max = n + m, off = max + 1;
    const edits = []; // secuencia de ['=',i,j] | ['-',i] | ['+',j]
    if (n === 0 || m === 0) {
      for (let i = 0; i < n; i++) edits.push(['-', i]);
      for (let j = 0; j < m; j++) edits.push(['+', j]);
    } else {
      const LIMIT = 3000; // pasos de edición; más allá se marca el resto como reemplazado
      let V = new Int32Array(2 * max + 3);
      const trace = [];
      let found = -1;
      for (let d = 0; d <= Math.min(max, LIMIT); d++) {
        trace.push(V.slice(off - d - 1, off + d + 2));
        for (let k = -d; k <= d; k += 2) {
          let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
          let y = x - k;
          while (x < n && y < m && A[x] === B[y]) { x++; y++; }
          V[off + k] = x;
          if (x >= n && y >= m) { found = d; break; }
        }
        if (found >= 0) break;
      }
      if (found < 0) {
        for (let i = 0; i < n; i++) edits.push(['-', i]);
        for (let j = 0; j < m; j++) edits.push(['+', j]);
      } else {
        let x = n, y = m;
        for (let d = found; d > 0; d--) {
          const Vd = trace[d], get = k => Vd[k + d + 1];
          const k = x - y;
          const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
          const prevX = get(prevK), prevY = prevX - prevK;
          while (x > prevX && y > prevY) { edits.push(['=', x - 1, y - 1]); x--; y--; }
          if (x === prevX) edits.push(['+', y - 1]); else edits.push(['-', x - 1]);
          x = prevX; y = prevY;
        }
        while (x > 0 && y > 0) { edits.push(['=', x - 1, y - 1]); x--; y--; }
        edits.reverse();
      }
    }
    // agrupar en opcodes
    const ops = [];
    let i = 0, j = 0, k = 0;
    while (k < edits.length) {
      if (edits[k][0] === '=') { i++; j++; k++; continue; }
      const i1 = i, j1 = j;
      while (k < edits.length && edits[k][0] !== '=') { if (edits[k][0] === '-') i++; else j++; k++; }
      ops.push([i > i1 && j > j1 ? 'replace' : i > i1 ? 'delete' : 'insert', i1 + pre, i + pre, j1 + pre, j + pre]);
    }
    return ops;
  }

  async function docWords(js) {
    const seq = [];
    for (let i = 0; i < js.numPages; i++) {
      const items = await u.textItems(await js.getPage(i + 1));
      for (const line of u.toLines(items)) for (const w of u.words(line.items)) seq.push({ text: w.text, page: i, rect: [w.x0, w.top, w.x1, w.bottom] });
    }
    return seq;
  }

  T.compare = async (inputs, o) => {
    const { rgb, BlendMode } = await L.pdfLib();
    if (inputs.length < 2) throw new Error('Sube dos archivos PDF para compararlos.');
    const [ja, jb] = [await u.jsOpen(inputs[0].bytes), await u.jsOpen(inputs[1].bytes)];
    const wa = await docWords(ja), wb = await docWords(jb);
    const ops = diffOps(wa.map(w => w.text), wb.map(w => w.text));
    const marksA = [], marksB = [], changes = [];
    for (const [tag, i1, i2, j1, j2] of ops) {
      wa.slice(i1, i2).forEach(w => marksA.push({ page: w.page, rect: w.rect, kind: tag === 'delete' ? 'del' : 'mod' }));
      wb.slice(j1, j2).forEach(w => marksB.push({ page: w.page, rect: w.rect, kind: tag === 'insert' ? 'ins' : 'mod' }));
      changes.push({
        type: { replace: 'Modificado', delete: 'Eliminado', insert: 'Añadido' }[tag],
        old: wa.slice(i1, i2).map(w => w.text).join(' ').slice(0, 300),
        new: wb.slice(j1, j2).map(w => w.text).join(' ').slice(0, 300),
        page_a: i2 > i1 ? wa[i1].page + 1 : null, page_b: j2 > j1 ? wb[j1].page + 1 : null,
      });
    }
    const colors = { del: rgb(0.9, 0.2, 0.2), ins: rgb(0.1, 0.7, 0.3), mod: rgb(1, 0.7, 0.1) };
    const marked = async (inp, marks) => {
      const doc = await openLib(inp);
      for (const m of marks) {
        const page = doc.getPage(m.page), g = geom(page);
        page.drawRectangle({ ...g.rectToUser(m.rect), color: colors[m.kind], opacity: 0.4, blendMode: BlendMode.Multiply });
      }
      return save(doc);
    };
    const files = [pdf(`comparado_A_${stem(inputs[0].name)}.pdf`, await marked(inputs[0], marksA)),
      pdf(`comparado_B_${stem(inputs[1].name)}.pdf`, await marked(inputs[1], marksB))];
    const visual = [];
    if (o.visual !== false) {
      for (let i = 0; i < Math.min(ja.numPages, jb.numPages, 60); i++) {
        const ca = await u.renderJsPage(await ja.getPage(i + 1), 60 / 72, { annots: false, read: true });
        const cb = await u.renderJsPage(await jb.getPage(i + 1), 60 / 72, { annots: false });
        const c2 = document.createElement('canvas'); c2.width = ca.width; c2.height = ca.height;
        const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(cb, 0, 0, ca.width, ca.height);
        const da = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height).data, db = x2.getImageData(0, 0, ca.width, ca.height).data;
        let cnt = 0;
        for (let p = 0; p < da.length; p += 4) {
          if (Math.abs(da[p] - db[p]) * 0.299 + Math.abs(da[p + 1] - db[p + 1]) * 0.587 + Math.abs(da[p + 2] - db[p + 2]) * 0.114 > 40) cnt++;
        }
        visual.push(Math.round(10000 * cnt / (ca.width * ca.height)) / 100);
      }
    }
    const data = { marks_a: marksA, marks_b: marksB, changes: changes.slice(0, 2000), pages_a: ja.numPages, pages_b: jb.numPages,
      visual_diff_pct: visual, identical: !changes.length };
    ja.destroy(); jb.destroy();
    return { files, zip_name: 'iwantpdf_comparacion.zip', data };
  };

  // =================================================================== FORMULARIOS
  // instanceof (los nombres de clase no sirven: pdf-lib.min.js está minificado)
  const typeOf = f => {
    const P = window.PDFLib;
    return f instanceof P.PDFTextField ? 'text' : f instanceof P.PDFCheckBox ? 'checkbox' : f instanceof P.PDFRadioGroup ? 'radio'
      : f instanceof P.PDFDropdown ? 'combobox' : f instanceof P.PDFOptionList ? 'listbox' : f instanceof P.PDFSignature ? 'signature' : undefined;
  };

  function pageIndexOfWidget(doc, widget) {
    const ref = doc.context.getObjectRef(widget.dict);
    const pages = doc.getPages();
    const p = widget.P && widget.P();
    if (p) { const i = pages.findIndex(pg => pg.ref === p || pg.ref.toString() === p.toString()); if (i >= 0) return i; }
    for (let i = 0; i < pages.length; i++) {
      const annots = pages[i].node.Annots();
      if (annots && ref && annots.asArray().some(a => a.toString() === ref.toString())) return i;
    }
    return 0;
  }

  /** Busca rectángulos y líneas dibujados (para sugerir casillas y campos de texto). */
  async function drawnShapes(jsPage, OPS) {
    const ol = await jsPage.getOperatorList();
    const vp = jsPage.getViewport({ scale: 1 });
    const out = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
    const ap = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const vis = pts => {
      const v = pts.map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = v.map(p => p[0]), ys = v.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], args = ol.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(args, ctm);
      else if (fn === OPS.constructPath) {
        const [ops, coords] = args;
        let c = 0, cur = null;
        const pts = [];
        let hasRect = false;
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = coords.slice(c, c + 4); c += 4;
            out.push(vis([ap(x, y), ap(x + w, y), ap(x, y + h), ap(x + w, y + h)])); hasRect = true;
          } else if (op === OPS.moveTo) { cur = ap(coords[c], coords[c + 1]); c += 2; pts.push(cur); }
          else if (op === OPS.lineTo) { const p = ap(coords[c], coords[c + 1]); c += 2; pts.push(p); cur = p; }
          else if (op === OPS.curveTo) c += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) c += 4;
        }
        if (!hasRect && pts.length > 1) out.push(vis(pts));
      }
    }
    return out;
  }

  T.forms_detect = async (inputs, o) => {
    const pdfjs = await L.pdfjs();
    const inp = inputs[0];
    const doc = await openLib(inp);
    const existing = [], suggested = [];
    let form;
    try { form = doc.getForm(); } catch { form = null; }
    if (form) {
      for (const f of form.getFields()) {
        const type = typeOf(f);
        if (!type) continue;
        let value = null, options = [];
        try {
          if (type === 'text') value = f.getText() || '';
          else if (type === 'checkbox') value = f.isChecked() ? 'Yes' : 'Off';
          else if (type === 'radio') value = f.getSelected() || 'Off';
          else if (type === 'combobox' || type === 'listbox') { value = (f.getSelected() || [])[0] || ''; options = f.getOptions(); }
        } catch { /* valor ilegible */ }
        for (const w of f.acroField.getWidgets()) {
          const pi = pageIndexOfWidget(doc, w);
          const g = geom(doc.getPage(pi));
          let on = null;
          try { on = w.getOnValue() ? w.getOnValue().decodeText() : null; } catch { on = null; }
          existing.push({ page: pi, name: f.getName(), type, rect: g.rectToVis(w.getRectangle()), value, options, on });
        }
      }
    }
    if (o.autodetect !== false) {
      const js = await u.jsOpen(inp.bytes);
      for (let i = 0; i < js.numPages; i++) {
        const jp = await js.getPage(i + 1);
        const items = await u.textItems(jp);
        // 1) secuencias de guiones bajos o puntos suspensivos
        for (const it of items) {
          const re = /[_…]{4,}/g;
          let m;
          while ((m = re.exec(it.str))) {
            const r = u.subRect(it, m.index, m.index + m[0].length);
            suggested.push({ page: i, type: 'text', rect: [r[0], r[3] - Math.max(14, it.size * 1.3), r[2], r[3]] });
          }
        }
        // 2) cuadrados pequeños -> casilla; 3) líneas largas sin texto encima -> texto
        const textAbove = (x0, x1, y) => items.some(it => it.x0 < x1 && it.x1 > x0 && it.bottom > y - 14 && it.top < y - 1);
        for (const [x0, y0, x1, y1] of await drawnShapes(jp, pdfjs.OPS)) {
          const w = x1 - x0, h = y1 - y0;
          if (w >= 6 && w <= 18 && h >= 6 && h <= 18 && Math.abs(w - h) < 2.5) suggested.push({ page: i, type: 'checkbox', rect: [x0, y0, x1, y1] });
          else if (w > 60 && h < 1.5 && !textAbove(x0, x1, y0)) suggested.push({ page: i, type: 'text', rect: [x0, y0 - 15, x1, y0 - 1] });
        }
      }
      js.destroy();
    }
    const inter = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const uniq = [];
    for (const s of suggested) {
      if (existing.some(e => e.page === s.page && inter(e.rect, s.rect))) continue;
      if (uniq.some(x => x.page === s.page && inter(x.rect, s.rect))) continue;
      uniq.push(s);
    }
    return { files: [], data: { fields: existing, suggested: uniq } };
  };

  T.forms = async (inputs, o) => {
    const P = await L.pdfLib();
    const { rgb, degrees, PDFName, PDFString } = P;
    const inp = inputs[0];
    const doc = await openLib(inp);
    const form = doc.getForm();
    const names = new Set(form.getFields().map(f => f.getName()));
    (o.new_fields || []).forEach((f, k) => {
      const page = doc.getPage(+f.page), g = geom(page);
      const R = g.rectToUser(f.rect);
      const base = f.name || `${f.type || 'campo'}_${k + 1}`;
      let name = base, n = 2;
      while (names.has(name)) name = `${base}_${n++}`;
      names.add(name);
      // pdf-lib gira el rectángulo según "rotate": se le pasa el que, ya girado, cae en R
      const pos = g.r === 90 ? { x: R.x + R.width, y: R.y, width: R.height, height: R.width }
        : g.r === 180 ? { x: R.x + R.width, y: R.y + R.height, width: R.width, height: R.height }
          : g.r === 270 ? { x: R.x, y: R.y + R.height, width: R.height, height: R.width } : { ...R };
      const look = { ...pos, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.6,
        backgroundColor: rgb(0.93, 0.95, 1), rotate: degrees(g.r) };
      const opts = (f.options && f.options.length) ? f.options : ['Opción 1', 'Opción 2'];
      let field;
      switch (f.type) {
        case 'checkbox': field = form.createCheckBox(name); field.addToPage(page, look); if (f.value) field.check(); break;
        case 'radio': field = form.createRadioGroup(name); field.addOptionToPage('Sí', page, look); break;
        case 'combobox': field = form.createDropdown(name); field.addOptions(opts); field.select(opts[0]); field.addToPage(page, look); break;
        case 'listbox': field = form.createOptionList(name); field.addOptions(opts); field.select(opts[0]); field.addToPage(page, look); break;
        case 'signature': {
          const ctx = doc.context;
          const dict = ctx.obj({ FT: 'Sig', Type: 'Annot', Subtype: 'Widget', F: 4, Rect: [R.x, R.y, R.x + R.width, R.y + R.height], P: page.ref,
            MK: { BC: [0.4, 0.4, 0.4], BG: [0.93, 0.95, 1] } });
          dict.set(PDFName.of('T'), PDFString.of(name));
          const ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, R.width, R.height] }));
          dict.set(PDFName.of('AP'), ctx.obj({ N: ap }));
          if (f.required) dict.set(PDFName.of('Ff'), ctx.obj(2));
          const ref = ctx.register(dict);
          page.node.addAnnot(ref);
          form.acroForm.addField(ref);
          break;
        }
        default:
          field = form.createTextField(name);
          if (f.value) field.setText(String(f.value));
          field.addToPage(page, look);
          if (parseFloat(f.font_size) > 0) field.setFontSize(parseFloat(f.font_size));
      }
      if (field && f.required) field.enableRequired();
    });
    const values = o.values || {};
    for (const [name, v] of Object.entries(values)) {
      let f;
      try { f = form.getField(name); } catch { continue; }
      const type = typeOf(f);
      try {
        if (type === 'text') f.setText(String(v ?? ''));
        else if (type === 'checkbox') (v === true || v === 'true' || v === 'on' || v === 'Yes') ? f.check() : f.uncheck();
        else if (type === 'radio') { if (v === true || v === 'true' || v === 'on') f.select(f.getOptions()[0]); else f.clear(); }
        else if (type === 'combobox' || type === 'listbox') f.select(String(v));
      } catch (e) { throw new Error(`No se pudo rellenar el campo "${name}": ${e.message}`); }
    }
    try {
      const font = await stdFont(doc, 'Arial');
      form.updateFieldAppearances(font);
      if (o.flatten) form.flatten();
    } catch (e) {
      throw new Error(/encode/i.test(e.message) ? 'Algún valor tiene caracteres que la fuente estándar no admite.' : 'No se pudo guardar el formulario: ' + e.message);
    }
    return { files: [pdf(`${stem(inp.name)}_formulario.pdf`, await save(doc))] };
  };

  IW.diffOps = diffOps; // para pruebas
})();
