import { getImageQueue, getMediaQueue, getVideoQueue } from './queues.js'

export async function enqueueImageGeneration(generationId: number) {
  return getImageQueue().add('generate-image', { generationId }, { jobId: `image-${generationId}` })
}

export async function enqueueVideoGeneration(generationId: number) {
  return getVideoQueue().add('generate-video', { generationId }, { jobId: `video-${generationId}` })
}

export async function enqueueStoryboardCompose(storyboardId: number) {
  return getMediaQueue().add('compose-storyboard', { storyboardId }, {
    jobId: `compose-${storyboardId}`,
    removeOnComplete: true,
    removeOnFail: true,
  })
}

export async function enqueueEpisodeMerge(mergeId: number) {
  return getMediaQueue().add('merge-episode', { mergeId }, {
    jobId: `merge-${mergeId}`,
    removeOnComplete: true,
    removeOnFail: true,
  })
}
