import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateTTS } from '../services/tts-generation.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getDramaIdByEpisodeId, getDramaIdByStoryboardId, logOperation, requireResolvedDramaRole } from '../auth/access.js'

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

// POST /storyboards/:id/generate-tts
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
  logTaskPayload('StoryboardAPI', 'generate-tts input', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dialogue: sb.dialogue,
  })

  let voiceId = 'alloy'
  const speaker = parsedDialogue.speaker

  if (speaker) {
    if (!/^(旁白|画外音|narrator)$/i.test(speaker)) {
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
      if (ep) {
        const chars = await db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId))
        const found = chars.find((char) => char.name === speaker)
        if (found?.voiceStyle) voiceId = found.voiceStyle
      }
    }
  }

  const pureDialogue = parsedDialogue.pureText
  if (!pureDialogue) return badRequest(c, '未提取到可合成的文本')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
  try {
    const audioPath = await generateTTS({ text: pureDialogue, voice: voiceId, configId: ep?.audioConfigId || null })
  await db.update(schema.storyboards)
    .set({ ttsAudioUrl: audioPath, updatedAt: now() })
    .where(eq(schema.storyboards.id, id))


    logTaskSuccess('StoryboardAPI', 'generate-tts', {
      storyboardId: id,
      voiceId,
      path: audioPath,
      textLength: pureDialogue.length,
    })
    return success(c, { tts_audio_url: audioPath, voice_id: voiceId, text: pureDialogue })
  } catch (err: any) {
    logTaskError('StoryboardAPI', 'generate-tts', { storyboardId: id, voiceId, error: err.message })
    return badRequest(c, err.message)
  }
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
