"""Almacén temporal de archivos subidos y resultados (todo en disco local)."""
import json
import re
import secrets
import shutil
import time
import unicodedata
import zipfile
from pathlib import Path

import pymupdf as fitz

ROOT: Path = None
UP: Path = None
OUT: Path = None

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"}


def init(root: Path):
    global ROOT, UP, OUT
    ROOT, UP, OUT = root, root / "uploads", root / "results"
    UP.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)


def safe_name(name: str) -> str:
    name = unicodedata.normalize("NFC", Path(name or "archivo").name)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name or "archivo"


# ------------------------------------------------------------------ subidas
def save_upload(fs) -> dict:
    fid = secrets.token_hex(8)
    d = UP / fid
    d.mkdir()
    name = safe_name(fs.filename)
    p = d / name
    fs.save(p)
    return describe(fid, p)


def add_local(path: Path, name: str = None) -> dict:
    """Registra un archivo generado (p.ej. resultado intermedio) como si fuera una subida."""
    fid = secrets.token_hex(8)
    d = UP / fid
    d.mkdir()
    p = d / safe_name(name or path.name)
    shutil.copy2(path, p)
    return describe(fid, p)


def describe(fid: str, p: Path) -> dict:
    meta = {"id": fid, "name": p.name, "size": p.stat().st_size, "ext": p.suffix.lower(),
            "pages": None, "encrypted": False}
    if p.suffix.lower() == ".pdf":
        try:
            with fitz.open(p) as doc:
                meta["encrypted"] = bool(doc.needs_pass)
                meta["pages"] = None if doc.needs_pass else doc.page_count
        except Exception:  # noqa: BLE001 - PDF dañado: se puede intentar reparar
            meta["damaged"] = True
    elif p.suffix.lower() in IMAGE_EXT:
        meta["pages"] = 1
    (p.parent / ".meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def path(fid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{16}", fid or ""):
        raise ValueError("Identificador de archivo inválido")
    d = UP / fid
    files = [f for f in d.iterdir() if f.name != ".meta.json"] if d.exists() else []
    if not files:
        raise FileNotFoundError("El archivo ya no existe (los archivos se borran a las 3 horas). Vuelve a subirlo.")
    return files[0]


def info(fid: str) -> dict:
    return json.loads((UP / fid / ".meta.json").read_text(encoding="utf-8"))


def open_pdf(fid_or_path, password=None) -> fitz.Document:
    p = fid_or_path if isinstance(fid_or_path, Path) else path(fid_or_path)
    if p.suffix.lower() in IMAGE_EXT:
        img = fitz.open(p)
        doc = fitz.open("pdf", img.convert_to_pdf())
        img.close()
        return doc
    doc = fitz.open(p)
    if doc.needs_pass and not (password and doc.authenticate(password)):
        doc.close()
        raise PermissionError("El PDF está protegido con contraseña.")
    return doc


def render_page(fid: str, page: int, scale: float, password=None) -> bytes:
    with open_pdf(fid, password) as doc:
        pg = doc[max(0, min(page, doc.page_count - 1))]
        return pg.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")


def pages_info(fid: str) -> dict:
    with open_pdf(fid) as doc:
        return {"pages": [{"w": pg.rect.width, "h": pg.rect.height, "rotation": pg.rotation}
                          for pg in doc]}


# ------------------------------------------------------------------ resultados
def new_result_dir() -> tuple[str, Path]:
    rid = secrets.token_hex(8)
    d = OUT / rid
    d.mkdir()
    return rid, d


def result_path(rid: str, name: str):
    if not re.fullmatch(r"[0-9a-f]{16}", rid):
        return None
    p = (OUT / rid / name).resolve()
    if OUT.resolve() not in p.parents or not p.is_file():
        return None
    return p


def zip_files(files: list[Path], dest: Path) -> Path:
    used = set()
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            n, i = f.name, 1
            while n in used:
                n = f"{f.stem} ({i}){f.suffix}"
                i += 1
            used.add(n)
            z.write(f, n)
    return dest


def cleanup(max_age_s: int):
    now = time.time()
    for base in (UP, OUT):
        if not base:
            continue
        for d in base.iterdir():
            try:
                if now - d.stat().st_mtime > max_age_s:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass
