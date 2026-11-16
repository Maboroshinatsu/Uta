<template>
  <section class="settings-panel tts-service-panel" aria-label="语音播报声音与服务">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">朗读声音</span>
        <h3 class="panel-title">怎么听，以及声音来自哪里</h3>
        <p class="panel-hint">本地服务只连接本机回环地址；云端服务需要保存对应服务的密钥。试听使用本页当前的语速与音量。</p>
      </div>
      <span class="panel-badge" :class="{ 'is-positive': serviceReady, 'is-warning': !serviceReady }">
        <span class="status-dot" :class="{ 'is-on': serviceReady, 'is-warn': !serviceReady }" />
        {{ serviceStatusLabel }}
      </span>
    </div>

    <span class="field-label">声音来源</span>
    <div class="choice-grid" role="group" aria-label="声音来源">
      <button
        type="button"
        class="choice-card"
        :class="{ 'is-active': provider === 'http' }"
        :aria-pressed="provider === 'http'"
        @click="provider !== 'http' && emit('update:provider', 'http')"
      >
        <span class="choice-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7V21" /></svg>
        </span>
        <span class="choice-copy">
          <span class="choice-title">本地服务</span>
          <span class="choice-desc">连接这台电脑上的 /tts 服务，声音不出本机。</span>
        </span>
      </button>
      <button
        type="button"
        class="choice-card"
        :class="{ 'is-active': provider === 'cloud' }"
        :aria-pressed="provider === 'cloud'"
        @click="provider !== 'cloud' && emit('update:provider', 'cloud')"
      >
        <span class="choice-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 18.5h9.6a4 4 0 0 0 .7-7.9A5.6 5.6 0 0 0 6.6 9.4a4.6 4.6 0 0 0 .6 9.1z" /></svg>
        </span>
        <span class="choice-copy">
          <span class="choice-title">云端服务</span>
          <span class="choice-desc">使用在线声音，需要填写接口与 API 密钥。</span>
        </span>
      </button>
    </div>

    <p v-if="provider === 'system'" class="settings-note">
      当前仍保存着旧系统语音选项。请先选择本地或云端声音并保存；Uta 不会自动替你切换。
    </p>

    <div class="setting-row">
      <div class="row-copy">
        <label class="row-label" for="voice-volume">播报音量</label>
        <p class="row-desc">只影响 Uta 朗读时的输出音量，不改变系统音量。</p>
      </div>
      <div class="row-control slider-control">
        <div class="slider-track-wrap">
          <div class="slider-fill-bar" :style="{ width: `${Math.round(volume * 100)}%` }" />
          <div class="slider-grip" :style="{ left: gripLeft(Math.round(volume * 100)) }" />
          <input
            id="voice-volume"
            type="range"
            class="slider-range-input"
            :value="Math.round(volume * 100)"
            min="0"
            max="100"
            step="5"
            @input="event => emit('update:volume', Math.round(Number((event.target as HTMLInputElement).value)) / 100)"
          />
        </div>
        <span class="slider-badge">{{ Math.round(volume * 100) }}%</span>
      </div>
    </div>
    <div v-if="!isDeepSeek" class="setting-row">
      <div class="row-copy">
        <label class="row-label" for="voice-rate">合成语速</label>
        <p class="row-desc">0.5 倍更慢，2.0 倍更快；不会改变宿主原文。</p>
      </div>
      <div class="row-control slider-control">
        <div class="slider-track-wrap">
          <div class="slider-fill-bar" :style="{ width: `${Math.round(((rate - 0.5) / 1.5) * 100)}%` }" />
          <div class="slider-grip" :style="{ left: gripLeft(Math.round(((rate - 0.5) / 1.5) * 100)) }" />
          <input
            id="voice-rate"
            type="range"
            class="slider-range-input"
            :value="rate"
            min="0.5"
            max="2"
            step="0.1"
            @input="event => emit('update:rate', Math.round(Number((event.target as HTMLInputElement).value) * 10) / 10)"
          />
        </div>
        <span class="slider-badge">{{ rate }}x</span>
      </div>
    </div>

    <div class="panel-divider" />
    <span class="field-label">服务连接</span>

    <template v-if="provider === 'http'">
      <label class="field-block" for="tts-local-endpoint">
        <span class="field-name">本地服务地址</span>
        <input
          id="tts-local-endpoint"
          v-model.trim="store.ttsEndpoint"
          class="text-input"
          placeholder="http://127.0.0.1:9881/tts"
          spellcheck="false"
        />
        <span class="field-help">只接受 127.0.0.1、localhost 或 ::1 的兼容 /tts 服务。</span>
      </label>
    </template>

    <template v-else-if="provider === 'cloud'">
      <label class="field-block" for="tts-cloud-backend">
        <span class="field-name">云端服务</span>
        <select
          id="tts-cloud-backend"
          v-model="store.ttsCloudBackend"
          class="text-input"
          @change="onCloudBackendChange"
        >
          <option v-for="item in CLOUD_TTS_BACKENDS" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
        <span v-if="isDeepSeek" class="field-help">暂不支持语速和风格调节。</span>
      </label>
      <div class="field-grid">
        <label class="field-block" for="tts-cloud-endpoint">
          <span class="field-name">接口地址</span>
          <input id="tts-cloud-endpoint" v-model.trim="store.ttsCloudEndpoint" class="text-input" spellcheck="false" />
        </label>
        <label v-if="!isDeepSeek" class="field-block" for="tts-cloud-model">
          <span class="field-name">模型</span>
          <input id="tts-cloud-model" v-model.trim="store.ttsCloudModel" class="text-input" spellcheck="false" />
        </label>
        <label class="field-block" for="tts-cloud-voice">
          <span class="field-name">音色</span>
          <select v-if="isDeepSeek" id="tts-cloud-voice" v-model="store.ttsCloudVoice" class="text-input">
            <option value="stella">海星（女声）</option>
            <option value="tide">暗潮（男声）</option>
          </select>
          <input v-else id="tts-cloud-voice" v-model.trim="store.ttsCloudVoice" class="text-input" spellcheck="false" />
        </label>
        <label v-if="!isDeepSeek" class="field-block" for="tts-cloud-style">
          <span class="field-name">风格（可选）</span>
          <input id="tts-cloud-style" v-model.trim="store.ttsCloudStyle" class="text-input" spellcheck="false" />
        </label>
      </div>
      <div v-if="!isDeepSeek" class="setting-row tts-auto-style-row">
        <div class="row-copy">
          <label class="row-label" for="tts-auto-style-toggle">让宿主自动选择合适风格</label>
          <p class="row-desc">开启后优先根据宿主返回的情绪标记或文本语气自动推断发音风格；关闭则固定使用指定风格。</p>
        </div>
        <div class="row-control">
          <input
            id="tts-auto-style-toggle"
            v-model="store.ttsAutoStyleFromHost"
            type="checkbox"
            class="checkbox"
          />
        </div>
      </div>
      <label class="field-block" for="tts-cloud-key">
        <span class="field-name">API 密钥</span>
        <div class="key-row">
          <input
            id="tts-cloud-key"
            v-model="cloudApiKey"
            type="password"
            class="text-input"
            :placeholder="cloudKeySaved ? '已保存，留空则不修改' : '粘贴当前服务的 API Key'"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="uta-button is-secondary"
            :disabled="cloudSaving || cloudSaveBlocked || !cloudLoaded || !cloudApiKey.trim()"
            @click="saveCloudTtsConfigNow"
          >
            {{ cloudSaving ? '保存中…' : '保存密钥' }}
          </button>
        </div>
        <span class="field-help">密钥单独保存，不随其他设置自动提交。</span>
      </label>
      <p v-if="cloudMessage" class="inline-message" role="status">{{ cloudMessage }}</p>
      <button
        v-if="cloudSaveBlocked"
        type="button"
        class="uta-button is-secondary config-read-retry"
        :disabled="cloudSaving"
        @click="retryCloudConfigRead"
      >
        {{ cloudSaving ? '读取中…' : '重新读取云端配置' }}
      </button>
      <p v-if="cloudAutoState === 'error'" class="inline-message is-error" role="alert">
        连接信息自动保存失败，请重试。
        <button
          type="button"
          class="inline-retry"
          :disabled="cloudSaving || cloudSaveBlocked || !cloudLoaded"
          @click="persistCloudConfigSilently()"
        >{{ cloudSaving ? '重试中…' : '重试保存连接信息' }}</button>
      </p>
    </template>

    <p v-else class="settings-note">先选择声音来源，再填写对应的服务连接。</p>

    <div class="settings-action-row">
      <button
        type="button"
        class="uta-button is-primary"
        :disabled="previewPending || cloudSaving || (provider !== 'http' && provider !== 'cloud') || (provider === 'cloud' && (!cloudLoaded || !!cloudApiKey.trim()))"
        @click="onPreviewTts"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8.5 5.4v13.2L19 12z" /></svg>
        {{ previewPending ? '正在准备试听…' : '试听当前声音' }}
      </button>
      <button type="button" class="uta-button is-secondary" :disabled="!previewPending || previewState === 'cancelled'" @click="preview.cancel()">
        停止试听
      </button>
      <span class="preview-hint">试听前只会补齐连接信息的自动保存，不会提交未保存的新密钥，也不会保存上方朗读偏好。</span>
    </div>
    <p v-if="cloudApiKey.trim()" class="inline-message is-warning">新密钥尚未保存，试听前请先保存；关闭设置时会提醒你。</p>
    <p v-if="previewMessage" class="preview-status" :data-status="previewState" role="status" aria-live="polite">{{ previewMessage }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import type { CloudTtsBackend } from '@/stores/deskpet'
import { createVoicePreview, type VoicePreviewState } from '@/services/voice-preview'
import { registerUnsavedDraft } from '../services/unsaved-drafts'

const store = useDeskpetStore()
const isDeepSeek = computed(() => props.provider === 'cloud' && store.ttsCloudBackend === 'deepseek')

function gripLeft(percent: number): string {
  return `clamp(8px, ${percent}%, calc(100% - 8px))`
}
const props = defineProps<{ provider: 'http' | 'cloud' | 'system'; rate: number; volume: number }>()
const emit = defineEmits<{
  (event: 'update:provider', provider: 'http' | 'cloud'): void
  (event: 'update:rate', rate: number): void
  (event: 'update:volume', volume: number): void
}>()
const previewPending = ref(false), previewState = ref<VoicePreviewState>('idle'), previewMessage = ref('')
const cloudLoaded = ref(false), cloudAutoState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const preview = createVoicePreview({
  synthesize: request => window.utaAPI?.previewSpeech?.(request) ?? Promise.resolve({ ok: false, error: 'unauthorized' }),
  update: (state, message) => { previewState.value = state; previewMessage.value = message },
})
watch(() => props.provider, () => preview.cancel())

const CLOUD_TTS_BACKENDS: Array<{
  id: CloudTtsBackend
  label: string
  endpoint: string
  model: string
  voice: string
}> = [
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1/audio/speech',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:claire',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/tools/tts',
    model: '',
    voice: 'stella',
  },
  {
    id: 'cosyvoice',
    label: '阿里云百炼 CosyVoice',
    endpoint:
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'cherry',
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-tts',
    voice: 'mimo_default',
  },
  {
    id: 'fishaudio',
    label: 'Fish Audio',
    endpoint: 'https://api.fish.audio/v1/tts',
    model: '',
    voice: '',
  },
  {
    id: 'gsv2p',
    label: 'GSV2P',
    endpoint: 'https://gsv2p.acgnai.top/v1/audio/speech',
    model: 'tts-v4',
    voice: '原神-中文-派蒙_ZH',
  },
  {
    id: 'openai',
    label: 'OpenAI / 兼容接口',
    endpoint: 'https://api.openai.com/v1/audio/speech',
    model: 'tts-1',
    voice: 'nova',
  },
]

const cloudApiKey = ref('')
const cloudKeySaved = ref(false)
const cloudSaving = ref(false)
const cloudMessage = ref('')
const cloudReadError = ref<'' | 'config-unreadable' | 'config-corrupt' | 'decrypt-failed'>('')
const cloudSaveBlocked = computed(() =>
  cloudReadError.value === 'config-unreadable' || cloudReadError.value === 'config-corrupt',
)

const serviceReady = ref(false)
const serviceStatusLabel = ref('等待选择')

type CloudConfigView = NonNullable<Awaited<ReturnType<UtaAPI['getCloudTtsConfig']>>>
type CloudSavePayload = Parameters<UtaAPI['saveCloudTtsConfig']>[0]
type CloudSaveResult = Awaited<ReturnType<UtaAPI['saveCloudTtsConfig']>>

let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null
let cloudWriteChain: Promise<unknown> = Promise.resolve()
let applyingRemoteCloudConfig = false

function currentCloudPayload(): CloudSavePayload {
  return {
    backend: store.ttsCloudBackend,
    endpoint: store.ttsCloudEndpoint,
    model: store.ttsCloudModel,
    voice: store.ttsCloudVoice,
    style: store.ttsCloudStyle,
  }
}

/** 串行写入，避免自动保存和“保存云端配置”并发时互相覆盖 */
function enqueueCloudWrite(payload: CloudSavePayload): Promise<CloudSaveResult | null> {
  const run = async (): Promise<CloudSaveResult | null> => {
    const api = window.utaAPI
    if (!api?.saveCloudTtsConfig) return null
    return api.saveCloudTtsConfig(payload)
  }
  const result = cloudWriteChain.then(run, run)
  cloudWriteChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function stopCloudSaveTimer(): void {
  if (!cloudSaveTimer) return
  clearTimeout(cloudSaveTimer)
  cloudSaveTimer = null
}

function hasCustomCloudConfig(): boolean {
  const defaults = CLOUD_TTS_BACKENDS[0]
  return (
    store.ttsCloudBackend !== defaults.id ||
    store.ttsCloudEndpoint !== defaults.endpoint ||
    store.ttsCloudModel !== defaults.model ||
    store.ttsCloudVoice !== defaults.voice ||
    store.ttsCloudStyle.trim().length > 0
  )
}

function scheduleCloudConfigSave(delay = 600): void {
  if (applyingRemoteCloudConfig || cloudSaveBlocked.value) return
  stopCloudSaveTimer()
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null
    void persistCloudConfigSilently()
  }, delay)
}

async function persistCloudConfigSilently(): Promise<void> {
  if (cloudSaveBlocked.value) {
    cloudAutoState.value = 'error'
    return
  }
  cloudAutoState.value = 'saving'
  try {
    const result = await enqueueCloudWrite(currentCloudPayload())
    if (result?.ok && result.config) {
      cloudKeySaved.value = result.config.hasApiKey
      cloudAutoState.value = 'saved'
    } else {
      cloudAutoState.value = 'error'
      console.warn('[Settings] cloud config autosave failed')
    }
  } catch (error) {
    cloudAutoState.value = 'error'
  }
}

async function applyCloudConfig(config: CloudConfigView): Promise<void> {
  applyingRemoteCloudConfig = true
  try {
    if (CLOUD_TTS_BACKENDS.some((item) => item.id === config.backend)) {
      store.ttsCloudBackend = config.backend as CloudTtsBackend
    }
    store.ttsCloudEndpoint = config.endpoint
    store.ttsCloudModel = config.model
    store.ttsCloudVoice = config.voice
    store.ttsCloudStyle = config.style
    cloudKeySaved.value = config.hasApiKey
    await nextTick()
  } finally {
    applyingRemoteCloudConfig = false
  }
}

function onCloudBackendChange(): void {
  const preset = CLOUD_TTS_BACKENDS.find((item) => item.id === store.ttsCloudBackend)
  if (!preset) return
  store.ttsCloudEndpoint = preset.endpoint
  store.ttsCloudModel = preset.model
  store.ttsCloudVoice = preset.voice
  cloudApiKey.value = ''
  cloudKeySaved.value = false
  cloudMessage.value = '服务已切换，请为当前服务单独保存密钥。'
  scheduleCloudConfigSave()
}

async function loadCloudTtsConfig(): Promise<void> {
  try {
    const config = await window.utaAPI?.getCloudTtsConfig?.()
    if (!config) return
    cloudReadError.value = config.readError ?? ''
    if (config.readError) {
      cloudKeySaved.value = false
      if (!hasCustomCloudConfig()) {
        await applyCloudConfig({ ...config, hasApiKey: false })
      }
      cloudMessage.value = config.readError === 'decrypt-failed'
        ? '已保存的 API 密钥无法解密；普通连接设置仍可保存，重新填写并保存密钥可修复。'
        : '云端语音配置读取失败，未覆盖原文件。请检查文件后重新读取。'
      return
    }
    cloudMessage.value = ''
    // 本地已有用户选择时以本地为准，并把它同步回主进程；
    // 只有本地仍是默认值时才采用主进程里的配置。
    if (hasCustomCloudConfig()) {
      cloudKeySaved.value = config.hasApiKey
      scheduleCloudConfigSave(0)
      return
    }
    await applyCloudConfig(config)
  } catch {
    /* 主进程还没就绪时保持本地默认值 */
  }
}

async function retryCloudConfigRead(): Promise<void> {
  if (cloudSaving.value) return
  cloudSaving.value = true
  cloudMessage.value = '正在重新读取云端配置…'
  try {
    await loadCloudTtsConfig()
    cloudLoaded.value = true
  } finally {
    cloudSaving.value = false
  }
}

async function saveCloudTtsConfigNow(): Promise<boolean> {
  if (cloudSaving.value) return false
  if (cloudSaveBlocked.value) {
    cloudMessage.value = '云端配置读取失败，未覆盖原文件。请先重新读取。'
    return false
  }
  stopCloudSaveTimer()
  cloudSaving.value = true
  cloudMessage.value = ''
  const sentConfig = currentCloudPayload()
  const sentKey = cloudApiKey.value.trim()
  try {
    const result = await enqueueCloudWrite({
      ...sentConfig,
      ...(sentKey ? { apiKey: sentKey } : {}),
    })
    if (result?.ok && result.config) {
      if (result.config.hasApiKey) cloudReadError.value = ''
      const hasNewInput = JSON.stringify(currentCloudPayload()) !== JSON.stringify(sentConfig)
      if (!hasNewInput) await applyCloudConfig(result.config)
      else cloudKeySaved.value = result.config.hasApiKey
      if (cloudApiKey.value.trim() === sentKey) cloudApiKey.value = ''
      cloudAutoState.value = 'saved'
      cloudMessage.value = hasNewInput ? '上次配置已保存，新输入仍保留并等待自动保存。' : result.config.hasApiKey ? '云端配置与密钥已保存' : '已保存，但还没有 API 密钥'
      return true
    } else {
      const code = result?.error ?? ''
      cloudAutoState.value = 'error'
      cloudMessage.value = code === 'config-unreadable' || code === 'config-corrupt'
        ? '云端配置读取失败，原文件未被覆盖。请重新读取后再保存。'
        : '云端配置保存失败，请检查连接信息后重试。'
      return false
    }
  } catch (error) {
    cloudAutoState.value = 'error'
    cloudMessage.value = '云端配置保存失败，请重试。'
    return false
  } finally {
    cloudSaving.value = false
  }
}

watch(
  [
    () => store.ttsCloudBackend,
    () => store.ttsCloudEndpoint,
    () => store.ttsCloudModel,
    () => store.ttsCloudVoice,
    () => store.ttsCloudStyle,
  ],
  () => {
    if (applyingRemoteCloudConfig) return
    scheduleCloudConfigSave()
  },
)

watch(
  [() => props.provider, cloudKeySaved, cloudLoaded, cloudReadError, () => store.ttsEndpoint],
  () => {
    if (props.provider === 'http') {
      serviceReady.value = !!store.ttsEndpoint.trim()
      serviceStatusLabel.value = serviceReady.value ? '本地地址已填写' : '缺少本地地址'
    } else if (props.provider === 'cloud') {
      if (cloudSaveBlocked.value) {
        serviceReady.value = false
        serviceStatusLabel.value = '配置读取失败'
      } else if (cloudReadError.value === 'decrypt-failed') {
        serviceReady.value = false
        serviceStatusLabel.value = '密钥无法解密'
      } else {
        serviceReady.value = cloudLoaded.value && cloudKeySaved.value
        serviceStatusLabel.value = cloudLoaded.value ? (cloudKeySaved.value ? '密钥已保存' : '缺少 API 密钥') : '正在读取配置'
      }
    } else {
      serviceReady.value = false
      serviceStatusLabel.value = '请选择声音来源'
    }
  },
  { immediate: true },
)

async function onPreviewTts() {
  if (previewPending.value || (props.provider !== 'http' && props.provider !== 'cloud')) return
  previewPending.value = true
  try {
    if (props.provider === 'cloud') {
      // Connection fields autosave; a newly typed key is never attached here.
      stopCloudSaveTimer()
      await persistCloudConfigSilently()
      if (cloudAutoState.value === 'error') {
        previewState.value = 'error'; previewMessage.value = '连接信息保存失败，未开始试听。'; return
      }
    }
    await preview.play({ text: '你好，我是 Uta，很高兴与你一起工作。', provider: props.provider, endpoint: store.ttsEndpoint, speed: props.rate }, props.volume)
  } finally { previewPending.value = false }
}

const unregisterSecretDraft = registerUnsavedDraft('tts-cloud-key', {
  label: '云端语音 API 密钥',
  kind: 'secret',
  isDirty: () => cloudApiKey.value.trim().length > 0,
  save: () => saveCloudTtsConfigNow(),
})

onMounted(() => {
  void loadCloudTtsConfig().finally(() => { cloudLoaded.value = true })
})

onUnmounted(() => {
  unregisterSecretDraft()
  preview.dispose()
  if (cloudSaveTimer) {
    stopCloudSaveTimer()
    void persistCloudConfigSilently()
  }
})
</script>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--uta-separator);
}

.setting-row:last-of-type {
  border-bottom: none;
}

.row-copy {
  flex: 1;
  min-width: 0;
}

.row-label {
  display: block;
  font-size: 14px;
  font-weight: 650;
  color: var(--uta-ink);
}

.row-desc {
  margin: 3px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--uta-secondary);
}

.row-control {
  flex-shrink: 0;
}

.slider-control {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(300px, 50%);
}

.slider-track-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 120px;
  height: 30px;
  border-radius: 8px;
  background-color: var(--uta-canvas);
  border: 1px solid var(--uta-separator);
  box-sizing: border-box;
  padding: 0;
  overflow: visible;
  transition: border-color var(--uta-transition-fast), box-shadow var(--uta-transition-fast);
}

.slider-grip {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 36px;
  transform: translate(-50%, -50%);
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  z-index: 1;
  transition: transform 0.14s ease;
}
.slider-track-wrap:active .slider-grip {
  transform: translate(-50%, -50%) scale(0.95);
}

.slider-track-wrap:hover {
  border-color: var(--uta-input-border);
}

.slider-track-wrap:focus-within {
  border-color: var(--uta-accent);
  box-shadow: 0 0 0 2px var(--uta-focus-ring);
}

.slider-fill-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--uta-accent-soft);
  border-radius: 7px;
  pointer-events: none;
  transition: width 0.08s ease;
}

.slider-range-input {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.slider-range-input:focus-visible {
  outline: none;
}

.slider-range-input::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
  border: none;
}

/* 原生拇指透明，只负责拖动；可见手柄由 .slider-grip 定位 */
.slider-range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  width: 16px;
  height: 36px;
  margin-top: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.slider-range-input:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scale(0.95);
  background: #f7f9fa;
}


.slider-badge {
  min-width: 48px;
  padding: 4px 8px;
  border-radius: 8px;
  background-color: var(--uta-canvas);
  border: 1px solid var(--uta-separator);
  color: var(--uta-ink);
  font-family: var(--uta-font-mono);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.choice-icon svg {
  width: 16px;
  height: 16px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin-top: 10px;
}

.field-name {
  font-size: 12px;
  font-weight: 650;
  color: var(--uta-ink);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
}

.text-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--uta-input-border);
  border-radius: 9px;
  background-color: var(--uta-input);
  color: var(--uta-ink);
  font: inherit;
  font-size: 13px;
}

.text-input:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: 1px;
  background-color: var(--uta-input-focus);
}

.field-help {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--uta-secondary);
}

.key-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.key-row .text-input {
  flex: 1;
}

.inline-message {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--uta-secondary);
}

.inline-message.is-error {
  color: var(--uta-error);
}

.inline-retry {
  margin-left: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 650;
  text-decoration: underline;
  cursor: pointer;
}

.inline-retry:disabled {
  opacity: 0.55;
  cursor: default;
  text-decoration: none;
}

.preview-hint {
  font-size: 11.5px;
  color: var(--uta-secondary);
}

.preview-status {
  margin: 12px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--uta-secondary);
}

.preview-status[data-status="error"] {
  color: var(--uta-error);
}

.preview-status[data-status="success"] {
  color: var(--uta-success);
}

.config-read-retry {
  margin-top: 8px;
}

@media (max-width: 700px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
  .key-row {
    flex-wrap: wrap;
  }
  .setting-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
  .slider-control {
    width: 100%;
  }
}
</style>
