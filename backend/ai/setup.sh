#!/usr/bin/env bash
# =====================================================================
# Prepara el entorno Python del motor de embeddings (Fase 1).
# Crea el venv e instala FashionCLIP en modo CPU.
#
# Por qué CPU: la GPU disponible es una RTX 3050 y torch+CUDA ocupa ~4,5 GB.
# El disco estaba al 94 % (6 GB libres), así que se instaló la rueda CPU
# (196 MB). Para 353 imágenes sobra: vectorizar el catálogo entero tarda
# 1,2 minutos y una consulta tarda ~190 ms. Si algún día sobra disco:
#   pip install torch --index-url https://download.pytorch.org/whl/cu121
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3.12}   # 3.12: torch/torchvision publican ruedas estables
if ! command -v "$PY" >/dev/null; then PY=python3; fi

echo "→ creando venv con $PY"
"$PY" -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip

echo "→ instalando torch (CPU)"
./.venv/bin/pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu

echo "→ instalando el resto de dependencias"
./.venv/bin/pip install --quiet open_clip_torch pillow numpy "psycopg[binary]" huggingface_hub

# torchvision TIENE que venir del mismo índice que torch: la de PyPI está
# compilada contra la build CUDA y falla con
# "RuntimeError: operator torchvision::nms does not exist".
echo "→ alineando torchvision con la build CPU"
./.venv/bin/pip install --quiet --force-reinstall --no-deps torchvision \
  --index-url https://download.pytorch.org/whl/cpu

echo "→ comprobando"
./.venv/bin/python - <<'PY'
import torch, torchvision, open_clip
print('  torch       ', torch.__version__)
print('  torchvision ', torchvision.__version__)
print('  open_clip   ', open_clip.__version__)
PY
echo "✓ entorno listo. Siguiente: npm run ai:embed"
