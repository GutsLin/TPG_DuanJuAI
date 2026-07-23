import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { logOperation, requireAdmin } from '../auth/access.js'
import { probeStorageConfig, type OssConfigLike } from '../utils/storage.js'
import { logTaskError, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

/** 出参统一打码 access_key_secret（列表/创建/更新均不回传明文） */
function exposeConfig(row: typeof schema.storageConfigs.$inferSelect) {
  return {
    ...toSnakeCase(row),
    access_key_secret: row.accessKeySecret ? '********' : '',
  }
}

// GET /storage-configs — 列表（admin-only，响应形状与 ai-configs 列表一致）
app.get('/', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const rows = await db.select().from(schema.storageConfigs)
  return success(c, rows.map(exposeConfig))
})

// POST /storage-configs — 创建（snake_case 入参）
app.post('/', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const body = await c.req.json()
  if (!body.provider) {
    return badRequest(c, 'provider is required')
  }

  const ts = now()
  const [row] = await db.insert(schema.storageConfigs).values({
    provider: body.provider,
    name: body.name || `${body.provider}-storage`,
    bucket: body.bucket || '',
    endpoint: body.endpoint || '',
    accessKeyId: body.access_key_id || '',
    accessKeySecret: body.access_key_secret || '',
    domain: body.domain || '',
    prefix: body.prefix || '',
    isActive: false,
    createdAt: ts,
    updatedAt: ts,
  }).returning()

  await logOperation(c, { action: 'storage-config.create', resourceType: 'storage_config', resourceId: row.id, detail: { provider: row.provider, name: row.name } })
  return created(c, exposeConfig(row))
})

// POST /storage-configs/test — 连接测试（body: {id} 或内联配置字段）
app.post('/test', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const body = await c.req.json().catch(() => ({} as any))
  let provider = body.provider
  const config: OssConfigLike = {
    bucket: body.bucket,
    endpoint: body.endpoint,
    accessKeyId: body.access_key_id,
    accessKeySecret: body.access_key_secret,
    domain: body.domain,
    prefix: body.prefix,
  }

  if (body.id) {
    const [row] = await db.select().from(schema.storageConfigs).where(eq(schema.storageConfigs.id, Number(body.id)))
    if (!row) return notFound(c, '存储配置不存在')
    provider = row.provider
    Object.assign(config, {
      bucket: row.bucket,
      endpoint: row.endpoint,
      accessKeyId: row.accessKeyId,
      accessKeySecret: row.accessKeySecret,
      domain: row.domain,
      prefix: row.prefix,
    })
  }

  if (!provider) return badRequest(c, 'provider is required（或传入 id）')
  if (provider === 'local') {
    return success(c, { ok: true, message: '本地存储模式，无需连接测试' })
  }

  try {
    await probeStorageConfig(config)
    logTaskSuccess('StorageConfig', 'probe-ok', { bucket: config.bucket, endpoint: config.endpoint })
    return success(c, { ok: true, message: 'OSS 连接成功，读写测试通过' })
  } catch (err: any) {
    logTaskError('StorageConfig', 'probe-failed', { bucket: config.bucket, endpoint: config.endpoint, error: err?.message })
    return badRequest(c, `OSS 连接测试失败: ${err?.message || '未知错误'}`)
  }
})

// POST /storage-configs/deactivate — 全部置为未生效（=切回本地存储）
app.post('/deactivate', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  await db.update(schema.storageConfigs).set({ isActive: false, updatedAt: now() })
  await logOperation(c, { action: 'storage-config.deactivate', resourceType: 'storage_config' })
  return success(c, { ok: true })
})

// POST /storage-configs/:id/activate — 全表置 false 后激活该行
app.post('/:id/activate', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.storageConfigs).where(eq(schema.storageConfigs.id, id))
  if (!row) return notFound(c, '存储配置不存在')

  await db.update(schema.storageConfigs).set({ isActive: false, updatedAt: now() })
  await db.update(schema.storageConfigs).set({ isActive: true, updatedAt: now() }).where(eq(schema.storageConfigs.id, id))
  await logOperation(c, { action: 'storage-config.activate', resourceType: 'storage_config', resourceId: id, detail: { provider: row.provider, name: row.name } })
  return success(c, { ok: true })
})

// PUT /storage-configs/:id — 更新（access_key_secret 传入打码值或空值则保留原值）
app.put('/:id', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const id = Number(c.req.param('id'))
  const [existing] = await db.select().from(schema.storageConfigs).where(eq(schema.storageConfigs.id, id))
  if (!existing) return notFound(c, '存储配置不存在')

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }

  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('bucket' in body) updates.bucket = body.bucket
  if ('endpoint' in body) updates.endpoint = body.endpoint
  if ('access_key_id' in body) updates.accessKeyId = body.access_key_id
  if ('domain' in body) updates.domain = body.domain
  if ('prefix' in body) updates.prefix = body.prefix
  if ('is_active' in body) updates.isActive = body.is_active
  if ('access_key_secret' in body) {
    const secret = String(body.access_key_secret || '').trim()
    if (secret && secret !== '********') updates.accessKeySecret = secret
  }

  const [row] = await db.update(schema.storageConfigs).set(updates).where(eq(schema.storageConfigs.id, id)).returning()
  await logOperation(c, { action: 'storage-config.update', resourceType: 'storage_config', resourceId: id, detail: { fields: Object.keys(updates).filter(k => k !== 'updatedAt') } })
  return success(c, exposeConfig(row))
})

// DELETE /storage-configs/:id
app.delete('/:id', async (c) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden

  const id = Number(c.req.param('id'))
  await db.delete(schema.storageConfigs).where(eq(schema.storageConfigs.id, id))
  await logOperation(c, { action: 'storage-config.delete', resourceType: 'storage_config', resourceId: id })
  return success(c, { ok: true })
})

export default app
