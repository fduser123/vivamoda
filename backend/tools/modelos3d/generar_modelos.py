#!/usr/bin/env python3
"""
Generador de modelos 3D paramétricos del catálogo VivaModa (Blender headless).

    cd backend && npm run models:3d          # solo la vitrina pública
    cd backend && npm run models:3d:todos    # + almacén/POS y desactivados
    cd backend && npm run models:3d:usdz     # + .usdz para AR Quick Look (iOS)
    blender --background --factory-startup --python tools/modelos3d/generar_modelos.py -- --limite 12
    blender --background --factory-startup --python tools/modelos3d/generar_modelos.py -- --solo VM-DAM-ATELIER

Lee `tools/modelos3d/perfil.json` (lo produce exportar-productos.mjs a partir de
la base de datos) y escribe un .glb por producto en `public/models/generated/`
más un `index.json` con sku → archivo, nombre, familia, medidas y triángulos.

Con `--usdz` escribe además un `.usdz` por producto: es el único formato que
ABRE AR Quick Look en iPhone/iPad. Requiere Blender 4.0 o superior (el operador
`bpy.ops.wm.usdz_export` no existe en 3.x); en versiones anteriores se avisa y
se sigue generando el .glb, sin tumbar la tanda.

Convenciones de los modelos (para poder colocarlos sin sorpresas):

- Cada .glb lleva UN objeto, nombrado con el **nombre del producto** (no el SKU)
  para poder identificarlo en Blender o en cualquier visor; el SKU viaja como
  dato extra del archivo (`extras.sku` del nodo raíz).

- Blender: X = derecha, +Y = frente, Z = arriba. El .glb sale con `export_yup`,
  así que en three.js el frente queda mirando a -Z (la convención de la escena).
- Cada modelo apoya en z = 0, centrado en X y en Y, en metros reales:
  una prenda mide ~1,2 m, un bolso ~0,35 m, un reloj ~0,24 m.
- Materiales PBR simples (tela, punto, cuero, denim, metal, piedra…), elegidos
  por la composición real del producto.
"""
import bpy
import json
import math
import os
import sys

# ── Rutas ───────────────────────────────────────────────────────────────────
AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(AQUI, os.pardir, os.pardir))
PERFIL = os.path.join(AQUI, 'perfil.json')
SALIDA = os.path.abspath(os.environ.get('MODELOS3D_SALIDA') or os.path.join(BACKEND, 'public', 'models', 'generated'))

# Se enciende con `--usdz` (ver main). Fuera del .glb, el USDZ es lo que
# convierte el modelo en realidad aumentada nativa en iOS.
EXPORTAR_USDZ = False
_usdz_aviso = False   # el aviso de «Blender viejo» se imprime una sola vez

# ── Materiales ──────────────────────────────────────────────────────────────
# metallic, roughness, sheen y alpha por tipo de material. La elección real se
# deduce de `composition` (Acero, Cuero, Seda…); `tela` es el punto de partida.
TIPOS_MAT = {
    'tela':  dict(metallic=0.0,  rough=0.82, sheen=0.20),
    'punto': dict(metallic=0.0,  rough=0.95, sheen=0.35),
    'seda':  dict(metallic=0.0,  rough=0.32, sheen=0.65),
    'cuero': dict(metallic=0.0,  rough=0.38, sheen=0.10),
    'denim': dict(metallic=0.0,  rough=0.90, sheen=0.10),
    'encaje': dict(metallic=0.0,  rough=0.70, sheen=0.30, alpha=0.88),
    'metal': dict(metallic=1.0,  rough=0.28, sheen=0.0),
    'oro':   dict(metallic=1.0,  rough=0.20, sheen=0.0),
    'plata': dict(metallic=1.0,  rough=0.14, sheen=0.0),
    'gema':  dict(metallic=0.0,  rough=0.06, sheen=0.9),
    'goma':  dict(metallic=0.0,  rough=0.95, sheen=0.0),
    'cristal': dict(metallic=0.0, rough=0.05, sheen=0.9),
}

# ── Colores por palabra del nombre (si no hay ninguna, manda el c3d de la web)
COLORES = {
    'negro': (0.045, 0.045, 0.055), 'blanco': (0.92, 0.92, 0.90), 'crudo': (0.88, 0.85, 0.78),
    'rojo': (0.62, 0.07, 0.09), 'granate': (0.42, 0.06, 0.12), 'vino': (0.35, 0.05, 0.12),
    'burdeos': (0.38, 0.05, 0.11), 'rosa': (0.90, 0.45, 0.62), 'fucsia': (0.75, 0.06, 0.42),
    'magenta': (0.72, 0.06, 0.40), 'azul': (0.13, 0.26, 0.66), 'marino': (0.08, 0.13, 0.32),
    'celeste': (0.42, 0.66, 0.86), 'cobalt': (0.13, 0.24, 0.72), 'indigo': (0.16, 0.18, 0.45),
    'turquesa': (0.16, 0.62, 0.62), 'verde': (0.13, 0.45, 0.24), 'oliva': (0.32, 0.34, 0.16),
    'menta': (0.55, 0.85, 0.72), 'amarillo': (0.86, 0.74, 0.12), 'mostaza': (0.72, 0.55, 0.10),
    'naranja': (0.85, 0.40, 0.10), 'terra': (0.62, 0.33, 0.20), 'camel': (0.66, 0.50, 0.32),
    'beige': (0.80, 0.72, 0.60), 'arena': (0.78, 0.70, 0.56), 'marron': (0.32, 0.20, 0.13),
    'chocolate': (0.26, 0.15, 0.10), 'gris': (0.42, 0.42, 0.44), 'plata': (0.82, 0.83, 0.85),
    'dorado': (0.83, 0.68, 0.28), 'oro': (0.85, 0.70, 0.30), 'morado': (0.36, 0.16, 0.55),
    'lila': (0.62, 0.50, 0.78), 'khaki': (0.60, 0.55, 0.36), 'crema': (0.90, 0.86, 0.76),
    'acero': (0.72, 0.73, 0.76), 'tartan': (0.55, 0.12, 0.16), 'cuadros': (0.22, 0.26, 0.46),
    'floral': (0.78, 0.40, 0.55), 'leopardo': (0.60, 0.45, 0.20), 'cobre': (0.66, 0.34, 0.20),
}

# Palabras que delatan un material aunque la composición venga genérica
MAT_POR_TEXTO = [
    (('acero', 'inoxidable', 'metal', 'latón', 'laton', 'niquel', 'níquel', 'aluminio'), 'metal'),
    (('oro', 'dorado', 'baño de oro', 'bano de oro', 'chapado'), 'oro'),
    (('plata', 'plateado', 'sterling'), 'plata'),
    (('cuero', 'piel', 'nobuk', 'ante', 'sintétic', 'sintetic'), 'cuero'),
    (('denim', 'mezclilla', 'vaquero', 'jean'), 'denim'),
    (('seda', 'satén', 'saten', 'raso', 'crepe', 'crepé', 'chifón', 'chiffon'), 'seda'),
    (('encaje', 'tul', 'malla'), 'encaje'),
    (('lana', 'cashmere', 'cachemira', 'punto', 'algodón', 'algodon', 'felpa', 'polar', 'fleece'), 'punto'),
    (('cristal', 'zirconia', 'diamante', 'cristalino', 'piedra', 'perla', 'nácar', 'nacar'), 'gema'),
    (('goma', 'caucho', 'silicona', 'eva', 'poliuretano'), 'goma'),
]

# ── Proporciones por género (escala global del modelo) ──────────────────────
ESCALA_GENERO = {'damas': 1.0, 'caballeros': 1.07, 'unisex': 1.03, 'ninos': 0.62}


# ════════════════════════════════════════════════════════════════════════════
#  Utilidades de malla
# ════════════════════════════════════════════════════════════════════════════
_mat_cache = {}
_bisel = 0.010


def material(tipo, rgb):
    clave = '%s|%.3f|%.3f|%.3f' % (tipo, rgb[0], rgb[1], rgb[2])
    if clave in _mat_cache:
        return _mat_cache[clave]
    m = bpy.data.materials.new(clave)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    perf = TIPOS_MAT.get(tipo, TIPOS_MAT['tela'])

    def pon(nombre, valor):
        if nombre in bsdf.inputs:
            bsdf.inputs[nombre].default_value = valor

    pon('Base Color', (rgb[0], rgb[1], rgb[2], 1.0))
    pon('Metallic', perf.get('metallic', 0.0))
    pon('Roughness', perf.get('rough', 0.8))
    pon('Sheen Weight', perf.get('sheen', 0.0))
    if 'alpha' in perf:
        pon('Alpha', perf['alpha'])
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else 'OPAQUE'
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    _mat_cache[clave] = m
    return m


def _asentar(ob, rot, esc, mat):
    ob.rotation_euler = rot
    ob.scale = esc
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.data.materials.append(mat)
    return ob


def _suavizar(ob, angulo=48.0):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    try:
        ob.data.use_auto_smooth = True
        ob.data.auto_smooth_angle = math.radians(angulo)
    except AttributeError:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angulo))
    return ob


def caja(dim, pos=(0, 0, 0), rot=(0, 0, 0), mat=None, bisel=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=pos)
    ob = _asentar(bpy.context.active_object, rot, dim, mat)
    w = _bisel if bisel is None else bisel
    if w > 0:
        mod = ob.modifiers.new('bisel', 'BEVEL')
        mod.width = w
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
    return ob


def cil(r, h, pos=(0, 0, 0), rot=(0, 0, 0), mat=None, v=18, esc=(1, 1, 1), suave=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=h, location=pos)
    ob = _asentar(bpy.context.active_object, rot, esc, mat)
    return _suavizar(ob) if suave else ob


def cono(r1, r2, h, pos=(0, 0, 0), rot=(0, 0, 0), mat=None, v=20, esc=(1, 1, 1), suave=True):
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r1, radius2=r2, depth=h, location=pos)
    ob = _asentar(bpy.context.active_object, rot, esc, mat)
    return _suavizar(ob) if suave else ob


def esf(r, pos=(0, 0, 0), esc=(1, 1, 1), mat=None, seg=(18, 12), suave=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg[0], ring_count=seg[1], radius=r, location=pos)
    ob = _asentar(bpy.context.active_object, (0, 0, 0), esc, mat)
    return _suavizar(ob) if suave else ob


def toro(R, r, pos=(0, 0, 0), rot=(0, 0, 0), mat=None, esc=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=28,
                                     minor_segments=10, location=pos)
    ob = _asentar(bpy.context.active_object, rot, esc, mat)
    return _suavizar(ob)


def tubo(puntos, radios, mat, lados=10):
    """Tubo/pieza flexible: cadena de cilindros entre puntos consecutivos."""
    piezas = []
    for i in range(len(puntos) - 1):
        a = puntos[i]
        b = puntos[i + 1]
        dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        largo = math.sqrt(dx * dx + dy * dy + dz * dz)
        if largo < 1e-6:
            continue
        cx, cy, cz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
        # un cilindro nace en +Z: se gira para alinearlo con el segmento
        rx = math.atan2(math.sqrt(dx * dx + dy * dy), dz)
        rz = math.atan2(dy, dx) + math.pi / 2 if (dx or dy) else 0.0
        piezas.append(cil(radios[i], largo, (cx, cy, cz), (rx, 0, rz), mat, v=lados,
                          esc=(1.0, 1.0, 1.0)))
    return piezas


def aplanar(piezas):
    """Los constructores mezclan piezas sueltas y listas (los tubos devuelven
    varios cilindros), así que la lista se aplana antes de unir."""
    plano = []
    for p in piezas:
        if isinstance(p, (list, tuple)):
            plano.extend(aplanar(p))
        elif p is not None:
            plano.append(p)
    return plano


def unir(piezas, nombre):
    piezas = aplanar(piezas)
    if not piezas:
        raise RuntimeError('la familia no generó ninguna pieza')
    bpy.ops.object.select_all(action='DESELECT')
    for p in piezas:
        p.select_set(True)
    bpy.context.view_layer.objects.active = piezas[0]
    if len(piezas) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = nombre
    return ob


# ════════════════════════════════════════════════════════════════════════════
#  Deducción de color / material / familia a partir del producto
# ════════════════════════════════════════════════════════════════════════════
def sin_acentos(t):
    tabla = str.maketrans('áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')
    return str(t or '').translate(tabla)


def hash_vm(s):
    """El mismo hash que usa core.js para asignar el color c3d."""
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def hex_rgb(hx, defecto=(0.55, 0.55, 0.58)):
    try:
        hx = str(hx).lstrip('#')
        return tuple(int(hx[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except Exception:
        return defecto


def color_de_producto(p):
    """Color del nombre (Negro, Magenta…) y, si no hay, el c3d de la web."""
    n = sin_acentos(p['nombre']).lower()
    for palabra, rgb in COLORES.items():
        if palabra in n:
            return rgb, palabra
    return hex_rgb(p.get('color')), 'c3d'


def claro(rgb, k=0.55):
    return tuple(min(1.0, c + (1.0 - c) * k) for c in rgb)


def oscuro(rgb, k=0.45):
    return tuple(c * (1.0 - k) for c in rgb)


def tipo_material(p, familia):
    texto = sin_acentos(' '.join([p.get('nombre', ''), ' '.join(p.get('composition') or [])])).lower()
    for claves, tipo in MAT_POR_TEXTO:
        for c in claves:
            if c in texto:
                return tipo
    if familia in ('reloj', 'anillo', 'aretes', 'collar', 'pulsera', 'joya_pack'):
        return 'metal'
    if familia in ('zapato', 'zapatilla', 'cinturon', 'bolso', 'cartera', 'mochila'):
        return 'cuero'
    if familia in ('gafas',):
        return 'metal'
    if familia in ('pantalon',):
        return 'denim' if 'jean' in sin_acentos(p['nombre']).lower() else 'tela'
    return 'tela'


def familia_de(p):
    n = sin_acentos(p['nombre']).lower()
    c = sin_acentos(p['categoria']).lower()
    # OJO: comparar categoría por igualdad — "urbano" contiene "bano"
    es_bano = (c in ('traje de bano', 'bano')) or ('banador' in n) or ('bikini' in n)

    # palabras muy específicas primero
    # relojes también llegan como "Prenda Rolex Cellini…": por marca
    if 'reloj' in n or c == 'relojes' or any(m in n for m in
            ('rolex', 'cellini', 'datejust', 'submariner', 'iwc', 'longines', 'moonphase', 'cronografo')):
        return 'reloj'
    if 'gafas' in n or 'lentes' in n or 'anteojos' in n:
        return 'gafas'
    if 'mascara' in n or 'antifaz' in n:
        return 'mascara'
    if 'mochila' in n:
        return 'mochila'
    if 'cartera' in n or 'monedero' in n or 'billetera' in n or 'clutch' in n:
        return 'cartera'
    if 'bolso' in n or 'bandolera' in n or 'bolsa' in n or 'tote' in n or c == 'bolsos':
        return 'bolso'
    if 'cinturon' in n:
        return 'cinturon'
    if 'anillo' in n or 'alianza' in n:
        return 'anillo'
    if 'pendiente' in n or 'arete' in n or 'zarcillo' in n or 'argolla' in n:
        return 'aretes'
    if 'pulsera' in n or 'brazalete' in n or 'esclava' in n or 'tobillera' in n:
        return 'pulsera'
    if 'collar' in n or 'gargantilla' in n or 'cadena corporal' in n or 'colgante' in n:
        return 'collar'
    if 'cuenta' in n or 'dije' in n or 'abalorio' in n or 'campanita' in n or 'perla' in n:
        return 'joya_pack'
    if 'pinza' in n or 'coletero' in n or 'diadema' in n or 'lazo' in n or 'horquilla' in n:
        return 'pinza'
    if 'sombrero' in n or 'pamela' in n:
        return 'sombrero'
    if 'gorro' in n or 'gorra' in n or 'beanie' in n or 'visera' in n or 'capucha' in n and c == 'accesorios':
        return 'gorro'
    if 'bufanda' in n or 'chal' in n or 'panuelo' in n:
        return 'bufanda'
    if 'calcetin' in n or 'calcetines' in n or 'media ' in n:
        return 'calcetin'
    if 'pelota' in n or 'balon' in n:
        return 'pelota'
    if 'guante' in n:
        return 'guante'
    if 'cordones' in n or (('adorno' in n or 'clips' in n) and ('zapato' in n or 'tacon' in n)):
        return 'zapato'
    if 'clips' in n:
        return 'pinza'
    if 'zapatilla' in n or 'sneaker' in n or 'air jordan' in n or 'tenis ' in n:
        return 'zapatilla'
    if 'botin' in n or 'bota' in n or 'tacon' in n or 'sandalia' in n or 'zapato' in n or 'mocasin' in n or 'bailarina' in n:
        return 'zapato'

    # prendas
    if 'bodystocking' in n or 'leotardo' in n or 'body ' in n or 'medias' in n or 'panty' in n:
        return 'body'
    if 'vestido' in n or 'falda' in n or 'corset' in n or 'vestidos' in c or c == 'fiesta':
        return 'vestido'          # antes que las reglas por categoría
    if es_bano:
        return 'bano'
    if 'blusa' in n:
        return 'top'
    if 'kaftan' in n:
        return 'vestido'
    if 'sujetador' in n or 'braga' in n or 'bralette' in n or 'calzoncillo' in n or c == 'ropa interior':
        return 'interior'
    if 'camiseta' in n or 'top' in n or 'crop' in n or 'blusa' in n or c in ('blusas', 'blusas y tops'):
        return 'top'              # 'camiseta' contiene 'camisa': va primero
    if 'camisa' in n or 'franela' in n or 'oxford' in n or 'polo' in n or c in ('camisas', 'camiseria'):
        return 'camisa'
    if 'jersey' in n or 'sudadera' in n or 'hoodie' in n:
        return 'chaqueta'
    if ('traje' in n and 'bano' not in n) or 'conjunto' in n or c == 'conjuntos':
        return 'conjunto'
    if 'pantalon' in n or 'jean' in n or 'vaquero' in n or 'jogger' in n or 'legging' in n or c == 'pantalones':
        return 'pantalon'
    if 'chaleco' in n:
        return 'top'
    if 'blazer' in n or c == 'sastreria':
        return 'blazer'
    if 'abrigo' in n or 'parka' in n or 'trench' in n or 'chaqueta' in n or 'jacket' in n \
            or 'bomber' in n or c in ('abrigos', 'chaquetas', 'ropa exterior', 'streetwear', 'urbano', 'athleisure'):
        return 'chaqueta'
    if 'traje' in n:
        return 'conjunto'

    # respaldos por categoría
    if c == 'calzado':
        return 'zapatilla'
    if c == 'joyeria':
        return 'joya_pack'
    if c == 'accesorios':
        return 'accesorio'
    return 'ropa_generica'


# ════════════════════════════════════════════════════════════════════════════
#  Constructores por familia
#  C = {color, color2, mat, mat2, mat3, esc, jit, es_corto, capucha, ...}
# ════════════════════════════════════════════════════════════════════════════
def b_vestido(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    largo = 0.52 if C['corto'] else 0.78
    return [
        cono(0.42 * e, 0.20 * e, largo * e, (0, 0, largo * e / 2), mat=mat),
        cil(0.185 * e, 0.44 * e, (0, 0, (largo + 0.22) * e), mat=mat, esc=(1.0, 0.74, 1)),
        toro(0.187 * e, 0.017 * e, (0, 0, (largo + 0.0) * e), mat=mat2, esc=(1.0, 0.74, 1)),
        caja((0.055 * e, 0.014 * e, 0.20 * e), (0.10 * e, 0.0, (largo + 0.50) * e), rot=(0, 0, math.radians(-10)), mat=mat2, bisel=0.003),
        caja((0.055 * e, 0.014 * e, 0.20 * e), (-0.10 * e, 0.0, (largo + 0.50) * e), rot=(0, 0, math.radians(10)), mat=mat2, bisel=0.003),
    ]


def b_top(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    largo_manga = 0.16 if C['corto'] else 0.42
    p = [
        cil(0.20 * e, 0.46 * e, (0, 0, 0.23 * e), mat=mat, esc=(1.0, 0.72, 1)),
        toro(0.15 * e, 0.022 * e, (0, 0, 0.455 * e), mat=mat2, esc=(1.0, 0.78, 1)),
    ]
    for lado in (-1, 1):
        p.append(cil(0.062 * e, largo_manga * e, (lado * 0.215 * e, 0, (0.40 - largo_manga / 2) * e),
                     rot=(0, math.radians(lado * 7), 0), mat=mat))
    return p


def b_camisa(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [
        caja((0.44 * e, 0.24 * e, 0.70 * e), (0, 0, 0.35 * e), mat=mat, bisel=0.026),
        caja((0.20 * e, 0.10 * e, 0.05 * e), (0, 0.01 * e, 0.705 * e), mat=mat, bisel=0.012),      # cuello base
        caja((0.09 * e, 0.02 * e, 0.07 * e), (0.055 * e, 0.055 * e, 0.715 * e), rot=(math.radians(-18), 0, math.radians(12)), mat=mat2, bisel=0.008),
        caja((0.09 * e, 0.02 * e, 0.07 * e), (-0.055 * e, 0.055 * e, 0.715 * e), rot=(math.radians(-18), 0, math.radians(-12)), mat=mat2, bisel=0.008),
        caja((0.025 * e, 0.02 * e, 0.66 * e), (0, 0.122 * e, 0.35 * e), mat=mat2, bisel=0.003),      # botonera
    ]
    for lado in (-1, 1):
        p.append(caja((0.10 * e, 0.11 * e, 0.60 * e), (lado * 0.235 * e, 0, 0.36 * e),
                      rot=(0, math.radians(lado * 5), 0), mat=mat, bisel=0.022))
    for i in range(4):
        p.append(esf(0.008 * e, (0, 0.128 * e, (0.13 + i * 0.15) * e), mat=mat2, seg=(10, 6)))
    return p


def b_chaqueta(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [
        caja((0.48 * e, 0.26 * e, 0.68 * e), (0, 0, 0.34 * e), mat=mat, bisel=0.034),
        caja((0.22 * e, 0.13 * e, 0.09 * e), (0, -0.02 * e, 0.70 * e), mat=mat, bisel=0.016),
        caja((0.022 * e, 0.02 * e, 0.60 * e), (0, 0.133 * e, 0.34 * e), mat=mat2, bisel=0.004),
        caja((0.14 * e, 0.02 * e, 0.10 * e), (0.13 * e, 0.136 * e, 0.18 * e), mat=mat2, bisel=0.006),
        caja((0.14 * e, 0.02 * e, 0.10 * e), (-0.13 * e, 0.136 * e, 0.18 * e), mat=mat2, bisel=0.006),
    ]
    for lado in (-1, 1):
        p.append(cil(0.075 * e, 0.58 * e, (lado * 0.26 * e, 0, 0.34 * e),
                     rot=(0, math.radians(lado * 6), 0), mat=mat))
    if C['capucha']:
        p.append(esf(0.16 * e, (0, -0.07 * e, 0.68 * e), esc=(1.15, 1.25, 0.85), mat=mat))
    return p


def b_blazer(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [
        caja((0.46 * e, 0.24 * e, 0.66 * e), (0, 0, 0.33 * e), mat=mat, bisel=0.028),
        caja((0.11 * e, 0.02 * e, 0.34 * e), (0.075 * e, 0.125 * e, 0.50 * e), rot=(0, math.radians(-6), math.radians(10)), mat=mat2, bisel=0.006),
        caja((0.11 * e, 0.02 * e, 0.34 * e), (-0.075 * e, 0.125 * e, 0.50 * e), rot=(0, math.radians(-6), math.radians(-10)), mat=mat2, bisel=0.006),
        esf(0.012 * e, (0, 0.128 * e, 0.30 * e), mat=mat2, seg=(10, 6)),
        esf(0.012 * e, (0, 0.128 * e, 0.19 * e), mat=mat2, seg=(10, 6)),
    ]
    for lado in (-1, 1):
        p.append(cil(0.072 * e, 0.62 * e, (lado * 0.25 * e, 0, 0.32 * e),
                     rot=(0, math.radians(lado * 4), 0), mat=mat))
    return p


def b_pantalon(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    largo = 0.55 if C['corto'] else 1.02
    p = [cil(0.20 * e, 0.09 * e, (0, 0, (largo - 0.045) * e), mat=mat, esc=(1.0, 0.72, 1))]
    for lado in (-1, 1):
        p.append(cil(0.105 * e, largo * e, (lado * 0.105 * e, 0, largo * e / 2), mat=mat, esc=(1.0, 0.86, 1)))
        p.append(cil(0.112 * e, 0.03 * e, (lado * 0.105 * e, 0, 0.015 * e), mat=mat2, esc=(1.0, 0.86, 1)))
    return p


def b_conjunto(C):
    p = []
    for pieza in b_blazer(C):
        pieza.location.x += -0.48 * C['esc']
        p.append(pieza)
    for pieza in b_pantalon(C):
        pieza.location.x += 0.42 * C['esc']
        p.append(pieza)
    return p


def b_bano(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [
        esf(0.075 * e, (0.075 * e, 0, 0.30 * e), esc=(1.0, 0.65, 0.85), mat=mat),
        esf(0.075 * e, (-0.075 * e, 0, 0.30 * e), esc=(1.0, 0.65, 0.85), mat=mat),
        caja((0.30 * e, 0.02 * e, 0.045 * e), (0, 0, 0.30 * e), mat=mat, bisel=0.01),
        caja((0.24 * e, 0.16 * e, 0.16 * e), (0, 0, 0.08 * e), mat=mat2, bisel=0.05),
        tubo([(0.10 * e, 0.0, 0.33 * e), (0.14 * e, 0.0, 0.46 * e)], [0.008 * e, 0.008 * e], mat),
        tubo([(-0.10 * e, 0.0, 0.33 * e), (-0.14 * e, 0.0, 0.46 * e)], [0.008 * e, 0.008 * e], mat),
    ]
    return p


def b_interior(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    return [
        esf(0.07 * e, (0.07 * e, 0, 0.32 * e), esc=(1.0, 0.6, 0.8), mat=mat),
        esf(0.07 * e, (-0.07 * e, 0, 0.32 * e), esc=(1.0, 0.6, 0.8), mat=mat),
        caja((0.32 * e, 0.02 * e, 0.05 * e), (0, 0, 0.32 * e), mat=mat, bisel=0.01),
        caja((0.24 * e, 0.14 * e, 0.17 * e), (0, 0, 0.085 * e), mat=mat2, bisel=0.055),
        caja((0.06 * e, 0.01 * e, 0.16 * e), (0.09 * e, 0.0, 0.44 * e), rot=(0, 0, math.radians(-8)), mat=mat2, bisel=0.004),
        caja((0.06 * e, 0.01 * e, 0.16 * e), (-0.09 * e, 0.0, 0.44 * e), rot=(0, 0, math.radians(8)), mat=mat2, bisel=0.004),
    ]


def b_body(C):
    e, mat = C['esc'], C['mat']
    p = [cil(0.19 * e, 0.42 * e, (0, 0, 0.72 * e), mat=mat, esc=(1.0, 0.7, 1))]
    for lado in (-1, 1):
        p.append(cil(0.075 * e, 0.52 * e, (lado * 0.09 * e, 0, 0.26 * e), mat=mat, esc=(1.0, 0.85, 1)))
    return p


def b_calcetin(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = []
    for lado in (-1, 1):
        x = lado * 0.06 * e
        p.append(cil(0.035 * e, 0.19 * e, (x, 0, 0.13 * e), mat=mat))
        p.append(esf(0.038 * e, (x, 0.075 * e, 0.035 * e), esc=(0.9, 1.35, 0.85), mat=mat))
        p.append(cil(0.038 * e, 0.03 * e, (x, 0, 0.21 * e), mat=mat2))
    return p


def b_zapatilla(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = []
    for lado in (-1, 1):
        x = lado * 0.075 * e
        p.append(caja((0.10 * e, 0.30 * e, 0.055 * e), (x, 0.02 * e, 0.028 * e), mat=mat2, bisel=0.02))
        p.append(esf(0.058 * e, (x, -0.01 * e, 0.075 * e), esc=(0.95, 2.6, 1.15), mat=mat))
        p.append(caja((0.085 * e, 0.055 * e, 0.075 * e), (x, -0.095 * e, 0.11 * e), rot=(math.radians(-12), 0, 0), mat=mat, bisel=0.02))
        p.append(caja((0.10 * e, 0.02 * e, 0.05 * e), (x, 0.11 * e, 0.07 * e), mat=mat3, bisel=0.012))     # talón
        for i in range(3):
            p.append(caja((0.055 * e, 0.008 * e, 0.008 * e), (x, (-0.055 + i * 0.045) * e, 0.115 * e),
                          rot=(math.radians(-14), 0, 0), mat=mat3, bisel=0.002))
    return p


def b_zapato(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = []
    for lado in (-1, 1):
        x = lado * 0.065 * e
        p.append(caja((0.095 * e, 0.26 * e, 0.035 * e), (x, 0.015 * e, 0.018 * e), mat=mat2, bisel=0.012))
        p.append(esf(0.05 * e, (x, -0.02 * e, 0.065 * e), esc=(0.95, 2.4, 1.25), mat=mat))
        p.append(caja((0.075 * e, 0.09 * e, 0.085 * e), (x, 0.085 * e, 0.075 * e), rot=(math.radians(-8), 0, 0), mat=mat, bisel=0.02))
        p.append(cil(0.012 * e, 0.09 * e, (x, 0.10 * e, 0.0), mat=mat2, v=10))
    return p


def b_bolso(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    ancho = 0.30 * e * C['jit']
    p = [
        esf(0.5 * ancho, (0, 0, 0.16 * e), esc=(1.0, 0.42, 0.55), mat=mat),
        caja((ancho * 0.9, 0.02 * e, 0.10 * e), (0, 0.085 * e, 0.16 * e), mat=mat2, bisel=0.008),
        esf(0.014 * e, (0, 0.10 * e, 0.245 * e), mat=mat3, seg=(12, 8)),
    ]
    p.append(toro(0.075 * e, 0.011 * e, (0, 0.0, 0.30 * e), rot=(math.radians(90), 0, 0), mat=mat2))
    p.append(tubo([(-0.12 * e, 0.0, 0.22 * e), (-0.26 * e, 0.0, 0.44 * e), (0.26 * e, 0.0, 0.44 * e), (0.12 * e, 0.0, 0.22 * e)],
                  [0.012 * e] * 3, mat2))
    return p


def b_mochila(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    return [
        caja((0.28 * e, 0.16 * e, 0.40 * e), (0, 0, 0.20 * e), mat=mat, bisel=0.045),
        esf(0.10 * e, (0, 0.02 * e, 0.40 * e), esc=(1.3, 0.8, 0.55), mat=mat),
        caja((0.16 * e, 0.06 * e, 0.10 * e), (0, 0.085 * e, 0.12 * e), mat=mat2, bisel=0.02),
        tubo([(-0.10 * e, -0.06 * e, 0.38 * e), (-0.13 * e, -0.10 * e, 0.06 * e)], [0.018 * e] * 1, mat2),
        tubo([(0.10 * e, -0.06 * e, 0.38 * e), (0.13 * e, -0.10 * e, 0.06 * e)], [0.018 * e] * 1, mat2),
        caja((0.20 * e, 0.02 * e, 0.04 * e), (0, 0.09 * e, 0.30 * e), mat=mat3, bisel=0.008),
    ]


def b_cartera(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    return [
        caja((0.20 * e, 0.03 * e, 0.13 * e), (0, 0, 0.065 * e), mat=mat, bisel=0.018),
        caja((0.20 * e, 0.03 * e, 0.06 * e), (0, 0.0, 0.14 * e), rot=(math.radians(8), 0, 0), mat=mat2, bisel=0.012),
        esf(0.012 * e, (0, 0.02 * e, 0.10 * e), mat=mat2, seg=(10, 6)),
    ]


def b_cinturon(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [caja((0.90 * e, 0.035 * e, 0.035 * e), (0, 0, 0.05 * e), mat=mat, bisel=0.006)]
    p.append(caja((0.085 * e, 0.045 * e, 0.065 * e), (-0.45 * e, 0, 0.05 * e), mat=mat2, bisel=0.008))
    p.append(caja((0.055 * e, 0.02 * e, 0.04 * e), (-0.45 * e, 0, 0.05 * e), mat=mat2, bisel=0.006))
    for i in range(6):
        p.append(esf(0.006 * e, ((0.10 + i * 0.13) * e, 0.02 * e, 0.05 * e), mat=mat2, seg=(8, 6)))
    return p


def b_gafas(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = []
    for lado in (-1, 1):
        p.append(caja((0.055 * e, 0.012 * e, 0.045 * e), (lado * 0.055 * e, 0, 0.03 * e), mat=mat2, bisel=0.008))
        p.append(esf(0.05 * e, (lado * 0.055 * e, 0.02 * e, 0.03 * e), esc=(1.0, 0.35, 1.15), mat=mat3))
        p.append(caja((0.008 * e, 0.008 * e, 0.14 * e), (lado * 0.10 * e, -0.07 * e, 0.05 * e),
                      rot=(math.radians(-72), 0, 0), mat=mat, bisel=0.002))
    p.append(caja((0.03 * e, 0.01 * e, 0.008 * e), (0, 0, 0.045 * e), mat=mat2, bisel=0.003))
    return p


def b_reloj(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = [caja((0.16 * e, 0.045 * e, 0.018 * e), (-0.10 * e, 0, 0.03 * e), mat=mat2, bisel=0.008),
         caja((0.16 * e, 0.045 * e, 0.018 * e), (0.10 * e, 0, 0.03 * e), mat=mat2, bisel=0.008),
         cil(0.026 * e, 0.016 * e, (0, 0, 0.032 * e), rot=(math.radians(90), 0, 0), mat=mat, v=28),
         toro(0.026 * e, 0.004 * e, (0, 0.009 * e, 0.032 * e), rot=(math.radians(90), 0, 0), mat=mat),
         cil(0.021 * e, 0.006 * e, (0, 0.013 * e, 0.032 * e), rot=(math.radians(90), 0, 0), mat=mat3, v=28),
         caja((0.012 * e, 0.006 * e, 0.006 * e), (0, 0.016 * e, 0.032 * e), mat=mat3, bisel=0.001)]
    # agujas
    p.append(caja((0.0015 * e, 0.0015 * e, 0.016 * e), (0, 0.017 * e, 0.040 * e), mat=mat, bisel=0.0004))
    p.append(caja((0.012 * e, 0.0015 * e, 0.0015 * e), (0.005 * e, 0.017 * e, 0.032 * e), mat=mat, bisel=0.0004))
    return p


def b_collar(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = [toro(0.085 * e, 0.004 * e, (0, 0, 0.22 * e), rot=(math.radians(90), 0, 0), mat=mat)]
    p.append(esf(0.016 * e, (0, 0.0, 0.135 * e), esc=(1.0, 0.55, 1.2), mat=mat3, seg=(16, 10)))
    p.append(cil(0.003 * e, 0.04 * e, (0, 0, 0.175 * e), mat=mat))
    if C['jit'] > 1.0:
        for lado in (-1, 1):
            p.append(esf(0.008 * e, (lado * 0.055 * e, 0, 0.28 * e), mat=mat3, seg=(12, 8)))
    return p


def b_pulsera(C):
    e, mat, mat3 = C['esc'], C['mat'], C['mat3']
    p = [toro(0.055 * e, 0.006 * e, (0, 0, 0.06 * e), rot=(math.radians(90), 0, 0), mat=mat)]
    p.append(esf(0.012 * e, (0, 0.0, 0.0), esc=(1.0, 0.6, 1.0), mat=mat3, seg=(14, 10)))
    if C['jit'] > 1.02:
        for i in range(3):
            p.append(esf(0.007 * e, (math.cos(i * 2.1) * 0.055 * e, 0, 0.06 * e + math.sin(i * 2.1) * 0.055 * e),
                         mat=mat3, seg=(10, 6)))
    return p


def b_anillo(C):
    e, mat, mat3 = C['esc'], C['mat'], C['mat3']
    return [
        toro(0.017 * e, 0.003 * e, (0, 0, 0.02 * e), rot=(math.radians(90), 0, 0), mat=mat),
        esf(0.008 * e, (0, 0.006 * e, 0.037 * e), esc=(1.0, 1.0, 1.3), mat=mat3, seg=(14, 10)),
    ]


def b_aretes(C):
    e, mat, mat3 = C['esc'], C['mat'], C['mat3']
    p = []
    for lado in (-1, 1):
        x = lado * 0.03 * e
        p.append(toro(0.012 * e, 0.002 * e, (x, 0, 0.075 * e), rot=(math.radians(90), 0, 0), mat=mat))
        p.append(esf(0.014 * e, (x, 0, 0.04 * e), esc=(1.0, 0.7, 1.5), mat=mat3, seg=(14, 10)))
    return p


def b_joya_pack(C):
    """Packs de 10/20/30 piezas: se muestran como un grupo de cuentas/dijes."""
    e, mat, mat3 = C['esc'], C['mat'], C['mat3']
    p = []
    formas = [(0, 0.0, 0.02), (1, 0.055, 0.03), (2, 0.11, 0.025), (3, 0.0, 0.075), (4, 0.055, 0.08), (5, 0.11, 0.07)]
    for forma, dx, alto in formas:
        x = (dx - 0.055) * e
        z = alto * e
        if forma % 3 == 0:
            p.append(esf(0.02 * e, (x, 0, z), mat=mat, seg=(14, 10)))
        elif forma % 3 == 1:
            p.append(caja((0.038 * e, 0.038 * e, 0.038 * e), (x, 0, z), mat=mat3, bisel=0.006))
        else:
            p.append(toro(0.022 * e, 0.007 * e, (x, 0, z), rot=(math.radians(90), 0, 0), mat=mat3))
    return p


def b_pinza(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    return [
        caja((0.075 * e, 0.016 * e, 0.014 * e), (0, 0, 0.007 * e), mat=mat, bisel=0.005),
        caja((0.032 * e, 0.010 * e, 0.024 * e), (0.03 * e, 0, 0.022 * e), rot=(0, math.radians(14), 0), mat=mat2, bisel=0.004),
        caja((0.032 * e, 0.010 * e, 0.024 * e), (-0.03 * e, 0, 0.022 * e), rot=(0, math.radians(-14), 0), mat=mat2, bisel=0.004),
        esf(0.008 * e, (0, 0, 0.014 * e), mat=mat2, seg=(10, 8)),
    ]


def b_sombrero(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    return [
        cil(0.19 * e, 0.012 * e, (0, 0, 0.006 * e), mat=mat, v=32),
        cono(0.105 * e, 0.085 * e, 0.115 * e, (0, 0, 0.065 * e), mat=mat),
        toro(0.104 * e, 0.012 * e, (0, 0, 0.122 * e), mat=mat2),
    ]


def b_gorro(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    return [
        esf(0.10 * e, (0, 0, 0.06 * e), esc=(1.0, 1.0, 1.05), mat=mat),
        cil(0.102 * e, 0.035 * e, (0, 0, 0.017 * e), mat=mat2, v=24),
        esf(0.03 * e, (0, 0, 0.16 * e), mat=mat2, seg=(14, 10)),
    ]


def b_bufanda(C):
    e, mat = C['esc'], C['mat']
    return [
        toro(0.13 * e, 0.032 * e, (0, 0, 0.20 * e), esc=(1.0, 0.9, 1.0), mat=mat),
        caja((0.07 * e, 0.05 * e, 0.22 * e), (0.02 * e, 0.10 * e, 0.10 * e), rot=(math.radians(6), 0, 0), mat=mat, bisel=0.02),
    ]


def b_mascara(C):
    e, mat, mat2, mat3 = C['esc'], C['mat'], C['mat2'], C['mat3']
    p = [esf(0.10 * e, (0, 0, 0.06 * e), esc=(1.25, 0.45, 1.0), mat=mat)]
    for lado in (-1, 1):
        p.append(esf(0.022 * e, (lado * 0.048 * e, 0.022 * e, 0.07 * e), esc=(1.3, 0.5, 0.8), mat=mat3))
        p.append(tubo([(lado * 0.11 * e, 0.0, 0.07 * e), (lado * 0.20 * e, -0.06 * e, 0.10 * e)], [0.006 * e], mat2))
    return p


def b_pelota(C):
    """Balones y pelotas deportivas: esfera con las costuras marcadas."""
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    r = 0.11 * e
    return [
        esf(r, (0, 0, r), mat=mat, seg=(26, 18)),
        toro(r * 0.995, 0.005 * e, (0, 0, r), mat=mat2),
        toro(r * 0.995, 0.005 * e, (0, 0, r), rot=(math.radians(90), 0, 0), mat=mat2),
        toro(r * 0.995, 0.005 * e, (0, 0, r), rot=(0, math.radians(90), 0), mat=mat2),
    ]


def b_guante(C):
    """Par de guantes: palma, cuatro dedos, pulgar y puño."""
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = []
    for lado in (-1, 1):
        x = lado * 0.06 * e
        p.append(esf(0.05 * e, (x, 0, 0.10 * e), esc=(1.0, 0.55, 1.3), mat=mat))
        for i in range(4):
            p.append(cil(0.011 * e, 0.075 * e, (x + (i - 1.5) * 0.021 * e, 0, 0.185 * e),
                         rot=(0, math.radians((i - 1.5) * 8), 0), mat=mat, v=10))
        p.append(cil(0.013 * e, 0.05 * e, (x - lado * 0.048 * e, 0.008 * e, 0.125 * e),
                     rot=(0, math.radians(lado * 55), 0), mat=mat, v=10))
        p.append(cil(0.045 * e, 0.035 * e, (x, 0, 0.035 * e), mat=mat2, esc=(1.0, 0.7, 1), v=18))
    return p


def b_accesorio(C):
    """Accesorios sueltos sin forma propia reconocible: el nombre decide entre
    bate, volante de bádminton, aro de baloncesto y, por defecto, un bolsito."""
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    n = sin_acentos(C['nombre']).lower()
    if 'bate' in n or 'palo' in n:
        return [
            cono(0.045 * e, 0.022 * e, 0.62 * e, (0, 0, 0.33 * e), mat=mat),
            cil(0.016 * e, 0.18 * e, (0, 0, 0.71 * e), mat=mat2),
            esf(0.021 * e, (0, 0, 0.81 * e), mat=mat2),
        ]
    if 'llavero' in n:
        return [
            toro(0.022 * e, 0.004 * e, (0, 0, 0.075 * e), rot=(math.radians(90), 0, 0), mat=mat),
            caja((0.05 * e, 0.012 * e, 0.045 * e), (0, 0, 0.02 * e), mat=mat2, bisel=0.006),
        ]
    if 'peluca' in n:
        return [
            esf(0.095 * e, (0, 0, 0.115 * e), esc=(1.0, 1.05, 1.15), mat=mat, seg=(22, 14)),
            cil(0.10 * e, 0.14 * e, (0, 0.01 * e, 0.07 * e), mat=mat, v=22),
        ]
    if 'volante' in n:
        return [
            cono(0.03 * e, 0.055 * e, 0.075 * e, (0, 0, 0.06 * e), rot=(math.radians(180), 0, 0), mat=mat),
            esf(0.022 * e, (0, 0, 0.12 * e), mat=mat2),
            cil(0.004 * e, 0.05 * e, (0, 0, 0.16 * e), mat=mat2, v=8),
        ]
    if 'aro de baloncesto' in n or ('aro' in n and 'baloncesto' in n):
        return [
            caja((0.36 * e, 0.02 * e, 0.24 * e), (0, 0, 0.42 * e), mat=mat2, bisel=0.01),
            toro(0.09 * e, 0.008 * e, (0, 0.10 * e, 0.40 * e), rot=(math.radians(90), 0, 0), mat=mat),
            caja((0.30 * e, 0.02 * e, 0.30 * e), (0, -0.02 * e, 0.16 * e), mat=mat2, bisel=0.02),
        ]
    return [
        caja((0.20 * e, 0.12 * e, 0.16 * e), (0, 0, 0.08 * e), mat=mat, bisel=0.03),
        toro(0.06 * e, 0.008 * e, (0, 0, 0.18 * e), rot=(math.radians(90), 0, 0), mat=mat2),
    ]


def b_ropa_generica(C):
    e, mat, mat2 = C['esc'], C['mat'], C['mat2']
    p = [
        caja((0.40 * e, 0.22 * e, 0.62 * e), (0, 0, 0.31 * e), mat=mat, bisel=0.03),
        caja((0.18 * e, 0.10 * e, 0.05 * e), (0, 0.0, 0.64 * e), mat=mat2, bisel=0.01),
    ]
    for lado in (-1, 1):
        p.append(cil(0.07 * e, 0.5 * e, (lado * 0.23 * e, 0, 0.33 * e), mat=mat))
    return p


FAMILIAS = {
    'vestido': b_vestido, 'top': b_top, 'camisa': b_camisa, 'chaqueta': b_chaqueta,
    'blazer': b_blazer, 'pantalon': b_pantalon, 'conjunto': b_conjunto, 'bano': b_bano,
    'interior': b_interior, 'body': b_body, 'calcetin': b_calcetin, 'zapatilla': b_zapatilla,
    'zapato': b_zapato, 'bolso': b_bolso, 'mochila': b_mochila, 'cartera': b_cartera,
    'cinturon': b_cinturon, 'gafas': b_gafas, 'reloj': b_reloj, 'collar': b_collar,
    'pulsera': b_pulsera, 'anillo': b_anillo, 'aretes': b_aretes, 'joya_pack': b_joya_pack,
    'pinza': b_pinza, 'sombrero': b_sombrero, 'gorro': b_gorro, 'bufanda': b_bufanda,
    'pelota': b_pelota, 'guante': b_guante,
    'mascara': b_mascara, 'accesorio': b_accesorio, 'ropa_generica': b_ropa_generica,
}


# ════════════════════════════════════════════════════════════════════════════
#  Construcción y exportación de un producto
# ════════════════════════════════════════════════════════════════════════════
def contexto(p, familia):
    rgb, origen = color_de_producto(p)
    tipo = tipo_material(p, familia)
    jit = 0.94 + (hash_vm(p['sku'] + 'jit') % 13) / 100.0          # 0.94 … 1.06
    nombre = sin_acentos(p['nombre']).lower()
    return {
        'nombre': p['nombre'],
        'color': rgb,
        'color2': claro(rgb, 0.35),
        'color3': oscuro(rgb, 0.35),
        'mat': material(tipo, rgb),
        'mat2': material(tipo if tipo in ('cuero', 'metal', 'oro', 'plata', 'denim') else 'tela', claro(rgb, 0.30)),
        'mat3': material('metal', (0.78, 0.78, 0.80)) if tipo in ('metal', 'oro', 'plata') else material('gema', oscuro(rgb, 0.25)),
        'esc': ESCALA_GENERO.get(p['genero'], 1.0) * jit,
        'jit': jit,
        'corto': ('corto' in nombre) or ('mini' in nombre) or ('crop' in nombre) or ('tobillero' in nombre),
        'capucha': ('capucha' in nombre) or ('hoodie' in nombre) or ('sudadera' in nombre),
        'origen_color': origen,
        'tipo_mat': tipo,
    }


def extremos(ob):
    bpy.context.view_layer.update()
    coords = [ob.matrix_world @ v.co for v in ob.data.vertices]
    if not coords:
        return (0, 0, 0), (0, 0, 0)
    return (
        (min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)),
        (max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)),
    )


def nombre_objeto(p):
    """Nombre legible del objeto dentro del .glb: el del producto, no el SKU.

    Así el modelo se identifica en Blender o en cualquier visor por su nombre
    comercial («Abrigo Oversized Magenta Wool»), y el SKU viaja como dato extra
    del archivo (extras.sku) para no perder la trazabilidad con la base.
    """
    nombre = ' '.join(str(p.get('nombre') or '').split())
    return nombre[:56] or str(p['sku'])


def exportar(p, carpeta, familia):
    limpiar()
    C = contexto(p, familia)   # los materiales se crean ya en el archivo limpio
    ob = unir(FAMILIAS[familia](C), p['sku'])
    ob.name = nombre_objeto(p)
    ob['sku'] = p['sku']

    # Origen en el centro X/Y y en el suelo (Z = 0)
    (minx, miny, minz), (maxx, maxy, maxz) = extremos(ob)
    ob.location.x -= (minx + maxx) / 2
    ob.location.y -= (miny + maxy) / 2
    ob.location.z -= minz
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    (minx, miny, minz), (maxx, maxy, maxz) = extremos(ob)
    ob.data.calc_loop_triangles()

    ruta = os.path.join(carpeta, p['sku'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=ruta, export_format='GLB', export_apply=True,
                              export_yup=True, export_extras=True, use_selection=False)

    usdz = None
    if EXPORTAR_USDZ:
        usdz = exportar_usdz(carpeta, p['sku'])

    return {
        'sku': p['sku'],
        'archivo': p['sku'] + '.glb',
        'nombre': p['nombre'],
        'objeto': ob.name,
        'categoria': p['categoria'],
        'genero': p['genero'],
        'familia': familia,
        'material': C['tipo_mat'],
        'color_origen': C['origen_color'],
        'alto': round(maxz - minz, 3),
        'ancho': round(maxx - minx, 3),
        'fondo': round(maxy - miny, 3),
        'triangulos': len(ob.data.loop_triangles),
        'bytes': os.path.getsize(ruta),
        'usdz': usdz,
    }


def exportar_usdz(carpeta, sku):
    """Escribe `<sku>.usdz` y devuelve su tamaño en bytes (None si no se pudo).

    El USDZ es un ZIP de escena USD + texturas empaquetadas: Quick Look lo abre
    con `rel="ar"` y lo ancla a escala 1:1. Si el operador no existe (Blender
    < 4.0) o falla en una pieza concreta, se avisa UNA vez y se sigue con el
    resto de la tanda: el .glb ya está escrito y la tienda web lo usa igual.
    """
    global _usdz_aviso
    ruta = os.path.join(carpeta, sku + '.usdz')
    try:
        bpy.ops.wm.usdz_export(
            filepath=ruta,
            export_apply=True,
            export_textures=True,
            export_materials=True,
            export_normals=True,
            export_uvmaps=True,
            use_org_hierarchy=True,
        )
        return os.path.getsize(ruta)
    except AttributeError:
        # Hay compilaciones de Blender sin USD (el paquete de Debian, por
        # ejemplo): no es un fallo del producto, pero conviene decirlo claro.
        if not _usdz_aviso:
            _usdz_aviso = True
            print('[modelos3d] esta compilación de Blender (%s) no incluye el '
                  'exportador USDZ; se generan solo los .glb. Usa un Blender '
                  'oficial 4.0+ para la RA de iPhone.' % bpy.app.version_string)
        return None
    except Exception as err:                                       # noqa: BLE001
        print('   !! usdz %s: %s' % (sku, err))
        try:
            if os.path.exists(ruta):
                os.remove(ruta)   # no dejar un archivo a medias que Safari abriría
        except OSError:
            pass
        return None


def limpiar():
    # vaciar el archivo invalida los materiales de la vuelta anterior
    _mat_cache.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ════════════════════════════════════════════════════════════════════════════
#  Programa
# ════════════════════════════════════════════════════════════════════════════
def arg(nombre, defecto=None):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if nombre in argv:
        i = argv.index(nombre)
        return argv[i + 1] if i + 1 < len(argv) else True
    return defecto


def main():
    global EXPORTAR_USDZ
    limite = int(arg('--limite', 0) or 0)
    solo = arg('--solo')
    salida = arg('--salida') or SALIDA
    EXPORTAR_USDZ = bool(arg('--usdz'))
    os.makedirs(salida, exist_ok=True)

    with open(PERFIL, encoding='utf-8') as fh:
        perfil = json.load(fh)
    productos = perfil['productos']
    if solo:
        skus = {s.strip() for s in str(solo).split(',')}
        productos = [p for p in productos if p['sku'] in skus]
    if limite:
        productos = productos[:limite]

    # --familias : solo reparte el catálogo por familias (sin tocar Blender)
    if arg('--familias'):
        reparto = {}
        for p in productos:
            reparto.setdefault(familia_de(p), []).append(p)
        for fam, lista in sorted(reparto.items(), key=lambda kv: -len(kv[1])):
            muestra = lista if len(lista) <= 20 else lista[:3]
            print('%-14s %3d   %s' % (fam, len(lista), ' | '.join(x['nombre'][:32] for x in muestra)))
        print('[modelos3d] %d productos en %d familias' % (len(productos), len(reparto)))
        return

    print('[modelos3d] %d productos · salida %s' % (len(productos), salida))
    indice = []
    familias = {}
    fallos = []
    for i, p in enumerate(productos, 1):
        familia = familia_de(p)
        familias[familia] = familias.get(familia, 0) + 1
        try:
            entrada = exportar(p, salida, familia)
            indice.append(entrada)
            print('  %3d/%3d  %-24s %-14s %5.2f m  %5d tri  %6.1f KB%s'
                  % (i, len(productos), p['sku'], familia, entrada['alto'],
                     entrada['triangulos'], entrada['bytes'] / 1024,
                     '  +usdz' if entrada.get('usdz') else ''))
        except Exception as err:                                   # noqa: BLE001
            fallos.append((p['sku'], str(err)))
            print('  !! %s: %s' % (p['sku'], err))

    meta = {
        'generado': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'perfil': os.path.basename(PERFIL),
        'total': len(indice),
        'familias': dict(sorted(familias.items(), key=lambda kv: -kv[1])),
        'modelos': indice,
    }
    with open(os.path.join(salida, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

    print('\n[modelos3d] %d modelos · %.1f MB · %d fallos'
          % (len(indice), sum(m['bytes'] for m in indice) / 1048576, len(fallos)))
    print('[modelos3d] familias:', ', '.join('%s:%d' % kv for kv in meta['familias'].items()))
    for sku, err in fallos:
        print('   fallo %s → %s' % (sku, err))


if __name__ == '__main__':
    main()
