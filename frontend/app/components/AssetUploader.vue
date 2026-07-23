<template>
  <span class="asset-uploader">
    <input
      ref="fileEl"
      type="file"
      :accept="accept"
      class="asset-uploader-input"
      @change="onChange"
    />
    <button class="btn btn-sm" :disabled="uploading" @click="trigger">
      <Loader2 v-if="uploading" :size="11" class="animate-spin" />
      <Upload v-else :size="11" />
      {{ uploading ? '上传中' : buttonText }}
    </button>
  </span>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2, Upload } from 'lucide-vue-next'
import { uploadAPI } from '~/composables/useApi'

const props = defineProps({
  kind: { type: String, default: 'image' }, // 'image' | 'audio'
  dramaId: { type: [String, Number], required: true },
  episodeId: { type: [String, Number], default: '' },
  storyboardId: { type: [String, Number], default: '' },
  buttonText: { type: String, default: '上传' },
})
const emit = defineEmits(['uploaded'])

const fileEl = ref()
const uploading = ref(false)

const accept = computed(() => (
  props.kind === 'audio'
    ? 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac'
    : 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'
))

function trigger() {
  if (uploading.value) return
  fileEl.value?.click()
}

async function onChange(event) {
  const file = event.target?.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const extra = { drama_id: props.dramaId }
    if (props.episodeId) extra.episode_id = props.episodeId
    if (props.storyboardId) extra.storyboard_id = props.storyboardId
    const res = props.kind === 'audio'
      ? await uploadAPI.audio(file, extra)
      : await uploadAPI.image(file, extra)
    const asset = res?.asset ? { ...res.asset, url: res.asset.url || res.url } : res
    toast.success('上传成功')
    emit('uploaded', asset)
  } catch (e) {
    toast.error(e.message || '上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.asset-uploader { display: inline-flex; }
.asset-uploader-input { display: none; }
</style>
