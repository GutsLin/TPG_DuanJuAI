import { Worker } from 'bullmq'
import { createRedisConnection } from './connection.js'
import { IMAGE_QUEUE_NAME, MEDIA_QUEUE_NAME, VIDEO_QUEUE_NAME } from './queues.js'
import { processImageGeneration } from '../services/image-generation.js'
import { processVideoGeneration } from '../services/video-generation.js'
import { composeStoryboard } from '../services/ffmpeg-compose.js'
import { processVideoMerge } from '../services/ffmpeg-merge.js'
import { processStoryboardTTS } from '../services/tts-task.js'
import { logTaskError, logTaskSuccess } from '../utils/task-logger.js'

export function startQueueWorkers() {
  const imageWorker = new Worker(
    IMAGE_QUEUE_NAME,
    async job => processImageGeneration(Number(job.data.generationId)),
    {
      connection: createRedisConnection(),
      concurrency: Number(process.env.IMAGE_WORKER_CONCURRENCY || 4),
    },
  )

  const videoWorker = new Worker(
    VIDEO_QUEUE_NAME,
    async job => processVideoGeneration(Number(job.data.generationId)),
    {
      connection: createRedisConnection(),
      concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY || 2),
    },
  )

  const mediaWorker = new Worker(
    MEDIA_QUEUE_NAME,
    async job => {
      if (job.name === 'compose-storyboard') {
        return composeStoryboard(Number(job.data.storyboardId))
      }
      if (job.name === 'merge-episode') {
        return processVideoMerge(Number(job.data.mergeId))
      }
      if (job.name === 'tts') {
        return processStoryboardTTS(Number(job.data.storyboardId))
      }
      throw new Error(`Unsupported media job: ${job.name}`)
    },
    {
      connection: createRedisConnection(),
      concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY || 2),
    },
  )

  const workers = [imageWorker, videoWorker, mediaWorker]
  for (const worker of workers) {
    worker.on('completed', job => {
      logTaskSuccess('BullMQ', 'job-completed', { queue: worker.name, jobId: job.id, jobName: job.name })
    })
    worker.on('failed', (job, error) => {
      logTaskError('BullMQ', 'job-failed', { queue: worker.name, jobId: job?.id, jobName: job?.name, error: error.message })
    })
    worker.on('error', error => {
      logTaskError('BullMQ', 'worker-error', { queue: worker.name, error: error.message })
    })
  }

  return workers
}
