import { computed, ref, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import {
  RESOLUTION,
  focusLive2DModel,
  resetLive2DModelFocus,
  getModelMetrics,
  isCssPointOverModelInk,
  resizeModel,
  resizeModelFit,
  setModelLipSync,
  type DeskpetModel,
} from '@/services/live2d/loader'
import type { ModelKind } from '@/services/live2d/model-discovery'
import { applyRenderFpsMode, setRenderActivity } from '@/services/render-fps'
import { DEFAULT_LIP_SYNC, getAnimationTarget } from '@/services/live2d/emotion-adapter'
import { smoothMouth, TextSpeechClock } from '@/services/mouth-motion'
import { MotionLayer } from './useMotionPriority'

/** 模型动画会让轮廓命中在边缘抖动。进入可以快，退出必须足够慢。 */
export const MODEL_HOVER_ENTER_MS = 100
export const MODEL_HOVER_EXIT_MS = 450
/** 光标离桌宠窗口多远之内才提升帧率；远处移动不打断自适应降帧。 */
export const CURSOR_BOOST_MARGIN = 64

export function isCursorNearWindow(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = CURSOR_BOOST_MARGIN,
): boolean {
  return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

export interface ModelHoverSettleState {
  hovered: boolean
  pending: boolean | null
  pendingAt: number
}

/**
 * hover 状态的去抖判定（纯函数）：
 * - 目标与当前一致：立即清掉待定状态；
 * - immediate（立绘/未知模式兜底）：直接落地；
 * - 首次看到新目标：只记录待定，不改变当前状态；
 * - 同一目标持续到各自阈值（进入 100ms / 退出 450ms）才落地。
 */
export function resolveModelHoverSettle(
  state: ModelHoverSettleState,
  next: boolean,
  now: number,
  immediate = false,
): ModelHoverSettleState {
  if (next === state.hovered) {
    return { hovered: state.hovered, pending: null, pendingAt: state.pendingAt }
  }
  if (immediate) {
    return { hovered: next, pending: null, pendingAt: state.pendingAt }
  }
  if (state.pending !== next) {
    return { hovered: state.hovered, pending: next, pendingAt: now }
  }
  const settleMs = next ? MODEL_HOVER_ENTER_MS : MODEL_HOVER_EXIT_MS
  if (now - state.pendingAt >= settleMs) {
    return { hovered: next, pending: null, pendingAt: state.pendingAt }
  }
  return state
}

export interface ModelFadePreference {
  hoverFadeEnabled: boolean
  overlayOpen: boolean
  uiHovered: boolean
  dragging: boolean
  modelHovered: boolean
}

/** 悬停淡出的偏好判定（纯函数）：任何浮层 / UI 悬停 / 拖拽都要让路。 */
export function shouldFadeModelNow(input: ModelFadePreference): boolean {
  if (!input.hoverFadeEnabled) return false
  if (input.overlayOpen) return false
  if (input.uiHovered || input.dragging) return false
  return input.modelHovered
}

/** 包围盒命中（纯函数，边界包含在内），与拆分前的比较顺序一致。 */
export function isPointInModelBox(
  x: number,
  y: number,
  box: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
}

export interface StageRenderLoopDeps {
  /** 当前渲染路径：Live2D 还是静态立绘包 */
  getModelKind: () => ModelKind
  /** 舞台整体横向偏移：命中、缩放与视线坐标都要扣除 */
  getStageShiftX: () => number
  /** 静态立绘舞台的轮廓命中（立绘包未暴露时按未命中处理） */
  getStaticStage: () => { isCursorOverFigure?: (x: number, y: number) => boolean } | null
  /** 设置 / 消息 / 快速输入浮层是否打开 */
  isOverlayOpen: () => boolean
  /** 鼠标是否停在侧边工具条等舞台 UI 上 */
  isUiHovered: () => boolean
  /** 鼠标离开舞台或窗口失焦时同步清掉 UI 悬停标记 */
  resetUiHover: () => void
  /** 模型拖拽中 */
  isDragging: () => boolean
  /** 读取并清空拖拽增量（useModelDrag） */
  consumeDragOffsets: () => { x: number; y: number } | null
  /** 动作层级播放入口 */
  playMotionWithPriority: (
    group: string,
    layer: MotionLayer,
    index?: number,
    options?: { loop?: boolean },
  ) => boolean
  /** 有待机动作播放后重置待机计时 */
  notifyIdleInteraction: () => void
  /** TTS 是否正在出声 */
  isTtsSpeaking: () => boolean
  /** TTS 实时振幅 */
  getTtsLevel: () => number
}

/**
 * 舞台渲染 / 视线 / 口型循环的唯一实现，迁移自 DeskpetStage.vue。
 *
 * 负责：
 * - requestAnimationFrame 轮询：窗口 resize、缩放、拖拽增量钳制；
 * - 视线跟随（鼠标进入窗口即回高帧）与关闭后的归中；
 * - 口型：TTS 真实振幅优先，流式文本走 TextSpeechClock，共用 smoothMouth 起收口；
 * - 渲染活动标记（renderBoost / renderActive）与自适应降帧；
 * - 模型 hover 命中、进入/退出去抖与悬停淡出偏好；
 * - 窗口内 mousemove 坐标采样（全屏坐标由组件订阅 onGlobalCursorPosition 注入）。
 *
 * 仍留在舞台的部分：模板与 UI 状态、宿主窗口订阅、滚轮缩放的 canvas 绑定、
 * 模型加载与提交；它们分别属于组件接线或 useStageModelLifecycle。
 *
 * 构造时不产生副作用；`activate()` 才注册 mousemove 与 renderActive watch，
 * 以保持拆分前的初始化顺序（待机调度创建之后）。
 */
export interface RenderActivityInput {
  dragging: boolean
  overlayOpen: boolean
  streamingReply: boolean
  ttsSpeaking: boolean
  pendingAnimation: boolean
  pendingApprovals: number
  boost: boolean
}

/**
 * 是否需要保持用户选择的高帧率。
 * TTS 播放可能远长于 3.5 秒的活动窗口，必须单独计入，否则播报中途会掉到待机帧率。
 */
export function computeRenderActive(input: RenderActivityInput): boolean {
  return (
    input.dragging ||
    input.overlayOpen ||
    input.streamingReply ||
    input.ttsSpeaking ||
    input.pendingAnimation ||
    input.pendingApprovals > 0 ||
    input.boost
  )
}

export function useStageRenderLoop(deps: StageRenderLoopDeps) {
  const store = useDeskpetStore()
  const chatStore = useChatStore()

  const isHovered = ref(false)
  const isModelHovered = ref(false)
  let pendingModelHover: boolean | null = null
  let pendingModelHoverAt = 0
  let hoverSettleTimer: ReturnType<typeof setTimeout> | null = null

  const shouldFadeModel = computed(() =>
    shouldFadeModelNow({
      hoverFadeEnabled: store.hoverFadeEnabled,
      overlayOpen: deps.isOverlayOpen(),
      uiHovered: deps.isUiHovered(),
      dragging: deps.isDragging(),
      modelHovered: isModelHovered.value,
    }),
  )

  let lastW = window.innerWidth
  let lastH = window.innerHeight
  let lastZoom = store.modelZoom
  let mouseX = window.innerWidth / 2
  let mouseY = window.innerHeight / 2

  function getMousePosition(): { x: number; y: number } {
    return { x: mouseX, y: mouseY }
  }

  /** 滚轮缩放 / 重置视图后同步轮询基线，避免下一帧重复 resize */
  function setZoomBaseline(zoom: number): void {
    lastZoom = zoom
  }

  let renderBoostTimer: ReturnType<typeof setTimeout> | null = null
  const renderBoost = ref(false)

  /** 短暂把渲染拉回高帧：宿主指令、待机动作等一次性活动使用 */
  function noteRenderActivity(holdMs = 3500): void {
    renderBoost.value = true
    if (renderBoostTimer) clearTimeout(renderBoostTimer)
    renderBoostTimer = setTimeout(() => {
      renderBoostTimer = null
      renderBoost.value = false
    }, holdMs)
  }

  /** 有交互、语音、动作或浮层时用用户选择的上限；纯待机由 render-fps 延迟降帧 */
  const renderActive = computed(() =>
    computeRenderActive({
      dragging: deps.isDragging(),
      overlayOpen: deps.isOverlayOpen(),
      streamingReply: store.isSpeaking,
      ttsSpeaking: deps.isTtsSpeaking(),
      pendingAnimation: !!store.pendingAnimation || store.presetPreviewActive,
      pendingApprovals: store.pendingApprovals.length,
      boost: renderBoost.value,
    }),
  )

  function setModelHovered(next: boolean, immediate = false): void {
    if (hoverSettleTimer) { clearTimeout(hoverSettleTimer); hoverSettleTimer = null }
    const settled = resolveModelHoverSettle(
      {
        hovered: isModelHovered.value,
        pending: pendingModelHover,
        pendingAt: pendingModelHoverAt,
      },
      next,
      performance.now(),
      immediate,
    )
    isModelHovered.value = settled.hovered
    pendingModelHover = settled.pending
    pendingModelHoverAt = settled.pendingAt
    if (pendingModelHover !== null) {
      const delay = pendingModelHover ? MODEL_HOVER_ENTER_MS : MODEL_HOVER_EXIT_MS
      hoverSettleTimer = setTimeout(() => {
        hoverSettleTimer = null
        // 鼠标停住也必须完成确认；重新命中，避免模型移动后沿用过期轮廓。
        updateModelHover(mouseX, mouseY)
      }, Math.max(1, pendingModelHoverAt + delay - performance.now()))
    }
  }

  function clearModelHover(): void {
    if (hoverSettleTimer) { clearTimeout(hoverSettleTimer); hoverSettleTimer = null }
    isHovered.value = false
    pendingModelHover = null
    isModelHovered.value = false
    deps.resetUiHover()
  }

  function isCursorOverLive2dModel(canvasCssX: number, canvasCssY: number): boolean {
    const m = store.live2dModel
    if (!m || !store.modelLoaded) return false
    const overInk = isCssPointOverModelInk(m, canvasCssX, canvasCssY)
    if (overInk !== null) return overInk

    let minX = NaN
    let maxX = NaN
    let minY = NaN
    let maxY = NaN
    try {
      const bounds = m.getBounds()
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        minX = bounds.x / RESOLUTION
        maxX = (bounds.x + bounds.width) / RESOLUTION
        minY = bounds.y / RESOLUTION
        maxY = (bounds.y + bounds.height) / RESOLUTION
      }
    } catch {
      // 降级由 metrics 计算
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      const metrics = getModelMetrics(m)
      const halfW = (metrics.refW * m.scale.x) / 2
      const halfH = (metrics.refH * m.scale.y) / 2
      minX = m.position.x - halfW
      maxX = m.position.x + halfW
      minY = m.position.y - halfH
      maxY = m.position.y + halfH
    }

    return isPointInModelBox(canvasCssX, canvasCssY, { minX, maxX, minY, maxY })
  }

  function updateModelHover(clientX: number, clientY: number): void {
    if (
      clientX < 0 ||
      clientX > window.innerWidth ||
      clientY < 0 ||
      clientY > window.innerHeight
    ) {
      clearModelHover()
      return
    }

    isHovered.value = true

    if (deps.getModelKind() === 'live2d') {
      const localX = clientX - deps.getStageShiftX()
      const localY = clientY
      setModelHovered(isCursorOverLive2dModel(localX, localY))
    } else if (deps.getModelKind() === 'image-set') {
      const staticStage = deps.getStaticStage()
      setModelHovered(staticStage?.isCursorOverFigure?.(clientX, clientY) ?? false)
    } else {
      setModelHovered(false, true)
    }
  }

  /** 全屏光标订阅入口：只有靠近桌宠时才把渲染拉回上限，远处移动不打断降帧 */
  function handleGlobalCursor(x: number, y: number): void {
    mouseX = x
    mouseY = y
    if (isCursorNearWindow(x, y, window.innerWidth, window.innerHeight)) noteRenderActivity(2000)
    if (
      x < 0 ||
      x > window.innerWidth ||
      y < 0 ||
      y > window.innerHeight
    ) {
      clearModelHover()
    } else {
      updateModelHover(x, y)
    }
  }

  /** 窗口内坐标也触发轮廓命中，视线仍由 rAF 统一消费。 */
  function onMouseMove(event: MouseEvent): void {
    mouseX = event.clientX
    mouseY = event.clientY
    updateModelHover(mouseX, mouseY)
  }

  let animFrameId = 0
  let animationPollRunning = false
  let activated = false
  let disposed = false

  function stopAnimationPoll(): void {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = 0
    }
    animationPollRunning = false
  }

  function startAnimationPoll(): void {
    if (animationPollRunning) return
    animationPollRunning = true
    let lastFocusModel: DeskpetModel | null = null
    let lastFocusX = NaN
    let lastFocusY = NaN
    let lastModelPosX = NaN
    let lastModelPosY = NaN
    let lastModelScale = NaN
    let lastMouthVal = 0
    let lastMouthTickAt = performance.now()
    let mouthWasActive = false
    let mouthBindingModel: DeskpetModel | null = null
    let mouthBindingParam: string | null = null
    let streamingMouthActive = false
    const streamingMouthClock = new TextSpeechClock()
    let lastGazeEnabled = store.gazeFollowEnabled

    const latestAssistantText = (): string => {
      for (let i = chatStore.messages.length - 1; i >= 0; i -= 1) {
        const message = chatStore.messages[i]
        if (message.role === 'assistant' && message.type === 'text') return message.text
      }
      return ''
    }

    const tick = () => {
      // 播放/文本时钟属于当前说话输入，不属于某一个模型；即使换模间有空窗也继续推进。
      const mouthNow = performance.now()
      const mouthDt = Math.min(80, Math.max(0, mouthNow - lastMouthTickAt))
      lastMouthTickAt = mouthNow
      const streamingActive = store.isSpeaking
      if (streamingActive && !streamingMouthActive) streamingMouthClock.start(mouthNow)
      if (!streamingActive && streamingMouthActive) streamingMouthClock.reset()
      streamingMouthActive = streamingActive
      const streamingLevel = streamingActive
        ? streamingMouthClock.level(latestAssistantText(), mouthNow)
        : 0
      const ttsActive = deps.isTtsSpeaking()
      const targetMouth = ttsActive ? deps.getTtsLevel() : streamingLevel
      const mouthActive = ttsActive || streamingActive
      const normalizedMouthLevel = Number.isFinite(targetMouth)
        ? Math.min(1, Math.max(0, targetMouth))
        : 0

      if (store.modelLoaded && store.pendingAnimation) {
        const pending = store.consumePendingAnimation()!
        const target = store.live2dModel
          ? getAnimationTarget(store.emotionAdapter, pending.name, store.modelCapabilities)
          : null
        if (target?.motion) {
          deps.playMotionWithPriority(
            target.motion.group,
            MotionLayer.Reply,
            target.motion.index ?? 0,
            { loop: pending.loop },
          )
          deps.notifyIdleInteraction()
        } else {
          console.debug(`[Deskpet] Animation unsupported or unmapped: ${pending.name}`)
        }
      }
      if (store.live2dModel) {
        const m = store.live2dModel
        const cw = window.innerWidth
        const ch = window.innerHeight
        if (Math.abs(cw - lastW) > 2 || Math.abs(ch - lastH) > 2) {
          store.pixiApp!.renderer.resize(cw * RESOLUTION, ch * RESOLUTION)
          store.pixiApp!.stage.scale.set(RESOLUTION)
          lastW = cw
          lastH = ch
          resizeModelFit(m, cw, ch, store.modelZoom)
          m.position.x += store.modelOffsetX
          m.position.y += store.modelOffsetY
        }
        if (store.modelZoom !== lastZoom) {
          lastZoom = store.modelZoom
          resizeModel(m, cw, ch, store.modelZoom)
        }
        const dragOffsets = deps.consumeDragOffsets()
        if (dragOffsets) {
          m.position.x += dragOffsets.x
          m.position.y += dragOffsets.y
          const { refW, refH } = getModelMetrics(m)
          const vw = refW * m.scale.x
          const vh = refH * m.scale.y
          m.position.x = Math.max(-vw * 0.8, Math.min(cw + vw * 0.8, m.position.x))
          m.position.y = Math.max(-vh * 0.8, Math.min(ch + vh * 0.8, m.position.y))
          store.setModelOffset(m.position.x - cw / 2, m.position.y - ch / 2)
        }
        if (store.gazeFollowEnabled) {
          const targetCanvasX = (mouseX - deps.getStageShiftX()) * RESOLUTION
          const targetCanvasY = mouseY * RESOLUTION
          if (
            m !== lastFocusModel ||
            targetCanvasX !== lastFocusX ||
            targetCanvasY !== lastFocusY ||
            m.position.x !== lastModelPosX ||
            m.position.y !== lastModelPosY ||
            m.scale.x !== lastModelScale
          ) {
            lastFocusModel = m
            lastFocusX = targetCanvasX
            lastFocusY = targetCanvasY
            lastModelPosX = m.position.x
            lastModelPosY = m.position.y
            lastModelScale = m.scale.x
            try {
              focusLive2DModel(m, targetCanvasX, targetCanvasY, false)
            } catch {
              /* focus not supported */
            }
          }
        } else if (lastFocusModel !== m || lastGazeEnabled) {
          // 关闭视线跟随后统一回到正前方；已居中的模型不重复写入
          const centerX = (cw * RESOLUTION) / 2
          const centerY = (ch * RESOLUTION) / 2
          lastFocusModel = m
          lastFocusX = centerX
          lastFocusY = centerY
          lastModelPosX = m.position.x
          lastModelPosY = m.position.y
          lastModelScale = m.scale.x
          try {
            resetLive2DModelFocus(m, true)
          } catch {
            /* focus not supported */
          }
        }
        lastGazeEnabled = store.gazeFollowEnabled

        // TTS 有音频时按真实振幅，流式文本按字符时钟；两者都经过同一套起收口平滑。
        const lipSync = store.emotionAdapter?.lipSync
        const mouthParam = lipSync?.mouthOpenParam ?? DEFAULT_LIP_SYNC.mouthOpenParam
        const mouthGain = lipSync?.gain ?? DEFAULT_LIP_SYNC.gain

        // 平滑值是绑定内的归一化输入值，不是模型 raw 参数值。绑定变更时只保留
        // 当前输入进度：活动说话从当前采样接管，静音时从 0 开始，不继承旧收口尾值。
        // gain 每帧仅缩放归一化结果，因此 gain 变化可沿用输入平滑，但不会沿用旧模型 raw 值。
        const mouthBindingChanged = mouthBindingModel !== m || mouthBindingParam !== mouthParam
        if (mouthBindingChanged) {
          if (mouthBindingModel && mouthBindingParam) {
            const oldModelDestroyed = (mouthBindingModel as any).destroyed === true
            if (!oldModelDestroyed) {
              setModelLipSync(mouthBindingModel, mouthBindingParam, 0, false)
            }
          }
          mouthBindingModel = m
          mouthBindingParam = mouthParam
          lastMouthVal = mouthActive ? normalizedMouthLevel : 0
          mouthWasActive = false
        } else {
          lastMouthVal = smoothMouth(lastMouthVal, targetMouth, mouthDt)
        }

        if (mouthActive || lastMouthVal > 0.001) {
          setModelLipSync(m, mouthParam, lastMouthVal * mouthGain, mouthActive)
          mouthWasActive = true
        } else if (mouthWasActive) {
          setModelLipSync(m, mouthParam, 0, false)
          mouthWasActive = false
        }
      } else if (mouthBindingModel) {
        // 模型空窗可能是拆除后才被 RAF 观察到；只对仍存活的模型走既有释放入口。
        if (!((mouthBindingModel as any).destroyed === true) && mouthBindingParam) {
          setModelLipSync(mouthBindingModel, mouthBindingParam, 0, false)
        }
        mouthBindingModel = null
        mouthBindingParam = null
        lastMouthVal = 0
        mouthWasActive = false
      }
      animFrameId = requestAnimationFrame(tick)
    }
    animFrameId = requestAnimationFrame(tick)
  }

  /**
   * 延迟注册初始化顺序敏感的副作用：
   * 待机调度已创建后，才开启 renderActive watch（immediate）与窗口 mousemove 监听，
   * 与拆分前在脚本同一位置注册保持一致。
   */
  function activate(): void {
    if (activated || disposed) return
    activated = true
    watch(renderActive, (active) => setRenderActivity(active), { immediate: true })
    window.addEventListener('mousemove', onMouseMove)
  }

  /** 组件卸载：停轮询、清渲染提升计时器并移除 mousemove */
  function dispose(): void {
    if (disposed) return
    disposed = true
    clearModelHover()
    stopAnimationPoll()
    if (renderBoostTimer) {
      clearTimeout(renderBoostTimer)
      renderBoostTimer = null
    }
    if (activated) {
      window.removeEventListener('mousemove', onMouseMove)
      activated = false
    }
  }

  /** onMounted 首行：应用用户选择的刷新率档位（与拆分前一样不等待） */
  function applyFpsMode(): void {
    void applyRenderFpsMode()
  }

  return {
    isHovered,
    isModelHovered,
    shouldFadeModel,
    renderActive,
    getMousePosition,
    setZoomBaseline,
    noteRenderActivity,
    handleGlobalCursor,
    updateModelHover,
    clearModelHover,
    activate,
    dispose,
    startAnimationPoll,
    stopAnimationPoll,
    applyFpsMode,
  }
}
