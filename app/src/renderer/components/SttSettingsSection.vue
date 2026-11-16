<template>
  <section class="settings-panel stt-service-panel" aria-label="语音输入">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">语音输入</span>
        <h3 class="panel-title">是否听取，以及怎样识别</h3>
        <p class="panel-hint">开启后可以用快捷键或桌宠侧边麦克风说话。识别结果默认只填入输入框，由你确认后再发送。</p>
      </div>
      <span class="panel-badge" :class="{ 'is-positive': enabled, 'is-warning': !loaded }">
        <span class="status-dot" :class="{ 'is-on': enabled, 'is-warn': !loaded }" />
        {{ loaded ? (enabled ? '已开启' : '未开启') : '正在读取' }}
      </span>
    </div>

    <fieldset class="stt-form" :disabled="!loaded">
      <div class="setting-row">
        <div class="row-copy">
          <span class="row-label">允许语音输入</span>
          <p class="row-desc">用快捷键或麦克风按钮开始、停止录音；不会在后台常听。</p>
        </div>
        <button
          type="button"
          class="switch"
          role="switch"
          :aria-checked="enabled"
          aria-label="允许语音输入"
          :class="{ 'is-on': enabled }"
          :disabled="!loaded"
          @click="toggleEnabled"
        >
          <span class="switch-thumb" />
        </button>
      </div>

      <template v-if="enabled">
        <span class="field-label">识别方式</span>
        <div class="choice-grid" role="group" aria-label="识别方式">
          <button
            type="button"
            class="choice-card"
            :class="{ 'is-active': form.provider === 'cloud' }"
            :aria-pressed="form.provider === 'cloud'"
            @click="setProvider('cloud')"
          >
            <span class="choice-copy">
              <span class="choice-title">云端识别</span>
              <span class="choice-desc">使用在线语音转写服务，需要 API 密钥。</span>
            </span>
          </button>
          <button
            type="button"
            class="choice-card"
            :class="{ 'is-active': form.provider === 'local' }"
            :aria-pressed="form.provider === 'local'"
            @click="setProvider('local')"
          >
            <span class="choice-copy">
              <span class="choice-title">本地识别</span>
              <span class="choice-desc">连接本机回环地址上的识别服务，音频不出本机。</span>
            </span>
          </button>
        </div>

        <template v-if="form.provider === 'cloud'">
          <span class="field-label">云服务</span>
          <div class="backend-row" role="group" aria-label="云识别服务">
            <button
              v-for="item in cloudBackends"
              :key="item.id"
              type="button"
              class="chip-btn"
              :class="{ 'is-active': form.backend === item.id }"
              @click="selectBackend(item.id)"
            >
              {{ item.label }}
            </button>
          </div>

          <div class="field-grid">
            <label class="field-block">
              <span class="field-name">接口地址</span>
              <input v-model.trim="form.endpoint" class="text-input" spellcheck="false" @change="scheduleSave" />
            </label>
            <label class="field-block">
              <span class="field-name">模型</span>
              <input v-model.trim="form.model" class="text-input" spellcheck="false" @change="scheduleSave" />
            </label>
            <label class="field-block">
              <span class="field-name">语言</span>
              <input v-model.trim="form.language" class="text-input" placeholder="zh" @change="scheduleSave" />
            </label>
          </div>

          <label class="field-block">
            <span class="field-name">API 密钥</span>
            <div class="key-row">
              <input
                v-model="apiKey"
                class="text-input"
                type="password"
                autocomplete="off"
                :placeholder="hasApiKey ? '已保存，留空则不修改' : '填入云端识别服务的 API Key'"
              />
              <button v-if="hasApiKey" type="button" class="uta-button is-secondary" :disabled="saving" @click="clearKey">
                清除密钥
              </button>
            </div>
            <span class="field-help">密钥单独保存，不随其他设置自动提交。</span>
          </label>
        </template>

        <template v-else>
          <label class="field-block">
            <span class="field-name">本地识别接口</span>
            <input
              v-model.trim="form.localEndpoint"
              class="text-input"
              spellcheck="false"
              placeholder="http://127.0.0.1:18530/stt"
              @change="scheduleSave"
            />
            <span class="field-help">默认兼容 MaiBot 的 SenseVoice 桥（127.0.0.1:18530/stt），也可以填 whisper.cpp 或 faster-whisper 等本地服务。</span>
          </label>
        </template>

        <div class="panel-divider" />
        <div class="setting-row">
          <div class="row-copy">
            <span class="row-label">识别后直接发送</span>
            <p class="row-desc">开启后识别完成即发给当前宿主；关闭时会先填入桌宠输入框。</p>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="form.autoSend"
            aria-label="识别后直接发送"
            :class="{ 'is-on': form.autoSend }"
            :disabled="!loaded"
            @click="toggleAutoSend"
          >
            <span class="switch-thumb" />
          </button>
        </div>

        <p class="settings-note">
          <template v-if="voiceShortcut">按 <strong>{{ voiceShortcut }}</strong> 开始或停止录音；</template>
          <template v-else>当前实例没有抢到语音快捷键（可能被其他程序或另一个 Uta 占用），请使用桌宠侧边的麦克风按钮；</template>
          不自动发送时会先填入输入框。云端密钥只在本机加密保存，本地接口只允许回环地址。
        </p>
      </template>

      <p v-else class="settings-note">开启后就能用语音输入替代键盘。识别服务可以稍后再配置。</p>
    </fieldset>

    <p v-if="apiKey.trim()" class="inline-message is-warning">新密钥尚未保存；关闭设置时会提醒你保存或放弃。</p>
    <p v-if="message" class="inline-message" :data-status="saveStatus" role="status" aria-live="polite">{{ message }}</p>
    <div class="settings-action-row">
      <button type="button" class="uta-button is-primary" :disabled="saving || !loaded" @click="saveNow()">
        {{ saving ? '保存中…' : form.provider === 'cloud' ? '保存识别配置与密钥' : '保存识别配置' }}
      </button>
      <button v-if="!loaded" type="button" class="uta-button is-secondary" :disabled="loading" @click="loadConfig">
        {{ loading ? '正在读取…' : '重新读取识别配置' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { queueSttConfigOperation } from '../services/stt-config-queue'
import { registerUnsavedDraft } from '../services/unsaved-drafts'

const cloudBackends = [
  { id: 'siliconflow', label: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions', model: 'FunAudioLLM/SenseVoiceSmall' },
  { id: 'groq', label: 'Groq', endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' },
  { id: 'custom', label: '自定义', endpoint: '', model: '' },
] as const

const form = reactive<{
  provider: 'cloud' | 'local'
  backend: 'siliconflow' | 'groq' | 'openai' | 'custom'
  endpoint: string
  model: string
  language: string
  localEndpoint: string
  autoSend: boolean
}>({
  provider: 'cloud',
  backend: 'siliconflow',
  endpoint: cloudBackends[0].endpoint,
  model: cloudBackends[0].model,
  language: 'zh',
  localEndpoint: 'http://127.0.0.1:18530/stt',
  autoSend: false,
})
const enabled = ref(false)
const hasApiKey = ref(false)
const apiKey = ref('')
const saving = ref(false)
const message = ref('')
const voiceShortcut = ref('')
const loaded = ref(false), loading = ref(false)
const saveStatus = ref<'idle' | 'saving' | 'success' | 'error'>('idle')
type SttPayload = Parameters<UtaAPI['saveSttConfig']>[0]
type SttResult = Awaited<ReturnType<UtaAPI['saveSttConfig']>>
let disposed = false, queued = false
let queuedKey = ''
let queuedClear = false
let lastPersistedEnabled = false
let lastPersistedAutoSend = false
const saveWaiters: Array<(ok: boolean) => void> = []
let lastSaved = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function currentPayload() { return { enabled: enabled.value, ...form } }
function enqueueWrite(payload: SttPayload): Promise<SttResult | null> {
  const run = async () => await window.utaAPI?.saveSttConfig?.(payload) ?? null
  return queueSttConfigOperation(run)
}

function stopSaveTimer() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function scheduleSave() {
  if (!loaded.value || disposed) return
  stopSaveTimer()
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow(false)
  }, 600)
}

async function loadConfig() {
  if (loading.value || disposed) return
  loading.value = true
  message.value = '正在读取识别配置…'
  try {
    const config = await queueSttConfigOperation(async () => await window.utaAPI?.getSttConfig?.() ?? null)
    if (disposed) return
    if (!config) throw Error('unavailable')
    if (config.readError === 'config-unreadable' || config.readError === 'config-corrupt') {
      throw Error(config.readError)
    }
    applyConfig(config)
    loaded.value = true
    lastSaved = JSON.stringify(currentPayload())
    saveStatus.value = 'idle'
    message.value = config.readError === 'decrypt-failed'
      ? '识别密钥无法解密；普通识别设置仍可保存，重新填写并保存密钥可修复。'
      : ''
  } catch {
    if (!disposed) { saveStatus.value = 'error'; message.value = '识别配置读取失败，未用默认值替换原配置。请重新读取。' }
  } finally { if (!disposed) loading.value = false }
}

function applyConfig(config: {
  enabled: boolean
  provider: 'cloud' | 'local'
  backend: 'siliconflow' | 'groq' | 'openai' | 'custom'
  endpoint: string
  model: string
  language: string
  localEndpoint: string
  autoSend: boolean
  hasApiKey: boolean
}) {
  enabled.value = config.enabled
  hasApiKey.value = config.hasApiKey
  lastPersistedEnabled = config.enabled
  lastPersistedAutoSend = config.autoSend
  form.provider = config.provider
  form.backend = config.backend
  form.endpoint = config.endpoint
  form.model = config.model
  form.language = config.language
  form.localEndpoint = config.localEndpoint
  form.autoSend = config.autoSend
}

async function saveNow(includeKey = true, clearingKey = false, keyOverride?: string): Promise<boolean> {
  if (!loaded.value || disposed) {
    for (const resolve of saveWaiters.splice(0)) resolve(false)
    return false
  }
  if (saving.value) {
    queued = true
    if (clearingKey) {
      queuedKey = ''
      queuedClear = true
    } else if (includeKey) {
      // 排队期间用户可能改动密钥；这里固定按下保存那一刻的输入，绝不自动提交后来的草稿
      const pendingKey = keyOverride ?? apiKey.value.trim()
      if (pendingKey) {
        queuedKey = pendingKey
        queuedClear = false
      }
    }
    // 后到的开关需要等排队的保存真正落盘，才能判断是否回退界面状态
    return await new Promise<boolean>((resolve) => saveWaiters.push(resolve))
  }
  stopSaveTimer()
  saving.value = true
  saveStatus.value = 'saving'; message.value = '正在保存识别配置…'
  const sent = currentPayload()
  const sentKey = includeKey ? (keyOverride ?? apiKey.value.trim()) : ''
  let ok = false
  let followUp: Promise<boolean> | null = null
  try {
    const result = await enqueueWrite({
      ...sent,
      ...(clearingKey ? { clearKey: true } : sentKey ? { apiKey: sentKey } : {}),
    })
    if (!disposed && result?.ok && result.config) {
      const current = currentPayload()
      const newer = JSON.stringify(current) !== JSON.stringify(sent)
      const sameService = current.backend === sent.backend && current.endpoint === sent.endpoint
      for (const key of Object.keys(sent) as Array<keyof typeof sent>) {
        if (current[key] !== sent[key]) continue
        if (key === 'enabled') enabled.value = result.config.enabled
        else (form as unknown as Record<string, unknown>)[key] = result.config[key]
      }
      if (sameService) {
        hasApiKey.value = result.config.hasApiKey
        if (sentKey && apiKey.value.trim() === sentKey) apiKey.value = ''
      }
      lastPersistedEnabled = result.config.enabled
      lastPersistedAutoSend = result.config.autoSend
      const savedConfig = result.config as Record<string, unknown>
      lastSaved = JSON.stringify(Object.fromEntries(Object.keys(sent).map(key => [key, savedConfig[key]])))
      saveStatus.value = 'success'
      message.value = newer ? '上次配置已保存，新输入仍保留并将继续保存。'
        : clearingKey ? '已清除保存的识别密钥，输入框中的新密钥仍需单独保存。'
          : sent.provider === 'local' ? '本地识别配置已保存。'
            : result.config.hasApiKey ? '识别配置已保存。' : '识别配置已保存，云端服务还需要密钥。'
      if (newer) queued = true
      ok = true
    } else if (!disposed) {
      const code = result?.error ?? ''
      saveStatus.value = 'error'
      message.value = code === 'config-unreadable' || code === 'config-corrupt'
        ? '识别配置读取失败，原文件未被覆盖。请重新读取后再保存。'
        : '识别配置保存失败，输入仍保留。请点击保存重试。'
    }
  } catch {
    if (!disposed) { saveStatus.value = 'error'; message.value = '识别配置保存失败，输入仍保留。请检查服务地址和文件权限后重试。' }
  } finally {
    if (disposed) {
      queuedKey = ''
      queuedClear = false
      for (const resolve of saveWaiters.splice(0)) resolve(false)
    } else {
      saving.value = false
      if (queued) {
        queued = false
        const nextKey = queuedKey
        const nextClear = queuedClear
        queuedKey = ''
        queuedClear = false
        followUp = saveNow(Boolean(nextKey) || nextClear, nextClear, nextKey || undefined)
      } else for (const resolve of saveWaiters.splice(0)) resolve(ok)
    }
  }
  // 排队链上的调用也要看到最后一次落盘的结果，避免把失败或成功判断错位
  return followUp ? await followUp : ok
}

async function toggleEnabled() {
  if (!loaded.value) return
  const next = !enabled.value
  enabled.value = next
  const ok = await saveNow(false)
  if (!ok && enabled.value === next) enabled.value = lastPersistedEnabled
}

async function toggleAutoSend() {
  const next = !form.autoSend
  form.autoSend = next
  const ok = await saveNow(false)
  if (!ok && form.autoSend === next) form.autoSend = lastPersistedAutoSend
}

async function setProvider(provider: 'cloud' | 'local') {
  form.provider = provider
  await saveNow(false)
}

async function selectBackend(id: 'siliconflow' | 'groq' | 'openai' | 'custom') {
  const item = cloudBackends.find((entry) => entry.id === id)
  if (!item) return
  form.backend = id
  form.endpoint = item.endpoint
  form.model = item.model
  apiKey.value = ''; hasApiKey.value = false
  await saveNow(false)
}

async function clearKey() {
  if (saving.value) return
  await saveNow(false, true)
}

async function loadVoiceShortcut() {
  try {
    const state = await window.utaAPI?.getUiState?.()
    voiceShortcut.value = state?.voiceShortcut
      ? String(state.voiceShortcut).replace('CommandOrControl', 'Ctrl')
      : ''
  } catch {
    /* 快捷键状态读不到时保持空，提示使用麦克风按钮 */
  }
}

const unregisterSecretDraft = registerUnsavedDraft('stt-cloud-key', {
  label: '云端识别 API 密钥',
  kind: 'secret',
  isDirty: () => apiKey.value.trim().length > 0,
  save: () => saveNow(true),
})

onMounted(() => {
  void loadConfig()
  void loadVoiceShortcut()
})

onUnmounted(() => {
  unregisterSecretDraft()
  stopSaveTimer()
  // Finish only ordinary fields. An unsubmitted key is never attached to this write.
  if (loaded.value && JSON.stringify(currentPayload()) !== lastSaved) void enqueueWrite(currentPayload()).catch(() => {})
  disposed = true; queued = false
})
</script>

<style scoped>
.stt-form {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 0;
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
  font-size: 13.5px;
  font-weight: 650;
  color: var(--uta-ink);
}

.row-desc {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--uta-secondary);
}

.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 46px;
  height: 26px;
  padding: 2px;
  border: 1px solid var(--uta-separator);
  border-radius: 8px;
  background-color: var(--uta-canvas);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease;
}

.switch.is-on {
  background-color: var(--uta-accent);
  border-color: var(--uta-accent);
}

.switch:disabled {
  opacity: 0.45;
  cursor: default;
}

.switch:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: 2px;
}

.switch-thumb {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background-color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 1px 1px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1),
    width 0.16s ease,
    background-color 0.2s ease;
  transform: translateX(0);
}

.switch:active:not(:disabled) .switch-thumb {
  width: 24px;
}

.switch.is-on .switch-thumb {
  transform: translateX(20px);
}

.switch.is-on:active:not(:disabled) .switch-thumb {
  transform: translateX(16px);
  width: 24px;
}

.field-label {
  display: block;
  margin: 16px 0 8px;
  font-size: 12px;
  font-weight: 650;
  color: var(--uta-secondary);
}

.backend-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip-btn {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--uta-separator);
  border-radius: 999px;
  background-color: var(--uta-canvas);
  color: var(--uta-ink);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.chip-btn.is-active {
  border-color: var(--uta-accent);
  background-color: var(--uta-accent-soft);
  color: var(--uta-accent-read);
  font-weight: 650;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
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

.field-help {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--uta-secondary);
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

.inline-message.is-warning {
  color: var(--uta-warning);
}

.inline-message[data-status="error"] {
  color: var(--uta-error);
}

.inline-message[data-status="success"] {
  color: var(--uta-success);
}

.stt-form:disabled {
  opacity: 1;
}

@media (max-width: 700px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
  .setting-row {
    align-items: flex-start;
    gap: 10px;
  }
  .key-row {
    flex-wrap: wrap;
  }
}
</style>
