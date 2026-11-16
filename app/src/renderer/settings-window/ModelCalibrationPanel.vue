<template>
  <section class="settings-panel calibration-panel" aria-label="模型通道校准">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">模型适配</span>
        <h3 class="panel-title">校准模型绑定的参数滑块是否正确</h3>
        <p class="panel-hint">检查并校准模型各部位与动作滑块的绑定关系与方向。此功能非常用项，仅在模型动作异常时使用。</p>
      </div>
      <button
        type="button"
        class="uta-button is-secondary calibration-inspect"
        :disabled="busy || !store.modelLoaded"
        @click="inspect"
      >{{ busy ? '正在检查…' : inspectLabel }}</button>
    </div>
    <p v-if="message" class="settings-note" role="status">{{ message }}</p>
    <template v-if="view && view.signature">
      <p v-if="view.calibration === null" class="settings-note">校准记录无法读取，原文件已保留；请先检查当前实例的数据。</p>
      <template v-else>
        <div class="calibration-fields">
          <label>部位
            <select v-model="channel" class="calibration-select" :disabled="busy" @change="selectChannel">
              <option v-for="option in channelOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <label>模型参数
            <select v-model="parameterId" class="calibration-select" :disabled="busy" @change="previewed = false">
              <option value="">选择安全参数</option>
              <option v-for="parameter in eligibleParameters" :key="parameter.id" :value="parameter.id">{{ parameter.label || parameter.id }} · {{ parameter.id }}</option>
            </select>
          </label>
          <label>方向
            <select v-model="direction" class="calibration-select" :disabled="busy" @change="previewed = false">
              <option value="normal">正向</option>
              <option value="reversed">反向</option>
            </select>
          </label>
        </div>
        <div class="calibration-strength bio-scrub">
          <div class="bio-scrub-fill" :style="{ left: '0%', width: strengthPercent + '%' }" />
          <div class="bio-scrub-grip" :style="{ left: strengthGripLeft }" />
          <span class="bio-scrub-label">表现强度</span>
          <span class="bio-scrub-val">{{ strengthPercent }}%</span>
          <input
            class="bio-range-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="strength"
            :disabled="busy"
            aria-label="表现强度"
            @input="onStrengthInput"
          />
        </div>
        <p v-if="!eligibleParameters.length" class="settings-note">没有可安全分配给这个部位的参数。物理输出和范围不明确的参数不会列出。</p>
        <p class="settings-note">预览只小幅移动所选参数并自动恢复；如果部位或方向不对，请重新选择。眼睛开合和说话口型暂不在这里校准。</p>
        <div class="calibration-actions">
          <button type="button" class="uta-button is-secondary" :disabled="busy || !parameterId || store.presetEditingLocked" @click="preview">预览方向</button>
          <button type="button" class="uta-button is-primary" :disabled="busy || !previewed || !parameterId" @click="save">确认并保存</button>
          <button v-if="savedForChannel && !confirmReset" type="button" class="uta-button is-ghost" :disabled="busy" @click="confirmReset = true">恢复这个部位的默认识别</button>
          <button v-if="confirmReset" type="button" class="uta-button is-ghost" :disabled="busy" @click="reset">确认恢复默认</button>
          <button v-if="confirmReset" type="button" class="uta-button is-ghost" :disabled="busy" @click="confirmReset = false">取消</button>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useDeskpetStore } from '../stores/deskpet'
import type { ModelPerformanceView } from '../../shared/model-performance-contracts'
import type { CalibrationChannel, ModelCalibration } from '../../shared/model-calibration-contracts'

const store = useDeskpetStore()
const channelOptions: Array<{ id: CalibrationChannel; label: string }> = [
  { id: 'headX', label: '头部左右' }, { id: 'headY', label: '头部上下' }, { id: 'headZ', label: '头部倾斜' },
  { id: 'gazeX', label: '视线左右' }, { id: 'gazeY', label: '视线上下' },
  { id: 'browLeft', label: '左眉' }, { id: 'browRight', label: '右眉' },
  { id: 'bodyX', label: '身体左右' }, { id: 'bodyZ', label: '身体倾斜' }, { id: 'mouthForm', label: '嘴形' },
]
const view = ref<ModelPerformanceView | null>(null)
const channel = ref<CalibrationChannel>('headX'), parameterId = ref('')
const direction = ref<'normal' | 'reversed'>('normal'), strength = ref(1)
const message = ref(''), busy = ref(false), previewed = ref(false), confirmReset = ref(false)
let generation = 0, viewedUrl = ''
const savedForChannel = computed(() => view.value?.calibration?.find(item => item.channel === channel.value))
const inspectLabel = computed(() => view.value?.signature ? '重新检查' : '检查当前模型')
const strengthPercent = computed(() => Math.round(strength.value * 100))
const strengthGripLeft = computed(() => `clamp(8px, ${strengthPercent.value}%, calc(100% - 8px))`)
const eligibleParameters = computed(() => (view.value?.parameters ?? []).filter(parameter =>
  !parameter.physicsOutput && parameter.min < parameter.defaultValue && parameter.defaultValue < parameter.max &&
  !view.value?.mappings.some(mapping => mapping.channel !== channel.value && mapping.confirmed && mapping.parameterId === parameter.id) &&
  !view.value?.calibration?.some(item => item.channel !== channel.value && item.parameterId === parameter.id),
))

function selectChannel() {
  const item = savedForChannel.value
  parameterId.value = item?.parameterId ?? ''
  direction.value = item?.direction ?? 'normal'
  strength.value = item?.strength ?? 1
  previewed.value = false; confirmReset.value = false
}

function onStrengthInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  strength.value = Math.min(1, Math.max(0, value))
  previewed.value = false
}

async function inspect() {
  if (busy.value || !store.modelLoaded || !store.modelUrl) return
  const epoch = ++generation, url = store.modelUrl
  busy.value = true; message.value = ''; previewed.value = false
  try {
    const result = await store.requestModelAction({ type: 'inspect-performance' })
    if (epoch !== generation || url !== store.modelUrl) return
    const resultView = result.data as ModelPerformanceView | undefined
    if (!result.ok || !resultView?.signature) { view.value = null; message.value = '当前模型没有可用的参数信息，请确认模型已加载。'; return }
    view.value = resultView; viewedUrl = url; selectChannel()
  } catch { if (epoch === generation) message.value = '读取模型参数失败，请重试。' }
  finally { if (epoch === generation) busy.value = false }
}

async function preview() {
  if (!view.value?.signature || !parameterId.value || store.modelUrl !== viewedUrl || busy.value) return
  const epoch = generation
  const candidate = { channel: channel.value, parameterId: parameterId.value, direction: direction.value }
  if (!eligibleParameters.value.some(p => p.id === candidate.parameterId)) return
  busy.value = true; message.value = ''; previewed.value = false
  try {
    const result = await store.requestModelAction({ type: 'preview-calibration', signature: view.value.signature, ...candidate })
    if (epoch !== generation || store.modelUrl !== viewedUrl) return
    if (result.ok) { previewed.value = true; message.value = '预览已开始。请观察所选部位和方向，确认后保存。' }
    else message.value = '预览未开始，请检查模型、参数或工坊是否正在使用。'
  } catch { if (epoch === generation) message.value = '预览失败，请重试。' }
  finally { if (epoch === generation) busy.value = false }
}

async function write(entries: ModelCalibration[]) {
  if (!view.value?.signature || view.value.calibration === null || store.modelUrl !== viewedUrl) return
  const epoch = generation, previous = view.value.calibration
  busy.value = true; message.value = ''
  try {
    const result = await window.utaAPI?.saveModelCalibration?.({
      modelUrl: viewedUrl, signature: view.value.signature,
      entries: entries.map(item => ({ ...item })), expected: previous.map(item => ({ ...item })),
    })
    if (epoch !== generation || store.modelUrl !== viewedUrl) return
    if (!result?.ok) { message.value = '校准未保存。模型或记录可能已变化，请重新检查；原记录已保留。'; return }
    view.value = { ...view.value, calibration: entries }
    previewed.value = false; confirmReset.value = false
    message.value = '校准已保存。请在上方点击“重新加载桌宠窗口”使其生效。'
  } catch { if (epoch === generation) message.value = '校准未保存，请检查数据后重试。' }
  finally { if (epoch === generation) busy.value = false }
}
function save() {
  if (!view.value?.calibration || !previewed.value || !eligibleParameters.value.some(p => p.id === parameterId.value)) return
  const next = view.value.calibration.filter(item => item.channel !== channel.value)
  next.push({ channel: channel.value, parameterId: parameterId.value, direction: direction.value, strength: strength.value })
  void write(next)
}
function reset() {
  if (!view.value?.calibration || !confirmReset.value) return
  void write(view.value.calibration.filter(item => item.channel !== channel.value))
}
watch(() => [store.modelUrl, store.modelLoaded] as const, () => {
  generation++; busy.value = false; view.value = null; viewedUrl = ''; previewed.value = false; message.value = ''
}, { immediate: true })
onUnmounted(() => { generation++ })
</script>

<style scoped>
.calibration-panel { padding: 18px 20px; }
.calibration-inspect { flex-shrink: 0; }
.calibration-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.calibration-fields label { display: grid; gap: 5px; font-size: 12px; color: var(--uta-secondary); }
.calibration-select {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  box-sizing: border-box;
  border: 1px solid var(--uta-input-border);
  border-radius: 9px;
  padding: 0 12px;
  background: var(--uta-input);
  color: var(--uta-ink);
  font: inherit;
  font-size: 13px;
}
.calibration-select:focus-visible { outline: 2px solid var(--uta-focus); outline-offset: 2px; }
.calibration-strength { margin-top: 12px; }
.calibration-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
@media (max-width: 900px) { .calibration-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .calibration-fields { grid-template-columns: 1fr; }
  .calibration-inspect { width: 100%; }
}
</style>
