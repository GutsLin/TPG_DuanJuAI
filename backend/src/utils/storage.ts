/**
 * 文件存储工具 — 下载远程文件到本地
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import OSS from 'ali-oss'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { logTaskError, logTaskSuccess } from './task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

/**
 * 下载远程文件到本地存储
 */
export async function downloadFile(url: string, subDir: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const ext = getExtFromUrl(url)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)

  const buffer = Buffer.from(await resp.arrayBuffer())
  fs.writeFileSync(filePath, buffer)

  // 返回相对路径（供 API 返回给前端）
  return `static/${subDir}/${filename}`
}

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  fs.writeFileSync(filePath, Buffer.from(data))
  return `static/${subDir}/${filename}`
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return '.bin'
}

/**
 * 获取本地文件的绝对路径
 */
export function getAbsolutePath(relativePath: string): string {
  if (relativePath.startsWith('static/')) {
    return path.join(STORAGE_ROOT, '..', relativePath)
  }
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 保存 Base64 编码的图片数据到本地存储
 * 用于 Gemini 等只返回 base64 数据的厂商
 */
export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  // 从 mimeType 推断文件扩展名
  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)

  return `static/${subDir}/${filename}`
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const filePath = getAbsolutePath(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(filePath).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const mimeType = 'image/jpeg'
  return `data:${mimeType};base64,${output.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}

/* ================= 云存储（阿里云 OSS）写穿层 =================
 * 无生效 OSS 配置：finalizeMedia 原样返回相对路径，系统行为与纯本地存储一致
 * 有生效 OSS 配置：新落盘文件同步上传 OSS，业务字段改写为绝对 URL；任何失败降级回本地相对路径
 */

export type StorageConfig = typeof schema.storageConfigs.$inferSelect

export interface OssConfigLike {
  bucket?: string | null
  endpoint?: string | null
  accessKeyId?: string | null
  accessKeySecret?: string | null
  domain?: string | null
  prefix?: string | null
}

export function isRemoteUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(value || '').trim())
}

const CONFIG_CACHE_TTL_MS = 60_000
let configCache: { value: StorageConfig | null; expiresAt: number } | null = null

/**
 * 读取当前生效的存储配置（进程内缓存 60s TTL）
 * 表不存在 / 查询失败 / 无生效行 / 生效行 provider=local → 返回 null（本地存储模式）
 */
export async function getActiveStorageConfig(): Promise<StorageConfig | null> {
  const nowTs = Date.now()
  if (configCache && configCache.expiresAt > nowTs) return configCache.value
  let value: StorageConfig | null = null
  try {
    const rows = await db.select().from(schema.storageConfigs).where(eq(schema.storageConfigs.isActive, true))
    const row = rows[0]
    if (row && row.provider === 'aliyun-oss') value = row
  } catch {
    // storage_configs 表尚未迁移或查询失败：视为本地模式
    value = null
  }
  configCache = { value, expiresAt: nowTs + CONFIG_CACHE_TTL_MS }
  return value
}

function createOssClient(config: OssConfigLike, timeoutMs = 60_000): OSS {
  const bucket = (config.bucket || '').trim()
  const endpointRaw = (config.endpoint || '').trim()
  const accessKeyId = (config.accessKeyId || '').trim()
  const accessKeySecret = (config.accessKeySecret || '').trim()
  if (!bucket || !endpointRaw || !accessKeyId || !accessKeySecret) {
    throw new Error('OSS 配置不完整（bucket / endpoint / access_key_id / access_key_secret 必填）')
  }
  const endpoint = /^https?:\/\//i.test(endpointRaw) ? endpointRaw : `https://${endpointRaw}`
  return new OSS({ bucket, endpoint, accessKeyId, accessKeySecret, timeout: timeoutMs })
}

function buildOssKey(config: OssConfigLike, relPath: string): string {
  const rel = relPath.replace(/^\/+/, '')
  let prefix = (config.prefix || '').trim().replace(/^\/+/, '')
  if (prefix && !prefix.endsWith('/')) prefix += '/'
  return prefix + rel
}

function buildOssUrl(config: OssConfigLike, key: string): string {
  const domain = (config.domain || '').trim().replace(/\/+$/, '')
  if (domain) {
    const base = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
    return `${base}/${key}`
  }
  const endpointHost = (config.endpoint || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return `https://${(config.bucket || '').trim()}.${endpointHost}/${key}`
}

/**
 * 写穿落库前的最终化：
 * - 无生效 OSS 配置 → 原样返回 relPath
 * - 有 → 读本地文件上传 OSS（key = prefix + relPath，保留 static/ 目录结构），返回绝对 URL
 * - 任何失败 → 记日志并返回原 relPath（降级，不阻断主流程）
 */
export async function finalizeMedia(relPath: string): Promise<string> {
  const rel = String(relPath || '').trim().replace(/^\/+/, '')
  if (!rel) return relPath
  const config = await getActiveStorageConfig()
  if (!config) return rel
  try {
    const localAbs = getAbsolutePath(rel)
    const key = buildOssKey(config, rel)
    const client = createOssClient(config)
    await client.put(key, localAbs)
    const url = buildOssUrl(config, key)
    logTaskSuccess('Storage', 'oss-write-through', { path: rel, url })
    return url
  } catch (err: any) {
    logTaskError('Storage', 'oss-write-through-failed', { path: rel, error: err?.message })
    return rel
  }
}

/**
 * 取本地绝对路径：
 * - http(s) 输入 → URL 内含 static/ 相对路径且本地有写穿副本时直接复用；
 *   否则下载到 static/cache/<sha1(url)><ext>（已存在直接复用）
 * - 相对路径（static/... 或子目录相对）→ getAbsolutePath
 */
export async function ensureLocal(urlOrPath: string): Promise<string> {
  const raw = String(urlOrPath || '').trim()
  if (!raw) throw new Error('ensureLocal: empty path')
  if (isRemoteUrl(raw)) {
    try {
      const pathname = new URL(raw).pathname
      const idx = pathname.indexOf('static/')
      if (idx >= 0) {
        const localAbs = getAbsolutePath(pathname.slice(idx))
        if (fs.existsSync(localAbs)) return localAbs
      }
    } catch { /* fall through to download */ }
    const ext = getExtFromUrl(raw)
    const hash = crypto.createHash('sha1').update(raw).digest('hex')
    const dir = path.join(STORAGE_ROOT, 'cache')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${hash}${ext}`)
    if (fs.existsSync(filePath)) return filePath
    const resp = await fetch(raw)
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
    fs.writeFileSync(filePath, Buffer.from(await resp.arrayBuffer()))
    return filePath
  }
  return getAbsolutePath(raw.startsWith('/') ? raw.slice(1) : raw)
}

/**
 * OSS 连接探针：put 一个 <prefix>.probe/<uuid>.txt 再 delete
 * 供 /storage-configs/test 使用；失败抛出带原因的 Error
 */
export async function probeStorageConfig(config: OssConfigLike): Promise<void> {
  const client = createOssClient(config, 15_000)
  const key = buildOssKey(config, `.probe/${uuid()}.txt`)
  await client.put(key, Buffer.from('huobao-storage-probe'))
  await client.delete(key)
}
