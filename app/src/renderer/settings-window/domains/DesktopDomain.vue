<template>
  <div class="settings-stack">
    <section class="settings-panel" aria-label="消息显示">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">消息显示</span>
          <h3 class="panel-title">消息中的称呼</h3>
        </div>
      </div>
      <SettingsRow label="自定义显示名称" html-for="chat-display-name"
        description="留空时显示每条消息所属的宿主名称；填写后使用这个称呼，消息来源仍会保留。">
        <input id="chat-display-name" class="chat-name-input" type="text" maxlength="40"
          :value="draft.chatDisplayName" placeholder="默认使用宿主名称"
          @input="event => update({ chatDisplayName: (event.target as HTMLInputElement).value })" />
      </SettingsRow>
    </section>
    <section class="settings-panel" aria-label="角色互动">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">角色互动</span>
          <h3 class="panel-title">桌面上的自然反应</h3>
          <p class="panel-hint">这些开关只影响桌宠窗口，不会改变设置中心本身。</p>
        </div>
      </div>

      <SettingsRow
        label="视线跟随光标"
        html-for="gaze-follow"
        :description="displayMode === 'live2d'
          ? '角色会自然地看向鼠标在屏幕上的位置；关闭后视线停在正前方。'
          : '静态立绘没有可驱动的视线层，切换回 Live2D 角色后可用。'"
        :disabled="displayMode !== 'live2d'"
        :disabled-reason="displayMode === 'live2d' ? '' : '静态立绘不支持视线跟随。'"
      >
        <SettingsToggle
          id="gaze-follow"
          aria-label="视线跟随光标"
          :model-value="draft.gazeFollowEnabled"
          :disabled="displayMode !== 'live2d'"
          @update:model-value="value => update({ gazeFollowEnabled: value })"
        />
      </SettingsRow>

      <SettingsRow
        label="待机微动作"
        html-for="idle-actions"
        description="控制 Uta 的空闲小动作；关闭后仍保留模型自带呼吸、眨眼和工作状态反馈。"
      >
        <SettingsToggle
          id="idle-actions"
          aria-label="待机微动作"
          :model-value="draft.idleActionsEnabled"
          @update:model-value="value => update({ idleActionsEnabled: value })"
        />
      </SettingsRow>

      <SettingsRow
        label="安静模式"
        html-for="quiet-mode"
        description="关闭待机微动作和状态解说；宿主回复的语音播报仍按语音页设置。"
      >
        <SettingsToggle
          id="quiet-mode"
          aria-label="安静模式"
          :model-value="!draft.idleActionsEnabled && !draft.ttsSpeakNarration"
          @update:model-value="value => update(toggleQuietPreferences(draft, value))"
        />
      </SettingsRow>

      <SettingsRow
        label="悬停时变淡"
        html-for="hover-fade"
        description="鼠标移到角色身上时会明显降低透明度，避免挡住下面的内容；只影响显示，不改变模型位置。"
      >
        <SettingsToggle
          id="hover-fade"
          aria-label="悬停时轻微变淡"
          :model-value="draft.hoverFadeEnabled"
          @update:model-value="value => update({ hoverFadeEnabled: value })"
        />
      </SettingsRow>
    </section>

    <section class="settings-panel" aria-label="窗口穿透与恢复">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">窗口行为</span>
          <h3 class="panel-title">穿透与找回窗口</h3>
          <p class="panel-hint">穿透只影响桌宠窗口；设置中心始终可以正常点击。</p>
        </div>
      </div>

      <SettingsRow
        label="锁定鼠标穿透"
        html-for="click-through"
        description="开启后鼠标点击会穿过桌宠；可在本页开关、托盘菜单或快捷键 Ctrl+Alt+L 解除。"
        :disabled="!clickThroughSupported"
        :disabled-reason="clickThroughSupported ? '' : '当前环境没有连接桌宠主进程，无法切换穿透。'"
      >
        <SettingsToggle
          id="click-through"
          aria-label="锁定鼠标穿透"
          :model-value="clickThrough"
          :disabled="!clickThroughSupported || clickThroughBusy"
          @update:model-value="value => emit('toggle-click-through', value)"
        />
      </SettingsRow>

      <p class="settings-note">
        <strong>找回窗口：</strong>如果桌宠被拖到屏幕外或找不到，请在右下角系统托盘图标上右键，选择“重置窗口位置”即可居中召回。
      </p>
      <p v-if="voiceShortcut" class="shortcut-note">语音输入快捷键：<strong>{{ voiceShortcut }}</strong></p>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { PublicSettings } from '../../../shared/settings-contracts'
import { toggleQuietPreferences } from '../../services/quiet-preferences'
import SettingsRow from '../../components/settings-v2/SettingsRow.vue'
import SettingsToggle from '../../components/settings-v2/SettingsToggle.vue'

defineProps<{
  draft: PublicSettings
  clickThrough: boolean
  clickThroughBusy: boolean
  clickThroughSupported: boolean
  voiceShortcut: string
  displayMode: 'live2d' | 'image-set'
}>()
const emit = defineEmits<{
  (event: 'update', patch: Partial<PublicSettings>): void
  (event: 'toggle-click-through', value: boolean): void
}>()

function update(patch: Partial<PublicSettings>): void {
  emit('update', patch)
}
</script>

<style scoped>
.chat-name-input {
  width: 100%;
  max-width: 240px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--uta-separator);
  border-radius: 10px;
  background: var(--uta-surface);
  color: var(--uta-ink);
  font: inherit;
}
.chat-name-input:focus-visible {
  outline: 2px solid var(--uta-accent);
  outline-offset: 2px;
}
.shortcut-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--uta-secondary);
}

.shortcut-note strong {
  color: var(--uta-ink);
  font-family: var(--uta-font-mono);
}
</style>
