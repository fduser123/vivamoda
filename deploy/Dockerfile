# ============================================================
# Sidecar de embeddings para Hugging Face Spaces
#
# Se despliega SOLO el microservicio de vectores, no el proyecto completo:
# Space gratuito da 16 GB de RAM en CPU, suficiente para FashionCLIP, mientras
# que un plan gratuito tipo Render (512 MB) se queda sin memoria.
# ============================================================
FROM python:3.12-slim

# libgomp es necesario para que PyTorch funcione
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt \
 && pip install --no-cache-dir --force-reinstall --no-deps \
        torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu

COPY embed_server.py .

# El modelo (571 MB) NO se hornea en la imagen: se descarga la primera vez y
# queda cacheado. HF_HOME lo mantiene dentro del contenedor.
ENV HF_HOME=/app/.cache/huggingface
ENV EMBED_HOST=0.0.0.0
ENV PORT=7860

EXPOSE 7860
CMD ["python", "embed_server.py"]
