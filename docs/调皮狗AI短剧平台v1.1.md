# 调皮狗AI短剧平台 v1.1 — 项目文档

> AI 短剧自动化生产平台：小说原文 → 格式化剧本 → 角色/场景提取 → 音色分配 → 分镜拆解 → 镜头图 → 视频生成 → 配音合成 → 整集导出。

v1.1 相对 v1.0 的三轮功能迭代：

1. **素材上传与绑定**：图片/音频上传接口强化，角色形象、场景图、分镜配音均可「上传」或从「素材库」绑定。
2. **任务异步化与状态恢复**：TTS 与单镜头合成改为 BullMQ 入队；新增 `active-tasks` 接口，刷新/离开页面后自动恢复全部进行中任务的进度徽标与轮询。
3. **素材库 + 云存储 P1（阿里云 OSS）**：assets 表升级为正式素材库；新增存储配置与写穿式 OSS 同步，无生效配置时行为与纯本地存储完全一致。

---

## 1. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 20+、Hono、Drizzle ORM、PostgreSQL、BullMQ + Redis、Mastra + AI SDK、fluent-ffmpeg、sharp、ali-oss |
| 前端 | Nuxt 3（SPA 模式，`ssr: false`）、Vue 3、TypeScript、纯 CSS（浅色主题）、lucide-vue-next、vue-sonner |
| 部署 | Docker（单镜像三阶段构建，内置 FFmpeg）+ docker-compose（postgres / redis / api / worker） |

## 2. 目录结构

```
backend/            后端服务
  src/
    index.ts        API 入口（端口 5679，含静态文件与前端产物服务）
    worker.ts       BullMQ Worker 入口（独立进程）
    routes/         REST API 路由（21 个模块，含 assets.ts、storageConfigs.ts）
    services/       图片/视频/TTS 生成、FFmpeg 合成与拼接、宫格切分、
                    asset-register.ts（素材库统一注册）、tts-task.ts（TTS 队列处理器）
      adapters/     多厂商适配器（纯函数式：构建请求/解析响应）
    agents/         Mastra Agent 工厂 + 工具集
    queue/          BullMQ 队列定义、Worker、入队函数
    db/             Drizzle schema（19 张表）+ 连接 + 自动迁移
    auth/           scrypt 密码、自实现 HS256 JWT、RBAC
    utils/          storage.ts（本地存储 + OSS 写穿层）等工具
    scripts/        数据库迁移脚本
  drizzle/          SQL 迁移文件（0000–0005）
  scripts/          seed-voices.ts（音色种子数据）
frontend/           Nuxt 3 前端
  app/
    pages/          5 个路由页面
    layouts/        default / studio 布局
    components/     BaseSelect / AssetUploader / AssetPicker
    composables/    useAuth / useApi / useAgent / useMedia
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
- `storage_configs`：云存储配置（provider local/aliyun-oss、bucket、endpoint、AccessKey、domain、prefix），设置页维护，`is_active` 全局唯一生效，AccessKey Secret 出参打码（仅管理员，详见 5.4）。
- 剧集级配置锁定：每个 episode 创建时绑定 `imageConfigId/videoConfigId/audioConfigId`。

## 5. 系统架构

### 5.1 整体生产链路

```
原文粘贴 → script_rewriter（剧本改写）
        → extractor（角色/场景提取去重）
        → voice_assigner（音色分配）→ 试听（同步）
        → storyboard_breaker（分镜拆解）
        → 图片队列（角色图/场景图/镜头首帧·尾帧，可走宫格图流程）
        → 视频队列（图生视频，轮询或 Vidu Webhook）
        → TTS 队列（分镜配音，media-processing）
        → compose（FFmpeg：视频 + TTS + 烧录字幕，单镜头亦入队）
        → merge（FFmpeg concat 整集拼接）→ 导出
```

前 4 步由 Mastra Agent 同步完成（`POST /api/v1/agent/:type/chat`，非流式，`maxSteps: 20` 一次跑完返回 JSON）；后续生成类步骤走 BullMQ 异步队列，前端轮询状态；任意环节的图片/音频也可由用户上传或从素材库绑定，不必走 AI 生成。

### 5.2 队列与任务流

- 3 个队列：`huobao-image-generation`、`huobao-video-generation`、`huobao-media-processing`（compose + merge + **tts**）。
- Worker 独立进程（`npm run worker`），按 `job.name` 分发；jobId 带业务 id 前缀（`image-{id}` / `video-{id}` / `compose-{id}` / `tts-{id}` / `merge-{id}`）防重复入队。
- 统一模式：路由落库 `queued` 记录 → 入队 → Worker 回读记录 → 适配器构建请求 → 服务层统一 fetch → 同步完成或轮询（图片 5s×最多10min；视频 10s×最多约50min）→ 下载到 `data/static/` → 经 `finalizeMedia()` 写穿（见 5.4）→ 更新记录并回写业务表（storyboards/characters/scenes/episodes）。
- **TTS 队列化**（v1.1）：`POST /storyboards/:id/generate-tts` 校验对白后置 `tts_status='queued'` 并入队（media-processing 队列，`job.name='tts'`，jobId `tts-{storyboardId}`），立即返回 `{queued:true}`；Worker 处理器在 `src/services/tts-task.ts`，流程 `processing → generateTTS → completed/failed`。批量入口 `POST /storyboards/batch-generate-tts`。角色试听 `generate-voice-sample` 保持同步；compose 内联 TTS 兜底保留（分镜无 `ttsAudioUrl` 时合成现场生成）。
- **单镜头 compose 队列化**（v1.1）：`POST /compose/storyboards/:id/compose` 落 `compose_queued` 入队并返回 `{queued:true}`（无视频仍 400）；`compose-all` / `compose-status` 行为不变。
- **状态恢复**（v1.1）：`GET /episodes/:id/active-tasks` 返回该集 images / videos / tts / composes / merges 五组进行中任务；前端进入工作台 `onMounted` 时调用，恢复全部 pending 徽标并续跑轮询，修复「离开页面任务丢失」。
- Vidu 特例：无轮询端点，靠 `POST /webhooks/vidu` 回调驱动（该路由无鉴权，按 task_id 匹配）。

### 5.3 厂商适配器

`services/adapters/` 为纯函数式封装（`buildGenerateRequest` / `parseGenerateResponse` / `buildPollRequest` / `parsePollResponse`），HTTP 由服务层统一发起：

| 类型 | 厂商 |
|---|---|
| 图片 | MiniMax、OpenAI、Gemini（base64 inlineData）、火山引擎 seedream、阿里万相（异步） |
| 视频 | MiniMax、火山引擎 Seedance（4-12s）、Vidu（Webhook）、阿里 wan2.6-i2v |
| TTS | MiniMax（t2a_v2，hex 音频） |

未知 provider 一律回退 MiniMax。`chatfire` 中转复用 OpenAI 适配器。参考图本地下载后压缩为 data URL（sharp，768px/质量68），上限 6 张。

### 5.4 存储抽象与云存储（阿里云 OSS，v1.1 新增）

存储驱动层集中在 `src/utils/storage.ts`，依赖新增 `ali-oss`：

- `storage_configs` 表：provider（`local` / `aliyun-oss`）、bucket、endpoint、access_key_id、access_key_secret（出参打码）、domain（自定义域名/CDN）、prefix、`is_active`（全局唯一生效，激活时全表先置 false）。
- `finalizeMedia(relPath)`：**写穿式**落库最终化 —— 产物先落本地磁盘，有生效 OSS 配置时同步上传（key = prefix + 相对路径，保留 `static/` 目录结构），业务表 URL 改写为 OSS 绝对地址；任何失败记日志并降级返回本地相对路径，不阻断主流程。无生效配置时原样返回相对路径，系统行为与纯本地存储完全一致。
- `ensureLocal(urlOrPath)`：compose / merge 读到 OSS 绝对 URL 时，优先复用本地写穿副本，否则下载缓存至 `static/cache/<sha1(url)><ext>` 供 FFmpeg 使用。
- `getActiveStorageConfig()`：进程内 60s TTL 缓存；表不存在 / 查询失败 / 无生效行 / 生效行为 local 均视为本地模式。
- 写穿挂接共 9 类落库点：图片、视频、Vidu Webhook 视频、TTS、单镜头合成（含烧录字幕文件）、整集拼接、宫格切分、用户上传。
- `POST /storyboards/:id/bind-tts` 兼容 OSS 绝对 URL（http(s) 直接接受，跳过站内路径与存在性检查）。
- 管理接口 `/storage-configs`（admin-only）：CRUD、`POST /test`（探针 put + delete 验证连通）、`POST /:id/activate`、`POST /deactivate`（取消全部生效 = 切回本地）。

### 5.5 AI Agent 体系

`agents/index.ts` 每次请求动态构建 Agent：DB 配置（`agent_configs`，可覆盖 model/prompt）→ `skills/<type>/SKILL.md` 注入 instructions → OpenAI 兼容协议连接文本模型 → 闭包注入工具（episodeId/dramaId 在工厂层固定，LLM 不可传）。

| Agent | 工具 | 职责 |
|---|---|---|
| script_rewriter | read_episode_script / rewrite_to_screenplay / save_script | 小说 → 带场景头的格式化剧本（不写镜头语言） |
| extractor | read_script_for_extraction / read_existing_* / save_dedup_* | 提取角色/场景，按名字/地点+时间去重并关联当前集 |
| storyboard_breaker | read_storyboard_context / save_storyboards / update_storyboard / generate_grid_prompt | 剧本 → 分镜（17 要素，整集替换式保存，校验绑定关系） |
| voice_assigner | get_characters / list_voices / assign_voice | 按性别/年龄/性格/定位匹配音色 |
| grid_prompt_generator | read_* / generate_*_prompt（6 个） | 角色/场景/宫格图英文提示词（严格 rows×cols 格数约束） |

## 6. 数据模型（PostgreSQL，19 张表）

主线：`dramas 1—N episodes 1—N storyboards`；`dramas 1—N characters / scenes / props`。无数据库级外键，靠应用层维护；多数业务表软删除（`deleted_at`）。

| 表 | 说明 |
|---|---|
| dramas | 剧目（标题/类型/风格/集数/状态） |
| episodes | 剧集（content 原文 / scriptContent 剧本 / duration / videoUrl + 三个 AI 配置引用） |
| storyboards | 分镜（镜头语言、image/video/bgm 提示词、首/尾帧、videoUrl、ttsAudioUrl、composedVideoUrl、status 含 compose_* 状态机、**tts_status** queued/processing/completed/failed） |
| characters / scenes / props | 剧目级资源（角色含 voiceStyle 音色、seedValue；场景可关联 episode） |
| episode_characters / episode_scenes / storyboard_characters | 多对多关联 |
| image_generations / video_generations / video_merges | 生成任务与产物记录 |
| assets | **素材库**（v1.1 激活）：AI 产物与用户上传统一入库，可挂 drama/episode/storyboard，isFavorite；`source` 列区分 `ai`（默认）/ `upload`；category 含 character/scene/first_frame/last_frame/composed_image/grid/generated_video/tts/composed_video/merged_video/upload；url 带前导斜杠或 OSS 绝对 URL |
| storage_configs | 云存储配置（provider local/aliyun-oss、bucket、endpoint、AccessKey、domain、prefix、is_active 全局唯一生效） |
| ai_service_configs / ai_service_providers / ai_voices / agent_configs | 配置类 |
| users / project_members / operation_logs | 用户、项目成员（viewer/editor/owner）、操作审计 |

素材自动入库统一走 `src/services/asset-register.ts`（容错不阻断主流程）：图片（角色/场景/首帧/尾帧/宫格，关联 imageGenId）、视频（generated_video，关联 videoGenId）、TTS、单镜头合成、整集拼接、用户上传。

## 7. API 参考（前缀 `/api/v1`）

除 `/auth` 外全部需 `Authorization: Bearer <token>`；标注 (admin) 的需全局管理员。健康检查：`GET /api/v1/health`（DB + 三队列）。`/webhooks/vidu` 在 `/api/v1` 之外且无鉴权。

- **auth**：`POST /auth/register`（首用户为 admin）、`POST /auth/login`、`GET /auth/me`、`GET /auth/users` (admin)、`PUT /auth/users/:id` (admin)
- **dramas**：CRUD + `PUT /dramas/:id/characters|episodes`（批量 upsert）、`GET/POST/DELETE /dramas/:id/members[/:userId]`、`GET /dramas/:id/logs`
- **episodes**：`POST /episodes`（必须带 image/video/audio 三个 config_id）、`PUT /episodes/:id`、`GET /episodes/:id/characters|scenes`、`GET /episodes/:episode_id/storyboards`、`GET /episodes/:id/pipeline-status`（10 步流水线进度）、`GET /episodes/:id/active-tasks`（五组进行中任务：images/videos/tts/composes/merges，供前端恢复进度）
- **storyboards**：`POST`（校验 scene/character 属于该集）、`PUT /:id`（改对白会清空 TTS/字幕）、`POST /:id/generate-tts`（入队，返回 `{queued:true}`）、`POST /batch-generate-tts`（body `{ids}` → `{count,ids,skipped}`，无对白分镜自动跳过）、`POST /:id/bind-tts`（body `{url}` 或 `{asset_id}`，接受站内 static 路径或 http(s) 绝对 URL，置 `ttsAudioUrl` + `tts_status='completed'`，不动 dialogue/subtitleUrl）、`DELETE /:id`
- **characters / scenes**：更新（两者 PUT 白名单均含 `imageUrl`，入库统一去前导斜杠存 `static/...` 相对路径；scenes 设置 imageUrl 时 `status→completed`）、删除、`generate-image`、`generate-voice-sample`（角色试听，同步）、`batch-generate-images`（characters 传 `{character_ids, episode_id}`；scenes 传 `{ids, episode_id}` → `{count,ids}`）
- **images / videos**：`POST /` 与 `POST /batch`（入队）、`GET /`（按 storyboard_id/drama_id 过滤）、`GET /:id`（轮询）、`DELETE /:id`
- **compose**：`POST /compose/storyboards/:id/compose`（入队，返回 `{queued:true}`，无视频 400）、`POST /compose/episodes/:id/compose-all`（批量入队）、`GET /compose/episodes/:id/compose-status`
- **merge**：`POST /merge/episodes/:id/merge`（要求全集分镜均已合成）、`GET` 同路径查最新结果
- **grid**（宫格图）：`POST /grid/prompt`（Agent 生成提示词，失败回退模板）、`POST /grid/generate`（960×540/格）、`POST /grid/split`（sharp 切分并写回各分镜）、`GET /grid/status/:id`
- **assets**（素材库，登录 + 项目权限）：`GET /assets?drama_id=必填&episode_id&type&category&favorite&q&page&page_size` → `{items,total,page,page_size}`、`GET /assets/:id`、`PUT /assets/:id`（name/description/isFavorite）、`DELETE /assets/:id`（软删，不删文件）
- **storage-configs** (admin)：`GET/POST /storage-configs`、`PUT/DELETE /storage-configs/:id`、`POST /storage-configs/test`（探针 put+delete，支持 `{id}` 或内联配置）、`POST /storage-configs/:id/activate`（全局唯一生效）、`POST /storage-configs/deactivate`（切回本地）；access_key_secret 出参打码
- **agent**：`POST /agent/:type/chat`（非流式，需 drama_id+episode_id，editor 权限）、`GET /agent/:type/debug`
- **ai-configs / ai-providers**：CRUD、`POST /ai-configs/test`（连通性）、`POST /ai-configs/huobao-preset`（一键预设）、`GET /ai-providers`
- **agent-configs** (admin)、**skills** (admin，直接读写磁盘 `skills/*/SKILL.md`)、**ai-voices**（`/sync` 为 admin）
- **queues**：`GET /queues/status`（三队列 job 计数；media-processing 承载 compose + merge + tts 三类 job）
- **upload**：`POST /upload/image`（jpeg/png/webp/gif ≤20MB，sharp 读取宽高）、`POST /upload/audio`（mp3/wav/m4a/aac ≤50MB）；均可选表单字段 `drama_id` / `episode_id` / `storyboard_id`（drama_id 缺失时经 episode/storyboard 反查），上传即自动写入素材库（`source='upload'`），响应 `{ url, path, asset }`，url 带前导斜杠（本地）或 OSS 绝对 URL

## 8. 鉴权与权限

- 邮箱+密码注册/登录；密码 scrypt（`scrypt$salt$hash`），JWT 为自实现 HS256（`AUTH_JWT_SECRET`），默认 7 天。
- 两级权限：全局角色 `admin / creator`；项目角色 `viewer(1) < editor(2) < owner(3)`（`project_members`），admin 在任何项目视同 owner。
- 子资源 URL 不含 dramaId 时，`auth/access.ts` 逐级回溯（storyboard→episode→drama…）做权限判定；回溯不到返回 404 而非 403（防资源探测）。
- `/storage-configs` 为 admin-only（`index.ts` 中间件 + 路由内 `requireAdmin` 双重校验）；`/assets` 需登录且按素材归属反查项目权限（读 viewer / 写 editor）。
- 写操作落 `operation_logs`（action、IP、UA、detail JSON）。
- 注意：`POST /webhooks/vidu` 完全无鉴权，仅靠 task_id 匹配。

## 9. 前端说明

### 路由

| 路由 | 布局 | 说明 |
|---|---|---|
| `/login` | 无 | 登录/注册（提示首用户为管理员） |
| `/` | default | 项目卡片列表、新建/删除项目 |
| `/settings` | default | AI 服务 / Agent 配置 / Skills / 存储配置 四个标签页（后三个在高级区，admin 可见） |
| `/drama/:id` | default | 集列表、添加集（锁定三个 AI 配置）、成员管理、操作日志 |
| `/drama/:id/episode/:episodeNumber` | studio | **单集工作台**（核心页面，约 4900 行） |

### 鉴权与 API

- Token 存 localStorage（`tpg_auth_token`），`useApi` 统一加 Bearer 头，401 清 token 跳 `/login`。
- `useApi.ts` 按资源导出 API 对象（dramaAPI / episodeAPI / storyboardAPI / characterAPI / sceneAPI / imageAPI / gridAPI / videoAPI / composeAPI / mergeAPI / aiConfigAPI / agentConfigAPI / skillsAPI / voicesAPI / **uploadAPI / assetAPI / storageConfigAPI**）。
- **无 SSE**：Agent 调用为普通 POST 等待；异步产物靠前端轮询（视频 4s×120、合成 3s×120、拼接 setInterval 3s、宫格图轮询）。所有轮询统一 `disposed` 治理并清理 `setInterval` 句柄，页面卸载后不再泄漏。

### 单集工作台流程

- **剧本面板**（5 步）：原始内容 → AI 改写（可跳过）→ 角色/场景提取 → 音色分配（自动 + 手动 + 试听）→ 分镜拆解（左列表右详情，可编辑全部镜头字段）。
- **制作面板**（7 标签，需已有剧本+分镜）：角色形象 → 场景图片 → 配音生成（过滤环境音/无台词）→ 镜头图片（首帧/首尾帧，内置宫格图 5 步向导：布局→prompt→批量生成→分配→切分）→ 视频生成（自动选参考模式）→ 视频合成（单镜头/整集批量）→ **素材库**（类型筛选 / 仅收藏 / 搜索 / 重命名 / 删除 / 「绑定到…」：图片 → 角色形象或场景图，音频 → 有对白分镜）。
- **导出面板**：整集拼接、在线播放、下载。
- **上传与绑定**：新组件 `AssetUploader.vue`（kind=image|audio，上传中状态提示并禁用防重）与 `AssetPicker.vue`（素材库选择弹窗，类型过滤 + 搜索 + 分页加载）；工作台角色卡/场景卡新增「上传」「素材库」按钮，配音条目新增「上传配音」「素材库」。配音条目为三态徽标（待生成/生成中/已生成），批量生成 TTS 与场景图均改调后端批量接口。
- **任务恢复**：`onMounted` 调用 `GET /episodes/:id/active-tasks`，恢复角色图/场景图/首末帧/视频/TTS/合成/拼接的全部 pending 徽标并续跑对应轮询。
- 媒体 URL 经 `useMedia.ts` 的 `mediaUrl()` 统一处理：http(s) 或 `//` 开头的 OSS/CDN 绝对 URL 原样返回，`/static/...` 原样返回，其余相对路径补前导斜杠（替换原 `'/' +` 拼接约 30 处）。开发经 Vite 代理，生产由后端直接服务 `/static/*`；OSS 生效时为绝对 URL 直连。

## 10. 部署

### Docker Compose（推荐）

```bash
export AUTH_JWT_SECRET=$(openssl rand -hex 32)   # 必填，未设置 compose 会拒绝启动
docker compose up -d
```

4 个服务：`postgres`（127.0.0.1:5432）、`redis`（127.0.0.1:6379）、`huobao-drama`（API，5679）、`worker`（BullMQ 消费者）。健康检查依赖链：postgres/redis → api → worker。`./data` 挂载持久化媒体文件（启用 OSS 后本地仍保留写穿副本）。

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
- 生成失败排查：先查 `image_generations.error_msg` / `video_generations.error_msg`；入队失败会以 `Queue error:` 前缀落库；TTS 任务失败查 storyboards.`tts_status='failed'` 与 Worker 日志。
- **OSS 上传失败自动降级**：`finalizeMedia()` 写穿失败时记 `oss-write-through-failed` 日志并保留本地相对 URL，主流程不中断；排查时看 worker/API 日志，并用 `POST /storage-configs/test` 验证连通性。
- **任务状态异常**（如刷新后徽标丢失、进度不动）：先看 `GET /episodes/:id/active-tasks` 返回的五组进行中任务，确认任务真实状态后再查对应业务表。
- 音色库为空：执行 `npx tsx scripts/seed-voices.ts`，或在设置页用 `/ai-voices/sync` 从 MiniMax 同步（admin）。
- 从旧 SQLite 迁移：`npm run db:migrate:sqlite`（配 `SQLITE_DB_PATH` / `DATABASE_URL` / 可选 `MIGRATION_TRUNCATE=true`）。

## 12. 已知注意事项

- `configs/config.example.yaml` 不会被加载，仅历史参考；配置一律走环境变量。
- CORS 源硬编码在 `backend/src/index.ts`（localhost:3013/5679）。生产单端口同源部署无影响；前端若独立部署到其它域名需改代码。
- `better-sqlite3` 依赖仅为 SQLite 迁移脚本遗留（Docker 构建时装 python3/make/g++ 主要为它）。
- 部分列表接口为「全表查询 + 内存过滤」，数据量大后需优化。
- 删除行为不统一：drama/character/assets 软删（assets 软删不删文件），scene/storyboard 等硬删。
- 单集工作台页面约 4900 行，是前端功能单点，改动需谨慎。
- 素材删除（软删）不会清理磁盘/OSS 上的文件，因为文件可能被业务表引用。
- 仓库文件多为 CRLF 行尾，编辑时注意保持。
