import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { getAuthUser, getProjectRole, logOperation, requireDramaRole } from '../auth/access.js'

const app = new Hono()

// GET /dramas - List dramas
app.get('/', async (c) => {
  const user = getAuthUser(c)
  if (!user) return c.json({ code: 401, message: '请先登录' }, 401)

  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')

  let visibleDramaIds: number[] | null = null
  if (user.role !== 'admin') {
    const memberships = await db.select({ dramaId: schema.projectMembers.dramaId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, user.id))
    visibleDramaIds = memberships.map(m => m.dramaId)
    if (visibleDramaIds.length === 0) {
      return success(c, {
        items: [],
        pagination: { page, page_size: pageSize, total: 0, total_pages: 0 },
      })
    }
  }

  const allRows = await db.select().from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt))
    .orderBy(desc(schema.dramas.updatedAt))
  let filtered = visibleDramaIds ? allRows.filter(d => visibleDramaIds.includes(d.id)) : allRows

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.dramaId, drama.id))
    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, drama.id))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, drama.id))
    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: eps.length,
      episodes: toSnakeCaseArray(eps),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const body = await c.req.json()
  const user = getAuthUser(c)
  if (!user) return c.json({ code: 401, message: '请先登录' }, 401)

  const ts = now()
  const [result] = await db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).returning()

  // Create default episodes
  const totalEpisodes = body.total_episodes || 1
  for (let i = 1; i <= totalEpisodes; i++) {
    await db.insert(schema.episodes).values({
      dramaId: result.id,
      episodeNumber: i,
      title: `第${i}集`,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    })
  }

  await db.insert(schema.projectMembers).values({
    dramaId: result.id,
    userId: user.id,
    role: 'owner',
    createdAt: ts,
    updatedAt: ts,
  })
  await logOperation(c, { action: 'drama.create', dramaId: result.id, resourceType: 'drama', resourceId: result.id, detail: { title: result.title } })

  return created(c, toSnakeCase(result))
})


// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const user = getAuthUser(c)
  if (!user) return c.json({ code: 401, message: '请先登录' }, 401)
  const allRows = await db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))
  let all = allRows
  if (user.role !== 'admin') {
    const memberships = await db.select({ dramaId: schema.projectMembers.dramaId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, user.id))
    const ids = memberships.map(m => m.dramaId)
    all = ids.length ? allRows.filter(d => ids.includes(d.id)) : []
  }
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, id, 'viewer')
  if (forbidden) return forbidden

  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')

  const eps = await db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, id))
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, id, 'editor')
  if (forbidden) return forbidden

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  await logOperation(c, { action: 'drama.update', dramaId: id, resourceType: 'drama', resourceId: id, detail: updates })
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, id, 'owner')
  if (forbidden) return forbidden

  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  await logOperation(c, { action: 'drama.delete', dramaId: id, resourceType: 'drama', resourceId: id })
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  await logOperation(c, { action: 'drama.characters.save', dramaId, resourceType: 'character', detail: { count: chars.length } })
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  await logOperation(c, { action: 'drama.episodes.save', dramaId, resourceType: 'episode', detail: { count: episodes.length } })
  return success(c)
})

app.get('/:id/members', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, dramaId, 'viewer')
  if (forbidden) return forbidden

  const rows = await db.select().from(schema.projectMembers).where(eq(schema.projectMembers.dramaId, dramaId))
  const members = await Promise.all(rows.map(async (member) => {
    const [user] = await db.select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      status: schema.users.status,
    }).from(schema.users).where(eq(schema.users.id, member.userId))
    return {
      ...toSnakeCase(member),
      user: user ? toSnakeCase(user) : null,
    }
  }))
  return success(c, members)
})

app.post('/:id/members', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, dramaId, 'owner')
  if (forbidden) return forbidden

  const body = await c.req.json()
  const email = String(body.email || '').trim().toLowerCase()
  const role = String(body.role || 'viewer')
  if (!['viewer', 'editor', 'owner'].includes(role)) return badRequest(c, '成员角色无效')

  const [user] = await db.select().from(schema.users).where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
  if (!user) return notFound(c, '用户不存在，请先让对方注册账号')

  const ts = now()
  const [existing] = await db.select().from(schema.projectMembers).where(and(
    eq(schema.projectMembers.dramaId, dramaId),
    eq(schema.projectMembers.userId, user.id),
  ))
  if (existing) {
    await db.update(schema.projectMembers).set({ role, updatedAt: ts }).where(eq(schema.projectMembers.id, existing.id))
  } else {
    await db.insert(schema.projectMembers).values({ dramaId, userId: user.id, role, createdAt: ts, updatedAt: ts })
  }
  await logOperation(c, { action: 'member.upsert', dramaId, resourceType: 'project_member', resourceId: user.id, detail: { email, role } })
  return success(c)
})

app.delete('/:id/members/:userId', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const targetUserId = Number(c.req.param('userId'))
  const forbidden = await requireDramaRole(c, dramaId, 'owner')
  if (forbidden) return forbidden

  const owners = await db.select().from(schema.projectMembers).where(and(
    eq(schema.projectMembers.dramaId, dramaId),
    eq(schema.projectMembers.role, 'owner'),
  ))
  const target = owners.find(o => o.userId === targetUserId)
  if (target && owners.length <= 1) return badRequest(c, '项目至少需要保留一个 owner')

  await db.delete(schema.projectMembers).where(and(
    eq(schema.projectMembers.dramaId, dramaId),
    eq(schema.projectMembers.userId, targetUserId),
  ))
  await logOperation(c, { action: 'member.remove', dramaId, resourceType: 'project_member', resourceId: targetUserId })
  return success(c)
})

app.get('/:id/logs', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const forbidden = await requireDramaRole(c, dramaId, 'viewer')
  if (forbidden) return forbidden

  const rows = await db.select().from(schema.operationLogs)
    .where(eq(schema.operationLogs.dramaId, dramaId))
    .orderBy(desc(schema.operationLogs.createdAt))
    .limit(100)
  const userIds = [...new Set(rows.map(r => r.userId).filter((id): id is number => typeof id === 'number'))]
  const users = userIds.length
    ? await db.select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    }).from(schema.users).where(inArray(schema.users.id, userIds))
    : []
  const userMap = new Map(users.map(u => [u.id, u]))
  return success(c, rows.map(row => ({
    ...toSnakeCase(row),
    detail: row.detail ? JSON.parse(row.detail) : null,
    user: row.userId && userMap.has(row.userId) ? toSnakeCase(userMap.get(row.userId)!) : null,
  })))
})

export default app
