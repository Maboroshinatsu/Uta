<template>
  <div class="settings-stack">
    <section class="settings-panel" aria-label="提醒与表现">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">提醒与表现</span>
          <h3 class="panel-title">待办通知与桌宠表现</h3>
          <p class="panel-hint">设置日常待办到点时的声音、动作和气泡。待办事项在桌宠窗口里管理。</p>
        </div>
      </div>

      <SettingsRow
        label="到点播放提示音"
        html-for="todo-reminder-sound"
        description="有待办到点时，播放轻柔的提示音。"
        :disabled="!dailyState || !!dailyState.error"
      >
        <SettingsToggle
          id="todo-reminder-sound"
          :model-value="dailyState?.reminderSound === true"
          :disabled="soundBusy || !dailyState || !!dailyState.error"
          aria-label="到点播放提示音"
          @update:model-value="onSoundToggle"
        />
      </SettingsRow>
      <p v-if="soundError || dailyError || dailyState?.error" class="settings-note is-warning" role="alert">
        {{ soundError || dailyError || '待办数据无法读取，暂时无法更改提示音开关。' }}
      </p>

      <SettingsRow
        v-if="dailyState?.reminderSound"
        label="提示音风格"
        html-for="todo-reminder-style"
        description="选择到点提醒时的铃声风格。"
      >
        <select id="todo-reminder-style" v-model="settings.soundType" class="reminder-select">
          <option v-for="opt in REMINDER_SOUND_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
        <button type="button" class="uta-button is-secondary" @click="testSound">试听</button>
      </SettingsRow>

      <SettingsRow
        label="桌宠提醒表现"
        html-for="todo-reminder-preset"
        description="到点时桌宠表演的动画预设。"
      >
        <select id="todo-reminder-preset" v-model="selectedPreset" class="reminder-select" :disabled="!availablePresets.length">
          <option v-if="!availablePresets.some(preset => preset.id === selectedPreset)" :value="selectedPreset">
            {{ settings.reminderPreset }}
          </option>
          <option v-for="preset in availablePresets" :key="preset.id" :value="preset.id">
            {{ preset.label || preset.id }}
          </option>
        </select>
      </SettingsRow>

      <SettingsRow
        label="提醒气泡停留时长"
        html-for="todo-reminder-duration"
        description="控制待办提醒气泡在桌宠窗口里的停留时间。"
      >
        <SettingsSlider
          id="todo-reminder-duration"
          v-model="settings.bubbleDurationSec"
          :min="3"
          :max="30"
          unit="秒"
          class="reminder-duration"
        />
      </SettingsRow>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDailyState } from '@/composables/useDailyState'
import { legacySoundDisabled, migrateLegacySoundSetting, useTodoSettings } from '@/services/todo-settings'
import { playReminderChime, REMINDER_SOUND_OPTIONS } from '@/services/reminder-chime'
import { useDeskpetStore } from '@/stores/deskpet'
import SettingsRow from '@/components/settings-v2/SettingsRow.vue'
import SettingsSlider from '@/components/settings-v2/SettingsSlider.vue'
import SettingsToggle from '@/components/settings-v2/SettingsToggle.vue'

const { state: dailyState, error: dailyError, refresh: refreshDaily } = useDailyState()
const settings = useTodoSettings()
const deskpetStore = useDeskpetStore()
const soundBusy = ref(false)
const soundError = ref('')

const availablePresets = computed(() => deskpetStore.statePresets)
const selectedPreset = computed({
  get() {
    const stored = settings.reminderPreset
    return availablePresets.value.find(preset => preset.id === stored)?.id
      ?? availablePresets.value.find(preset => preset.label === stored)?.id
      ?? stored
  },
  set(id: string) { settings.reminderPreset = id },
})

async function onSoundToggle(enabled: boolean): Promise<void> {
  if (soundBusy.value) return
  soundBusy.value = true
  soundError.value = ''
  try {
    await migrateLegacySoundSetting(window.utaAPI)
    if (legacySoundDisabled()) {
      soundError.value = '旧提示音设置尚未迁移，请检查待办数据后重试。'
      return
    }
    const result = await window.utaAPI?.dailySetReminderSound?.(enabled)
    if (!result?.ok) soundError.value = result?.error || '提示音设置保存失败。'
    await refreshDaily()
  } catch {
    soundError.value = '提示音设置保存失败。'
  } finally {
    soundBusy.value = false
  }
}

function testSound(): void {
  playReminderChime(settings.soundType)
}
</script>

<style scoped>
.settings-note.is-warning { color: var(--uta-danger-text); }

.reminder-select {
  width: 150px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--uta-input-border);
  border-radius: 9px;
  background: var(--uta-input);
  color: var(--uta-ink);
  font-size: 13px;
}

.reminder-select:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: 2px;
}

.reminder-duration {
  width: clamp(115px, 20vw, 230px);
}
</style>
