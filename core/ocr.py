"""OCR local. Usa el motor OCR integrado de Windows (Windows.Media.Ocr); si existe Tesseract también se ofrece."""
import asyncio
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf as fitz

from .store import open_pdf


def _tesseract():
    for c in [shutil.which("tesseract"), r"C:\Program Files\Tesseract-OCR\tesseract.exe"]:
        if c and Path(c).exists():
            return c
    return None


# WinRT no es seguro entre hilos arbitrarios de Flask: todas las llamadas pasan por un único hilo.
_WINRT = ThreadPoolExecutor(max_workers=1, thread_name_prefix="winrt")
_langs_cache = None


def _list_langs():
    try:
        from winrt.windows.media.ocr import OcrEngine
        return [lang.language_tag for lang in OcrEngine.available_recognizer_languages]
    except Exception:  # noqa: BLE001
        return []


def windows_languages():
    global _langs_cache
    if _langs_cache is None:
        _langs_cache = _WINRT.submit(_list_langs).result()
    return _langs_cache


def status():
    langs = windows_languages()
    return {"windows": bool(langs), "languages": langs, "tesseract": bool(_tesseract())}


async def _win_ocr_png(png: bytes, lang: str):
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream)
    writer.write_bytes(png)
    await writer.store_async()
    await writer.flush_async()
    writer.detach_stream()
    stream.seek(0)
    decoder = await BitmapDecoder.create_async(stream)
    bmp = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_language(Language(lang)) if lang else None
    engine = engine or OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError("Windows no tiene instalado un idioma de OCR.")
    res = await engine.recognize_async(bmp)
    lines = []
    for line in res.lines:
        words = []
        for w in line.words:
            r = w.bounding_rect
            words.append((w.text, r.x, r.y, r.x + r.width, r.y + r.height))
        lines.append(words)
    return lines


def ocr_image_png(png: bytes, lang: str = None):
    """Devuelve líneas -> [(texto, x0, y0, x1, y1)] en píxeles."""
    return _WINRT.submit(lambda: asyncio.run(_win_ocr_png(png, lang))).result()


def make_searchable(src: Path, dest: Path, lang: str = None, dpi: int = 300, skip_text_pages=True):
    """Crea un PDF con capa de texto invisible sobre cada página escaneada. Devuelve el texto completo."""
    doc = open_pdf(src)
    font = fitz.Font("helv")
    full = []
    max_dim = 9000
    for pg in doc:
        if skip_text_pages and len(pg.get_text("text").strip()) > 30:
            full.append(pg.get_text("text"))
            continue
        z = dpi / 72
        z = min(z, max_dim / max(pg.rect.width, pg.rect.height))
        pix = pg.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
        lines = ocr_image_png(pix.tobytes("png"), lang)
        text_lines = []
        tw = fitz.TextWriter(pg.rect)
        for words in lines:
            text_lines.append(" ".join(w[0] for w in words))
            for (t, x0, y0, x1, y1) in words:
                # la imagen incluye la rotación de la página: volver a coordenadas sin rotar
                r = fitz.Rect(x0 / z, y0 / z, x1 / z, y1 / z) * pg.derotation_matrix
                size = max(4.0, r.height * 0.85)
                tw.append(fitz.Point(r.x0, r.y1 - r.height * 0.2), t, font=font, fontsize=size)
        tw.write_text(pg, render_mode=3)  # 3 = invisible pero seleccionable/buscable
        full.append("\n".join(text_lines))
    doc.save(dest, garbage=3, deflate=True)
    doc.close()
    return "\n\n".join(full)


def _tesseract_pdf(src: Path, dest: Path, lang: str):
    """Ruta alternativa con Tesseract (si está instalado): página a página -> PDF con texto."""
    exe = _tesseract()
    doc = open_pdf(src)
    outdoc = fitz.open()
    tlang = {"es": "spa", "en": "eng", "pt": "por", "fr": "fra", "de": "deu", "it": "ita"}.get((lang or "es")[:2], "spa")
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        for pg in doc:
            img = Path(td) / f"p{pg.number}.png"
            pg.get_pixmap(dpi=300, alpha=False).save(img)
            base = Path(td) / f"o{pg.number}"
            subprocess.run([exe, str(img), str(base), "-l", tlang, "pdf"], check=True, capture_output=True)
            with fitz.open(str(base) + ".pdf") as one:
                outdoc.insert_pdf(one)
    outdoc.save(dest, garbage=3, deflate=True)
    text = "\n\n".join(p.get_text() for p in outdoc)
    outdoc.close()
    doc.close()
    return text


def ocr_pdf(inputs, opts, out):
    lang = opts.get("lang") or (windows_languages() or [None])[0]
    engine = opts.get("engine", "windows")
    files, texts = [], []
    for p in inputs:
        dest = out / f"{p.stem}_ocr.pdf"
        if engine == "tesseract" and _tesseract():
            text = _tesseract_pdf(p, dest, lang)
        else:
            if not windows_languages():
                raise RuntimeError("El OCR de Windows no está disponible en este equipo.")
            text = make_searchable(p, dest, lang, skip_text_pages=not opts.get("force", False))
        files.append(dest)
        if opts.get("txt", True):
            t = out / f"{p.stem}_ocr.txt"
            t.write_text(text, encoding="utf-8")
            files.append(t)
        texts.append(text)
    return {"files": files, "data": {"preview": "\n\n".join(texts)[:20000]}}
