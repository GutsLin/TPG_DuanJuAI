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
frontend/   — Nuxt 3 + Vue 3 + TypeScript (纯 CSS，无 UI 框架)
backend/    — Hono + Drizzle ORM + PostgreSQL + BullMQ + Mastra AI Agents
configs/    — config.yaml 配置文件
data/       — 本地生成资源文件
skills/     — Agent 技能定义 (SKILL.md)
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

| 软件 | 版本要求 | 说明 |
|---|---|---|
| **Node.js** | 20+ | 前后端运行环境 |
| **npm** | 9+ | 包管理工具 |
| **FFmpeg** | 4.0+ | 视频处理（**必需**） |

#### 安装 FFmpeg

**macOS:**

```bash
brew install ffmpeg
```

**Ubuntu/Debian:**

```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows:**
从 [FFmpeg 官网](https://ffmpeg.org/download.html) 下载并配置环境变量

验证安装：

```bash
ffmpeg -version
```

### ⚙️ 配置方式（环境变量）

后端运行时配置**全部通过环境变量**注入，`configs/config.yaml` 不会被代码加载（`configs/config.example.yaml` 仅供参考）。

本地开发：复制后端环境变量模板并按需修改，启动脚本会自动加载 `.env`：

```bash
cp backend/.env.example backend/.env
```

`backend/.env` 可用变量：

```bash
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
# 生产环境必须改为长随机字符串
AUTH_JWT_SECRET=change-this-to-a-long-random-secret
AUTH_JWT_EXPIRES_IN_SECONDS=604800
```

> **说明**：AI 服务的具体 API Key 和模型参数在 Web 界面的「设置」页面中配置（存数据库），不在环境变量里。

### 📥 安装依赖

```bash
# 克隆项目
git clone https://github.com/GutsLin/TPG_DuanJuAI.git
cd TPG_DuanJuAI

# 安装后端依赖
cd backend && npm install

# 安装前端依赖
cd ../frontend && npm install
```

### 🎯 启动项目

#### 方式一：开发模式（推荐）

前后端分离，支持热重载：

```bash
# 终端1：启动 PostgreSQL 与 Redis
docker compose up -d postgres redis

# 终端2：启动后端 API
cd backend
npm run dev

# 终端3：启动 BullMQ Worker
cd backend
npm run worker

# 终端4：启动前端
cd frontend
npm run dev
```

- 前端地址: `http://localhost:3013`
- 后端 API: `http://localhost:5679/api/v1`
- 前端自动代理 `/api` 和 `/static` 到后端

#### 方式二：单服务模式

后端同时提供 API 和前端静态文件：

```bash
# 1. 构建前端
cd frontend && npm run generate

# 2. 启动后端
cd ../backend && npm start
```

访问: `http://localhost:5679`

### 🗄️ 数据库

后端启动时会自动执行 Drizzle PostgreSQL migrations。连接和连接池通过环境变量配置：

```bash
DATABASE_URL=postgres://huobao:huobao@localhost:5432/huobao_drama
DATABASE_POOL_SIZE=20
REDIS_URL=redis://localhost:6379
```

从旧 SQLite 数据库迁移现有数据：

```bash
cd backend
DATABASE_URL=postgres://huobao:huobao@localhost:5432/huobao_drama npm run db:migrate
SQLITE_DB_PATH=../data/huobao_drama.db \
DATABASE_URL=postgres://huobao:huobao@localhost:5432/huobao_drama \
npm run db:migrate:sqlite
```

如需先清空 PostgreSQL 目标表，可额外设置 `MIGRATION_TRUNCATE=true`。

批量任务接口与队列监控：

- `POST /api/v1/images/batch`：请求体 `{ "items": [...] }`
- `POST /api/v1/videos/batch`：请求体 `{ "items": [...] }`
- `GET /api/v1/queues/status`：查看 waiting/active/delayed/completed/failed 数量

---

## 📦 部署指南

### 🐳 Docker 部署（推荐）

#### 方式一：Docker Compose（推荐）

```bash
# 必须先生成并注入 JWT 密钥（未设置时 compose 会报错拒绝启动）
export AUTH_JWT_SECRET=$(openssl rand -hex 32)

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

> Windows 用户可用任意长随机字符串，或写入项目根目录的 `.env` 文件（compose 会自动读取）：`AUTH_JWT_SECRET=<长随机字符串>`

#### 方式二：Docker 命令

```bash
# 从 Docker Hub 运行
docker run -d \
  --name huobao-drama \
  -p 5679:5679 \
  -v $(pwd)/data:/app/data \
  -e AUTH_JWT_SECRET=<长随机字符串> \
  --restart unless-stopped \
  huobao/huobao-drama:latest

# 查看日志
docker logs -f huobao-drama
```

> **注意**：Linux 用户需添加 `--add-host=host.docker.internal:host-gateway` 以访问宿主机服务

**本地构建**（可选）：

```bash
docker build -t huobao-drama:latest .
docker run -d --name huobao-drama -p 5679:5679 \
  -v $(pwd)/data:/app/data \
  -e AUTH_JWT_SECRET=<长随机字符串> \
  huobao-drama:latest
```

**Docker 部署优势：**

- ✅ 开箱即用，内置 FFmpeg 和默认配置
- ✅ 前后端合并为单镜像、单端口
- ✅ 环境一致性，避免依赖问题
- ✅ `data/` 目录 volume 挂载，数据持久化

#### 🔗 访问宿主机服务（Ollama / 本地模型）

容器内可通过 `http://host.docker.internal:端口号` 访问宿主机服务。

**配置步骤：**

1. 宿主机启动服务（监听所有接口）：

   ```bash
   export OLLAMA_HOST=0.0.0.0:11434 && ollama serve
   ```

2. 在 Web 界面「设置 → AI 服务配置」中填写：
   - Base URL: `http://host.docker.internal:11434/v1`
   - Provider: `openai`
   - Model: `qwen2.5:latest`

---

### 🏭 传统部署方式

```bash
# 1. 构建前端
cd frontend && npm run generate && cd ..

# 2. 启动后端
cd backend && npm start
```

需要上传到服务器的文件：

```
backend/          # 后端源码 + node_modules + .env（环境变量配置）
frontend/dist/    # 前端构建产物
data/             # 数据目录（首次运行自动创建）
skills/           # Agent 技能文件
```

#### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5679;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

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
- **样式**: 纯 CSS + CSS Variables (暗色主题)
- **图标**: Lucide Vue

---

## 📝 常见问题

### Q: Docker 容器如何访问宿主机的 Ollama？

A: 使用 `http://host.docker.internal:11434/v1` 作为 Base URL。注意：
1. 宿主机 Ollama 需监听 `0.0.0.0`：`export OLLAMA_HOST=0.0.0.0:11434 && ollama serve`
2. Linux 用户使用 `docker run` 需添加：`--add-host=host.docker.internal:host-gateway`

### Q: FFmpeg 未安装或找不到？

A: 确保 FFmpeg 已安装并在 PATH 环境变量中。运行 `ffmpeg -version` 验证。Docker 部署已内置 FFmpeg。

### Q: 前端无法连接后端 API？

A: 检查后端是否启动，端口是否正确。开发模式下前端代理配置在 `frontend/nuxt.config.ts`。

### Q: 数据库表未创建？

A: 后端会在首次启动时自动创建所有表，检查日志确认初始化是否成功。

---

## 📋 更新日志

### 2026-07

- 完成 TypeScript 全栈架构升级：Hono、Drizzle ORM、PostgreSQL、BullMQ、Nuxt 3 与 Vue 3
- 增加用户登录、全局角色、项目成员权限和操作日志
- 完善素材库、任务状态持久化、本地存储与阿里云 OSS 配置
- 扩展图片、视频、TTS 多厂商适配器及 OpenAI 兼容视频接口
- 优化单集工作台、角色与场景提取、分镜编辑、配音、视频生成和合成导出流程
- 支持编辑并保存提取后的人设描写，视频生成仅携带角色人设图和场景图
- 增加 Docker 云服务器部署脚本、代码备份和部署后健康检查

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=GutsLin/TPG_DuanJuAI&type=date&legend=top-left)](https://www.star-history.com/#GutsLin/TPG_DuanJuAI&type=date&legend=top-left)
Made with ❤️ by 调皮狗短剧

</div>
