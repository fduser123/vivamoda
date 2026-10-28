# ============================================================
# Backend Node de VivaModa
#
# El contexto de build es la RAÍZ del repositorio, no backend/: el servidor
# calcula ROOT como el abuelo de src/ y sirve las vistas desde
# frontends/*/code.html (el seed también las lee para crear productos).
#
# Por eso la imagen reproduce la MISMA jerarquía que en local:
#
#   /app/frontends/...      ← ROOT para las páginas
#   /app/backend/src/...    ← código
#   /app/backend/public/... ← estáticos
#
# Si se aplana a /app/src, ROOT pasa a ser "/" y todas las páginas dan 404.
#
#   docker build -f deploy/backend.Dockerfile -t vivamoda-backend .
# ============================================================
FROM node:20-slim AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./
COPY --chown=node:node backend/src ./src
# 312 MB: catálogo, modelos 3D y el resto de estáticos que sirve Express.
COPY --chown=node:node backend/public ./public
COPY --chown=node:node frontends /app/frontends

# El proceso no escribe en disco (la base está fuera), así que corre sin root.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
