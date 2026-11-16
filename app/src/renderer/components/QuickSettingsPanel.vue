<template>
  <Transition name="quick-settings">
    <section
      v-if="open"
      class="quick-settings"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`]"
      role="dialog"
      aria-label="快捷设置"
      @mousedown.stop
      @click.stop
      @dblclick.stop
      @wheel.stop
      @contextmenu.stop.prevent
    >
      <header class="qs-head">
        <span class="qs-eyebrow">快捷设置</span>
        <button type="button" class="qs-close" title="关闭快捷设置" aria-label="关闭快捷设置" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </header>

      <div class="qs-body">
        <section class="qs-model-block" aria-label="模型">
          <button
            type="button"
            class="qs-model-block-head"
            :aria-expanded="modelMenuOpen"
            aria-controls="qs-model-drawer"
            @click="modelMenuOpen = !modelMenuOpen"
          >
            <span class="qs-model-block-copy">
              <span class="qs-section-title">模型</span>
              <strong class="qs-model-block-name" :title="currentUrl || currentModelName">{{ currentModelName }}</strong>
            </span>
            <svg class="qs-chevron" :class="{ open: modelMenuOpen }" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <Transition name="qs-drawer">
            <div v-if="modelMenuOpen" id="qs-model-drawer" class="qs-model-drawer" role="region" aria-label="选择模型">
              <div class="qs-drawer-head">
                <div class="qs-segmented" role="group" aria-label="模型展示方式">
                  <span
                    class="qs-segmented-slider"
                    :class="{ 'to-right': displayMode === 'image-set' }"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    :class="{ active: displayMode === 'live2d' }"
                    :aria-pressed="displayMode === 'live2d'"
                    :disabled="switching || !models.some((model) => model.kind === 'live2d')"
                    @click="setDisplayMode('live2d')"
                  >
                    Live2D
                  </button>
                  <button
                    type="button"
                    :class="{ active: displayMode === 'image-set' }"
                    :aria-pressed="displayMode === 'image-set'"
                    :disabled="switching || !models.some((model) => model.kind === 'image-set')"
                    @click="setDisplayMode('image-set')"
                  >
                    静态立绘
                  </button>
                </div>
                <button type="button" class="qs-text-btn" :disabled="scanning || switching" title="刷新模型列表" @click="rescan">
                  {{ scanning ? '扫描中…' : '刷新' }}
                </button>
              </div>

              <div class="qs-model-list" role="group" aria-label="可用模型">
                <button
                  v-for="model in filteredModels"
                  :key="model.url"
                  type="button"
                  class="qs-model-row"
                  :aria-pressed="model.url === store.modelUrl"
                  :class="{ active: model.url === store.modelUrl }"
                  :disabled="switching"
                  :title="model.name"
                  @click="selectModel(model.url)"
                >
                  <span class="qs-model-dot" aria-hidden="true" />
                  <span class="qs-model-name">{{ modelDisplayLabel(model) }}</span>
                  <span v-if="model.url === store.modelUrl" class="qs-model-tag">当前</span>
                </button>
                <p v-if="filteredModels.length === 0" class="qs-empty">
                  {{ scanning ? '正在扫描模型…' : `未发现${displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包'}` }}
                </p>
              </div>

              <p v-if="statusText" class="qs-status" :class="{ error: hasError }" role="status">
                {{ statusText }}
              </p>
            </div>
          </Transition>
        </section>

        <section v-if="store.modelControls.length > 0" class="qs-section" aria-label="模型部件">
          <button
            type="button"
            class="qs-collapse-head"
            :aria-expanded="partsOpen"
            aria-controls="qs-parts-body"
            @click="partsOpen = !partsOpen"
          >
            <span class="qs-section-title">部件</span>
            <span class="qs-collapse-meta">{{ partSummary }}</span>
            <svg class="qs-chevron" :class="{ open: partsOpen }" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <Transition name="qs-drawer">
            <div v-if="partsOpen" id="qs-parts-body" class="qs-parts-body">
              <div v-for="group in partGroups" :key="group.category" class="qs-part-group">
                <span class="qs-part-group-title">{{ group.label }}</span>
                <div class="qs-toggle-list is-tight">
                  <button
                    v-for="control in group.items"
                    :key="control.id"
                    type="button"
                    class="qs-toggle qs-part-row"
                    :class="{ active: control.active }"
                    :aria-pressed="control.active"
                    :title="control.held ? `${partLabel(control)}（保持开启）` : partLabel(control)"
                    @click="togglePart(control)"
                  >
                    <span class="qs-part-name">{{ partLabel(control) }}</span>
                    <span v-if="control.stages && control.stages.length > 0" class="qs-part-stage">{{ control.stages[control.currentStageIndex ?? 0]?.label }}</span>
                    <span v-if="control.held" class="qs-part-hold">保持</span>
                    <span class="qs-switch" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p class="qs-hint">开启的部件会保持，动作和待机不会自动关闭。</p>
              <button v-if="heldPartCount > 0" type="button" class="qs-text-btn qs-clear-held" @click="store.clearHeldControls()">
                关闭全部保持部件
              </button>
            </div>
          </Transition>
        </section>

        <section class="qs-section" aria-label="宿主">
          <button
            type="button"
            class="qs-collapse-head"
            :aria-expanded="hostMenuOpen"
            aria-controls="qs-host-body"
            @click="hostMenuOpen = !hostMenuOpen"
          >
            <span class="qs-section-title">宿主</span>
            <span class="qs-collapse-meta" :title="`${boundHostLabel} · ${connectionLabel}`">
              <span class="qs-conn-dot" :class="`is-${connectionState}`" aria-hidden="true" />
              {{ boundHostLabel }}
            </span>
            <svg class="qs-chevron" :class="{ open: hostMenuOpen }" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <Transition name="qs-drawer">
            <div v-if="hostMenuOpen" id="qs-host-body" class="qs-host-body">
              <div class="qs-host-list" role="group" aria-label="可用宿主">
                <button
                  v-for="host in hostOptions"
                  :key="host.id"
                  type="button"
                  class="qs-model-row"
                  :aria-pressed="host.id === boundHostId"
                  :class="{ active: host.id === boundHostId }"
                  :disabled="hostSwitching"
                  :title="host.description"
                  @click="switchHost(host.id)"
                >
                  <span class="qs-model-dot" aria-hidden="true" />
                  <span class="qs-model-name">{{ host.label }}</span>
                  <span v-if="host.id === boundHostId" class="qs-model-tag">当前</span>
                </button>
              </div>

              <div class="qs-host-state-row">
                <span class="qs-host-state" :class="`is-${connectionState}`" role="status">
                  <span class="qs-conn-dot" :class="`is-${connectionState}`" aria-hidden="true" />
                  {{ connectionLabel }}
                </span>
                <button
                  v-if="connectionState !== 'connected'"
                  type="button"
                  class="qs-text-btn"
                  :disabled="hostSwitching"
                  @click="reconnectHost"
                >重新连接</button>
              </div>

              <p v-if="hostSwitchError" class="qs-status error" role="status">{{ hostSwitchError }}</p>
              <p v-if="hostSwitching || hostSwitchNotice" class="qs-status" role="status">
                {{ hostSwitching ? '正在切换宿主…' : hostSwitchNotice }}
              </p>
            </div>
          </Transition>
        </section>

        <section class="qs-section" aria-label="外观">
          <span class="qs-section-title">外观</span>
          <div class="qs-segmented" role="group" aria-label="日夜模式">
            <span
              class="qs-segmented-slider"
              :class="{ 'to-right': store.themeMode === 'dark' }"
              aria-hidden="true"
            />
            <button
              type="button"
              :class="{ active: store.themeMode === 'light' }"
              :aria-pressed="store.themeMode === 'light'"
              @click="store.themeMode = 'light'"
            >
              日间
            </button>
            <button
              type="button"
              :class="{ active: store.themeMode === 'dark' }"
              :aria-pressed="store.themeMode === 'dark'"
              @click="store.themeMode = 'dark'"
            >
              夜间
            </button>
          </div>
        </section>

        <section class="qs-section" aria-label="桌面交互">
          <span class="qs-section-title">桌面</span>
          <div class="qs-toggle-list">
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.hoverFadeEnabled }"
              :aria-pressed="store.hoverFadeEnabled"
              title="鼠标移入桌宠窗口时自动降低不透明度"
              @click="store.hoverFadeEnabled = !store.hoverFadeEnabled"
            >
              <span>悬停半透明</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.gazeFollowEnabled }"
              :aria-pressed="store.gazeFollowEnabled"
              title="关闭后模型视线固定在正前方"
              @click="store.gazeFollowEnabled = !store.gazeFollowEnabled"
            >
              <span>视线跟随</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.idleActionsEnabled }"
              :aria-pressed="store.idleActionsEnabled"
              title="空闲时随机做一点小动作"
              @click="store.idleActionsEnabled = !store.idleActionsEnabled"
            >
              <span>空闲小动作</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.interactionEnabled }"
              :aria-pressed="store.interactionEnabled"
              title="悬停和拖放时轻轻回应；双击打开输入框"
              @click="store.interactionEnabled = !store.interactionEnabled"
            >
              <span>点击互动</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.focusActive }"
              :aria-pressed="store.focusActive"
              title="暂停待机动作、状态解说和语音 30 分钟；审批与待办提醒照常"
              @click="store.toggleFocus()"
            >
              <span>{{ store.focusActive ? '结束专注' : '专注 30 分钟' }}</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.quietMode }"
              :aria-pressed="store.quietMode"
              title="关闭空闲小动作和状态解说；回复播报仍按语音设置"
              @click="store.quietMode = !store.quietMode"
            >
              <span>安静模式</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="qs-toggle"
              :class="{ active: store.clickThroughLocked }"
              :aria-pressed="store.clickThroughLocked"
              title="锁定后鼠标点击直接穿过桌宠；按 Ctrl+Alt+L 或从系统托盘解除"
              @click="toggleClickThrough"
            >
              <span>锁定穿透</span>
              <span class="qs-switch" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>

      <p v-if="store.settingsSaveError" class="qs-settings-error" role="alert">
        设置没有保存到本机，请重新调整一次。
      </p>

      <footer class="qs-foot">
        <button type="button" class="qs-full-btn" @click="emit('open-full-settings')">
          打开完整设置
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </footer>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getStoredModelForKind,
  getStoredModelPath,
  kindOfModelUrl,
  listAvailableModels,
  normalizeModelKey,
  type ModelKind,
} from '@/services/live2d/model-discovery'
import { useDeskpetStore } from '@/stores/deskpet'
import { filterAvailableAgentHosts, getAdapterHosts, getAgentHosts, hostDisplayName } from '@/services/adapters'
import {
  getActiveAdapter,
  getActiveHostId,
  onHostChanged,
  reconnectActiveHost,
  setBoundHostPreference,
  switchActiveHost,
  toHostId,
} from '@/services/adapters/active'
import type { HostPreference } from '@/services/adapters'
import type { ResolvedModelControl } from '@/services/live2d/emotion-adapter'
import { isWorkshopDraftDirtyElsewhere } from '@/services/workshop-draft-signal'
import {
  quickDisplayMode,
  quickModelDisplayName,
  quickModelLabels,
  quickModelsForKind,
  type QuickModelOption,
} from './quick-settings'

const props = withDefaults(
  defineProps<{
    open: boolean
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
  }>(),
  {
    popDirectionX: 'left',
    alignY: 'bottom',
  },
)

const emit = defineEmits<{
  close: []
  'open-full-settings': []
}>()

const store = useDeskpetStore()
const models = ref<QuickModelOption[]>([])
const selectedModel = ref('')
const switching = ref(false)
const scanning = ref(false)
const switchError = ref('')
const modelMenuOpen = ref(false)
const partsOpen = ref(false)
const boundHostId = ref(window.utaAPI?.petBinding?.binding?.hostId ?? '')
const connectionState = ref<'disconnected' | 'connecting' | 'connected'>(getActiveAdapter().getConnectionState())
const connectionLabel = computed(() =>
  connectionState.value === 'connected' ? '在线' : connectionState.value === 'connecting' ? '连接中' : getActiveHostId() === 'codex' ? '待命' : '离线',
)
let unsubscribeConnection: (() => void) | null = null
const detectedHostIds = ref<Set<string> | null>(null)
const hostMenuOpen = ref(false)
const hostSwitching = ref(false)
const hostSwitchError = ref('')
const hostSwitchNotice = ref('')
let loadToken = 0

const PART_CATEGORY_LABELS: Record<string, string> = {
  outfit: '服装配饰',
  hair: '发型发饰',
  pose_prop: '手部与道具',
  face_effect: '脸部特效',
  toggle: '其他开关',
  other: '其他部件',
}
const PART_CATEGORY_ALIASES: Record<string, string> = {
  costume: 'outfit',
  hand: 'pose_prop',
  prop: 'pose_prop',
  emotion: 'face_effect',
}
const PART_CATEGORY_ORDER = ['outfit', 'hair', 'pose_prop', 'face_effect', 'toggle', 'other']

const activePartCount = computed(() => store.modelControls.filter((control) => control.active).length)
const heldPartCount = computed(() => store.modelControls.filter((control) => control.held).length)
const partSummary = computed(() => {
  if (store.modelControls.length === 0) return ''
  const bits = [`${activePartCount.value} 开启`]
  if (heldPartCount.value > 0) bits.push(`${heldPartCount.value} 保持`)
  return bits.join(' · ')
})
const partGroups = computed(() => {
  const buckets = new Map<string, ResolvedModelControl[]>()
  for (const control of store.modelControls) {
    const category = PART_CATEGORY_LABELS[control.category]
      ? control.category
      : PART_CATEGORY_ALIASES[control.category] ?? 'other'
    const list = buckets.get(category) ?? []
    list.push(control)
    buckets.set(category, list)
  }
  return PART_CATEGORY_ORDER.filter((category) => (buckets.get(category)?.length ?? 0) > 0).map(
    (category) => ({
      category,
      label: PART_CATEGORY_LABELS[category],
      items: buckets.get(category) ?? [],
    }),
  )
})

const hostOptions = computed(() => {
  const agents = filterAvailableAgentHosts(
    getAgentHosts(),
    detectedHostIds.value,
    boundHostId.value,
  ).map((host) => ({
    id: host.id,
    label: host.label,
    description: host.description ?? '',
  }))
  const adapters = getAdapterHosts().map((host) => ({
    id: host.id,
    label: host.label,
    description: host.description ?? '',
  }))
  const list = [...agents, ...adapters]
  if (boundHostId.value && !list.some((host) => host.id === boundHostId.value)) {
    list.unshift({
      id: boundHostId.value,
      label: hostDisplayName(boundHostId.value),
      description: '当前绑定的宿主',
    })
  }
  return list
})
const boundHostLabel = computed(() => {
  if (!boundHostId.value) return '独立待机'
  return hostDisplayName(boundHostId.value)
})

const currentUrl = computed(() => store.modelUrl || selectedModel.value)
const displayMode = computed(() =>
  quickDisplayMode(currentUrl.value, models.value, kindOfModelUrl(currentUrl.value)),
)
const filteredModels = computed(() => quickModelsForKind(models.value, displayMode.value))
const modelLabels = computed(() => quickModelLabels(filteredModels.value))
function modelDisplayLabel(model: QuickModelOption): string {
  return modelLabels.value.get(model.url) || model.name
}
const currentModelName = computed(() =>
  store.emotionAdapter?.name?.trim() || quickModelDisplayName(currentUrl.value, models.value),
)
const hasError = computed(() => switchError.value.length > 0)
const statusText = computed(() => {
  if (switching.value) return '正在切换模型…'
  return switchError.value
})

async function loadModels(force = false): Promise<void> {
  const token = ++loadToken
  scanning.value = true
  try {
    const list = await listAvailableModels(force)
    if (token !== loadToken) return
    models.value = list
    selectedModel.value = store.modelUrl || getStoredModelPath() || list[0]?.url || ''
  } catch {
    if (token === loadToken) models.value = []
  } finally {
    if (token === loadToken) scanning.value = false
  }
}

async function selectModel(url: string): Promise<void> {
  if (!url || url === store.modelUrl || switching.value) return
  if (isWorkshopDraftDirtyElsewhere()) {
    switchError.value = '设置窗口里有未保存的工坊草稿。请先在设置里保存或放弃，再换模型。'
    return
  }
  switching.value = true
  switchError.value = ''
  try {
    await store.requestModelSwitch(url)
    if (store.modelActionStatus === 'error' && store.modelActionMessage) {
      switchError.value = store.modelActionMessage
    }
  } catch (error) {
    switchError.value = error instanceof Error ? error.message : '模型切换失败'
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || url
    if (!switchError.value) modelMenuOpen.value = false
  }
}

function setDisplayMode(kind: ModelKind): void {
  if (kind === displayMode.value) return
  const remembered = getStoredModelForKind(kind)
  const memoryKey = remembered ? normalizeModelKey(remembered) : ''
  const rememberedModel = remembered
    ? models.value.find((model) => model.url === remembered || normalizeModelKey(model.url) === memoryKey)
    : undefined
  const first = rememberedModel ?? models.value.find((model) => model.kind === kind)
  if (first) void selectModel(first.url)
}

function rescan(): void {
  void loadModels(true)
}

function hostLabel(id: string): string {
  return hostOptions.value.find((host) => host.id === id)?.label ?? hostDisplayName(id)
}

function refreshPetBinding(): void {
  void window.utaAPI?.getPetBinding?.()
    .then((result) => {
      boundHostId.value = result?.binding?.hostId ?? ''
    })
    .catch(() => {})
}

function refreshDetectedHosts(): void {
  void window.utaAPI?.detectInstalledHosts?.()
    .then((result) => {
      if (result?.ids) detectedHostIds.value = new Set(result.ids)
    })
    .catch(() => {})
}

async function reconnectHost(): Promise<void> {
  if (hostSwitching.value) return
  const pending = reconnectActiveHost()
  const id = getActiveHostId()
  connectionState.value = getActiveAdapter().getConnectionState()
  hostSwitchError.value = ''
  hostSwitchNotice.value = `正在重新连接 ${hostLabel(id)}…`
  try {
    await pending
    finishReconnectNotice(getActiveAdapter().getConnectionState())
  } catch {
    hostSwitchNotice.value = ''
    hostSwitchError.value = '当前实例配对失败，请重试。'
  }
}

function finishReconnectNotice(state: string): void {
  if (state === 'connecting') return
  const standby = state === 'disconnected' && getActiveHostId() === 'codex'
  hostSwitchNotice.value = standby ? 'Codex 待命中，聊天活动到达后会自动恢复。' : ''
  hostSwitchError.value = state === 'disconnected' && !standby
    ? '尚未收到宿主连接，请确认宿主已加载 Uta 插件。'
    : ''
}

async function switchHost(next: string): Promise<void> {
  if (next === boundHostId.value || hostSwitching.value) return
  const api = window.utaAPI
  if (!api?.switchPetHost) {
    hostSwitchError.value = '当前版本没有提供宿主切换接口。'
    return
  }
  const wasBound = !!boundHostId.value
  hostSwitching.value = true
  hostSwitchError.value = ''
  hostSwitchNotice.value = ''
  try {
    const result = await api.switchPetHost(next)
    if (!result?.ok) {
      const messages: Record<string, string> = {
        'invalid-host': '这个宿主当前不可用。',
        'write-failed': '写入绑定失败，请检查数据目录权限。',
        'pairing-unavailable': '宿主配对不可用，可能已有另一只桌宠连接这个宿主。',
      }
      hostSwitchError.value = messages[result?.error ?? ''] ?? '宿主切换失败，请重试。'
      return
    }
    boundHostId.value = next
    hostSwitchNotice.value = wasBound
      ? `已切换到 ${hostLabel(next)}`
      : `已绑定到 ${hostLabel(next)}`
    setBoundHostPreference(next as HostPreference)
    switchActiveHost(toHostId(next as HostPreference))
  } catch {
    hostSwitchError.value = '宿主切换失败，请检查主进程连接后重试。'
  } finally {
    hostSwitching.value = false
  }
}

function partLabel(control: ResolvedModelControl): string {
  return control.label.replace(/\s*\([^)]*\)\s*$/, '').trim() || control.id
}

function togglePart(control: ResolvedModelControl): void {
  store.toggleHeldControl(control.id)
}

function toggleClickThrough(): void {
  const next = !store.clickThroughLocked
  store.clickThroughLocked = next
  if (next) emit('close')
  void window.utaAPI?.setClickThroughLocked?.(next)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    modelMenuOpen.value = false
    partsOpen.value = false
    hostMenuOpen.value = false
    hostSwitchError.value = ''
    hostSwitchNotice.value = ''
    switchError.value = ''
    refreshPetBinding()
    refreshDetectedHosts()
    void loadModels()
  },
)

watch(
  () => store.modelUrl,
  (url) => {
    if (url) selectedModel.value = url
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  unsubscribeConnection = onHostChanged((hostId, state) => {
    if (hostId !== getActiveHostId()) return
    connectionState.value = state
    if (state !== 'connecting' && hostSwitchNotice.value.startsWith('正在重新连接')) {
      finishReconnectNotice(state)
    }
    if (state === 'connected' && hostSwitchNotice.value.startsWith('Codex 待命中')) hostSwitchNotice.value = ''
  })
  refreshPetBinding()
  refreshDetectedHosts()
  if (props.open) void loadModels()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubscribeConnection?.()
  unsubscribeConnection = null
})
</script>

<style scoped>
.quick-settings {
  position: absolute;
  z-index: 70;
  display: flex;
  flex-direction: column;
  width: 316px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 44px);
  overflow: hidden;
  border: 1px solid var(--dp-border);
  border-radius: 24px;
  background: var(--dp-panel-bg);
  color: var(--dp-text-main);
  box-shadow: var(--dp-shadow);
  -webkit-app-region: no-drag;
  transition:
    background-color 0.28s ease,
    color 0.28s ease,
    border-color 0.28s ease;
}

.quick-settings.pop-left {
  left: 10px;
  --slide-x: 18px;
}

.quick-settings.pop-right {
  right: 10px;
  --slide-x: -18px;
}

.quick-settings.align-bottom {
  bottom: 32px;
}

.quick-settings.align-top {
  top: 18px;
}

.qs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 12px 18px;
  border-bottom: 1px solid var(--dp-border-subtle);
}

.qs-eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--dp-text-muted);
}

.qs-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--dp-text-muted);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-chevron.open {
  transform: rotate(180deg);
}

.qs-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dp-text-sub);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}

.qs-close:hover {
  background: transparent;
  color: var(--dp-text-main);
  transform: scale(1.15);
}

.qs-close:active {
  transform: scale(0.92);
}

.qs-close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.qs-body {
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--dp-scrollbar) transparent;
}

.qs-body::-webkit-scrollbar {
  width: 6px;
}

.qs-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--dp-scrollbar);
}

.qs-model-drawer {
  padding: 8px 0 2px;
}

.qs-drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.qs-drawer-head .qs-segmented {
  flex: 1;
  margin-top: 0;
}

.qs-model-block {
  margin: 12px 0 4px;
  padding: 12px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 16px;
  background: var(--dp-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.qs-model-block-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.qs-model-block-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.qs-model-block-name {
  overflow: hidden;
  color: var(--dp-text-main);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-model-block .qs-model-drawer {
  padding-top: 10px;
}

.qs-model-block .qs-segmented {
  background: var(--dp-panel-bg);
}

.qs-model-block .qs-segmented button.active {
  background: var(--dp-surface-hover);
}

.qs-section {
  padding: 13px 0;
  border-top: 1px solid var(--dp-border-subtle);
}

.qs-section:first-child {
  padding-top: 11px;
  border-top: 0;
}

.qs-section-title {
  display: block;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--dp-text-muted);
}

.qs-text-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.qs-text-btn:hover:not(:disabled) {
  color: var(--dp-accent-read);
}

.qs-text-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.qs-collapse-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.qs-collapse-head:hover .qs-section-title {
  color: var(--dp-text-main);
}

.qs-collapse-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--dp-text-muted);
  white-space: nowrap;
}

.qs-host-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 10px;
}

.qs-host-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qs-parts-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 10px;
}

.qs-part-group-title {
  display: block;
  margin: 0 0 3px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--dp-text-dim);
}

.qs-toggle-list.is-tight {
  margin-top: 0;
}

.qs-part-row {
  min-height: 35px;
  padding: 0 10px;
  border-radius: 11px;
}

.qs-part-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-part-stage {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-accent-read);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
}

.qs-part-hold {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--dp-accent-soft);
  color: var(--dp-accent-read);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.4;
}

.qs-hint {
  margin: 0 0 0 2px;
  color: var(--dp-text-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.qs-clear-held {
  align-self: flex-start;
  padding: 2px 0;
}

.qs-segmented {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 3px;
  margin-top: 9px;
  padding: 3px;
  border-radius: 12px;
  background: var(--dp-surface);
  box-sizing: border-box;
}

.qs-segmented-slider {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 9px;
  background: var(--dp-panel-bg);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-segmented-slider.to-right {
  transform: translateX(100%);
}

.qs-segmented button {
  position: relative;
  z-index: 1;
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.18s ease, transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-segmented button:hover:not(:disabled):not(.active) {
  color: var(--dp-text-main);
}

.qs-segmented button:active:not(:disabled) {
  transform: scale(0.96);
}

.qs-segmented button.active {
  color: var(--dp-text-main);
  font-weight: 600;
}

.qs-segmented button:disabled {
  cursor: default;
  opacity: 0.4;
}

.qs-model-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}

.qs-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease, transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-model-row:hover:not(:disabled):not(.active) {
  background: var(--dp-surface);
  color: var(--dp-text-main);
}

.qs-model-row:active:not(:disabled) {
  transform: scale(0.98);
}

.qs-model-row.active {
  border-color: var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-accent-read);
  font-weight: 650;
}

.qs-model-row:disabled {
  cursor: default;
  opacity: 0.6;
}

.qs-model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
  flex-shrink: 0;
}

.qs-model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-model-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--dp-accent-read);
}

.qs-empty {
  margin: 8px 0 2px;
  color: var(--dp-text-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.qs-status {
  margin: 8px 0 0;
  color: var(--dp-text-sub);
  font-size: 11px;
  line-height: 1.45;
}

.qs-host-state-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.qs-host-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--dp-text-sub);
}

.qs-conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dp-text-dim);
  flex-shrink: 0;
}

.qs-conn-dot.is-connected {
  background: #4E9C7F;
}

.qs-conn-dot.is-connecting {
  background: #C08A3E;
}

.qs-conn-dot.is-disconnected {
  background: var(--dp-danger, #8F3A33);
}

.qs-status.error {
  color: var(--dp-danger, #8F3A33);
}

.qs-toggle-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.qs-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--dp-border);
  border-radius: 13px;
  background: var(--dp-surface);
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(28, 42, 49, 0.03);
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-toggle:hover {
  background: var(--dp-surface-hover);
  border-color: var(--dp-border-strong);
  color: var(--dp-text-main);
  transform: translateY(-0.5px);
}

.qs-toggle:active {
  transform: scale(0.975);
}

.qs-toggle.active {
  background: var(--dp-accent-soft);
  border-color: var(--dp-accent-border);
  color: var(--dp-accent-read);
  font-weight: 600;
  box-shadow: 0 2px 8px -2px var(--dp-accent-glow);
}

.qs-switch {
  position: relative;
  width: 36px;
  height: 22px;
  border-radius: 8px;
  background: var(--dp-border-strong);
  flex-shrink: 0;
  box-sizing: border-box;
  transition: background-color 0.24s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.24s ease;
}

.qs-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 15px;
  height: 16px;
  border-radius: 6px;
  background: var(--dp-panel-bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    width 0.15s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}

.qs-toggle:active .qs-switch::after {
  width: 18px;
}

.qs-toggle.active .qs-switch {
  background: var(--dp-accent);
}

.qs-toggle.active .qs-switch::after {
  transform: translateX(15px);
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
}

.qs-toggle.active:active .qs-switch::after {
  transform: translateX(12px);
}

.qs-settings-error {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 18px 0;
  color: var(--dp-danger, #8F3A33);
  font-size: 11px;
  line-height: 1.45;
}

.qs-foot {
  flex-shrink: 0;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--dp-border-subtle);
}

.qs-full-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 12px;
  background: var(--dp-surface);
  color: var(--dp-text-main);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background-color 0.18s ease,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s ease;
}

.qs-full-btn:hover {
  border-color: var(--dp-accent-border);
  background: var(--dp-accent-soft);
  color: var(--dp-accent-read);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px var(--dp-accent-glow);
}

.qs-full-btn:hover svg {
  transform: translateX(2px);
}

.qs-full-btn:active {
  transform: scale(0.97) translateY(0);
  box-shadow: none;
}

.qs-full-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-drawer-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: top center;
}

.qs-drawer-leave-active {
  transition:
    opacity 150ms cubic-bezier(0.4, 0, 1, 1),
    transform 150ms cubic-bezier(0.4, 0, 1, 1);
  transform-origin: top center;
}

.qs-drawer-enter-from,
.qs-drawer-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.quick-settings-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.quick-settings-leave-active {
  transition:
    opacity 140ms cubic-bezier(0.4, 0, 1, 1),
    transform 160ms cubic-bezier(0.4, 0, 1, 1);
}

.quick-settings-enter-from,
.quick-settings-leave-to {
  opacity: 0;
  transform: translateX(var(--slide-x, 16px)) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .quick-settings-enter-active,
  .quick-settings-leave-active,
  .qs-drawer-enter-active,
  .qs-drawer-leave-active,
  .qs-chevron,
  .qs-switch,
  .qs-switch::after,
  .qs-full-btn,
  .qs-full-btn svg {
    transition: none;
  }
}
</style>
