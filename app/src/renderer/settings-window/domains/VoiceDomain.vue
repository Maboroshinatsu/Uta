<template>
  <div class="settings-stack">
    <div class="voice-tabbar">
      <div class="segmented" role="group" aria-label="语音设置分类">
        <button
          type="button"
          class="segmented-btn"
          :class="{ 'is-active': tab === 'tts' }"
          :aria-pressed="tab === 'tts'"
          @click="tab = 'tts'"
        >
          语音播报
        </button>
        <button
          type="button"
          class="segmented-btn"
          :class="{ 'is-active': tab === 'stt' }"
          :aria-pressed="tab === 'stt'"
          @click="tab = 'stt'"
        >
          语音输入
        </button>
      </div>
    </div>

    <div :hidden="tab !== 'tts'" class="voice-tab-panel">
      <section class="settings-panel" aria-label="朗读行为">
        <div class="panel-head">
          <div class="panel-head-copy">
            <span class="panel-kicker">是否朗读</span>
            <h3 class="panel-title">让 Uta 开口</h3>
            <p class="panel-hint">关闭后不会自动朗读回复或动作解说，但仍可以在下方手动试听。</p>
          </div>
          <SettingsToggle
            :model-value="draft.ttsEnabled"
            aria-label="语音播报总开关"
            @update:model-value="value => update({ ttsEnabled: value })"
          />
        </div>

        <div :class="{ 'is-muted': !draft.ttsEnabled }">
          <SettingsRow
            label="朗读回复摘要"
            html-for="speak-replies"
            description="朗读宿主回复的一两句摘要，跳过代码、表格和链接。"
            :disabled="!draft.ttsEnabled"
          >
            <SettingsToggle
              id="speak-replies"
              aria-label="朗读回复摘要"
              :model-value="draft.ttsSpeakReplies"
              :disabled="!draft.ttsEnabled"
              @update:model-value="value => update({ ttsSpeakReplies: value })"
            />
          </SettingsRow>
          <SettingsRow
            label="朗读动作解说"
            html-for="speak-narration"
            description="角色执行工具或思考时插入短句解说，并把这些短句读出来。"
            :disabled="!draft.ttsEnabled"
          >
            <SettingsToggle
              id="speak-narration"
              aria-label="朗读动作解说"
              :model-value="draft.ttsSpeakNarration"
              :disabled="!draft.ttsEnabled"
              @update:model-value="value => update({ ttsSpeakNarration: value })"
            />
          </SettingsRow>
        </div>
      </section>

      <TtsSettingsSection
        :provider="draft.ttsProvider"
        :rate="draft.ttsRate"
        :volume="draft.ttsVolume"
        @update:provider="value => update({ ttsProvider: value })"
        @update:rate="value => update({ ttsRate: value })"
        @update:volume="value => update({ ttsVolume: value })"
      />
    </div>

    <SttSettingsSection :hidden="tab !== 'stt'" />

    <div class="save-scope-note">
      <strong>这里的保存规则</strong>
      <span>朗读开关、回复摘要、语速与音量属于偏好，改动后立即保存；服务地址自动保存，API 密钥在对应服务中单独保存。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { PublicSettings } from '../../../shared/settings-contracts'
import SettingsToggle from '../../components/settings-v2/SettingsToggle.vue'
import SettingsRow from '../../components/settings-v2/SettingsRow.vue'
import TtsSettingsSection from '../../components/TtsSettingsSection.vue'
import SttSettingsSection from '../../components/SttSettingsSection.vue'

defineProps<{ draft: PublicSettings }>()
const emit = defineEmits<{ (event: 'update', patch: Partial<PublicSettings>): void }>()
const tab = ref<'tts' | 'stt'>('tts')

function update(patch: Partial<PublicSettings>): void {
  emit('update', patch)
}
</script>

<style scoped>
.voice-tabbar {
  display: flex;
  justify-content: flex-start;
}

.voice-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.voice-tab-panel[hidden] {
  display: none;
}

.is-muted {
  opacity: 1;
}

.save-scope-note {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 11px;
  border: 1px solid var(--uta-separator);
  background-color: var(--uta-surface-subtle);
  color: var(--uta-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.save-scope-note strong {
  color: var(--uta-ink);
  font-size: 12px;
  font-weight: 650;
}
</style>
