# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run generate

# ── Stage 2: Build backend native modules ────────────────────
FROM node:20-slim AS backend-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./

# Production deps only (native modules compiled here)
RUN npm ci --omit=dev

# ── Stage 3: Production image (lean) ────────────────────────
FROM node:20-slim

# ffmpeg (runtime) + tsx (runs TS directly)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && npm i -g tsx

WORKDIR /app

# Pre-built node_modules (production only, native modules ready)
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY backend/package.json backend/package-lock.json ./backend/

# Backend source
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/
COPY backend/drizzle ./backend/drizzle

# Frontend static output
COPY --from=frontend-build /app/frontend/.output/public ./frontend/dist

# Skills
COPY skills/ ./skills/

RUN mkdir -p data/static

ENV NODE_ENV=production
ENV PORT=5679
ENV DATABASE_URL=postgres://huobao:huobao@postgres:5432/huobao_drama
ENV REDIS_URL=redis://redis:6379
# 安全提示：AUTH_JWT_SECRET 必须在运行时注入（docker run -e / compose environment），
# 不要在镜像中硬编码。未注入时后端会退回开发默认值 dev-change-me，仅限本地调试。

EXPOSE 5679
VOLUME ["/app/data"]

CMD ["tsx", "backend/src/index.ts"]
