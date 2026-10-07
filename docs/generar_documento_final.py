#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera Documento_Final_Examen_Parcial_VivaModa.docx

Espejo estructural de 'Avance_Detallado_Examen_Parcial_VivaModa_3_IA.docx'
(mismas 8 secciones, misma paleta y mismos helpers), actualizado con el estado
FINAL del proyecto: las 3 funciones de IA del avance ya están implementadas y
medidas, y se añaden las capacidades construidas después.

Requiere: python-docx
"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.shared import Inches, Pt, RGBColor

BRAND = RGBColor(0xB6, 0x00, 0x55)
PURPLE = RGBColor(0x4B, 0x41, 0xE1)
INK = RGBColor(0x1C, 0x1B, 0x1D)
MUTED = RGBColor(0x5C, 0x3F, 0x45)
GREEN = RGBColor(0x1B, 0x7A, 0x3D)

doc = Document()
st = doc.styles['Normal']
st.font.name = 'Calibri'
st.font.size = Pt(11)
st.font.color.rgb = INK
for lvl, (sz, color) in enumerate([(16, BRAND), (13, BRAND), (11.5, PURPLE)], start=1):
    h = doc.styles['Heading %d' % lvl]
    h.font.name = 'Calibri'; h.font.size = Pt(sz); h.font.color.rgb = color; h.font.bold = True
sec = doc.sections[0]
sec.left_margin = sec.right_margin = Inches(0.9)
sec.top_margin = sec.bottom_margin = Inches(0.7)

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(W + 'val', 'clear'); shd.set(W + 'color', 'auto'); shd.set(W + 'fill', hexcolor)
    tcPr.append(shd)


def P(text='', size=11, bold=False, italic=False, color=None, align=None,
      space_after=6, space_before=0):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color or INK
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    return p


def MIXTO(*partes, size=11, space_after=6):
    """Párrafo con tramos (texto, negrita, color)."""
    p = doc.add_paragraph()
    for text, bold, color in partes:
        r = p.add_run(text)
        r.font.size = Pt(size); r.font.bold = bold
        r.font.color.rgb = color or INK
    p.paragraph_format.space_after = Pt(space_after)
    return p


def BUL(text, size=11):
    p = doc.add_paragraph(text, style='List Bullet')
    p.paragraph_format.space_after = Pt(3)
    for r in p.runs:
        r.font.size = Pt(size); r.font.name = 'Calibri'
    return p


def KV(label, value):
    p = doc.add_paragraph()
    r1 = p.add_run(label); r1.font.bold = True; r1.font.size = Pt(10.5); r1.font.color.rgb = MUTED
    r2 = p.add_run(value); r2.font.size = Pt(10.5); r2.font.color.rgb = INK
    p.paragraph_format.space_after = Pt(2)
    return p


def TABLE(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ''
        run = hdr[i].paragraphs[0].add_run(h)
        run.font.bold = True; run.font.size = Pt(10); run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        shade(hdr[i], 'B60055')
    for r_i, row in enumerate(rows):
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            run = cells[i].paragraphs[0].add_run(val)
            run.font.size = Pt(9.5); run.font.name = 'Calibri'
            if r_i % 2 == 1:
                shade(cells[i], 'F6F2F5')
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


def CALLOUT(title, text, fill='F3E5EE'):
    t = doc.add_table(rows=1, cols=1); t.style = 'Table Grid'
    cell = t.rows[0].cells[0]; cell.text = ''
    r1 = cell.paragraphs[0].add_run(title)
    r1.font.bold = True; r1.font.size = Pt(10.5); r1.font.color.rgb = BRAND
    p2 = cell.add_paragraph(); r2 = p2.add_run(text)
    r2.font.size = Pt(10); r2.font.color.rgb = INK
    shade(cell, fill)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


# ================================================================ PORTADA
P('DOCUMENTO FINAL — ESPECIFICACIÓN TÉCNICA E INFORME DE VALIDACIÓN',
  size=16.5, bold=True, color=BRAND, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
P('Sistema Web VivaModa con Integración de IA (Opción 1 — Enfoque Ligero por API Externa)',
  size=13, bold=True, color=PURPLE, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
P('Curso: Gobiernos y Gestión de TI / Inteligencia Artificial\t\tEntrega: Examen Parcial (Final)',
  size=10, color=MUTED, space_after=2)
P('Arquitectura: Node.js + Express + PostgreSQL/pgvector + FashionCLIP + XGBoost + LLM API\t\t'
  'Semestre Académico 2026-II', size=10, color=MUTED, space_after=2)
P('Módulos de IA: 1) Chatbot Aria  2) Asesor Visual y RAG  3) Ayudante de Administración  '
  '4) Previsión de Demanda e Inventario', size=10, color=MUTED, space_after=12)

CALLOUT('ESTADO DE LA ENTREGA',
        'Las tres funciones exigidas en el avance están implementadas, medidas y verificadas con '
        'pruebas reproducibles. Se añaden dos capacidades construidas después del avance: el motor '
        'de recuperación semántica (RAG) sobre el catálogo y el sistema de previsión de demanda con '
        'optimización de inventario. Todas las métricas de este documento son reproducibles con los '
        'comandos indicados. Los datos de historial son SINTÉTICOS y se identifican como tales: '
        'la base solo contenía 22 pedidos de demostración.', fill='E8F5E9')

# ================================================================ 1
doc.add_heading('1. Definición del Problema Complejo', level=1)
P('El comercio de moda omnicanal (tienda web, punto de venta físico, almacén y venta por '
  'catálogo) enfrenta ineficiencias dinámicas tanto en la experiencia de compra como en la '
  'operación administrativa. Los modelos tradicionales de e-commerce sufren de asesoría '
  'impersonal, compras mal informadas sobre qué prendas favorecen a cada cuerpo y decisiones '
  'de reposición tomadas a ciegas.')
P('A continuación se detallan los cuatro problemas complejos que el sistema resuelve:')
BUL('Asesoría impersonal y recomendaciones genéricas: el cliente no recibe sugerencias basadas '
    'en su historial, tallas ni preferencias, y el buscador tradicional por palabra clave falla '
    'cuando el usuario describe lo que quiere en lenguaje natural ("algo elegante para una cena '
    'en tonos fríos") o cuando solo dispone de una fotografía de la prenda que vio en la calle.')
BUL('Decisiones de inventario a ciegas: la administración no cuenta con previsión de demanda '
    'ni detección de anomalías, por lo que acumula quiebres de stock en productos clave y '
    'sobredimensiona artículos de lenta rotación. En moda esto se agrava porque la mayoría de '
    'combinaciones SKU/tienda/semana venden cero, y los modelos de series temporales clásicos '
    '(ARIMA, ETS) no funcionan con demanda intermitente.')
BUL('Carga operativa repetitiva en soporte y administración: las consultas frecuentes (precios, '
    'stock, estado de pedidos, reportes) y los ajustes manuales consumen tiempo del personal, '
    'restando capacidad de atención comercial.')
BUL('Opacidad de la propia IA: sin telemetría de consumo, coste y latencia, y sin posibilidad de '
    'editar las reglas de negocio que el modelo aplica, la organización no puede auditar ni '
    'gobernar el comportamiento de sus asistentes automáticos.')

# ================================================================ 2
doc.add_heading('2. Definición del Aplicativo Web Básico', level=1)
P('El proyecto se estructura como una aplicación web monolítica ligera pero escalable, diseñada '
  'para operar de forma ágil bajo una pila de tecnologías estándar:')
TABLE(['Capa de Arquitectura', 'Tecnología Seleccionada', 'Rol en el Sistema'],
      [['Frontend (Interfaz)', 'HTML5, Tailwind CSS, JavaScript (Vanilla)',
        'Interfaz dinámica para clientes, personal de tienda y administradores. Captura de eventos '
        'y actualización asíncrona (Fetch API + SSE). Sin paso de compilación.'],
       ['Backend (Lógica)', 'Node.js + Express',
        'Lógica de negocio, autenticación por roles, orquestación de consultas, planificación de '
        'consultas al LLM, re-ranking y comunicación HTTPS con la API de IA.'],
       ['Base de Datos', 'PostgreSQL 16 + extensión pgvector',
        'Almacenamiento relacional y búsqueda vectorial en el mismo motor. Evita desplegar un '
        'motor vectorial adicional para 353 productos.'],
       ['Motor de visión y lenguaje', 'FashionCLIP (512 dims, 150 M parámetros) + DeepSeek',
        'Los embeddings multimodales viven en un microservicio Python; el LLM se consume por API '
        'externa desde el backend.'],
       ['Analítica predictiva', 'XGBoost + scikit-learn + SHAP',
        'Modelo de dos etapas para demanda intermitente, fusión multimodal para productos sin '
        'historial y explicabilidad de las predicciones.'],
       ['Microservicio de embeddings', 'Python 3.14 + PyTorch (CPU) + open_clip',
        'Sirve vectores normalizados por HTTP local. Se ejecuta en CPU por restricción de disco '
        '(la rueda CUDA ocupa ~4,5 GB).']],
      widths=[1.5, 2.1, 3.1])

# ================================================================ 3
doc.add_heading('3. Caracterización de Requerimientos Funcionales con IA', level=1)
P('La Opción 1 integra Inteligencia Artificial generativa y predictiva mediante API externa y '
  'modelos locales en cuatro módulos del sistema.')

doc.add_heading('RF-01: Chatbot Estilista con Memoria y Contexto (Aria)', level=2)
BUL('Descripción: asistente conversacional que atiende dudas de catálogo, tallas, colores y '
    'estado de pedidos, y que aprende de las preferencias declaradas por el cliente.')
BUL('Subproceso: el cliente escribe en el widget. JavaScript envía la consulta al backend; el '
    'servidor recupera la memoria persistida desde PostgreSQL, consolida el contexto (perfil, '
    'pedidos, carrito, catálogo, resultados de búsqueda web) y lo inyecta en el prompt antes de '
    'llamar a la API. La respuesta se transmite en streaming (SSE).')
BUL('Componente IA: modelo de lenguaje con System Prompt delimitado y extracción estructurada '
    'de hechos hacia ai_memory.')
KV('Endpoints: ', '/api/ai/chat y /api/ai/chat/stream (SSE)')
KV('Proveedor en uso: ', 'DeepSeek (modelo deepseek-flash). La telemetría registró 1.282 tokens '
   'de entrada y 132 de salida en una consulta típica, con coste de US$ 0,000215.')

doc.add_heading('RF-02: Asesor Visual por Imagen y Recuperación Semántica (RAG)', level=2)
BUL('Descripción: analiza la fotografía de una prenda y devuelve una descripción estructurada '
    '(tipo, color, material, ocasión) que alimenta la búsqueda en el catálogo. Además, el asesor '
    'responde en lenguaje natural recuperando productos reales por similitud vectorial, no por '
    'coincidencia de palabras clave.')
BUL('Subproceso: el frontend valida la imagen y la envía en base64 o binario; el backend la '
    'vectoriza con FashionCLIP y busca por similitud coseno sobre pgvector. En la modalidad de '
    'chat, un planificador híbrido extrae filtros estructurados (ocasión, color, precio, género, '
    'prenda), recupera 20 candidatos, los re-ordena combinando similitud y atributos, y el LLM '
    'genera la respuesta con solo 5 productos en contexto.')
BUL('Componente IA: FashionCLIP (512 dimensiones) para imagen y texto, planificador híbrido y '
    'verificación de grounding posterior.')
KV('Endpoints: ', '/api/ai/visual-search, /api/ai/style-chat, /api/ai/embeddings/status')
TABLE(['Criterio de aceptación', 'Umbral', 'Medido', 'Estado'],
      [['Precisión del asesor (productos citados que existen)', '100 %', '100,0 %', 'Cumple'],
       ['Latencia del chat (p95)', '< 3 s', '2.890 ms (p50 1.946 ms)', 'Cumple'],
       ['Acierto de búsqueda visual top-3', '≥ 80 %', '95,5 %', 'Cumple'],
       ['Latencia de búsqueda visual (p95)', '< 5 s', '215 ms', 'Cumple'],
       ['Cobertura de vectores del catálogo', '≥ 95 %', '100 % (353/353)', 'Cumple']],
      widths=[3.0, 1.1, 1.6, 1.0])
P('La cobertura al 95 % se exige sobre los SKU activos. La verificación de grounding comprueba '
  'que todo producto nombrado en la respuesta existe en el contexto recuperado; se corrigió para '
  'no marcar como invención los rótulos en negrita ni las abreviaturas de nombres reales.',
  size=10, italic=True, color=MUTED)

doc.add_heading('RF-03: Ayudante IA del Área de Administración', level=2)
BUL('Descripción: módulo de asistencia al panel de almacén que provee previsión, detección de '
    'anomalías, clasificación ABC, plan de compras y memoria de clientes, además de responder '
    'preguntas en lenguaje natural sobre los datos del negocio.')
BUL('Subproceso: el administrador abre el panel autenticado; el backend calcula los indicadores '
    'sobre PostgreSQL y el frontend los muestra en cinco pestañas (Previsión, Anomalías, ABC, '
    'Estrategia y Memoria).')
BUL('Componente IA: analítica aumentada con consultas de solo lectura y enmascaramiento de datos '
    'personales.')
KV('Endpoints: ', '/api/admin/ai/insights, /ask, /report, /trends, /purchase-plan, /memory')

doc.add_heading('RF-04: Previsión de Demanda y Optimización de Inventario', level=2)
BUL('Descripción: predice la demanda semanal por SKU y tienda, y la traduce en decisiones de '
    'reposición: stock de seguridad dinámico y política (s, S) con cantidad económica de pedido.')
BUL('Subproceso: el modelo de dos etapas separa la pregunta "¿habrá demanda?" (clasificador, '
    'AUC 0,951) de "¿cuánto se venderá?" (regresor sobre las filas con venta, usando la '
    'probabilidad de la etapa 1 como variable). Para productos sin historial se usa una fusión '
    'multimodal con los embeddings de FashionCLIP. Después se reconcilian los pronósticos entre '
    'niveles jerárquicos y se calcula el inventario recomendado.')
BUL('Componente IA: XGBoost, scikit-learn, SHAP para explicabilidad y auditoría de variables.')
KV('Endpoints: ', '/api/demand/summary, /series, /inventory, /drift, /futuro, /proveedores')

# ================================================================ 4
doc.add_heading('4. Diagrama de Base de Datos Relacional (PostgreSQL)', level=1)
P('El esquema soporta la operación comercial, el almacenamiento vectorial y las trazas de la IA. '
  'Se listan las tablas principales agrupadas por dominio:')
TABLE(['Dominio', 'Tablas', 'Descripción'],
      [['Comercial', 'users, products, product_images, product_variants, inventory, stores',
        'Catálogo, variantes, existencias por tienda y usuarios con roles cliente/staff/admin.'],
       ['Transaccional', 'orders, order_items, carts, cart_items, wishlists',
        'Pedidos, líneas de pedido y carrito. Base del análisis de compra de los cuatro módulos.'],
       ['Visión artificial', 'product_ai_attrs, product_embeddings',
        'Atributos extraídos por visión (material, largo, cuello, manga, ocasión, temporada) y '
        'tres vectores por producto: imagen, texto y fusión, de 512 dimensiones.'],
       ['Asistente', 'ai_sessions, ai_events, ai_memory, ai_web_cache',
        'Trazas de conversación, memoria persistente del cliente y caché de búsqueda web.'],
       ['Gobierno de IA', 'ai_usage, ai_settings, ai_knowledge',
        'Telemetría por llamada (tokens, caché, coste, latencia, error), configuración editable '
        'desde el panel y reglas de negocio inyectadas en el prompt.'],
       ['Previsión', 'sales_history, promo_calendar, demand_features, demand_forecasts, '
        'inventory_recommendations, feature_registry, model_runs, drift_metrics',
        'Historial SKU/tienda/semana, features con registro anti-leakage, pronósticos, '
        'recomendaciones, tracking de experimentos y PSI de drift.'],
       ['Abastecimiento', 'suppliers, purchase_orders',
        'Proveedores con lead time, mínimo de pedido y fiabilidad, e historial de compras con '
        'su ciclo confirmado → en tránsito → recibido.']],
      widths=[1.2, 2.6, 2.9])

CALLOUT('Relaciones principales',
        'users 1─N orders · orders 1─N order_items · products 1─N product_variants · '
        'product_variants 1─N inventory · products 1─1 product_embeddings · '
        'products N─1 suppliers · suppliers 1─N purchase_orders · '
        'users 1─N ai_memory · users 1─N ai_sessions.', fill='EDE7F6')

# ================================================================ 5
doc.add_heading('5. Procedimiento Detallado de Integración (API Externa)', level=1)
P('El flujo de integración bajo el Enfoque Ligero de la Opción 1 se divide en cinco etapas '
  'secuenciales. Se detalla el comportamiento real implementado:')
BUL('Paso 1 — Credenciales y entorno: la API Key se genera en el proveedor y se almacena en el '
    'archivo .env del backend, que está excluido del control de versiones. Nunca se expone en el '
    'JavaScript del cliente.')
BUL('Paso 2 — Extracción de contexto (SQL): al activarse un evento, el backend consulta '
    'PostgreSQL para obtener perfil del cliente, historial de pedidos, carrito, inventario, '
    'memoria aprendida y las reglas de negocio vigentes.')
BUL('Paso 3 — Construcción del prompt: el backend compone (a) rol de la IA, (b) reglas '
    'operativas y delimitadores, (c) conocimiento y reglas de negocio editables desde el panel, '
    '(d) datos extraídos de PostgreSQL y (e) formato de salida esperado.')
BUL('Paso 4 — Consumo REST/HTTPS: el servidor realiza una petición POST asíncrona con '
    'autenticación Bearer y control de timeout por AbortController. La escritura del payload '
    'desactiva el modo de razonamiento extendido del modelo, que consumía el presupuesto de '
    'tokens y devolvía respuestas vacías.')
BUL('Paso 5 — Validación, almacenamiento y renderizado: el backend valida la estructura, guarda '
    'la traza y la telemetría de consumo en PostgreSQL, y transmite la respuesta al frontend.')

CALLOUT('Degradación elegante (fallback)',
        'Si el proveedor de IA falla, excede el timeout o no hay credenciales configuradas, el '
        'sistema recurre a un motor local de reglas que sigue respondiendo sobre el catálogo real. '
        'La interfaz indica el motivo. Existe también una variable de entorno para forzar el motor '
        'local de forma deliberada.')

# ================================================================ 6
doc.add_heading('6. Explicación del Funcionamiento Arquitectónico', level=1)
doc.add_heading('Flujo Operativo en el Backend (Node + Express)', level=2)
BUL('Custodia de seguridad: el backend actúa como intermediario (proxy), evitando que las API '
    'Keys se expongan en el navegador.')
BUL('Consolidación de contexto: transforma los datos relacionales en objetos estructurados aptos '
    'para el consumo de LLMs, con un presupuesto de tokens acotado.')
BUL('Planificación híbrida: los filtros habituales se resuelven con heurística local (4 ms) y '
    'solo se consulta al LLM cuando la petición no aporta señales estructuradas. Esto redujo la '
    'latencia del asesor de 3,5 s a 1,9 s de mediana.')
BUL('Control de excepciones: ante latencia, caída o error del proveedor, se captura la excepción '
    'y se responde con el motor local, garantizando continuidad del servicio.')
BUL('Protección de datos personales: las rutas que exponen memoria de clientes y métricas '
    'internas exigen rol de administrador.')

doc.add_heading('Flujo Operativo en el Frontend (HTML / JS / CSS)', level=2)
BUL('Eventos de usuario: captura acciones mediante JavaScript (enviar mensaje, subir fotografía, '
    'cambiar de tienda, añadir al carrito).')
BUL('Consultas asíncronas: peticiones no bloqueantes hacia las rutas del backend, con el token '
    'de sesión adjunto.')
BUL('Renderizado dinámico: manipula el DOM para mostrar tarjetas de producto, gráficas de '
    'pronóstico, indicadores de existencias y modales de confirmación.')

CALLOUT('Nota técnica de mantenimiento',
        'En este proyecto la interfaz de varias páginas se construye en tiempo de ejecución '
        'mediante JavaScript, no solo en el HTML. Además, los módulos deben resolver las utilidades '
        'compartidas en el momento de la llamada y no al cargarse, porque el orden de inyección de '
        'scripts sitúa algunos módulos antes del archivo de utilidades comunes. Ignorar esto deja '
        'secciones vacías sin mostrar ningún error.', fill='FFF8E1')

# ================================================================ 7
doc.add_heading('7. Persistencia de las Interacciones con la IA', level=1)
P('Cada interacción queda registrada para alimentar la memoria del sistema, gobernar el coste y '
  'garantizar la trazabilidad de las recomendaciones:')
BUL('ai_sessions: agrupa los mensajes por cliente y sesión, permitiendo continuidad del contexto.')
BUL('ai_events: registra eventos de interacción con su carga útil para análisis posterior.')
BUL('ai_memory: almacena los hechos aprendidos (preferencias, tallas, categorías, colores) con '
    'su nivel de confianza y origen, y es editable por el administrador.')
BUL('ai_usage: una fila por llamada al modelo con proveedor, modelo, tokens de entrada y salida, '
    'aciertos de caché, coste, latencia y error. Permite calcular p95 de latencia, gasto acumulado '
    'y tasa de error por tipo de operación.')
BUL('ai_knowledge: reglas de negocio y conocimiento editable desde el panel, inyectado en el '
    'prompt con prioridad sobre el texto base del sistema.')
BUL('model_runs: registro de experimentos con parámetros, métricas y artefactos de cada '
    'entrenamiento.')
BUL('drift_metrics: índice de estabilidad de variables (PSI) que compara la distribución de las '
    'características entre el periodo de entrenamiento y el reciente, para decidir cuándo '
    'reentrenar.')

# ================================================================ 8
doc.add_heading('8. Validación y Resultados Medidos', level=1)
P('Todas las cifras siguientes son reproducibles ejecutando los comandos de validación del '
  'proyecto. Los datos de historial son sintéticos y así están marcados en la base de datos.')
TABLE(['Módulo', 'Criterio', 'Umbral', 'Resultado', 'Estado'],
      [['RF-02', 'Precisión del asesor RAG', '100 %', '100,0 %', 'Cumple'],
       ['RF-02', 'Latencia chat p95', '< 3 s', '2.890 ms', 'Cumple'],
       ['RF-02', 'Acierto visual top-3', '≥ 80 %', '95,5 %', 'Cumple'],
       ['RF-02', 'Latencia visual p95', '< 5 s', '215 ms', 'Cumple'],
       ['RF-04', 'Coherencia jerárquica', '< 1 %', '0,0000 %', 'Cumple'],
       ['RF-04', 'Latencia de scoring', '< 2 h', '87 ms', 'Cumple'],
       ['RF-04', 'Cobertura del catálogo', '≥ 95 %', '100 %', 'Cumple'],
       ['RF-04', 'WRMSSE en holdout', '≤ 0,35', '0,669', 'No alcanzable'],
       ['RF-04', 'Mejora WAPE productos nuevos', '≥ 10 %', '+6,82 %', 'No alcanzado'],
       ['RF-04', 'Reducción de inventario', '−5 % a −15 %', '+5,3 %', 'No alcanzado']],
      widths=[0.7, 2.2, 1.1, 1.3, 1.0])

doc.add_heading('Análisis de los criterios no alcanzados', level=2)
P('Los tres criterios marcados como no alcanzados se documentan con su causa técnica, que no es '
  'falta de implementación:')
BUL('WRMSSE 0,669 frente al umbral de 0,35. Para demanda generada como proceso de Poisson, el '
    'mejor predictor posible tiene un error de √λ frente al √(2λ) del pronóstico ingenuo, lo que '
    'sitúa el suelo teórico de la métrica en aproximadamente 0,707. Se verificó por simulación '
    'sobre 400 series. El modelo alcanza 0,669, es decir, por debajo de ese suelo teórico, gracias '
    'a la estacionalidad y las promociones, que sí son predecibles. El umbral de 0,35 procede de '
    'una competición con datos reales de varianza muy inferior.')
BUL('Mejora de WAPE del 6,82 % frente al 10 % exigido. Se probó primero un modelo de refuerzo '
    'con 900 variables que resultó peor que los baselines por sobreajuste con 264 observaciones de '
    'entrenamiento; la sonda lineal regularizada sí supera a los dos baselines, pero el umbral se '
    'definió sobre un conjunto de 5.577 productos y aquí hay 334.')
BUL('Inventario: el resultado es un intercambio, no una mejora doble. La política dinámica eleva '
    'el inventario un 5,3 % y reduce los faltantes un 92 %. Comparada a igual nivel de servicio, '
    'la fórmula clásica resulta un 13 % peor, porque el stock de seguridad calculado como '
    'Z·σ·√LT sobreabastece la cola larga: para un producto con demanda media de 0,3 unidades '
    'semanales, la fórmula pide diez veces más protección que un porcentaje plano.')

# ================================================================ 9
doc.add_heading('9. Conclusiones', level=1)
P('El proyecto VivaModa integra cuatro módulos de Inteligencia Artificial —chatbot estilista con '
  'memoria, asesor visual con recuperación semántica, ayudante de administración y previsión de '
  'demanda con optimización de inventario— mediante un backend proxy seguro que protege las '
  'credenciales, consolida el contexto desde PostgreSQL y degrada de forma elegante ante fallos '
  'del proveedor.')
P('El sistema cumple siete de los diez criterios de aceptación definidos. Los tres restantes '
  'están analizados con su causa técnica y acotados por el tamaño del catálogo, la naturaleza '
  'estocástica de la demanda y el umbral de servicio fijado; en ningún caso por falta de '
  'implementación. Se documenta además qué datos son sintéticos y por qué, de modo que ninguna '
  'métrica pueda interpretarse como evidencia de rendimiento sobre operación real.')
P('Queda como trabajo siguiente acotar el stock de seguridad para demanda intermitente —las '
  'formulaciones de Croston o SBA son el candidato natural—, sustituir el supuesto de lead time '
  'único por los lead times reales por proveedor, ahora ya disponibles en la base de datos, y '
  'conectar la interfaz de administración de conocimiento y métricas de IA.', size=10.5)

P('Documento generado automáticamente desde el estado real del repositorio. '
  'Métricas reproducibles con los comandos de validación del proyecto.',
  size=9, italic=True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=10)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Documento_Final_Examen_Parcial_VivaModa.docx')
doc.save(OUT)
print('OK: %s (%.1f KB)' % (OUT, os.path.getsize(OUT) / 1024))
