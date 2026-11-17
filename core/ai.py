"""Funciones con IA: resumir y traducir PDF usando Claude.

Credenciales: variable ANTHROPIC_API_KEY, un perfil de `ant auth login`, o la clave guardada desde la
pantalla de ajustes de iwantpdf (data/config.json, solo en este equipo). Sin credenciales, "Resumir"
usa un resumen extractivo local y "Traducir" no está disponible.
"""
import base64
import json
import math
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf as fitz

from . import store
from .store import open_pdf

MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _config_path() -> Path:
    return store.ROOT / "config.json"


def load_config() -> dict:
    try:
        return json.loads(_config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_api_key(key: str):
    cfg = load_config()
    cfg["anthropic_api_key"] = key.strip()
    _config_path().write_text(json.dumps(cfg), encoding="utf-8")


def _client():
    import anthropic
    key = load_config().get("anthropic_api_key")
    return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()


def status():
    has = bool(load_config().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
               or os.environ.get("ANTHROPIC_AUTH_TOKEN")
               or (Path.home() / ".config" / "anthropic").is_dir())  # perfil de `ant auth login`
    return {"configured": has, "model": MODEL}


def _ask(content, system, max_tokens=16000, effort="medium", schema=None) -> str:
    import anthropic
    kw = dict(model=MODEL, max_tokens=max_tokens, system=system,
              messages=[{"role": "user", "content": content}],
              output_config={"effort": effort, **({"format": {"type": "json_schema", "schema": schema}} if schema else {})},
              betas=[FALLBACK_BETA], fallbacks="default")
    try:
        with _client().beta.messages.stream(**kw) as stream:
            msg = stream.get_final_message()
    except anthropic.AuthenticationError as e:
        raise RuntimeError("La clave de API de Claude no es válida. Revísala en Ajustes.") from e
    except anthropic.PermissionDeniedError as e:
        raise RuntimeError("La clave de API no tiene permisos para este modelo.") from e
    except anthropic.RateLimitError as e:
        raise RuntimeError("Límite de uso de la API alcanzado. Inténtalo en un momento.") from e
    except anthropic.BadRequestError as e:
        raise RuntimeError(f"Petición rechazada por la API: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise RuntimeError(f"Error del servicio de IA ({e.status_code}). Inténtalo más tarde.") from e
    except anthropic.APIConnectionError as e:
        raise RuntimeError("No hay conexión con la API de Claude (se necesita internet para las funciones de IA).") from e
    if msg.stop_reason == "refusal":
        raise RuntimeError("El modelo no pudo procesar este documento.")
    return "".join(b.text for b in msg.content if b.type == "text")


# =================================================================== RESUMIR
LENGTHS = {"short": "un resumen breve (3-5 viñetas)", "medium": "un resumen de extensión media (un párrafo de introducción y 6-10 viñetas con los puntos clave)",
           "long": "un resumen detallado por secciones, con encabezados y puntos clave"}


def summarize(inputs, opts, out):
    p = inputs[0]
    lang = opts.get("language", "español")
    length = opts.get("length", "medium")
    summary = None
    engine = "resumen local (sin IA)"
    if status()["configured"] and opts.get("engine", "ai") == "ai":
        try:
            summary = _ai_summary(p, lang, length)
            engine = "Claude"
        except RuntimeError as e:
            engine = f"resumen local (la IA falló: {e})"
    if summary is None:
        with open_pdf(p) as doc:
            text = "\n".join(pg.get_text() for pg in doc)
        summary = extractive_summary(text, {"short": 4, "medium": 8, "long": 15}.get(length, 8))
    dest = out / f"{p.stem}_resumen.md"
    dest.write_text(summary, encoding="utf-8")
    return {"files": [dest], "data": {"preview": summary, "engine": engine}}


def _ai_summary(p, lang, length):
    data = p.read_bytes()
    with open_pdf(p) as doc:
        pages = doc.page_count
        text = "\n".join(pg.get_text() for pg in doc)
    if len(data) < 30 * 1024 * 1024 and pages <= 600:
        content = [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                   "data": base64.standard_b64encode(data).decode()}}]
    else:
        content = [{"type": "text", "text": f"<documento>\n{text}\n</documento>"}]
    content.append({"type": "text", "text": f"Escribe {LENGTHS.get(length, LENGTHS['medium'])} de este documento, en {lang}. "
                                            "Empieza con una línea que diga de qué trata el documento. Usa Markdown."})
    return _ask(content, "Eres un asistente que resume documentos con precisión, sin inventar datos.")


STOP = set("""a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos
en entre era es esa esas ese eso esos esta estas este esto estos fue fueron ha han hasta hay la las le les lo los mas más me mi
muy no nos o otra otro para pero por porque que qué se ser si sí sin sobre su sus también tan te tiene tu un una uno unos y ya
the of and to in is for on that with as by are this be or from at it an was which not have has will can""".split())


def extractive_summary(text: str, n: int) -> str:
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n{2,}", text) if 40 <= len(s.strip()) <= 600]
    if not sents:
        return "_No se encontró texto suficiente para resumir (¿PDF escaneado? Prueba primero con OCR PDF)._"
    words = lambda s: [w for w in re.findall(r"\w+", s.lower()) if w not in STOP and len(w) > 2]  # noqa: E731
    freq = Counter(w for s in sents for w in words(s))
    top = freq.most_common(1)[0][1] if freq else 1
    scored = []
    for i, s in enumerate(sents):
        ws = words(s)
        if not ws:
            continue
        score = sum(freq[w] / top for w in ws) / math.sqrt(len(ws))
        score *= 1.25 if i < len(sents) * 0.15 else 1
        scored.append((score, i, s))
    best = sorted(sorted(scored, reverse=True)[:n], key=lambda x: x[1])
    keywords = ", ".join(w for w, _ in freq.most_common(8))
    return "## Resumen\n\n" + "\n".join(f"- {s}" for _, _, s in best) + f"\n\n**Palabras clave:** {keywords}\n"


# =================================================================== TRADUCIR
SCHEMA = {"type": "object", "properties": {"translations": {"type": "array", "items": {"type": "string"}}},
          "required": ["translations"], "additionalProperties": False}


def _translate_batch(texts, target):
    payload = json.dumps(texts, ensure_ascii=False)
    res = _ask([{"type": "text", "text":
                 f"Traduce cada elemento de este array JSON a {target}. Devuelve exactamente {len(texts)} "
                 f"traducciones en el mismo orden. Conserva números, nombres propios, URLs y saltos de línea.\n\n{payload}"}],
               "Eres un traductor profesional de documentos.", effort="low", schema=SCHEMA)
    out = json.loads(res)["translations"]
    if len(out) != len(texts):
        out = (out + texts)[:len(texts)]
    return out


def translate(inputs, opts, out):
    if not status()["configured"]:
        raise RuntimeError("Traducir PDF necesita la IA de Claude. Añade tu clave de API en Ajustes (⚙).")
    target = opts.get("language", "inglés")
    p = inputs[0]
    doc = open_pdf(p)
    pages = []
    for pg in doc:
        blocks = []
        for b in pg.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            lines = ["".join(s["text"] for s in ln["spans"]) for ln in b["lines"]]
            txt = "\n".join(lines).strip()
            if not txt or not re.search(r"[A-Za-zÀ-ÿ]", txt):
                continue
            span = b["lines"][0]["spans"][0]
            blocks.append({"rect": fitz.Rect(b["bbox"]), "text": txt, "size": span["size"],
                           "color": span["color"], "bold": bool(span["flags"] & 16)})
        pages.append(blocks)

    def work(blocks):
        if not blocks:
            return []
        res = []
        for i in range(0, len(blocks), 60):
            res += _translate_batch([b["text"] for b in blocks[i:i + 60]], target)
        return res

    with ThreadPoolExecutor(max_workers=4) as ex:
        translated = list(ex.map(work, pages))
    for pg, blocks, tr in zip(doc, pages, translated):
        for b in blocks:
            pg.add_redact_annot(b["rect"])
        pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        for b, t in zip(blocks, tr):
            c = b["color"]
            css = (f"* {{font-family: sans-serif; font-size: {b['size']:.1f}px; "
                   f"color: rgb({(c >> 16) & 255},{(c >> 8) & 255},{c & 255}); "
                   f"font-weight: {'bold' if b['bold'] else 'normal'}; line-height: 1.15;}}")
            html = t.replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br>")
            r = b["rect"] + (0, 0, 2, 2)
            pg.insert_htmlbox(r, html, css=css, scale_low=0)
    dest = out / f"{p.stem}_{re.sub(r'[^a-zA-Z]', '', target)[:12] or 'traducido'}.pdf"
    doc.save(dest, garbage=3, deflate=True)
    doc.close()
    return {"files": [dest]}
