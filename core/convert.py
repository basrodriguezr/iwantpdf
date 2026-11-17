"""Conversiones de formato."""
import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import pymupdf as fitz

from .store import open_pdf

_office_lock = threading.Lock()  # Office por COM no tolera bien llamadas concurrentes


# =================================================================== OFFICE -> PDF
def _soffice():
    for c in [shutil.which("soffice"), r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"]:
        if c and Path(c).exists():
            return c
    return None


def office_status():
    try:
        import win32com.client  # noqa: F401
        com = True
    except ImportError:
        com = False
    return {"com": com, "libreoffice": bool(_soffice())}


def _com_convert(kind: str, src: Path, dest: Path, opts):
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    try:
        if kind == "word":
            app = win32com.client.DispatchEx("Word.Application")
            app.Visible = False
            app.DisplayAlerts = 0
            try:
                doc = app.Documents.Open(str(src), ReadOnly=True, AddToRecentFiles=False, Visible=False)
                doc.ExportAsFixedFormat(str(dest), 17, OptimizeFor=0, CreateBookmarks=1, DocStructureTags=True)
                doc.Close(False)
            finally:
                app.Quit()
        elif kind == "excel":
            app = win32com.client.DispatchEx("Excel.Application")
            app.Visible = False
            app.DisplayAlerts = False
            try:
                wb = app.Workbooks.Open(str(src), ReadOnly=True, UpdateLinks=0)
                orient = opts.get("orientation", "auto")
                for ws in wb.Worksheets:
                    try:
                        ps = ws.PageSetup
                        if orient in ("portrait", "landscape"):
                            ps.Orientation = 1 if orient == "portrait" else 2
                        if opts.get("fit_width", True):
                            ps.Zoom = False
                            ps.FitToPagesWide = 1
                            ps.FitToPagesTall = False
                    except Exception:  # noqa: BLE001 - hojas de gráfico, etc.
                        pass
                wb.ExportAsFixedFormat(0, str(dest), Quality=0, IgnorePrintAreas=False)
                wb.Close(False)
            finally:
                app.Quit()
        elif kind == "powerpoint":
            app = win32com.client.DispatchEx("PowerPoint.Application")
            try:
                pres = app.Presentations.Open(str(src), ReadOnly=True, Untitled=False, WithWindow=False)
                pres.SaveAs(str(dest), 32)
                pres.Close()
            finally:
                app.Quit()
    finally:
        pythoncom.CoUninitialize()


def _office_to_pdf(kind, inputs, opts, out):
    st = office_status()
    files = []
    for p in inputs:
        dest = out / f"{p.stem}.pdf"
        if p.suffix.lower() in (".txt", ".rtf", ".odt", ".ods", ".odp", ".csv") and not st["com"] and not st["libreoffice"]:
            raise RuntimeError("No hay Microsoft Office ni LibreOffice instalado.")
        if st["com"]:
            with _office_lock:
                _com_convert(kind, p.resolve(), dest.resolve(), opts)
        elif st["libreoffice"]:
            subprocess.run([_soffice(), "--headless", "--convert-to", "pdf", "--outdir", str(out), str(p)],
                           check=True, timeout=300, capture_output=True)
        else:
            raise RuntimeError("Para convertir documentos de Office necesitas Microsoft Office o LibreOffice.")
        files.append(dest)
    return {"files": files}


def word_to_pdf(inputs, opts, out):
    return _office_to_pdf("word", inputs, opts, out)


def excel_to_pdf(inputs, opts, out):
    return _office_to_pdf("excel", inputs, opts, out)


def ppt_to_pdf(inputs, opts, out):
    return _office_to_pdf("powerpoint", inputs, opts, out)


# =================================================================== PDF -> OFFICE
def pdf_to_word(inputs, opts, out):
    from pdf2docx import Converter
    files = []
    for p in inputs:
        dest = out / f"{p.stem}.docx"
        if opts.get("mode") == "ocr":
            from .ocr import make_searchable
            tmp = out / f"_{p.stem}_ocr.pdf"
            make_searchable(p, tmp, opts.get("lang"))
            p = tmp
        cv = Converter(str(p))
        try:
            cv.convert(str(dest), multi_processing=False)
        finally:
            cv.close()
        files.append(dest)
    return {"files": files}


def pdf_to_powerpoint(inputs, opts, out):
    from pptx import Presentation
    from pptx.util import Emu
    files = []
    for p in inputs:
        prs = Presentation()
        blank = prs.slide_layouts[6]
        with open_pdf(p) as doc:
            first = doc[0].rect
            prs.slide_width = Emu(int(first.width * 12700))
            prs.slide_height = Emu(int(first.height * 12700))
            for pg in doc:
                slide = prs.slides.add_slide(blank)
                sx = prs.slide_width / pg.rect.width
                sy = prs.slide_height / pg.rect.height
                if opts.get("editable", True):
                    # fondo: página sin texto; encima: cuadros de texto editables
                    bg = fitz.open()
                    bg.insert_pdf(doc, from_page=pg.number, to_page=pg.number)
                    bp = bg[0]
                    for b in bp.get_text("blocks"):
                        if b[6] == 0:
                            bp.add_redact_annot(fitz.Rect(b[:4]))
                    bp.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                                        graphics=0 if hasattr(fitz, "PDF_REDACT_LINE_ART_NONE") else 0)
                    png = bp.get_pixmap(dpi=150, alpha=False).tobytes("png")
                    bg.close()
                else:
                    png = pg.get_pixmap(dpi=150, alpha=False).tobytes("png")
                import io
                slide.shapes.add_picture(io.BytesIO(png), 0, 0, prs.slide_width, prs.slide_height)
                if opts.get("editable", True):
                    _add_text_boxes(slide, pg, sx, sy)
        dest = out / f"{p.stem}.pptx"
        prs.save(dest)
        files.append(dest)
    return {"files": files}


def _add_text_boxes(slide, pg, sx, sy):
    from pptx.dml.color import RGBColor
    from pptx.util import Emu, Pt
    d = pg.get_text("dict")
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        x0, y0, x1, y1 = b["bbox"]
        tb = slide.shapes.add_textbox(Emu(int(x0 * sx)), Emu(int(y0 * sy)),
                                      Emu(int((x1 - x0) * sx) + 12700 * 4), Emu(int((y1 - y0) * sy)))
        tf = tb.text_frame
        tf.word_wrap = True
        for m in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
            setattr(tf, m, 0)
        first = True
        for line in b["lines"]:
            para = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            for s in line["spans"]:
                run = para.add_run()
                run.text = s["text"]
                run.font.size = Pt(max(4, s["size"]))
                run.font.bold = bool(s["flags"] & 16)
                run.font.italic = bool(s["flags"] & 2)
                c = s["color"]
                run.font.color.rgb = RGBColor((c >> 16) & 255, (c >> 8) & 255, c & 255)
                fname = s["font"].split("+")[-1].split("-")[0]
                run.font.name = fname


def pdf_to_excel(inputs, opts, out):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    files = []
    for p in inputs:
        wb = Workbook()
        wb.remove(wb.active)
        found = 0
        with open_pdf(p) as doc:
            for pg in doc:
                tabs = pg.find_tables() if hasattr(pg, "find_tables") else None
                tables = list(tabs.tables) if tabs else []
                if not tables:
                    tables = list(pg.find_tables(strategy="text").tables) if hasattr(pg, "find_tables") else []
                for ti, t in enumerate(tables):
                    rows = t.extract()
                    if not rows or (len(rows) < 2 and len(rows[0]) < 2):
                        continue
                    found += 1
                    ws = wb.create_sheet(f"Pag{pg.number + 1}_T{ti + 1}"[:31])
                    for r in rows:
                        ws.append([_num(c) for c in r])
                    for c in ws[1]:
                        c.font = Font(bold=True)
                    for col in ws.columns:
                        width = max((len(str(c.value or "")) for c in col), default=8)
                        ws.column_dimensions[col[0].column_letter].width = min(60, max(8, width + 2))
            if not found:  # sin tablas: volcar texto línea a línea, separando columnas por posición
                ws = wb.create_sheet("Texto")
                for pg in doc:
                    lines = {}
                    for w in pg.get_text("words", sort=True):
                        lines.setdefault((w[5], w[6]), []).append(w[4])
                    for ws_line in lines.values():
                        ws.append([_num(" ".join(ws_line))])
        dest = out / f"{p.stem}.xlsx"
        wb.save(dest)
        files.append(dest)
    return {"files": files}


def _num(v):
    if v is None:
        return None
    s = str(v).strip()
    t = s.replace(".", "").replace(",", ".") if s.count(",") == 1 and s.count(".") <= 3 else s.replace(",", "")
    try:
        return int(t) if t.lstrip("-").isdigit() else float(t)
    except ValueError:
        return s


def pdf_to_markdown(inputs, opts, out):
    import pymupdf4llm
    files, preview = [], ""
    for p in inputs:
        md = pymupdf4llm.to_markdown(str(p), show_progress=False)
        dest = out / f"{p.stem}.md"
        dest.write_text(md, encoding="utf-8")
        files.append(dest)
        preview = preview or md[:20000]
    return {"files": files, "data": {"preview": preview}}


# =================================================================== HTML -> PDF
def _chrome():
    for c in [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              shutil.which("chrome"), shutil.which("msedge")]:
        if c and Path(c).exists():
            return c
    raise RuntimeError("Se necesita Google Chrome o Microsoft Edge para HTML a PDF.")


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PAPER_IN = {"A4": (8.27, 11.69), "Letter": (8.5, 11), "Legal": (8.5, 14), "A3": (11.69, 16.54)}
SCREENS = {"desktop": 1440, "tablet": 768, "mobile": 390}


def html_to_pdf(inputs, opts, out):
    import websocket  # websocket-client
    if inputs:
        url = inputs[0].resolve().as_uri()
        name = inputs[0].stem
    else:
        url = (opts.get("url") or "").strip()
        if not url:
            raise ValueError("Escribe la dirección de la página web.")
        if not url.startswith(("http://", "https://", "file:")):
            url = "https://" + url
        name = url.split("//", 1)[-1].split("/")[0].replace(":", "_") or "pagina"
    port = _free_port()
    prof = tempfile.mkdtemp(prefix="iwantpdf-chrome-")
    width = SCREENS.get(opts.get("screen", "desktop"), 1440)
    proc = subprocess.Popen([_chrome(), "--headless=new", f"--remote-debugging-port={port}",
                             f"--user-data-dir={prof}", "--no-first-run", "--disable-extensions",
                             f"--window-size={width},1000", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1))
                page = next(t for t in tabs if t["type"] == "page")
                ws_url = page["webSocketDebuggerUrl"]
                break
            except Exception:  # noqa: BLE001 - Chrome todavía arrancando
                time.sleep(0.25)
        if not ws_url:
            raise RuntimeError("No se pudo iniciar Chrome.")
        ws = websocket.create_connection(ws_url, timeout=90, suppress_origin=True)
        mid = [0]

        def call(method, **params):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == mid[0]:
                    if "error" in msg:
                        raise RuntimeError(msg["error"].get("message"))
                    return msg.get("result", {})

        call("Page.enable")
        call("Emulation.setDeviceMetricsOverride", width=width, height=1000, deviceScaleFactor=1,
             mobile=opts.get("screen") == "mobile")
        call("Page.navigate", url=url)
        # esperar a que cargue
        deadline = time.time() + 60
        while time.time() < deadline:
            r = call("Runtime.evaluate", expression="document.readyState", returnByValue=True)
            if r.get("result", {}).get("value") == "complete":
                break
            time.sleep(0.4)
        if opts.get("block_popups", True):
            call("Runtime.evaluate", expression=_HIDE_POPUPS_JS)
        time.sleep(float(opts.get("wait", 1.5)))
        pw, ph = PAPER_IN.get(opts.get("page_size", "A4"), PAPER_IN["A4"])
        margin = {"none": 0, "small": 0.4, "big": 0.8}.get(opts.get("margin", "small"), 0.4)
        params = dict(printBackground=True, landscape=opts.get("orientation") == "landscape",
                      paperWidth=pw, paperHeight=ph, marginTop=margin, marginBottom=margin,
                      marginLeft=margin, marginRight=margin, preferCSSPageSize=False)
        if opts.get("one_page"):
            h = call("Runtime.evaluate", expression="Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)",
                     returnByValue=True)["result"]["value"]
            params.update(paperWidth=width / 96, paperHeight=min(200, h / 96 + 0.2), landscape=False)
        data = call("Page.printToPDF", **params)["data"]
        ws.close()
        dest = out / f"{name}.pdf"
        dest.write_bytes(base64.b64decode(data))
        return {"files": [dest]}
    finally:
        proc.kill()
        shutil.rmtree(prof, ignore_errors=True)


_HIDE_POPUPS_JS = r"""
(() => {
  const sel = '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=gdpr i],[id*=gdpr i],[class*=newsletter i][class*=modal i],[aria-modal=true]';
  document.querySelectorAll(sel).forEach(e => { const s = getComputedStyle(e); if (s.position === 'fixed' || s.position === 'sticky' || e.getAttribute('aria-modal')) e.remove(); });
  document.documentElement.style.overflow = 'auto'; document.body.style.overflow = 'auto';
})();
"""
