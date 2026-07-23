import { Hono } from 'hono'
import path from 'path'
import sharp from 'sharp'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { finalizeMedia, isRemoteUrl, saveUploadedFile } from '../utils/storage.js'
import { getDramaIdByEpisodeId, getDramaIdByStoryboardId, requireDramaRole } from '../auth/access.js'

const app = new Hono()

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const IMAGE_MAX_SIZE = 20 * 1024 * 1024 // 20MB
const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac']
const AUDIO_MAX_SIZE = 50 * 1024 * 1024 // 50MB

function toPositiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/**
 * 解析可选的 drama_id / episode_id / storyboard_id 表单字段
 * drama_id 缺失时经 episode / storyboard 反查
 */
async function resolveUploadContext(body: Record<string, unknown>) {
  const storyboardId = toPositiveInt(body['storyboard_id'])
  const episodeId = toPositiveInt(body['episode_id'])
  let dramaId = toPositiveInt(body['drama_id'])
  if (!dramaId && episodeId) dramaId = await getDramaIdByEpisodeId(episodeId)
  if (!dramaId && storyboardId) dramaId = await getDramaIdByStoryboardId(storyboardId)
  return { dramaId, episodeId, storyboardId }
}

async function insertUploadAsset(params: {
  dramaId: number | null
  episodeId: number | null
  storyboardId: number | null
  type: 'image' | 'audio'
  storedPath: string
  publicUrl: string
  fileSize: number
  mimeType: string
  width?: number | null
  height?: number | null
  originalName: string
}) {
  const ts = now()
  const ext = path.extname(params.originalName).replace(/^\./, '').toLowerCase()
  const [asset] = await db.insert(schema.assets).values({
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    storyboardId: params.storyboardId,
    name: params.originalName,
    type: params.type,
    category: 'upload',
    source: 'upload',
    url: params.publicUrl,
    localPath: params.storedPath,
    fileSize: params.fileSize,
    mimeType: params.mimeType,
    width: params.width ?? null,
    height: params.height ?? null,
    format: ext || null,
    createdAt: ts,
    updatedAt: ts,
  }).returning()
  return asset
}

// POST /upload/image
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return badRequest(c, `不支持的图片格式: ${file.type || 'unknown'}，仅支持 jpeg/png/webp/gif`)
  }
  if (file.size > IMAGE_MAX_SIZE) {
    return badRequest(c, '图片大小不能超过 20MB')
  }

  const { dramaId, episodeId, storyboardId } = await resolveUploadContext(body)
  if (dramaId) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  const buffer = await file.arrayBuffer()
  let width: number | null = null
  let height: number | null = null
  try {
    const metadata = await sharp(Buffer.from(buffer)).metadata()
    width = metadata.width ?? null
    height = metadata.height ?? null
  } catch {
    return badRequest(c, '无法解析图片文件，请确认是有效的图片')
  }

  const storedPath = await saveUploadedFile(buffer, 'uploads', file.name)
  const finalUrl = await finalizeMedia(storedPath)
  const publicUrl = isRemoteUrl(finalUrl) ? finalUrl : `/${storedPath}`
  const asset = await insertUploadAsset({
    dramaId, episodeId, storyboardId,
    type: 'image',
    storedPath,
    publicUrl,
    fileSize: file.size,
    mimeType: file.type,
    width, height,
    originalName: file.name,
  })
  return success(c, { url: publicUrl, path: storedPath, asset })
})

// POST /upload/audio
app.post('/audio', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }
  if (!AUDIO_MIME_TYPES.includes(file.type)) {
    return badRequest(c, `不支持的音频格式: ${file.type || 'unknown'}，仅支持 mp3/wav/m4a/aac`)
  }
  if (file.size > AUDIO_MAX_SIZE) {
    return badRequest(c, '音频大小不能超过 50MB')
  }

  const { dramaId, episodeId, storyboardId } = await resolveUploadContext(body)
  if (dramaId) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  const buffer = await file.arrayBuffer()
  const storedPath = await saveUploadedFile(buffer, 'uploads', file.name)
  const finalUrl = await finalizeMedia(storedPath)
  const publicUrl = isRemoteUrl(finalUrl) ? finalUrl : `/${storedPath}`
  const asset = await insertUploadAsset({
    dramaId, episodeId, storyboardId,
    type: 'audio',
    storedPath,
    publicUrl,
    fileSize: file.size,
    mimeType: file.type,
    originalName: file.name,
  })
  return success(c, { url: publicUrl, path: storedPath, asset })
})

export default app
