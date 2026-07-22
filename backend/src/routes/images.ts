import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

async function enqueueImage(body: any) {
  let configId: number | undefined = body.config_id
  if (body.storyboard_id) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
    if (sb) {
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
      if (ep?.imageConfigId != null) configId = ep.imageConfigId
    }
  }

  return generateImage({
    storyboardId: body.storyboard_id,
    dramaId: body.drama_id,
    sceneId: body.scene_id,
    characterId: body.character_id,
    prompt: body.prompt,
    model: body.model,
    size: body.size,
    referenceImages: body.reference_images,
    frameType: body.frame_type,
    configId,
  })
}

// POST /images — Generate image
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  try {
    logTaskStart('ImageAPI', 'generate', {
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
      frameType: body.frame_type,
    })
    logTaskPayload('ImageAPI', 'request body', body)
    const id = await enqueueImage(body)

    const [record] = await db.select().from(schema.imageGenerations)
      .where(eq(schema.imageGenerations.id, id))
    logTaskSuccess('ImageAPI', 'generate', { generationId: id, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('ImageAPI', 'generate', { error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /images/batch — Queue multiple image generations concurrently
app.post('/batch', async (c) => {
  const body = await c.req.json()
  const items: any[] = Array.isArray(body.items) ? body.items : []
  if (!items.length) return badRequest(c, 'items is required')
  if (items.some(item => !item.prompt)) return badRequest(c, 'every item requires prompt')

  const settled = await Promise.allSettled(items.map(item => enqueueImage(item)))
  const ids = settled
    .filter((result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled')
    .map(result => result.value)
  const errors = settled
    .map((result, index) => result.status === 'rejected' ? { index, message: String(result.reason?.message || result.reason) } : null)
    .filter(Boolean)

  return created(c, { count: ids.length, ids, failed: errors.length, errors })
})

// GET /images/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id))
  return success(c, row || null)
})

// GET /images — List by storyboard_id or drama_id
app.get('/', async (c) => {
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  let rows = await db.select().from(schema.imageGenerations)

  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  return success(c, rows)
})

// DELETE /images/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.delete(schema.imageGenerations).where(eq(schema.imageGenerations.id, id))
  return success(c)
})

export default app
