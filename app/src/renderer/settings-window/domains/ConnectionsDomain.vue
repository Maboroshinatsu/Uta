<template>
  <div class="settings-stack">
    <section class="settings-panel" aria-label="当前连接">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">当前连接</span>
          <h3 class="panel-title">{{ currentHostName }}</h3>
          <p class="panel-hint">{{ channelDescription }}</p>
        </div>
        <span class="panel-badge" :class="currentHostState === 'connected' ? 'is-positive' : 'is-warning'">
          <span class="status-dot" :class="{ 'is-on': currentHostState === 'connected', 'is-warn': currentHostState !== 'connected' }" />
          {{ connectionLabel }}
        </span>
      </div>

      <div class="connection-facts">
        <div class="fact">
          <span class="fact-label">连接方式</span>
          <span class="fact-value">{{ currentHostName }}</span>
        </div>
        <div class="fact">
          <span class="fact-label">会话活动</span>
          <span class="fact-value">{{ sessionActivity }}</span>
        </div>
      </div>

      <details class="connection-diagnostics">
        <summary>连接诊断</summary>
        <p>本机消息端点：{{ hostStatus?.runtimeEndpointReady ? '已就绪' : '尚未就绪' }}</p>
      </details>

      <p v-if="inputStatus" class="settings-note" :class="{ 'is-warning': inputStatus.supported && !inputStatus.ready }" role="status">
        桌宠发送：{{ inputStatus.detail }}
      </p>
      <div class="settings-action-row">
        <button type="button" class="uta-button is-secondary" :disabled="isReconnecting || hostStateBusy" @click="doReconnect">
          <SettingsIcon name="refresh" :size="15" />
          {{ isReconnecting ? '正在检测…' : isStandalone ? '重新检测本地服务' : '重新连接当前宿主' }}
        </button>
        <button type="button" class="uta-button is-ghost" @click="openAdaptersFolder">打开适配器目录</button>
      </div>

      <SettingsRow
        v-if="!isStandalone"
        label="宿主启动时呼出 Uta"
        html-for="summon-on-host-start"
        description="检测到宿主开始新会话时，如果 Uta 被隐藏，会在桌面重新出现；不会抢走键盘焦点。"
      >
        <SettingsToggle
          id="summon-on-host-start"
          aria-label="宿主启动时呼出 Uta"
          :model-value="summonOnHostStart"
          :disabled="summonSaving"
          @update:model-value="toggleSummon"
        />
      </SettingsRow>
      <p v-if="summonError" class="settings-note is-warning" role="alert">{{ summonError }}</p>
    </section>

    <section class="settings-panel" aria-label="宿主绑定">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">宿主绑定</span>
          <h3 class="panel-title">{{ boundHostLabel || '尚未绑定宿主' }}</h3>
        </div>
        <span class="panel-badge">{{ boundHostId ? '已绑定' : '独立待机' }}</span>
      </div>

      <p v-if="hostStateError" class="settings-note" role="status">{{ hostStateError }}</p>

      <div class="host-switch-section">
        <button
          type="button"
          class="host-switch-toggle"
          :aria-expanded="hostListOpen"
          aria-controls="host-switch-body"
          @click="hostListOpen = !hostListOpen"
        >
          <span>切换宿主</span>
          <svg class="host-switch-chevron" :class="{ open: hostListOpen }" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <Transition name="host-switch">
          <div v-if="hostListOpen" id="host-switch-body" class="host-switch-body">
            <div class="host-switch-grid" role="group" aria-label="切换宿主">
              <button
                v-for="host in switchableHosts"
                :key="host.id"
                type="button"
                class="host-switch-option pressable"
                :class="{ active: host.id === boundHostId }"
                :aria-pressed="host.id === boundHostId"
                :disabled="switchBusy || host.disabled"
                @click="switchHost(host.id)"
              >
                <span class="host-switch-name">{{ host.label }}</span>
                <span class="host-switch-state">
                  {{ host.id === boundHostId
                    ? '当前'
                    : host.disabled
                      ? '不可用'
                      : switchingHostId === host.id
                        ? '切换中…'
                        : '切换' }}
                </span>
              </button>
            </div>
            <p v-if="switchMessage" class="settings-note" role="status">{{ switchMessage }}</p>
          </div>
        </Transition>
      </div>

      <div v-if="selectedPluginManifest" class="plugin-config">
        <div class="panel-divider" />
        <span class="field-label">{{ selectedPluginManifest.name }} 的连接参数</span>
        <AdapterPluginSettings :manifest="selectedPluginManifest" @apply="onPluginConfigApply" />
      </div>
    </section>

    <section class="settings-panel guide-panel" aria-label="连接引导">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">连接引导</span>
          <h3 class="panel-title">从宿主到模型回应</h3>
          <p class="panel-hint">连接后自动接收工作状态和回复；需要时可以固定一个聊天。</p>
        </div>
        <span class="panel-badge" :class="currentHostState === 'connected' ? 'is-positive' : 'is-warning'">
          {{ connectionLabel }}
        </span>
      </div>

      <div class="guide-step">
        <span class="guide-index">1</span>
        <div class="guide-copy">
          <strong>宿主：{{ boundHostLabel || currentHostName }}</strong>
          <span>{{ boundHostId ? '已绑定；可在上方宿主卡片直接切换' : '尚未绑定；在上方选一个宿主即可' }}</span>
        </div>
      </div>

      <div class="guide-step">
        <span class="guide-index">2</span>
        <div class="guide-copy">
          <strong>插件：{{ pluginStatus }}</strong>
          <span class="guide-path">{{ hostPathDescription }}</span>
        </div>
        <button
          v-if="canChooseHostPath"
          type="button"
          class="uta-button is-ghost"
          :disabled="guideBusy"
          @click="chooseHostPath"
        >
          选择路径
        </button>
        <button type="button" class="uta-button is-ghost" @click="openAdaptersFolder">适配器目录</button>
      </div>

      <div class="guide-step guide-step-column">
        <div class="guide-step-head">
          <span class="guide-index">3</span>
          <div class="guide-copy">
            <strong>回复聊天：{{ sessionSummary }}</strong>
            <span>该宿主的所有会话都会驱动桌宠；{{ hostPreference === 'codex' ? '回复目标跟随你最近主动发消息的聊天，也可手动固定。' : '回复目标默认自动跟随，也可手动固定。' }}</span>
          </div>
          <button
            type="button"
            class="uta-button is-ghost"
            :disabled="sessionsLoading || isStandalone"
            @click="refreshSessions()"
          >
            {{ sessionsLoading ? '读取中…' : '刷新' }}
          </button>
        </div>
        <details v-if="!isStandalone && hostSessions.length" class="session-options">
          <summary>固定回复聊天（可选）</summary>
          <div class="session-list">
          <button
            type="button"
            class="session-row"
            :class="{ active: !selectedSessionId && !selectionExpired }"
            @click="selectSession(null)"
          >
            <span class="session-main">自动跟随聊天</span>
            <span class="session-tag">默认</span>
          </button>
          <button
            v-for="session in hostSessions"
            :key="session.sessionId"
            type="button"
            class="session-row"
            :class="{ active: selectedSessionId === session.sessionId }"
            :disabled="session.available === false"
            @click="selectSession(session.sessionId)"
          >
            <span class="session-main">
              {{ session.label || UNTITLED_SESSION }}
              <small>{{ session.cwd || '未记录工作目录' }}</small>
            </span>
            <span class="session-tag">{{ sessionTag(session) }}</span>
          </button>
          </div>
        </details>
        <p v-else-if="!isStandalone" class="settings-note">
          {{ sessionsLoading ? '正在连接聊天…' : '等待宿主连接，找到聊天后会自动显示。' }}
        </p>
        <p v-if="sessionMessage" class="settings-note" role="status">{{ sessionMessage }}</p>
      </div>

      <div class="guide-step">
        <span class="guide-index">4</span>
        <div class="guide-copy">
          <strong>测试模型回应</strong>
          <span>{{ testMessage || (store.statePresets.length === 0 ? '当前模型没有可播放的状态预设；换回 Live2D 模型后再试。' : '只测试桌宠本地的状态与表现，不会向宿主发送消息。') }}</span>
        </div>
        <button
          type="button"
          class="uta-button is-secondary"
          :disabled="testBusy || store.statePresets.length === 0"
          :title="store.statePresets.length === 0 ? '当前模型没有可播放的状态预设' : '播放一段模型状态测试'"
          @click="testRoleResponse"
        >
          {{ testBusy ? '播放中…' : '播放测试' }}
        </button>
      </div>

      <p v-if="guideNotice" class="settings-note" role="status">{{ guideNotice }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  filterAvailableAgentHosts,
  findHost,
  getAgentHosts,
  type HostPreference,
} from '@/services/adapters'
import { adapterPluginEntries } from '@/services/adapters/plugin-loader'
import { useDeskpetStore } from '@/stores/deskpet'
import { UNTITLED_SESSION } from '../../../shared/session-title'
import SettingsIcon from '../../components/settings-v2/SettingsIcon.vue'
import SettingsRow from '../../components/settings-v2/SettingsRow.vue'
import SettingsToggle from '../../components/settings-v2/SettingsToggle.vue'
import AdapterPluginSettings from '../../components/AdapterPluginSettings.vue'

const store = useDeskpetStore()
const boundHostId = ref<string>(window.utaAPI?.petBinding?.binding?.hostId ?? '')
const hostStatus = ref<HostStatus | null>(null)
const inputStatus = ref<import('../../../shared/host-input-status').HostInputStatus | null>(null)
let inputStatusRequest = 0
async function refreshInputStatus(): Promise<void> {
  const request = ++inputStatusRequest
  const host = boundHostId.value
  try {
    const value = host ? await window.utaAPI?.getHostInputStatus?.(host) : null
    if (request === inputStatusRequest && host === boundHostId.value) inputStatus.value = value ?? null
  } catch { if (request === inputStatusRequest) inputStatus.value = null }
}
const hostPreference = ref<HostPreference>('standalone')
const currentHostId = ref('standalone')
const currentHostState = ref('disconnected')
const hostStateBusy = ref(false)
const hostStateError = ref('')
const isReconnecting = ref(false)
const summonOnHostStart = ref(true)
const summonSaving = ref(false)
const summonError = ref('')
const hostSessions = ref<Array<{
  sessionId: string
  label: string
  cwd: string
  lastSeen: number
  lastCommand: string
  hostInstanceId: string
  available?: boolean
}>>([])
const selectedSessionId = ref<string | null>(null)
const automaticSessionId = ref<string | null>(null)
const selectionExpired = ref(false)
const sessionsLoading = ref(false)
const sessionMessage = ref('')
const hostPath = ref('')
const guideBusy = ref(false)
const testBusy = ref(false)
const testMessage = ref('')
const switchBusy = ref(false)
const switchingHostId = ref('')
const switchMessage = ref('')
const hostListOpen = ref(!boundHostId.value)
const detectedHostIds = ref<Set<string> | null>(null)
let hostRefreshTimer: ReturnType<typeof setInterval> | null = null
let unsubscribePetBinding: (() => void) | null = null
let hostStateRequest = 0
let sessionRequest = 0
let hostPathRequest = 0

const hostOptions = computed(() => {
  const builtIns = filterAvailableAgentHosts(
    getAgentHosts(),
    detectedHostIds.value,
    boundHostId.value,
  ).map(host => ({
    id: host.id as HostPreference,
    label: host.label,
    disabled: false,
  }))
  const plugins = adapterPluginEntries.value
    .filter(entry => entry.loaded || (entry.manifest?.id ?? entry.key) === boundHostId.value)
    .map(entry => {
      const id = (entry.loaded && entry.manifest ? entry.manifest.id : entry.key) as HostPreference
      return {
        id,
        label: entry.manifest?.name ?? (entry.dir ? `未加载：${entry.dir}` : '未加载插件'),
        disabled: !entry.loaded,
      }
    })
  return [
    ...builtIns,
    ...plugins,
    { id: 'standalone' as HostPreference, label: '独立运行', disabled: false },
  ]
})

const selectedPluginManifest = computed(() => {
  const entry = adapterPluginEntries.value.find(item => item.loaded && item.manifest?.id === hostPreference.value)
  return entry?.manifest ?? null
})
const boundHostLabel = computed(() =>
  boundHostId.value
    ? hostOptions.value.find(host => host.id === boundHostId.value)?.label ?? boundHostId.value
    : '',
)
const switchableHosts = computed(() => hostOptions.value.filter(host => host.id !== 'standalone'))

const isStandalone = computed(() => currentHostId.value === 'standalone' || currentHostId.value === 'fake')
const currentHostName = computed(() => {
  if (isStandalone.value) return '独立待命'
  return findHost(currentHostId.value as never)?.label ?? hostOptions.value.find(host => host.id === currentHostId.value)?.label ?? currentHostId.value
})
const connectionLabel = computed(() => {
  if (isStandalone.value) return currentHostState.value === 'connected' ? '本地就绪' : '本地待命'
  if (currentHostState.value === 'connected') return '已连接'
  if (currentHostState.value === 'connecting') return '正在探测'
  if (currentHostId.value === 'codex') return '待命'
  return '待命或离线'
})
const sessionActivity = computed(() => {
  if (isStandalone.value) return '不连接外部宿主'
  return currentHostState.value === 'connected' ? '等待或正在处理会话' : '连接后自动接收会话状态'
})
const channelDescription = computed(() => {
  if (currentHostId.value === 'codex') return '与 Codex 同步工作状态，自动找到回复聊天。'
  const registration = findHost(currentHostId.value as never)
  if (registration?.manifest?.description) return registration.manifest.description
  switch (currentHostId.value) {
    case 'qoder':
    case 'codex':
    case 'claude-code':
    case 'zcode':
      return '通过 MCP 角色工具与生命周期钩子同步会话状态，只读。'
    case 'opencode':
      return '使用 OpenCode 原生插件事件与权限审批联动。'
    case 'deepseek-harness':
      return '使用 DeepSeek Harness 原生工具流与任务审批。'
    case 'antigravity':
      return '通过工作区插件与 MCP 钩子同步会话状态，只读。'
    case 'fake':
    case 'standalone':
      return '本地独立运行，不主动向外部宿主发送网络请求。'
    default:
      return '按插件提供的配置连接的自定义宿主。'
  }
})

const canChooseHostPath = computed(() =>
  ['deepseek-harness', 'harness', 'opencode', 'zcode', 'claude-code', 'codex', 'node'].includes(hostPreference.value),
)
const pluginStatus = computed(() => {
  if (isStandalone.value) return '独立运行，无需插件'
  const external = adapterPluginEntries.value.find(entry => entry.manifest?.id === hostPreference.value)
  if (external) {
    return external.loaded
      ? '外部适配器已加载'
      : `外部插件未加载${external.error ? `：${external.error}` : ''}`
  }
  return findHost(hostPreference.value as never)?.available ? '内置连接器已加载' : '连接器不可用'
})
const hostPathDescription = computed(() => {
  if (!canChooseHostPath.value) return '此宿主通过宿主插件工作，不需要本机 CLI'
  return hostPath.value ? `宿主入口：${hostPath.value}` : '尚未找到宿主入口，可以手动选择'
})
const sessionSummary = computed(() => {
  if (isStandalone.value) return '独立运行'
  if (sessionsLoading.value) return '正在读取'
  if (selectionExpired.value) return '锁定的会话已失效'
  if (hostSessions.value.length === 0) return '正在自动寻找聊天'
  return selectedSessionId.value ? '已固定聊天' : '自动跟随中'
})
const guideNotice = computed(() => {
  if (isStandalone.value) return '当前是独立运行；不会向外部宿主发送消息。'
  if (hostPreference.value === 'codex') {
    if (selectionExpired.value) return '固定的聊天暂不可用，草稿已保留。可以重新选择聊天，或切回自动跟随。'
    return hostSessions.value.length ? '回复目标会自动恢复，聊天列表也会自动更新。' : '正在自动寻找 Codex 聊天，找到后即可回复。'
  }
  if (!pluginStatus.value.includes('已加载')) return '连接器或插件还没有就绪，请先检查适配器目录。'
  if (currentHostState.value === 'disconnected') {
    return selectionExpired.value
      ? '当前宿主离线；锁定的会话也已不在列表。启动宿主后刷新，或选择“自动跟随最新会话”。'
      : '当前宿主离线；确认它已经启动，或点击“重新连接当前宿主”。'
  }
  if (hostSessions.value.length === 0) return '宿主已连接，但还没有登记会话；先在宿主里发一条消息，再点击“刷新”。'
  if (selectionExpired.value) return '锁定的会话已不在列表；发送前请选择“自动跟随最新会话”，或刷新后重新固定一个会话。'
  if (!selectedSessionId.value) return '当前会自动跟随最新会话；也可以在上面固定一个会话。'
  return ''
})

type HostCommandResult = { ok: boolean; data?: unknown; error?: string }

function hostErrorText(code?: string): string {
  switch (code) {
    case 'pet-unavailable':
      return '桌宠窗口不可用，宿主状态没有切换。'
    case 'timeout':
      return '桌宠没有及时回应，宿主状态没有切换。'
    case 'invalid-command':
      return '这个宿主当前不可用，请先检查插件清单。'
    case 'action-rejected':
      return '宿主切换被拒绝，请检查当前适配器后重试。'
    default:
      return '宿主状态同步失败，请确认桌宠正在运行后重试。'
  }
}

function applyHostState(result: HostCommandResult): boolean {
  if (!result.ok) {
    hostStateError.value = hostErrorText(result.error)
    return false
  }
  const data = result.data as { preference?: unknown; activeHostId?: unknown; state?: unknown } | undefined
  if (typeof data?.preference === 'string') hostPreference.value = data.preference as HostPreference
  if (typeof data?.activeHostId === 'string') currentHostId.value = data.activeHostId
  if (typeof data?.state === 'string') currentHostState.value = data.state
  hostStateError.value = ''
  return true
}

async function switchHost(preference: HostPreference): Promise<void> {
  if (switchBusy.value || preference === boundHostId.value || preference === 'standalone') return
  const option = hostOptions.value.find(host => host.id === preference)
  if (option?.disabled) {
    switchMessage.value = '这个宿主当前不可用，请先检查插件清单。'
    return
  }
  switchBusy.value = true
  switchingHostId.value = preference
  switchMessage.value = ''
  hostStateError.value = ''
  try {
    const result = await store.requestModelAction({ type: 'switch-host', preference })
    if (!result.ok) {
      switchMessage.value = hostErrorText(result.error)
      return
    }
    hostPreference.value = preference
    boundHostId.value = preference
    switchMessage.value = `已切换到 ${option?.label ?? preference}。`
  } catch {
    switchMessage.value = '切换失败，请确认桌宠正在运行后重试。'
  } finally {
    switchBusy.value = false
    switchingHostId.value = ''
  }
}

async function refreshHostState(showBusy = false): Promise<void> {
  if (!showBusy && (hostStateBusy.value || isReconnecting.value)) return
  if (showBusy) hostStateBusy.value = true
  const request = ++hostStateRequest
  try {
    const result = await store.requestModelAction({ type: 'host-state' })
    if (request === hostStateRequest) applyHostState(result)
  } finally {
    if (showBusy) hostStateBusy.value = false
  }
}

async function doReconnect(): Promise<void> {
  if (isReconnecting.value || hostStateBusy.value) return
  isReconnecting.value = true
  const request = ++hostStateRequest
  try {
    const result = await store.requestModelAction({ type: 'reconnect-host' })
    if (request === hostStateRequest) applyHostState(result)
  } finally {
    isReconnecting.value = false
  }
}

async function refreshSessions(background = false): Promise<void> {
  if (background && sessionsLoading.value) return
  void refreshInputStatus()
  const host = hostPreference.value
  const request = ++sessionRequest
  if (isStandalone.value) {
    hostSessions.value = []
    selectedSessionId.value = null
    automaticSessionId.value = null
    selectionExpired.value = false
    sessionMessage.value = ''
    sessionsLoading.value = false
    return
  }
  if (!background) {
    sessionsLoading.value = true
    sessionMessage.value = ''
  }
  try {
    const result = await window.utaAPI?.getHostSessions?.(host)
    if (request !== sessionRequest || host !== hostPreference.value) return
    if (result?.ok) {
      hostSessions.value = result.sessions ?? []
      selectedSessionId.value = result.selectedSessionId ?? null
      automaticSessionId.value = result.automaticSessionId ?? null
      selectionExpired.value = result.selectionExpired === true
    } else {
      if (!background) {
        hostSessions.value = []
        selectedSessionId.value = null
        automaticSessionId.value = null
        selectionExpired.value = false
      }
      sessionMessage.value = result?.error === 'unauthorized'
        ? '设置窗口没有权限读取会话。'
        : '会话读取失败，请确认桌宠正在运行。'
    }
  } catch {
    if (request !== sessionRequest || host !== hostPreference.value) return
    if (!background) {
      hostSessions.value = []
      selectedSessionId.value = null
      automaticSessionId.value = null
      selectionExpired.value = false
    }
    sessionMessage.value = '会话读取失败，请确认桌宠正在运行。'
  } finally {
    if (request === sessionRequest) sessionsLoading.value = false
  }
}

async function refreshHostPath(): Promise<void> {
  const host = hostPreference.value
  const request = ++hostPathRequest
  if (!canChooseHostPath.value) {
    hostPath.value = ''
    return
  }
  try {
    const result = await window.utaAPI?.getHostPathInfo?.(host)
    if (request !== hostPathRequest || host !== hostPreference.value) return
    hostPath.value = result?.ok ? result.path ?? '' : ''
  } catch {
    if (request === hostPathRequest && host === hostPreference.value) hostPath.value = ''
  }
}

async function chooseHostPath(): Promise<void> {
  if (!canChooseHostPath.value || guideBusy.value) return
  const host = hostPreference.value
  guideBusy.value = true
  sessionMessage.value = ''
  try {
    const result = await window.utaAPI?.chooseHostPath?.(host)
    if (host !== hostPreference.value) return
    if (result?.ok) {
      hostPath.value = result.path ?? ''
      sessionMessage.value = '宿主路径已保存，下次发送会使用它。'
    } else if (result?.error !== 'cancelled') {
      sessionMessage.value = result?.error || '保存宿主路径失败。'
    }
  } catch {
    if (host === hostPreference.value) sessionMessage.value = '保存宿主路径失败。'
  } finally {
    guideBusy.value = false
  }
}

async function selectSession(sessionId: string | null): Promise<void> {
  if (sessionsLoading.value || isStandalone.value) return
  const host = hostPreference.value
  const request = ++sessionRequest
  sessionsLoading.value = true
  sessionMessage.value = ''
  try {
    const result = await window.utaAPI?.selectHostSession?.(host, sessionId)
    if (request !== sessionRequest || host !== hostPreference.value) return
    if (result?.ok) {
      hostSessions.value = result.sessions ?? []
      selectedSessionId.value = result.selectedSessionId ?? null
      automaticSessionId.value = result.automaticSessionId ?? null
      selectionExpired.value = result.selectionExpired === true
      sessionMessage.value = sessionId
        ? '已锁定这个会话；之后桌宠输入会发到这里。'
        : '已改为自动跟随最新会话。'
    } else {
      sessionMessage.value = result?.error === 'session-not-found'
        ? '这个会话已经失效，请刷新后重新选择。'
        : '保存会话选择失败，请重试。'
    }
  } catch {
    if (request === sessionRequest && host === hostPreference.value) {
      sessionMessage.value = '保存会话选择失败，请重试。'
    }
  } finally {
    if (request === sessionRequest) sessionsLoading.value = false
  }
}

function sessionTag(session: { sessionId: string; lastSeen: number; available?: boolean }): string {
  if (session.available === false) return '暂不可用'
  if (selectedSessionId.value === session.sessionId) return '已选'
  if (!selectedSessionId.value && automaticSessionId.value === session.sessionId) return '当前跟随'
  if (Date.now() - session.lastSeen < 10 * 60 * 1000) return '近期'
  return new Date(session.lastSeen).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function testRoleResponse(): Promise<void> {
  if (testBusy.value) return
  const preset = store.statePresets.find(p => p.group === '开心' || p.label.includes('开心')) ?? store.statePresets[0]
  if (!preset) {
    testMessage.value = '当前模型没有可用预设。'
    return
  }
  testBusy.value = true
  testMessage.value = '正在让桌宠播放…'
  try {
    const result = await store.requestModelAction({
      type: 'trigger-preset',
      preset: preset as unknown as Record<string, unknown>,
    })
    testMessage.value = result.ok ? `已播放「${preset.label}」` : '播放失败，请检查桌宠连接。'
  } catch {
    testMessage.value = '播放失败，请检查桌宠连接。'
  } finally {
    testBusy.value = false
  }
}

async function openAdaptersFolder(): Promise<void> {
  try {
    await window.utaAPI?.openAdaptersFolder?.()
  } catch {
    // The operating system file manager may be unavailable in a portable build.
  }
}

async function loadSummonPreference(): Promise<void> {
  try {
    const value = await window.utaAPI?.getSummonOnHostStart?.()
    if (typeof value === 'boolean') summonOnHostStart.value = value
  } catch {
    // Keep the default when the pet window is not reachable.
  }
}

async function toggleSummon(enabled: boolean): Promise<void> {
  if (summonSaving.value || enabled === summonOnHostStart.value) return
  const previous = summonOnHostStart.value
  summonOnHostStart.value = enabled
  summonSaving.value = true
  summonError.value = ''
  try {
    const result = await window.utaAPI?.setSummonOnHostStart?.(enabled)
    if (result === true) return
    summonOnHostStart.value = previous
    summonError.value = '这项设置未能保存到本机，请重试。'
  } catch {
    summonOnHostStart.value = previous
    summonError.value = '这项设置未能保存到本机，请重试。'
  } finally {
    summonSaving.value = false
  }
}

async function refreshHostStatus(): Promise<void> {
  try {
    hostStatus.value = await window.utaAPI?.getHostStatus?.() ?? null
  } catch {
    hostStatus.value = null
  }
}

async function refreshDetectedHosts(): Promise<void> {
  try {
    const result = await window.utaAPI?.detectInstalledHosts?.()
    if (result?.ids) detectedHostIds.value = new Set(result.ids)
  } catch {
    // Keep showing every known host when detection is unavailable.
  }
}

function onPluginConfigApply(): void {
  void doReconnect()
}

function onWindowFocus(): void {
  void refreshHostState()
  void refreshSessions()
  void refreshHostPath()
  void refreshDetectedHosts()
}

watch([currentHostId, hostPreference], () => {
  sessionRequest++
  hostPathRequest++
  hostSessions.value = []
  selectedSessionId.value = null
  selectionExpired.value = false
  sessionMessage.value = ''
  sessionsLoading.value = false
  hostPath.value = ''
  void refreshSessions()
  void refreshHostPath()
})

onMounted(() => {
  void window.utaAPI?.getPetBinding?.().then(result => {
    boundHostId.value = result?.binding?.hostId ?? ''
  }).catch(() => {})
  unsubscribePetBinding = window.utaAPI?.onPetBindingChanged?.((payload) => {
    boundHostId.value = payload?.binding?.hostId ?? ''
    void refreshHostState(true)
  }) ?? null
  void refreshHostState(true)
  void refreshHostStatus()
  void refreshDetectedHosts()
  void loadSummonPreference()
  void refreshSessions()
  void refreshHostPath()
  hostRefreshTimer = setInterval(() => { void refreshHostState(); void refreshSessions(true) }, 2000)
  window.addEventListener('focus', onWindowFocus)
})
onUnmounted(() => {
  inputStatusRequest += 1
  if (hostRefreshTimer) {
    clearInterval(hostRefreshTimer)
    hostRefreshTimer = null
  }
  unsubscribePetBinding?.()
  unsubscribePetBinding = null
  window.removeEventListener('focus', onWindowFocus)
})
</script>

<style scoped>
.connection-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.connection-diagnostics,
.session-options {
  margin-top: 12px;
  color: var(--uta-secondary);
  font-size: 12px;
}

.connection-diagnostics summary,
.session-options summary {
  cursor: pointer;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  background-color: var(--uta-canvas);
  min-width: 0;
}

.fact-label {
  font-size: 11px;
  color: var(--uta-secondary);
}

.fact-value {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uta-ink);
  line-height: 1.4;
}

.host-switch-section {
  margin-top: 13px;
  border-top: 1px solid var(--uta-separator);
  padding-top: 8px;
}

.host-switch-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 36px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--uta-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.host-switch-toggle:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: 2px;
}

.host-switch-chevron {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--uta-transition-fast);
}

.host-switch-chevron.open {
  transform: rotate(180deg);
}

.host-switch-body {
  padding-top: 8px;
}

.host-switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.host-switch-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--uta-separator);
  border-radius: 11px;
  background: var(--uta-canvas);
  color: var(--uta-ink);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--uta-transition-fast), background-color var(--uta-transition-fast);
}

.host-switch-option:hover:not(:disabled) {
  border-color: var(--uta-input-border);
}

.host-switch-option.active {
  border-color: var(--uta-accent);
  background: var(--uta-accent-soft);
}

.host-switch-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.host-switch-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
}

.host-switch-state {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--uta-accent-read);
}

.host-switch-option:disabled .host-switch-state {
  color: var(--uta-muted);
}

.host-switch-enter-active,
.host-switch-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.host-switch-enter-from,
.host-switch-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.plugin-config {
  margin-top: 16px;
}

@media (max-width: 720px) {
  .host-switch-grid {
    grid-template-columns: 1fr;
  }
}

.guide-panel {
  padding: 17px 18px;
}

.guide-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 0;
  border-top: 1px solid var(--uta-separator);
}

.guide-step:first-of-type {
  border-top: 0;
}

.guide-step-column {
  flex-direction: column;
}

.guide-step-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}

.guide-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--uta-accent-soft);
  color: var(--uta-accent-read);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.guide-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--uta-secondary);
}

.guide-copy strong {
  color: var(--uta-ink);
  font-size: 12.5px;
}

.guide-copy small {
  color: var(--uta-muted);
}

.guide-path {
  overflow-wrap: anywhere;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding-left: 32px;
  margin-top: 8px;
}

.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: var(--uta-surface);
  color: var(--uta-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.session-row:hover {
  border-color: var(--uta-separator);
}

.session-row.active {
  border-color: var(--uta-accent);
  background: var(--uta-accent-soft);
  color: var(--uta-accent-read);
}

.session-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
}

.session-main small {
  color: var(--uta-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
}

@media (max-width: 760px) {
  .connection-facts {
    grid-template-columns: 1fr;
  }
}
</style>
