# ============================================================
# Sidecar de embeddings (FashionCLIP) para la VM
#
# Misma imagen que usaba Hugging Face Spaces, pero con el contexto en la raíz
# del repositorio. En ARM64 (Oracle Ampere) funciona porque torch publica
# ruedas CPU manylinux aarch64 desde 2.14.
#
#   docker build -f deploy/sidecar.Dockerfile -t vivamoda-sidecar .
# ============================================================
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY deploy/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --force-reinstall --no-deps \
        torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu

COPY backend/ai/embed_server.py ./

# El modelo (571 MB) no se hornea en la imagen: se descarga la primera vez y
# queda en el volumen hf_cache que monta docker-compose.prod.yml.
ENV HF_HOME=/app/.cache/huggingface
ENV EMBED_HOST=0.0.0.0
ENV PORT=8001

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=5)"

CMD ["python", "embed_server.py"]
