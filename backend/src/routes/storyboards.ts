import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { enqueueTTSGeneration } from '../queue/jobs.js'
import { getAbsolutePath } from '../utils/storage.js'
import fs from 'fs'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getDramaIdByEpisodeId, getDramaIdByStoryboardId, logOperation, requireDramaRole, requireResolvedDramaRole } from '../auth/access.js'

const app = new Hono()

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

async function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))


  const uniqueIds = [...new Set((characterIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    })
  }
}

async function getStoryboardCharacterIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  return links.map(link => link.characterId)
}

async function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined) {
  const sceneLinks = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const characterLinks = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const episodeSceneIds = new Set(sceneLinks.map(link => link.sceneId))
  const episodeCharacterIds = new Set(characterLinks.map(link => link.characterId))

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const dramaId = await getDramaIdByEpisodeId(Number(body.episode_id))
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  await validateStoryboardBindings(body.episode_id, body.scene_id, body.character_ids)
  const [result] = await db.insert(schema.storyboards).values({
    episodeId: body.episode_id,
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    action: body.action,
    dialogue: body.dialogue,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  }).returning()
  await syncStoryboardCharacters(result.id, body.character_ids || [])
  await logOperation(c, { action: 'storyboard.create', dramaId, resourceType: 'storyboard', resourceId: result.id })
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: await getStoryboardCharacterIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const dramaId = await getDramaIdByStoryboardId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  if (!storyboard) return badRequest(c, '镜头不存在')
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', action: 'action',
    dialogue: 'dialogue', duration: 'duration', video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
  }

  const updates: Record<string, any> = { updatedAt: now() }
  for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
    if (snakeKey in body) updates[camelKey] = body[snakeKey]
  }

  if ('dialogue' in body) {
    updates.ttsAudioUrl = null
    updates.subtitleUrl = null
  }

  await validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : await getStoryboardCharacterIds(id),
  )

  await db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id))
  if ('character_ids' in body) await syncStoryboardCharacters(id, body.character_ids || [])
  await logOperation(c, { action: 'storyboard.update', dramaId, resourceType: 'storyboard', resourceId: id, detail: Object.keys(updates) })
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
  })
  return success(c)
})

// POST /storyboards/:id/generate-tts — 校验后入队，立即返回
app.post('/:id/generate-tts', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdByStoryboardId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  if (!sb) return badRequest(c, '镜头不存在')
  const parsedDialogue = parseDialogueForTTS(sb.dialogue)
  if (parsedDialogue.ignorable) return badRequest(c, '该镜头没有可生成的对白或旁白')

  logTaskStart('StoryboardAPI', 'generate-tts', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dialoguePreview: (sb.dialogue || '').slice(0, 40),
  })

  try {
    await db.update(schema.storyboards)
      .set({ ttsStatus: 'queued', updatedAt: now() })
      .where(eq(schema.storyboards.id, id))
    await enqueueTTSGeneration(id)
    logTaskSuccess('StoryboardAPI', 'generate-tts', { storyboardId: id, queued: true })
    return success(c, { queued: true, storyboard_id: id })
  } catch (err: any) {
    await db.update(schema.storyboards)
      .set({ ttsStatus: 'failed', updatedAt: now() })
      .where(eq(schema.storyboards.id, id))
    logTaskError('StoryboardAPI', 'generate-tts', { storyboardId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /storyboards/batch-generate-tts — 批量入队 TTS
app.post('/batch-generate-tts', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const ids: number[] = (Array.isArray(body.ids) ? body.ids : [])
    .map((value: any) => Number(value))
    .filter((n: number) => Number.isFinite(n) && n > 0)
  if (!ids.length) return badRequest(c, 'ids is required')

  const storyboardRows = (await db.select().from(schema.storyboards))
    .filter(sb => ids.includes(sb.id) && !sb.deletedAt)
  const dramaIds = [...new Set(
    (await Promise.all(storyboardRows.map(sb => getDramaIdByEpisodeId(sb.episodeId))))
      .filter((value): value is number => typeof value === 'number'),
  )]
  for (const dramaId of dramaIds) {
    const forbidden = await requireDramaRole(c, dramaId, 'editor')
    if (forbidden) return forbidden
  }

  const results = await Promise.all(storyboardRows.map(async (sb) => {
    if (parseDialogueForTTS(sb.dialogue).ignorable) return { id: sb.id, queued: false }
    await db.update(schema.storyboards)
      .set({ ttsStatus: 'queued', updatedAt: now() })
      .where(eq(schema.storyboards.id, sb.id))
    try {
      await enqueueTTSGeneration(sb.id)
      return { id: sb.id, queued: true }
    } catch (err: any) {
      await db.update(schema.storyboards)
        .set({ ttsStatus: 'failed', updatedAt: now() })
        .where(eq(schema.storyboards.id, sb.id))
      logTaskError('StoryboardAPI', 'batch-generate-tts-item', { storyboardId: sb.id, error: err.message })
      return { id: sb.id, queued: false }
    }
  }))
  const queuedIds = results.filter(result => result.queued).map(result => result.id)
  const skipped = ids.filter(value => !queuedIds.includes(value))
  logTaskSuccess('StoryboardAPI', 'batch-generate-tts', { requested: ids.length, queued: queuedIds.length, skipped: skipped.length })
  return success(c, { count: queuedIds.length, ids: queuedIds, skipped })
})

// POST /storyboards/:id/bind-tts — 绑定已有音频（站内 static 路径或素材库 asset）
app.post('/:id/bind-tts', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdByStoryboardId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  if (!sb) return badRequest(c, '镜头不存在')

  const body = await c.req.json().catch(() => ({} as any))
  let ttsPath = ''
  if (body.asset_id) {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, Number(body.asset_id)))
    if (!asset || asset.deletedAt) return badRequest(c, '素材不存在')
    ttsPath = String(asset.localPath || asset.url || '').trim()
  } else if (body.url) {
    ttsPath = String(body.url).trim()
  } else {
    return badRequest(c, 'url 或 asset_id 必填其一')
  }

  if (ttsPath.startsWith('/')) ttsPath = ttsPath.slice(1)
  if (!ttsPath.startsWith('static/')) return badRequest(c, 'url 必须是 static/ 开头的站内音频路径')
  if (!fs.existsSync(getAbsolutePath(ttsPath))) return badRequest(c, '音频文件不存在')

  await db.update(schema.storyboards)
    .set({ ttsAudioUrl: ttsPath, ttsStatus: 'completed', updatedAt: now() })
    .where(eq(schema.storyboards.id, id))
  await logOperation(c, { action: 'storyboard.bind-tts', dramaId, resourceType: 'storyboard', resourceId: id, detail: { tts_audio_url: ttsPath, asset_id: body.asset_id ?? null } })
  logTaskSuccess('StoryboardAPI', 'bind-tts', { storyboardId: id, path: ttsPath })
  return success(c, { tts_audio_url: ttsPath })
})
// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const dramaId = await getDramaIdByStoryboardId(id)
  const forbidden = await requireResolvedDramaRole(c, dramaId, 'editor')
  if (forbidden) return forbidden

  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id))
  await db.delete(schema.storyboards).where(eq(schema.storyboards.id, id))
  await logOperation(c, { action: 'storyboard.delete', dramaId, resourceType: 'storyboard', resourceId: id })
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

export default app
