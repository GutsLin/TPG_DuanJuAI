import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, finalizeMedia, isRemoteUrl, readImageAsCompressedDataUrl } from '../utils/storage.js'
import { getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { enqueueVideoGeneration } from '../queue/jobs.js'
import { getStoryboardAssetContext, registerAsset } from './asset-register.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { recordModelCall } from './model-call-log.js'

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  duration?: number
  aspectRatio?: string
  configId?: number
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const ts = now()
  const config = params.configId
    ? await getConfigById(params.configId)
    : await getActiveConfig('video')
  if (!config) throw new Error('No active video AI config')

  const [inserted] = await db.insert(schema.videoGenerations).values({
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    configId: config.id,
    prompt: params.prompt,
    model: params.model || config.model,
    provider: config.provider,
    referenceMode: params.referenceMode || 'none',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls ? JSON.stringify(params.referenceImageUrls) : null,
    duration: params.duration || 5,
    aspectRatio: params.aspectRatio || '16:9',
    status: 'queued',
    createdAt: ts,
    updatedAt: ts,
  }).returning({ id: schema.videoGenerations.id })

  const lastId = inserted.id
  logTaskStart('VideoTask', 'enqueue', {
    id: lastId,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'none',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id: lastId,
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })
  try {
    await enqueueVideoGeneration(lastId)
  } catch (err: any) {
    await db.update(schema.videoGenerations)
      .set({ status: 'failed', errorMsg: `Queue error: ${err.message}`, updatedAt: now() })
      .where(eq(schema.videoGenerations.id, lastId))
    throw err
  }
  return lastId
}

export async function processVideoGeneration(id: number) {
  try {
    const rows = await db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id))
    const record = rows[0]
    if (!record) return
    const config = record.configId
      ? await getConfigById(record.configId)
      : await getActiveConfig('video')
    if (!config) throw new Error('Video AI config not found')
    const adapter = getVideoAdapter(config.provider)
    await db.update(schema.videoGenerations)
      .set({ status: 'processing', errorMsg: null, updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
    logTaskProgress('VideoTask', 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      referenceMode: record.referenceMode,
    })

    const resolvedImageUrl = await normalizeVideoReferenceUrl(record.imageUrl)
    const resolvedFirstFrameUrl = await normalizeVideoReferenceUrl(record.firstFrameUrl)
    const resolvedLastFrameUrl = await normalizeVideoReferenceUrl(record.lastFrameUrl)
    const resolvedReferenceImageUrls = await normalizeVideoReferenceUrls(record.referenceImageUrls)

    // 使用 Adapter 构建请求
    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      id: record.id,
      model: record.model,
      prompt: record.prompt,
      referenceMode: record.referenceMode,
      imageUrl: resolvedImageUrl,
      firstFrameUrl: resolvedFirstFrameUrl,
      lastFrameUrl: resolvedLastFrameUrl,
      referenceImageUrls: resolvedReferenceImageUrls ? JSON.stringify(resolvedReferenceImageUrls) : null,
      duration: record.duration,
      aspectRatio: record.aspectRatio,
    })
    logTaskProgress('VideoTask', 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
      referenceMode: record.referenceMode,
    })
    logTaskPayload('VideoTask', 'request payload', {
      id,
      method,
      url,
      headers,
      body,
    })

    const callStartedAt = Date.now()
    let resp: Response | undefined
    let callLogged = false
    let generateResponse: ReturnType<typeof adapter.parseGenerateResponse>
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errorText = await resp.text()
        await recordModelCall({
          dramaId: record.dramaId,
          kind: 'video',
          outcome: 'error',
          provider: config.provider,
          model: record.model,
          method,
          url,
          status: resp.status,
          durationMs: Date.now() - callStartedAt,
          error: errorText,
          resourceType: 'video_generation',
          resourceId: id,
        })
        callLogged = true
        throw new Error(`API error ${resp.status}: ${errorText}`)
      }

      const result = await resp.json() as any
      generateResponse = adapter.parseGenerateResponse(result)
      await recordModelCall({
        dramaId: record.dramaId,
        kind: 'video',
        outcome: 'success',
        provider: config.provider,
        model: record.model,
        method,
        url,
        status: resp.status,
        durationMs: Date.now() - callStartedAt,
        resourceType: 'video_generation',
        resourceId: id,
      })
      callLogged = true
    } catch (error) {
      if (!callLogged) {
        await recordModelCall({
          dramaId: record.dramaId,
          kind: 'video',
          outcome: 'error',
          provider: config.provider,
          model: record.model,
          method,
          url,
          status: resp?.status,
          durationMs: Date.now() - callStartedAt,
          error,
          resourceType: 'video_generation',
          resourceId: id,
        })
      }
      throw error
    }

    const { isAsync, taskId, videoUrl } = generateResponse

    if (!isAsync && videoUrl) {
      logTaskProgress('VideoTask', 'sync-complete', { id, videoUrl })
      // 同步模式
      await handleVideoComplete(id, videoUrl, record.duration)
      return
    }

    // 异步模式：更新 taskId，开始轮询
    await db.update(schema.videoGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))

    logTaskProgress('VideoTask', 'poll-start', { id, taskId, provider: config.provider })

    // Vidu 没有轮询端点，跳过轮询（依赖 Webhook 回调）
    if (adapter.provider === 'vidu') {
      logTaskProgress('VideoTask', 'webhook-wait', { id, taskId, provider: adapter.provider })
      return
    }

    await pollVideoTask(id, config, taskId!, record.storyboardId, record.dramaId, record.model)
  } catch (err: any) {
    logTaskError('VideoTask', 'process', { id, error: err.message })
    await db.update(schema.videoGenerations)
      .set({ status: 'failed', errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
    throw err
  }
}

async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      return await readImageAsCompressedDataUrl(localPath, {
        maxWidth: 768,
        maxHeight: 768,
        quality: 68,
      })
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoReferenceUrls(raw: string | null | undefined): Promise<string[]> {
  if (!raw) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

async function pollVideoTask(
  id: number,
  config: AIConfig,
  taskId: string,
  storyboardId?: number | null,
  dramaId?: number | null,
  model?: string | null,
) {
  const adapter = getVideoAdapter(config.provider)

  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 10000))
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress('VideoTask', 'poll-request', {
        id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const callStartedAt = Date.now()
      let resp: Response | undefined
      let callLogged = false
      try {
        resp = await fetch(url, { method, headers, signal: AbortSignal.timeout(30_000) })
        if (!resp.ok) {
          const errorText = await resp.text()
          await recordModelCall({
            dramaId,
            kind: 'video',
            phase: 'poll',
            outcome: 'error',
            provider: config.provider,
            model,
            method,
            url,
            status: resp.status,
            durationMs: Date.now() - callStartedAt,
            error: errorText,
            resourceType: 'video_generation',
            resourceId: id,
          })
          callLogged = true
          continue
        }
        const result = await resp.json() as any

        const pollResp = adapter.parsePollResponse(result)

        if (pollResp.status === 'completed' && pollResp.videoUrl) {
          await recordModelCall({
            dramaId,
            kind: 'video',
            phase: 'poll',
            outcome: 'success',
            provider: config.provider,
            model,
            method,
            url,
            status: resp.status,
            durationMs: Date.now() - callStartedAt,
            resourceType: 'video_generation',
            resourceId: id,
          })
          callLogged = true
          logTaskSuccess('VideoTask', 'poll-complete', { id, taskId, videoUrl: pollResp.videoUrl })
          await handleVideoComplete(id, pollResp.videoUrl, null, storyboardId)
          return
        }
        if (pollResp.status === 'failed') {
          const errorMessage = pollResp.error || 'Video generation failed'
          await recordModelCall({
            dramaId,
            kind: 'video',
            phase: 'poll',
            outcome: 'error',
            provider: config.provider,
            model,
            method,
            url,
            status: resp.status,
            durationMs: Date.now() - callStartedAt,
            error: errorMessage,
            resourceType: 'video_generation',
            resourceId: id,
          })
          callLogged = true
          logTaskError('VideoTask', 'poll-failed', { id, taskId, error: errorMessage })
          throw new Error(errorMessage)
        }
      } catch (error) {
        if (!callLogged) {
          await recordModelCall({
            dramaId,
            kind: 'video',
            phase: 'poll',
            outcome: 'error',
            provider: config.provider,
            model,
            method,
            url,
            status: resp?.status,
            durationMs: Date.now() - callStartedAt,
            error,
            resourceType: 'video_generation',
            resourceId: id,
          })
        }
        throw error
      }
    } catch (err: any) {
      if (i === 299) {
        logTaskError('VideoTask', 'poll-timeout', { id, taskId, error: err.message })
        await db.update(schema.videoGenerations)
          .set({ status: 'failed', errorMsg: `Timeout: ${err.message}`, updatedAt: now() })
          .where(eq(schema.videoGenerations.id, id))

        throw err
      }
      logTaskWarn('VideoTask', 'poll-retry', { id, taskId, attempt: i + 1, error: err.message })
    }
  }
}

async function handleVideoComplete(id: number, videoUrl: string, duration: number | null | undefined, storyboardId?: number | null) {
  const localPath = await downloadFile(videoUrl, 'videos')
  const finalUrl = await finalizeMedia(localPath)
  await db.update(schema.videoGenerations)
    .set({ videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))

  logTaskSuccess('VideoTask', 'downloaded', { id, localPath, storyboardId, duration })

  if (storyboardId) {
    await db.update(schema.storyboards)
      .set({ videoUrl: finalUrl, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))

  }

  // 注册素材库（容错，不阻断主流程）
  const [record] = await db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id))
  const effectiveStoryboardId = storyboardId ?? record?.storyboardId ?? null
  let episodeId: number | null = null
  let storyboardNum: number | null = null
  let dramaId = record?.dramaId ?? null
  if (effectiveStoryboardId) {
    const ctx = await getStoryboardAssetContext(effectiveStoryboardId)
    if (ctx) {
      episodeId = ctx.episodeId
      storyboardNum = ctx.storyboardNum
      dramaId = dramaId ?? ctx.dramaId
    }
  }
  await registerAsset({
    type: 'video',
    category: 'generated_video',
    source: 'ai',
    dramaId,
    episodeId,
    storyboardId: effectiveStoryboardId,
    storyboardNum,
    name: (record?.prompt || '').slice(0, 40) || `video-${id}`,
    description: record?.prompt,
    url: isRemoteUrl(finalUrl) ? finalUrl : `/${localPath}`,
    localPath,
    duration: duration ?? record?.duration ?? null,
    videoGenId: id,
  })
}
