<template>
  <div class="settings-stack">
    <section class="settings-panel about-hero" aria-label="关于 Uta">
      <div class="about-brand">
        <div class="about-mark" aria-hidden="true">
          <img src="/uta-icon.svg" class="about-mark-img" alt="Uta" />
        </div>
        <div>
          <h3 class="about-name">Uta</h3>
          <p class="about-tagline">安静地陪在桌面上的角色伴侣</p>
        </div>
      </div>

      <div class="about-facts">
        <div class="about-fact">
          <span class="fact-label">数据环境</span>
          <span class="fact-value" :title="profileIdentifier || profileName">{{ profileName }}</span>
        </div>
        <div class="about-fact">
          <span class="fact-label">设置修订</span>
          <span class="fact-value is-mono">rev.{{ currentRevision ?? 0 }}</span>
        </div>
        <div class="about-fact">
          <span class="fact-label">保存方式</span>
          <span class="fact-value">{{ saving ? '正在自动保存…' : '改动自动保存' }}</span>
        </div>
      </div>

      <p class="settings-note">
        设置与密钥都保存在当前实例的本机数据目录中。完整路径、版本与构建信息在下方“诊断信息”里按需展开。
      </p>
    </section>

    <section class="settings-panel" aria-label="首次使用引导">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">首次使用</span>
          <h3 class="panel-title">重新打开引导</h3>
          <p class="panel-hint">重新检查宿主、选择角色和语音设置；不会清除现有偏好或预设。</p>
        </div>
      </div>
      <button type="button" class="uta-button is-secondary" @click="emit('reopen-onboarding')">
        重新打开首次引导
      </button>
    </section>

    <section class="settings-panel" aria-label="宿主绑定">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">宿主绑定</span>
          <h3 class="panel-title">{{ boundHostName || '尚未绑定宿主' }}</h3>
          <p class="panel-hint">
            一只桌宠只绑定一个宿主。该宿主的所有会话共用这只桌宠；其他宿主的事件会被忽略。
          </p>
        </div>
      </div>
      <p v-if="boundHostName" class="settings-note">
        要换宿主，直接在“连接与会话”里点另一个宿主即可切换。解除绑定会让桌宠重启并回到独立待机。
      </p>
      <p v-else class="settings-note">
        从“重新打开首次引导”选择一个宿主后，这只桌宠会固定绑定到它。
      </p>
      <p v-if="unbindMessage" class="settings-note" role="status">{{ unbindMessage }}</p>
      <div v-if="boundHostName" class="about-unbind-actions">
        <button
          type="button"
          class="uta-button"
          :class="confirmingUnbind ? 'is-danger' : 'is-secondary'"
          :disabled="unbindBusy"
          @click="requestUnbind"
        >
          {{ unbindBusy ? '正在解除…' : confirmingUnbind ? '确认解除宿主绑定' : '解除宿主绑定' }}
        </button>
        <button
          v-if="confirmingUnbind"
          type="button"
          class="uta-button is-secondary"
          :disabled="unbindBusy"
          @click="confirmingUnbind = false"
        >取消</button>
      </div>
      <p v-if="confirmingUnbind" class="settings-note" role="alert">
        解除后这只桌宠会停止接收 {{ boundHostName }} 的事件，需要重新绑定后才能继续使用。
      </p>
    </section>

    <SettingsTransferPanel :disabled="saving" />
    <SettingsImportPanel :disabled="saving" />
    <RuntimeDiagnostics />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SettingsImportPanel from '../SettingsImportPanel.vue'
import SettingsTransferPanel from '../SettingsTransferPanel.vue'
import RuntimeDiagnostics from '../../components/RuntimeDiagnostics.vue'

defineProps<{
  profileName: string
  profileIdentifier: string | null
  currentRevision: number | null
  saving: boolean
  boundHostName?: string
  unbindBusy?: boolean
  unbindMessage?: string
}>()
const emit = defineEmits<{
  (event: 'reopen-onboarding'): void
  (event: 'unbind-host'): void
}>()

const confirmingUnbind = ref(false)

function requestUnbind(): void {
  if (!confirmingUnbind.value) {
    confirmingUnbind.value = true
    return
  }
  confirmingUnbind.value = false
  emit('unbind-host')
}
</script>

<style scoped>
.about-unbind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.about-hero {
  padding: 20px;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 13px;
}

.about-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: transparent;
  overflow: hidden;
}

.about-mark-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.about-name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--uta-ink);
}

.about-tagline {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--uta-secondary);
}

.about-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin-top: 16px;
}

.about-fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background-color: var(--uta-canvas);
}

.fact-label {
  font-size: 11px;
  color: var(--uta-secondary);
}

.fact-value {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uta-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fact-value.is-mono {
  font-family: var(--uta-font-mono);
}

.uta-button.is-danger {
  background-color: var(--uta-error);
  color: #ffffff;
}

@media (max-width: 700px) {
  .about-facts {
    grid-template-columns: 1fr;
  }
}
</style>
