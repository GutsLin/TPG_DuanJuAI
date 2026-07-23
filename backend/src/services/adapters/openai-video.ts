/**
 * OpenAI-compatible video adapter used by providers such as AnyFast.
 * Create: POST /v1/video/generations
 * Query:  GET  /v1/video/generations/:taskId
 */
import { MiniMaxVideoAdapter } from './minimax-video'
import type {
  AIConfig,
  ProviderRequest,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class OpenAIVideoAdapter extends MiniMaxVideoAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const request = super.buildGenerateRequest(config, record)
    return {
      ...request,
      url: joinProviderUrl(config.baseUrl, '/v1', '/video/generations'),
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.id || result.task_id || result.data?.id || result.data?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }

    const videoUrl = extractVideoUrl(result)
    if (videoUrl) return { isAsync: false, videoUrl }

    throw new Error('No task id or video URL in OpenAI video response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/video/generations/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result.status || result.state || result.data?.status || result.data?.state || '').toLowerCase()
    const videoUrl = extractVideoUrl(result)

    if (['completed', 'succeeded', 'success', 'done'].includes(status) || (!status && videoUrl)) {
      return { status: 'completed', videoUrl: videoUrl || undefined }
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      return {
        status: 'failed',
        error: result.error?.message || result.error_msg || result.error || result.message || result.data?.error || 'Video generation failed',
      }
    }
    return { status: status === 'pending' ? 'pending' : 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return extractVideoUrl(result)
  }
}

function extractVideoUrl(result: any): string | null {
  return result.video_url
    || result.url
    || result.output_url
    || result.data?.video_url
    || result.data?.url
    || result.data?.output_url
    || result.output?.video_url
    || result.output?.url
    || null
}
