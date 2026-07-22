import type { Context, MiddlewareHandler } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { verifyToken } from './crypto.js'

export type AuthUser = {
  id: number
  email: string
  name: string
  role: string
  status: string
}

const projectRoleRank: Record<string, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  }
}

export function getAuthUser(c: Context): AuthUser | null {
  return ((c as any).get?.('user') || null) as AuthUser | null
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return c.json({ code: 401, message: '请先登录' }, 401)

  let payload: Record<string, unknown> | null = null
  try {
    payload = verifyToken(token)
  } catch {
    payload = null
  }

  const userId = Number(payload?.sub)
  if (!userId) return c.json({ code: 401, message: '登录已失效，请重新登录' }, 401)

  const [user] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, userId),
    eq(schema.users.status, 'active'),
    isNull(schema.users.deletedAt),
  ))
  if (!user) return c.json({ code: 401, message: '登录已失效，请重新登录' }, 401)

  ;(c as any).set('user', publicUser(user))
  await next()
}

export function requireAdmin(c: Context) {
  const user = getAuthUser(c)
  if (!user) return c.json({ code: 401, message: '请先登录' }, 401)
  if (user.role !== 'admin') return c.json({ code: 403, message: '需要管理员权限' }, 403)
  return null
}

export const requireAdminMiddleware: MiddlewareHandler = async (c, next) => {
  const forbidden = requireAdmin(c)
  if (forbidden) return forbidden
  await next()
}

export async function getProjectRole(user: AuthUser, dramaId: number) {
  if (user.role === 'admin') return 'owner'
  const [member] = await db.select().from(schema.projectMembers).where(and(
    eq(schema.projectMembers.dramaId, dramaId),
    eq(schema.projectMembers.userId, user.id),
  ))
  return member?.role || null
}

export async function requireDramaRole(c: Context, dramaId: number, minimumRole: keyof typeof projectRoleRank) {
  const user = getAuthUser(c)
  if (!user) return c.json({ code: 401, message: '请先登录' }, 401)
  const role = await getProjectRole(user, dramaId)
  if (!role || projectRoleRank[role] < projectRoleRank[minimumRole]) {
    return c.json({ code: 403, message: '没有该项目的操作权限' }, 403)
  }
  return null
}

export async function getDramaIdByEpisodeId(episodeId: number) {
  const [episode] = await db.select({ dramaId: schema.episodes.dramaId }).from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return episode?.dramaId ?? null
}

export async function getDramaIdByStoryboardId(storyboardId: number) {
  const [storyboard] = await db.select({ episodeId: schema.storyboards.episodeId }).from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  return storyboard ? getDramaIdByEpisodeId(storyboard.episodeId) : null
}

export async function getDramaIdByCharacterId(characterId: number) {
  const [character] = await db.select({ dramaId: schema.characters.dramaId }).from(schema.characters).where(eq(schema.characters.id, characterId))
  return character?.dramaId ?? null
}

export async function getDramaIdBySceneId(sceneId: number) {
  const [scene] = await db.select({ dramaId: schema.scenes.dramaId }).from(schema.scenes).where(eq(schema.scenes.id, sceneId))
  return scene?.dramaId ?? null
}

export async function getDramaIdByImageGenerationId(imageId: number) {
  const [image] = await db.select({
    dramaId: schema.imageGenerations.dramaId,
    storyboardId: schema.imageGenerations.storyboardId,
    sceneId: schema.imageGenerations.sceneId,
    characterId: schema.imageGenerations.characterId,
  }).from(schema.imageGenerations).where(eq(schema.imageGenerations.id, imageId))
  if (!image) return null
  if (image.dramaId) return image.dramaId
  if (image.storyboardId) return getDramaIdByStoryboardId(image.storyboardId)
  if (image.sceneId) return getDramaIdBySceneId(image.sceneId)
  if (image.characterId) return getDramaIdByCharacterId(image.characterId)
  return null
}

export async function getDramaIdByVideoGenerationId(videoId: number) {
  const [video] = await db.select({
    dramaId: schema.videoGenerations.dramaId,
    storyboardId: schema.videoGenerations.storyboardId,
  }).from(schema.videoGenerations).where(eq(schema.videoGenerations.id, videoId))
  if (!video) return null
  if (video.dramaId) return video.dramaId
  if (video.storyboardId) return getDramaIdByStoryboardId(video.storyboardId)
  return null
}

export async function requireResolvedDramaRole(c: Context, dramaId: number | null, minimumRole: keyof typeof projectRoleRank) {
  if (!dramaId) return c.json({ code: 404, message: '资源不存在' }, 404)
  return requireDramaRole(c, dramaId, minimumRole)
}

export async function logOperation(c: Context, params: {
  action: string
  dramaId?: number | null
  resourceType?: string | null
  resourceId?: string | number | null
  detail?: unknown
}) {
  const user = getAuthUser(c)
  await db.insert(schema.operationLogs).values({
    userId: user?.id ?? null,
    dramaId: params.dramaId ?? null,
    action: params.action,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId == null ? null : String(params.resourceId),
    detail: params.detail == null ? null : JSON.stringify(params.detail),
    ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    createdAt: now(),
  })
}
