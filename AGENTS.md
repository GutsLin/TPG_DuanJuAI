# AGENTS.md

## Project Overview

Huobao Drama (调皮狗短剧) — AI-powered short-drama production platform. Full TypeScript stack: novel → screenplay → characters/scenes → storyboards → shot images → videos → TTS compose → episode export.

## Structure

```
backend/   — Hono + Drizzle ORM (PostgreSQL) + BullMQ/Redis + Mastra (AI agents)
frontend/  — Nuxt 3 (SPA mode) + Vue 3 + TypeScript (pure CSS, no UI framework)
configs/   — config.example.yaml (reference only, NOT loaded by code)
data/      — generated media files under data/static/ (bind-mounted in Docker)
skills/    — Agent SKILL.md definitions (5 skills)
```

## Commands

### Backend (`backend/`)
- `npm run dev` — API dev server, tsx watch (port 5679), auto-loads `.env`
- `npm start` — Production API server
- `npm run worker` — BullMQ worker process (REQUIRED for image/video/compose/merge jobs)
- `npm run typecheck` — TypeScript type checking
- `npm run db:migrate` — Run PostgreSQL migrations (also runs automatically on server start)

### Frontend (`frontend/`)
- `npm run dev` — Nuxt dev server (port 3013, proxies /api and /static to 5679)
- `npm run generate` — Static build to `.output/public` (deployed as `frontend/dist`)

### Infra
- `docker compose up -d postgres redis` — Local PostgreSQL + Redis for dev
- Full stack: `AUTH_JWT_SECRET=<random> docker compose up -d` (secret is required, compose fails without it)

## Architecture

### Backend
- **HTTP**: Hono, CORS + request logger middleware; all routes under `/api/v1`
- **Auth**: email+password (scrypt), self-rolled HS256 JWT. First registered user becomes admin. Two-level RBAC: global role (admin/creator) + project role (viewer<editor<owner via `project_members`). `/agent-configs`, `/skills`, `/ai-voices/sync` are admin-only. `/webhooks/*` is unauthenticated (provider callbacks)
- **Database**: PostgreSQL via postgres.js + Drizzle, schema in `src/db/schema.ts` (18 tables). Migrations in `backend/drizzle/`, auto-applied at startup by `src/db/migrate.ts`
- **Queues**: 3 BullMQ queues (image/video/media), workers run in a separate process (`src/worker.ts`). Flow: route inserts `queued` DB row → enqueue → worker calls provider adapter → poll/webhook → download to `data/static/` → write back to business tables
- **AI Agents**: Mastra + AI SDK (OpenAI-compatible). 5 agent types: `script_rewriter`, `extractor`, `storyboard_breaker`, `voice_assigner`, `grid_prompt_generator`. Agents are built per-request: DB config (`agent_configs`, admin-editable) + `skills/<type>/SKILL.md` appended to instructions + closure-injected tools (episodeId/dramaId fixed)
- **Agent chat is NON-streaming**: `POST /api/v1/agent/:type/chat` runs `agent.generate(maxSteps: 20)` to completion and returns one JSON. There is no SSE endpoint
- **Provider adapters** (`src/services/adapters/`): pure build-request/parse-response functions; service layer does the HTTP. Images: minimax/openai/gemini/volcengine/ali; Videos: minimax/volcengine/vidu/ali; TTS: minimax only. Unknown provider falls back to MiniMax. Vidu has no polling — uses `POST /webhooks/vidu` callback
- **Media**: FFmpeg via fluent-ffmpeg for per-shot compose (video+TTS+subtitle burn-in) and full-episode merge; sharp for grid-image splitting and reference-image compression
- **File storage**: local filesystem; `STORAGE_PATH` env (default `<repo>/data/static`), served at `/static/*`

### Frontend
- **Nuxt 3** SPA (`ssr: false`), source in `frontend/app/`
- **Routing**: file-based, 5 routes — `/login`, `/` (drama list), `/settings`, `/drama/:id`, `/drama/:id/episode/:episodeNumber` (studio workbench, ~4300-line core page)
- **State**: no Pinia; `useAuth`/`useApi`/`useAgent` composables + local state in the workbench page
- **API**: unified fetch wrapper in `app/composables/useApi.ts` (Bearer token from localStorage `tpg_auth_token`, 401 → redirect /login). No SSE — async jobs are polled by the frontend (video 4s, compose/merge 3s)
- **Styling**: pure CSS with variables in `app/assets/studio.css` — LIGHT theme (not dark)

## Configuration
- All runtime config via **environment variables** (see `backend/.env.example`): `DATABASE_URL`, `REDIS_URL`, `PORT`, `STORAGE_PATH`, `AUTH_JWT_SECRET` (must be a long random string in production), worker concurrency, etc. Backend npm scripts load `backend/.env` automatically via `tsx --env-file-if-exists`
- `configs/config.example.yaml` is legacy reference only — not loaded by any code
- AI service configs stored in DB (`ai_service_configs` table, edited via Settings page)
- Agent configs stored in DB (`agent_configs` table, admin only)

## Gotchas
- Many files use CRLF line endings — preserve them when editing
- `better-sqlite3` remains in dependencies only for the legacy SQLite→PostgreSQL migration script
- Seed TTS voices manually if needed: `cd backend && npx tsx scripts/seed-voices.ts` (not wired to an npm script)
- CORS origins are hardcoded in `backend/src/index.ts` (localhost:3013/5679); same-origin production deploys are unaffected
