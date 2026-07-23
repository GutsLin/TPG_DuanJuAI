import { Hono } from 'hono'
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'
import { getDramaIdByEpisodeId, getDramaIdByStoryboardId, logOperation, requireDramaRole } from '../auth/access.js'

const app = new Hono()

async function resolveAssetDramaId(asset: { dramaId: number | null; episodeId: number | null; storyboardId: number | null }) {
  if (asset.dramaId) return asset.dramaId
  if (asset.episodeId) return getDramaIdByEpisodeId(asset.episodeId)
  if (asset.storyboardId) return getDramaIdByStoryboardId(asset.storyboardId)
  return null
}

// GET /assets?drama_id=&episode_id=&type=&category=&favorite=&q=&page=&page_size=
app.get('/', async (c) => {
  const dramaId = Number(c.req.query('drama_id'))
  if (!dramaId) return badRequest(c, 'drama_id is required')
  const forbidden = await requireDramaRole(c, dramaId, 'viewer')
  if (forbidden) return forbidden

  const episodeId = c.req.query('episode_id') ? Number(c.req.query('episode_id')) : null
  const type = (c.req.query('type') || '').trim()
  const category = (c.req.query('category') || '').trim()
  const favorite = (c.req.query('favorite') || '').trim()
  const q = (c.req.query('q') || '').trim()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size')) || 60))

  const conditions = [
    eq(schema.assets.dramaId, dramaId),
    isNull(schema.assets.deletedAt),
  ]
  if (episodeId) conditions.push(eq(schema.assets.episodeId, episodeId))
  if (type && ['image', 'video', 'audio'].includes(type)) conditions.push(eq(schema.assets.type, type))
  if (category) conditions.push(eq(schema.assets.category, category))
  if (favorite === '1' || favorite === 'true') conditions.push(eq(schema.assets.isFavorite, true))
  if (q) {
    const fuzzy = or(
      ilike(schema.assets.name, `%${q}%`),
      ilike(schema.assets.description, `%${q}%`),
    )
    if (fuzzy) conditions.push(fuzzy)
  }
  const where = and(...conditions)

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.assets).where(where)
  const items = await db.select().from(schema.assets)
    .where(where)
    .orderBy(desc(schema.assets.createdAt), desc(schema.assets.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return success(c, { items, total: countRow?.count ?? 0, page, page_size: pageSize })
})

// GET /assets/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, id),
    isNull(schema.assets.deletedAt),
  ))
  if (!asset) return notFound(c, 'Asset not found')
  const dramaId = await resolveAssetDramaId(asset)
  if (dramaId) {
    const forbidden = await requireDramaRole(c, dramaId, 'viewer')
    if (forbidden) return forbidden
  }
  return success(c, asset)
})

// PUT /assets/:id — name / description / isFavorite（容忍 is_favorite）
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, id),
    isNull(schema.assets.deletedAt),
  ))
  if (!asset) return notFound(c, 'Asset not found')
  const dramaId = await resolveAssetDramaId(asset)
  if (dramaId) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.isFavorite !== undefined) updates.isFavorite = !!body.isFavorite
  else if (body.is_favorite !== undefined) updates.isFavorite = !!body.is_favorite

  const [updated] = await db.update(schema.assets).set(updates).where(eq(schema.assets.id, id)).returning()
  await logOperation(c, { action: 'asset.update', dramaId, resourceType: 'asset', resourceId: id, detail: Object.keys(updates) })
  return success(c, updated)
})

// DELETE /assets/:id — 软删除，不删文件（可能被业务表引用）
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, id),
    isNull(schema.assets.deletedAt),
  ))
  if (!asset) return notFound(c, 'Asset not found')
  const dramaId = await resolveAssetDramaId(asset)
  if (dramaId) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  await db.update(schema.assets).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.assets.id, id))
  await logOperation(c, { action: 'asset.delete', dramaId, resourceType: 'asset', resourceId: id, detail: { name: asset.name, url: asset.url } })
  return success(c, { ok: true })
})

export default app
