"""
VivaModa · Exportador .blend → .glb para los visores 3D (three.js / model-viewer)

Convierte un personaje riggeado de Blender en un GLB optimizado para la web:
  · aplica los modificadores de malla (p. ej. Mirror) conservando el esqueleto
  · conserva el skinning (vertex groups → SKIN) y las animaciones
  · sin compresión Draco (GLTFLoader de three.js r128 no la decodifica sin decoder)

Uso:
  blender --background <modelo.blend> --python tools/blender/export-glb.py -- \
      --out backend/public/models/asesor/asesor-vivamoda.glb \
      [--actions Idle_Neutral,Wave,Interact,Walk,Run] [--all] [--scale 1.0]

  --actions  lista separada por comas; si se omite, se exportan todas
  --all      fuerza exportar todas las acciones del archivo
  --scale    factor de escala uniforme (por si el modelo viene en unidades raras)
  --smooth   [grados] recalcula las normales suavizadas (por defecto 40°): quita
             el facetado de los assets low-poly y conserva las aristas duras

Notas:
  · Las acciones del .blend se "estacionan" (stash) en pistas NLA porque el
    exportador en modo ACTIONS sólo exporta la acción activa y las de las NLA.
  · Los materiales sin nodos (legacy) se exportan con su color difuso.
"""

import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else None
    return default


OUT = arg("--out", "salida.glb")
SCALE = float(arg("--scale", "1") or 1)
WANT_ALL = "--all" in argv
WANTED = [a.strip() for a in (arg("--actions", "") or "").split(",") if a.strip()]
SMOOTH = None
if "--smooth" in argv:
    i = argv.index("--smooth")
    nxt = argv[i + 1] if i + 1 < len(argv) else ""
    SMOOTH = float(nxt) if nxt.replace(".", "", 1).isdigit() else 40.0


def log(*a):
    print("[export-glb]", *a)


# ── 1. Preparar la escena ────────────────────────────────────────────
armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if not armatures:
    log("ERROR: el .blend no tiene esqueleto (armature); el avatar quedaría sin animar.")
    sys.exit(2)
arm = armatures[0]
log(f"esqueleto: {arm.name!r} con {len(arm.data.bones)} huesos")

if SCALE != 1:
    for o in bpy.data.objects:
        if o.parent is None:
            o.scale = tuple(s * SCALE for s in o.scale)
    log(f"escala aplicada: {SCALE}")

# Seleccionar el esqueleto Y sus mallas hijas (el exportador respeta la selección;
# si sólo se marca el esqueleto se exportarían las animaciones sin geometría)
def descendants(obj):
    out = []
    for child in obj.children:
        out.append(child)
        out.extend(descendants(child))
    return out

bpy.ops.object.select_all(action="DESELECT")
skinned = [o for o in descendants(arm) if o.type == "MESH"]
if not skinned:
    log("ERROR: el esqueleto no tiene mallas hijas; no habría nada que mostrar.")
    sys.exit(3)
if not any("ARMATURE" in [m.type for m in o.modifiers] for o in skinned):
    log("AVISO: ninguna malla tiene modificador Armature → el GLB saldría sin skinning.")
arm.select_set(True)
for o in skinned:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
log(f"mallas con skinning: {[o.name for o in skinned]}")

# ── Normales suavizadas por ángulo (opcional) ─────────────────────────────
# Los assets low-poly traen normales personalizadas por cara y en la web se ven
# facetados; con auto-smooth se ven lisos conservando las aristas duras.
if SMOOTH is not None:
    for o in skinned:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        me = o.data
        if me.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        for poly in me.polygons:
            poly.use_smooth = True
        if hasattr(me, "use_auto_smooth"):  # retirado en Blender 4.1+
            me.use_auto_smooth = True
            me.auto_smooth_angle = __import__("math").radians(SMOOTH)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in skinned:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    log(f"normales suavizadas a {SMOOTH}° en: {[o.name for o in skinned]}")

# ── 2. Estacionar las acciones en pistas NLA (para modo ACTIONS) ─────
actions = list(bpy.data.actions)
if not WANT_ALL and WANTED:
    missing = [a for a in WANTED if a not in [act.name for act in actions]]
    if missing:
        log(f"AVISO: acciones no encontradas en el .blend: {missing}")
    actions = [a for a in actions if a.name in WANTED]

arm.animation_data_create()
ad = arm.animation_data
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
for act in actions:
    act.use_fake_user = True
    track = ad.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)
    track.mute = True
log(f"acciones a exportar ({len(actions)}): {[a.name for a in actions]}")

# ── 3. Exportar ──────────────────────────────────────────────────────
kwargs = dict(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,            # aplica Mirror/Subsurf, nunca el Armature
    export_skins=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_yup=True,              # ejes de glTF (Y arriba, -Z al frente)
    export_materials="EXPORT",
    export_draco_mesh_compression_enable=False,
    export_cameras=False,
    export_lights=False,
    use_selection=True,
)
try:
    bpy.ops.export_scene.gltf(**kwargs)
except TypeError as err:  # alguna versión no soporta un flag
    log(f"aviso: reintentando sin flags opcionales ({err})")
    for k in ("export_animation_mode", "export_apply", "export_yup", "export_draco_mesh_compression_enable"):
        kwargs.pop(k, None)
    bpy.ops.export_scene.gltf(**kwargs)

import os
log(f"OK → {OUT} ({os.path.getsize(OUT) / 1024 / 1024:.2f} MB)")
