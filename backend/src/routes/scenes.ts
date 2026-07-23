import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getDramaIdByEpisodeId, getDramaIdBySceneId, logOperation, requireDramaRole, requireResolvedDramaRole } from '../auth/access.js'

const app = new Hono()

// POST /scenes
app.post('/', async (c) => {
  const body = await c.req.json()
  const forbidden = await requireDramaRole(c, Number(body.drama_id), 'editor')
  if (forbidden) return forbidden

  const ts = now()
  const [result] = await db.insert(schema.scenes).values({
    dramaId: body.drama_id,
    episodeId: body.episode_id,
    location: body.location,
    time: body.time || '',
    prompt: body.prompt || body.location,
    createdAt: ts,
    updatedAt: ts,
  }).returning()
  await logOperation(c, { action: 'scene.create', dramaId: body.drama_id, resourceType: 'scene', resourceId: result.id })
  return created(c, result)
})

// POST /scenes/batch-generate-images — 批量生成场景图
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = (Array.isArray(body.ids) ? body.ids : [])
    .map((value: any) => Number(value))
    .filter((n: number) => Number.isFinite(n) && n > 0)
  if (!ids.length) return badRequest(c, 'ids is required')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const dramaId = await getDramaIdByEpisodeId(Number(body.episode_id))
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  const sceneRows = (await db.select().from(schema.scenes))
    .filter(scene => ids.includes(scene.id) && !scene.deletedAt)
  const settled = await Promise.allSettled(sceneRows.map(async (scene) => {
    const prompt = scene.prompt || `${scene.location}, ${scene.time || ''}, 高质量场景, 电影感`
    try {
      await db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, scene.id))
      return await generateImage({ sceneId: scene.id, dramaId: scene.dramaId, prompt, configId: ep.imageConfigId ?? undefined })
    } catch (err) {
      await db.update(schema.scenes).set({ status: 'failed', updatedAt: now() }).where(eq(schema.scenes.id, scene.id))
      throw err
    }
  }))
  const results = settled
    .filter((result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled')
    .map(result => result.value)
  logTaskSuccess('SceneImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})
// PUT /scenes/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdBySceneId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.location !== undefined) updates.location = body.location
  if (body.time !== undefined) updates.time = body.time
  if (body.prompt !== undefined) updates.prompt = body.prompt
  const imageUrl = body.image_url !== undefined ? body.image_url : body.imageUrl
  if (imageUrl !== undefined) {
    updates.imageUrl = typeof imageUrl === 'string' ? imageUrl.replace(/^\/+/, '') : imageUrl
    updates.status = 'completed'
  }
  await db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, id))
  await logOperation(c, { action: 'scene.update', dramaId, resourceType: 'scene', resourceId: id, detail: updates })
  return success(c)
})

// POST /scenes/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const dramaId = await getDramaIdBySceneId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, id))
  if (!scene) return badRequest(c, 'Scene not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  const prompt = scene.prompt || `${scene.location}, ${scene.time || ''}, 高质量场景, 电影感`
  try {
    logTaskStart('SceneImage', 'generate', { sceneId: id, episodeId: ep.id, dramaId: scene.dramaId, location: scene.location })
    await db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, id))
    const genId = await generateImage({ sceneId: id, dramaId: scene.dramaId, prompt, configId: ep.imageConfigId ?? undefined })
    logTaskSuccess('SceneImage', 'generate', { sceneId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('SceneImage', 'generate', { sceneId: id, error: err.message })
    await db.update(schema.scenes).set({ status: 'failed', updatedAt: now() }).where(eq(schema.scenes.id, id))
    return badRequest(c, err.message)
  }
})

// DELETE /scenes/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdBySceneId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  await db.delete(schema.scenes).where(eq(schema.scenes.id, id))
  await logOperation(c, { action: 'scene.delete', dramaId, resourceType: 'scene', resourceId: id })
  return success(c)
})

export default app
