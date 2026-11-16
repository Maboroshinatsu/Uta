<template>
  <div class="import-preview" aria-label="角色预览">
    <img v-if="candidate.kind === 'image-set'" :src="candidate.imageUrl" alt="导入角色的默认立绘" @load="imageReady" @error="fail" />
    <div v-else ref="canvas" class="import-canvas" />
    <span v-if="message" class="import-preview-message" role="status">{{ message }}</span>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ShaderSystem } from '@pixi/core'
import { install } from '@pixi/unsafe-eval'
import type { Application } from '@pixi/app'
import type { ModelImportCandidate } from '../../shared/model-import-contracts'
import type { DeskpetModel } from '../services/live2d/loader'
const props = defineProps<{ candidate: ModelImportCandidate }>()
const emit = defineEmits<{ ready: [value: boolean] }>()
const canvas = ref<HTMLElement>()
const message = ref('正在准备预览…')
let alive = true
let app: Application | null = null
let model: DeskpetModel | null = null
let release: (() => void) | null = null
function imageReady(): void { message.value = ''; emit('ready', true) }
function fail(): void { message.value = '预览失败，请检查角色资源后重新导入。'; emit('ready', false) }
onMounted(async () => {
  if (props.candidate.kind !== 'live2d' || !canvas.value) return
  try {
    install({ ShaderSystem })
    const loader = await import('../services/live2d/loader')
    if (!alive || !canvas.value) return
    app = await loader.createPixiApp(canvas.value, canvas.value.clientWidth || 320, 280)
    release = () => {
      if (model) loader.unloadLive2DModel(model, app!)
      app?.destroy(true, { children: true, texture: false, baseTexture: false })
      model = null; app = null
    }
    if (!alive) { release(); return }
    const loaded = await loader.createLive2DModel(props.candidate.previewUrl)
    if (!alive) { loader.discardLive2DModel(loaded); return }
    model = loaded
    loader.attachLive2DModel(model, app)
    imageReady()
  } catch (error) { console.warn('[ModelImportPreview]', error); if (alive) fail(); release?.() }
})
onUnmounted(() => { alive = false; release?.() })
</script>

<style scoped>
.import-preview { position: relative; height: 280px; border: 1px solid var(--uta-separator); border-radius: var(--uta-radius-md); background: var(--uta-surface-muted); overflow: hidden; }
.import-preview img { width: 100%; height: 100%; object-fit: contain; }
.import-canvas { width: 100%; height: 100%; }
.import-preview-message { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; color: var(--uta-secondary); font-size: 13px; }
</style>
