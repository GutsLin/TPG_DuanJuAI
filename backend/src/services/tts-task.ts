/**
 * TTS 队列任务 — 由 media worker 分发执行
 * 流程：tts_status='processing' → 校验对白 → 解析音色 → generateTTS（内部回写素材库）→ 回写 storyboard
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { generateTTS } from './tts-generation.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i
const NARRATOR_SPEAKERS = /^(旁白|画外音|narrator)$/i

export function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

/**
 * 处理一个分镜的 TTS 生成（供 BullMQ media worker 调用）
 */
export async function processStoryboardTTS(storyboardId: number): Promise<string> {
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)

  await db.update(schema.storyboards)
    .set({ ttsStatus: 'processing', updatedAt: now() })
    .where(eq(schema.storyboards.id, storyboardId))

  logTaskStart('TTSTask', 'process', {
    storyboardId,
    episodeId: sb.episodeId,
    dialoguePreview: (sb.dialogue || '').slice(0, 40),
  })

  try {
    const parsed = parseDialogueForTTS(sb.dialogue)
    if (parsed.ignorable) throw new Error('该镜头没有可生成的对白或旁白')

    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))

    let voiceId = 'alloy'
    if (parsed.speaker && !NARRATOR_SPEAKERS.test(parsed.speaker) && ep) {
      const chars = await db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId))
      const found = chars.find((char) => char.name === parsed.speaker)
      if (found?.voiceStyle) voiceId = found.voiceStyle
    }

    const audioPath = await generateTTS({
      text: parsed.pureText,
      voice: voiceId,
      configId: ep?.audioConfigId || null,
      storyboardId,
      episodeId: sb.episodeId,
      dramaId: ep?.dramaId ?? null,
    })

    await db.update(schema.storyboards)
      .set({ ttsAudioUrl: audioPath, ttsStatus: 'completed', updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))

    logTaskSuccess('TTSTask', 'process', {
      storyboardId,
      voiceId,
      path: audioPath,
      textLength: parsed.pureText.length,
    })
    return audioPath
  } catch (err: any) {
    await db.update(schema.storyboards)
      .set({ ttsStatus: 'failed', updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))
    logTaskError('TTSTask', 'process', { storyboardId, error: err.message })
    throw err
  }
}
