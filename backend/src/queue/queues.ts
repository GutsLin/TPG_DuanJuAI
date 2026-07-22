import { Queue } from 'bullmq'
import { createRedisConnection } from './connection.js'

export const IMAGE_QUEUE_NAME = 'huobao-image-generation'
export const VIDEO_QUEUE_NAME = 'huobao-video-generation'
export const MEDIA_QUEUE_NAME = 'huobao-media-processing'

const defaultJobOptions = {
  attempts: Number(process.env.QUEUE_JOB_ATTEMPTS || 1),
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
}

let imageQueue: Queue | null = null
let videoQueue: Queue | null = null
let mediaQueue: Queue | null = null

function createQueue(name: string) {
  const queue = new Queue(name, { connection: createRedisConnection(), defaultJobOptions })
  queue.on('error', error => console.error(`[BullMQ:${name}]`, error))
  return queue
}

export function getImageQueue() {
  imageQueue ??= createQueue(IMAGE_QUEUE_NAME)
  return imageQueue
}

export function getVideoQueue() {
  videoQueue ??= createQueue(VIDEO_QUEUE_NAME)
  return videoQueue
}

export function getMediaQueue() {
  mediaQueue ??= createQueue(MEDIA_QUEUE_NAME)
  return mediaQueue
}

export async function closeQueues() {
  await Promise.all([imageQueue?.close(), videoQueue?.close(), mediaQueue?.close()])
}
