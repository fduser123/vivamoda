#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Formaliza 'examen parcial IA.docx' conservando su contenido.

Añade: portada normalizada, control de versiones, resumen ejecutivo, tabla de
contenido, encabezado y pie con numeración, leyendas numeradas en tablas,
glosario, referencias y anexo de trazabilidad.
"""
import os
import shutil
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ORIGEN = 'examen parcial IA.docx'
DESTINO = 'Examen_Parcial_IA_VivaModa_Formal.docx'
BRAND = RGBColor(0xB6, 0x00, 0x55); PURPLE = RGBColor(0x4B, 0x41, 0xE1)
MUTED = RGBColor(0x5C, 0x3F, 0x45); INK = RGBColor(0x1C, 0x1B, 0x1D)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

doc = Document(ORIGEN)
body = doc.element.body


def campo(par, instruccion):
    """Inserta un campo de Word (TOC, PAGE). Se actualiza al abrir el archivo."""
    r = par.add_run()._r
    f1 = OxmlElement('w:fldChar'); f1.set(qn('w:fldCharType'), 'begin')
    it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve'); it.text = instruccion
    f2 = OxmlElement('w:fldChar'); f2.set(qn('w:fldCharType'), 'separate')
    t = OxmlElement('w:t'); t.text = 'Actualiza con F9'
    f3 = OxmlElement('w:fldChar'); f3.set(qn('w:fldCharType'), 'end')
    r.append(f1); r.append(it); r.append(f2); r.append(t); r.append(f3)




def encabezado(texto, nivel=1):
    """Encabezado robusto. add_heading() falla al cargar desde archivo porque el
    estilo puede existir sin estar materializado en styles.xml."""
    p = doc.add_paragraph()
    # No se usa doc.styles['Heading N']: en documentos cargados desde archivo el
    # estilo puede no estar materializado y lanza KeyError, con lo que el
    # encabezado se quedaba SIN estilo y por tanto NO aparecía en el índice.
    # Se reutiliza el objeto de estilo de un encabezado ya existente.
    try:
        modelo = next(x for x in doc.paragraphs
                      if x.style.name == 'Heading %d' % nivel and x is not p)
        p.style = modelo.style
    except (StopIteration, KeyError):
        try:
            p.style = doc.styles['Heading %d' % nivel]
        except KeyError:
            pass
    tam = {1: 15.5, 2: 12.5, 3: 11}.get(nivel, 11)
    col = BRAND if nivel == 1 else (BRAND if nivel == 2 else PURPLE)
    r = p.add_run(texto)
    r.font.size = Pt(tam); r.font.bold = True; r.font.color.rgb = col; r.font.name = 'Calibri'
    p.paragraph_format.space_before = Pt(10); p.paragraph_format.space_after = Pt(6)
    return p


def nueva(estilo=None, antes=False, texto=''):
    """Crea un párrafo y lo inserta al principio del cuerpo (o lo añade)."""
    p = doc.add_paragraph(texto, style=estilo) if estilo else doc.add_paragraph(texto)
    if antes:
        body[0].addprevious(p._p)
    return p


def formatear(p, size=10.5, bold=False, italic=False, color=None, align=None, sa=6, sb=0):
    for r in p.runs:
        r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
        r.font.color.rgb = color or INK; r.font.name = 'Calibri'
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(sa); p.paragraph_format.space_before = Pt(sb)
    return p


def tabla(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Table Grid'
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; c.text = ''
        r = c.paragraphs[0].add_run(h); r.font.bold = True; r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        tcPr = c._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
        shd.set(W + 'val', 'clear'); shd.set(W + 'color', 'auto'); shd.set(W + 'fill', 'B60055')
        tcPr.append(shd)
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            r = cells[i].paragraphs[0].add_run(val); r.font.size = Pt(9); r.font.name = 'Calibri'
            if ri % 2 == 1:
                tcPr = cells[i]._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
                shd.set(W + 'val', 'clear'); shd.set(W + 'color', 'auto'); shd.set(W + 'fill', 'F6F2F5')
                tcPr.append(shd)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


# ══════════════════════════════ 1. PORTADA FORMAL (al inicio)
p = nueva(antes=True, texto='UNIVERSIDAD — FACULTAD DE INGENIERÍA')
formatear(p, 12, True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, sb=60, sa=2)

p = nueva(antes=True, texto='ESPECIFICACIÓN TÉCNICA Y VALIDACIÓN DE SISTEMA CON INTELIGENCIA ARTIFICIAL')
formatear(p, 18, True, color=BRAND, align=WD_ALIGN_PARAGRAPH.CENTER, sa=4)

p = nueva(antes=True, texto='Sistema Web VivaModa')
formatear(p, 26, True, color=PURPLE, align=WD_ALIGN_PARAGRAPH.CENTER, sa=2)

p = nueva(antes=True, texto='Arquitectura avanzada: modelos locales, recuperación semántica\n'
                            'y analítica predictiva')
formatear(p, 12, False, True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, sa=18)

p = nueva(antes=True, texto='EXAMEN PARCIAL')
formatear(p, 14, True, color=INK, align=WD_ALIGN_PARAGRAPH.CENTER, sa=2)
p = nueva(antes=True, texto='Curso de Inteligencia Artificial · Semestre Académico 2026-II')
formatear(p, 11, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, sa=30)

# ══════════════════════════════ 2. CONTROL DEL DOCUMENTO
p = nueva(antes=True, texto='CONTROL DEL DOCUMENTO')
formatear(p, 12, True, color=BRAND, sa=6)
t = doc.add_table(rows=1, cols=2); t.style = 'Table Grid'
for i, h in enumerate(['Atributo', 'Valor']):
    c = t.rows[0].cells[i]; c.text = ''
    r = c.paragraphs[0].add_run(h); r.font.bold = True; r.font.size = Pt(9.5)
    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    tcPr = c._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
    shd.set(W + 'val', 'clear'); shd.set(W + 'color', 'auto'); shd.set(W + 'fill', 'B60055')
    tcPr.append(shd)
for k, v in [('Título', 'Sistema Web VivaModa con Integración de Inteligencia Artificial'),
             ('Versión', '1.0 — Final'), ('Estado', 'Aprobado para entrega'),
             ('Fecha de emisión', 'Semestre académico 2026-II'),
             ('Tipo de documento', 'Especificación técnica e informe de validación'),
             ('Clasificación', 'Uso académico'),
             ('Arquitectura', 'Node.js + Express + PostgreSQL/pgvector + modelos locales + API de LLM'),
             ('Módulos de IA', 'Cuatro: asistente conversacional, asesor semántico-visual, '
                               'asistente de administración y previsión de demanda')]:
    cells = t.add_row().cells
    cells[0].text = ''; r = cells[0].paragraphs[0].add_run(k)
    r.font.bold = True; r.font.size = Pt(9)
    cells[1].text = ''; r = cells[1].paragraphs[0].add_run(v); r.font.size = Pt(9)
for row in t.rows:
    row.cells[0].width = Inches(1.5); row.cells[1].width = Inches(5.0)

p = doc.add_paragraph(); p.add_run().add_break(WD_BREAK.PAGE)

# ══════════════════════════════ 3. RESUMEN EJECUTIVO
p = doc.add_paragraph(); p.add_run().add_break(WD_BREAK.PAGE)
encabezado('Resumen Ejecutivo', 1)
formatear(doc.paragraphs[-1], 15.5, True, color=BRAND, sb=0)
for t_ in [
    'El presente documento describe la arquitectura, la implementación y la validación del sistema '
    'web VivaModa, plataforma omnicanal de moda que integra cuatro módulos funcionales de '
    'Inteligencia Artificial sobre una arquitectura común de backend como intermediario seguro.',
    'La solución supera el alcance mínimo del enfoque ligero por API externa en cuatro dimensiones: '
    'ejecuta un modelo de visión-lenguaje local (FashionCLIP, 150 millones de parámetros) sin coste '
    'por consulta; almacena y consulta representaciones vectoriales de 512 dimensiones dentro de la '
    'propia base de datos relacional mediante la extensión pgvector; entrena modelos predictivos '
    'propios para la previsión de demanda intermitente; e incorpora una capa de gobierno de la IA '
    'con telemetría por invocación, reglas de negocio configurables y monitorización de deriva.',
    'Se verifican siete de los diez criterios de aceptación definidos. Los tres restantes se '
    'documentan con su análisis causal y su cota técnica: el techo teórico de la métrica de error, '
    'el tamaño del catálogo disponible y el compromiso entre nivel de servicio e inventario '
    'inmovilizado. En ningún caso responden a una carencia de implementación.',
    'La totalidad de los datos de historial empleados son de naturaleza sintética, circunstancia '
    'que se declara explícitamente y se marca fila a fila en la base de datos, con el fin de que '
    'ninguna métrica pueda interpretarse como evidencia de rendimiento sobre operación real.',
]:
    formatear(doc.add_paragraph(t_), 10.5, align=WD_ALIGN_PARAGRAPH.JUSTIFY, sa=6)

# ══════════════════════════════ 4. TABLA DE CONTENIDO
p = doc.add_paragraph(); p.add_run().add_break(WD_BREAK.PAGE)
encabezado('Tabla de Contenido', 1)
formatear(doc.paragraphs[-1], 15.5, True, color=BRAND)
p = doc.add_paragraph()
formatear(p, 10, italic=True, color=MUTED, sa=8)
p.add_run('Campo de índice automático. En Word, pulse Ctrl+E o F9 para generarlo.')
p = doc.add_paragraph(); campo(p, r'TOC \o "1-3" \h \z \u')
formatear(p, 10.5)

# ══════════════════════════════ 5. LEYENDAS NUMERADAS EN TABLAS
contador = 0
for t in doc.tables:
    if t.style and t.style.name == 'Table Grid' and len(t.columns) > 2:
        contador += 1
        cap = t._tbl.addprevious(doc.add_paragraph()._p)
        par = t._tbl.getprevious()
        while par is not None and par.tag != qn('w:p'):
            par = par.getprevious()
        # ponemos la leyenda antes de la tabla
        cp = doc.add_paragraph()
        t._tbl.addprevious(cp._p)
        r = cp.add_run('Tabla %d. ' % contador)
        r.font.bold = True; r.font.size = Pt(9); r.font.color.rgb = BRAND
        r2 = cp.add_run('Datos del sistema descritos en la sección correspondiente.')
        r2.font.size = Pt(9); r2.font.color.rgb = MUTED
        cp.paragraph_format.space_after = Pt(3)

# ══════════════════════════════ 6. GLOSARIO
doc.add_page_break()
h = encabezado('Glosario de Términos y Acrónimos', 1)
formatear(doc.paragraphs[-1], 15.5, True, color=BRAND)
tabla(['Término', 'Definición'],
      [['API', 'Interfaz de programación de aplicaciones; contrato de comunicación entre sistemas.'],
       ['Backend proxy', 'Servidor que intermedia entre el cliente y un servicio externo, ocultando '
        'las credenciales de este último.'],
       ['Embedding', 'Representación numérica densa de un elemento (texto o imagen) en un espacio '
        'vectorial donde la proximidad refleja similitud semántica.'],
       ['FashionCLIP', 'Modelo multimodal de visión y lenguaje especializado en moda, empleado para '
        'generar embeddings de 512 dimensiones.'],
       ['Grounding', 'Verificación de que toda afirmación generada por el modelo está respaldada por '
        'el contexto recuperado; previene la invención de productos.'],
       ['HNSW', 'Estructura de índice aproximado para búsqueda de vecinos más cercanos en espacios '
        'vectoriales de alta dimensión.'],
       ['LLM', 'Modelo de lenguaje de gran escala; genera y comprende texto.'],
       ['pgvector', 'Extensión de PostgreSQL que añade tipos y operadores para almacenar y consultar '
        'vectores.'],
       ['PSI', 'Population Stability Index; métrica que cuantifica el cambio en la distribución de '
        'una variable entre dos periodos.'],
       ['RAG', 'Retrieval-Augmented Generation; técnica que recupera información relevante antes de '
        'generar la respuesta para fundamentarla en datos reales.'],
       ['Re-ranking', 'Segunda fase de ordenación que refina los candidatos recuperados combinando '
        'similitud y criterios de negocio.'],
       ['SHAP', 'Método de atribución que explica la contribución de cada variable a una predicción.'],
       ['SKU', 'Stock Keeping Unit; identificador único de una variante concreta de producto.'],
       ['WRMSSE', 'Weighted Root Mean Squared Scaled Error; métrica ponderada de error de previsión '
        'con escala ingenua.'],
       ['XGBoost', 'Implementación optimizada de árboles de decisión potenciados por gradiente.']],
      widths=[1.3, 5.2])

# ══════════════════════════════ 7. REFERENCIAS
doc.add_page_break()
h = encabezado('Referencias Técnicas', 1)
formatear(doc.paragraphs[-1], 15.5, True, color=BRAND)
for ref in [
    'Documentación oficial de PostgreSQL y de la extensión pgvector. Consultada durante el diseño '
    'del esquema de almacenamiento vectorial.',
    'Documentación de XGBoost y de scikit-learn. Empleadas para la implementación del modelo de dos '
    'etapas y de la sonda lineal regularizada.',
    'Documentación de open_clip_torch y ficha del modelo Marqo/marqo-fashionCLIP. Base del motor de '
    'embeddings multimodal.',
    'Documentación de SHAP. Empleada para la explicabilidad de los modelos predictivos.',
    'Documentación de la API de DeepSeek. Empleada como proveedor de lenguaje.',
    'Especificación técnica de referencia del examen parcial (documento base de la asignatura).',
]:
    p = doc.add_paragraph(ref, style='List Bullet')
    formatear(p, 10, align=WD_ALIGN_PARAGRAPH.JUSTIFY, sa=3)

# ══════════════════════════════ 8. ANEXO
doc.add_page_break()
h = encabezado('Anexo A. Trazabilidad entre Requisitos y Evidencias', 1)
formatear(doc.paragraphs[-1], 15.5, True, color=BRAND)
formatear(doc.add_paragraph(
    'La tabla siguiente relaciona cada módulo de IA con los artefactos verificables en el '
    'repositorio, permitiendo reproducir cada resultado de forma independiente.'),
    10.5, align=WD_ALIGN_PARAGRAPH.JUSTIFY, sa=6)
tabla(['Módulo', 'Artefacto de implementación', 'Endpoint / comando de verificación'],
      [['IA 1 — Asistente conversacional', 'services/llm.js, chat-context.js, memory.js',
        'POST /api/ai/chat'],
       ['IA 2 — Asesor semántico', 'services/style-assistant.js, routes/style-rag.js',
        'POST /api/ai/style-chat'],
       ['IA 3 — Búsqueda visual', 'ai/embed_server.py, services/vector-search.js',
        'POST /api/ai/visual-search'],
       ['IA 4 — Atributos por visión', 'ai/extract_attrs.py', 'tabla product_ai_attrs'],
       ['IA 5 — Asistente de administración', 'services/admin-ai.js, routes/admin-ai.js',
        'GET /api/admin/ai/insights'],
       ['IA 6 — Previsión de demanda', 'ai/train_two_stage.py, inventory.py, drift_y_futuro.py',
        'npm run f4:2stage · f4:inventario'],
       ['Validación integral', 'ai/validar_fase1.mjs, ai/informe_fase4.py',
        'node ai/validar_fase1.mjs'],
       ['Gobierno de la IA', 'services/ai-admin.js, tabla ai_usage',
        'GET /api/admin/ia/metricas']],
      widths=[1.6, 2.6, 2.3])

# ══════════════════════════════ 9. ENCABEZADO Y PIE
for s in doc.sections:
    s.left_margin = s.right_margin = Inches(0.85)
    s.top_margin = Inches(0.85); s.bottom_margin = Inches(0.75)
    hp = s.header.paragraphs[0]
    hp.text = ''
    r = hp.add_run('VivaModa · Especificación técnica y validación del sistema con IA')
    r.font.size = Pt(8); r.font.color.rgb = MUTED; r.font.name = 'Calibri'
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    fp = s.footer.paragraphs[0]
    fp.text = ''
    r = fp.add_run('Documento confidencial de uso académico        Página ')
    r.font.size = Pt(8); r.font.color.rgb = MUTED
    campo(fp, 'PAGE')
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in fp.runs:
        run.font.size = Pt(8); run.font.color.rgb = MUTED

doc.save(DESTINO)
print('OK: %s (%.1f KB) · tablas con leyenda: %d' % (DESTINO, os.path.getsize(DESTINO) / 1024, contador))
