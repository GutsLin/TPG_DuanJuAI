# 调皮狗AI短剧平台 v1.0 — 项目文档

> AI 短剧自动化生产平台：小说原文 → 格式化剧本 → 角色/场景提取 → 音色分配 → 分镜拆解 → 镜头图 → 视频生成 → 配音合成 → 整集导出。

---

## 1. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 20+、Hono、Drizzle ORM、PostgreSQL、BullMQ + Redis、Mastra + AI SDK、fluent-ffmpeg、sharp |
| 前端 | Nuxt 3（SPA 模式，`ssr: false`）、Vue 3、TypeScript、纯 CSS（浅色主题）、lucide-vue-next、vue-sonner |
| 部署 | Docker（单镜像三阶段构建，内置 FFmpeg）+ docker-compose（postgres / redis / api / worker） |

## 2. 目录结构

```
backend/            后端服务
  src/
    index.ts        API 入口（端口 5679，含静态文件与前端产物服务）
    worker.ts       BullMQ Worker 入口（独立进程）
    routes/         REST API 路由（18 个模块）
    services/       图片/视频/TTS 生成、FFmpeg 合成与拼接、宫格切分
      adapters/     多厂商适配器（纯函数式：构建请求/解析响应）
    agents/         Mastra Agent 工厂 + 工具集
    queue/          BullMQ 队列定义、Worker、入队函数
    db/             Drizzle schema（18 张表）+ 连接 + 自动迁移
    auth/           scrypt 密码、自实现 HS256 JWT、RBAC
    scripts/        数据库迁移脚本
  drizzle/          SQL 迁移文件
  scripts/          seed-voices.ts（音色种子数据）
frontend/           Nuxt 3 前端
  app/
    pages/          5 个路由页面
    layouts/        default / studio 布局
    composables/    useAuth / useApi / useAgent
    assets/         studio.css 全局样式
configs/            config.example.yaml（仅供参考，代码不加载）
data/               运行数据（static/ 下为生成媒体，Docker 中挂载）
skills/             5 个 Agent 技能的 SKILL.md
docs/               项目文档
```

## 3. 快速开始

### 环境要求

- Node.js 20+、npm 9+、FFmpeg 4+（本地开发必需，`ffmpeg -version` 验证）
- Docker（用于起 PostgreSQL 和 Redis，或整体部署）

### 本地开发

```bash
# 1. 启动依赖
docker compose up -d postgres redis

# 2. 后端环境变量（启动脚本自动加载 .env）
cd backend
cp .env.example .env        # 按需修改；AUTH_JWT_SECRET 生产必须改
npm install
npm run dev                 # API，端口 5679，启动时自动跑数据库迁移

# 3. Worker（另开终端，必须，否则生成任务不会执行）
cd backend
npm run worker

# 4. 前端（另开终端）
cd frontend
npm install
npm run dev                 # 端口 3013，/api 与 /static 代理到 5679
```

访问 `http://localhost:3013`，首个注册用户自动成为管理员。

可选：导入 MiniMax 音色种子数据（不导入则音色分配回退到 6 个内置音色）：

```bash
cd backend && npx tsx scripts/seed-voices.ts
```

### 生产（单服务模式）

```bash
cd frontend && npm run generate     # 产物 .output/public
cd ../backend && npm start          # 5679 同时提供 API 与前端（frontend/dist）
```

## 4. 配置说明

### 4.1 环境变量（唯一的运行时配置来源）

后端**不读取** `configs/config.yaml`；`configs/config.example.yaml` 仅为历史参考。所有配置通过环境变量注入（`backend/.env.example`）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgres://huobao:huobao@localhost:5432/huobao_drama` | PostgreSQL 连接串 |
| `DATABASE_POOL_SIZE` | `20` | 连接池大小 |
| `DATABASE_IDLE_TIMEOUT` / `DATABASE_CONNECT_TIMEOUT` | `20` / `10` | 秒 |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ 队列 |
| `QUEUE_JOB_ATTEMPTS` | `1` | 任务重试次数（指数退避 5s 起） |
| `IMAGE_WORKER_CONCURRENCY` / `VIDEO_WORKER_CONCURRENCY` / `MEDIA_WORKER_CONCURRENCY` | `4` / `2` / `2` | 三类 Worker 并发 |
| `PORT` | `5679` | API 端口 |
| `STORAGE_PATH` | `<项目根>/data/static` | 媒体文件存储目录 |
| `AUTH_JWT_SECRET` | `dev-change-me` | JWT 密钥，**生产必须设为长随机字符串** |
| `AUTH_JWT_EXPIRES_IN_SECONDS` | `604800` | Token 有效期（7 天） |

后端 npm scripts（dev/start/worker/db:migrate*）通过 `tsx --env-file-if-exists=.env` 自动加载 `backend/.env`。

### 4.2 数据库内配置（Web 界面维护）

- `ai_service_configs`：AI 服务配置（text/image/video/audio 四类，含 provider、baseUrl、apiKey、model），设置页可增删改、启停、连通性测试，支持「火宝一键预设」。API Key 出参打码。
- `agent_configs`：5 个 Agent 的 model/systemPrompt/temperature/maxTokens/maxIterations（仅管理员）。
- `ai_voices`：MiniMax 音色库（`/ai-voices/sync` 全量同步，仅保留中文/粤语并过滤卡通/播音类）。
- 剧集级配置锁定：每个 episode 创建时绑定 `imageConfigId/videoConfigId/audioConfigId`。

## 5. 系统架构

### 5.1 整体生产链路

```
原文粘贴 → script_rewriter（剧本改写）
        → extractor（角色/场景提取去重）
        → voice_assigner（音色分配）→ 试听
        → storyboard_breaker（分镜拆解）
        → 图片队列（角色图/场景图/镜头首帧·尾帧，可走宫格图流程）
        → 视频队列（图生视频，轮询或 Vidu Webhook）
        → compose（FFmpeg：视频 + TTS + 烧录字幕）
        → merge（FFmpeg concat 整集拼接）→ 导出
```

前 4 步由 Mastra Agent 同步完成（`POST /api/v1/agent/:type/chat`，非流式，`maxSteps: 20` 一次跑完返回 JSON）；后 4 步走 BullMQ 异步队列，前端轮询状态。

### 5.2 队列与任务流

- 3 个队列：`huobao-image-generation`、`huobao-video-generation`、`huobao-media-processing`（compose + merge）。
- Worker 独立进程（`npm run worker`），按 `job.name` 分发；jobId 带业务 id 前缀（`image-{id}` 等）防重复入队。
- 统一模式：路由落库 `queued` 记录 → 入队 → Worker 回读记录 → 适配器构建请求 → 服务层统一 fetch → 同步完成或轮询（图片 5s×最多10min；视频 10s×最多约50min）→ 下载到 `data/static/` → 更新记录并回写业务表（storyboards/characters/scenes/episodes）。
- Vidu 特例：无轮询端点，靠 `POST /webhooks/vidu` 回调驱动（该路由无鉴权，按 task_id 匹配）。
- TTS 不走队列：在 compose 流程内联同步调用（MiniMax 返回 hex 音频写为 mp3）。

### 5.3 厂商适配器

`services/adapters/` 为纯函数式封装（`buildGenerateRequest` / `parseGenerateResponse` / `buildPollRequest` / `parsePollResponse`），HTTP 由服务层统一发起：

| 类型 | 厂商 |
|---|---|
| 图片 | MiniMax、OpenAI、Gemini（base64 inlineData）、火山引擎 seedream、阿里万相（异步） |
| 视频 | MiniMax、火山引擎 Seedance（4-12s）、Vidu（Webhook）、阿里 wan2.6-i2v |
| TTS | MiniMax（t2a_v2，hex 音频） |

未知 provider 一律回退 MiniMax。`chatfire` 中转复用 OpenAI 适配器。参考图本地下载后压缩为 data URL（sharp，768px/质量68），上限 6 张。

### 5.4 AI Agent 体系

`agents/index.ts` 每次请求动态构建 Agent：DB 配置（`agent_configs`，可覆盖 model/prompt）→ `skills/<type>/SKILL.md` 注入 instructions → OpenAI 兼容协议连接文本模型 → 闭包注入工具（episodeId/dramaId 在工厂层固定，LLM 不可传）。

| Agent | 工具 | 职责 |
|---|---|---|
| script_rewriter | read_episode_script / rewrite_to_screenplay / save_script | 小说 → 带场景头的格式化剧本（不写镜头语言） |
| extractor | read_script_for_extraction / read_existing_* / save_dedup_* | 提取角色/场景，按名字/地点+时间去重并关联当前集 |
| storyboard_breaker | read_storyboard_context / save_storyboards / update_storyboard / generate_grid_prompt | 剧本 → 分镜（17 要素，整集替换式保存，校验绑定关系） |
| voice_assigner | get_characters / list_voices / assign_voice | 按性别/年龄/性格/定位匹配音色 |
| grid_prompt_generator | read_* / generate_*_prompt（6 个） | 角色/场景/宫格图英文提示词（严格 rows×cols 格数约束） |

## 6. 数据模型（PostgreSQL，18 张表）

主线：`dramas 1—N episodes 1—N storyboards`；`dramas 1—N characters / scenes / props`。无数据库级外键，靠应用层维护；多数业务表软删除（`deleted_at`）。

| 表 | 说明 |
|---|---|
| dramas | 剧目（标题/类型/风格/集数/状态） |
| episodes | 剧集（content 原文 / scriptContent 剧本 / duration / videoUrl + 三个 AI 配置引用） |
| storyboards | 分镜（镜头语言、image/video/bgm 提示词、首/尾帧、videoUrl、ttsAudioUrl、composedVideoUrl、status 含 compose_* 状态机） |
| characters / scenes / props | 剧目级资源（角色含 voiceStyle 音色、seedValue；场景可关联 episode） |
| episode_characters / episode_scenes / storyboard_characters | 多对多关联 |
| image_generations / video_generations / video_merges | 生成任务与产物记录 |
| assets | 通用资产库（可挂 drama/episode/storyboard，isFavorite） |
| ai_service_configs / ai_service_providers / ai_voices / agent_configs | 配置类 |
| users / project_members / operation_logs | 用户、项目成员（viewer/editor/owner）、操作审计 |

## 7. API 参考（前缀 `/api/v1`）

除 `/auth` 外全部需 `Authorization: Bearer <token>`；标注 (admin) 的需全局管理员。健康检查：`GET /api/v1/health`（DB + 三队列）。`/webhooks/vidu` 在 `/api/v1` 之外且无鉴权。

- **auth**：`POST /auth/register`（首用户为 admin）、`POST /auth/login`、`GET /auth/me`、`GET /auth/users` (admin)、`PUT /auth/users/:id` (admin)
- **dramas**：CRUD + `PUT /dramas/:id/characters|episodes`（批量 upsert）、`GET/POST/DELETE /dramas/:id/members[/:userId]`、`GET /dramas/:id/logs`
- **episodes**：`POST /episodes`（必须带 image/video/audio 三个 config_id）、`PUT /episodes/:id`、`GET /episodes/:id/characters|scenes`、`GET /episodes/:episode_id/storyboards`、`GET /episodes/:id/pipeline-status`（10 步流水线进度）
- **storyboards**：`POST`（校验 scene/character 属于该集）、`PUT /:id`（改对白会清空 TTS/字幕）、`POST /:id/generate-tts`、`DELETE /:id`
- **characters / scenes**：更新、删除、`generate-image`、`generate-voice-sample`（角色试听）、`batch-generate-images`
- **images / videos**：`POST /` 与 `POST /batch`（入队）、`GET /`（按 storyboard_id/drama_id 过滤）、`GET /:id`（轮询）、`DELETE /:id`
- **compose**：`POST /compose/storyboards/:id/compose`（同步）、`POST /compose/episodes/:id/compose-all`（批量入队）、`GET /compose/episodes/:id/compose-status`
- **merge**：`POST /merge/episodes/:id/merge`（要求全集分镜均已合成）、`GET` 同路径查最新结果
- **grid**（宫格图）：`POST /grid/prompt`（Agent 生成提示词，失败回退模板）、`POST /grid/generate`（960×540/格）、`POST /grid/split`（sharp 切分并写回各分镜）、`GET /grid/status/:id`
- **agent**：`POST /agent/:type/chat`（非流式，需 drama_id+episode_id，editor 权限）、`GET /agent/:type/debug`
- **ai-configs / ai-providers**：CRUD、`POST /ai-configs/test`（连通性）、`POST /ai-configs/huobao-preset`（一键预设）、`GET /ai-providers`
- **agent-configs** (admin)、**skills** (admin，直接读写磁盘 `skills/*/SKILL.md`)、**ai-voices**（`/sync` 为 admin）
- **queues**：`GET /queues/status`（三队列 job 计数）
- **upload**：`POST /upload/image` → `data/static/uploads/`

## 8. 鉴权与权限

- 邮箱+密码注册/登录；密码 scrypt（`scrypt$salt$hash`），JWT 为自实现 HS256（`AUTH_JWT_SECRET`），默认 7 天。
- 两级权限：全局角色 `admin / creator`；项目角色 `viewer(1) < editor(2) < owner(3)`（`project_members`），admin 在任何项目视同 owner。
- 子资源 URL 不含 dramaId 时，`auth/access.ts` 逐级回溯（storyboard→episode→drama…）做权限判定；回溯不到返回 404 而非 403（防资源探测）。
- 写操作落 `operation_logs`（action、IP、UA、detail JSON）。
- 注意：`POST /webhooks/vidu` 完全无鉴权，仅靠 task_id 匹配。

## 9. 前端说明

### 路由

| 路由 | 布局 | 说明 |
|---|---|---|
| `/login` | 无 | 登录/注册（提示首用户为管理员） |
| `/` | default | 项目卡片列表、新建/删除项目 |
| `/settings` | default | AI 服务 / Agent 配置 / Skills 三个标签页 |
| `/drama/:id` | default | 集列表、添加集（锁定三个 AI 配置）、成员管理、操作日志 |
| `/drama/:id/episode/:episodeNumber` | studio | **单集工作台**（核心页面，约 4300 行） |

### 鉴权与 API

- Token 存 localStorage（`tpg_auth_token`），`useApi` 统一加 Bearer 头，401 清 token 跳 `/login`。
- `useApi.ts` 按资源导出 API 对象（dramaAPI / episodeAPI / storyboardAPI / characterAPI / sceneAPI / imageAPI / gridAPI / videoAPI / composeAPI / mergeAPI / aiConfigAPI / agentConfigAPI / skillsAPI / voicesAPI）。
- **无 SSE**：Agent 调用为普通 POST 等待；异步产物靠前端轮询（视频 4s×120、合成 3s×120、拼接 setInterval 3s、宫格图轮询）。

### 单集工作台流程

- **剧本面板**（5 步）：原始内容 → AI 改写（可跳过）→ 角色/场景提取 → 音色分配（自动 + 手动 + 试听）→ 分镜拆解（左列表右详情，可编辑全部镜头字段）。
- **制作面板**（6 标签，需已有剧本+分镜）：角色形象 → 场景图片 → 配音生成（过滤环境音/无台词）→ 镜头图片（首帧/首尾帧，内置宫格图 5 步向导：布局→prompt→批量生成→分配→切分）→ 视频生成（自动选参考模式）→ 视频合成（单镜头/整集批量）。
- **导出面板**：整集拼接、在线播放、下载。
- 媒体 URL 均以 `/static/...` 引用（开发经 Vite 代理，生产由后端直接服务）。

## 10. 部署

### Docker Compose（推荐）

```bash
export AUTH_JWT_SECRET=$(openssl rand -hex 32)   # 必填，未设置 compose 会拒绝启动
docker compose up -d
```

4 个服务：`postgres`（127.0.0.1:5432）、`redis`（127.0.0.1:6379）、`huobao-drama`（API，5679）、`worker`（BullMQ 消费者）。健康检查依赖链：postgres/redis → api → worker。`./data` 挂载持久化媒体文件。

### 单容器

```bash
docker build -t huobao-drama:latest .
docker run -d --name huobao-drama -p 5679:5679 \
  -v $(pwd)/data:/app/data \
  -e AUTH_JWT_SECRET=<长随机字符串> \
  huobao-drama:latest
```

镜像内默认 `DATABASE_URL`/`REDIS_URL` 指向 compose 服务名（`postgres`/`redis`），单容器运行需用 `-e` 覆盖为实际地址。Linux 访问宿主机服务（如 Ollama）需 `--add-host=host.docker.internal:host-gateway`，Base URL 填 `http://host.docker.internal:<端口>/v1`。

### 传统部署

上传 `backend/`（含 node_modules 与 .env）、`frontend/dist/`、`skills/`、`data/`；服务器需 Node 20+ 与 FFmpeg，分别常驻 `npm start` 与 `npm run worker`。Nginx 反代到 5679 即可（见 README 示例）。

## 11. 运维与排障

- 健康检查：`GET /api/v1/health` 返回 database/redis 状态。
- 队列监控：`GET /api/v1/queues/status` 看 waiting/active/delayed/completed/failed。
- 任务日志：Worker 的 completed/failed/error 事件写入 `utils/task-logger`。
- 生成失败排查：先查 `image_generations.error_msg` / `video_generations.error_msg`；入队失败会以 `Queue error:` 前缀落库。
- 音色库为空：执行 `npx tsx scripts/seed-voices.ts`，或在设置页用 `/ai-voices/sync` 从 MiniMax 同步（admin）。
- 从旧 SQLite 迁移：`npm run db:migrate:sqlite`（配 `SQLITE_DB_PATH` / `DATABASE_URL` / 可选 `MIGRATION_TRUNCATE=true`）。

## 12. 已知注意事项

- `configs/config.example.yaml` 不会被加载，仅历史参考；配置一律走环境变量。
- CORS 源硬编码在 `backend/src/index.ts`（localhost:3013/5679）。生产单端口同源部署无影响；前端若独立部署到其它域名需改代码。
- `better-sqlite3` 依赖仅为 SQLite 迁移脚本遗留（Docker 构建时装 python3/make/g++ 主要为它）。
- 部分列表接口为「全表查询 + 内存过滤」，数据量大后需优化。
- 删除行为不统一：drama/character 软删，scene/storyboard 等硬删。
- 单集工作台页面约 4300 行，是前端功能单点，改动需谨慎。
- 仓库文件多为 CRLF 行尾，编辑时注意保持。
