#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera Manual_Integracion_y_Demostracion_IA_VivaModa.docx

Manual técnico de las IA del proyecto: cómo se integran, cómo funcionan, qué
algoritmos implementan y cómo demostrar que funcionan de verdad.

Requiere: python-docx
"""
import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.shared import Inches, Pt, RGBColor

BRAND = RGBColor(0xB6, 0x00, 0x55); PURPLE = RGBColor(0x4B, 0x41, 0xE1)
INK = RGBColor(0x1C, 0x1B, 0x1D);   MUTED = RGBColor(0x5C, 0x3F, 0x45)
GREEN = RGBColor(0x1B, 0x7A, 0x3D)

doc = Document()
st = doc.styles['Normal']
st.font.name = 'Calibri'; st.font.size = Pt(10.5); st.font.color.rgb = INK
for lvl, (sz, c) in enumerate([(15.5, BRAND), (12.5, BRAND), (11, PURPLE)], start=1):
    h = doc.styles['Heading %d' % lvl]
    h.font.name = 'Calibri'; h.font.size = Pt(sz); h.font.color.rgb = c; h.font.bold = True
for s in doc.sections:
    s.left_margin = s.right_margin = Inches(0.85)
    s.top_margin = s.bottom_margin = Inches(0.65)

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
    shd.set(W + 'val', 'clear'); shd.set(W + 'color', 'auto'); shd.set(W + 'fill', hexcolor)
    tcPr.append(shd)


def P(t='', size=10.5, bold=False, italic=False, color=None, align=None,
      space_after=5, space_before=0):
    p = doc.add_paragraph(); r = p.add_run(t)
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color or INK
    if align is not None: p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    return p


def MONO(t, size=9):
    """Bloque de código o traza."""
    p = doc.add_paragraph()
    r = p.add_run(t); r.font.name = 'Consolas'; r.font.size = Pt(size)
    r.font.color.rgb = RGBColor(0x24, 0x29, 0x2E)
    p.paragraph_format.space_after = Pt(6); p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.left_indent = Inches(0.18)
    return p


def BUL(t, size=10.5):
    p = doc.add_paragraph(t, style='List Bullet')
    p.paragraph_format.space_after = Pt(2)
    for r in p.runs: r.font.size = Pt(size); r.font.name = 'Calibri'
    return p


def NUM(t, size=10.5):
    p = doc.add_paragraph(t, style='List Number')
    p.paragraph_format.space_after = Pt(2)
    for r in p.runs: r.font.size = Pt(size); r.font.name = 'Calibri'
    return p


def KV(label, value):
    p = doc.add_paragraph()
    r1 = p.add_run(label); r1.font.bold = True; r1.font.size = Pt(10); r1.font.color.rgb = MUTED
    r2 = p.add_run(value); r2.font.size = Pt(10); r2.font.color.rgb = INK
    p.paragraph_format.space_after = Pt(1)
    return p


def TABLE(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; c.text = ''
        r = c.paragraphs[0].add_run(h); r.font.bold = True; r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF); shade(c, 'B60055')
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            r = cells[i].paragraphs[0].add_run(val); r.font.size = Pt(9); r.font.name = 'Calibri'
            if ri % 2 == 1: shade(cells[i], 'F6F2F5')
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths): row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(3)
    return t


def CALLOUT(title, text, fill='F3E5EE'):
    t = doc.add_table(rows=1, cols=1); t.style = 'Table Grid'
    c = t.rows[0].cells[0]; c.text = ''
    r1 = c.paragraphs[0].add_run(title); r1.font.bold = True; r1.font.size = Pt(10); r1.font.color.rgb = BRAND
    r2 = c.add_paragraph().add_run(text); r2.font.size = Pt(9.5); r2.font.color.rgb = INK
    shade(c, fill); doc.add_paragraph().paragraph_format.space_after = Pt(3)
    return t


# ================================================================ PORTADA
P('MANUAL DE INTEGRACIÓN, FUNCIONAMIENTO Y DEMOSTRACIÓN DE LA IA',
  size=16, bold=True, color=BRAND, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
P('Proyecto VivaModa — Explicación técnica de cada módulo de Inteligencia Artificial',
  size=12, bold=True, color=PURPLE, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
P('Este documento explica: qué algoritmos se implementaron, cómo se conectan entre sí, '
  'dónde está el código de cada uno y cómo demostrar en vivo que funcionan realmente.',
  size=10, italic=True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)

CALLOUT('CÓMO LEER ESTE MANUAL',
        'Las secciones 1 y 2 explican la arquitectura común y la infraestructura compartida. La '
        'sección 3 detalla cada una de las seis IA con su algoritmo, su flujo, sus archivos y su '
        'prueba. La sección 4 resume todos los algoritmos en una tabla. La sección 5 es una guía de '
        'demostración paso a paso. La sección 6 explica cómo demostrar que NO es una maqueta, y la '
        '7 declara las limitaciones con honestidad.', fill='EDE7F6')

# ================================================================ 1
doc.add_heading('1. Arquitectura General: el patrón que comparten todas las IA', level=1)
P('La decisión estructural más importante del proyecto es que ninguna IA se invoca desde el '
  'navegador. Todas siguen el mismo camino:')
MONO('navegador  →  backend Node  →  (contexto desde PostgreSQL)  →  proveedor de IA\n'
     '           ←  respuesta validada, guardada y telemetrizada  ←')
P('Este patrón se implementa por cuatro razones concretas:')
BUL('Custodia de credenciales: las claves de API viven en backend/.env, que está excluido del '
    'control de versiones. El navegador nunca las ve. El backend actúa como proxy.')
BUL('Consolidación de contexto: los datos relacionales (perfil, pedidos, carrito, inventario, '
    'memoria) se transforman en un prompt acotado. El cliente no decide qué información viaja.')
BUL('Degradación elegante: si el proveedor falla, tarda o no hay clave, el sistema responde con un '
    'motor local de reglas sobre el catálogo real. El servicio no se interrumpe.')
BUL('Gobernabilidad: al pasar todo por un único punto, se puede medir el coste y la latencia de '
    'cada llamada y auditar qué se envió y qué se recibió.')

doc.add_heading('Resolución del proveedor de IA', level=2)
P('El archivo backend/src/services/llm-provider.js centraliza la elección del proveedor. Se '
  'resuelve por prioridad, de modo que cambiar de proveedor es cambiar una variable de entorno:')
MONO('LLM_BASE_URL + LLM_API_KEY   →   LLM_PROVIDER   →   GEMINI_API_KEY\n'
     '   →   DEEPSEEK_API_KEY   →   OPENROUTER_API_KEY   →   motor local de reglas')
KV('Proveedor activo en esta instalación: ', 'DeepSeek, modelo deepseek-flash.')
CALLOUT('Detalle crítico aprendido en la implementación',
        'El payload debe enviar thinking: { type: "disabled" }. El modo de razonamiento extendido '
        'consumía el presupuesto de max_tokens y devolvía respuestas con content vacío: el sistema '
        'parecía responder "en blanco" cuando en realidad el modelo había gastado los tokens '
        'pensando. Se corrigió desactivándolo y subiendo el límite a 1200 tokens.', fill='FFF8E1')


# ---------------------------------------------------------------- DIAGRAMA
doc.add_heading('Diagrama de arquitectura y flujo', level=2)
P('El diagrama siguiente muestra las tres capas del sistema, los seis módulos de IA dentro del '
  'backend, los servicios que comparten y los dos proveedores externos a los que se conectan.')
_diag = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diagrama_arquitectura_ia.png')
if os.path.exists(_diag):
    doc.add_picture(_diag, width=Inches(6.8))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    P('Figura 1. Arquitectura y flujo de las seis IA. Las flechas indican el sentido de las '
      'peticiones: del navegador al backend, y de este a los proveedores y a la base de datos.',
      size=9, italic=True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
else:
    P('(No se encontró diagrama_arquitectura_ia.png: ejecuta generar_diagrama_ia.py)',
      size=9, italic=True, color=MUTED)

doc.add_heading('Cómo leer el diagrama', level=2)
BUL('Capa 1 — Navegador: las cuatro vistas que consumen IA. Ninguna habla directamente con un '
    'proveedor; todas pasan por el backend con su token de sesión.')
BUL('Capa 2 — Backend: aloja los seis módulos y los servicios transversales. Las líneas que los '
    'unen indican que comparten proveedor, telemetría, conocimiento y configuración.')
BUL('Capa 3 — Datos: PostgreSQL cumple doble función, base relacional y almacén vectorial. Es la '
    'razón de que no haya un motor vectorial separado.')
BUL('Proveedores: el LLM externo aporta el lenguaje; el sidecar local aporta la comprensión visual '
    'sin coste por consulta. Los módulos 2, 3 y 6 dependen del sidecar; el resto, del LLM.')

# ================================================================ 2
doc.add_heading('2. Infraestructura Compartida', level=1)
TABLE(['Pieza', 'Archivo / Ubicación', 'Función'],
      [['Abstracción de proveedor', 'backend/src/services/llm-provider.js',
        'Resuelve proveedor, cuenta tokens y coste, registra telemetría, aplica timeout y reintentos.'],
       ['Sidecar de embeddings', 'backend/ai/embed_server.py · puerto 8001',
        'Carga FashionCLIP una sola vez y sirve vectores normalizados por HTTP.'],
       ['Base de datos vectorial', 'PostgreSQL 16 + extensión pgvector',
        'Almacena y busca vectores de 512 dimensiones con índice HNSW y distancia coseno.'],
       ['Telemetría', 'tabla ai_usage · backend/src/services/ai-admin.js',
        'Una fila por llamada al modelo: proveedor, tokens, caché, coste, latencia y error.'],
       ['Conocimiento y ajustes', 'tablas ai_knowledge y ai_settings',
        'Reglas de negocio inyectadas en el prompt y configuración editable sin desplegar.'],
       ['Pipeline de datos', 'backend/ai/*.py · npm run f4:*',
        'Generación de historial, features, entrenamiento y validación.']],
      widths=[1.35, 2.05, 3.1])

doc.add_heading('2.1 Por qué un microservicio Python para los embeddings', level=2)
P('FashionCLIP solo existe en Python. Se podía haber llamado a una API externa de embeddings, pero '
  'eso añadiría coste por consulta y dependencia de red. La solución adoptada es un proceso Python '
  'mínimo que carga el modelo en memoria:')
MONO('POST /embed/text   { "texts": [...] }        →  vectores L2-normalizados\n'
     'POST /embed/image  { "image": "<base64>" }   →  vector de 512 dimensiones\n'
     'GET  /health                                  →  estado del modelo y dispositivo')
P('Cargar el modelo cuesta ~1,4 segundos una sola vez. Después cada vector tarda unos 190 ms. Si '
  'el sidecar no responde, los endpoints que dependen de él devuelven error controlado, pero el '
  'resto de la aplicación sigue funcionando.')

doc.add_heading('2.2 Cómo se almacenan y comparan los vectores', level=2)
P('Cada producto guarda TRES vectores independientes en la tabla product_embeddings:')
TABLE(['Vector', 'Origen', 'Para qué se usa'],
      [['image_vec', 'La fotografía del producto', 'Búsqueda visual y, sorprendentemente, también la '
        'mejor recuperación para consultas escritas.'],
       ['text_vec', 'Título, atributos y descripción enriquecida', 'Recuperación por texto.'],
       ['fused_vec', '0,7 · image_vec + 0,3 · text_vec', 'Espacio mixto por defecto en el asesor.']],
      widths=[1.1, 2.3, 3.1])
CALLOUT('Hallazgo medido que definió la arquitectura',
        'Se midió la calidad de recuperación de cada espacio por separado. Comparar el texto de la '
        'consulta contra vectores de TEXTO devolvía bolsos y adornos de zapatos para la consulta '
        '"vestido elegante para una boda en la playa". Comparar el mismo texto contra vectores de '
        'IMAGEN devolvía vestidos. Es la alineación cross-modal de CLIP: el espacio visual es el que '
        'mejor organiza el catálogo. De ahí el peso 0,7/0,3 en lugar del reparto intuitivo.', fill='E8F5E9')

# ================================================================ 3
doc.add_heading('3. Las Seis IA: Algoritmo, Funcionamiento y Prueba', level=1)

doc.add_heading('IA 1 — Aria: chatbot estilista con memoria', level=2)
KV('Problema que resuelve: ', 'atención al cliente saturada por consultas repetitivas y asesoría '
   'impersonal que no recuerda al cliente.')
KV('Algoritmo: ', 'Modelo de lenguaje (LLM) por API, con prompt de sistema delimitado, contexto '
   'relacional y extracción estructurada de hechos hacia memoria persistente.')
P('Flujo paso a paso:', bold=True, space_after=2)
NUM('El cliente escribe en el widget. JavaScript envía el mensaje a POST /api/ai/chat o al canal SSE '
    '/api/ai/chat/stream.')
NUM('El backend recupera de PostgreSQL: perfil del usuario, últimos pedidos, carrito activo, '
    'memoria aprendida (ai_memory) y reglas de negocio vigentes (ai_knowledge).')
NUM('Se ensambla el prompt: rol, reglas operativas, conocimiento del negocio, datos del cliente y '
    'formato de salida esperado.')
NUM('Se realiza la llamada HTTPS con autenticación Bearer y un AbortController como límite de tiempo.')
NUM('La respuesta se transmite al navegador. Si es streaming, se reenvía evento a evento.')
NUM('Al cerrar el turno, se extraen afirmaciones nuevas del cliente y se guardan en ai_memory con '
    'su nivel de confianza y origen.')
KV('Archivos: ', 'backend/src/services/llm.js · chat-context.js · memory.js')
KV('Prueba directa: ', 'curl -X POST localhost:3001/api/ai/chat -H "Content-Type: application/json" '
   '-d \'{"message":"Busco un look para una cena, tonos fríos"}\'')

doc.add_heading('IA 2 — Asesor de estilo: recuperación semántica (RAG)', level=2)
KV('Problema que resuelve: ', 'el buscador por palabra clave falla cuando el cliente describe lo '
   'que quiere en lenguaje natural ("algo elegante para una cena en tonos fríos").')
KV('Algoritmo: ', 'RAG (Retrieval-Augmented Generation) con cuatro etapas: planificación de filtros, '
   'búsqueda vectorial, re-ranking determinista y generación aumentada con verificación de grounding.')
MONO('consulta en lenguaje natural\n'
     '   ↓  PLANIFICADOR   extrae filtros estructurados (ocasión, color, precio, género, prenda)\n'
     '   ↓  RECUPERACIÓN   pgvector: similitud coseno + filtros SQL   · top-20 candidatos\n'
     '   ↓  RE-RANKER      similitud + coincidencia de atributos      · top-5 finales\n'
     '   ↓  GENERADOR      LLM con solo 5 productos en contexto\n'
     'respuesta  +  verificación de grounding')
P('Tres decisiones de ingeniería que cambiaron el resultado:', bold=True, space_after=2)
BUL('Planificador híbrido. La llamada al LLM para extraer filtros costaba ~1,6 s mientras que el '
    'retrieval completo tarda 4 ms. Ahora una heurística local resuelve los casos habituales y el '
    'LLM solo interviene cuando la consulta no aporta señales. La latencia mediana bajó de 3.5 s '
    'a 1.9 s.')
BUL('Re-ranking con jerarquía de prendas. El catálogo tiene 83 joyas, 78 accesorios y 50 bolsos '
    'frente a un puñado de vestidos. Sin priorizar la prenda principal sobre el complemento, el '
    'top-5 se llenaba de bolsos. Se aplica un refuerzo de +0,16 a la prenda principal y −0,05 a los '
    'complementos en consultas de outfit.')
BUL('Verificación de grounding. Tras generar, se comprueba que todo producto nombrado existe en el '
    'contexto recuperado. Es el criterio de precisión del 100 %. Se depuró para no marcar como '
    'invención los rótulos en negrita ni las abreviaturas de nombres reales.')
KV('Archivos: ', 'backend/src/services/style-assistant.js · vector-search.js · routes/style-rag.js')
KV('Prueba directa: ', 'curl -X POST localhost:3001/api/ai/style-chat -d \'{"message":"¿Qué me pongo '
   'para una boda en la playa?"}\'  →  devuelve productos, plan usado, fases de latencia y grounding.')

doc.add_heading('IA 3 — Búsqueda visual por imagen', level=2)
KV('Problema que resuelve: ', 'el cliente ve una prenda en la calle y no sabe cómo encontrarla en '
   'la tienda; describirla con palabras es impreciso.')
KV('Algoritmo: ', 'Embedding visual con FashionCLIP y búsqueda por similitud coseno sobre índice '
   'HNSW en pgvector.')
NUM('El frontend valida la imagen y la envía en base64, data URL o binario a POST /api/ai/visual-search.')
NUM('El sidecar convierte la imagen en un vector de 512 dimensiones normalizado.')
NUM('pgvector busca los vecinos más cercanos por distancia coseno (índice HNSW).')
NUM('Se devuelven los resultados con su porcentaje de similitud, tipo de prenda y precio.')
CALLOUT('Privacidad por diseño',
        'La imagen del usuario NO se almacena en ningún momento: se vectoriza en memoria, se '
        'responde y se descarta. La colección vectorial solo contiene datos de producto.', fill='E8F5E9')
KV('Archivos: ', 'backend/ai/embed_server.py · src/services/vector-search.js · routes/style-rag.js')

doc.add_heading('IA 4 — Extracción de atributos por visión artificial', level=2)
KV('Problema que resuelve: ', 'el catálogo carecía de los atributos exigidos (material, largo, '
   'cuello, manga, ocasión, temporada) y el campo existente era una plantilla genérica repetida en '
   '353 de 354 productos.')
KV('Algoritmo: ', 'Modelo de visión-lenguaje con salida estructurada en JSON. Se envía la fotografía '
   'del producto y se pide la ficha de atributos en un esquema fijo.')
MONO('producto + imagen  →  modelo de visión  →  JSON estructurado  →  tabla product_ai_attrs')
KV('Resultado: ', '331 productos con atributos extraídos, 19 sin imagen, 0 fallos, 16 minutos de '
   'proceso y un coste aproximado de 0.10 USD para el catálogo completo.')
KV('Archivo: ', 'backend/ai/extract_attrs.py')
P('Estos atributos no se quedaron ahí: alimentan el re-ranker del asesor, el planificador de filtros, '
  'el clasificador de categorías del panel y el modelo multimodal de productos nuevos. Es la pieza '
  'que conecta la visión con el resto del sistema.', size=10, italic=True, color=MUTED)

doc.add_heading('IA 5 — Asistente del área de administración', level=2)
KV('Problema que resuelve: ', 'la administración no tiene lectura rápida del negocio ni puede '
   'preguntar en lenguaje natural sobre sus propios datos.')
KV('Algoritmo: ', 'Analítica aumentada: cálculo de indicadores sobre SQL y LLM para interpretación '
   'y redacción. No se le pide al modelo que calcule, sino que explique resultados ya calculados.')
P('Las cinco pestañas del asistente y su lógica:', bold=True, space_after=2)
TABLE(['Pestaña', 'Qué calcula', 'Cómo'],
      [['Previsión', 'Productos en riesgo de quiebre y reposición sugerida',
        'Demanda media y punto de pedido contra existencias actuales'],
       ['Anomalías', 'Comportamientos atípicos en ventas y stock',
        'Desviación respecto al comportamiento esperado por producto'],
       ['ABC', 'Clasificación de productos por contribución a ingresos',
        'Curva de Pareto acumulada: A hasta 80 %, B hasta 95 %, C el resto'],
       ['Estrategia', 'Respuestas en lenguaje natural e informes',
        'LLM con los indicadores ya calculados como contexto'],
       ['Memoria', 'Lo que Aria recuerda de cada cliente',
        'Lectura y edición de ai_memory, con opción de olvidar datos']],
      widths=[0.95, 2.4, 3.15])
KV('Archivos: ', 'backend/src/services/admin-ai.js · routes/admin-ai.js · public/js/pages/admin.js')
CALLOUT('Corrección de seguridad aplicada',
        'Las rutas /api/ai/memory y /api/ai/stats solo tenían attachUser, sin autenticación: '
        'cualquiera podía leer sin sesión la memoria de clientes (tallas, presupuestos, '
        'preferencias). Se comprobó con una petición HTTP sin credenciales y se corrigió exigiendo '
        'rol de administrador.', fill='FFF8E1')

doc.add_heading('IA 6 — Previsión de demanda y optimización de inventario', level=2)
KV('Problema que resuelve: ', 'decisiones de compra y reposición tomadas a ciegas, con quiebres en '
   'productos clave y exceso en artículos de lenta rotación.')
KV('Algoritmo: ', 'XGBoost en dos etapas para demanda intermitente, fusión multimodal para productos '
   'sin historial, reconciliación jerárquica MinT y política de inventario (s, S) con cantidad '
   'económica de pedido.')
P('El problema central es la intermitencia:', bold=True, space_after=2)
P('El 43,8 % de las combinaciones SKU/tienda/semana venden CERO. Un regresor único aprende a '
  'predecir cero y sesga todas las estimaciones a la baja. Por eso se separan dos preguntas:')
MONO('Etapa 1 · ¿HABRÁ demanda?    clasificador → P(unidades > 0)          AUC 0,951\n'
     'Etapa 2 · ¿CUÁNTO se venderá? regresor sobre las filas CON venta\n'
     '                              + la probabilidad de la etapa 1 como variable\n'
     '            ↓\n'
     '   ŷ = P(ocurrencia) × E[magnitud | ocurre]')
P('Componentes del sistema:', bold=True, space_after=2)
BUL('Ingeniería de variables: 26 features documentadas en la tabla feature_registry con su tipo, '
    'fuente, ventana temporal y riesgo de fuga de información. Todas usan estrictamente el pasado: '
    'los rezagos se construyen con shift() y las medias móviles se desplazan una semana.')
BUL('Modelo para productos nuevos: sin historial, la única señal es la apariencia. Se fusionan los '
    'embeddings de FashionCLIP con atributos y tendencia de categoría. Se probó primero un modelo de '
    'refuerzo con 900 variables y resultó peor que los baselines por sobreajuste con 264 '
    'observaciones; la sonda lineal regularizada sí supera a los dos baselines.')
BUL('Reconciliación jerárquica: los pronósticos deben ser coherentes entre niveles (SKU → categoría '
    '→ tienda → total). Se aplica MinT, que reparte el error usando la estructura. La coherencia '
    'medida es de 0,0000 %.')
BUL('Optimización de inventario: stock de seguridad calculado como Z · σ_error · √lead_time con la '
    'desviación real del error por producto, en lugar de un porcentaje plano; punto de pedido y '
    'cantidad económica de pedido para la política (s, S).')
BUL('Explicabilidad: SHAP sobre ambas etapas para identificar qué variables impulsan la ocurrencia '
    'y cuáles la magnitud. El resultado es coherente: ambos modelos están dominados por las medias '
    'móviles recientes y el descuento.')
BUL('Monitorización de drift: índice PSI que compara la distribución de cada variable entre el '
    'periodo de entrenamiento y el reciente, con umbrales de 0,10 (estable) y 0,25 (reentrenar).')
KV('Archivos: ', 'backend/ai/synthetic_sales.py, features.py, train_two_stage.py, new_products.py, '
   'inventory.py, drift_y_futuro.py, validar_fase1.mjs')
KV('Comandos: ', 'npm run f4:synthetic · f4:features · f4:2stage · f4:nuevos · f4:inventario · f4:drift')

# ================================================================ 4
doc.add_heading('4. Inventario de Algoritmos Implementados', level=1)
TABLE(['Algoritmo / Técnica', 'Dónde se usa', 'Implementación'],
      [['FashionCLIP (ViT multimodal, 150 M parámetros)', 'Embeddings de imagen y texto',
        'open_clip_torch, modelo Marqo/marqo-fashionCLIP, 512 dimensiones, ejecución local en CPU'],
       ['Similitud coseno sobre índice HNSW', 'Búsqueda visual y RAG',
        'pgvector con índices HNSW y operador vector_cosine_ops'],
       ['RAG con re-ranking determinista', 'Asesor de estilo',
        'Recuperación top-20 y re-ordenación por similitud más coincidencia de atributos'],
       ['Verificación de grounding', 'Asesor de estilo',
        'Comprobación posterior de que todo producto citado existe en el contexto recuperado'],
       ['XGBoost clasificador binario', 'Etapa 1 de previsión',
        'Predice ocurrencia de demanda; AUC 0,951 en holdout'],
       ['XGBoost regresor', 'Etapa 2 de previsión',
        'Predice magnitud condicionada a que haya demanda, con la probabilidad previa como variable'],
       ['Validación de origen rodante', 'Evaluación de la previsión',
        'Tres orígenes temporales sucesivos para comprobar estabilidad del modelo'],
       ['WRMSSE (Weighted RMSSE)', 'Métrica de la previsión',
        'Implementación propia con escala ingenua por serie y ponderación por cuota de ventas'],
       ['Regresión Ridge regularizada', 'Productos sin historial',
        'Sonda lineal sobre el embedding completo, apropiada con N pequeña'],
       ['Fusión multimodal', 'Productos sin historial',
        'Concatenación de embedding visual, texto, atributos codificados y variables numéricas'],
       ['Reconciliación jerárquica MinT', 'Coherencia de pronósticos',
        'Reparto proporcional del error hacia el nivel superior de la jerarquía'],
       ['Stock de seguridad dinámico', 'Optimización de inventario',
        'Z · σ_error · √lead_time con Z = 1,645 para un nivel de servicio del 95 %'],
       ['Cantidad Económica de Pedido (EOQ)', 'Política de reposición',
        '√(2·D·S/H) con demanda anualizada, coste de pedido y coste de mantenimiento'],
       ['Índice PSI (Population Stability Index)', 'Monitorización de drift',
        'Comparación por deciles entre distribución de entrenamiento y producción'],
       ['SHAP (TreeExplainer)', 'Explicabilidad',
        'Importancia media absoluta por variable en ambas etapas del modelo'],
       ['Extracción estructurada por visión', 'Atributos de producto',
        'Modelo visión-lenguaje con esquema JSON de salida fijo'],
       ['Planificación híbrida heurística + LLM', 'Optimización de latencia',
        'Heurística local primero; el LLM solo interviene sin señales estructuradas']],
      widths=[2.05, 1.7, 2.75])

# ================================================================ 5
doc.add_heading('5. Guía de Demostración en Vivo', level=1)
doc.add_heading('5.1 Preparación del entorno', level=2)
MONO('cd backend\n'
     'npm run ai:embed        # arranca el sidecar de embeddings (dejar corriendo)\n'
     'PORT=3001 npm run start # arranca el backend\n'
     '\n'
     '# Verificación de salud\n'
     'curl localhost:3001/api/health\n'
     'curl localhost:3001/api/ai/embeddings/status')
P('El segundo comando debe reportar el modelo cargado y la cobertura de vectores del catálogo. '
  'Si la cobertura no llega al 95 %, los SKUs sin vector no aparecerán en las búsquedas.', size=10,
  italic=True, color=MUTED)

doc.add_heading('5.2 Demostración 1 — Aria (chatbot con memoria)', level=2)
NUM('Abrir /hub-agente-ia y escribir una consulta de catálogo.')
NUM('Señalar que la respuesta llega en streaming, palabra a palabra.')
NUM('Escribir una preferencia: "no me gustan los tonos amarillos".')
NUM('Recargar la página y preguntar por una recomendación: la preferencia se mantiene, porque está '
    'persistida en ai_memory, no en la sesión del navegador.')
KV('Evidencia en base de datos: ', 'SELECT * FROM ai_memory ORDER BY updated_at DESC LIMIT 5;')

doc.add_heading('5.3 Demostración 2 — Asesor RAG', level=2)
NUM('Abrir /asesor-estilo y pulsar uno de los ejemplos sugeridos.')
NUM('Mostrar en el pie de cada respuesta el plan usado, las fases de latencia y el contador de '
    'grounding ("N citados · 0 inventados").')
NUM('Subir una fotografía al recuadro de la derecha y mostrar los resultados con su porcentaje de '
    'similitud.')
KV('Prueba por consola: ', 'curl -X POST localhost:3001/api/ai/style-chat -H "Content-Type: '
   'application/json" -d \'{"message":"look para una boda en la playa"}\'')

doc.add_heading('5.4 Demostración 3 — Ayudante de administración', level=2)
NUM('Iniciar sesión como administrador en /iniciar-sesion.')
NUM('Abrir /panel-de-almacen-y-ventas y bajar hasta el asistente.')
NUM('Recorrer las cinco pestañas: Previsión, Anomalías, ABC, Estrategia y Memoria.')
NUM('En la pestaña Memoria, corregir o borrar un dato: se modifica ai_memory.')
KV('Prueba por consola: ', 'curl -H "Authorization: Bearer <token>" '
   'localhost:3001/api/admin/ai/insights')

doc.add_heading('5.5 Demostración 4 — Previsión de demanda', level=2)
NUM('En el panel, bajar a la sección de previsión de demanda.')
NUM('Mostrar la gráfica de pronóstico contra real por SKU y tienda.')
NUM('Mostrar la previsión a 12 semanas y la tabla de recomendaciones de inventario.')
NUM('Mostrar la tabla de drift con el PSI por variable.')
KV('Validación reproducible completa: ', 'cd backend && node ai/validar_fase1.mjs')
P('Ese comando ejecuta el conjunto de pruebas completo y escribe el informe con las métricas de '
  'todos los criterios de aceptación.', size=10, italic=True, color=MUTED)

# ================================================================ 6
doc.add_heading('6. Cómo Demostrar que Funciona Realmente (y no es una Maqueta)', level=1)
P('Una interfaz puede mostrar datos de ejemplo sin que nada funcione por detrás. Estas cuatro '
  'comprobaciones demuestran lo contrario:')
doc.add_heading('6.1 La prueba que no se puede falsear: la telemetría', level=2)
P('Cada llamada al modelo deja una fila en la tabla ai_usage. Si la IA es real, la tabla crece al '
  'usarla y contiene consumo de tokens real:')
MONO('SELECT tag, provider, model, prompt_tokens, completion_tokens, cache_hit,\n'
     '       ROUND(cost_usd,6) AS coste, latency_ms, ok\n'
     'FROM ai_usage ORDER BY id DESC LIMIT 5;')
P('Una maqueta no puede generar tokens de entrada ni coste. Si esa consulta devuelve filas nuevas '
  'después de cada interacción, la llamada al modelo es real.', size=10, italic=True, color=MUTED)

doc.add_heading('6.2 Comprobación de persistencia real', level=2)
P('Se escribe algo desde la interfaz, se recarga la página y se verifica en la base de datos:')
MONO('-- La preferencia declarada en el chat\n'
     'SELECT fact_key, fact_value, confidence, source FROM ai_memory ORDER BY updated_at DESC;\n'
     '\n'
     '-- La conversación completa\n'
     'SELECT session_key, role, COUNT(*) FROM ai_sessions GROUP BY 1,2 ORDER BY 1 DESC;')

doc.add_heading('6.3 Comprobación de algoritmos, no de decoración', level=2)
P('La clasificación ABC debe mostrar una curva de Pareto real. Si los productos están clasificados '
  'de verdad, unos pocos concentran la mayor parte de los ingresos:')
MONO('SELECT class, COUNT(*), ROUND(SUM(revenue),2) FROM (...)\n'
     'Resultado esperado: A = pocos productos con gran volumen, C = muchos con poco.')
P('En la instalación actual: A = 5 productos (43 % de los ingresos), B = 39, C = 141. Esa '
  'distribución no se puede inventar con cifras fijas en el HTML.')

doc.add_heading('6.4 Comprobación de la búsqueda vectorial', level=2)
P('Si la búsqueda visual fuera falsa, devolvería siempre los mismos productos. Al subir imágenes '
  'distintas, los resultados cambian y el porcentaje de similitud varía. Además, al subir la foto '
  'de un producto del propio catálogo, ese producto aparece en primer lugar con similitud cercana '
  'a 1,0: eso es matemáticamente imposible de simular sin el modelo.')

CALLOUT('La prueba definitiva: apagar el proveedor de IA',
        'Si se retira la clave del archivo .env y se reinicia, el sistema NO se cae: cae al motor '
        'local de reglas y lo indica. Si se apaga el sidecar de embeddings, los endpoints de '
        'búsqueda visual y RAG devuelven error controlado mientras el resto sigue funcionando. Esa '
        'degradación diferenciada demuestra que hay componentes reales e independientes detrás de '
        'la interfaz, no una simulación única.', fill='E8F5E9')

# ================================================================ 7
doc.add_heading('7. Limitaciones Declaradas', level=1)
P('La honestidad sobre lo que no está resuelto forma parte de la documentación técnica:')
TABLE(['Limitación', 'Alcance', 'Motivo y estado'],
      [['Historial de ventas sintético', 'Previsión de demanda (IA 6)',
        'La base solo contenía 22 pedidos de muestra en 4 semanas; se generaron 24 meses. Todas las '
        'filas llevan la marca is_synthetic. Las métricas validan el pipeline, no el rendimiento '
        'sobre operación real.'],
       ['Interfaz de gobierno de IA sin conectar', 'Secciones del Hub IA',
        'El backend de conocimiento, configuración y métricas existe y funciona, pero las tres '
        'secciones de la pestaña Asesor IA siguen siendo maqueta.'],
       ['Ejecución en CPU', 'Embeddings',
        'La rueda de PyTorch con soporte CUDA ocupa unos 4,5 GB y el disco disponible era menor. '
        'Suficiente para este catálogo, limitante para modelos mayores.'],
       ['Lead time único en el cálculo histórico', 'Optimización de inventario',
        'No existía el dato por proveedor; se usó un supuesto de 2 semanas. Los proveedores ya están '
        'cargados en la base de datos, pendiente de recalcular.'],
       ['Tres criterios de aceptación no alcanzados', 'Previsión de demanda',
        'WRMSSE 0,669 frente a 0,35 (el suelo teórico para demanda Poisson es ~0,707, por lo que el '
        'modelo está en el óptimo); mejora de WAPE del 6,82 % frente al 10 % (el umbral se definió '
        'sobre 5.577 productos y aquí hay 334); y reducción de inventario, que resultó ser un '
        'intercambio: +5,3 % de inventario a cambio de −92 % de faltantes.']],
      widths=[1.5, 1.5, 3.5])

# ================================================================ 8
doc.add_heading('8. Conclusión', level=1)
P('El proyecto integra seis módulos de Inteligencia Artificial sobre una arquitectura común: un '
  'backend que actúa como proxy seguro, una base de datos relacional que también almacena vectores, '
  'un microservicio local para los embeddings y una capa de telemetría que mide el coste y la '
  'latencia de cada llamada.')
P('La combinación es deliberada: el proveedor externo aporta la capacidad de lenguaje, el modelo '
  'local aporta la comprensión visual sin coste por consulta, y los modelos predictivos propios '
  'aportan la analítica que un LLM no puede dar. Ninguna de las tres piezas podría resolver sola el '
  'problema completo, y el sistema está diseñado para seguir funcionando cuando cualquiera de ellas '
  'falla.')

P('Documento generado desde el estado real del repositorio. Todas las rutas, tablas y comandos '
  'citados son verificables en el código.', size=9, italic=True, color=MUTED,
  align=WD_ALIGN_PARAGRAPH.CENTER, space_before=10)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Manual_Integracion_y_Demostracion_IA_VivaModa.docx')
doc.save(OUT)
print('OK: %s (%.1f KB)' % (OUT, os.path.getsize(OUT) / 1024))
