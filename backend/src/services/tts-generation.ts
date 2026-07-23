/**
 * TTS 语音合成服务
 * 支持 MiniMax TTS (hex 音频响应) 和 OpenAI 兼容 /audio/speech
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { getAudioConfigById } from './ai.js'
import { getTTSAdapter } from './adapters/registry.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, redactUrl } from '../utils/task-logger.js'
import { registerAsset } from './asset-register.js'
import { finalizeMedia, isRemoteUrl } from '../utils/storage.js'
import { recordModelCall } from './model-call-log.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

const AUDIO_MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
}

interface TTSParams {
  text: string
  voice: string
  model?: string
  speed?: number
  emotion?: string
  configId?: number | null
  /** 可选 storyboard 上下文：提供时生成成功后自动注册素材库 */
  storyboardId?: number | null
  episodeId?: number | null
  dramaId?: number | null
}

/**
 * 生成 TTS 音频，返回本地文件路径
 */
export async function generateTTS(params: TTSParams): Promise<string> {
  const config = await getAudioConfigById(params.configId)
  const adapter = getTTSAdapter(config.provider)

  logTaskStart('AudioTask', 'tts-generate', {
    provider: config.provider,
    voice: params.voice,
    model: params.model || config.model,
    textPreview: params.text.slice(0, 50),
    textLength: params.text.length,
  })
  logTaskPayload('AudioTask', 'tts params', {
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })

  const { url, method, headers, body } = adapter.buildGenerateRequest(config, params)
  logTaskProgress('AudioTask', 'request', {
    provider: config.provider,
    voice: params.voice,
    method,
    url: redactUrl(url),
    model: params.model || config.model,
  })
  logTaskPayload('AudioTask', 'request payload', {
    method,
    url,
    headers,
    body,
  })

  const callStartedAt = Date.now()
  let resp: Response | undefined
  let callLogged = false
  let parsed: ReturnType<typeof adapter.parseResponse>
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      await recordModelCall({
        dramaId: params.dramaId,
        kind: 'audio',
        outcome: 'error',
        provider: config.provider,
        model: params.model || config.model,
        method,
        url,
        status: resp.status,
        durationMs: Date.now() - callStartedAt,
        error: errText,
        resourceType: params.storyboardId ? 'storyboard' : 'audio_generation',
        resourceId: params.storyboardId ?? params.episodeId ?? params.dramaId ?? 'unscoped',
      })
      callLogged = true
      logTaskError('AudioTask', 'tts-generate', { provider: config.provider, voice: params.voice, status: resp.status, error: errText })
      throw new Error(`TTS API error ${resp.status}: ${errText}`)
    }

    const result = await resp.json()
    parsed = adapter.parseResponse(result)
    await recordModelCall({
      dramaId: params.dramaId,
      kind: 'audio',
      outcome: 'success',
      provider: config.provider,
      model: params.model || config.model,
      method,
      url,
      status: resp.status,
      durationMs: Date.now() - callStartedAt,
      resourceType: params.storyboardId ? 'storyboard' : 'audio_generation',
      resourceId: params.storyboardId ?? params.episodeId ?? params.dramaId ?? 'unscoped',
    })
    callLogged = true
  } catch (error) {
    if (!callLogged) {
      await recordModelCall({
        dramaId: params.dramaId,
        kind: 'audio',
        outcome: 'error',
        provider: config.provider,
        model: params.model || config.model,
        method,
        url,
        status: resp?.status,
        durationMs: Date.now() - callStartedAt,
        error,
        resourceType: params.storyboardId ? 'storyboard' : 'audio_generation',
        resourceId: params.storyboardId ?? params.episodeId ?? params.dramaId ?? 'unscoped',
      })
    }
    throw error
  }

  // 将 hex 解码为二进制
  const buffer = Buffer.from(parsed.audioHex, 'hex')

  // 保存到本地
  const audioDir = path.join(STORAGE_ROOT, 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const filename = `${uuid()}.${parsed.format || 'mp3'}`
  const filePath = path.join(audioDir, filename)
  fs.writeFileSync(filePath, buffer)

  const relativePath = `static/audio/${filename}`
  const finalUrl = await finalizeMedia(relativePath)
  logTaskSuccess('AudioTask', 'tts-saved', {
    provider: config.provider,
    voice: params.voice,
    path: relativePath,
    bytes: buffer.length,
    audioMs: parsed.audioLength,
  })

  // 有 storyboard 上下文时注册素材库（compose 内联/试听等无上下文调用自动跳过）
  if (params.storyboardId) {
    const format = parsed.format || 'mp3'
    await registerAsset({
      type: 'audio',
      category: 'tts',
      source: 'ai',
      dramaId: params.dramaId ?? null,
      episodeId: params.episodeId ?? null,
      storyboardId: params.storyboardId,
      name: params.text.slice(0, 40) || 'TTS 音频',
      description: params.text,
      url: isRemoteUrl(finalUrl) ? finalUrl : `/${relativePath}`,
      localPath: relativePath,
      fileSize: buffer.length,
      mimeType: AUDIO_MIME_BY_FORMAT[format] || null,
      duration: typeof parsed.audioLength === 'number' && parsed.audioLength > 0
        ? Math.round(parsed.audioLength / 1000)
        : null,
      format,
    })
  }

  return finalUrl
}

/**
 * 为角色生成试听音频
 */
export async function generateVoiceSample(characterName: string, voiceId: string, configId?: number | null): Promise<string> {
  const sampleText = `你好，我是${characterName}。很高兴认识你，这是我的声音试听。`
  return generateTTS({ text: sampleText, voice: voiceId, configId })
}
