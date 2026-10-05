#!/usr/bin/env python3
"""
VivaModa · Inspector de GLB/glTF

Lee la cabecera y el bloque JSON de un .glb (sin dependencias) y reporta lo que
importa para elegir un avatar animable:

    python3 tools/glb-info.py modelos/*.glb

Reporta: skins (0 = no animable por esqueleto), nº de huesos, animaciones con su
duración, mallas/materiales/texturas, triángulos y tamaño en disco.
"""

import json
import os
import struct
import sys


def read_glb(path):
    with open(path, "rb") as f:
        magic, _version, _length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError("no es un GLB (¿es .gltf suelto? usa json.load)")
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        if chunk_type != b"JSON":
            raise ValueError("el primer chunk no es JSON")
        return json.loads(f.read(chunk_len).decode("utf-8"))


def triangles(gltf):
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            if mode != 4:  # sólo TRIANGLES
                continue
            acc = gltf["accessors"][prim["indices"]] if "indices" in prim else prim.get("attributes", {}).get("POSITION")
            if acc is None:
                continue
            # glTF cuenta elementos (índices), no triángulos
            total += acc["count"] // 3
    return total


def vertex_count(gltf):
    return sum(
        gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
        for mesh in gltf.get("meshes", [])
        for prim in mesh.get("primitives", [])
        if "POSITION" in prim.get("attributes", {})
    )


def report(path):
    gltf = read_glb(path)
    size = os.path.getsize(path) / 1024 / 1024
    skins = gltf.get("skins", [])
    anims = gltf.get("animations", [])
    meshes = gltf.get("meshes", [])
    images = gltf.get("images", [])

    print(f"\n=== {path} ===")
    print(f"  tamaño        : {size:.2f} MB   ({size * 1024:.0f} KB)")
    print(f"  skins         : {len(skins)}   {'✓ animable con esqueleto' if skins else '✗ SIN esqueleto (no se puede animar el cuerpo)'}")
    for i, sk in enumerate(skins):
        print(f"      skin[{i}]   : {len(sk.get('joints', []))} huesos, nodo raíz={sk.get('skeleton')}")
    print(f"  animaciones   : {len(anims)}")
    for a in anims:
        dur = 0.0
        for s in a.get("samplers", []):
            acc = gltf["accessors"][s["input"]]
            if acc.get("max"):
                dur = max(dur, float(acc["max"][0]))
        print(f"      · {a.get('name', '(sin nombre)'):<28} {dur:5.2f} s")
    print(f"  mallas        : {len(meshes)}   materiales: {len(gltf.get('materials', []))}   texturas: {len(images)}")
    print(f"  triángulos    : {triangles(gltf):,}   vértices: {vertex_count(gltf):,}")
    for m in gltf.get("materials", []):
        base = (m.get("pbrMetallicRoughness", {}) or {}).get("baseColorFactor")
        if base:
            hexc = "#%02x%02x%02x" % tuple(min(255, int(c * 255)) for c in base[:3])
            print(f"      mat {m.get('name', '?'):<22} {hexc}")
    ext = gltf.get("extensionsUsed", [])
    if ext:
        print(f"  extensiones   : {', '.join(ext)}")
    if "KHR_draco_mesh_compression" in ext:
        print("      ⚠️  Draco: three.js r128 necesita DRACOLoader para leerlo")
    lic = gltf.get("asset", {}).get("copyright")
    if lic:
        print(f"  copyright     : {lic}")
    return len(skins) > 0 and len(anims) > 0


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        sys.exit(1)
    ok = True
    for p in paths:
        try:
            ok = report(p) and ok
        except Exception as e:  # noqa: BLE001
            print(f"\n=== {p} ===\n  ERROR: {e}")
            ok = False
    sys.exit(0 if ok else 1)
