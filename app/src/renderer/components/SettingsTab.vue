<template>
  <div class="settings-tab-root">
    <!-- 1. 外观模式与自定义取色 -->
    <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 0">
      <div class="oat-eyebrow-row">
        <span class="oat-eyebrow">外观与主题配色</span>
      </div>

      <div class="studio-mode-strip">
        <button
          type="button"
          class="studio-mode-btn pressable"
          :class="{ active: store.themeMode === 'light' }"
          @click="store.themeMode = 'light'"
        >
          日间模式
        </button>
        <button
          type="button"
          class="studio-mode-btn pressable"
          :class="{ active: store.themeMode === 'dark' }"
          @click="store.themeMode = 'dark'"
        >
          夜间模式
        </button>
      </div>

      <div class="swatch-bar">
        <button
          v-for="preset in THEME_ACCENT_PRESETS"
          :key="preset.color"
          type="button"
          class="swatch-dot pressable"
          :class="{ active: store.accentColor.toLowerCase() === preset.color.toLowerCase() }"
          :style="{ background: preset.color }"
          :title="preset.name"
          @click="store.accentColor = preset.color"
        />
        <label class="custom-color-pill pressable" title="打开系统调色盘自由取色">
          <input
            type="color"
            :value="store.accentColor"
            @input="onAccentColorInput"
          />
          <span class="custom-color-preview" :style="{ background: store.accentColor }" />
          <span>自定义取色</span>
        </label>
      </div>

      <label class="bio-field-label">窗口交互开关</label>
      <div class="ctrl-capsule-grid">
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.hoverFadeEnabled }"
          title="鼠标移入桌宠窗口时自动降低不透明度"
          @click="store.hoverFadeEnabled = !store.hoverFadeEnabled"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">悬停半透明</span>
          <span class="ctrl-state-tag">{{ store.hoverFadeEnabled ? '已开' : '已关' }}</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.clickThroughLocked }"
          title="开启后鼠标点击直接穿透桌宠窗口（可在系统托盘解除）"
          @click="toggleClickThroughLock"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">鼠标穿透</span>
          <span class="ctrl-state-tag">{{ store.clickThroughLocked ? '已开' : '已关' }}</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.gazeFollowEnabled }"
          title="关闭后角色视线固定在正前方，不再跟随鼠标移动"
          @click="store.gazeFollowEnabled = !store.gazeFollowEnabled"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">视线跟随</span>
          <span class="ctrl-state-tag">{{ store.gazeFollowEnabled ? '已开' : '已关' }}</span>
        </button>
      </div>

      <label class="bio-field-label">渲染刷新率</label>
      <div class="ctrl-capsule-grid">
        <button
          v-for="opt in renderFpsOptions"
          :key="opt.id"
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: renderFpsMode === opt.id }"
          :title="opt.id === 'auto' ? '跟随当前显示器的刷新率' : `渲染上限 ${opt.label}`"
          @click="onSelectRenderFps(opt.id)"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">{{ opt.label }}</span>
        </button>
      </div>
      <div class="host-option-capsule-row">
        <button
          type="button"
          class="ctrl-capsule full-row pressable"
          :class="{ active: adaptiveIdleEnabled }"
          title="鼠标停止移动几秒后降到 30fps；任意移动鼠标立即恢复所选上限"
          @click="onToggleAdaptiveIdle"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">空闲自动降帧</span>
          <span class="ctrl-state-tag">{{ adaptiveIdleEnabled ? '已开启' : '已关闭' }}</span>
        </button>
      </div>
      <p class="render-fps-hint">
        越高越顺滑，CPU 占用也越高；自适应跟随当前显示器{{ displayHz ? `（${displayHz}Hz）` : '' }}。
        开启空闲降帧后，鼠标停止移动约 5 秒会降到 30fps，任意移动鼠标立即恢复。
      </p>

      <label class="bio-field-label">左上角圆点快捷功能</label>
      <div class="ctrl-capsule-grid">
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.orbAction === 'model_picker' }"
          @click="store.orbAction = 'model_picker'"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">呼出模型栏</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.orbAction === 'toggle_display_mode' }"
          @click="store.orbAction = 'toggle_display_mode'"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">切立绘/L2D</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.orbAction === 'color_picker' }"
          @click="store.orbAction = 'color_picker'"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">打开调色盘</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: store.orbAction === 'toggle_theme' }"
          @click="store.orbAction = 'toggle_theme'"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">切换日夜间</span>
        </button>
      </div>
    </div>

    <div class="oat-well">
      <p class="bio-hint">语音播报与语音输入统一在“语音”中配置。</p>
      <button type="button" class="ctrl-capsule full-row pressable" @click="emit('open-voice')">打开语音设置</button>
    </div>

    <!-- 2. 展示模式与模型包 -->
    <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 1">
      <div class="oat-eyebrow-row">
        <span class="oat-eyebrow">展示模式与模型</span>
        <span class="bio-fold-badge">{{ filteredModels.length }} 个可用</span>
      </div>

      <div class="studio-mode-strip">
        <button
          type="button"
          class="studio-mode-btn pressable"
          :class="{ active: displayMode === 'live2d' }"
          :disabled="switching || !models.some((m) => m.kind === 'live2d')"
          @click="onSetDisplayMode('live2d')"
        >
          Live2D 模型
        </button>
        <button
          type="button"
          class="studio-mode-btn pressable"
          :class="{ active: displayMode === 'image-set' }"
          :disabled="switching || !models.some((m) => m.kind === 'image-set')"
          @click="onSetDisplayMode('image-set')"
        >
          静态立绘
        </button>
      </div>

      <!-- 自定义有机展开模型选择列表 -->
      <div class="bio-model-picker" :class="{ open: settingsModelListOpen }">
        <button
          type="button"
          class="bio-model-trigger pressable"
          :disabled="switching"
          :aria-expanded="settingsModelListOpen"
          @click="settingsModelListOpen = !settingsModelListOpen"
        >
          <span class="ctrl-dot active-dot" />
          <span class="bio-model-trigger-name">{{ currentModelDisplayName }}</span>
          <svg class="bio-fold-arrow" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div
          class="bio-fold-collapse"
          :class="{ open: settingsModelListOpen }"
          :inert="!settingsModelListOpen"
        >
          <div class="bio-fold-inner">
            <div class="bio-model-list settings-model-list">
              <div v-if="filteredModels.length === 0" class="bio-model-empty">
                未发现{{ displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包' }}
              </div>
              <button
                v-for="m in filteredModels"
                :key="m.url"
                type="button"
                class="bio-model-item pressable"
                :class="{ active: selectedModel === m.url }"
                :disabled="switching"
                @click="onSelectModel(m.url)"
              >
                <span class="ctrl-dot" />
                <span class="bio-model-item-name">{{ m.name }}</span>
                <span v-if="selectedModel === m.url" class="bio-model-item-tag">当前</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="oat-hero-actions">
        <button
          type="button"
          class="bio-btn-pill pressable"
          :disabled="switching"
          @click="onRescan"
        >
          刷新列表
        </button>
        <button
          type="button"
          class="bio-btn-pill pressable"
          @click="onOpenModelsFolder"
        >
          模型目录
        </button>
        <button
          type="button"
          class="bio-btn-pill pressable"
          @click="onReload"
        >
          重新加载窗口
        </button>
      </div>
    </div>

    <!-- 3. Agent 工作型宿主 (Work / Agent Hosts) -->
    <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 2">
      <div class="oat-eyebrow-row">
        <span class="oat-eyebrow">Agent 工作型宿主</span>
        <div class="host-header-actions">
          <span
            class="bio-fold-badge"
            :class="{ accent: hostStatus?.runtimeEndpointReady }"
          >
            {{ hostStatus?.runtimeEndpointReady ? '服务正常' : '未就绪' }}
          </span>
          <button
            type="button"
            class="bio-sec-link pressable"
            :disabled="isReconnecting"
            @click="doReconnect"
            title="手动重新连接当前选定的宿主"
          >
            <span :class="{ 'spin-icon': isReconnecting }">⟳</span>
            {{ isReconnecting ? '连接中...' : '重新连接' }}
          </button>
        </div>
      </div>

      <label class="bio-field-label">代码与自动化工作环境</label>
      <div class="ctrl-capsule-grid host-capsule-grid">
        <button
          v-for="h in agentHosts"
          :key="h.id"
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: hostPreference === h.id }"
          :title="h.description || `连接 ${h.label}`"
          @click="onSelectPreference(h.id)"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">{{ h.label }}</span>
          <span class="ctrl-state-tag">{{ h.id === currentHostId && currentHostState === 'connected' ? '在线' : (hostPreference === h.id ? '已选' : '选择') }}</span>
        </button>
        <button
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: hostPreference === 'standalone' }"
          title="纯本地桌宠待命，不主动连接外部宿主"
          @click="onSelectPreference('standalone')"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">独立运行</span>
          <span class="ctrl-state-tag">Local</span>
        </button>
      </div>

      <div class="host-option-capsule-row">
        <button
          type="button"
          class="ctrl-capsule full-row pressable"
          :class="{ active: summonOnHostStart }"
          title="宿主会话开始时，如果桌宠被隐藏，会重新显示（不抢键盘焦点）"
          @click="onToggleSummon"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">宿主启动时呼出桌宠</span>
          <span class="ctrl-state-tag">{{ summonOnHostStart ? '已开启' : '已关闭' }}</span>
        </button>
      </div>
    </div>

    <!-- 4. 平台与伴侣适配器 (Platform & Companion Adapters) -->
    <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 3">
      <div class="oat-eyebrow-row">
        <span class="oat-eyebrow">第三方宿主适配器</span>
        <div class="host-header-actions">
          <button
            type="button"
            class="bio-sec-link pressable"
            title="打开 %APPDATA%\\uta\\adapters，放入声明式插件目录"
            @click="openAdaptersFolder"
          >
            插件目录
          </button>
        </div>
      </div>

      <div class="ctrl-capsule-grid host-capsule-grid">
        <button
          v-for="entry in adapterPluginOptions"
          :key="entry.key"
          type="button"
          class="ctrl-capsule pressable"
          :class="{ active: entry.loaded && hostPreference === entry.id, unloaded: !entry.loaded }"
          :disabled="!entry.loaded"
          :title="entry.loaded ? (entry.description || `连接 ${entry.label}`) : (entry.error || '插件未加载')"
          @click="entry.loaded && onSelectPreference(entry.id)"
        >
          <span class="ctrl-dot" />
          <span class="ctrl-name">{{ entry.label }}</span>
          <span class="ctrl-state-tag">{{
            !entry.loaded
              ? '未加载'
              : (entry.id === currentHostId && currentHostState === 'connected'
                ? '在线'
                : (hostPreference === entry.id ? '已选' : '连接'))
          }}</span>
        </button>
      </div>

      <div v-if="hasUnloadedAdapters" class="adapter-plugin-note">
        标为「未加载」的插件清单缺失或校验失败，可打开插件目录修复。
      </div>

      <AdapterPluginSettings
        v-if="selectedPluginManifest"
        :manifest="selectedPluginManifest"
        @apply="onPluginConfigApply"
      />

      <!-- 实时绑定摘要 -->
      <div class="host-bridge-summary">
        <div class="host-bridge-item">
          <span class="host-bridge-label">当前实时绑定</span>
          <span class="host-bridge-val">
            <strong>{{ getHostDisplayName(currentHostId) }}</strong>
            <span class="conn-state-indicator" :class="currentHostState">
              {{ currentHostState === 'connected' ? '（🟢 已连接）' : (currentHostState === 'connecting' ? '（🟡 探测连接中）' : '（⚪ 待命/离线）') }}
            </span>
          </span>
        </div>
        <div class="host-bridge-item">
          <span class="host-bridge-label">通道能力</span>
          <span class="host-bridge-val">{{ getHostChannelDescription(currentHostId) }}</span>
        </div>
      </div>
    </div>

    <!-- 5. 运行环境身份与诊断 -->
    <RuntimeDiagnostics />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useDeskpetStore, THEME_ACCENT_PRESETS } from '@/stores/deskpet'
import {
  applyRenderFpsMode,
  getAdaptiveIdleEnabled,
  getRenderFpsMode,
  setAdaptiveIdleEnabled,
  setRenderFpsMode,
  type RenderFpsMode,
} from '@/services/render-fps'
import {
  getAgentHosts,
  findHost,
  type HostPreference,
} from '@/services/adapters'
import { adapterPluginEntries } from '@/services/adapters/plugin-loader'
import {
  getActiveHostId,
  getActiveAdapter,
  getHostPreference,
  setHostPreference,
  reconnectActiveHost,
  onHostChanged,
} from '@/services/adapters/active'
import type { ModelKind } from '@/services/live2d/model-discovery'
import AdapterPluginSettings from './AdapterPluginSettings.vue'
import RuntimeDiagnostics from './RuntimeDiagnostics.vue'

interface ModelOption {
  url: string
  name: string
  kind: ModelKind
}

const props = defineProps<{
  models: ModelOption[]
  filteredModels: ModelOption[]
  selectedModel: string
  switching: boolean
  displayMode: ModelKind
  currentModelDisplayName: string
}>()

const emit = defineEmits<{
  'select-model': [url: string]
  'set-display-mode': [kind: ModelKind]
  rescan: []
  'open-models-folder': []
  reload: []
  'open-voice': []
}>()

const store = useDeskpetStore()
const settingsModelListOpen = ref(false)

function onAccentColorInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (value) store.accentColor = value
}

function toggleClickThroughLock() {
  const next = !store.clickThroughLocked
  store.clickThroughLocked = next
  void window.utaAPI?.setClickThroughLocked?.(next)
}

const renderFpsOptions: Array<{ id: RenderFpsMode; label: string }> = [
  { id: '30', label: '30 fps' },
  { id: '60', label: '60 fps' },
  { id: '120', label: '120 fps' },
  { id: 'auto', label: '自适应' },
]
const renderFpsMode = ref<RenderFpsMode>(getRenderFpsMode())
const adaptiveIdleEnabled = ref(getAdaptiveIdleEnabled())
const displayHz = ref<number | null>(null)

async function refreshDisplayHz() {
  try {
    displayHz.value = (await window.utaAPI?.getDisplayRefreshRate?.()) ?? null
  } catch {
    displayHz.value = null
  }
}

async function onSelectRenderFps(mode: RenderFpsMode) {
  renderFpsMode.value = mode
  setRenderFpsMode(mode)
  await applyRenderFpsMode(mode)
  if (mode === 'auto') void refreshDisplayHz()
}

function onToggleAdaptiveIdle() {
  adaptiveIdleEnabled.value = !adaptiveIdleEnabled.value
  setAdaptiveIdleEnabled(adaptiveIdleEnabled.value)
}

const hostStatus = ref<HostStatus | null>(null)
const agentHosts = computed(() => getAgentHosts())
const hostPreference = ref<HostPreference>(getHostPreference())
const currentHostId = ref<string>(getActiveHostId())
const currentHostState = ref<string>(getActiveAdapter().getConnectionState())
const isReconnecting = ref(false)
const summonOnHostStart = ref(true)

const adapterPluginOptions = computed(() =>
  adapterPluginEntries.value.map((entry) => {
    const manifest = entry.manifest
    const loaded = entry.loaded && !!manifest
    return {
      key: entry.key,
      id: manifest && loaded ? manifest.id : entry.key,
      label: manifest?.name ?? (entry.dir ? `未加载：${entry.dir}` : '未加载插件'),
      description: manifest?.description ?? '',
      error: entry.error ?? '',
      loaded,
    }
  }),
)

const selectedPluginManifest = computed(() => {
  const entry = adapterPluginEntries.value.find(
    (item) => item.loaded && item.manifest?.id === hostPreference.value,
  )
  return entry?.manifest ?? null
})

const hasUnloadedAdapters = computed(() =>
  adapterPluginEntries.value.some((entry) => !entry.loaded),
)

async function openAdaptersFolder() {
  try {
    await window.utaAPI?.openAdaptersFolder?.()
  } catch {
    /* ignore */
  }
}

async function onPluginConfigApply() {
  await reconnectActiveHost().catch(() => {})
  currentHostId.value = getActiveHostId()
  currentHostState.value = getActiveAdapter().getConnectionState()
}

function getHostDisplayName(id: string): string {
  if (id === 'standalone' || id === 'fake') return '独立待命'
  const registration = findHost(id as any)
  return registration ? registration.label : id
}

function getHostChannelDescription(id: string): string {
  const registration = findHost(id)
  if (registration?.manifest) {
    return registration.manifest.description || '按插件配置连接的自定义宿主'
  }
  switch (id) {
    case 'qoder':
      return 'MCP 角色工具 + 钩子状态联动（只读）'
    case 'codex':
      return 'MCP 角色工具 + 生命周期钩子（只读）'
    case 'claude-code':
      return 'MCP 角色工具 + Claude Code 生命周期钩子（只读）'
    case 'zcode':
      return 'MCP 角色工具 + ZCode 生命周期钩子（只读）'
    case 'opencode':
      return 'OpenCode 原生插件事件与权限审批联动'
    case 'deepseek-harness':
      return 'DeepSeek Harness 原生工具流与任务审批'
    case 'fake':
    case 'standalone':
      return '本地独立运行（不主动向外部发送网络请求）'
    default:
      return '通道就绪'
  }
}

function onSelectPreference(pref: HostPreference) {
  hostPreference.value = pref
  setHostPreference(pref)
  currentHostId.value = getActiveHostId()
  currentHostState.value = getActiveAdapter().getConnectionState()
}

async function doReconnect() {
  isReconnecting.value = true
  try {
    await reconnectActiveHost().catch(() => {})
    currentHostId.value = getActiveHostId()
    currentHostState.value = getActiveAdapter().getConnectionState()
  } finally {
    isReconnecting.value = false
  }
}

async function loadSummonPreference() {
  try {
    const value = await window.utaAPI?.getSummonOnHostStart?.()
    if (typeof value === 'boolean') summonOnHostStart.value = value
  } catch {
    /* 主进程不可用时保留默认值 */
  }
}

function onToggleSummon() {
  summonOnHostStart.value = !summonOnHostStart.value
  void window.utaAPI?.setSummonOnHostStart?.(summonOnHostStart.value)
}

async function refreshHostStatus() {
  try {
    const status = await window.utaAPI?.getHostStatus?.()
    if (status) hostStatus.value = status
  } catch {
    /* ignore */
  }
}

function onSelectModel(url: string) {
  settingsModelListOpen.value = false
  emit('select-model', url)
}

function onSetDisplayMode(kind: ModelKind) {
  emit('set-display-mode', kind)
}

function onRescan() {
  emit('rescan')
}

function onOpenModelsFolder() {
  emit('open-models-folder')
}

function onReload() {
  emit('reload')
}

let unsubscribeHostChanged: (() => void) | null = null

onMounted(() => {
  unsubscribeHostChanged = onHostChanged((id, state) => {
    currentHostId.value = id
    currentHostState.value = state
  })
  void refreshHostStatus()
  void loadSummonPreference()
  renderFpsMode.value = getRenderFpsMode()
  adaptiveIdleEnabled.value = getAdaptiveIdleEnabled()
  void refreshDisplayHz()
})

onUnmounted(() => {
  unsubscribeHostChanged?.()
  unsubscribeHostChanged = null
})
</script>
