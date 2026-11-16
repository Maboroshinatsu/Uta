<template>
  <div
    class="onb"
    :class="{ 'is-reentry': reentry, 'is-doc-hidden': docHidden }"
    :data-onboarding-step="step"
  >
    <div class="onb-blobs" aria-hidden="true">
      <span class="onb-blob onb-blob--blue" />
      <span class="onb-blob onb-blob--sage" />
      <span class="onb-blob onb-blob--sand" />
    </div>

    <header class="onb-top">
      <div class="onb-brand">
        <img src="/uta-icon.svg" class="onb-brand__mark" alt="" aria-hidden="true" />
        <span class="onb-brand__text">
          <strong>Uta</strong>
          <span>{{ reentry ? '重新运行首次引导' : '首次使用引导' }}</span>
        </span>
      </div>
      <div class="onb-top__actions">
        <span class="onb-top__note">{{ reentry ? '可以随时返回设置' : '之后可在“关于与诊断”里重新打开引导' }}</span>
        <button type="button" class="onb-pill onb-pill--ghost" :disabled="actionsBusy" @click="closeGuide">
          {{ reentry ? '返回设置' : '退出引导' }}
        </button>
      </div>
    </header>

    <div class="onb-shell">
      <nav ref="railRef" class="onb-rail" aria-label="引导步骤">
        <ol class="onb-rail__list">
          <li v-for="stepId in ONBOARDING_STEPS" :key="stepId">
            <button
              type="button"
              class="onb-rail__step"
              :class="{
                'is-current': step === stepId,
                'is-done': stepIndex(stepId) < stepIndex(step),
              }"
              :aria-current="step === stepId ? 'step' : undefined"
              :disabled="actionsBusy || !canNavigateToStep(stepId, furthest)"
              @click="jumpTo(stepId)"
            >
              <span class="onb-rail__num">{{ stepNumber(stepId) }}</span>
              <span class="onb-rail__label">{{ STEP_LABELS[stepId] }}</span>
              <span class="onb-rail__hint">{{ railHint(stepId) }}</span>
            </button>
          </li>
        </ol>
        <p class="onb-rail__foot">宿主、角色与语音都可以稍后在设置里调整。</p>
      </nav>

      <section class="onb-stage" :aria-labelledby="headingId">
        <p v-if="finishError" class="onb-alert" role="alert">{{ finishError }}</p>
        <button
          v-if="finishError"
          type="button"
          class="onb-pill onb-pill--ghost onb-error-exit"
          :disabled="actionsBusy"
          @click="exitOnError"
        >暂时退出，先进入设置</button>
        <Transition :name="reduceMotion ? '' : 'onb-step'" :css="!reduceMotion">
          <div :key="step" class="onb-step">
            <template v-if="step === 'welcome'">
              <p class="onb-eyebrow">{{ reentry ? 'WELCOME BACK' : 'UTA · FIRST RUN' }}</p>
              <h1 :id="headingId" ref="headingRef" tabindex="-1" class="onb-display">
                <template v-if="reentry">再把 Uta 调到顺手的状态。</template>
                <template v-else>让 Uta 住进桌面，<br>陪你把手上的事做完。</template>
              </h1>
              <p class="onb-lede">
                她会待在桌面一角，看你正在使用的宿主工作，再用表情、动作和（可选的）声音回应。
                先完成几个小选择，之后随时可以在设置里改。
              </p>
              <ol class="onb-welcome-list" aria-label="引导会做什么">
                <li>
                  <span class="onb-welcome-list__num">01</span>
                  <span class="onb-welcome-list__text">
                    <strong>连接宿主</strong>
                    <span>选一个你正在用的宿主，也可以跳过。</span>
                  </span>
                </li>
                <li>
                  <span class="onb-welcome-list__num">02</span>
                  <span class="onb-welcome-list__text">
                    <strong>选一个角色</strong>
                    <span>使用本机模型，或保留内置默认角色。</span>
                  </span>
                </li>
                <li>
                  <span class="onb-welcome-list__num">03</span>
                  <span class="onb-welcome-list__text">
                    <strong>决定是否开口</strong>
                    <span>语音默认关闭，引导里不会自动播放。</span>
                  </span>
                </li>
              </ol>
              <div class="onb-actions">
                <button
                  v-if="!reentry"
                  type="button"
                  class="onb-pill onb-pill--ghost"
                  :disabled="actionsBusy" @click="dismissGuide"
                >这次先跳过</button>
                <button type="button" class="onb-pill onb-pill--primary" @click="goTo('host')">
                  {{ primaryActionLabel('welcome', reentry) }}
                </button>
              </div>
            </template>

            <template v-else-if="step === 'host'">
              <p class="onb-eyebrow">STEP {{ stepNumber('host') }} · HOST</p>
              <h1 :id="headingId" ref="headingRef" tabindex="-1" class="onb-title">
                先让 Uta 找对你的宿主。
              </h1>
              <p class="onb-lede">
                宿主是 Uta 观察工作进度的地方。列表优先显示本机已安装的宿主；
                没安装的会给出准备和一键安装入口；支持自动部署 Antigravity、Qoder、Claude Code、Codex 与 DeepSeek Harness 插件，可以在这里直接安装。
              </p>

              <p v-if="boundOnboardingHostId" class="onb-note is-warning" role="status">
                这只桌宠已绑定到 {{ boundHostLabel }}。一只桌宠只连接一个宿主；
                要换宿主，请在设置 → 连接与会话里直接切换。
              </p>
              <p v-if="hostLockMessage" class="onb-alert" role="alert">{{ hostLockMessage }}</p>

              <div class="onb-toolbar">
                <span class="onb-status" role="status" aria-live="polite">{{ detectionStatusText }}</span>
                <button
                  type="button"
                  class="onb-pill onb-pill--ghost onb-pill--small"
                  :disabled="detectionState === 'loading'"
                  @click="redetect"
                >{{ detectionState === 'loading' ? '正在检测…' : '重新检测' }}</button>
              </div>

              <p v-if="detectionError" class="onb-alert" role="alert">{{ detectionError }}</p>

              <div class="onb-host-list">
                <HostStageCard
                  v-for="card in visibleHostCards"
                  :key="card.host.id"
                  :host="card.host"
                  :mode="card.mode"
                  :placeholder="card.placeholder"
                  :selected="selectedHostId === card.host.id"
                  :runtime="detection?.runtime ?? null"
                  :detection-state="detectionState"
                  :install="installResults[card.host.id] ?? null"
                  :install-busy="installingHostId === card.host.id || unblockingHostId === card.host.id"
                  :path-busy="choosingHostId === card.host.id"
                  :install-error="installErrors[card.host.id] ?? ''"
                  @select="selectHost"
                  @install="installHost(card.host.id)"
                  @unblock="unblockHost(card.host.id)"
                  @choose-path="chooseHostProgram(card.host.id)"
                  @choose-home="chooseHostHome(card.host.id)"
                />
              </div>

              <p class="onb-footnote">
                宿主连接可以跳过。跳过之后，桌面角色仍会显示，但不会收到宿主的工作进度。
              </p>

              <div class="onb-actions">
                <button type="button" class="onb-pill onb-pill--ghost" @click="goBack">上一步</button>
                <button v-if="!boundOnboardingHostId" type="button" class="onb-pill onb-pill--ghost" :disabled="actionsBusy" @click="skipCurrent">
                  {{ skipActionLabel('host') }}
                </button>
                <button
                  type="button"
                  class="onb-pill onb-pill--primary"
                  :disabled="!canAdvance || actionsBusy"
                  @click="handlePrimary"
                >{{ hostPrimaryLabel }}</button>
              </div>
            </template>

            <template v-else-if="step === 'character'">
              <p class="onb-eyebrow">STEP {{ stepNumber('character') }} · CHARACTER</p>
              <h1 :id="headingId" ref="headingRef" tabindex="-1" class="onb-title">
                选一个愿意常驻桌面的样子。
              </h1>
              <p class="onb-lede">
                列表来自本机的模型目录。切换会直接作用在桌面上的 Uta，
                你也可以保留默认角色，之后再慢慢挑。
              </p>

              <div class="onb-current">
                <span class="onb-label">当前角色</span>
                <strong class="onb-current__name">{{ currentModelName }}</strong>
                <span v-if="modelBusy" class="onb-status">正在切换…</span>
                <span v-else-if="store.modelUrl" class="onb-status">桌面正在使用</span>
                <span v-else class="onb-status">还没有加载角色</span>
              </div>

              <div class="onb-toolbar">
                <span class="onb-status" role="status" aria-live="polite">{{ modelsStatusText }}</span>
                <button
                  type="button"
                  class="onb-pill onb-pill--ghost onb-pill--small"
                  :disabled="modelsState === 'loading'"
                  @click="rescanModels"
                >{{ modelsState === 'loading' ? '正在扫描…' : '重新扫描' }}</button>
              </div>

              <p v-if="modelsError" class="onb-alert" role="alert">{{ modelsError }}</p>

              <ul class="onb-models">
                <li v-for="model in models" :key="model.url">
                  <button
                    type="button"
                    class="onb-model"
                    :class="{
                      'is-current': model.url === store.modelUrl,
                      'is-selected': model.url === selectedModelUrl && model.url !== store.modelUrl,
                    }"
                    :aria-pressed="model.url === (store.modelUrl || selectedModelUrl)"
                    :disabled="modelBusy"
                    @click="chooseModel(model.url)"
                  >
                    <span class="onb-model__name">{{ model.name }}</span>
                    <span class="onb-model__kind">{{ modelKindLabel(model.kind) }}</span>
                    <span v-if="model.url.includes('hiyori')" class="onb-tag onb-tag--accent">推荐</span>
                    <span v-if="model.url === store.modelUrl" class="onb-tag onb-tag--success">当前</span>
                    <span v-else-if="model.url === selectedModelUrl" class="onb-tag onb-tag--muted">待切换</span>
                  </button>
                </li>
                <li v-if="modelsState === 'loading'" class="onb-empty">正在扫描本机模型…</li>
                <li v-else-if="modelsState === 'ready' && !models.length" class="onb-empty">
                  没有扫描到可选角色。你仍然可以使用当前角色，或稍后把模型放进 models 目录。
                </li>
              </ul>

              <button
                type="button"
                class="onb-default"
                :disabled="!defaultUrl || usingDefault || modelBusy"
                @click="useDefaultModel"
              >
                <OnboardingGlyph name="leaf" :size="15" />
                <span class="onb-default__text">
                  <strong>使用默认角色</strong>
                  <span>{{ defaultModelName }}</span>
                </span>
                <span v-if="usingDefault" class="onb-tag onb-tag--success">正在使用</span>
              </button>

              <p v-if="modelSwitchError" class="onb-alert" role="alert">{{ modelSwitchError }}</p>

              <div class="onb-actions">
                <button type="button" class="onb-pill onb-pill--ghost" @click="goBack">上一步</button>
                <button type="button" class="onb-pill onb-pill--ghost" :disabled="actionsBusy" @click="skipCurrent">
                  {{ skipActionLabel('character') }}
                </button>
                <button
                  type="button"
                  class="onb-pill onb-pill--primary"
                  :disabled="!canAdvance || actionsBusy"
                  @click="handlePrimary"
                >{{ primaryActionLabel('character', reentry) }}</button>
              </div>
            </template>

            <template v-else-if="step === 'voice'">
              <p class="onb-eyebrow">STEP {{ stepNumber('voice') }} · VOICE · 可选</p>
              <h1 :id="headingId" ref="headingRef" tabindex="-1" class="onb-title">
                想听她开口，再打开语音。
              </h1>
              <p class="onb-lede">
                语音默认关闭。整个引导不会播放任何声音，也不会自动试听；
                只有你在这里明确打开，并且完成语音服务配置之后，Uta 才会在之后朗读。
              </p>

              <div class="onb-voice-card" :class="{ 'is-on': draft.ttsEnabled }">
                <span class="onb-voice-card__text">
                  <strong>语音朗读</strong>
                  <span>{{ draft.ttsEnabled ? '已开启，完成引导后生效。' : '保持关闭（默认），不会自动发声。' }}</span>
                </span>
                <button
                  type="button"
                  class="onb-switch"
                  :class="{ 'is-on': draft.ttsEnabled }"
                  role="switch"
                  :aria-checked="draft.ttsEnabled"
                  aria-label="语音朗读"
                  :disabled="actionsBusy"
                  @click="toggleVoice"
                >
                  <span class="onb-switch__knob" aria-hidden="true" />
                </button>
              </div>

              <p class="onb-footnote">
                打开后还需要在「语音」设置里选择声音服务或填写云端配置，才能真正发声。
                这里不会替你试听，也不会改动任何密钥。
              </p>

              <button
                type="button"
                class="onb-pill onb-pill--soft"
                :disabled="actionsBusy"
                @click="openVoiceSettings"
              >
                前往语音设置
              </button>

              <div class="onb-actions">
                <button type="button" class="onb-pill onb-pill--ghost" @click="goBack">上一步</button>
                <button type="button" class="onb-pill onb-pill--ghost" :disabled="actionsBusy" @click="skipCurrent">
                  {{ skipActionLabel('voice') }}
                </button>
                <button type="button" class="onb-pill onb-pill--primary" :disabled="actionsBusy" @click="handlePrimary">
                  {{ primaryActionLabel('voice', reentry) }}
                </button>
              </div>
            </template>

            <template v-else>
              <p class="onb-eyebrow">STEP {{ stepNumber('start') }} · READY</p>
              <h1 :id="headingId" ref="headingRef" tabindex="-1" class="onb-title">
                {{ reentry ? '确认一下，然后回到设置。' : '就到这里，Uta 可以上桌了。' }}
              </h1>
              <p class="onb-lede">
                下面只汇总这次引导里真实确认过的状态；没有验证的部分会明确标出来。
              </p>

              <dl class="onb-summary">
                <div class="onb-summary__row">
                  <dt>宿主</dt>
                  <dd>
                    {{ summaryHostLabel }}
                    <span class="onb-summary__sub">{{ summaryHostStatus }}</span>
                  </dd>
                </div>
                <div class="onb-summary__row">
                  <dt>运行时</dt>
                  <dd>
                    {{ runtimeInfo.hostName }}
                    <span class="onb-summary__sub">{{ runtimeInfoSub }}</span>
                  </dd>
                </div>
                <div class="onb-summary__row">
                  <dt>会话</dt>
                  <dd>
                    <span class="onb-summary__mono">{{ sessionText }}</span>
                    <span v-if="!runtimeInfo.sessionBound" class="onb-summary__sub">
                      还没有绑定会话，等宿主里启动新会话后再连接。
                    </span>
                  </dd>
                </div>
                <div class="onb-summary__row">
                  <dt>角色</dt>
                  <dd>{{ summaryModelName }}</dd>
                </div>
                <div class="onb-summary__row">
                  <dt>语音</dt>
                  <dd>
                    {{ summaryVoiceLabel }}
                    <span class="onb-summary__sub">
                      {{ draft.ttsEnabled
                        ? '完成设置后生效；可以在语音分区继续配置声音服务。'
                        : '保持默认关闭，不会自动播放或试听。' }}
                    </span>
                  </dd>
                </div>
              </dl>

              <p class="onb-footnote">
                Uta 不会自动向宿主发送消息，也不会在本引导里播放任何声音。
              </p>

              <div class="onb-actions">
                <button type="button" class="onb-pill onb-pill--ghost" :disabled="actionsBusy" @click="goBack">上一步</button>
                <button type="button" class="onb-pill onb-pill--primary" :disabled="actionsBusy" @click="complete">
                  {{ primaryActionLabel('start', reentry) }}
                </button>
              </div>
            </template>
          </div>
        </Transition>
      </section>

      <aside class="onb-aside" aria-label="当前选择摘要">
        <div class="onb-aside-card">
          <p class="onb-aside-kicker">CURRENT SETUP</p>
          <div class="onb-organic" aria-hidden="true">
            <span class="onb-organic-shape is-blue" />
            <span class="onb-organic-shape is-sage" />
            <span class="onb-organic-shape is-sand" />
          </div>
          <dl class="onb-aside-list">
            <div>
              <dt>宿主</dt>
              <dd>{{ asideHostLabel }}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{{ asideModelLabel }}</dd>
            </div>
            <div>
              <dt>语音</dt>
              <dd>{{ asideVoiceLabel }}</dd>
            </div>
          </dl>
          <p class="onb-aside-note">这只是当前选择的摘要，不会替代最后一步的确认。</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { getStoredModelPath, listAvailableModels } from '@/services/live2d/model-discovery'
import { MODEL_PATH } from '@/services/model-config'
import type { PublicSettings } from '../../../shared/settings-contracts'
import type {
  OnboardingDetection,
  OnboardingHostId,
  OnboardingInstallResult,
} from '../../../shared/host-onboarding-contracts'
import {
  ONBOARDING_STEPS,
  STEP_HINTS,
  STEP_LABELS,
  advanceFrom,
  buildHostCards,
  canAdvanceFrom,
  canNavigateToStep,
  canSkipStep,
  defaultModelUrl,
  describeError,
  finishedHostId,
  hostName,
  isDefaultModel,
  laterStep,
  modelDisplayName,
  modelKindLabel,
  primaryActionLabel,
  runtimeSummary,
  sessionSummaryText,
  skipActionLabel,
  stepIndex,
  stepNumber,
  summarizeStages,
  voiceStateLabel,
  type DetectionState,
  type OnboardingModelEntry,
  type OnboardingStepId,
  type StepDecision,
} from './onboarding-flow'
import HostStageCard from './HostStageCard.vue'
import OnboardingGlyph from './OnboardingGlyph.vue'

const props = withDefaults(defineProps<{
  draft: PublicSettings
  reentry?: boolean
  busy?: boolean
  finishError?: string
  boundHostId?: string
}>(), { reentry: false, busy: false, finishError: '', boundHostId: '' })

const emit = defineEmits<{
  (event: 'update', patch: Partial<PublicSettings>): void
  (event: 'finish', hostId: string): void
  (event: 'close'): void
  (event: 'open-settings', domain: string, hostId: string): void
}>()

const store = useDeskpetStore()

const boundOnboardingHostId = computed<OnboardingHostId | null>(() => {
  const id = props.boundHostId
  if (!id) return null
  // 'harness' is the pre-unification id; keep it mappable so an old binding still renders.
  return (id === 'harness' || id === 'deepseek-harness' ? 'deepseek-harness' : id) as OnboardingHostId
})
const BOUND_HOST_LABELS: Record<string, string> = {
  codex: 'OpenAI Codex',
  'deepseek-harness': 'DeepSeek Harness',
  harness: 'DeepSeek Harness',
  qoder: 'Qoder',
  antigravity: 'Antigravity',
  'claude-code': 'Claude Code',
  zcode: 'ZCode',
  opencode: 'OpenCode',
}
const boundHostLabel = computed(() => BOUND_HOST_LABELS[props.boundHostId] ?? props.boundHostId)
const hostLockMessage = ref('')
const visibleHostCards = computed(() => {
  const bound = boundOnboardingHostId.value
  const cards = hostCards.value.filter(card =>
    card.placeholder ||
    card.host.installed ||
    card.host.id === 'maibot' ||
    card.host.id === bound,
  )
  if (!bound) return cards
  const matched = cards.filter(card => card.host.id === bound)
  return matched.length > 0 ? matched : cards
})
watch(boundOnboardingHostId, bound => {
  if (!bound) return
  selectedHostId.value = bound
  hostSkipped.value = false
  hostLockMessage.value = ''
})

const step = ref<OnboardingStepId>('welcome')
const furthest = ref<OnboardingStepId>('welcome')
const headingRef = ref<HTMLElement | null>(null)
const railRef = ref<HTMLElement | null>(null)
const headingId = computed(() => `onb-heading-${step.value}`)
const docHidden = ref(typeof document !== 'undefined' ? document.hidden : false)

const reduceMotion = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false,
)
let motionQuery: MediaQueryList | null = null
let disposed = false

/* ------------------------------------------------------------------ */
/* Hosts                                                               */
/* ------------------------------------------------------------------ */

const detection = ref<OnboardingDetection | null>(null)
const detectionState = ref<DetectionState>('idle')
const detectionError = ref('')
const selectedHostId = ref<OnboardingHostId | null>(null)
const hostSkipped = ref(false)
const installingHostId = ref<string | null>(null)
const unblockingHostId = ref<string | null>(null)
const choosingHostId = ref<string | null>(null)
const installResults = reactive<Record<string, OnboardingInstallResult | undefined>>({})
const installErrors = reactive<Record<string, string | undefined>>({})
let detectionSequence = 0

const hostCards = computed(() => buildHostCards(detection.value?.hosts))

const detectionStatusText = computed(() => {
  if (detectionState.value === 'loading') return '正在检测本机宿主与运行时…'
  if (detectionState.value === 'error') return '检测失败，下面是可手动准备的宿主。'
  if (detectionState.value === 'unavailable') return '自动检测暂不可用，下面是可手动准备的宿主。'
  if (detectionState.value === 'idle') return '等待检测…'
  const count = detection.value?.hosts.filter(host => host.installed).length ?? 0
  return count > 0
    ? `检测完成，本机安装了 ${count} 个宿主。`
    : '检测完成，没有发现已安装的宿主。'
})

const currentHostCard = computed(() =>
  selectedHostId.value
    ? hostCards.value.find(card => card.host.id === selectedHostId.value) ?? null
    : null,
)
const currentInstall = computed(() =>
  selectedHostId.value
    ? installResults[selectedHostId.value] ?? null
    : null,
)

async function runDetection(): Promise<void> {
  const sequence = ++detectionSequence
  detectionState.value = 'loading'
  detectionError.value = ''
  try {
    const api = window.utaAPI
    if (!api?.detectOnboardingHosts) {
      if (sequence !== detectionSequence || disposed) return
      detection.value = null
      detectionState.value = 'unavailable'
      detectionError.value = '当前版本没有提供宿主检测接口，无法确认本机安装了哪些宿主。'
      return
    }
    const result = await api.detectOnboardingHosts()
    if (sequence !== detectionSequence || disposed) return
    if (!result || !Array.isArray(result.hosts) || !result.runtime) {
      detection.value = null
      detectionState.value = 'unavailable'
      detectionError.value = '宿主检测没有返回可用结果，暂时无法确认安装与连接状态。'
      return
    }
    detection.value = result
    detectionState.value = 'ready'
    const cards = buildHostCards(result.hosts)
    const bound = boundOnboardingHostId.value
    if (bound && cards.some(card => card.host.id === bound)) {
      selectedHostId.value = bound
      hostSkipped.value = false
      return
    }
    if (selectedHostId.value && !cards.some(card => card.host.id === selectedHostId.value)) {
      selectedHostId.value = null
    }
    if (!selectedHostId.value && !hostSkipped.value) {
      const active = result.runtime.activeHostId
      if (active && cards.some(card => card.host.id === active)) {
        selectedHostId.value = active as OnboardingHostId
      }
    }
  } catch (error) {
    if (sequence !== detectionSequence || disposed) return
    detection.value = null
    detectionState.value = 'error'
    detectionError.value = describeError(error)
  }
}

function redetect(): void {
  // Drop a stale install matrix; otherwise a manual fix keeps showing the old failure.
  for (const key of Object.keys(installResults)) delete installResults[key]
  for (const key of Object.keys(installErrors)) delete installErrors[key]
  void runDetection()
}

function selectHost(hostId: OnboardingHostId): void {
  const bound = boundOnboardingHostId.value
  if (bound && hostId !== bound) {
    hostLockMessage.value = `这只桌宠已绑定到 ${boundHostLabel.value}；不能同时接入另一个宿主。请在设置 → 连接与会话里切换，或先解除绑定。`
    return
  }
  hostLockMessage.value = ''
  selectedHostId.value = hostId
  hostSkipped.value = false
}

async function installHost(hostId: OnboardingHostId): Promise<void> {
  if (installingHostId.value) return
  const card = hostCards.value.find(item => item.host.id === hostId)
  if (!card) return
  if (!card.host.autoInstall) {
    installErrors[hostId] = '这个宿主没有提供自动安装。请按手动步骤准备，然后点击「重新检测」。'
    return
  }
  const api = window.utaAPI
  if (!api?.installOnboardingHost) {
    installErrors[hostId] = '当前版本没有提供自动安装功能。请按手动步骤准备，然后点击「重新检测」。'
    return
  }

  selectedHostId.value = hostId
  hostSkipped.value = false
  installingHostId.value = hostId
  installErrors[hostId] = ''
  try {
    const result = await api.installOnboardingHost(hostId)
    if (disposed) return
    if (!result) {
      installErrors[hostId] = '安装流程没有返回结果，无法确认安装状态。'
      return
    }
    installResults[hostId] = result
    if (!result.ok) {
      installErrors[hostId] = result.error?.trim() || result.detail?.trim() ||
        '安装没有完成，接口没有提供原因。'
    } else {
      // Refresh detection badges without discarding the install matrix.
      void runDetection()
    }
  } catch (error) {
    if (!disposed) installErrors[hostId] = describeError(error)
  } finally {
    if (installingHostId.value === hostId) installingHostId.value = null
  }
}

async function unblockHost(hostId: OnboardingHostId): Promise<void> {
  if (installingHostId.value || unblockingHostId.value) return
  const api = window.utaAPI
  if (!api?.unblockOnboardingHost) {
    installErrors[hostId] = '当前版本没有提供解除阻断接口，请重新启动 Uta 后再试。'
    return
  }
  unblockingHostId.value = hostId
  installErrors[hostId] = ''
  try {
    const result = await api.unblockOnboardingHost(hostId)
    if (disposed) return
    if (!result?.ok) {
      installErrors[hostId] = result?.error === 'install-in-progress'
        ? '安装仍在进行，请稍候再解除阻断。'
        : '无法解除安装阻断，请重新启动 Uta 后再试。'
      return
    }
    delete installResults[hostId]
    delete installErrors[hostId]
    void runDetection()
  } catch (error) {
    if (!disposed) installErrors[hostId] = describeError(error)
  } finally {
    if (unblockingHostId.value === hostId) unblockingHostId.value = null
  }
}

async function chooseHostProgram(hostId: OnboardingHostId): Promise<void> {
  if (choosingHostId.value || installingHostId.value || unblockingHostId.value) return
  const api = window.utaAPI
  if (!api?.chooseHostPath) {
    installErrors[hostId] = '当前版本没有提供宿主路径选择接口。'
    return
  }
  choosingHostId.value = hostId
  installErrors[hostId] = ''
  try {
    const result = await api.chooseHostPath(hostId)
    if (disposed) return
    if (result?.ok) {
      void runDetection()
      return
    }
    if (result?.error !== 'cancelled') {
      installErrors[hostId] = result?.error || '保存宿主路径失败。'
    }
  } catch (error) {
    if (!disposed) installErrors[hostId] = describeError(error)
  } finally {
    if (choosingHostId.value === hostId) choosingHostId.value = null
  }
}

async function chooseHostHome(hostId: OnboardingHostId): Promise<void> {
  if (hostId !== 'deepseek-harness') return
  if (choosingHostId.value || installingHostId.value || unblockingHostId.value) return
  const api = window.utaAPI
  if (!api?.chooseDshHome) {
    installErrors[hostId] = '当前版本没有提供 DSH 数据目录选择接口。'
    return
  }
  choosingHostId.value = hostId
  installErrors[hostId] = ''
  try {
    const result = await api.chooseDshHome()
    if (disposed) return
    if (result?.ok) {
      void runDetection()
      return
    }
    if (result?.error !== 'cancelled') {
      installErrors[hostId] = result?.error || '保存 DSH 数据目录失败。'
    }
  } catch (error) {
    if (!disposed) installErrors[hostId] = describeError(error)
  } finally {
    if (choosingHostId.value === hostId) choosingHostId.value = null
  }
}

/* ------------------------------------------------------------------ */
/* Character                                                           */
/* ------------------------------------------------------------------ */

const models = ref<OnboardingModelEntry[]>([])
const modelsState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const modelsError = ref('')
const selectedModelUrl = ref('')
const modelBusy = ref(false)
const modelSwitchError = ref('')
const characterSkipped = ref(false)
const submitting = ref(false)
const navBusy = computed(() =>
  !!installingHostId.value || !!unblockingHostId.value || !!choosingHostId.value || modelBusy.value,
)
const actionsBusy = computed(() => submitting.value || props.busy || navBusy.value)
watch([() => props.busy, () => props.finishError], ([busy, error]) => {
  if (!busy && error) submitting.value = false
})

function beginSubmit(): boolean {
  if (actionsBusy.value) return false
  submitting.value = true
  return true
}

const currentModelUrl = computed(() => store.modelUrl || selectedModelUrl.value)
const currentModelName = computed(() => modelDisplayName(models.value, currentModelUrl.value))
const defaultUrl = computed(() => defaultModelUrl(models.value, MODEL_PATH))
const defaultModelName = computed(() =>
  defaultUrl.value
    ? modelDisplayName(models.value, defaultUrl.value, '内置默认角色')
    : '没有找到可用的内置模型',
)
const usingDefault = computed(() =>
  isDefaultModel(currentModelUrl.value, models.value, MODEL_PATH),
)
const modelsStatusText = computed(() => {
  if (modelsState.value === 'loading') return '正在扫描本机模型…'
  if (modelsState.value === 'error') return '扫描失败。'
  if (modelsState.value === 'ready') {
    return models.value.length ? `共 ${models.value.length} 个可选角色。` : '没有扫描到可选角色。'
  }
  return '等待扫描…'
})

async function loadModels(forceRescan = false): Promise<void> {
  modelsState.value = 'loading'
  modelsError.value = ''
  try {
    const list = await listAvailableModels(forceRescan)
    if (disposed) return
    models.value = list.map(model => ({ name: model.displayName || model.name, url: model.url, kind: model.kind }))
    modelsState.value = 'ready'
    if (!selectedModelUrl.value) {
      selectedModelUrl.value = store.modelUrl || getStoredModelPath() ||
        defaultModelUrl(models.value, MODEL_PATH)
    }
  } catch (error) {
    if (disposed) return
    modelsState.value = 'error'
    modelsError.value = describeError(error)
  }
}

function rescanModels(): void {
  void loadModels(true)
}

async function chooseModel(url: string): Promise<void> {
  if (!url || modelBusy.value) return
  modelSwitchError.value = ''
  if (url === store.modelUrl) {
    selectedModelUrl.value = url
    characterSkipped.value = false
    return
  }

  modelBusy.value = true
  try {
    await store.requestModelSwitch(url)
    if (disposed) return
    if (store.modelUrl !== url) {
      modelSwitchError.value = '没有切换到这个角色。模型文件可能缺失或无法读取；请重新扫描，或选择其他角色。'
      return
    }
    selectedModelUrl.value = url
    characterSkipped.value = false
  } catch (error) {
    if (!disposed) modelSwitchError.value = `角色切换失败：${describeError(error)}`
  } finally {
    modelBusy.value = false
  }
}

function useDefaultModel(): void {
  if (!defaultUrl.value) {
    modelSwitchError.value = '没有找到可用的默认角色；可以先用当前角色，或跳过这一步。'
    return
  }
  void chooseModel(defaultUrl.value)
}

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

function toggleVoice(): void {
  if (actionsBusy.value) return
  emit('update', { ttsEnabled: !props.draft.ttsEnabled })
}

function openVoiceSettings(): void {
  if (actionsBusy.value) return
  emit('open-settings', 'voice', finishedHostId(selectedHostId.value, hostSkipped.value))
}

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

const hostDecision = computed<StepDecision>(() => {
  if (hostSkipped.value) return 'skipped'
  return selectedHostId.value ? 'done' : 'pending'
})
const characterDecision = computed<StepDecision>(() => {
  if (characterSkipped.value) return 'skipped'
  return (store.modelUrl || selectedModelUrl.value) ? 'done' : 'pending'
})
const decisions = computed(() => ({
  host: hostDecision.value,
  character: characterDecision.value,
}))
const canAdvance = computed(() => canAdvanceFrom(step.value, decisions.value))
const hostPrimaryLabel = computed(() => {
  if (canAdvance.value) return primaryActionLabel('host', props.reentry)
  return detectionState.value === 'loading' ? '正在检测宿主…' : '请选择或跳过宿主'
})

function goTo(target: OnboardingStepId): void {
  step.value = target
  furthest.value = laterStep(furthest.value, target)
}

function jumpTo(target: OnboardingStepId): void {
  if (canNavigateToStep(target, furthest.value)) goTo(target)
}

function goBack(): void {
  const previous = stepIndex(step.value) > 0
    ? ONBOARDING_STEPS[stepIndex(step.value) - 1]
    : null
  if (previous) goTo(previous)
}

function handlePrimary(): void {
  if (step.value === 'start') {
    complete()
    return
  }
  if (actionsBusy.value) return
  const next = advanceFrom(step.value, decisions.value)
  if (next) goTo(next)
}

function skipCurrent(): void {
  if (actionsBusy.value || !canSkipStep(step.value)) return
  if (step.value === 'host') {
    hostSkipped.value = true
    selectedHostId.value = null
  } else if (step.value === 'character') {
    characterSkipped.value = true
  }
  const next = advanceFrom(step.value, {
    host: step.value === 'host' ? 'skipped' : hostDecision.value,
    character: step.value === 'character' ? 'skipped' : characterDecision.value,
  })
  if (next) goTo(next)
}

function railHint(stepId: OnboardingStepId): string {
  if (stepId === 'host') {
    if (hostSkipped.value) return '已跳过'
    return selectedHostId.value ? '已选择' : STEP_HINTS.host
  }
  if (stepId === 'character') {
    if (stepIndex(stepId) > stepIndex(step.value)) return STEP_HINTS.character
    if (characterSkipped.value) return '已跳过'
    return currentModelUrl.value ? '已选择' : STEP_HINTS.character
  }
  if (stepId === 'voice') {
    if (stepIndex(stepId) > stepIndex(step.value)) return STEP_HINTS.voice
    return props.draft.ttsEnabled ? '已开启' : '默认关闭'
  }
  return STEP_HINTS[stepId]
}

function dismissGuide(): void {
  if (!beginSubmit()) return
  emit('finish', 'skipped')
}

function closeGuide(): void {
  if (!beginSubmit()) return
  if (props.reentry) {
    emit('close')
    return
  }
  emit('finish', 'skipped')
}

function complete(): void {
  if (!beginSubmit()) return
  // Reentry also applies the chosen host and saves the optional voice toggle;
  // the parent returns to settings instead of closing the window.
  emit('finish', finishedHostId(selectedHostId.value, hostSkipped.value))
}

function exitOnError(): void {
  if (actionsBusy.value) return
  emit('close')
}

/* ------------------------------------------------------------------ */
/* Start summary                                                       */
/* ------------------------------------------------------------------ */

const runtimeInfo = computed(() => {
  const current = detection.value
  if (!current) return runtimeSummary(null, null)
  const selected = selectedHostId.value
  // The runtime currently exposes Codex sessions only. Never show them under
  // another selected host; DSH starts with "新会话启动后绑定".
  const sessions = selected === 'codex' ? current.runtime.sessions : []
  return runtimeSummary({
    ...current,
    runtime: {
      ...current.runtime,
      sessions,
      activeHostId: selected === 'codex'
        ? (current.runtime.activeHostId || (sessions.length > 0 ? 'codex' : ''))
        : '',
    },
  }, current.hosts)
})
const sessionText = computed(() => sessionSummaryText(runtimeInfo.value))
const runtimeInfoSub = computed(() => {
  if (!runtimeInfo.value.activeHostId) return runtimeInfo.value.connected ? 'Uta 运行时已启动；宿主新会话连接后绑定。' : '尚无可确认的运行时连接。'
  return runtimeInfo.value.connected ? '运行时已连接（检测结果）。' : '运行时未连接（检测结果）。'
})
const summaryHostLabel = computed(() => {
  if (hostSkipped.value || !selectedHostId.value) return '已跳过'
  return hostName(selectedHostId.value, detection.value?.hosts)
})
const summaryHostStatus = computed(() => {
  if (hostSkipped.value || !selectedHostId.value) {
    return '本次没有连接宿主；桌面角色仍可使用，稍后可在「连接与会话」里补上。'
  }
  const runtime = detection.value?.runtime
  if (runtime?.connected && runtime.activeHostId === selectedHostId.value) {
    return '检测结果显示运行时已连接。'
  }
  if (currentHostCard.value?.placeholder) {
    return '本次检测没有返回这个宿主，连接状态未知。'
  }

  const install = currentInstall.value
  if (install) {
    const summary = summarizeStages(install.stages)
    if (!install.ok) return '自动安装未完成，可以回到「连接宿主」重试。'
    return summary.allVerified
      ? '安装结果：全部阶段已验证。'
      : `安装结果：${summary.headline}。`
  }

  const summary = summarizeStages(currentHostCard.value?.host.stages)
  if (summary.hasEvidence) {
    return summary.allVerified
      ? '检测结果：全部阶段已验证。'
      : `检测结果：${summary.headline}。`
  }
  return '连接状态尚未验证；可以回到上一步安装，或稍后在设置里完成。'
})
const summaryModelName = computed(() => {
  const url = store.modelUrl || selectedModelUrl.value
  if (url) return modelDisplayName(models.value, url)
  if (modelsState.value === 'loading') return '正在读取角色…'
  if (defaultUrl.value) return '使用内置默认角色'
  return '没有可确认的角色'
})
const summaryVoiceLabel = computed(() => voiceStateLabel(!!props.draft.ttsEnabled))
const asideHostLabel = computed(() =>
  selectedHostId.value ? hostName(selectedHostId.value, detection.value?.hosts) : '待选择',
)
const asideModelLabel = computed(() =>
  store.modelUrl ? modelDisplayName(models.value, store.modelUrl) : '默认角色',
)
const asideVoiceLabel = computed(() => props.draft.ttsEnabled ? '已开启' : '关闭')

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const onMotionChange = (event: MediaQueryListEvent): void => {
  reduceMotion.value = event.matches
}

const onVisibilityChange = (): void => {
  docHidden.value = document.hidden
}

watch(
  step,
  async () => {
    await nextTick()
    headingRef.value?.focus?.()
    const rail = railRef.value
    if (typeof rail?.querySelector === 'function') {
      rail
        .querySelector<HTMLElement>('.onb-rail__step.is-current')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion.value = motionQuery.matches
    motionQuery.addEventListener?.('change', onMotionChange)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener?.('visibilitychange', onVisibilityChange)
  }
  void runDetection()
  void loadModels()
})

onUnmounted(() => {
  disposed = true
  detectionSequence += 1
  if (typeof document !== 'undefined') {
    document.removeEventListener?.('visibilitychange', onVisibilityChange)
  }
  motionQuery?.removeEventListener?.('change', onMotionChange)
  motionQuery = null
})
</script>

<style src="./onboarding.css"></style>
