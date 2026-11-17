"""Operaciones PDF puras (PyMuPDF + pikepdf). Firma común:

    fn(inputs: list[Path], opts: dict, out: Path) -> {"files": [Path], "data": {...}}
"""
import base64
import difflib
import io
import os
import re
from pathlib import Path

import pymupdf as fitz
import pikepdf
from PIL import Image, ImageChops, ImageOps

from .store import IMAGE_EXT, open_pdf

FONT_DIR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
FONTS = {
    # nombre visible: (normal, negrita, cursiva, negrita-cursiva, base14 de respaldo)
    "Arial": ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf", "helv"),
    "Times New Roman": ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf", "tiro"),
    "Courier New": ("cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf", "cour"),
    "Verdana": ("verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf", "helv"),
    "Georgia": ("georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf", "tiro"),
    "Comic Sans MS": ("comic.ttf", "comicbd.ttf", "comici.ttf", "comicz.ttf", "helv"),
    "Segoe Script": ("segoesc.ttf", "segoescb.ttf", "segoesc.ttf", "segoescb.ttf", "helv"),
}
_font_cache = {}


def font_for(name="Arial", bold=False, italic=False) -> fitz.Font:
    key = (name, bold, italic)
    if key not in _font_cache:
        spec = FONTS.get(name, FONTS["Arial"])
        f = FONT_DIR / spec[(1 if bold else 0) + (2 if italic else 0)]
        _font_cache[key] = fitz.Font(fontfile=str(f)) if f.exists() else fitz.Font(spec[4])
    return _font_cache[key]


def hex_color(h, default=(0, 0, 0)):
    if not h:
        return default
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def parse_pages(spec, n, default_all=True) -> list[int]:
    """'1-3,5,8-' -> índices 0-based. Vacío/'all' -> todas."""
    if spec in (None, "", "all", "todas"):
        return list(range(n)) if default_all else []
    if isinstance(spec, list):
        return [int(i) for i in spec if 0 <= int(i) < n]
    res = []
    for part in str(spec).replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            a = int(a) if a else 1
            b = int(b) if b else n
            res.extend(range(a - 1, min(b, n)))
        else:
            i = int(part) - 1
            if 0 <= i < n:
                res.append(i)
    return [i for i in res if 0 <= i < n]


def stem(p: Path) -> str:
    return p.stem[:80]


def save_pdf(doc: fitz.Document, dest: Path, **kw) -> Path:
    try:
        doc.subset_fonts()  # las fuentes TTF añadidas (Arial, etc.) se incrustan solo con los glifos usados
    except Exception:  # noqa: BLE001
        pass
    doc.save(dest, garbage=kw.get("garbage", 3), deflate=True, clean=kw.get("clean", False))
    return dest


def unrotate(doc):
    """Quita la rotación de las páginas para que las coordenadas visibles == coordenadas de página."""
    for pg in doc:
        if pg.rotation and hasattr(pg, "remove_rotation"):
            pg.remove_rotation()


# =================================================================== ORGANIZAR
def merge(inputs, opts, out):
    doc = fitz.open()
    for p in inputs:
        with open_pdf(p) as src:
            doc.insert_pdf(src)
    name = opts.get("filename") or "iwantpdf_unido.pdf"
    return {"files": [save_pdf(doc, out / name, garbage=4)]}


def split(inputs, opts, out):
    mode = opts.get("mode", "ranges")
    files = []
    for p in inputs:
        with open_pdf(p) as src:
            n = src.page_count
            groups = []  # lista de (etiqueta, [páginas])
            if mode == "ranges":
                for r in opts.get("ranges") or [{"from": 1, "to": n}]:
                    a, b = max(1, int(r["from"])), min(n, int(r["to"]))
                    if a <= b:
                        groups.append((f"{a}-{b}", list(range(a - 1, b))))
                if opts.get("merge_all"):
                    groups = [("rangos", [i for _, g in groups for i in g])]
            elif mode == "fixed":
                k = max(1, int(opts.get("every", 1)))
                groups = [(f"{i + 1}-{min(i + k, n)}", list(range(i, min(i + k, n)))) for i in range(0, n, k)]
            elif mode == "all":
                groups = [(str(i + 1), [i]) for i in range(n)]
            elif mode == "select":
                sel = parse_pages(opts.get("pages"), n, default_all=False)
                if not sel:
                    raise ValueError("Indica qué páginas extraer, p. ej. 1,3,5-7")
                groups = [(str(i + 1), [i]) for i in sel] if opts.get("separate") else [("extraidas", sel)]
            elif mode == "size":
                limit = float(opts.get("max_mb", 5)) * 1024 * 1024
                cur = []
                for i in range(n):
                    trial = fitz.open()
                    trial.insert_pdf(src, from_page=cur[0] if cur else i, to_page=i)
                    if cur and len(trial.tobytes(garbage=3, deflate=True)) > limit:
                        groups.append((f"{cur[0] + 1}-{cur[-1] + 1}", cur))
                        cur = []
                    cur.append(i)
                    trial.close()
                if cur:
                    groups.append((f"{cur[0] + 1}-{cur[-1] + 1}", cur))
            for label, pages in groups:
                d = fitz.open()
                for i in pages:
                    d.insert_pdf(src, from_page=i, to_page=i)
                files.append(save_pdf(d, out / f"{stem(p)}_{label}.pdf"))
                d.close()
    return {"files": files, "zip_name": "iwantpdf_dividido.zip"}


def rotate(inputs, opts, out):
    """opts: angle (global, por archivo) o per_page {"<fileIdx>": {"<pageIdx>": angle}}."""
    files = []
    per = opts.get("per_page") or {}
    for fi, p in enumerate(inputs):
        with open_pdf(p) as doc:
            glob = int(opts.get("angles", {}).get(str(fi), opts.get("angle", 90)))
            for i, pg in enumerate(doc):
                a = int(per.get(str(fi), {}).get(str(i), 0)) if per else glob
                pg.set_rotation((pg.rotation + a) % 360)
            files.append(save_pdf(doc, out / f"{stem(p)}_rotado.pdf"))
    return {"files": files}


def organize(inputs, opts, out):
    """opts.pages: [{"f": idxArchivo, "p": idxPagina, "r": rotación extra} | {"blank": true}]"""
    srcs = [open_pdf(p) for p in inputs]
    doc = fitz.open()
    try:
        seq = opts.get("pages") or [{"f": 0, "p": i} for i in range(srcs[0].page_count)]
        for item in seq:
            if item.get("blank"):
                ref = doc[-1].rect if doc.page_count else fitz.paper_rect("a4")
                doc.new_page(width=ref.width, height=ref.height)
                continue
            src = srcs[int(item["f"])]
            pno = int(item["p"])
            doc.insert_pdf(src, from_page=pno, to_page=pno)
            if item.get("r"):
                pg = doc[-1]
                pg.set_rotation((pg.rotation + int(item["r"])) % 360)
        name = f"{stem(inputs[0])}_ordenado.pdf"
        return {"files": [save_pdf(doc, out / name, garbage=4)]}
    finally:
        for s in srcs:
            s.close()


# =================================================================== OPTIMIZAR
COMPRESS_LEVELS = {
    "low": dict(dpi_threshold=220, dpi_target=200, quality=85),
    "recommended": dict(dpi_threshold=150, dpi_target=130, quality=65),
    "extreme": dict(dpi_threshold=96, dpi_target=72, quality=40),
}


def _recompress_images_manual(doc, dpi_target, quality, gray):
    done = set()
    for pg in doc:
        for img in pg.get_images(full=True):
            xref = img[0]
            if xref in done:
                continue
            done.add(xref)
            try:
                rects = pg.get_image_rects(xref)
                pix = fitz.Pixmap(doc, xref)
                if pix.alpha or pix.n > 4:
                    continue
                if pix.n == 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                im = Image.frombytes("RGB" if pix.n >= 3 else "L", (pix.width, pix.height), pix.samples)
                if rects:
                    r = rects[0]
                    max_w = int(r.width / 72 * dpi_target) or im.width
                    if im.width > max_w * 1.1:
                        im = im.resize((max_w, max(1, int(im.height * max_w / im.width))), Image.LANCZOS)
                if gray:
                    im = im.convert("L")
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=quality, optimize=True)
                pg.replace_image(xref, stream=buf.getvalue())
            except Exception:  # noqa: BLE001 - imagen no soportada: se deja igual
                continue


def compress(inputs, opts, out):
    level = opts.get("level", "recommended")
    cfg = COMPRESS_LEVELS.get(level, COMPRESS_LEVELS["recommended"])
    gray = bool(opts.get("grayscale"))
    files, stats = [], []
    for p in inputs:
        before = p.stat().st_size
        with open_pdf(p) as doc:
            if hasattr(doc, "rewrite_images") and not gray:
                doc.rewrite_images(dpi_threshold=cfg["dpi_threshold"], dpi_target=cfg["dpi_target"],
                                   quality=cfg["quality"], lossy=True, lossless=True, bitonal=True,
                                   color=True, gray=True)
            else:
                _recompress_images_manual(doc, cfg["dpi_target"], cfg["quality"], gray)
            try:
                doc.subset_fonts()
            except Exception:  # noqa: BLE001
                pass
            if level == "extreme":
                doc.scrub(metadata=False, xml_metadata=True, thumbnails=True, attached_files=False,
                          embedded_files=False, javascript=True, reset_fields=False,
                          reset_responses=False, hidden_text=False, redactions=False, redact_images=0,
                          remove_links=False)
            dest = out / f"{stem(p)}_comprimido.pdf"
            doc.save(dest, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True,
                     clean=True, use_objstms=1)
        after = dest.stat().st_size
        if after >= before:  # no empeorar nunca el archivo
            dest.write_bytes(p.read_bytes())
            after = before
        files.append(dest)
        stats.append({"name": p.name, "before": before, "after": after})
    return {"files": files, "data": {"stats": stats}}


def repair(inputs, opts, out):
    files, notes = [], []
    for p in inputs:
        dest = out / f"{stem(p)}_reparado.pdf"
        try:
            with pikepdf.open(p, attempt_recovery=True) as pdf:
                pdf.save(dest, fix_metadata_version=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
            notes.append(f"{p.name}: estructura reconstruida con qpdf")
        except Exception as e1:  # noqa: BLE001
            try:
                doc = fitz.open(p)
                doc.save(dest, garbage=4, deflate=True, clean=True)
                doc.close()
                notes.append(f"{p.name}: reconstruido con MuPDF")
            except Exception as e2:  # noqa: BLE001
                raise ValueError(f"No se pudo reparar {p.name}: {e1} / {e2}") from e2
        files.append(dest)
    return {"files": files, "data": {"notes": notes}}


def pdfa(inputs, opts, out):
    """Conversión a PDF/A (1b, 2b o 3b) en modo "mejor esfuerzo": incrusta fuentes, quita cifrado,
    JavaScript y transparencias problemáticas, añade OutputIntent sRGB y metadatos XMP de conformidad."""
    part = str(opts.get("level", "2b"))[0]
    icc = None
    for cand in [Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32/spool/drivers/color/sRGB Color Space Profile.icm"]:
        if cand.exists():
            icc = cand.read_bytes()
    files, warnings = [], []
    for p in inputs:
        tmp = out / f"_{stem(p)}_tmp.pdf"
        with open_pdf(p) as doc:
            doc.scrub(metadata=False, xml_metadata=True, javascript=True, thumbnails=False,
                      attached_files=part != "3", embedded_files=part != "3", reset_fields=False,
                      reset_responses=False, hidden_text=False, redactions=False, redact_images=0,
                      remove_links=False)
            for pg in doc:
                for f in pg.get_fonts():
                    if f[1] in ("n/a", "") or not f[1]:
                        warnings.append(f"{p.name}: la fuente '{f[3]}' no está incrustada")
            doc.save(tmp, garbage=3, deflate=True)
        dest = out / f"{stem(p)}_pdfa.pdf"
        with pikepdf.open(tmp) as pdf:
            with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
                meta.load_from_docinfo(pdf.docinfo)
                meta["pdfaid:part"] = part
                meta["pdfaid:conformance"] = "B"
            if icc:
                stream = pikepdf.Stream(pdf, icc)
                stream["/N"] = 3
                intent = pikepdf.Dictionary(Type=pikepdf.Name.OutputIntent, S=pikepdf.Name.GTS_PDFA1,
                                            OutputConditionIdentifier=pikepdf.String("sRGB IEC61966-2.1"),
                                            Info=pikepdf.String("sRGB IEC61966-2.1"),
                                            DestOutputProfile=stream)
                pdf.Root.OutputIntents = pikepdf.Array([pdf.make_indirect(intent)])
            if "/AA" in pdf.Root:
                del pdf.Root["/AA"]
            pdf.save(dest, fix_metadata_version=True, min_version="1.4" if part == "1" else "1.7")
        tmp.unlink(missing_ok=True)
        files.append(dest)
    return {"files": files, "data": {"warnings": sorted(set(warnings))}}


# =================================================================== IMÁGENES
def pdf_to_jpg(inputs, opts, out):
    mode = opts.get("mode", "pages")
    dpi = int(opts.get("dpi", 150))
    fmt = opts.get("format", "jpg")
    quality = int(opts.get("quality", 90))
    files = []
    for p in inputs:
        with open_pdf(p) as doc:
            if mode == "images":
                seen = set()
                for pi, pg in enumerate(doc):
                    for k, img in enumerate(pg.get_images(full=True)):
                        if img[0] in seen:
                            continue
                        seen.add(img[0])
                        info = doc.extract_image(img[0])
                        if not info or info.get("width", 0) < 16:
                            continue
                        ext = info["ext"] if info["ext"] in ("jpg", "jpeg", "png") else "png"
                        data = info["image"]
                        if ext != info["ext"] or info.get("smask"):
                            pix = fitz.Pixmap(doc, img[0])
                            if info.get("smask"):
                                pix = fitz.Pixmap(pix, fitz.Pixmap(doc, info["smask"]))
                            if pix.n - pix.alpha >= 4:
                                pix = fitz.Pixmap(fitz.csRGB, pix)
                            data, ext = pix.tobytes("png"), "png"
                        dest = out / f"{stem(p)}_p{pi + 1}_img{k + 1}.{ext}"
                        dest.write_bytes(data)
                        files.append(dest)
            else:
                for i, pg in enumerate(doc):
                    pix = pg.get_pixmap(dpi=dpi, alpha=False)
                    dest = out / f"{stem(p)}_pagina_{i + 1}.{ 'png' if fmt == 'png' else 'jpg'}"
                    if fmt == "png":
                        pix.save(dest)
                    else:
                        dest.write_bytes(pix.tobytes("jpg", jpg_quality=quality))
                    files.append(dest)
    if not files:
        raise ValueError("No se encontraron imágenes en el PDF.")
    return {"files": files, "zip_name": "iwantpdf_imagenes.zip"}


PAPER = {"A4": fitz.paper_size("a4"), "Letter": fitz.paper_size("letter"), "Legal": fitz.paper_size("legal"),
         "A3": fitz.paper_size("a3"), "A5": fitz.paper_size("a5")}
MARGINS = {"none": 0, "small": 20, "big": 50}


def _image_page(doc, img_path: Path, opts):
    im = Image.open(img_path)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, "white")
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=int(opts.get("quality", 92)))
    iw, ih = im.size
    size = opts.get("page_size", "A4")
    margin = MARGINS.get(opts.get("margin", "none"), 0)
    orient = opts.get("orientation", "portrait")
    if size == "fit":
        w, h = iw * 72 / 96, ih * 72 / 96
        pw, ph = w + 2 * margin, h + 2 * margin
    else:
        pw, ph = PAPER.get(size, PAPER["A4"])
        landscape = orient == "landscape" or (orient == "auto" and iw > ih)
        if landscape:
            pw, ph = max(pw, ph), min(pw, ph)
        else:
            pw, ph = min(pw, ph), max(pw, ph)
    page = doc.new_page(width=pw, height=ph)
    page.insert_image(fitz.Rect(margin, margin, pw - margin, ph - margin), stream=buf.getvalue(),
                      keep_proportion=True)


def jpg_to_pdf(inputs, opts, out):
    imgs = [p for p in inputs if p.suffix.lower() in IMAGE_EXT]
    if not imgs:
        raise ValueError("Sube imágenes (JPG, PNG, …).")
    if opts.get("merge", True):
        doc = fitz.open()
        for p in imgs:
            _image_page(doc, p, opts)
        return {"files": [save_pdf(doc, out / (opts.get("filename") or "iwantpdf_imagenes.pdf"))]}
    files = []
    for p in imgs:
        doc = fitz.open()
        _image_page(doc, p, opts)
        files.append(save_pdf(doc, out / f"{stem(p)}.pdf"))
    return {"files": files}


def scan_to_pdf(inputs, opts, out):
    """Igual que JPG a PDF pero con filtro de documento (color / gris / blanco y negro + contraste)."""
    filt = opts.get("filter", "color")
    tmp_paths = []
    for i, p in enumerate(inputs):
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        if filt in ("gray", "bw"):
            im = ImageOps.autocontrast(im.convert("L"), cutoff=2)
            if filt == "bw":
                im = im.point(lambda v: 255 if v > 150 else 0, "1").convert("L")
        else:
            im = ImageOps.autocontrast(im, cutoff=1)
        t = out / f"_scan_{i}.jpg"
        im.save(t, "JPEG", quality=88)
        tmp_paths.append(t)
    o = dict(opts, merge=True, page_size=opts.get("page_size", "A4"), orientation="auto",
             margin=opts.get("margin", "none"), filename=opts.get("filename") or "iwantpdf_escaneo.pdf")
    res = jpg_to_pdf(tmp_paths, o, out)
    for t in tmp_paths:
        t.unlink(missing_ok=True)
    return res


# =================================================================== EDITAR
POSITIONS = {
    "top-left": (0, 0), "top-center": (0.5, 0), "top-right": (1, 0),
    "middle-left": (0, 0.5), "center": (0.5, 0.5), "middle-right": (1, 0.5),
    "bottom-left": (0, 1), "bottom-center": (0.5, 1), "bottom-right": (1, 1),
}


def _text_block_size(text, font: fitz.Font, size):
    lines = text.split("\n")
    w = max(font.text_length(line, fontsize=size) for line in lines)
    return w, size * 1.2 * len(lines), lines


def _write_text(page, text, font, size, color, opacity, center, angle, overlay=True):
    """Escribe texto multilínea centrado en `center` y rotado `angle` grados."""
    w, h, lines = _text_block_size(text, font, size)
    tw = fitz.TextWriter(page.rect)
    y = center.y - h / 2 + size * 0.95
    for line in lines:
        lw = font.text_length(line, fontsize=size)
        tw.append(fitz.Point(center.x - lw / 2, y), line, font=font, fontsize=size)
        y += size * 1.2
    tw.write_text(page, color=color, opacity=opacity, overlay=overlay,
                  morph=(center, fitz.Matrix(angle)) if angle else None)  # ángulo positivo = sube hacia la derecha


def watermark(inputs, opts, out):
    kind = opts.get("type", "text")
    pos = opts.get("position", "center")
    opacity = max(0.05, min(1.0, float(opts.get("opacity", 50)) / 100))
    angle = float(opts.get("rotation", 0))
    overlay = opts.get("layer", "over") != "under"
    mosaic = bool(opts.get("mosaic"))
    img_bytes = None
    if kind == "image":
        if not opts.get("image"):
            raise ValueError("Elige una imagen para la marca de agua.")
        raw = base64.b64decode(opts["image"].split(",", 1)[-1])
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        alpha = im.split()[-1].point(lambda a: int(a * opacity))
        im.putalpha(alpha)
        if angle:
            im = im.rotate(angle, expand=True, resample=Image.BICUBIC)
        b = io.BytesIO()
        im.save(b, "PNG")
        img_bytes, img_size = b.getvalue(), im.size
        scale = float(opts.get("image_scale", 30)) / 100  # % del ancho de página
    font = font_for(opts.get("font", "Arial"), opts.get("bold"), opts.get("italic"))
    size = float(opts.get("font_size", 48))
    color = hex_color(opts.get("color", "#d93025"))
    text = opts.get("text") or "CONFIDENCIAL"
    files = []
    for p in inputs:
        with open_pdf(p) as doc:
            unrotate(doc)
            for i in parse_pages(opts.get("pages"), doc.page_count):
                pg = doc[i]
                R = pg.rect
                if kind == "text":
                    bw, bh, _ = _text_block_size(text, font, size)
                else:
                    bw = R.width * scale
                    bh = bw * img_size[1] / img_size[0]
                if mosaic:
                    step_x, step_y = bw * 1.6 + 40, bh * 3 + 60
                    centers = [fitz.Point(x, y) for y in _frange(step_y / 2, R.height, step_y)
                               for x in _frange(step_x / 2, R.width, step_x)]
                else:
                    fx, fy = POSITIONS.get(pos, (0.5, 0.5))
                    m = 36
                    cx = m + bw / 2 + fx * (R.width - 2 * m - bw)
                    cy = m + bh / 2 + fy * (R.height - 2 * m - bh)
                    centers = [fitz.Point(cx, cy)]
                for c in centers:
                    if kind == "text":
                        _write_text(pg, text, font, size, color, opacity, c, angle, overlay)
                    else:
                        r = fitz.Rect(c.x - bw / 2, c.y - bh / 2, c.x + bw / 2, c.y + bh / 2)
                        pg.insert_image(r, stream=img_bytes, overlay=overlay, keep_proportion=True)
            files.append(save_pdf(doc, out / f"{stem(p)}_marca_agua.pdf"))
    return {"files": files}


def _frange(a, b, s):
    while a < b:
        yield a
        a += s


def page_numbers(inputs, opts, out):
    pos = opts.get("position", "bottom-center")
    margin = {"small": 18, "recommended": 30, "big": 50}.get(opts.get("margin", "recommended"), 30)
    first = int(opts.get("first_number", 1))
    tmpl = opts.get("text", "{n}") or "{n}"
    size = float(opts.get("font_size", 12))
    font = font_for(opts.get("font", "Arial"), opts.get("bold"), opts.get("italic"))
    color = hex_color(opts.get("color", "#000000"))
    facing = bool(opts.get("facing"))
    files = []
    for p in inputs:
        with open_pdf(p) as doc:
            unrotate(doc)
            n = doc.page_count
            frm = max(1, int(opts.get("from", 1) or 1))
            to = min(n, int(opts.get("to", n) or n))
            total = to - frm + 1 + first - 1
            for k, i in enumerate(range(frm - 1, to)):
                pg = doc[i]
                R = pg.rect
                label = tmpl.replace("{n}", str(first + k)).replace("{p}", str(total))
                w = font.text_length(label, fontsize=size)
                fx, fy = POSITIONS.get(pos, (0.5, 1))
                if facing and fx != 0.5 and (first + k) % 2 == 0:
                    fx = 1 - fx  # en páginas pares se refleja la posición
                x = margin + fx * (R.width - 2 * margin - w)
                y = margin + size + fy * (R.height - 2 * margin - size)
                tw = fitz.TextWriter(R)
                tw.append(fitz.Point(x, y - size * 0.2), label, font=font, fontsize=size)
                tw.write_text(pg, color=color)
            files.append(save_pdf(doc, out / f"{stem(p)}_numerado.pdf"))
    return {"files": files}


def _data_url_bytes(s):
    return base64.b64decode(s.split(",", 1)[-1])


def edit(inputs, opts, out):
    """Aplica elementos dibujados en el editor. Coordenadas en puntos PDF de la página sin rotar.
    elements: [{page, type: text|image|rect|ellipse|line|arrow|path|highlight|whiteout, ...}]"""
    p = inputs[0]
    with open_pdf(p) as doc:
        unrotate(doc)
        for el in opts.get("elements", []):
            pg = doc[int(el["page"])]
            t = el["type"]
            r = fitz.Rect(el.get("rect") or (0, 0, 0, 0))
            stroke = hex_color(el.get("stroke"), None) if el.get("stroke") else None
            fill = hex_color(el.get("fill"), None) if el.get("fill") else None
            width = float(el.get("width", 2))
            op = float(el.get("opacity", 1))
            if t == "text":
                font = font_for(el.get("font", "Arial"), el.get("bold"), el.get("italic"))
                size = float(el.get("size", 14))
                tw = fitz.TextWriter(pg.rect)
                y = r.y0 + size * 0.95
                for line in str(el.get("text", "")).split("\n"):
                    lw = font.text_length(line, fontsize=size)
                    x = r.x0 if el.get("align") != "center" else r.x0 + (r.width - lw) / 2
                    tw.append(fitz.Point(x, y), line, font=font, fontsize=size)
                    y += size * 1.2
                tw.write_text(pg, color=hex_color(el.get("color", "#000000")), opacity=op)
            elif t == "image":
                pg.insert_image(r, stream=_data_url_bytes(el["src"]), keep_proportion=False)
            elif t in ("rect", "whiteout", "highlight"):
                if t == "whiteout":
                    stroke, fill, op = None, (1, 1, 1), 1
                if t == "highlight":
                    stroke, fill, op = None, hex_color(el.get("fill", "#ffeb3b")), 0.4
                pg.draw_rect(r, color=stroke, fill=fill, width=width if stroke else 0,
                             fill_opacity=op, stroke_opacity=op)
            elif t == "ellipse":
                pg.draw_oval(r, color=stroke, fill=fill, width=width, fill_opacity=op, stroke_opacity=op)
            elif t in ("line", "arrow"):
                a, b = fitz.Point(el["x1"], el["y1"]), fitz.Point(el["x2"], el["y2"])
                pg.draw_line(a, b, color=stroke or (0, 0, 0), width=width, stroke_opacity=op)
                if t == "arrow":
                    import math
                    ang = math.atan2(b.y - a.y, b.x - a.x)
                    L = 8 + width * 3
                    for d in (2.6, -2.6):
                        pg.draw_line(b, fitz.Point(b.x + L * math.cos(ang + d), b.y + L * math.sin(ang + d)),
                                     color=stroke or (0, 0, 0), width=width, stroke_opacity=op)
            elif t == "path":
                pts = [fitz.Point(x, y) for x, y in el["points"]]
                if len(pts) > 1:
                    pg.draw_polyline(pts, color=stroke or (0, 0, 0), width=width, stroke_opacity=op,
                                     closePath=False, lineCap=1, lineJoin=1)
        suffix = opts.get("suffix", "editado")
        return {"files": [save_pdf(doc, out / f"{stem(p)}_{suffix}.pdf", garbage=3)]}


def sign(inputs, opts, out):
    return edit(inputs, dict(opts, suffix="firmado"), out)


# =================================================================== SEGURIDAD
def protect(inputs, opts, out):
    pw = opts.get("password") or ""
    if len(pw) < 1:
        raise ValueError("Escribe una contraseña.")
    if opts.get("confirm") is not None and opts.get("confirm") != pw:
        raise ValueError("Las contraseñas no coinciden.")
    perms = opts.get("permissions", {})
    allow = pikepdf.Permissions(
        print_lowres=perms.get("print", True), print_highres=perms.get("print", True),
        extract=perms.get("copy", True), modify_other=perms.get("modify", True),
        modify_annotation=perms.get("annotate", True), modify_form=perms.get("forms", True),
        modify_assembly=perms.get("modify", True), accessibility=True)
    owner = opts.get("owner_password") or pw
    files = []
    for p in inputs:
        dest = out / f"{stem(p)}_protegido.pdf"
        with pikepdf.open(p, password=opts.get("current_password", "")) as pdf:
            pdf.save(dest, encryption=pikepdf.Encryption(owner=owner, user=pw, R=6, allow=allow, aes=True))
        files.append(dest)
    return {"files": files}


def unlock(inputs, opts, out):
    files = []
    for p in inputs:
        dest = out / f"{stem(p)}_desbloqueado.pdf"
        try:
            pdf = pikepdf.open(p, password=opts.get("password", ""))
        except pikepdf.PasswordError as e:
            raise ValueError(f"{p.name}: se necesita la contraseña correcta para abrirlo.") from e
        with pdf:
            pdf.save(dest)  # sin parámetro encryption -> se guarda sin cifrado ni restricciones
        files.append(dest)
    return {"files": files}


PATTERNS = {
    "email": r"[\w.+-]+@[\w-]+\.[\w.-]+",
    "phone": r"\+?\d[\d\s().-]{7,}\d",
    "card": r"\b(?:\d[ -]?){13,19}\b",
    "rut": r"\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b",
    "dni": r"\b\d{8}[A-Za-z]\b",
    "iban": r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b",
    "date": r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
}


def _find_redactions(doc, opts):
    found = []  # (pageIdx, Rect, texto)
    terms = [t for t in (opts.get("terms") or []) if t.strip()]
    cs = bool(opts.get("case_sensitive"))
    pats = [re.compile(PATTERNS[k]) for k in opts.get("patterns", []) if k in PATTERNS]
    for i, pg in enumerate(doc):
        for t in terms:
            for r in pg.search_for(t):
                if cs and t not in pg.get_textbox(r + (-1, -1, 1, 1)):
                    continue
                found.append((i, r, t))
        if pats:
            for line in _lines(pg):
                text, boxes = line
                for rx in pats:
                    for m in rx.finditer(text):
                        rr = fitz.Rect()
                        for (a, b, wr) in boxes:
                            if a < m.end() and b > m.start():
                                rr |= wr
                        if not rr.is_empty:
                            found.append((i, rr, m.group()))
    return found


def _lines(pg):
    """Devuelve líneas como (texto, [(ini, fin, rect_palabra)])."""
    lines = {}
    for w in pg.get_text("words", sort=True):
        key = (w[5], w[6])
        lines.setdefault(key, []).append(w)
    res = []
    for ws in lines.values():
        text, boxes = "", []
        for w in ws:
            if text:
                text += " "
            boxes.append((len(text), len(text) + len(w[4]), fitz.Rect(w[:4])))
            text += w[4]
        res.append((text, boxes))
    return res


def redact_preview(inputs, opts, out):
    with open_pdf(inputs[0]) as doc:
        unrotate(doc)
        hits = [{"page": i, "rect": list(r), "text": t} for i, r, t in _find_redactions(doc, opts)]
    return {"files": [], "data": {"hits": hits}}


def redact(inputs, opts, out):
    fill = hex_color(opts.get("fill", "#000000"))
    p = inputs[0]
    with open_pdf(p) as doc:
        unrotate(doc)
        n = 0
        for i, r, _ in _find_redactions(doc, opts):
            doc[i].add_redact_annot(r, fill=fill)
            n += 1
        for a in opts.get("areas", []):
            doc[int(a["page"])].add_redact_annot(fitz.Rect(a["rect"]), fill=fill)
            n += 1
        for pg in doc:
            pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
                                if hasattr(fitz, "PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED") else 0)
        if opts.get("clean_metadata", True):
            doc.set_metadata({})
            doc.del_xml_metadata()
        dest = save_pdf(doc, out / f"{stem(p)}_censurado.pdf", garbage=4, clean=True)
    return {"files": [dest], "data": {"count": n}}


# =================================================================== RECORTAR
def _content_bbox(pg, threshold=245):
    pix = pg.get_pixmap(dpi=72, alpha=False, colorspace=fitz.csGRAY)
    im = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    mask = im.point(lambda v: 255 if v < threshold else 0)
    bb = mask.getbbox()
    if not bb:
        return None
    sx, sy = pg.rect.width / pix.width, pg.rect.height / pix.height
    return fitz.Rect(bb[0] * sx, bb[1] * sy, bb[2] * sx, bb[3] * sy)


def crop(inputs, opts, out):
    mode = opts.get("mode", "auto")
    pad = float(opts.get("padding", 10))
    files = []
    for p in inputs:
        with open_pdf(p) as doc:
            unrotate(doc)
            targets = parse_pages(opts.get("pages"), doc.page_count) if opts.get("pages") not in (None, "all") else range(doc.page_count)
            for i in targets:
                pg = doc[i]
                if mode == "auto":
                    r = _content_bbox(pg)
                    if not r:
                        continue
                    r = (r + (-pad, -pad, pad, pad)) & pg.rect
                else:
                    r = fitz.Rect(opts["rect"]) & pg.rect
                if r.is_empty or r.width < 10 or r.height < 10:
                    continue
                cb = pg.cropbox
                pg.set_cropbox(fitz.Rect(r.x0 + cb.x0, r.y0 + cb.y0, r.x1 + cb.x0, r.y1 + cb.y0))
            files.append(save_pdf(doc, out / f"{stem(p)}_recortado.pdf"))
    return {"files": files}


# =================================================================== COMPARAR
def _doc_words(doc):
    seq = []
    for i, pg in enumerate(doc):
        for w in pg.get_text("words", sort=True):
            seq.append((w[4], i, fitz.Rect(w[:4])))
    return seq


def compare(inputs, opts, out):
    if len(inputs) < 2:
        raise ValueError("Sube dos archivos PDF para compararlos.")
    a, b = open_pdf(inputs[0]), open_pdf(inputs[1])
    try:
        unrotate(a)
        unrotate(b)
        wa, wb = _doc_words(a), _doc_words(b)
        sm = difflib.SequenceMatcher(None, [w[0] for w in wa], [w[0] for w in wb], autojunk=False)
        marks_a, marks_b, changes = [], [], []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                continue
            for w in wa[i1:i2]:
                marks_a.append({"page": w[1], "rect": list(w[2]), "kind": "del" if tag == "delete" else "mod"})
            for w in wb[j1:j2]:
                marks_b.append({"page": w[1], "rect": list(w[2]), "kind": "ins" if tag == "insert" else "mod"})
            changes.append({
                "type": {"replace": "Modificado", "delete": "Eliminado", "insert": "Añadido"}[tag],
                "old": " ".join(w[0] for w in wa[i1:i2])[:300],
                "new": " ".join(w[0] for w in wb[j1:j2])[:300],
                "page_a": wa[i1][1] + 1 if i2 > i1 else None,
                "page_b": wb[j1][1] + 1 if j2 > j1 else None,
            })
        colors = {"del": (0.9, 0.2, 0.2), "ins": (0.1, 0.7, 0.3), "mod": (1, 0.7, 0.1)}
        for doc, marks in ((a, marks_a), (b, marks_b)):
            pages = {}
            for m in marks:
                pg = pages.setdefault(m["page"], doc[m["page"]])  # mantener viva la página mientras se anota
                an = pg.add_highlight_annot(fitz.Rect(m["rect"]))
                an.set_colors(stroke=colors[m["kind"]])
                an.update()
        fa = save_pdf(a, out / f"comparado_A_{stem(inputs[0])}.pdf")
        fb = save_pdf(b, out / f"comparado_B_{stem(inputs[1])}.pdf")
        visual = []
        if opts.get("visual", True):
            for i in range(min(a.page_count, b.page_count, 60)):
                pa = a[i].get_pixmap(dpi=60, alpha=False, annots=False)
                pb = b[i].get_pixmap(dpi=60, alpha=False, annots=False)
                ia = Image.frombytes("RGB", (pa.width, pa.height), pa.samples)
                ib = Image.frombytes("RGB", (pb.width, pb.height), pb.samples).resize(ia.size)
                diff = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > 40 else 0)
                visual.append(round(100 * sum(diff.histogram()[255:]) / (ia.width * ia.height), 2))
        return {"files": [fa, fb], "zip_name": "iwantpdf_comparacion.zip",
                "data": {"marks_a": marks_a, "marks_b": marks_b, "changes": changes[:2000],
                         "pages_a": a.page_count, "pages_b": b.page_count, "visual_diff_pct": visual,
                         "identical": not changes}}
    finally:
        a.close()
        b.close()


# =================================================================== FORMULARIOS
WTYPES = {
    "text": fitz.PDF_WIDGET_TYPE_TEXT, "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
    "radio": fitz.PDF_WIDGET_TYPE_RADIOBUTTON, "combobox": fitz.PDF_WIDGET_TYPE_COMBOBOX,
    "listbox": fitz.PDF_WIDGET_TYPE_LISTBOX, "signature": fitz.PDF_WIDGET_TYPE_SIGNATURE,
}
WNAMES = {v: k for k, v in WTYPES.items()}


def forms_detect(inputs, opts, out):
    """Devuelve campos existentes y candidatos detectados automáticamente (líneas ____ y casillas □)."""
    with open_pdf(inputs[0]) as doc:
        unrotate(doc)
        existing, suggested = [], []
        for i, pg in enumerate(doc):
            for w in pg.widgets() or []:
                existing.append({"page": i, "name": w.field_name, "type": WNAMES.get(w.field_type, "text"),
                                 "rect": list(w.rect), "value": w.field_value,
                                 "options": list(w.choice_values or []), "on": w.on_state() if w.field_type in (2, 5) else None})
            if opts.get("autodetect", True):
                # 1) secuencias de guiones bajos -> campo de texto
                for b in pg.get_text("rawdict")["blocks"]:
                    for line in b.get("lines", []):
                        for span in line["spans"]:
                            chars = span["chars"]
                            run = []
                            for ch in chars + [None]:
                                if ch and ch["c"] in "_…":
                                    run.append(ch)
                                    continue
                                if len(run) >= 4:
                                    r = fitz.Rect(run[0]["bbox"]) | fitz.Rect(run[-1]["bbox"])
                                    r.y0 = r.y1 - max(14, span["size"] * 1.3)
                                    suggested.append({"page": i, "type": "text", "rect": list(r)})
                                run = []
                # 2) cuadrados pequeños dibujados -> casilla
                for d in pg.get_drawings():
                    r = d["rect"]
                    if 6 <= r.width <= 18 and 6 <= r.height <= 18 and abs(r.width - r.height) < 2.5:
                        suggested.append({"page": i, "type": "checkbox", "rect": list(r)})
                # 3) líneas horizontales largas sin texto encima -> campo de texto
                for d in pg.get_drawings():
                    r = d["rect"]
                    if r.width > 60 and r.height < 1.5:
                        above = fitz.Rect(r.x0, r.y0 - 14, r.x1, r.y0 - 1)
                        if not pg.get_textbox(above).strip():
                            suggested.append({"page": i, "type": "text", "rect": [r.x0, r.y0 - 15, r.x1, r.y0 - 1]})
        # quitar sugerencias que solapan con campos existentes
        ex = [(e["page"], fitz.Rect(e["rect"])) for e in existing]
        suggested = [s for s in suggested
                     if not any(pg_ == s["page"] and r.intersects(fitz.Rect(s["rect"])) for pg_, r in ex)]
    return {"files": [], "data": {"fields": existing, "suggested": suggested}}


def forms(inputs, opts, out):
    """opts.new_fields: [{page,type,rect,name,options,value}] ; opts.values: {name: valor}; opts.flatten"""
    p = inputs[0]
    with open_pdf(p) as doc:
        unrotate(doc)
        names = set()
        for k, f in enumerate(opts.get("new_fields", [])):
            pg = doc[int(f["page"])]
            w = fitz.Widget()
            w.field_type = WTYPES.get(f.get("type", "text"), fitz.PDF_WIDGET_TYPE_TEXT)
            base = f.get("name") or f"{f.get('type', 'campo')}_{k + 1}"
            name = base
            while name in names:
                name = f"{base}_{k}"
            names.add(name)
            w.field_name = name
            w.rect = fitz.Rect(f["rect"])
            w.border_color = (0.4, 0.4, 0.4)
            w.border_width = 0.6
            w.fill_color = (0.93, 0.95, 1)
            w.text_fontsize = float(f.get("font_size", 0))
            if f.get("type") in ("combobox", "listbox"):
                w.choice_values = f.get("options") or ["Opción 1", "Opción 2"]
                w.field_value = w.choice_values[0]
            elif f.get("type") == "radio":
                w.field_value = False
            elif f.get("type") == "checkbox":
                w.field_value = bool(f.get("value"))
            elif f.get("value"):
                w.field_value = str(f["value"])
            if f.get("required"):
                w.field_flags |= fitz.PDF_FIELD_IS_REQUIRED
            pg.add_widget(w)
        values = opts.get("values") or {}
        if values:
            for pg in doc:
                for w in pg.widgets() or []:
                    if w.field_name in values:
                        v = values[w.field_name]
                        if w.field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
                            w.field_value = w.on_state() if v in (True, "true", "on", w.on_state()) else "Off"
                        else:
                            w.field_value = str(v)
                        w.update()
        dest = out / f"{stem(p)}_formulario.pdf"
        if opts.get("flatten"):
            if hasattr(doc, "bake"):
                doc.bake(annots=True, widgets=True)
            else:
                pdfb = doc.convert_to_pdf()
                doc = fitz.open("pdf", pdfb)
        save_pdf(doc, dest)
    return {"files": [dest]}
