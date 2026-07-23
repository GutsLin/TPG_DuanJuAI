import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { redactUrl } from '../utils/task-logger.js'

export type ModelCallKind = 'image' | 'video' | 'audio'
export type ModelCallPhase = 'generate' | 'poll'

interface ModelCallLogParams {
  dramaId?: number | null
  kind: ModelCallKind
  phase?: ModelCallPhase
  outcome: 'success' | 'error'
  provider: string
  model?: string | null
  method: string
  url: string
  status?: number | null
  durationMs?: number | null
  error?: unknown
  resourceType: string
  resourceId: string | number
}

export async function recordModelCall(params: ModelCallLogParams) {
  if (!params.dramaId) return

  const detail = {
    kind: params.kind,
    phase: params.phase || 'generate',
    outcome: params.outcome,
    provider: params.provider,
    model: params.model || '',
    method: params.method,
    url: sanitizeUrl(params.url),
    status: params.status ?? null,
    duration_ms: params.durationMs ?? null,
    error: normalizeError(params.error),
  }

  try {
    await db.insert(schema.operationLogs).values({
      userId: null,
      dramaId: params.dramaId,
      action: `model_call.${params.kind}.${params.outcome}`,
      resourceType: params.resourceType,
      resourceId: String(params.resourceId),
      detail: JSON.stringify(detail),
      ip: null,
      userAgent: null,
      createdAt: now(),
    })
  } catch (error) {
    console.warn('[ModelCallLog] failed to persist log:', error instanceof Error ? error.message : error)
  }
}

function normalizeError(value: unknown) {
  if (value == null) return ''
  let text: string
  if (value instanceof Error) text = value.message
  else if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  const sanitized = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/([?&](?:key|api_key|apikey|token|access_token|secret|password)=)[^&\s"'<>]+/gi, '$1***')
    .replace(/(["']?(?:authorization|api[_-]?key|apikey|access[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, '$1***')

  return sanitized.length > 8000 ? `${sanitized.slice(0, 8000)}...<truncated>` : sanitized
}

function sanitizeUrl(rawUrl: string) {
  const redacted = redactUrl(rawUrl)
  try {
    const url = new URL(redacted)
    if (url.username) url.username = '***'
    if (url.password) url.password = '***'
    for (const key of ['secret', 'password']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***')
    }
    return url.toString()
  } catch {
    return redacted
  }
}
