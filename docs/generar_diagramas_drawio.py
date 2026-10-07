#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera los diagramas .drawio (arquitectura y flujo) del proyecto VivaModa.

Formato mxGraph: el XML se abre directamente en draw.io / diagrams.net y queda
totalmente editable (no es una imagen exportada).
"""
import os

BRAND, PURPLE, VERDE = '#B60055', '#4B41E1', '#1B7A3D'
AMBAR, GRIS, CLARO = '#9C3F00', '#5C3F45', '#F6F2F5'
AZUL = '#1F6FEB'

SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diagramas')
os.makedirs(SALIDA, exist_ok=True)


def esc(t):
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;').replace('\n', '&lt;br&gt;'))


class Diag:
    def __init__(self, ancho=1800, alto=1300):
        self.n = 0
        self.celdas = []
        self.ancho, self.alto = ancho, alto

    def _id(self):
        self.n += 1
        return 'n%d' % self.n

    def caja(self, x, y, w, h, titulo, lineas='', relleno='#FFFFFF', borde=PURPLE,
             grosor=2, radio=1, titulo_color=None, tam=13, tam_det=11, dash=0, sombra=1):
        i = self._id()
        color_t = titulo_color or borde
        # Se construye el HTML con etiquetas reales y se escapa UNA sola vez al
        # final: si se escapa el texto por dentro y se dejan los <b>/<font> en
        # crudo, el XML resultante no es válido y draw.io no lo abre.
        val = '<b><font color="%s" style="font-size:%dpx">%s</font></b>' % (color_t, tam, titulo)
        if lineas:
            val += '<br><font color="%s" style="font-size:%dpx">%s</font>' % (GRIS, tam_det, lineas)
        val = esc(val)
        st = ('rounded=%d;whiteSpace=wrap;html=1;fillColor=%s;strokeColor=%s;strokeWidth=%d;'
              'verticalAlign=middle;align=center;shadow=%d;dashed=%d;spacingTop=4;'
              % (radio, relleno, borde, grosor, sombra, dash))
        self.celdas.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (i, val, st, x, y, w, h))
        return i

    def etiqueta(self, x, y, w, h, texto, color=GRIS, tam=12, bold=False, align='left'):
        i = self._id()
        t = '<b>%s</b>' % texto if bold else texto
        t = esc(t)
        st = ('text;html=1;align=%s;verticalAlign=middle;fontSize=%d;fontColor=%s;'
              'strokeColor=none;fillColor=none;' % (align, tam, color))
        self.celdas.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (i, t, st, x, y, w, h))
        return i

    def flecha(self, a, b, texto='', color=PURPLE, grosor=2, dash=0, salida=None, entrada=None):
        i = self._id()
        st = ('edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;'
              'strokeColor=%s;strokeWidth=%d;dashed=%d;fontSize=10;fontColor=%s;'
              % (color, grosor, dash, GRIS))
        if salida:
            st += 'exitX=%s;exitY=%s;exitDx=0;exitDy=0;' % salida
        if entrada:
            st += 'entryX=%s;entryY=%s;entryDx=0;entryDy=0;' % entrada
        lbl = ' value="%s"' % esc(texto) if texto else ''
        self.celdas.append(
            '<mxCell id="%s"%s style="%s" edge="1" parent="1" source="%s" target="%s">'
            '<mxGeometry relative="1" as="geometry"/></mxCell>' % (i, lbl, st, a, b))
        return i

    def conector(self, x1, y1, x2, y2, color=PURPLE, grosor=2, dash=0, texto=''):
        """Flecha entre dos puntos absolutos (no entre nodos)."""
        i = self._id()
        st = ('edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;'
              'strokeColor=%s;strokeWidth=%d;dashed=%d;fontSize=10;fontColor=%s;'
              % (color, grosor, dash, GRIS))
        lbl = ' value="%s"' % esc(texto) if texto else ''
        self.celdas.append(
            '<mxCell id="%s"%s style="%s" edge="1" parent="1">'
            '<mxGeometry relative="1" as="geometry">'
            '<mxPoint x="%d" y="%d" as="sourcePoint"/>'
            '<mxPoint x="%d" y="%d" as="targetPoint"/>'
            '</mxGeometry></mxCell>' % (i, lbl, st, x1, y1, x2, y2))
        return i

    def contenedor(self, x, y, w, h, titulo, borde, relleno='none', dash=0):
        i = self._id()
        st = ('rounded=1;whiteSpace=wrap;html=1;fillColor=%s;strokeColor=%s;strokeWidth=2;'
              'verticalAlign=top;align=left;fontSize=14;fontColor=%s;fontStyle=1;'
              'dashed=%d;spacingLeft=14;spacingTop=8;' % (relleno, borde, borde, dash))
        self.celdas.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (i, esc(esc(titulo)), st, x, y, w, h))
        return i

    def xml(self, nombre):
        return ('<mxfile host="app.diagrams.net" version="22.1.0">\n'
                '  <diagram id="%s" name="%s">\n'
                '    <mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" guides="1" '
                'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
                'pageWidth="%d" pageHeight="%d" math="0" shadow="0">\n'
                '      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
                '        %s\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n'
                % (nombre.lower().replace(' ', '-'), nombre, self.ancho, self.alto,
                   '\n        '.join(self.celdas)))


# ════════════════════════════════════════════════════════ DIAGRAMA 1
d = Diag(1820, 1320)
d.etiqueta(40, 20, 1200, 34, 'Arquitectura del Sistema con Inteligencia Artificial — VivaModa',
           BRAND, 20, True)
d.etiqueta(40, 54, 1200, 22, 'Tres capas, seis módulos de IA y dos proveedores de servicio', GRIS, 12)

# Capa 1
c1 = d.contenedor(40, 90, 1740, 140, 'CAPA 1 · NAVEGADOR  (HTML5 + Tailwind + JavaScript vanilla)',
                  BRAND, '#FDF6FA')
vistas = [('Hub IA', '/hub-agente-ia'), ('Asesor de estilo', '/asesor-estilo'),
          ('Panel de almacén', '/panel-de-almacen-y-ventas'), ('Tienda VR', '/tienda-virtual-realidad')]
for i, (t, r) in enumerate(vistas):
    d.caja(70 + i * 425, 135, 395, 72, t, r, '#FFFFFF', BRAND, 1, tam=13, tam_det=10, sombra=0)

# Capa 2
c2 = d.contenedor(40, 265, 1740, 440,
                  'CAPA 2 · BACKEND Node.js + Express  —  proxy seguro: las claves viven en .env',
                  PURPLE, '#FAFAFF')
IAS = [
    ('IA 1 · Aria', 'Chatbot con memoria y contexto\nLLM + ai_memory', BRAND),
    ('IA 2 · Asesor semántico', 'Recuperación aumentada (RAG)\nvectores + re-ranking', PURPLE),
    ('IA 3 · Búsqueda visual', 'Fotografía → prendas similares\nFashionCLIP + coseno', PURPLE),
    ('IA 4 · Atributos por visión', 'Ficha técnica de cada prenda\nmodelo visión-lenguaje', AMBAR),
    ('IA 5 · Asistente de administración', 'Previsión, ABC, anomalías, memoria\nSQL + LLM', VERDE),
    ('IA 6 · Previsión de demanda', 'Demanda e inventario\nXGBoost de dos etapas', VERDE),
]
ids_ia = []
for i, (t, l, col) in enumerate(IAS):
    x = 70 + (i % 3) * 570
    y = 310 + (i // 3) * 118
    ids_ia.append(d.caja(x, y, 545, 100, t, l, '#FFFFFF', col, 2, tam=13, tam_det=10.5))

d.caja(70, 555, 1680, 130, 'SERVICIOS TRANSVERSALES A LOS SEIS MÓDULOS', '',
       '#F0EDFF', PURPLE, 2, tam=13)
trans = [('llm-provider.js', 'resuelve proveedor,\ncoste, timeout y reintentos'),
         ('ai-admin.js', 'telemetría por llamada:\ntokens, caché, coste, latencia'),
         ('ai_knowledge', 'reglas de negocio\ninyectadas en el prompt'),
         ('ai_settings', 'configuración editable\nsin desplegar')]
for i, (t, l) in enumerate(trans):
    d.caja(95 + i * 415, 596, 385, 72, t, l, '#FFFFFF', PURPLE, 1, tam=11.5, tam_det=9.5, sombra=0)

d.etiqueta(70, 692, 1680, 20,
           'Si el proveedor falla o no hay credenciales → motor local de reglas. El servicio no se interrumpe.',
           VERDE, 11)

# Capa 3
c3 = d.contenedor(40, 730, 1740, 540,
                  'CAPA 3 · SERVICIOS DE IA Y PERSISTENCIA', GRIS, '#FCFAFB')

llm = d.caja(70, 780, 830, 190, 'PROVEEDOR LLM EXTERNO (API)',
             'DeepSeek · modelo deepseek-flash\n\n'
             'Se emplea para: lenguaje natural, razonamiento sobre\n'
             'contexto, generación de respuestas e informes y\n'
             'extracción de atributos por visión.\n\n'
             'Requiere thinking:disabled (el modo razonamiento\n'
             'consumía los tokens y devolvía respuestas vacías).\n\n'
             'Da servicio a: IA 1 · 2 · 4 · 5 · 6 (parcial)',
             '#FFF8E1', AMBAR, 2, tam=13, tam_det=10.5)

side = d.caja(940, 780, 810, 190, 'SIDECAR PYTHON  (proceso local · puerto 8001)',
              'FashionCLIP · 512 dimensiones · 150 M de parámetros\n\n'
              'Se ejecuta en LOCAL sobre CPU: sin coste por consulta\n'
              'ni dependencia de red. Carga el modelo una sola vez.\n\n'
              'POST /embed/text   ·   POST /embed/image   ·   GET /health\n\n'
              'Da servicio a: IA 2 · 3 · 6',
              '#E8F5E9', VERDE, 2, tam=13, tam_det=10.5)

db = d.caja(70, 1000, 1680, 250, 'PostgreSQL 16 + extensión pgvector',
            'Fuente de verdad relacional y almacén vectorial en un único motor',
            '#F6F2F5', GRIS, 2, tam=14, tam_det=11)
bloques = [
    ('Comercial', 'products · product_variants\ninventory · stores · users'),
    ('Transaccional', 'orders · order_items\ncarts · wishlists'),
    ('Visión artificial', 'product_ai_attrs\nproduct_embeddings (512 d)'),
    ('Asistente', 'ai_sessions · ai_memory\nai_events · ai_web_cache'),
    ('Gobierno de IA', 'ai_usage · ai_settings\nai_knowledge'),
    ('Previsión y abasto', 'sales_history · demand_features\ndemand_forecasts · suppliers'),
]
for i, (t, l) in enumerate(bloques):
    x = 95 + (i % 3) * 555
    y = 1050 + (i // 3) * 100
    d.caja(x, y, 535, 84, t, l, '#FFFFFF', (BRAND if i < 3 else PURPLE), 1,
           tam=11.5, tam_det=9.5, sombra=0)

# Conexiones
d.flecha(c1, ids_ia[0], 'fetch / SSE · token de sesión', PURPLE, 3)
d.flecha(c2, llm, 'HTTPS · Bearer token', PURPLE, 3)
d.flecha(c2, side, 'HTTP local · vectores', VERDE, 3)
d.flecha(db, side, 'SQL + vectores', VERDE, 2, salida=('0.5', '0'), entrada=('0.5', '1'))
d.flecha(db, llm, 'contexto', AMBAR, 2, dash=1, salida=('0.25', '0'), entrada=('0.5', '1'))

open(os.path.join(SALIDA, '01-arquitectura.drawio'), 'w', encoding='utf-8').write(
    d.xml('Arquitectura del sistema'))

# ════════════════════════════════════════════════════════ DIAGRAMA 2
f = Diag(1820, 1240)
f.etiqueta(40, 20, 1400, 34, 'Flujo de una Petición a la IA — VivaModa', BRAND, 20, True)
f.etiqueta(40, 54, 1400, 22,
           'Ciclo completo de una consulta, desde el navegador hasta la respuesta fundamentada', GRIS, 12)

luno = f.contenedor(40, 90, 1740, 240, 'FASE 1 · CAPTURA Y ENVÍO  (navegador → backend)', BRAND, '#FDF6FA')
f.caja(80, 140, 380, 90, '1. Usuario', 'Escribe una consulta en lenguaje natural\no sube una fotografía', '#FFFFFF', BRAND, 2)
f.caja(510, 140, 380, 90, '2. Frontend', 'Captura el evento y valida la entrada\nAdjunta el token de sesión', '#FFFFFF', BRAND, 2)
f.caja(940, 140, 380, 90, '3. Petición HTTP', 'POST /api/ai/style-chat\nPOST /api/ai/visual-search', '#FFFFFF', PURPLE, 2, tam=12, tam_det=10)
f.caja(1370, 140, 370, 90, '4. Backend (proxy)', 'Valida permisos y normaliza\nla entrada recibida', '#FFFFFF', PURPLE, 2)
f.conector(80 + 380, 185, 510, 185, BRAND)
f.conector(510 + 380, 185, 940, 185, BRAND)
f.conector(940 + 380, 185, 1370, 185, BRAND)

ldos = f.contenedor(40, 360, 1740, 340, 'FASE 2 · CONSTRUCCIÓN DEL CONTEXTO Y RECUPERACIÓN', PURPLE, '#FAFAFF')
f.caja(80, 415, 400, 120, '5. Extracción de contexto (SQL)',
       'Perfil del cliente · pedidos · carrito\nmemoria aprendida · reglas de negocio\n(excluye datos personales innecesarios)',
       '#FFFFFF', PURPLE, 2, tam=12.5, tam_det=10)
f.caja(520, 415, 400, 120, '6. Planificación de filtros',
       'Heurística local: ocasión, color,\nprecio, género, prenda\n(4 ms · el LLM solo si no hay señales)',
       '#FFFFFF', PURPLE, 2, tam=12.5, tam_det=10)
f.caja(960, 415, 400, 120, '7. Búsqueda vectorial',
       'Embedding de 512 dimensiones\nsimilitud coseno sobre índice HNSW\ntop-20 candidatos',
       '#FFFFFF', VERDE, 2, tam=12.5, tam_det=10)
f.caja(1400, 415, 340, 120, '8. Re-ranking',
       'Similitud + coincidencia\nde atributos\ntop-5 finales',
       '#FFFFFF', VERDE, 2, tam=12.5, tam_det=10)
f.conector(80 + 400, 475, 520, 475, PURPLE)
f.conector(520 + 400, 475, 960, 475, PURPLE)
f.conector(960 + 400, 475, 1400, 475, VERDE)
f.caja(80, 560, 840, 120, 'SIDECAR PYTHON · FashionCLIP',
       'Convierte texto e imagen en vectores L2-normalizados.\nSe ejecuta en local, sin coste por consulta.',
       '#E8F5E9', VERDE, 2, tam=12, tam_det=10)
f.caja(960, 560, 780, 120, 'PostgreSQL + pgvector',
       'Devuelve los productos más afines junto con sus\natributos, precio, color y disponibilidad.',
       '#F6F2F5', GRIS, 2, tam=12, tam_det=10)

ltres = f.contenedor(40, 730, 1740, 240, 'FASE 3 · GENERACIÓN, VERIFICACIÓN Y RESPUESTA', VERDE, '#F2FBF4')
f.caja(80, 785, 400, 130, '9. Generación (LLM)',
       'Recibe únicamente los 5 productos\nseleccionados como contexto.\nLa instrucción le prohíbe\nrecomendar nada fuera de ellos.',
       '#FFFFFF', AMBAR, 2, tam=12.5, tam_det=10)
f.caja(520, 785, 400, 130, '10. Verificación de grounding',
       'Comprueba que todo producto\nnombrado existe en el contexto.\nEs el criterio de precisión\ndel 100 %.',
       '#FFFFFF', VERDE, 2, tam=12.5, tam_det=10)
f.caja(960, 785, 400, 130, '11. Persistencia y telemetría',
       'Guarda la interacción y los hechos\nnuevos en ai_memory.\nRegistra tokens, coste y latencia\nen ai_usage.',
       '#FFFFFF', PURPLE, 2, tam=12.5, tam_det=10)
f.caja(1400, 785, 340, 130, '12. Respuesta al usuario',
       'Renderizado dinámico:\ntarjetas de producto,\nindicadores y respuesta\ntextual.',
       '#FFFFFF', BRAND, 2, tam=12.5, tam_det=10)
f.conector(80 + 400, 850, 520, 850, AMBAR)
f.conector(520 + 400, 850, 960, 850, VERDE)
f.conector(960 + 400, 850, 1400, 850, PURPLE)
f.flecha(ltres, luno, 'respuesta', BRAND, 3, dash=1,
         salida=('0.98', '0.5'), entrada=('0.98', '0.5'))

f.contenedor(40, 990, 1740, 200, 'COMPORTAMIENTO ANTE FALLOS (degradación controlada)', GRIS, '#FFF8E1')
f.caja(80, 1045, 540, 120, 'Si falla el proveedor LLM',
       'El backend captura la excepción y responde con el\nmotor local de reglas. El servicio no se interrumpe\ny la interfaz indica el motivo.',
       '#FFFFFF', AMBAR, 2, tam=12, tam_det=10)
f.caja(640, 1045, 540, 120, 'Si falla el sidecar de embeddings',
       'Únicamente los módulos 2, 3 y 6 devuelven error\ncontrolado. El resto del sistema sigue operativo,\nlo que evidencia que son componentes independientes.',
       '#FFFFFF', VERDE, 2, tam=12, tam_det=10)
f.caja(1200, 1045, 540, 120, 'Si faltan credenciales',
       'El sistema arranca en modo local de forma\ndeliberada. Existe una variable de entorno para\nforzarlo sin retirar las claves.',
       '#FFFFFF', GRIS, 2, tam=12, tam_det=10)

open(os.path.join(SALIDA, '02-flujo-peticion.drawio'), 'w', encoding='utf-8').write(
    f.xml('Flujo de una peticion'))

print('OK: 2 diagramas en %s' % SALIDA)
for fn in sorted(os.listdir(SALIDA)):
    print('   %-28s %6.1f KB' % (fn, os.path.getsize(os.path.join(SALIDA, fn)) / 1024))
