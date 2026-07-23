/**
 * 素材库注册 — AI 产物 / 上传文件统一写入 assets 表
 * 约定：url 一律带前导斜杠（可直接作 <img src>），localPath 不带
 * 容错：注册失败不阻断主流程，仅记录日志并返回 null
 */
import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getAbsolutePath } from '../utils/storage.js'
import { logTaskError } from '../utils/task-logger.js'

export interface RegisterAssetParams {
  dramaId?: number | null
  episodeId?: number | null
  storyboardId?: number | null
  storyboardNum?: number | null
  name?: string | null
  description?: string | null
  type: 'image' | 'video' | 'audio' | string
  category: string
  url: string
  thumbnailUrl?: string | null
  localPath?: string | null
  fileSize?: number | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  duration?: number | null
  format?: string | null
  imageGenId?: number | null
  videoGenId?: number | null
  source?: 'ai' | 'upload'
}

/** localPath：去掉前导斜杠，保持 static/<sub>/<file> 形式 */
export function normalizeLocalPath(value: string | null | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  return raw.startsWith('/') ? raw.slice(1) : raw
}

/** url：保证带前导斜杠 */
export function normalizeAssetUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw  // 云存储绝对 URL 原样透传
  return raw.startsWith('/') ? raw : `/${raw}`
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/x-m4a',
  '.aac': 'audio/aac',
}

/**
 * 插入一条 assets 行；失败时记日志并返回 null（绝不抛出）
 */
export async function registerAsset(params: RegisterAssetParams) {
  try {
    const localPath = normalizeLocalPath(params.localPath ?? params.url)
    const url = normalizeAssetUrl(params.url ?? localPath)
    if (!url) return null

    let fileSize = params.fileSize ?? null
    let mimeType = params.mimeType ?? null
    let format = params.format ?? null

    if (localPath && localPath.startsWith('static/')) {
      const ext = path.extname(localPath).toLowerCase()
      format = format || (ext ? ext.slice(1) : null)
      mimeType = mimeType || EXT_MIME[ext] || null
      if (fileSize == null) {
        try {
          fileSize = fs.statSync(getAbsolutePath(localPath)).size
        } catch {
          // 文件可能尚未落盘，忽略
        }
      }
    }

    const ts = now()
    const [row] = await db.insert(schema.assets).values({
      dramaId: params.dramaId ?? null,
      episodeId: params.episodeId ?? null,
      storyboardId: params.storyboardId ?? null,
      storyboardNum: params.storyboardNum ?? null,
      name: params.name ?? null,
      description: params.description ?? null,
      type: params.type,
      category: params.category,
      url,
      thumbnailUrl: params.thumbnailUrl ?? null,
      localPath,
      fileSize,
      mimeType,
      width: params.width ?? null,
      height: params.height ?? null,
      duration: params.duration ?? null,
      format,
      imageGenId: params.imageGenId ?? null,
      videoGenId: params.videoGenId ?? null,
      source: params.source ?? 'ai',
      createdAt: ts,
      updatedAt: ts,
    }).returning()
    return row
  } catch (err: any) {
    logTaskError('AssetRegister', 'register', {
      error: err?.message,
      type: params.type,
      category: params.category,
      url: params.url,
    })
    return null
  }
}

/**
 * 经 storyboard 反查素材上下文（episodeId / dramaId / storyboardNum）
 */
export async function getStoryboardAssetContext(storyboardId: number | null | undefined) {
  if (!storyboardId) return null
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb) return null
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
  return {
    storyboardId,
    storyboardNum: sb.storyboardNumber,
    episodeId: sb.episodeId,
    dramaId: ep?.dramaId ?? null,
  }
}
