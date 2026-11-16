<template>
  <div class="settings-stack">
    <section class="settings-panel" aria-label="主题外观">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">外观</span>
          <h3 class="panel-title">主题与强调色</h3>
          <p class="panel-hint">主题会同时应用到设置中心和桌宠的界面提示。强调色用于按钮、开关和选中状态。</p>
        </div>
      </div>

      <span class="field-label">明暗主题</span>
      <div class="theme-grid">
        <button
          type="button"
          class="theme-card"
          :class="{ 'is-active': draft.themeMode === 'light' }"
          :aria-pressed="draft.themeMode === 'light'"
          @click="update({ themeMode: 'light' })"
        >
          <span class="theme-sample theme-light" aria-hidden="true">
            <span class="sample-nav" />
            <span class="sample-body"><span /><span /></span>
          </span>
          <span class="theme-name">浅色</span>
          <span class="theme-desc">日光、通透</span>
        </button>
        <button
          type="button"
          class="theme-card"
          :class="{ 'is-active': draft.themeMode === 'dark' }"
          :aria-pressed="draft.themeMode === 'dark'"
          @click="update({ themeMode: 'dark' })"
        >
          <span class="theme-sample theme-dark" aria-hidden="true">
            <span class="sample-nav" />
            <span class="sample-body"><span /><span /></span>
          </span>
          <span class="theme-name">深色</span>
          <span class="theme-desc">安静、低亮</span>
        </button>
      </div>

      <span class="field-label">强调色</span>
      <div class="swatch-row">
        <button
          v-for="color in presetColors"
          :key="color.hex"
          type="button"
          class="swatch"
          :class="{ 'is-active': draft.accentColor.toLowerCase() === color.hex.toLowerCase() }"
          :style="{ backgroundColor: color.hex }"
          :title="color.label"
          :aria-label="`强调色：${color.label}`"
          :aria-pressed="draft.accentColor.toLowerCase() === color.hex.toLowerCase()"
          @click="update({ accentColor: color.hex })"
        >
          <SettingsIcon v-if="draft.accentColor.toLowerCase() === color.hex.toLowerCase()" name="check" :size="13" />
        </button>
      </div>

      <div class="custom-color-row">
        <span class="custom-color-label">自定义颜色</span>
        <div class="custom-color-input-wrap" :class="{ 'is-invalid': accentInvalid }">
          <label class="color-picker-trigger" title="点击打开系统调色盘选色">
            <span class="color-preview" :style="{ backgroundColor: accentPreview }" aria-hidden="true">
              <svg class="color-palette-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
              </svg>
            </span>
            <input
              ref="nativeColorInputRef"
              type="color"
              class="native-color-input"
              :value="accentPreview"
              aria-label="打开系统调色盘"
              @input="onColorPickerInput"
            />
          </label>
          <input
            id="accent-color-hex"
            :value="draft.accentColor"
            class="hex-input"
            type="text"
            placeholder="#3d6a8e"
            maxlength="7"
            spellcheck="false"
            :aria-invalid="accentInvalid ? 'true' : undefined"
            :aria-describedby="accentInvalid ? 'accent-color-hint' : undefined"
            @input="event => update({ accentColor: (event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="palette-btn pressable"
            title="打开系统调色盘"
            @click="openPalette"
          >
            调色盘
          </button>
        </div>
      </div>
      <p id="accent-color-hint" class="settings-note" :class="{ 'is-warning': accentInvalid }">
        {{ accentInvalid
          ? '颜色需为完整的 #RRGGBB；当前保留上一次可用颜色，补全后立即预览并保存。'
          : '如果颜色值暂时不完整，界面会保留上一次可用的颜色；输入完整后立即预览。' }}
      </p>
    </section>

    <section class="settings-panel" aria-label="渲染性能">
      <div class="panel-head">
        <div class="panel-head-copy">
          <span class="panel-kicker">性能</span>
          <h3 class="panel-title">刷新率与空闲降帧</h3>
          <p class="panel-hint">越高越顺滑，CPU 占用也越高。自适应会跟随当前显示器。</p>
        </div>
        <span v-if="displayHz" class="panel-badge">{{ displayHz }} Hz 显示器</span>
      </div>

      <span class="field-label">渲染上限</span>
      <div class="segmented" role="group" aria-label="渲染上限">
        <button
          v-for="option in fpsOptions"
          :key="option.id"
          type="button"
          class="segmented-btn"
          :class="{ 'is-active': renderFps === option.id }"
          :aria-pressed="renderFps === option.id"
          @click="emit('set-render-fps', option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <SettingsRow
        label="空闲自动降帧"
        html-for="adaptive-idle"
        description="鼠标停止移动几秒后降到 30 fps；任意移动鼠标会立即恢复到上面的上限。"
      >
        <SettingsToggle
          id="adaptive-idle"
          aria-label="空闲自动降帧"
          :model-value="adaptiveIdle"
          @update:model-value="value => emit('toggle-adaptive-idle', value)"
        />
      </SettingsRow>

      <div v-if="performancePending" class="performance-apply">
        <span>刷新率偏好已保存到本机，重新加载桌宠窗口后生效。</span>
        <button type="button" class="uta-button is-secondary" @click="emit('reload-pet')">重新加载桌宠窗口</button>
      </div>
      <p v-else-if="performanceError" class="settings-note is-warning" role="alert">
        {{ performanceError }}
        <button type="button" class="settings-link-btn" @click="emit('retry-performance')">重试保存</button>
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PublicSettings } from '../../../shared/settings-contracts'
import SettingsIcon from '../../components/settings-v2/SettingsIcon.vue'
import SettingsRow from '../../components/settings-v2/SettingsRow.vue'
import SettingsToggle from '../../components/settings-v2/SettingsToggle.vue'

type RenderFpsChoice = '30' | '60' | '120' | 'auto'

const props = defineProps<{
  draft: PublicSettings
  renderFps: RenderFpsChoice
  adaptiveIdle: boolean
  displayHz: number | null
  performancePending: boolean
  performanceError: string
}>()
const emit = defineEmits<{
  (event: 'update', patch: Partial<PublicSettings>): void
  (event: 'set-render-fps', mode: RenderFpsChoice): void
  (event: 'toggle-adaptive-idle', value: boolean): void
  (event: 'retry-performance'): void
  (event: 'reload-pet'): void
}>()

const nativeColorInputRef = ref<HTMLInputElement | null>(null)
const accentInvalid = computed(() => !/^#[0-9a-fA-F]{6}$/.test(props.draft.accentColor))
const lastValidAccent = ref(safeHex(props.draft.accentColor))
watch(() => props.draft.accentColor, value => {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) lastValidAccent.value = value
})
const accentPreview = computed(() => accentInvalid.value ? lastValidAccent.value : props.draft.accentColor)

function safeHex(val: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val
  return '#3d6a8e'
}

function onColorPickerInput(e: Event): void {
  const hex = (e.target as HTMLInputElement).value
  if (hex) update({ accentColor: hex })
}

function openPalette(): void {
  nativeColorInputRef.value?.click()
}

const presetColors = [
  { hex: '#3d6a8e', label: '雾蓝' },
  { hex: '#5c87a3', label: '浅雾蓝' },
  { hex: '#6f8f7f', label: '苔绿' },
  { hex: '#8a7f9e', label: '灰紫' },
  { hex: '#a9825c', label: '暖沙' },
  { hex: '#a9605a', label: '陶红' },
]

const fpsOptions: Array<{ id: RenderFpsChoice; label: string }> = [
  { id: '30', label: '30 fps' },
  { id: '60', label: '60 fps' },
  { id: '120', label: '120 fps' },
  { id: 'auto', label: '自适应' },
]

function update(patch: Partial<PublicSettings>): void {
  emit('update', patch)
}
</script>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-width: 420px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 9px;
  border: 1.5px solid var(--uta-separator);
  border-radius: 12px;
  background-color: var(--uta-canvas);
  color: var(--uta-ink);
  font: inherit;
  transition:
    border-color var(--uta-transition-normal),
    box-shadow var(--uta-transition-normal),
    background-color var(--uta-transition-normal),
    color var(--uta-transition-normal);
  text-align: left;
  cursor: pointer;
}

.theme-card.is-active {
  border-color: var(--uta-accent);
  box-shadow: 0 0 0 2px var(--uta-accent-soft);
}

.theme-sample {
  display: flex;
  gap: 4px;
  width: 100%;
  height: 58px;
  margin-bottom: 6px;
  padding: 5px;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--uta-separator);
  overflow: hidden;
}

.theme-light {
  background-color: #F4F1E9;
}

.theme-dark {
  background-color: #121A1E;
  border-color: #2D3D42;
}

.sample-nav {
  width: 26%;
  border-radius: 5px;
  background-color: rgba(0, 0, 0, 0.06);
}

.theme-dark .sample-nav {
  background-color: rgba(255, 255, 255, 0.08);
}

.sample-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}

.sample-body span {
  flex: 1;
  border-radius: 5px;
  background-color: #FFFCF6;
}

.theme-dark .sample-body span {
  background-color: #1B252A;
}

.sample-body span:last-child {
  flex: 1.4;
}

.theme-name {
  font-size: 13px;
  font-weight: 650;
}

.theme-desc {
  font-size: 11px;
  color: var(--uta-secondary);
}

.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 2px solid transparent;
  border-radius: 999px;
  color: #ffffff;
  cursor: pointer;
  transition: transform var(--uta-transition-fast);
}

.swatch:hover {
  transform: scale(1.08);
}

.swatch.is-active {
  border-color: var(--uta-ink);
}

.custom-color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.custom-color-label {
  font-size: 12px;
  color: var(--uta-secondary);
}

.custom-color-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 5px;
  border: 1px solid var(--uta-input-border);
  border-radius: 10px;
  background-color: var(--uta-input);
}

.custom-color-input-wrap.is-invalid {
  border-color: var(--uta-error);
}

.color-picker-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.native-color-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  pointer-events: auto;
}

.color-preview {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  transition: transform 0.14s ease;
}

.color-picker-trigger:hover .color-preview {
  transform: scale(1.08);
}

.color-palette-icon {
  width: 13px;
  height: 13px;
  fill: #ffffff;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
  opacity: 0.9;
}

.palette-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 10px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--uta-separator);
  background-color: var(--uta-canvas);
  color: var(--uta-ink);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--uta-transition-fast),
    border-color var(--uta-transition-fast),
    transform 0.14s ease;
}

.palette-btn:hover {
  background-color: var(--uta-surface);
  border-color: var(--uta-muted);
  transform: translateY(-1px);
}

.palette-btn:active {
  transform: scale(0.96);
}

.hex-input {
  width: 92px;
  border: none;
  background: transparent;
  color: var(--uta-ink);
  font-family: var(--uta-font-mono);
  font-size: 12px;
  outline: none;
}

@media (max-width: 620px) {
  .theme-grid {
    grid-template-columns: 1fr;
  }
}

.performance-apply {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background-color: var(--uta-accent-soft);
  color: var(--uta-ink);
  font-size: 12px;
  line-height: 1.5;
}

.settings-link-btn {
  margin-left: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 650;
  text-decoration: underline;
  cursor: pointer;
}
</style>
