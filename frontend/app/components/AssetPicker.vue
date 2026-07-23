<template>
  <div v-if="show" class="overlay asset-picker-overlay" @click.self="emit('close')">
    <div class="card asset-picker">
      <div class="asset-picker-head">
        <span class="asset-picker-title">选择{{ typeLabel }}素材</span>
        <button class="btn btn-ghost btn-icon ml-auto" @click="emit('close')">
          <X :size="14" />
        </button>
      </div>

      <div class="asset-picker-bar">
        <div class="asset-picker-search">
          <Search :size="12" />
          <input
            v-model="q"
            class="asset-picker-search-input"
            placeholder="搜索素材名称或描述..."
            @keyup.enter="load(true)"
          />
        </div>
        <button class="btn btn-sm" :disabled="loading" @click="load(true)">搜索</button>
      </div>

      <div class="asset-picker-body">
        <div v-if="loading && !items.length" class="asset-picker-empty">
          <Loader2 :size="18" class="animate-spin" />
          <span>加载中…</span>
        </div>
        <div v-else-if="!items.length" class="asset-picker-empty">
          <Inbox :size="22" />
          <span>暂无{{ typeLabel }}素材</span>
          <span class="asset-picker-empty-sub">可先在角色 / 场景 / 配音处上传，或生成素材后再来选择</span>
        </div>
        <template v-else>
          <div class="asset-picker-grid">
            <div
              v-for="a in items"
              :key="a.id"
              class="asset-picker-item"
              @click="pick(a)"
            >
              <div class="asset-picker-thumb">
                <img v-if="a.type === 'image'" :src="assetUrl(a)" :alt="a.name || '素材'" loading="lazy" />
                <video
                  v-else-if="a.type === 'video'"
                  :src="assetUrl(a)"
                  preload="metadata"
                  muted
                  playsinline
                />
                <div v-else class="asset-picker-audio">
                  <Music :size="16" />
                  <audio :src="assetUrl(a)" controls preload="none" @click.stop />
                </div>
              </div>
              <div class="asset-picker-name truncate">{{ a.name || '未命名素材' }}</div>
            </div>
          </div>
          <div v-if="items.length < total" class="asset-picker-more">
            <button class="btn btn-sm" :disabled="loading" @click="loadMore">
              {{ loading ? '加载中…' : `加载更多(${items.length}/${total})` }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Inbox, Loader2, Music, Search, X } from 'lucide-vue-next'
import { assetAPI } from '~/composables/useApi'

const props = defineProps({
  show: { type: Boolean, default: false },
  type: { type: String, default: 'image' }, // 'image' | 'audio' | 'video'
  dramaId: { type: [String, Number], required: true },
  episodeId: { type: [String, Number], default: '' },
})
const emit = defineEmits(['close', 'select'])

const items = ref([])
const total = ref(0)
const page = ref(1)
const q = ref('')
const loading = ref(false)

const typeLabel = computed(() => ({ image: '图片', audio: '音频', video: '视频' }[props.type] || ''))

function assetUrl(a) {
  const u = a?.url || a?.thumbnailUrl || ''
  return u ? (u.startsWith('/') ? u : `/${u}`) : ''
}

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  if (reset) page.value = 1
  try {
    const res = await assetAPI.list({
      drama_id: props.dramaId,
      episode_id: props.episodeId || undefined,
      type: props.type,
      q: q.value.trim() || undefined,
      page: page.value,
      page_size: 60,
    })
    const list = res?.items || []
    items.value = reset || page.value === 1 ? list : [...items.value, ...list]
    total.value = res?.total ?? list.length
  } catch (e) {
    toast.error(e.message || '素材加载失败')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  page.value += 1
  await load()
}

function pick(a) {
  emit('select', a)
  emit('close')
}

watch(() => props.show, (v) => {
  if (v) {
    q.value = ''
    items.value = []
    total.value = 0
    page.value = 1
    load(true)
  }
})
</script>

<style scoped>
.asset-picker-overlay { z-index: 110; padding: 24px; }
.asset-picker {
  width: min(860px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleIn 0.18s var(--ease-out);
}
.asset-picker-head {
  display: flex;
  align-items: center;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.asset-picker-title { font-size: 15px; font-weight: 600; font-family: var(--font-display); }
.asset-picker-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.asset-picker-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-2);
  transition: border-color 0.18s, box-shadow 0.18s;
}
.asset-picker-search:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-glow);
  background: var(--bg-0);
}
.asset-picker-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 8px 0;
  font-size: 13px;
  font-family: var(--font-body);
  color: var(--text-0);
}
.asset-picker-search-input::placeholder { color: var(--text-3); }
.asset-picker-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.asset-picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 220px;
  color: var(--text-3);
  font-size: 13px;
}
.asset-picker-empty-sub { font-size: 11px; }
.asset-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.asset-picker-item {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  background: var(--bg-0);
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out), transform 0.15s var(--ease-out);
}
.asset-picker-item:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  transform: translateY(-1px);
}
.asset-picker-thumb {
  aspect-ratio: 16/10;
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.asset-picker-thumb img,
.asset-picker-thumb video { width: 100%; height: 100%; object-fit: cover; }
.asset-picker-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  color: var(--text-3);
}
.asset-picker-audio audio { width: 100%; height: 28px; }
.asset-picker-name {
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  border-top: 1px solid var(--border);
}
.asset-picker-more {
  display: flex;
  justify-content: center;
  padding-top: 12px;
}
</style>
