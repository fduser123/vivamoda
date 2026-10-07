#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera diagrama_arquitectura_ia.png — arquitectura y flujo de las IA."""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1900, 1380
ESC = 2                      # supermuestreo para bordes suaves
BRAND = (182, 0, 85)
PURPLE = (75, 65, 225)
VERDE = (27, 122, 61)
TINTA = (28, 27, 29)
GRIS = (92, 63, 69)
SUAVE = (246, 242, 245)
BLANCO = (255, 255, 255)
AMBAR = (156, 63, 0)

img = Image.new('RGB', (W * ESC, H * ESC), BLANCO)
d = ImageDraw.Draw(img)


def fuente(px, bold=False):
    rutas = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]
    for r in rutas:
        if os.path.exists(r):
            return ImageFont.truetype(r, px * ESC)
    return ImageFont.load_default()


F_TIT = fuente(24, True); F_SUB = fuente(16, True)
F_TXT = fuente(14);       F_MONO = fuente(13)
F_LBL = fuente(12, True); F_CHICO = fuente(11)


def caja(x, y, w, h, relleno=SUAVE, borde=PURPLE, grosor=2, radio=12):
    d.rounded_rectangle([x * ESC, y * ESC, (x + w) * ESC, (y + h) * ESC],
                        radius=radio * ESC, fill=relleno, outline=borde, width=grosor * ESC)


def texto(x, y, t, f=F_TXT, color=TINTA, centro=False, ancho=None):
    if centro and ancho:
        b = d.textbbox((0, 0), t, font=f)
        x = x + (ancho - (b[2] - b[0]) / ESC) / 2
    d.text((x * ESC, y * ESC), t, font=f, fill=color)


def flecha(x1, y1, x2, y2, color=PURPLE, grosor=3, punta=11):
    d.line([x1 * ESC, y1 * ESC, x2 * ESC, y2 * ESC], fill=color, width=grosor * ESC)
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (+1, -1):
        a = ang + s * 2.6
        d.line([x2 * ESC, y2 * ESC,
                (x2 + punta * math.cos(a)) * ESC, (y2 + punta * math.sin(a)) * ESC],
               fill=color, width=grosor * ESC)


# ── Título ───────────────────────────────────────────────────────
texto(50, 26, 'Arquitectura y Flujo de las IA — Proyecto VivaModa', F_TIT, BRAND)
texto(50, 62, 'Seis módulos de inteligencia artificial sobre un backend proxy común', F_CHICO, GRIS)

# ── Capa 1: navegador ────────────────────────────────────────────
caja(50, 100, 1800, 96, relleno=(252, 248, 251), borde=BRAND, grosor=2)
texto(70, 112, 'CAPA 1 · NAVEGADOR (HTML5 + Tailwind + JavaScript vanilla)', F_SUB, BRAND)
for i, (t, s) in enumerate([('Hub IA', '/hub-agente-ia'), ('Asesor de estilo', '/asesor-estilo'),
                            ('Panel de almacén', '/panel-de-almacen'), ('Tienda VR', '/tienda-virtual-realidad')]):
    x = 70 + i * 440
    caja(x, 142, 410, 42, relleno=BLANCO, borde=(220, 200, 210), grosor=1, radio=8)
    texto(x + 14, 150, t, F_LBL, TINTA)
    texto(x + 14, 167, s, F_CHICO, GRIS)

flecha(950, 196, 950, 236, grosor=4)
texto(966, 208, 'fetch / SSE · token de sesión', F_CHICO, PURPLE)

# ── Capa 2: backend ──────────────────────────────────────────────
caja(50, 240, 1800, 480, relleno=(250, 250, 255), borde=PURPLE, grosor=2)
texto(70, 252, 'CAPA 2 · BACKEND Node.js + Express — proxy seguro (las claves viven en .env, nunca en el navegador)',
      F_SUB, PURPLE)

IAS = [
    ('IA 1', 'Aria', 'Chatbot con memoria', 'LLM + ai_memory', BRAND),
    ('IA 2', 'Asesor de estilo', 'RAG sobre catálogo', 'vectorial + re-ranking', PURPLE),
    ('IA 3', 'Búsqueda visual', 'Foto → prendas similares', 'FashionCLIP + coseno', PURPLE),
    ('IA 4', 'Atributos por visión', 'Ficha de cada prenda', 'modelo visión-lenguaje', AMBAR),
    ('IA 5', 'Asistente admin', 'Previsión, ABC, anomalías', 'SQL + LLM', VERDE),
    ('IA 6', 'Previsión de demanda', 'Demanda e inventario', 'XGBoost 2 etapas', VERDE),
]
for i, (cod, nom, desc, alg, col) in enumerate(IAS):
    x = 70 + (i % 3) * 590
    y = 288 + (i // 3) * 118
    caja(x, y, 560, 100, relleno=BLANCO, borde=col, grosor=2, radio=10)
    d.rounded_rectangle([x * ESC, y * ESC, (x + 62) * ESC, (y + 26) * ESC], radius=7 * ESC, fill=col)
    texto(x + 12, y + 5, cod, F_LBL, BLANCO)
    texto(x + 74, y + 6, nom, F_SUB, TINTA)
    texto(x + 18, y + 38, desc, F_TXT, TINTA)
    texto(x + 18, y + 60, alg, F_CHICO, GRIS)
    texto(x + 18, y + 78, 'servicio en backend/src/services/*', F_CHICO, (150, 130, 140))

# Franja de servicios transversales
caja(70, 540, 1760, 76, relleno=(240, 237, 255), borde=PURPLE, grosor=2, radio=10)
texto(88, 552, 'SERVICIOS TRANSVERSALES A LAS SEIS IA', F_LBL, PURPLE)
for i, (t, s) in enumerate([('llm-provider.js', 'resuelve proveedor, coste, timeout'),
                            ('ai-admin.js', 'telemetría: tokens, caché, coste, latencia'),
                            ('ai_knowledge', 'reglas de negocio en el prompt'),
                            ('ai_settings', 'configuración sin desplegar')]):
    x = 88 + i * 437
    texto(x, 574, t, F_LBL, TINTA)
    texto(x, 591, s, F_CHICO, GRIS)

texto(70, 632, 'Si el proveedor de IA falla o no hay credenciales → motor local de reglas. '
               'El servicio no se interrumpe.', F_CHICO, VERDE)

flecha(620, 720, 620, 764, grosor=4)
flecha(1290, 720, 1290, 764, grosor=4)
texto(636, 730, 'HTTPS · Bearer token', F_CHICO, PURPLE)
texto(1306, 730, 'HTTP local · vectores', F_CHICO, PURPLE)

# ── Capa 3: servicios y datos ────────────────────────────────────
caja(70, 768, 1040, 200, relleno=(255, 248, 225), borde=AMBAR, grosor=2)
texto(90, 780, 'PROVEEDOR LLM EXTERNO (API)', F_SUB, AMBAR)
texto(90, 812, 'DeepSeek · modelo deepseek-flash', F_TXT, TINTA)
texto(90, 836, 'Se usa para: lenguaje natural, razonamiento sobre contexto,', F_CHICO, GRIS)
texto(90, 854, 'generación de respuestas e informes, extracción por visión.', F_CHICO, GRIS)
texto(90, 886, 'Requiere thinking:disabled — el modo razonamiento', F_CHICO, BRAND)
texto(90, 904, 'consumía los tokens y devolvía respuestas vacías.', F_CHICO, BRAND)
texto(90, 936, 'Consultas 1 · 2 · 4 · 5 · 6 (parcial)', F_LBL, GRIS)

caja(1140, 768, 710, 200, relleno=(232, 245, 233), borde=VERDE, grosor=2)
texto(1160, 780, 'SIDECAR PYTHON · puerto 8001', F_SUB, VERDE)
texto(1160, 812, 'FashionCLIP · 512 dimensiones · 150 M parámetros', F_TXT, TINTA)
texto(1160, 836, 'Se ejecuta en LOCAL (CPU): sin coste por consulta.', F_CHICO, GRIS)
texto(1160, 854, 'Carga el modelo una vez (~1,4 s) y sirve vectores.', F_CHICO, GRIS)
texto(1160, 886, 'POST /embed/text   POST /embed/image   GET /health', F_MONO, PURPLE)
texto(1160, 918, 'Consultas 2 · 3 · 6', F_LBL, GRIS)
texto(1160, 940, 'Si se cae, solo fallan esos endpoints.', F_CHICO, GRIS)

flecha(1290, 968, 1290, 1012, grosor=4)
texto(1306, 978, 'SQL + vectores', F_CHICO, VERDE)

caja(70, 1016, 1780, 300, relleno=(246, 242, 245), borde=GRIS, grosor=2)
texto(90, 1028, 'CAPA 3 · PostgreSQL 16 + pgvector — fuente de verdad y almacén vectorial', F_SUB, GRIS)

BLOQUES = [
    ('Comercial', 'products · product_variants', 'inventory · stores · users', 'catálogo y existencias'),
    ('Transaccional', 'orders · order_items', 'carts · wishlists', 'historial de compra'),
    ('Visión artificial', 'product_ai_attrs', 'product_embeddings (512d)', 'atributos y vectores'),
    ('Asistente', 'ai_sessions · ai_memory', 'ai_events · ai_web_cache', 'contexto y memoria'),
    ('Gobierno de IA', 'ai_usage · ai_settings', 'ai_knowledge', 'telemetría y reglas'),
    ('Previsión', 'sales_history · demand_features', 'demand_forecasts · suppliers', 'demanda y abasto'),
]
for i, (t, l1, l2, l3) in enumerate(BLOQUES):
    x = 90 + (i % 3) * 590
    y = 1064 + (i // 3) * 118
    caja(x, y, 560, 100, relleno=BLANCO, borde=(200, 180, 190), grosor=1, radio=9)
    texto(x + 16, y + 10, t, F_LBL, BRAND if i < 3 else PURPLE)
    texto(x + 16, y + 32, l1, F_MONO, TINTA)
    texto(x + 16, y + 52, l2, F_MONO, TINTA)
    texto(x + 16, y + 74, l3, F_CHICO, GRIS)

# Flechas que suben desde la base hacia los servicios
flecha(240, 1016, 240, 968, color=GRIS, grosor=2, punta=9)
flecha(1740, 1016, 1740, 968, color=GRIS, grosor=2, punta=9)

img = img.resize((W, H), Image.LANCZOS)
salida = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diagrama_arquitectura_ia.png')
img.save(salida, 'PNG', optimize=True)
print('OK: %s (%.0f KB · %dx%d)' % (salida, os.path.getsize(salida) / 1024, W, H))
