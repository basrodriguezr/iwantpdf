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
