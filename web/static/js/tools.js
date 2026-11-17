// Catálogo de herramientas de iwantpdf. Cada herramienta define qué acepta, qué opciones muestra
// y a qué endpoint del servidor local llama.
const CAT = {
  organize: { name: 'Ordenar PDF', color: '#F2683C' },
  optimize: { name: 'Optimizar PDF', color: '#3FA45B' },
  toPdf: { name: 'Convertir a PDF', color: '#E8A21A' },
  fromPdf: { name: 'Convertir desde PDF', color: '#2D7FF9' },
  edit: { name: 'Editar PDF', color: '#A15CDB' },
  security: { name: 'Seguridad PDF', color: '#2B5C9E' },
  workflow: { name: 'Flujos de trabajo', color: '#E0457B' },
};

const FILTERS = [
  ['all', 'Todos'], ['workflow', 'Flujos de trabajo'], ['organize', 'Ordenar PDF'], ['optimize', 'Optimizar PDF'],
  ['convert', 'Convertir PDF'], ['edit', 'Editar PDF'], ['security', 'Seguridad PDF'],
];

const PDF = '.pdf,application/pdf';
const IMAGES = '.jpg,.jpeg,.png,.bmp,.gif,.tif,.tiff,.webp,image/*';
const FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Comic Sans MS', 'Segoe Script'];
const LANGS = ['español', 'inglés', 'portugués', 'francés', 'alemán', 'italiano', 'catalán', 'neerlandés', 'polaco',
  'ruso', 'ucraniano', 'chino simplificado', 'japonés', 'coreano', 'árabe', 'hindi', 'turco', 'sueco'];
const POS9 = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const POS6 = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

const TOOLS = [
  {
    slug: 'unir-pdf', api: 'merge', cat: 'organize', icon: 'merge', name: 'Unir PDF',
    desc: 'Une PDFs y ponlos en el orden que prefieras. ¡Rápido y fácil!',
    accept: PDF + ',' + IMAGES, multiple: true, min: 2, sortable: true, action: 'Unir PDF',
    hint: 'Arrastra las tarjetas para cambiar el orden.',
  },
  {
    slug: 'dividir-pdf', api: 'split', cat: 'organize', icon: 'split', name: 'Dividir PDF',
    desc: 'Extrae una o varias páginas de tu PDF o convierte cada página del PDF en un archivo PDF independiente.',
    accept: PDF, multiple: false, action: 'Dividir PDF',
    options: [
      { key: 'mode', type: 'cards', label: 'Modo', default: 'ranges', choices: [
        ['ranges', 'Por rangos', 'Rangos personalizados'], ['fixed', 'Rangos fijos', 'Cada N páginas'],
        ['all', 'Todas', 'Cada página en un PDF'], ['select', 'Extraer', 'Páginas concretas'], ['size', 'Por tamaño', 'Máx. MB por archivo']] },
      { key: 'ranges', type: 'ranges', label: 'Rangos', show: o => o.mode === 'ranges' },
      { key: 'merge_all', type: 'check', label: 'Unir todos los rangos en un único PDF', show: o => o.mode === 'ranges' },
      { key: 'every', type: 'number', label: 'Dividir cada (páginas)', default: 1, min: 1, show: o => o.mode === 'fixed' },
      { key: 'pages', type: 'text', label: 'Páginas a extraer', placeholder: 'ej. 1,3,5-8', show: o => o.mode === 'select' },
      { key: 'separate', type: 'check', label: 'Guardar cada página como un PDF independiente', show: o => o.mode === 'select' },
      { key: 'max_mb', type: 'number', label: 'Tamaño máximo por archivo (MB)', default: 5, min: 0.1, step: 0.1, show: o => o.mode === 'size' },
    ],
  },
  {
    slug: 'comprimir-pdf', api: 'compress', cat: 'optimize', icon: 'compress', name: 'Comprimir PDF',
    desc: 'Consigue que tu documento PDF pese menos y, al mismo tiempo, mantener la máxima calidad posible. Optimiza tus archivos PDF.',
    accept: PDF, multiple: true, action: 'Comprimir PDF',
    options: [
      { key: 'level', type: 'cards', label: 'Nivel de compresión', default: 'recommended', vertical: true, choices: [
        ['extreme', 'Compresión extrema', 'Menos calidad, alta compresión'],
        ['recommended', 'Compresión recomendada', 'Buena calidad, buena compresión'],
        ['low', 'Baja compresión', 'Alta calidad, menos compresión']] },
      { key: 'grayscale', type: 'check', label: 'Convertir imágenes a escala de grises' },
    ],
  },
  {
    slug: 'pdf-a-word', api: 'pdf_to_word', cat: 'fromPdf', icon: 'word', name: 'PDF a Word',
    desc: 'Convierte fácilmente tus archivos PDF a DOCX de WORD editables.', accept: PDF, multiple: true, action: 'Convertir a Word',
    options: [{ key: 'mode', type: 'cards', label: 'Tipo de documento', default: 'normal', choices: [
      ['normal', 'Sin OCR', 'PDF con texto seleccionable'], ['ocr', 'Con OCR', 'PDF escaneado']] }],
  },
  {
    slug: 'pdf-a-powerpoint', api: 'pdf_to_ppt', cat: 'fromPdf', icon: 'ppt', name: 'PDF a PowerPoint',
    desc: 'Convierte tus archivos PDF a presentaciones PPTX de POWERPOINT.', accept: PDF, multiple: true, action: 'Convertir a PowerPoint',
    options: [{ key: 'editable', type: 'check', label: 'Texto editable (si no, cada diapositiva es una imagen)', default: true }],
  },
  {
    slug: 'pdf-a-excel', api: 'pdf_to_excel', cat: 'fromPdf', icon: 'excel', name: 'PDF a Excel',
    desc: 'Extrae directamente datos de PDF a Excel en pocos segundos.', accept: PDF, multiple: true, action: 'Convertir a Excel',
  },
  {
    slug: 'word-a-pdf', api: 'word_to_pdf', cat: 'toPdf', icon: 'word', iconRev: true, name: 'Word a PDF',
    desc: 'Convierte documentos WORD (.docx) y archivos de texto a PDF, con sus títulos, listas, tablas e imágenes.',
    accept: '.docx,.txt', multiple: true, action: 'Convertir a PDF',
  },
  {
    slug: 'excel-a-pdf', api: 'excel_to_pdf', cat: 'toPdf', icon: 'excel', iconRev: true, name: 'Excel a PDF',
    desc: 'Convierte tus tablas EXCEL a PDF con las columnas ajustadas al ancho de la página. Vertical u horizontal, tú escoges la orientación.',
    accept: '.xls,.xlsx,.xlsm,.csv,.ods', multiple: true, action: 'Convertir a PDF',
    options: [
      { key: 'orientation', type: 'cards', label: 'Orientación', default: 'auto', choices: [['auto', 'Original', ''], ['portrait', 'Vertical', ''], ['landscape', 'Horizontal', '']] },
      { key: 'fit_width', type: 'check', label: 'Ajustar columnas al ancho de la página', default: true },
    ],
  },
  {
    slug: 'editar-pdf', api: 'edit', cat: 'edit', icon: 'edit', name: 'Editar PDF',
    desc: 'Añadir texto, imágenes, formas o anotaciones a mano en el documento PDF. Editar el tamaño, fuente y color del contenido añadido.',
    accept: PDF, multiple: false, custom: 'editor', mode: 'edit', action: 'Guardar cambios',
  },
  {
    slug: 'pdf-a-jpg', api: 'pdf_to_jpg', cat: 'fromPdf', icon: 'jpg', name: 'PDF a JPG',
    desc: 'Extrae todas las imágenes que están dentro de un PDF o convierte cada página en una imagen JPG.',
    accept: PDF, multiple: true, action: 'Convertir a JPG',
    options: [
      { key: 'mode', type: 'cards', label: 'Modo', default: 'pages', choices: [['pages', 'Página a JPG', 'Cada página será una imagen'], ['images', 'Extraer imágenes', 'Las imágenes del PDF']] },
      { key: 'dpi', type: 'select', label: 'Calidad', default: '150', choices: [['72', 'Baja (72 ppp)'], ['150', 'Normal (150 ppp)'], ['300', 'Alta (300 ppp)']], show: o => o.mode === 'pages' },
      { key: 'format', type: 'select', label: 'Formato', default: 'jpg', choices: [['jpg', 'JPG'], ['png', 'PNG']], show: o => o.mode === 'pages' },
    ],
  },
  {
    slug: 'jpg-a-pdf', api: 'jpg_to_pdf', cat: 'toPdf', icon: 'jpg', iconRev: true, name: 'JPG a PDF',
    desc: 'Convierte tus imágenes JPG a PDF. Ajusta la orientación y los márgenes.',
    accept: IMAGES, multiple: true, sortable: true, action: 'Convertir a PDF',
    options: [
      { key: 'orientation', type: 'cards', label: 'Orientación', default: 'portrait', choices: [['portrait', 'Vertical', ''], ['landscape', 'Horizontal', ''], ['auto', 'Automática', '']] },
      { key: 'page_size', type: 'select', label: 'Tamaño de página', default: 'A4', choices: [['A4', 'A4 (297x210 mm)'], ['Letter', 'Carta (8.5x11 in)'], ['Legal', 'Oficio'], ['fit', 'Mismo tamaño que la imagen']] },
      { key: 'margin', type: 'cards', label: 'Margen', default: 'none', choices: [['none', 'Sin margen', ''], ['small', 'Pequeño', ''], ['big', 'Grande', '']] },
      { key: 'merge', type: 'check', label: 'Unir todas las imágenes en un PDF', default: true },
    ],
  },
  {
    slug: 'firmar-pdf', api: 'sign', cat: 'security', icon: 'sign', name: 'Firmar PDF',
    desc: 'Fírmalo tú mismo: dibuja, escribe o sube tu firma, y añade iniciales, nombre y fecha.',
    accept: PDF, multiple: false, custom: 'editor', mode: 'sign', action: 'Firmar',
  },
  {
    slug: 'marca-de-agua', api: 'watermark', cat: 'edit', icon: 'watermark', name: 'Marca de agua',
    desc: 'Elige una imagen o texto para insertarlo encima de un PDF. Elige posición, transparencia y tipografía.',
    accept: PDF, multiple: true, action: 'Añadir marca de agua',
    options: [
      { key: 'type', type: 'cards', label: 'Tipo', default: 'text', choices: [['text', 'Texto', ''], ['image', 'Imagen', '']] },
      { key: 'text', type: 'textarea', label: 'Texto', default: 'CONFIDENCIAL', show: o => o.type === 'text' },
      { key: 'font', type: 'select', label: 'Fuente', default: 'Arial', choices: FONTS.map(f => [f, f]), show: o => o.type === 'text' },
      { key: 'font_size', type: 'number', label: 'Tamaño', default: 48, min: 6, max: 300, show: o => o.type === 'text', half: true },
      { key: 'color', type: 'color', label: 'Color', default: '#d93025', show: o => o.type === 'text', half: true },
      { key: 'bold', type: 'check', label: 'Negrita', show: o => o.type === 'text', half: true },
      { key: 'italic', type: 'check', label: 'Cursiva', show: o => o.type === 'text', half: true },
      { key: 'image', type: 'image', label: 'Imagen', show: o => o.type === 'image' },
      { key: 'image_scale', type: 'range', label: 'Tamaño de la imagen (% del ancho)', default: 30, min: 5, max: 100, show: o => o.type === 'image' },
      { key: 'position', type: 'pos', label: 'Posición', default: 'center', positions: POS9, show: o => !o.mosaic },
      { key: 'mosaic', type: 'check', label: 'Mosaico (repetir por toda la página)' },
      { key: 'opacity', type: 'range', label: 'Transparencia (opacidad %)', default: 50, min: 5, max: 100 },
      { key: 'rotation', type: 'select', label: 'Rotación', default: '0', choices: [['0', 'No rotar'], ['45', '45°'], ['90', '90°'], ['180', '180°'], ['270', '270°'], ['-45', '-45°']] },
      { key: 'layer', type: 'cards', label: 'Capa', default: 'over', choices: [['over', 'Sobre el contenido', ''], ['under', 'Bajo el contenido', '']] },
      { key: 'pages', type: 'text', label: 'Páginas', placeholder: 'todas (o ej. 1-3,7)' },
    ],
  },
  {
    slug: 'rotar-pdf', api: 'rotate', cat: 'edit', icon: 'rotate', name: 'Rotar PDF',
    desc: 'Rota tus PDF como quieras. Rota muchos documentos PDF a la vez.',
    accept: PDF, multiple: true, custom: 'rotate', action: 'Rotar PDF',
  },
  {
    slug: 'html-a-pdf', api: 'html_to_pdf', cat: 'toPdf', icon: 'html', iconRev: true, name: 'HTML a PDF',
    desc: 'Convierte páginas web de HTML a PDF. Copia y pega la dirección de la página que quieres convertir a PDF.',
    accept: '.html,.htm', multiple: false, custom: 'html', action: 'Convertir a PDF',
    options: [
      { key: 'screen', type: 'cards', label: 'Tamaño de pantalla', default: 'desktop', choices: [['desktop', 'Escritorio', '1440 px'], ['tablet', 'Tablet', '768 px'], ['mobile', 'Móvil', '390 px']] },
      { key: 'page_size', type: 'select', label: 'Tamaño de página', default: 'A4', choices: [['A4', 'A4'], ['Letter', 'Carta'], ['Legal', 'Oficio'], ['A3', 'A3']], show: o => !o.one_page },
      { key: 'orientation', type: 'cards', label: 'Orientación', default: 'portrait', choices: [['portrait', 'Vertical', ''], ['landscape', 'Horizontal', '']], show: o => !o.one_page },
      { key: 'margin', type: 'cards', label: 'Margen', default: 'small', choices: [['none', 'Sin margen', ''], ['small', 'Pequeño', ''], ['big', 'Grande', '']] },
      { key: 'one_page', type: 'check', label: 'Una sola página larga' },
      { key: 'block_popups', type: 'check', label: 'Ocultar avisos de cookies y ventanas emergentes', default: true },
    ],
  },
  {
    slug: 'desbloquear-pdf', api: 'unlock', cat: 'security', icon: 'unlock', name: 'Desbloquear PDF',
    desc: 'Quita la contraseña y las restricciones de los PDF, así podrás usarlos para lo que quieras.',
    accept: PDF, multiple: true, action: 'Desbloquear PDF',
    options: [{ key: 'password', type: 'password', label: 'Contraseña de apertura (si la tiene)', placeholder: 'déjalo vacío si solo tiene restricciones' }],
  },
  {
    slug: 'proteger-pdf', api: 'protect', cat: 'security', icon: 'lock', name: 'Proteger PDF',
    desc: 'Protege PDF con contraseña. Encripta archivos PDF (AES-256) para evitar accesos no autorizados.',
    accept: PDF, multiple: true, action: 'Proteger PDF',
    options: [
      { key: 'password', type: 'password', label: 'Contraseña', required: true },
      { key: 'confirm', type: 'password', label: 'Repite la contraseña', required: true },
      { key: 'permissions', type: 'perms', label: 'Permitir a quien abra el PDF' },
    ],
  },
  {
    slug: 'ordenar-pdf', api: 'organize', cat: 'organize', icon: 'organize', name: 'Ordenar PDF',
    desc: 'Ordena las páginas de tu PDF como quieras. Elimina o añade páginas PDF a tu documento según necesites.',
    accept: PDF, multiple: true, custom: 'organize', action: 'Ordenar',
  },
  {
    slug: 'pdf-a-pdfa', api: 'pdfa', cat: 'fromPdf', icon: 'pdfa', name: 'PDF a PDF/A',
    desc: 'Transforma tu PDF a PDF/A, la versión ISO estandarizada de PDF para archivar a largo plazo.',
    accept: PDF, multiple: true, action: 'Convertir a PDF/A',
    options: [{ key: 'level', type: 'cards', label: 'Nivel de conformidad', default: '2b', choices: [['1b', 'PDF/A-1b', ''], ['2b', 'PDF/A-2b', 'Recomendado'], ['3b', 'PDF/A-3b', '']] }],
  },
  {
    slug: 'reparar-pdf', api: 'repair', cat: 'optimize', icon: 'repair', name: 'Reparar PDF',
    desc: 'Repara PDF dañados y recupera datos de PDF corruptos.', accept: PDF, multiple: true, action: 'Reparar PDF',
  },
  {
    slug: 'numeros-de-pagina', api: 'page_numbers', cat: 'edit', icon: 'numbers', name: 'Números de página',
    desc: 'Añade números de página a un PDF. Escoge posición, dimensiones, formato y tipografía.',
    accept: PDF, multiple: true, action: 'Añadir números',
    options: [
      { key: 'facing', type: 'check', label: 'Modo página doble (refleja izquierda/derecha en páginas pares)' },
      { key: 'position', type: 'pos', label: 'Posición', default: 'bottom-center', positions: POS6 },
      { key: 'margin', type: 'select', label: 'Margen', default: 'recommended', choices: [['small', 'Pequeño'], ['recommended', 'Recomendado'], ['big', 'Grande']] },
      { key: 'first_number', type: 'number', label: 'Primer número', default: 1, min: 0, half: true },
      { key: 'from', type: 'number', label: 'Desde la página', default: 1, min: 1, half: true },
      { key: 'to', type: 'number', label: 'Hasta la página', placeholder: 'última', min: 1, half: true },
      { key: 'text', type: 'combo', label: 'Texto', default: '{n}', choices: ['{n}', 'Página {n}', 'Página {n} de {p}', '{n} / {p}', '- {n} -'], help: '{n} = número, {p} = total' },
      { key: 'font', type: 'select', label: 'Fuente', default: 'Arial', choices: FONTS.map(f => [f, f]) },
      { key: 'font_size', type: 'number', label: 'Tamaño', default: 12, min: 5, max: 72, half: true },
      { key: 'color', type: 'color', label: 'Color', default: '#000000', half: true },
      { key: 'bold', type: 'check', label: 'Negrita' },
    ],
  },
  {
    slug: 'escanear-a-pdf', api: 'scan_to_pdf', cat: 'organize', icon: 'scan', name: 'Escanea a PDF',
    desc: 'Captura documentos con la cámara del PC o desde tu móvil y conviértelos en PDF al instante.',
    accept: IMAGES, multiple: true, custom: 'scan', sortable: true, action: 'Crear PDF',
    options: [
      { key: 'filter', type: 'cards', label: 'Filtro', default: 'color', choices: [['color', 'Color', ''], ['gray', 'Gris', ''], ['bw', 'Blanco y negro', '']] },
      { key: 'page_size', type: 'select', label: 'Tamaño de página', default: 'A4', choices: [['A4', 'A4'], ['Letter', 'Carta'], ['fit', 'Igual que la foto']] },
    ],
  },
  {
    slug: 'ocr-pdf', api: 'ocr', cat: 'optimize', icon: 'ocr', name: 'OCR PDF',
    desc: 'Convierte fácilmente PDF escaneados en documentos PDF con texto seleccionable y buscable.',
    accept: PDF, multiple: true, action: 'Aplicar OCR', needs: 'ocr',
    options: [
      { key: 'lang', type: 'select', label: 'Idioma del documento', default: '', choices: 'ocrLangs' },
      { key: 'force', type: 'check', label: 'Reconocer también las páginas que ya tienen texto' },
      { key: 'txt', type: 'check', label: 'Generar también un archivo .txt', default: true },
    ],
  },
  {
    slug: 'comparar-pdf', api: 'compare', cat: 'security', icon: 'compare', name: 'Comparar PDF',
    desc: 'Compara dos archivos simultáneamente para ver las diferencias entre ambas versiones.',
    accept: PDF, multiple: true, min: 2, max: 2, sortable: true, action: 'Comparar',
    hint: 'El primer archivo es el original y el segundo la versión nueva.',
  },
  {
    slug: 'censurar-pdf', api: 'redact', cat: 'security', icon: 'redact', name: 'Censurar PDF',
    desc: 'Censura el texto y los gráficos de un PDF para eliminar permanentemente la información sensible.',
    accept: PDF, multiple: false, custom: 'editor', mode: 'redact', action: 'Censurar',
  },
  {
    slug: 'recortar-pdf', api: 'crop', cat: 'edit', icon: 'crop', name: 'Recortar PDF',
    desc: 'Elimina los márgenes de tus documentos PDF o selecciona un área específica para aplicar los cambios a una página o a todo el documento.',
    accept: PDF, multiple: false, custom: 'editor', mode: 'crop', action: 'Recortar',
  },
  {
    slug: 'formularios-pdf', api: 'forms', cat: 'edit', icon: 'forms', name: 'Formularios PDF', badge: '¡Nuevo!',
    desc: 'Detecta automáticamente los campos, crea PDFs rellenables o completa formularios PDF. Añade campos de texto, casillas, opciones y listas.',
    accept: PDF, multiple: false, custom: 'editor', mode: 'forms', action: 'Guardar formulario',
  },
  {
    slug: 'pdf-a-markdown', api: 'pdf_to_markdown', cat: 'fromPdf', icon: 'markdown', name: 'PDF a Markdown',
    desc: 'Convierte PDFs a archivos Markdown. Ideal para notas, documentos y LLMs. Conserva encabezados, tablas, listas y enlaces.',
    accept: PDF, multiple: true, action: 'Convertir a Markdown',
  },
  {
    slug: 'flujos-de-trabajo', api: null, cat: 'workflow', icon: 'workflow', name: 'Crea un flujo de trabajo', featured: true,
    desc: 'Crea flujos de trabajo personalizados con tus herramientas favoritas y automatiza tareas para reutilizarlas en cualquier momento.',
    accept: PDF, multiple: true, custom: 'workflow', action: 'Ejecutar flujo',
  },
];

// qué filtros incluyen cada categoría
const FILTER_CATS = {
  all: null, workflow: ['workflow'], organize: ['organize'], optimize: ['optimize'], convert: ['toPdf', 'fromPdf'],
  edit: ['edit'], security: ['security'],
};

// herramientas que se pueden encadenar en flujos de trabajo (PDF -> PDF salvo el último paso)
const CHAINABLE = ['compress', 'rotate', 'watermark', 'page_numbers', 'protect', 'unlock', 'pdfa', 'repair', 'ocr',
  'merge', 'split', 'crop', 'pdf_to_word', 'pdf_to_jpg', 'pdf_to_excel', 'pdf_to_ppt', 'pdf_to_markdown'];
// atajos tras un resultado en PDF
const NEXT_TOOLS = ['compress', 'merge', 'split', 'organize', 'rotate', 'edit', 'sign', 'watermark', 'page_numbers',
  'protect', 'ocr', 'pdf_to_word', 'pdf_to_jpg'];

// ----------------------------------------------------------------- iconos (SVG propios)
const GLYPH = {
  merge: '<path d="M6 5h5v5H6zM13 14h5v5h-5z" fill="#fff" opacity=".55"/><path d="M8 12v3a2 2 0 0 0 2 2h2M16 12V9a2 2 0 0 0-2-2h-2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="m10.5 15 1.8 2-1.8 2M13.5 9l-1.8-2 1.8-2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  split: '<path d="M5 5h6v14H5zM13 5h6v14h-6z" fill="#fff" opacity=".55"/><path d="M12 3v18" stroke="#fff" stroke-width="1.8" stroke-dasharray="2 2"/>',
  compress: '<path d="M4 4l5 5M9 5v4H5M20 20l-5-5M15 19v-4h4M20 4l-5 5M19 9h-4V5M4 20l5-5M5 15h4v4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  word: '<rect x="5" y="4" width="14" height="16" rx="2" fill="#fff" opacity=".25"/><path d="m7.5 9 1.6 6 1.9-5 1.9 5 1.6-6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  ppt: '<rect x="5" y="4" width="14" height="16" rx="2" fill="#fff" opacity=".25"/><path d="M10 16V8h2.6a2.4 2.4 0 0 1 0 4.8H10" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  excel: '<rect x="5" y="4" width="14" height="16" rx="2" fill="#fff" opacity=".25"/><path d="m9 8 6 8M15 8l-6 8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  jpg: '<rect x="4" y="5" width="16" height="14" rx="2" fill="#fff" opacity=".25"/><circle cx="9" cy="10" r="1.6" fill="#fff"/><path d="m5 17 5-5 3 3 2-2 4 4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  html: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="m13 7 4 4" stroke="#fff" stroke-width="1.8"/>',
  sign: '<path d="M4 17c3-1 4-9 6-9s-1 8 1 8 2-4 4-4 1 3 3 3 2-1 2-1" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M4 20h16" stroke="#fff" stroke-width="1.4" opacity=".6"/>',
  watermark: '<path d="M12 4s5 6 5 9.5a5 5 0 0 1-10 0C7 10 12 4 12 4z" stroke="#fff" stroke-width="1.8" fill="#fff" fill-opacity=".25"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.1-5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M19 4v4h-4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2" fill="#fff" opacity=".3" stroke="#fff" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2" fill="#fff" opacity=".3" stroke="#fff" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#fff" stroke-width="1.8" fill="none"/>',
  organize: '<rect x="4" y="4" width="7" height="7" rx="1.2" fill="#fff"/><rect x="13" y="4" width="7" height="7" rx="1.2" fill="#fff" opacity=".5"/><rect x="4" y="13" width="7" height="7" rx="1.2" fill="#fff" opacity=".5"/><rect x="13" y="13" width="7" height="7" rx="1.2" fill="#fff"/>',
  pdfa: '<rect x="5" y="4" width="14" height="16" rx="2" fill="#fff" opacity=".25"/><path d="M8.5 16 11 8l2.5 8M9.3 13.5h3.4M15.5 8v8" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  repair: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-1-1-2.5z" stroke="#fff" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
  numbers: '<rect x="4" y="4" width="7" height="7" rx="1.2" fill="#fff" opacity=".3"/><rect x="13" y="4" width="7" height="7" rx="1.2" fill="#fff" opacity=".3"/><rect x="4" y="13" width="7" height="7" rx="1.2" fill="#fff" opacity=".3"/><rect x="13" y="13" width="7" height="7" rx="1.2" fill="#fff" opacity=".3"/><text x="7.5" y="9.6" font-size="5.5" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">1</text><text x="16.5" y="9.6" font-size="5.5" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">2</text><text x="7.5" y="18.6" font-size="5.5" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">3</text><text x="16.5" y="18.6" font-size="5.5" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">4</text>',
  scan: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M4 12h16" stroke="#fff" stroke-width="1.8"/><rect x="7" y="7" width="10" height="10" fill="#fff" opacity=".25"/>',
  ocr: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><text x="12" y="14.6" font-size="6.5" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">OCR</text>',
  compare: '<rect x="4" y="5" width="7" height="14" rx="1.2" fill="#fff" opacity=".3" stroke="#fff" stroke-width="1.4"/><rect x="13" y="5" width="7" height="14" rx="1.2" fill="#fff" opacity=".3" stroke="#fff" stroke-width="1.4"/><path d="M6 9h3M6 12h3M15 9h3M15 12h3M15 15h3" stroke="#fff" stroke-width="1.4"/>',
  redact: '<rect x="5" y="4" width="14" height="16" rx="2" fill="#fff" opacity=".25"/><rect x="7" y="8" width="10" height="3" fill="#fff"/><path d="M7 14h4M13 14h4M7 17h7" stroke="#fff" stroke-width="1.4"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  forms: '<rect x="4" y="5" width="16" height="14" rx="2" fill="#fff" opacity=".25"/><rect x="6.5" y="8" width="3" height="3" rx=".6" stroke="#fff" stroke-width="1.3" fill="none"/><path d="M11.5 9.5h6M6.5 15h11" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
  summary: '<path d="M5 7h8M5 11h11M5 15h7M5 19h9" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="m18 3 .9 2.1L21 6l-2.1.9L18 9l-.9-2.1L15 6l2.1-.9z" fill="#fff"/>',
  translate: '<path d="M4 6h8M8 4v2M6 6c0 3 2.5 5.5 5 6.5M10 6c0 3-2.5 6-5.5 7" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="m12.5 20 3.5-9 3.5 9M13.8 17h4.4" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  markdown: '<rect x="3.5" y="6" width="17" height="12" rx="2" stroke="#fff" stroke-width="1.6" fill="#fff" fill-opacity=".2"/><path d="M6.5 15V9l2.5 3 2.5-3v6M15.5 9v6M13.5 13l2 2 2-2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  workflow: '<circle cx="6" cy="6" r="2.2" fill="#fff"/><circle cx="18" cy="12" r="2.2" fill="#fff"/><circle cx="6" cy="18" r="2.2" fill="#fff"/><path d="M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4" stroke="#fff" stroke-width="1.6" fill="none"/>',
};

function toolIcon(t, size = 44) {
  const c = CAT[t.cat].color;
  return `<svg class="ticon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="${c}"/>${GLYPH[t.icon] || ''}</svg>`;
}

const byApi = Object.fromEntries(TOOLS.filter(t => t.api).map(t => [t.api, t]));
const bySlug = Object.fromEntries(TOOLS.map(t => [t.slug, t]));
