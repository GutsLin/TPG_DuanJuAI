import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, created, now, success } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { getAuthUser, publicUser, requireAdmin, requireAuth } from '../auth/access.js'
import { hashPassword, signToken, verifyPassword } from '../auth/crypto.js'

const app = new Hono()

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function issueToken(user: { id: number; email: string; role: string }) {
  return signToken({ sub: user.id, email: user.email, role: user.role })
}

app.post('/register', async (c) => {
  const body = await c.req.json()
  const email = normalizeEmail(body.email || '')
  const password = String(body.password || '')
  const name = String(body.name || '').trim() || email.split('@')[0]

  if (!email || !email.includes('@')) return badRequest(c, '请填写有效邮箱')
  if (password.length < 8) return badRequest(c, '密码至少 8 位')

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email))
  if (existing) return badRequest(c, '该邮箱已注册')

  const existingUsers = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  const ts = now()
  const [user] = await db.insert(schema.users).values({
    email,
    name,
    passwordHash: await hashPassword(password),
    role: existingUsers.length === 0 ? 'admin' : 'creator',
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  }).returning()

  const authUser = publicUser(user)
  return created(c, { token: issueToken(user), user: authUser })
})

app.post('/login', async (c) => {
  const body = await c.req.json()
  const email = normalizeEmail(body.email || '')
  const password = String(body.password || '')

  const [user] = await db.select().from(schema.users).where(and(
    eq(schema.users.email, email),
    eq(schema.users.status, 'active'),
    isNull(schema.users.deletedAt),
  ))
  if (!user || !(await verifyPassword(password, user.passwordHash))) return badRequest(c, '邮箱或密码不正确')

  await db.update(schema.users).set({ lastLoginAt: now(), updatedAt: now() }).where(eq(schema.users.id, user.id))
  return success(c, { token: issueToken(user), user: publicUser(user) })
})

app.get('/me', requireAuth, async (c) => {
  const user = getAuthUser(c)
  return success(c, { user })
})

app.get('/users', requireAuth, async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const rows = await db.select({
    id: schema.users.id,
    email: schema.users.email,
    name: schema.users.name,
    role: schema.users.role,
    status: schema.users.status,
    lastLoginAt: schema.users.lastLoginAt,
    createdAt: schema.users.createdAt,
    updatedAt: schema.users.updatedAt,
  }).from(schema.users).where(isNull(schema.users.deletedAt)).orderBy(desc(schema.users.createdAt))
  return success(c, toSnakeCaseArray(rows))
})

app.put('/users/:id', requireAuth, async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name || '').trim()
  if (body.role !== undefined && ['admin', 'creator'].includes(body.role)) updates.role = body.role
  if (body.status !== undefined && ['active', 'disabled'].includes(body.status)) updates.status = body.status
  if (body.password) updates.passwordHash = await hashPassword(String(body.password))
  const [user] = await db.update(schema.users).set(updates).where(eq(schema.users.id, id)).returning()
  return success(c, toSnakeCase(user))
})

export default app
