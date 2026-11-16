<template>
  <div
    class="static-stage"
    :class="{ hovered, 'hover-fade-enabled': store.hoverFadeEnabled }"
    @mousedown.left.stop="onDragStart"
    @wheel.prevent.stop="onWheel"
  >
    <div class="static-transform" :style="transformStyle">
      <div ref="figureRef" class="static-figure" :class="{ thinking: store.isThinking }">
        <img v-if="slotA" class="static-img" :class="{ active: showA }" :src="slotA" draggable="false" alt="" />
        <img v-if="slotB" class="static-img" :class="{ active: !showA }" :src="slotB" draggable="false" alt="" />
      </div>
    </div>

    <div v-if="error" class="static-error" role="alert">
      <div class="error-icon">!</div>
      <p>{{ error }}</p>
      <p class="error-hint">立绘包缺少清单或图片路径失效。可以重新选择角色，或打开模型目录检查文件。</p>
      <details class="error-more">
        <summary>立绘包格式（开发者）</summary>
        <p>检查 deskpet-images.json 清单与图片路径，格式可参考 models/sample_static。</p>
      </details>
      <div class="static-error-actions">
        <button type="button" class="static-error-btn" @mousedown.stop @click.stop="emit('open-models')">打开模型目录</button>
        <button type="button" class="static-error-btn is-primary" @mousedown.stop @click.stop="emit('open-settings')">去设置里更换角色</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { loadImageSet, type ImageSetManifest } from '@/services/imageset/loader'
import { createProbeGuard } from '@/services/imageset/probe-guard'
import { canRunIdleActions } from '@/services/idle-gate'
import { cancelStaticModelLoad, settleStaticModelLoad } from '@/services/model-load-gate'

const props = withDefaults(defineProps<{ hovered: boolean; idleAllowed?: boolean }>(), {
  idleAllowed: true,
})
const emit = defineEmits<{
  'dragging-change': [dragging: boolean]
  'drag-end': []
  notice: [text: string]
  'open-models': []
  'open-settings': []
}>()

const store = useDeskpetStore()
const reducedMotionMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
const reducedMotion = ref(reducedMotionMedia?.matches ?? false)
const documentVisible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden')

const manifest = ref<ImageSetManifest | null>(null)
const error = ref('')
/** 挂载代数：快速连续切换立绘包时，慢的旧包不能覆盖新包（与 DeskpetStage 的 mountSeq 同款） */
let mountSeq = 0

// ── 双槽交叉淡入淡出：新图先进非激活槽，加载完成再切换，避免白闪 ──
const slotA = ref('')
const slotB = ref('')
const showA = ref(true)
let activeSlot: 'A' | 'B' = 'A'
/** 换图探针守卫：任何目标变化都作废在途探针，避免慢图顶掉新图（DP-013） */
const probeGuard = createProbeGuard()

/** 换表情时的 VN 风小跳：压扁蓄力 → 弹起 → 落回（squash & stretch） */
const figureRef = ref<HTMLElement>()
let lastDragMoved = false
let cancelDrag: (() => void) | null = null
function isCursorOverFigure(x: number, y: number): boolean {
  const rect = figureRef.value?.getBoundingClientRect()
  return !!rect && rect.width > 0 && rect.height > 0 &&
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
defineExpose({ isCursorOverFigure, isTapGesture: () => !lastDragMoved })

function playHop(): void {
  if (reducedMotionMedia?.matches) return
  // WAAPI 与 CSS 的呼吸/思考动画互补：播放期间短暂接管 transform，结束后交还
  figureRef.value?.animate(
    [
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(3px) scale(1.03, 0.95)', offset: 0.22 },
      { transform: 'translateY(-15px) scale(0.97, 1.04)', offset: 0.52 },
      { transform: 'translateY(0) scale(1, 1)', offset: 1 },
    ],
    { duration: 420, easing: 'cubic-bezier(0.28, 0.84, 0.42, 1)' },
  )
}

/** 当前应显示的图片：说话差分 > 待机随机情绪 > 情绪映射（含自定义键） > default */
const targetSrc = computed(() => {
  const m = manifest.value
  if (!m) return ''
  void store.emotionPulse // 相同情绪连发也要重放
  if (store.isSpeaking && m.talk) return m.talk
  if (idleSurprise.value && m.images[idleSurprise.value]) return m.images[idleSurprise.value]
  // 直接按键查找：内置情绪与模型自定义情绪一视同仁，未命中回落 default
  return m.images[store.currentEmotion] ?? m.images[m.default] ?? ''
})

function crossfadeTo(src: string): void {
  if (!src) return
  // 任何目标变化都先作废在途探针：否则 A → 慢 B → A 时，
  // B 的 onload 仍会通过校验并切到 B（DP-013）
  const myToken = probeGuard.next()
  const current = activeSlot === 'A' ? slotA.value : slotB.value
  if (current === src) return
  const next = activeSlot === 'A' ? 'B' : 'A'
  const probe = new Image()
  probe.onload = () => {
    // 目标又变了，这张慢图已经过时，丢弃避免顶掉新图
    if (!probeGuard.isCurrent(myToken)) return
    if (next === 'B') {
      slotB.value = src
      showA.value = false
    } else {
      slotA.value = src
      showA.value = true
    }
    activeSlot = next
    playHop()
  }
  probe.onerror = () => console.warn('[StaticStage] 图片加载失败:', src)
  probe.src = src
}

watch(targetSrc, (src) => crossfadeTo(src))

// ── 待机随机情绪：无交互一段时间后从 idleEmotions 池里随机挑一张展示几秒 ──
const IDLE_SHOW_MS = 3500
const idleSurprise = ref<string | null>(null)
let idleTimer: ReturnType<typeof setTimeout> | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleTimers(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
}

function canShowIdleSurprise(): boolean {
  return canRunIdleActions({
    idleActionsEnabled: store.idleActionsEnabled,
    reducedMotion: reducedMotion.value,
    documentVisible: documentVisible.value,
    agentWorkingState: store.agentWorkingState,
    speaking: store.isSpeaking,
    thinking: store.isThinking,
    approvals: store.pendingApprovals.length,
    editingLocked: store.presetEditingLocked,
    previewActive: store.presetPreviewActive,
    presetRunning: store.presetSequenceActive,
    uiBlocked: !props.idleAllowed,
  })
}

function scheduleIdle(): void {
  clearIdleTimers()
  idleSurprise.value = null
  const m = manifest.value
  if (!m || m.idleEmotions.length === 0 || !canShowIdleSurprise()) return
  const [minS, maxS] = m.idleInterval
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!canShowIdleSurprise()) return
    idleSurprise.value = m.idleEmotions[Math.floor(Math.random() * m.idleEmotions.length)]
    showTimer = setTimeout(() => {
      showTimer = null
      idleSurprise.value = null
      scheduleIdle()
    }, IDLE_SHOW_MS)
  }, (minS + Math.random() * (maxS - minS)) * 1000)
}

/** 任何"活"的迹象（真实情绪/思考/说话/用户拖拽缩放）都让随机情绪让位并重排 */
function pokeIdle(): void {
  idleSurprise.value = null
  scheduleIdle()
}

function onReducedMotionChange(): void {
  reducedMotion.value = reducedMotionMedia?.matches ?? false
  pokeIdle()
}

function onVisibilityChange(): void {
  documentVisible.value = document.visibilityState !== 'hidden'
  pokeIdle()
}

watch(
  () => [store.emotionPulse, store.isThinking, store.isSpeaking] as const,
  () => pokeIdle(),
)

watch(
  () => [
    store.idleActionsEnabled,
    store.agentWorkingState,
    store.isSpeaking,
    store.isThinking,
    store.pendingApprovals.length,
    store.presetEditingLocked,
    store.presetPreviewActive,
    props.idleAllowed,
  ] as const,
  () => pokeIdle(),
)

onMounted(() => {
  reducedMotionMedia?.addEventListener?.('change', onReducedMotionChange)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  reducedMotionMedia?.removeEventListener?.('change', onReducedMotionChange)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  cancelDrag?.()
})

// ── 情绪 6 秒自动回退到清单标定的默认表情；说话期间不撤掉表情 ──
let revertTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [store.currentEmotion, store.emotionPulse] as const,
  () => {
    if (revertTimer) { clearTimeout(revertTimer); revertTimer = null }
    const m = manifest.value
    if (!m || store.currentEmotion === m.default) return
    const revertWhenIdle = () => {
      revertTimer = null
      if (store.isSpeaking) {
        revertTimer = setTimeout(revertWhenIdle, 400)
        return
      }
      store.currentEmotion = m.default
    }
    revertTimer = setTimeout(revertWhenIdle, 6000)
  },
)

onUnmounted(() => {
  // 卸载后所有在途请求/探针一律作废，回调不得再写状态
  mountSeq++
  probeGuard.invalidate()
  cancelStaticModelLoad()
  clearIdleTimers()
  if (revertTimer) { clearTimeout(revertTimer); revertTimer = null }
})

async function mount(url: string): Promise<void> {
  const mySeq = ++mountSeq
  error.value = ''
  // 不在这里清空 manifest：加载失败时保留当前立绘，避免角色凭空消失
  try {
    const m = await loadImageSet(url)
    // 挂载期间又切了别的包，这份清单已过时，丢弃（避免旧包覆盖新包）
    if (mySeq !== mountSeq) return
    manifest.value = m
    if (m.missingImages.length > 0) {
      const names = m.missingImages.slice(0, 3).join('、')
      emit('notice', `立绘包缺少 ${m.missingImages.length} 张图（${names}${m.missingImages.length > 3 ? '…' : ''}），对应情绪会回落到默认。`)
    }
    // 清单里的情绪键（含自定义）登记到 store，由 DeskpetStage 上报给插件
    store.modelEmotions = Object.keys(m.images)
    // 情绪 6 秒自动回退的目标 = 清单标定的默认表情（normal）
    store.defaultEmotion = m.default
    // 与 Live2D 的 modelLoaded 语义对齐：加载成功才算就绪
    store.modelLoaded = true
    settleStaticModelLoad(url, true)
    scheduleIdle()
    // 首帧直接落到目标图，不走淡入
    const src = targetSrc.value
    slotA.value = src
    slotB.value = ''
    showA.value = true
    activeSlot = 'A'
    probeGuard.invalidate() // 丢弃任何在途的换图探针
    console.info(
      `[StaticStage] 立绘包已加载：${m.name || url}` +
        `（${Object.keys(m.images).length} 张，default=${m.default}）`,
    )
  } catch (err) {
    if (mySeq !== mountSeq) return
    console.error('[StaticStage] 立绘包加载失败:', err)
    error.value = `立绘包加载失败: ${err instanceof Error ? err.message : String(err)}`
    settleStaticModelLoad(url, false)
  }
}

watch(
  () => store.modelUrl,
  (url) => {
    if (url) void mount(url)
  },
  { immediate: true },
)

// ── 变换：与 Live2D 共用同一组 store 字段（布局持久化/重置自动生效）──
const transformStyle = computed(() => ({
  transform: `translate(${store.modelOffsetX}px, ${store.modelOffsetY}px) scale(${store.modelZoom})`,
}))

function clampZoom(z: number): number {
  return Math.max(0.15, Math.min(20, z))
}

let lastWheelAt = 0

/** 滚轮缩放（鼠标焦点）：screen = offset + zoom·p，保持鼠标下的点不动 */
function onWheel(e: WheelEvent) {
  const now = performance.now()
  if (now - lastWheelAt < 50) return
  lastWheelAt = now
  pokeIdle()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const fx = e.clientX - rect.left - rect.width / 2
  const fy = e.clientY - rect.top - rect.height / 2
  const factor = e.deltaY > 0 ? 0.92 : 1.08
  const newZoom = clampZoom(store.modelZoom * factor)
  const ratio = newZoom / store.modelZoom
  store.setModelOffset(fx - (fx - store.modelOffsetX) * ratio, fy - (fy - store.modelOffsetY) * ratio)
  store.modelZoom = newZoom
}

/** 左键拖拽平移，钳制在窗口尺寸的 1.2 倍内，防止拖丢 */
function onDragStart(e: MouseEvent) {
  cancelDrag?.()
  pokeIdle()
  lastDragMoved = false
  emit('dragging-change', true)
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const maxOff = Math.max(rect.width, rect.height) * 1.2
  let lastX = e.clientX
  let lastY = e.clientY
  let moved = false

  const onMove = (ev: MouseEvent) => {
    if (ev.buttons === 0) { onUp(); return }
    const dx = ev.clientX - lastX
    const dy = ev.clientY - lastY
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    moved = true
    lastDragMoved = true
    const nx = Math.max(-maxOff, Math.min(maxOff, store.modelOffsetX + dx))
    const ny = Math.max(-maxOff, Math.min(maxOff, store.modelOffsetY + dy))
    store.setModelOffset(nx, ny)
    lastX = ev.clientX
    lastY = ev.clientY
  }
  const onUp = (event?: Event) => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    window.removeEventListener('blur', onUp)
    cancelDrag = null
    emit('dragging-change', false)
    if (moved && event?.type === 'mouseup') emit('drag-end')
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  window.addEventListener('blur', onUp)
  cancelDrag = () => onUp()
}
</script>

<style scoped>
.static-stage {
  position: absolute;
  inset: 0;
  z-index: 5;
  transition: opacity 0.18s ease;
}

/* 与 DeskpetStage 的悬停淡化对齐（scoped 样式不跨组件，这里自带一份） */
.static-stage.hover-fade-enabled.hovered {
  opacity: 0.15;
}

.static-transform {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  will-change: transform;
}

.static-figure {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: breathe 4.5s ease-in-out infinite;
}

/* 待机呼吸：极其克制的缩放浮动 */
@keyframes breathe {
  0%, 100% { transform: scale(1) translateY(0); }
  50% { transform: scale(1.012) translateY(-3px); }
}

/* 思考中：轻微上下点头 */
.static-figure.thinking {
  animation: think-bob 0.9s ease-in-out infinite;
}
@keyframes think-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}

.static-img {
  position: absolute;
  max-width: 85%;
  max-height: 85%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.28s ease;
  user-select: none;
  -webkit-user-drag: none;
}
.static-img.active {
  opacity: 1;
}

.static-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  width: min(340px, calc(100vw - 32px));
  padding: 28px;
  text-align: center;
  color: var(--dp-text-primary);
  background: var(--dp-panel-bg, var(--dp-bg));
  border: 1px solid var(--dp-border);
  border-radius: 18px;
  -webkit-app-region: no-drag;
}
.static-error p { font-size: 14px; margin: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
.static-error .error-icon { font-size: 36px; font-weight: 700; margin-bottom: 10px; }
.static-error .error-hint { font-size: 12px; opacity: 0.7; }
.static-error .error-more { margin-top: 10px; text-align: left; font-size: 12px; color: var(--dp-text-sub); }
.static-error .error-more summary { cursor: pointer; }
.static-error .error-more p { font-size: 12px; color: var(--dp-text-sub); }
.static-error-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.static-error-btn {
  padding: 6px 12px;
  border: 1px solid var(--dp-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--dp-text-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.static-error-btn.is-primary {
  border-color: var(--dp-accent);
  background: var(--dp-accent);
  color: #fff;
}
.static-error-btn:focus-visible {
  outline: 2px solid var(--dp-accent);
  outline-offset: 2px;
}
</style>
