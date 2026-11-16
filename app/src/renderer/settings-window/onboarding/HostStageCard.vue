<template>
  <article
    class="onb-host"
    :class="{ 'is-selected': selected, 'is-placeholder': placeholder }"
    :aria-label="host.name"
  >
    <button
      type="button"
      class="onb-host__choice"
      :aria-pressed="selected"
      :aria-expanded="selected"
      :aria-controls="selected ? bodyId : undefined"
      @click="$emit('select', host.id)"
    >
      <span class="onb-host__radio" aria-hidden="true">
        <span v-if="selected" class="onb-host__radio-dot" />
      </span>
      <span class="onb-host__head">
        <span class="onb-host__title">
          <span class="onb-host__name">{{ host.name }}</span>
          <span class="onb-tag" :class="`onb-tag--${modeTagTone}`">{{ hostModeLabel(mode) }}</span>
        </span>
        <span class="onb-host__desc">{{ host.description }}</span>
        <span class="onb-host__badges">
          <span
            v-for="badge in badges"
            :key="badge.id"
            class="onb-tag"
            :class="`onb-tag--${badge.tone}`"
          >{{ badge.label }}</span>
        </span>
      </span>
      <span class="onb-host__chevron" aria-hidden="true">
        <OnboardingGlyph name="chevron" :size="14" />
      </span>
    </button>

    <div v-if="selected" :id="bodyId" class="onb-host__body">
      <p v-if="placeholder" class="onb-note">
        本次检测没有返回这个宿主的信息。请先安装并登录 {{ host.name }}，再点「重新检测」；
        也可以跳过，稍后在设置里连接。
      </p>

      <template v-else>
        <div v-if="matrixEvidence" class="onb-host__matrix">
          <div class="onb-host__matrix-head">
            <span class="onb-label">安装与连接阶段</span>
            <span class="onb-host__matrix-summary">{{ summary.headline }}</span>
          </div>
          <ol class="onb-stages">
            <li
              v-for="stage in matrix"
              :key="stage.id"
              class="onb-stage-row"
              :class="`is-${stage.state}`"
            >
              <span class="onb-stage-row__mark" aria-hidden="true">
                <OnboardingGlyph :name="stageGlyph(stage.state)" :size="13" />
              </span>
              <span class="onb-stage-row__text">
                <span class="onb-stage-row__name">{{ STAGE_LABELS[stage.id] }}</span>
                <span class="onb-stage-row__detail">{{ stage.detail }}</span>
              </span>
              <span class="onb-stage-row__state">{{ STAGE_STATE_LABELS[stage.state] }}</span>
            </li>
          </ol>
        </div>
        <p v-else class="onb-note">
          还没有这一宿主的阶段结果。执行安装并连接后，会逐项显示检测、插件、工具、运行时、会话与回声的真实状态。
        </p>

        <p v-if="install?.ok && summary.allVerified" class="onb-note is-success" role="status">
          安装流程已完成，全部阶段验证通过。
        </p>
        <p
          v-else-if="install?.ok"
          class="onb-note is-warning"
          role="status"
        >
          安装流程已返回结果，但还有阶段未验证。未验证的阶段不会被当成已连接。
        </p>

        <p v-if="failureMessage" class="onb-alert" role="alert">{{ failureMessage }}</p>
        <p v-else-if="detailNote" class="onb-note">{{ detailNote }}</p>

        <div v-if="install?.backupPath" class="onb-kv">
          <span class="onb-label">配置备份</span>
          <code>{{ install.backupPath }}</code>
        </div>

        <ul v-if="notices.length" class="onb-notices">
          <li v-for="notice in notices" :key="notice">{{ notice }}</li>
        </ul>

        <ul v-if="host.notes.length" class="onb-notes">
          <li v-for="note in host.notes" :key="note">{{ note }}</li>
        </ul>

        <div
          v-if="host.autoInstall || host.pathActionLabel || host.homeActionLabel"
          class="onb-host__actions"
        >
          <button
            v-if="host.autoInstall"
            type="button"
            class="onb-pill onb-pill--action"
            :disabled="installBusy || pathBusy || install?.retryBlocked"
            @click="$emit('install')"
          >
            {{ installButtonLabel }}
          </button>
          <button
            v-if="install?.retryBlocked"
            type="button"
            class="onb-pill onb-pill--ghost"
            :disabled="installBusy || pathBusy"
            @click="$emit('unblock')"
          >
            {{ unblockLabel }}
          </button>
          <button
            v-if="host.pathActionLabel"
            type="button"
            class="onb-pill onb-pill--ghost"
            :disabled="installBusy || pathBusy"
            @click="$emit('choose-path')"
          >
            {{ host.pathActionLabel }}
          </button>
          <button
            v-if="host.homeActionLabel"
            type="button"
            class="onb-pill onb-pill--ghost"
            :disabled="installBusy || pathBusy"
            @click="$emit('choose-home')"
          >
            {{ host.homeActionLabel }}
          </button>
          <span class="onb-host__action-note">
            {{ host.installNote || '只修改这个宿主的插件与桥接配置，不会覆盖你的其他设置。' }}
          </span>
        </div>
        <p v-else class="onb-note">
          这个宿主没有可用的自动安装。请按下面的步骤手动准备，完成后点「重新检测」。
        </p>

        <ol v-if="showManualSteps" class="onb-manual">
          <li v-for="(step, index) in host.manualSteps" :key="`${index}-${step}`">{{ step }}</li>
        </ol>
        <p v-else-if="!host.autoInstall" class="onb-note">
          {{ host.name }} 没有提供手动步骤。请参考它的官方安装说明，然后重新检测。
        </p>
      </template>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  OnboardingDetection,
  OnboardingHost,
  OnboardingHostId,
  OnboardingInstallResult,
  OnboardingStageState,
} from '../../../shared/host-onboarding-contracts'
import {
  STAGE_LABELS,
  STAGE_STATE_LABELS,
  hasStageEvidence,
  hostBadges,
  hostModeLabel,
  mergeStageLists,
  orderedStages,
  summarizeStages,
  type DetectionState,
  type HostMode,
} from './onboarding-flow'
import OnboardingGlyph from './OnboardingGlyph.vue'

const props = defineProps<{
  host: OnboardingHost
  mode: HostMode
  placeholder: boolean
  selected: boolean
  runtime: OnboardingDetection['runtime'] | null
  detectionState: DetectionState
  install: OnboardingInstallResult | null
  installBusy: boolean
  pathBusy: boolean
  installError: string
}>()

defineEmits<{
  (event: 'select', hostId: OnboardingHostId): void
  (event: 'install'): void
  (event: 'unblock'): void
  (event: 'choose-path'): void
  (event: 'choose-home'): void
}>()

const bodyId = computed(() => `onb-host-body-${props.host.id}`)

const modeTagTone = computed(() => {
  if (props.mode === 'auto') return 'accent'
  if (props.mode === 'compatible') return 'muted'
  return 'warning'
})

const badges = computed(() =>
  hostBadges(props.host, props.runtime, props.detectionState, props.placeholder),
)

const mergedStages = computed(() => mergeStageLists(props.host.stages, props.install?.stages))
const matrix = computed(() => orderedStages(mergedStages.value))
const summary = computed(() => summarizeStages(mergedStages.value))
const matrixEvidence = computed(
  () => hasStageEvidence(props.host.stages) || hasStageEvidence(props.install?.stages),
)

const notices = computed(() => {
  const result = props.install
  const list: string[] = []
  if (result?.restartRequired) {
    list.push(`需要重启 ${props.host.name}，插件才会生效。`)
  }
  if (result?.sessionRequired) {
    list.push(`需要在 ${props.host.name} 里新建会话，Uta 才会绑定并接收消息。`)
  }
  return list
})

const failureMessage = computed(() => {
  const result = props.install
  if (!result) return props.installError
  if (result.ok) return props.installError
  return result.error?.trim() || props.installError || result.detail?.trim() ||
    '安装没有完成，接口没有提供原因。'
})

const detailNote = computed(() => {
  const result = props.install
  return result?.ok && result.detail?.trim() ? result.detail.trim() : ''
})

const showManualSteps = computed(() => {
  if (!props.host.manualSteps.length) return false
  return !props.host.autoInstall || summary.value.manual > 0 ||
    props.install?.ok === false || !!props.installError
})

const installBaseLabel = computed(() => props.host.installLabel || '安装并连接')
const installButtonLabel = computed(() => {
  if (props.installBusy) return `正在${installBaseLabel.value}…`
  if (props.install?.retryBlocked) return '安装已暂停'
  if (props.installError) return `重试${installBaseLabel.value}`
  return props.install ? `重新${installBaseLabel.value}` : installBaseLabel.value
})
const unblockLabel = computed(() =>
  props.host.id === 'deepseek-harness' ? '已退出 DSH，解除安装阻断' : '已退出 Codex，解除安装阻断',
)

function stageGlyph(state: OnboardingStageState): 'check' | 'clock' | 'hand' | 'alert' | 'dash' {
  if (state === 'verified') return 'check'
  if (state === 'pending') return 'clock'
  if (state === 'manual') return 'hand'
  if (state === 'failed') return 'alert'
  return 'dash'
}
</script>
