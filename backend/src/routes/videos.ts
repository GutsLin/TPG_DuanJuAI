import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateVideo } from '../services/video-generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  getDramaIdByStoryboardId,
  getDramaIdByVideoGenerationId,
  logOperation,
  requireDramaRole,
  requireResolvedDramaRole,
} from '../auth/access.js'

const app = new Hono()

async function enqueueVideo(body: any) {
  let configId: number | undefined = body.config_id
  if (body.storyboard_id) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
    if (sb) {
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
      if (ep?.videoConfigId != null) configId = ep.videoConfigId
    }
  }

  return generateVideo({
    storyboardId: body.storyboard_id,
    dramaId: body.drama_id,
    prompt: body.prompt,
    model: body.model,
    referenceMode: body.reference_mode,
    imageUrl: body.image_url,
    firstFrameUrl: body.first_frame_url,
    lastFrameUrl: body.last_frame_url,
    referenceImageUrls: body.reference_image_urls,
    duration: body.duration,
    aspectRatio: body.aspect_ratio,
    configId,
  })
}

async function resolveVideoRequestDramaId(body: any) {
  if (body.drama_id) return Number(body.drama_id)
  if (body.storyboard_id) return getDramaIdByStoryboardId(Number(body.storyboard_id))
  return null
}

// POST /videos — Generate video
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')
  const dramaId = await resolveVideoRequestDramaId(body)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  try {
    logTaskStart('VideoAPI', 'generate', {
      storyboardId: body.storyboard_id,
      dramaId: body.drama_id,
      referenceMode: body.reference_mode,
      duration: body.duration,
    })
    logTaskPayload('VideoAPI', 'request body', body)
    const id = await enqueueVideo(body)

    const [record] = await db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id))
    await logOperation(c, { action: 'video.generate', dramaId, resourceType: 'video_generation', resourceId: id })
    logTaskSuccess('VideoAPI', 'generate', { generationId: id, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('VideoAPI', 'generate', { error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /videos/batch — Queue multiple video generations concurrently
app.post('/batch', async (c) => {
  const body = await c.req.json()
  const items: any[] = Array.isArray(body.items) ? body.items : []
  if (!items.length) return badRequest(c, 'items is required')
  if (items.some(item => !item.prompt)) return badRequest(c, 'every item requires prompt')
  const dramaIds = await Promise.all(items.map(item => resolveVideoRequestDramaId(item)))
  const uniqueDramaIds = [...new Set(dramaIds.filter((id): id is number => typeof id === 'number'))]
  if (uniqueDramaIds.length === 0) return badRequest(c, 'items requires drama_id or storyboard_id')
  for (const dramaId of uniqueDramaIds) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  const settled = await Promise.allSettled(items.map(item => enqueueVideo(item)))
  const ids = settled
    .filter((result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled')
    .map(result => result.value)
  const errors = settled
    .map((result, index) => result.status === 'rejected' ? { index, message: String(result.reason?.message || result.reason) } : null)
    .filter(Boolean)

  return created(c, { count: ids.length, ids, failed: errors.length, errors })
})

// GET /videos/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdByVideoGenerationId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'viewer')
  if (forbidden) return forbidden

  const [row] = await db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id))
  return success(c, row || null)
})

// GET /videos — List by storyboard_id or drama_id
app.get('/', async (c) => {
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')
  let accessDramaId: number | null = dramaId ? Number(dramaId) : null
  if (!accessDramaId && storyboardId) accessDramaId = await getDramaIdByStoryboardId(Number(storyboardId))
  const forbidden = await requireResolvedDramaRole(c, accessDramaId, 'viewer')
  if (forbidden) return forbidden

  let rows = await db.select().from(schema.videoGenerations)

  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  return success(c, rows)
})

// DELETE /videos/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdByVideoGenerationId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  await db.delete(schema.videoGenerations).where(eq(schema.videoGenerations.id, id))
  await logOperation(c, { action: 'video.delete', dramaId, resourceType: 'video_generation', resourceId: id })
  return success(c)
})

export default app
