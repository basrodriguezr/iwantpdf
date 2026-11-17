"""iwantpdf - servidor local de herramientas PDF (sin anuncios, sin cuentas, sin nube).

Uso:
    python app.py            -> http://127.0.0.1:8765 (solo este equipo)
    python app.py --lan      -> también accesible desde el móvil en la red local (para "Escanear a PDF")
"""
import argparse
import io
import logging
import mimetypes
import os
import secrets
import socket
import threading
import time
import traceback
import webbrowser
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file, send_from_directory



from core import store
from core.registry import TOOLS, run_tool, run_workflow

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1 GB por petición

STATE = {"lan": False, "port": 8765}


# ---------------------------------------------------------------- estáticos
@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/movil")
def mobile_scan():
    return send_from_directory(STATIC, "movil.html")


@app.get("/static/<path:p>")
def static_files(p):
    return send_from_directory(STATIC, p)


# ---------------------------------------------------------------- archivos
@app.post("/api/upload")
def upload():
    out = []
    for f in request.files.getlist("files"):
        out.append(store.save_upload(f))
    return jsonify(out)


@app.get("/api/file/<fid>")
def file_info(fid):
    return jsonify(store.info(fid))


@app.get("/api/render/<fid>/<int:page>")
def render(fid, page):
    scale = min(float(request.args.get("scale", 0.5)), 4.0)
    png = store.render_page(fid, page, scale, request.args.get("password"))
    return send_file(io.BytesIO(png), mimetype="image/png", max_age=3600)


@app.get("/api/pagesinfo/<fid>")
def pages_info(fid):
    return jsonify(store.pages_info(fid))


@app.get("/api/download/<rid>/<path:name>")
def download(rid, name):
    p = store.result_path(rid, name)
    if not p:
        abort(404)
    inline = request.args.get("inline") == "1"
    return send_file(p, as_attachment=not inline, download_name=p.name,
                     mimetype=mimetypes.guess_type(p.name)[0] or "application/octet-stream")


@app.post("/api/reuse")
def reuse():
    """Convierte un resultado en una "subida" para encadenarlo con otra herramienta."""
    body = request.get_json(force=True)
    p = store.result_path(body.get("rid", ""), body.get("name", ""))
    if not p:
        return jsonify(error="El resultado ya no existe."), 404
    return jsonify(store.add_local(p))


# ---------------------------------------------------------------- herramientas
@app.post("/api/tool/<name>")
def tool(name):
    if name not in TOOLS:
        return jsonify(error=f"Herramienta desconocida: {name}"), 404
    body = request.get_json(force=True)
    try:
        return jsonify(run_tool(name, body.get("files", []), body.get("options", {})))
    except Exception as e:  # noqa: BLE001 - se muestra al usuario
        traceback.print_exc()
        return jsonify(error=str(e) or e.__class__.__name__), 400


@app.post("/api/workflow")
def workflow():
    body = request.get_json(force=True)
    try:
        return jsonify(run_workflow(body.get("files", []), body.get("steps", [])))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return jsonify(error=str(e)), 400


@app.post("/api/settings")
def settings():
    from core import ai
    body = request.get_json(force=True)
    if "anthropic_api_key" in body:
        ai.save_api_key(body["anthropic_api_key"] or "")
    return jsonify(ok=True, ai=ai.status())


@app.get("/api/capabilities")
def capabilities():
    from core import ai, convert, ocr
    return jsonify(
        office=convert.office_status(),
        ocr=ocr.status(),
        ai=ai.status(),
        lan=STATE["lan"],
    )


# ---------------------------------------------------------------- escaneo móvil
SCANS = {}  # sesión -> [file ids]


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


@app.post("/api/scan/session")
def scan_session():
    sid = secrets.token_urlsafe(8)
    SCANS[sid] = []
    url = f"http://{lan_ip()}:{STATE['port']}/movil?s={sid}" if STATE["lan"] else None
    qr = None
    if url:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=8)
        qr = img.to_string(encoding="unicode")
    return jsonify(session=sid, url=url, qr=qr, lan=STATE["lan"])


@app.post("/api/scan/<sid>/upload")
def scan_upload(sid):
    if sid not in SCANS:
        abort(404)
    for f in request.files.getlist("files"):
        SCANS[sid].append(store.save_upload(f))
    return jsonify(count=len(SCANS[sid]))


@app.get("/api/scan/<sid>")
def scan_list(sid):
    if sid not in SCANS:
        abort(404)
    return jsonify(SCANS[sid])


# ---------------------------------------------------------------- arranque
def cleaner():
    while True:
        store.cleanup(max_age_s=3 * 3600)
        time.sleep(600)


def disable_console_freeze():
    """En Windows, el "modo de edición rápida" de la consola congela el proceso al hacer clic en la
    ventana (cualquier print queda bloqueado hasta pulsar Enter). Se desactiva para esta consola."""
    if os.name != "nt":
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        mode = ctypes.c_uint32()
        if k32.GetConsoleMode(h, ctypes.byref(mode)):
            ENABLE_QUICK_EDIT_MODE, ENABLE_EXTENDED_FLAGS = 0x0040, 0x0080
            k32.SetConsoleMode(h, (mode.value & ~ENABLE_QUICK_EDIT_MODE) | ENABLE_EXTENDED_FLAGS)
    except Exception:  # noqa: BLE001 - sin consola (p. ej. pythonw): no hace falta
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lan", action="store_true", help="escuchar en la red local (escaneo desde el móvil)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    STATE["lan"], STATE["port"] = a.lan, a.port
    disable_console_freeze()
    # no escribir una línea por petición en la consola (solo errores)
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    store.init(BASE / "data")
    from core import ocr
    ocr.windows_languages()  # precarga (WinRT) en su hilo dedicado
    threading.Thread(target=cleaner, daemon=True).start()
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    url = f"http://127.0.0.1:{a.port}"
    print(f"\n  iwantpdf listo en {url}" + (f"  (red local: http://{lan_ip()}:{a.port})" if a.lan else "") + "\n")
    if not a.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host=host, port=a.port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
