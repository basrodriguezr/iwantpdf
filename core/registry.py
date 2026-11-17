"""Registro de herramientas y ejecución (individual o encadenada en flujos de trabajo)."""
import shutil
from pathlib import Path

from . import ai, convert, ocr, pdf_ops, store

TOOLS = {
    # organizar
    "merge": pdf_ops.merge, "split": pdf_ops.split, "organize": pdf_ops.organize, "rotate": pdf_ops.rotate,
    # optimizar
    "compress": pdf_ops.compress, "repair": pdf_ops.repair, "ocr": ocr.ocr_pdf,
    # convertir a PDF
    "jpg_to_pdf": pdf_ops.jpg_to_pdf, "word_to_pdf": convert.word_to_pdf, "ppt_to_pdf": convert.ppt_to_pdf,
    "excel_to_pdf": convert.excel_to_pdf, "html_to_pdf": convert.html_to_pdf, "scan_to_pdf": pdf_ops.scan_to_pdf,
    # convertir desde PDF
    "pdf_to_jpg": pdf_ops.pdf_to_jpg, "pdf_to_word": convert.pdf_to_word, "pdf_to_ppt": convert.pdf_to_powerpoint,
    "pdf_to_excel": convert.pdf_to_excel, "pdfa": pdf_ops.pdfa, "pdf_to_markdown": convert.pdf_to_markdown,
    # editar
    "edit": pdf_ops.edit, "watermark": pdf_ops.watermark, "page_numbers": pdf_ops.page_numbers,
    "crop": pdf_ops.crop, "forms": pdf_ops.forms, "forms_detect": pdf_ops.forms_detect,
    # seguridad
    "unlock": pdf_ops.unlock, "protect": pdf_ops.protect, "sign": pdf_ops.sign,
    "redact": pdf_ops.redact, "redact_preview": pdf_ops.redact_preview, "compare": pdf_ops.compare,
    # inteligencia
    "summarize": ai.summarize, "translate": ai.translate,
}


def _package(rid: str, outdir: Path, res: dict) -> dict:
    files = [Path(f) for f in res.get("files", [])]
    items = [{"name": f.name, "size": f.stat().st_size, "url": f"/api/download/{rid}/{f.name}"} for f in files]
    payload = {"id": rid, "files": items, "data": res.get("data", {})}
    if len(files) > 1:
        z = store.zip_files(files, outdir / res.get("zip_name", "iwantpdf.zip"))
        payload["zip"] = {"name": z.name, "size": z.stat().st_size, "url": f"/api/download/{rid}/{z.name}"}
    return payload


def run_tool(name: str, file_ids: list[str], opts: dict) -> dict:
    inputs = [store.path(fid) for fid in file_ids]
    rid, outdir = store.new_result_dir()
    res = TOOLS[name](inputs, opts or {}, outdir)
    return _package(rid, outdir, res)


def run_workflow(file_ids: list[str], steps: list[dict]) -> dict:
    if not steps:
        raise ValueError("El flujo de trabajo no tiene pasos.")
    inputs = [store.path(fid) for fid in file_ids]
    rid, outdir = store.new_result_dir()
    work = outdir / "_pasos"
    work.mkdir()
    log = []
    for k, step in enumerate(steps):
        fn = TOOLS.get(step.get("tool"))
        if not fn:
            raise ValueError(f"Paso desconocido: {step.get('tool')}")
        sd = work / str(k)
        sd.mkdir()
        res = fn(inputs, step.get("options") or {}, sd)
        produced = [Path(f) for f in res.get("files", [])]
        log.append({"step": step["tool"], "outputs": [f.name for f in produced]})
        nxt = [f for f in produced if f.suffix.lower() == ".pdf"]
        inputs = nxt if (nxt and k < len(steps) - 1) else produced
    final = []
    for f in inputs:
        dest = outdir / f.name
        shutil.copy2(f, dest)
        final.append(dest)
    shutil.rmtree(work, ignore_errors=True)
    return _package(rid, outdir, {"files": final, "data": {"log": log}, "zip_name": "iwantpdf_flujo.zip"})
