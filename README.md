# 🎬 调皮狗短剧 - AI 短剧生成平台

<div align="center">

**基于 TypeScript 全栈的 AI 短剧自动化生产平台**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

[功能特性](#功能特性) • [快速开始](#快速开始) • [部署指南](#部署指南)

</div>

---

## 📖 项目简介

调皮狗短剧是一个基于 AI 的短剧自动化生产平台，实现从剧本生成、角色设计、分镜制作到视频合成的全流程自动化。

### 🎯 核心价值

- **🤖 AI 驱动**：使用大语言模型解析剧本，提取角色、场景和分镜信息
- **🎨 智能创作**：AI 绘图生成角色形象和场景背景
- **📹 视频生成**：基于文生视频和图生视频模型自动生成分镜视频
- **🔄 工作流**：完整的短剧制作工作流，从创意到成片一站式完成

### 🛠️ 技术架构

```
backend/    — Hono API、Drizzle/PostgreSQL、BullMQ Worker、Mastra Agents
frontend/   — Nuxt 3 SPA、Vue 3、TypeScript、纯 CSS
skills/     — 5 类 Agent 的 SKILL.md 指令文件
data/       — 运行时媒体文件，实际内容位于 data/static/
scripts/    — 云服务器部署脚本与部署配置模板
configs/    — 旧版 YAML 配置示例，仅作参考，运行时不会读取
Dockerfile  — 前端构建、后端运行和 FFmpeg 环境的多阶段镜像
docker-compose.yml — API、Worker、PostgreSQL、Redis 完整编排
```

### 🎥 作品展示 / Demo Videos

体验 AI 短剧生成效果：

<div align="center">

**示例作品 1**

<video src="https://ffile.chatfire.site/cf/public/20260114094337396.mp4" controls width="640"></video>

**示例作品 2**

<video src="https://ffile.chatfire.site/cf/public/fcede75e8aeafe22031dbf78f86285b8.mp4" controls width="640"></video>

[点击观看视频 1](https://ffile.chatfire.site/cf/public/20260114094337396.mp4) | [点击观看视频 2](https://ffile.chatfire.site/cf/public/fcede75e8aeafe22031dbf78f86285b8.mp4)

</div>

---

## ✨ 功能特性

### 🎭 角色管理

- ✅ AI 生成角色形象
- ✅ 批量角色生成
- ✅ 角色图片上传和管理
- ✅ 角色音色分配与试听

### 🎬 分镜制作

- ✅ AI 自动拆解分镜脚本
- ✅ 场景描述和镜头设计
- ✅ 分镜图片生成（文生图）
- ✅ 宫格图生成、切分与分配
- ✅ 帧类型选择（首帧/尾帧/分镜板）

### 🎥 视频生成

- ✅ 图生视频自动生成
- ✅ TTS 配音生成
- ✅ FFmpeg 单镜头合成（视频 + 音频 + 字幕）
- ✅ 整集拼接导出

### 📦 资源管理

- ✅ 素材库统一管理
- ✅ 本地存储支持
- ✅ 任务进度追踪

### 🤖 AI Agents

内置 5 个 Mastra Agent，支持数据库配置和 Skill 扩展：

| Agent | 职责 |
|---|---|
| `script_rewriter` | 小说 → 格式化剧本改写 |
| `extractor` | 角色 + 场景智能提取与去重 |
| `storyboard_breaker` | 剧本 → 分镜序列拆解 |
| `voice_assigner` | 角色音色自动分配 |
| `grid_prompt_generator` | 角色/场景/宫格图提示词生成 |

### 🔌 多厂商适配

| 类型 | 支持厂商 |
|---|---|
| **图片** | OpenAI、Gemini、MiniMax、火山引擎、阿里、Chatfire |
| **视频** | MiniMax、火山引擎/Seedance、Vidu、阿里 |
| **TTS** | MiniMax |

---

## 🚀 快速开始

### 📋 环境要求

| 软件 | 版本要求 | 用途 |
|---|---|---|
| **Node.js** | 20+ | 运行前端、API 和 Worker |
| **npm** | 9+ | 按两个 lockfile 安装依赖 |
| **PostgreSQL** | 15+，Compose 使用 17 | 主数据库 |
| **Redis** | 7+ | BullMQ 图片、视频和媒体任务队列 |
| **FFmpeg** | 4.0+ | TTS 合成、字幕烧录和整集拼接 |
| **Docker + Compose** | 可选 | 快速启动基础设施或完整生产环境 |

只开发页面或文本 Agent 时也建议启动 Worker；图片、视频、配音、合成和拼接任务没有 Worker 不会被执行。

安装并验证 FFmpeg：

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# macOS
brew install ffmpeg

# 所有平台安装后验证
ffmpeg -version
```

Windows 可从 [FFmpeg 官网](https://ffmpeg.org/download.html) 安装，并确保 `ffmpeg` 已加入 `PATH`。

### ⚙️ 配置方式

项目有两类配置，职责不同：

1. **运行环境配置**写入 `backend/.env`，包含 PostgreSQL、Redis、端口、存储目录、JWT 和 Worker 并发数。
2. **AI 服务、模型、API Key、Agent 和存储服务配置**在登录后的「设置」页面维护，并保存到 PostgreSQL。

`configs/config.example.yaml` 是旧版参考文件，当前代码不会读取 YAML 配置。

复制环境变量模板：

```bash
# Linux / macOS
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

后端的 `dev`、`start`、`worker` 和迁移脚本都会自动加载 `backend/.env`。推荐配置如下：

```dotenv
DATABASE_URL=postgres://huobao:huobao@localhost:5432/huobao_drama
DATABASE_POOL_SIZE=20
DATABASE_IDLE_TIMEOUT=20
DATABASE_CONNECT_TIMEOUT=10

REDIS_URL=redis://localhost:6379
QUEUE_JOB_ATTEMPTS=1
IMAGE_WORKER_CONCURRENCY=4
VIDEO_WORKER_CONCURRENCY=2
MEDIA_WORKER_CONCURRENCY=2

PORT=5679
STORAGE_PATH=../data/static
AUTH_JWT_SECRET=请替换为至少32字节的随机字符串
AUTH_JWT_EXPIRES_IN_SECONDS=604800
```

可使用 Node.js 生成生产 JWT 密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

注意事项：

- 生产环境必须修改 `AUTH_JWT_SECRET`，并保证所有 API 实例使用同一个值。
- `STORAGE_PATH` 默认指向仓库根目录的 `data/static`；该目录保存生成的图片、音频和视频。
- 第一个注册的账号会成为管理员，AI 服务配置、Agent 配置和 Skill 管理仅管理员可操作。
- API Key 只应填写到系统设置中，不要提交到 `.env`、README 或 Git。

### 📥 安装依赖

项目根目录没有统一 `package.json`，前后端必须分别安装：

```bash
git clone https://github.com/GutsLin/TPG_DuanJuAI.git
cd TPG_DuanJuAI

npm --prefix backend ci
npm --prefix frontend ci
```

仓库包含 `backend/package-lock.json` 和 `frontend/package-lock.json`，常规安装与服务器部署应优先使用 `npm ci`。只有主动升级依赖并准备更新 lockfile 时才使用 `npm install`。

### 🎯 启动项目

#### 开发模式

先准备 `backend/.env`，再从仓库根目录启动以下服务：

```bash
# 终端 1：启动 PostgreSQL 和 Redis
docker compose up -d postgres redis

# 终端 2：启动 API，支持热重载
npm --prefix backend run dev

# 终端 3：启动 BullMQ Worker
npm --prefix backend run worker

# 终端 4：启动 Nuxt 开发服务器
npm --prefix frontend run dev
```

服务地址：

- 前端：`http://localhost:3013`
- API：`http://localhost:5679/api/v1`
- 健康检查：`http://localhost:5679/api/v1/health`
- 媒体文件：`http://localhost:5679/static/*`

Nuxt 开发服务器会把 `/api` 和 `/static` 代理到 `localhost:5679`。后端启动时自动执行 Drizzle migrations，无需首次手动建表。

#### 本地生产模式

Nuxt 的实际静态输出是 `frontend/.output/public`，而 Hono 生产服务读取 `frontend/dist`，因此非 Docker 构建需要显式复制：

```bash
npm --prefix frontend run generate
rm -rf frontend/dist
cp -R frontend/.output/public frontend/dist

# 分别保持两个进程运行
npm --prefix backend start
npm --prefix backend run worker
```

Windows PowerShell 的复制命令：

```powershell
npm --prefix frontend run generate
Remove-Item frontend/dist -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item frontend/.output/public frontend/dist -Recurse
```

生产页面和 API 统一通过 `http://localhost:5679` 提供。

### 🗄️ 数据库与队列

API 和 Worker 启动时都会自动执行 PostgreSQL migrations。也可以单独执行：

```bash
npm --prefix backend run db:migrate
```

从旧版 SQLite 迁移数据时使用专用脚本：

```bash
cd backend
SQLITE_DB_PATH=../data/huobao_drama.db \
DATABASE_URL=postgres://huobao:huobao@localhost:5432/huobao_drama \
npm run db:migrate:sqlite
```

如需在迁移前清空 PostgreSQL 目标表，额外设置 `MIGRATION_TRUNCATE=true`。`better-sqlite3` 仅为这个兼容迁移脚本保留，当前业务数据全部使用 PostgreSQL。

登录后可通过 `GET /api/v1/queues/status` 查看队列状态。

---

## 📦 部署指南

生产环境建议使用同源部署：Nginx 只代理 Hono 的 `5679` 端口，由 Hono 同时提供前端、API 和 `/static` 文件。这样不需要额外配置跨域。

### 🐳 Docker Compose 部署（推荐）

当前 `docker-compose.yml` 会启动四个服务：

| 服务 | 作用 | 持久化 |
|---|---|---|
| `huobao-drama` | Hono API + 前端静态文件 | `./data:/app/data` |
| `worker` | BullMQ 图片、视频、合成和拼接任务 | 与 API 共享 `./data` |
| `postgres` | PostgreSQL 17 | `postgres_data` volume |
| `redis` | Redis 7 AOF | `redis_data` volume |

首次部署：

```bash
git clone https://github.com/GutsLin/TPG_DuanJuAI.git
cd TPG_DuanJuAI

# Compose 会读取仓库根目录的 .env，此处只放 Compose 插值变量
cat > .env <<EOF
AUTH_JWT_SECRET=$(openssl rand -hex 32)
AUTH_JWT_EXPIRES_IN_SECONDS=604800
EOF

docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5679/api/v1/health
```

Windows 用户可以手动创建根目录 `.env`：

```dotenv
AUTH_JWT_SECRET=使用随机生成的长字符串
AUTH_JWT_EXPIRES_IN_SECONDS=604800
```

常用运维命令：

```bash
# 查看所有服务日志
docker compose logs -f

# 单独查看 API 或 Worker
docker compose logs -f huobao-drama
docker compose logs -f worker

# 拉取代码并重新构建
git pull
docker compose up -d --build

# 停止服务，但保留数据库和 Redis volume
docker compose down
```

不要使用 `docker compose down -v`，除非明确要删除 PostgreSQL 和 Redis 数据。业务媒体存放在宿主机 `data/`，数据库存放在 Docker named volume，二者都需要独立备份。

Docker 镜像已包含 FFmpeg、后端运行依赖、`skills/` 和前端静态文件。AI 服务与模型仍需在首次登录后进入「设置」配置。

#### 容器访问宿主机模型服务

在 Docker Desktop 中，Base URL 可填写 `http://host.docker.internal:端口/v1`。Linux 如需访问宿主机服务，可在 `huobao-drama` 和 `worker` 服务中增加：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

模型服务必须监听宿主机可访问地址，不能只监听容器不可达的回环地址。

### ☁️ 云服务器部署脚本

仓库提供 `scripts/deploy.sh`，适合从 Linux、macOS、WSL 或 Git Bash 通过 SSH 将当前工作区同步到 Docker 云服务器。服务器需预先安装 Docker Compose、`curl`、`tar`，部署用户需要 `sudo docker` 权限。

首次使用前需要在服务器创建部署目录和根目录 `.env`。该文件不会由部署脚本上传：

```bash
mkdir -p /home/ubuntu/TPG_DuanJuAI
cd /home/ubuntu/TPG_DuanJuAI
cat > .env <<EOF
AUTH_JWT_SECRET=$(openssl rand -hex 32)
AUTH_JWT_EXPIRES_IN_SECONDS=604800
EOF
```

```bash
# 首次执行会交互生成 scripts/deploy.config.local.sh
# 新服务器首次部署还需要上传 Dockerfile 和 docker-compose.yml
bash scripts/deploy.sh --with-infra

# 后续常规部署会保留服务器定制的基础设施文件
bash scripts/deploy.sh

# 跳过确认
bash scripts/deploy.sh -y

# 仅上传代码，不构建和重启
bash scripts/deploy.sh --dry-run

# 同时覆盖服务器定制的 Dockerfile 和 docker-compose.yml
bash scripts/deploy.sh --with-infra
```

默认情况下脚本会保留服务器上的 `Dockerfile` 和 `docker-compose.yml`，部署前备份服务器代码到 `~/deploy-backups`，只保留最近 5 份，并在重启后检查 `/api/v1/health`。

`scripts/deploy.config.local.sh` 包含服务器密码，已被 Git 忽略，不得提交。代码备份不包含 `data/` 和 PostgreSQL 数据，生产环境仍需单独配置媒体与数据库备份。

### 🏭 非 Docker 部署

服务器必须先提供 Node.js 20+、PostgreSQL、Redis、FFmpeg 和 Nginx。

```bash
git clone https://github.com/GutsLin/TPG_DuanJuAI.git /opt/TPG_DuanJuAI
cd /opt/TPG_DuanJuAI

npm --prefix backend ci
npm --prefix frontend ci
cp backend/.env.example backend/.env
# 编辑 backend/.env，填写生产数据库、Redis、JWT 和存储路径

npm --prefix frontend run generate
rm -rf frontend/dist
cp -R frontend/.output/public frontend/dist
npm --prefix backend run db:migrate
```

API 和 Worker 是两个独立的常驻进程。可以使用 PM2 管理：

```bash
sudo npm install -g pm2
cd /opt/TPG_DuanJuAI

pm2 start npm --name huobao-api -- --prefix backend start
pm2 start npm --name huobao-worker -- --prefix backend run worker
pm2 save
pm2 startup
```

确认 `pm2 startup` 输出的命令已执行，然后检查：

```bash
pm2 status
curl http://127.0.0.1:5679/api/v1/health
```

#### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:5679;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

生产环境应继续配置 HTTPS。Vidu 等依赖回调的服务还需要确保公网可以访问 `/webhooks/*`。

如果把前端和 API 部署到不同域名，需要同步修改 `backend/src/index.ts` 中的 CORS 来源；当前默认只允许本地开发地址，同源生产部署不受影响。

---

## 🎨 技术栈

### 后端

- **运行时**: Node.js 20+
- **Web 框架**: Hono
- **ORM**: Drizzle ORM + PostgreSQL
- **任务队列**: BullMQ + Redis（图片、视频、合成和拼接并发处理）
- **AI Agent**: Mastra + AI SDK (OpenAI compatible)
- **视频处理**: FFmpeg (fluent-ffmpeg)
- **图片处理**: Sharp

### 前端

- **框架**: Nuxt 3 (SPA 模式)
- **语言**: Vue 3 + TypeScript
- **路由**: 文件路由 (Vue Router 4)
- **样式**: 纯 CSS + CSS Variables（浅色工作台主题）
- **图标**: Lucide Vue

---

## 📝 常见问题

### Q: Docker 容器如何访问宿主机的 Ollama？

A: 使用 `http://host.docker.internal:11434/v1` 作为 Base URL。注意：

1. 宿主机 Ollama 需监听 `0.0.0.0`：`export OLLAMA_HOST=0.0.0.0:11434 && ollama serve`
2. Linux 用户需按部署章节给 `huobao-drama` 和 `worker` 增加 `host.docker.internal:host-gateway`

### Q: FFmpeg 未安装或找不到？

A: 确保 FFmpeg 已安装并在 PATH 环境变量中。运行 `ffmpeg -version` 验证。Docker 部署已内置 FFmpeg。

### Q: 前端无法连接后端 API？

A: 检查后端是否启动，端口是否正确。开发模式下前端代理配置在 `frontend/nuxt.config.ts`。

### Q: 任务一直显示排队中？

A: 检查 BullMQ Worker 和 Redis。开发环境必须单独运行 `npm --prefix backend run worker`；Docker 环境使用 `docker compose logs -f worker` 查看错误。

### Q: 数据库表未创建？

A: API 和 Worker 启动时都会自动执行 `backend/drizzle/` 中的 migrations。确认 `DATABASE_URL` 可连接，或手动运行 `npm --prefix backend run db:migrate` 查看错误。

---

## 📋 更新日志

### 2026-07

- 完成 TypeScript 全栈架构升级：Hono、Drizzle ORM、PostgreSQL、BullMQ、Nuxt 3 与 Vue 3
- 增加用户登录、全局角色、项目成员权限和操作日志
- 完善素材库、任务状态持久化、本地存储与阿里云 OSS 配置
- 扩展图片、视频、TTS 多厂商适配器及 OpenAI 兼容视频接口
- 优化单集工作台、角色与场景提取、分镜编辑、配音、视频生成和合成导出流程
- 支持编辑并保存提取后的人设描写，视频生成仅携带角色人设图和场景图
- 增加图片、视频和语音模型调用日志，展示请求地址、状态码、耗时及脱敏后的错误正文
- 增加 Docker 云服务器部署脚本、代码备份和部署后健康检查

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=GutsLin/TPG_DuanJuAI&type=date&legend=top-left)](https://www.star-history.com/#GutsLin/TPG_DuanJuAI&type=date&legend=top-left)
Made with ❤️ by 调皮狗短剧

</div>
