# iwantpdf

Herramientas PDF locales, sin anuncios, sin cuentas y sin límites. Todo se procesa en este equipo.

## Cómo abrirlo

- Doble clic en **`iniciar.bat`**: se abre `http://127.0.0.1:8765` en el navegador.
  La primera vez crea el entorno de Python e instala las dependencias (unos minutos).
- **`iniciar-red-local.bat`**: igual, pero accesible desde el móvil en tu Wi-Fi (para "Escanea a PDF" con QR).

Para cerrarlo, cierra la ventana negra de la consola.

## Herramientas (31 + flujos de trabajo)

| Categoría | Herramientas |
|---|---|
| Ordenar | Unir, Dividir (rangos, fijos, todas, extraer, por tamaño), Ordenar páginas, Escanear a PDF |
| Optimizar | Comprimir (3 niveles), Reparar, OCR (motor OCR de Windows, español) |
| Convertir a PDF | JPG, Word, PowerPoint, Excel (vía Microsoft Office), HTML/URL (vía Chrome) |
| Convertir desde PDF | Word, PowerPoint, Excel, JPG/PNG, PDF/A, Markdown |
| Editar | Editor (texto, imágenes, formas, dibujo, resaltado, tapar), Rotar, Números de página, Marca de agua, Recortar, Formularios (detectar, crear, rellenar, aplanar) |
| Seguridad | Desbloquear, Proteger (AES-256 + permisos), Firmar (dibujar/escribir/subir), Censurar (texto, patrones, áreas), Comparar |
| IA | Resumir (Claude o resumen local sin internet), Traducir (Claude) |

"Resumir con IA" y "Traducir PDF" necesitan una clave de API de Claude: ⚙ Ajustes → pega la clave.
Se guarda solo en `data/config.json`. Sin clave, Resumir usa un resumen extractivo local.

## Requisitos

Python 3.10+, Google Chrome o Edge (HTML a PDF), Microsoft Office o LibreOffice (Word/Excel/PowerPoint a PDF).

Los archivos temporales viven en `data/` y se borran solos a las 3 horas.

## Versión web (`web/`)

Copia de la interfaz que funciona sin servidor: todo se procesa en el navegador y los archivos no se suben a ninguna parte. Publicada en https://codebass.org/iwantpdf/.

- `web/static/js/engine.js` reemplaza al servidor Flask con la misma API (`/api/tool/<x>`, miniaturas, flujos), y `tools-pdf.js` / `tools-convert.js` son el equivalente de `core/` en JavaScript.
- Librerías incluidas en `web/vendor/`: pdf.js (vista y texto), pdf-lib (edición), qpdf en WebAssembly (proteger, desbloquear y reparar), Tesseract.js (OCR; descarga los datos del idioma la primera vez), docx, pptxgenjs, SheetJS, mammoth y html2canvas. Perfil sRGB para PDF/A: Compact-ICC-Profiles (CC0).
- Diferencias con la versión de escritorio: sin funciones de IA; sin PowerPoint a PDF; Word (solo .docx y .txt), Excel y HTML a PDF generan páginas como imagen; HTML a PDF solo con archivos (no URL); censurar convierte en imagen las páginas afectadas y conserva el resto del texto como capa invisible; las fuentes del sistema se sustituyen por las estándar de PDF.
- Para publicar: copiar `web/` a `codebass-web/hub/iwantpdf/` y desplegar el portal (`deploy/hub-worker`).
