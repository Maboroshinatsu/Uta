import { computed, ref, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import {
  attachLive2DModel,
  clearExpression,
  createLive2DModel,
  createPixiApp,
  describeModel,
  discardLive2DModel,
  getMotionGroups,
  getPerformanceOwnedParameterIds,
  inspectModelStack,
  protectAutomaticBlink,
  resizeModel,
  setBaseParameters,
  setExpression,
  setFocusMapping,
  setHiddenDrawables,
  unloadLive2DModel,
  type DeskpetModel,
  type ModelDiskAssetsInfo,
} from '@/services/live2d/loader'
import { loadImageSet } from '@/services/imageset/loader'
import { resolveModelFocusMapping } from '@/services/live2d/focus-mapping'
import { prepareModelWatermarkDrawables } from '@/services/live2d/model-watermarks'
import {
  clearModelCache,
  consumeModelFallbackNotice,
  discoverModel,
  kindOfModelUrl,
  setStoredModelPath,
} from '@/services/live2d/model-discovery'
import {
  DESKPET_EMOTIONS,
  getAnimationTarget,
  getEmotionTarget,
  isDeskpetEmotionValue,
  loadEmotionAdapter,
  resolveModelControlsAndBase,
  resolveModelSliders,
  resolvePresetGroup,
  type ModelEmotionAdapter,
} from '@/services/live2d/emotion-adapter'
import { reportAdapterValidation, validateAdapter } from '@/services/live2d/adapter-validator'
import type { DeskpetControlAction } from '@/services/host/contracts'
import { MotionLayer } from './useMotionPriority'
import { pickIdleGroups } from './useIdleScheduler'
import {
  inspectModelCapabilityFacts,
  prepareModelPerformance,
  setPerformanceOwnershipProvider,
  stopModelPerformance,
} from '@/services/performance/model-runtime'
import { armStaticModelLoad, cancelStaticModelLoad } from '@/services/model-load-gate'
import { DAFISH_HAPPY_DURATION, DAFISH_HAPPY_MOTION, installDafishHappyMotion } from '@/services/live2d/dafish-happy-performance'
import { DAFISH_AUTHORED_HAPPY_DURATION, DAFISH_AUTHORED_HAPPY_MOTION, installDafishAuthoredHappyMotion } from '@/services/live2d/dafish-authored-happy'
import { DAFISH_CALIBRATED_HAPPY_DURATION, DAFISH_CALIBRATED_HAPPY_MOTION, installDafishCalibratedHappyMotion } from '@/services/live2d/dafish-calibrated-happy'
import { DAFISH_BODY_LED_HAPPY_DURATION, DAFISH_BODY_LED_HAPPY_MOTION, installDafishBodyLedHappyMotion } from '@/services/live2d/dafish-body-led-happy'
import { DAFISH_WELL_ACTUALLY_DURATION, DAFISH_WELL_ACTUALLY_MOTION, installDafishWellActuallyMotion } from '@/services/live2d/dafish-well-actually'
import { DAFISH_BODY_LED_CURIOUS_DURATION, DAFISH_BODY_LED_CURIOUS_MOTION, installDafishBodyLedCuriousMotion } from '@/services/live2d/dafish-body-led-curious'
import { DAFISH_BODY_LED_SURPRISED_DURATION, DAFISH_BODY_LED_SURPRISED_MOTION, installDafishBodyLedSurprisedMotion } from '@/services/live2d/dafish-body-led-surprised'
import { DAFISH_BODY_LED_SAD_DURATION, DAFISH_BODY_LED_SAD_MOTION, installDafishBodyLedSadMotion } from '@/services/live2d/dafish-body-led-sad'
import { DAFISH_BODY_LED_ANGRY_DURATION, DAFISH_BODY_LED_ANGRY_MOTION, installDafishBodyLedAngryMotion } from '@/services/live2d/dafish-body-led-angry'
import { DAFISH_BODY_LED_SHY_DURATION, DAFISH_BODY_LED_SHY_MOTION, installDafishBodyLedShyMotion } from '@/services/live2d/dafish-body-led-shy'
import { DAFISH_BODY_LED_THINKING_DURATION, DAFISH_BODY_LED_THINKING_MOTION, installDafishBodyLedThinkingMotion } from '@/services/live2d/dafish-body-led-thinking'
import { DAFISH_BODY_LED_NEUTRAL_DURATION, DAFISH_BODY_LED_NEUTRAL_MOTION, installDafishBodyLedNeutralMotion } from '@/services/live2d/dafish-body-led-neutral'
import { isDafishModel } from '@/services/live2d/natural-presets'

/** 上报给宿主的控件摘要（与拆分前 sendModelControls 的载荷一致） */
export interface StageModelControlSummary {
  id: string
  label: string
  category: string
  active: boolean
}

/** 上报给宿主的预设摘要（保留 group 字段，插件宿主会原样读取） */
export interface StageModelPresetSummary {
  id: string
  label: string
  description: string
  emotion: string
  group: string | undefined
  controls: string[]
  parameters?: Record<string, number>
  custom: boolean
}

/**
 * 上报给宿主的模型名解析（纯函数）：
 * 适配器显式名字 > 适配器 modelId（排除内部占位值 'empty'）
 * > .model3.json 文件名 > 立绘包目录名 > 'Uta'。
 */
export function resolveModelDisplayNameFrom(
  adapter: { name?: string; modelId?: string } | null | undefined,
  modelUrl: string,
): string {
  const adapterName = adapter?.name?.trim()
  if (adapterName) return adapterName
  const modelId = adapter?.modelId?.trim()
  if (modelId && modelId !== 'empty') return modelId

  const parts = (modelUrl || '').split('/').filter(Boolean)
  const file = parts[parts.length - 1] || ''
  if (/\.model3\.json$/i.test(file)) {
    const stem = file.replace(/\.model3\.json$/i, '').trim()
    if (stem) return stem
  }
  if (file === 'deskpet-images.json') {
    const folder = parts[parts.length - 2]?.trim()
    if (folder) return folder
  }
  return 'Uta'
}

export interface StageModelLifecycleDeps {
  /** 舞台容器：初次加载与按需创建 Pixi 应用时挂载 canvas */
  getStageContainer: () => HTMLElement | undefined
  /** 新建 canvas 后绑定滚轮缩放；返回解绑函数，缩放实现仍归舞台 */
  bindCanvasWheel: (canvas: HTMLCanvasElement) => (() => void) | null
  /** 预设/控件序列：切换模型前后必须取消在途序列并重置控件记忆 */
  cancelPresetSequence: () => number
  resetAppliedControls: () => void
  /** 控件层落地后同步宿主 */
  syncControlsToModelAndHost: (transitionMs?: number) => void
  /** 热切换后重置动作层级 */
  resetMotionPriority: () => void
  /** 动作层级播放（调试入口 deskpetTestMotion 使用） */
  playMotionWithPriority: (
    group: string,
    layer: MotionLayer,
    index?: number,
    options?: { loop?: boolean },
  ) => boolean
  /** Live2D 呼吸/眨眼动画 */
  startAnimation: (model: DeskpetModel) => void
  stopAnimation: () => void
  /** 渲染轮询：随模型提交启动、切到立绘时停止 */
  startAnimationPoll: () => void
  stopAnimationPoll: () => void
  /** 待机调度 */
  startIdleScheduler: () => void
  stopIdleScheduler: () => void
  /** 宿主上报：控件/预设与情绪列表（适配器仍归舞台所有） */
  sendModelControls: (
    controls: StageModelControlSummary[],
    presets?: StageModelPresetSummary[],
  ) => void
  sendModelEmotions: (emotions: string[]) => void
}

/**
 * 模型生命周期（加载 / 迁移 / 提交 / 热切换 / 调试与宿主上下文上报）的唯一实现，
 * 迁移自 DeskpetStage.vue。所有可能抛异常的准备工作先做完，再切换可见模型；
 * 提交失败会回滚 store 并释放新模型，避免出现「旧模型已销毁、新模型没上台」的空白。
 *
 * 仍留在舞台的部分：onMounted 的宿主订阅、模板与 UI、滚轮缩放的 canvas 绑定、
 * 渲染轮询与 hover / 视线 / 口型（见 useStageRenderLoop）。
 */
export function useStageModelLifecycle(deps: StageModelLifecycleDeps) {
  const store = useDeskpetStore()

  const modelError = ref('')
  const modelNotice = ref('')
  /** 当前模型走哪条渲染路径：Live2D 还是静态立绘包 */
  const modelKind = computed(() => (store.modelUrl ? kindOfModelUrl(store.modelUrl) : 'live2d'))

  /** 当前模型实际拥有的待机 motion 组，模型切换后重新计算 */
  let idleGroups: string[] = []
  /** 当前模型底层常驻隐藏部件（来自 adapter.hiddenParts） */
  let currentBaseHiddenParts: string[] = []
  let mountSeq = 0
  /** 新建 Pixi canvas 时绑定的滚轮解绑函数（缩放实现仍归舞台） */
  let unbindCanvasWheel: (() => void) | null = null
  /** 热切换时的短交叉淡化；旧模型在淡化结束后才释放 */
  let modelFade: {
    app: NonNullable<typeof store.pixiApp>
    previous: DeskpetModel
    next: DeskpetModel
    remove: () => void
  } | null = null

  function finishModelFade(releasePrevious = true): void {
    const fade = modelFade
    if (!fade) return
    modelFade = null
    try { fade.remove() } catch { /* ticker may already be stopped */ }
    try { fade.next.alpha = 1 } catch { /* model may be gone */ }
    if (releasePrevious) {
      try { unloadLive2DModel(fade.previous, fade.app) } catch { /* best effort */ }
    }
  }

  function crossfadePreviousModel(
    previous: DeskpetModel,
    next: DeskpetModel,
    app: NonNullable<typeof store.pixiApp>,
  ): void {
    finishModelFade(true)
    const reduced = typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      unloadLive2DModel(previous, app)
      return
    }
    // Accumulate rendered time, not wall-clock time: loading a large model can
    // block the renderer long enough that a wall-clock fade would be skipped.
    const duration = 160
    let elapsed = 0
    next.alpha = 0
    const step = (): void => {
      elapsed += app.ticker.deltaMS || 1000 / 60
      const raw = Math.min(1, elapsed / duration)
      const eased = raw * raw * (3 - 2 * raw)
      previous.alpha = 1 - eased
      next.alpha = eased
      if (raw >= 1) {
        modelFade = null
        try { app.ticker.remove(step) } catch { /* app disposed */ }
        next.alpha = 1
        unloadLive2DModel(previous, app)
      }
    }
    modelFade = {
      app,
      previous,
      next,
      remove: () => app.ticker.remove(step),
    }
    app.ticker.add(step)
    app.ticker.start()
  }

  function getBaseHiddenParts(): string[] {
    return currentBaseHiddenParts
  }

  function getIdleGroups(): string[] {
    return idleGroups
  }

  /** 作废所有在途加载：切换、卸载、模式互切都必须先调用 */
  function invalidatePendingLoads(): number {
    finishModelFade(true)
    stopModelPerformance(store.live2dModel)
    deps.cancelPresetSequence()
    return ++mountSeq
  }

  /** 只卸载当前 Live2D 模型，不动 store 里的其它字段 */
  function disposeCurrentLive2DModel(): void {
    deps.cancelPresetSequence()
    const previous = store.live2dModel
    if (previous && store.pixiApp) unloadLive2DModel(previous, store.pixiApp)
    store.live2dModel = null
  }

  /** 上报给宿主的模型名：适配器没写名字时，不能把内部占位值 'empty' 发出去 */
  function resolveModelDisplayName(): string {
    return resolveModelDisplayNameFrom(store.emotionAdapter, store.modelUrl)
  }

  const contextInstance = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let contextSequence = 0
  let lastContextKey = ''
  let currentModelRevision = ''
  function syncModelContextToMain(): void {
    const kind = kindOfModelUrl(store.modelUrl)
    const groupMap = new Map<string, { group: string; emotion: string; presets: string[] }>()
    for (const preset of store.statePresets) {
      const groupName = resolvePresetGroup(preset)
      let bucket = groupMap.get(groupName)
      if (!bucket) {
        bucket = {
          group: groupName,
          emotion: preset.emotion || 'neutral',
          presets: [],
        }
        groupMap.set(groupName, bucket)
      }
      bucket.presets.push(preset.label)
    }
    const context = {
        modelName: resolveModelDisplayName(),
        ready: store.modelLoaded,
        kind,
        emotions: kind === 'image-set' ? [...store.modelEmotions] : [...new Set([...DESKPET_EMOTIONS, ...store.modelEmotions])],
        presetGroups: kind === 'image-set' ? [] : Array.from(groupMap.values()),
        // 只报模型里真实存在的动作组：适配器映射表可能写着模型没有的组名，
        // 混进清单后宿主会调用一个不存在的动作并收到 accepted，桌宠却毫无反应。
        animations: kind === 'image-set' ? [] : Object.keys(store.modelCapabilities?.motionGroups ?? {}),
      }
    const key = JSON.stringify([store.modelUrl, context, store.statePresets])
    if (key !== lastContextKey) { lastContextKey = key; currentModelRevision = `model-${contextInstance}-${++contextSequence}` }
    void window.utaAPI
      ?.syncModelContext?.({ ...context, revision: currentModelRevision, settingsModelUrl: store.modelUrl })
      .catch(() => {})
  }

  function reportControlsAndPresetsToHost(): void {
    const caps = store.modelCapabilities
    if (caps) {
      caps.controls = store.modelControls.map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category,
        parameters: c.parameters,
        active: c.active,
        source: c.source,
      }))
    }
    deps.sendModelControls(
      store.modelControls.map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category,
        active: c.active,
      })),
      store.statePresets.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        emotion: p.emotion,
        group: p.group,
        controls: p.controls,
        parameters: p.parameters,
        custom: true,
      })),
    )
    syncModelContextToMain()
  }

  /**
   * 提交阶段：所有可能抛异常的准备工作先做完，再切换可见模型。
   * 提交中途失败会回滚 store 并把新模型摘台释放，当前可见模型不受影响。
   */
  function commitLive2DModel(
    url: string,
    model: DeskpetModel,
    emotionAdapter: ModelEmotionAdapter,
    diskAssets: ModelDiskAssetsInfo | null,
  ): void {
    const app = store.pixiApp
    if (!app) {
      discardLive2DModel(model)
      throw new Error('渲染舞台尚未就绪')
    }

    // ── 切换前快照：prepare 或 commit 任何一步失败都回滚到这里 ──
    const previous = store.live2dModel
    const previousHiddenParts = currentBaseHiddenParts
    const previousIdleGroups = idleGroups
    const snapshot = {
      emotionAdapter: store.emotionAdapter,
      modelCapabilities: store.modelCapabilities,
      modelEmotions: store.modelEmotions,
      modelControls: store.modelControls,
      modelSliders: store.modelSliders,
      defaultEmotion: store.defaultEmotion,
      modelUrl: store.modelUrl,
      modelLoaded: store.modelLoaded,
      currentEmotion: store.currentEmotion,
      emotionPulse: store.emotionPulse,
    }

    try {
      // ── prepare：只读 store、只改新模型 ──
      const capabilities = describeModel(model, url, diskAssets)
      const resolved = resolveModelControlsAndBase(emotionAdapter, capabilities, diskAssets)
      const focus = resolveModelFocusMapping(
        capabilities.parameters, diskAssets?.performance?.metadata.physics, emotionAdapter.focus, diskAssets?.vtubeFocusBindings,
        emotionAdapter.generatedFocus,
      )
      capabilities.focusMapping = focus
      capabilities.vtubeFocusBindings = diskAssets?.vtubeFocusBindings
      const sliders = resolveModelSliders(
        capabilities,
        resolved.controls,
        resolved.baseParameters,
        diskAssets?.motionParameterIds ?? [],
        focus,
        diskAssets?.vtubeParameters ?? [],
        diskAssets?.physicsOutputIds ?? [],
      )
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishHappyMotion(model, diskAssets?.performance, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_HAPPY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_HAPPY_MOTION}#0`]: { durationMs: DAFISH_HAPPY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishAuthoredHappyMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_AUTHORED_HAPPY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_AUTHORED_HAPPY_MOTION}#0`]: { durationMs: DAFISH_AUTHORED_HAPPY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishCalibratedHappyMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_CALIBRATED_HAPPY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_CALIBRATED_HAPPY_MOTION}#0`]: { durationMs: DAFISH_CALIBRATED_HAPPY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedHappyMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_HAPPY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_HAPPY_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_HAPPY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishWellActuallyMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_WELL_ACTUALLY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_WELL_ACTUALLY_MOTION}#0`]: { durationMs: DAFISH_WELL_ACTUALLY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedCuriousMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_CURIOUS_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_CURIOUS_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_CURIOUS_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedSurprisedMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_SURPRISED_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_SURPRISED_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_SURPRISED_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedSadMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_SAD_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_SAD_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_SAD_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedAngryMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_ANGRY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_ANGRY_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_ANGRY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedShyMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_SHY_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_SHY_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_SHY_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedThinkingMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_THINKING_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_THINKING_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_THINKING_DURATION * 1000, loop: true } }
      }
      if (isDafishModel(sliders, resolved.controls) &&
          installDafishBodyLedNeutralMotion(model, capabilities.parameters, diskAssets?.physicsOutputIds ?? [])) {
        capabilities.motionGroups[DAFISH_BODY_LED_NEUTRAL_MOTION] = 1
        capabilities.motionDetails = { ...capabilities.motionDetails,
          [`${DAFISH_BODY_LED_NEUTRAL_MOTION}#0`]: { durationMs: DAFISH_BODY_LED_NEUTRAL_DURATION * 1000, loop: true } }
      }
      capabilities.baseParameters = resolved.baseParameters
      capabilities.controls = resolved.controls.map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category,
        parameters: c.parameters,
        ...(c.stages ? { stages: c.stages } : {}),
        ...(typeof c.currentStageIndex === 'number' ? { currentStageIndex: c.currentStageIndex } : {}),
        ...(typeof c.defaultStageIndex === 'number' ? { defaultStageIndex: c.defaultStageIndex } : {}),
        active: c.active,
        source: c.source,
        defaultActive: c.defaultActive,
        hiddenParts: c.hiddenParts,
        ...(c.shownParts ? { shownParts: c.shownParts } : {}),
        ...(c.held ? { held: true } : {}),
      }))
      // 只作用于新模型，不会影响当前可见模型
      setBaseParameters(model, resolved.baseParameters)
      setHiddenDrawables(model, prepareModelWatermarkDrawables(
        model, emotionAdapter.hiddenDrawables ?? [], diskAssets?.performance?.modelSignature,
      ))
      setFocusMapping(model, focus, diskAssets?.vtubeFocusBindings)
      protectAutomaticBlink(model, capabilities.parameters, diskAssets)
      prepareModelPerformance(model, diskAssets?.performance)
      // 预设/控件占用通道时日常层当帧让路；恢复后由运行时自己渐入。
      setPerformanceOwnershipProvider(model, () => getPerformanceOwnedParameterIds(model))

      // ── commit：切换可见模型 ──
      attachLive2DModel(model, app)
      resizeModel(model, window.innerWidth, window.innerHeight, store.modelZoom)
      model.position.x += store.modelOffsetX
      model.position.y += store.modelOffsetY

      currentBaseHiddenParts = resolved.hiddenParts
      store.emotionAdapter = emotionAdapter
      capabilities.assetSignature = diskAssets?.performance?.modelSignature
      store.modelCapabilities = capabilities
      store.modelEmotions = Object.keys(emotionAdapter.emotions)
      store.modelControls = resolved.controls
      store.modelSliders = sliders
      deps.resetAppliedControls()
      store.defaultEmotion = 'neutral'
      store.live2dModel = model
      store.modelUrl = url
      store.ensureModelPresetsSeeded(diskAssets?.savedPresets ?? null)
      store.modelLoaded = true

      if (Object.keys(resolved.baseParameters).length > 0) {
        console.info('[Deskpet] 已应用底层常驻/去水印参数:', resolved.baseParameters)
      }
      deps.syncControlsToModelAndHost()
      if (resolved.controls.length > 0) {
        console.info(
          `[Deskpet] 已发现模型控件 ${resolved.controls.length} 个:`,
          resolved.controls.map((c) => c.label).join(', '),
        )
      }
      store.currentEmotion = 'neutral'
      store.emotionPulse++

      if (emotionAdapter.loaded) {
        reportAdapterValidation(
          validateAdapter(emotionAdapter, capabilities),
          capabilities,
          emotionAdapter.name || emotionAdapter.modelId || url,
        )
      }

      const declaredIdle = emotionAdapter.idleMotions.filter(
        (group) => group in capabilities.motionGroups,
      )
      idleGroups = declaredIdle.length > 0 ? declaredIdle : pickIdleGroups(getMotionGroups(model))
      if (idleGroups.length === 0) {
        console.info('[Deskpet] Model has no idle motion group, idle animation disabled')
      }
      deps.startAnimation(model)
      store.pixiApp?.ticker.start()
      deps.startAnimationPoll()
      deps.startIdleScheduler()
    } catch (err) {
      console.error('[Deskpet] Model commit failed, rolled back:', err)
      currentBaseHiddenParts = previousHiddenParts
      idleGroups = previousIdleGroups
      Object.assign(store, snapshot)
      store.live2dModel = previous
      // 新模型可能还没上台就失败了；unload 内部对"不在台上"做了兜底，
      // 并保证一定 destroy，避免它挂在 Ticker.shared 上空转
      unloadLive2DModel(model, app)
      deps.startIdleScheduler()
      throw err
    }

    // 提交成功后才释放旧模型；先做短交叉淡化，避免不同模型资源数量导致硬切。
    if (previous && previous !== model) {
      crossfadePreviousModel(previous, model, app)
    }
  }

  /** 初次挂载：只用于组件启动，与热切换共用同一套代数与提交逻辑 */
  async function mountModel(url: string): Promise<void> {
    const seq = invalidatePendingLoads()
    const [model, diskAssets] = await Promise.all([
      createLive2DModel(url),
      window.utaAPI?.inspectModelAssets?.(url).catch(() => null) ?? Promise.resolve(null),
    ])
    if (seq !== mountSeq) {
      discardLive2DModel(model)
      return
    }
    const emotionAdapter = await loadEmotionAdapter(url, diskAssets?.performance?.modelSignature)
    if (seq !== mountSeq) {
      discardLive2DModel(model)
      return
    }
    commitLive2DModel(url, model, emotionAdapter, diskAssets)
  }

  /** Pixi 应用只在 Live2D 路径需要；立绘模式下首次切回 Live2D 时按需创建 */
  async function ensurePixiApp(): Promise<boolean> {
    if (store.pixiApp) return true
    if (typeof (window as any).Live2DCubismCore === 'undefined') {
      modelError.value = '缺少 Cubism 4 运行时'
      return false
    }
    try {
      const container = deps.getStageContainer()
      const app = await createPixiApp(container!, window.innerWidth, window.innerHeight)
      store.pixiApp = app
      const canvas = app.view as HTMLCanvasElement
      unbindCanvasWheel = deps.bindCanvasWheel(canvas)
      return true
    } catch (err) {
      console.error('[Deskpet] Failed to create PixiJS app:', err)
      modelError.value = `渲染初始化失败: ${err instanceof Error ? err.message : String(err)}`
      return false
    }
  }

  async function switchModel(url: string): Promise<void> {
    if (url === store.modelUrl) return
    const kind = kindOfModelUrl(url)
    const seq = invalidatePendingLoads()
    // A new switch supersedes any StaticStage mount that is still loading.
    cancelStaticModelLoad()
    const previousUrl = store.modelUrl

    if (kind === 'image-set') {
      try {
        await loadImageSet(url)
      } catch (err) {
        if (seq === mountSeq) {
          console.error('[Deskpet] Failed to switch to image-set:', err)
          modelError.value = '立绘包加载失败。文件可能缺失或无法读取。'
        }
        return
      }
      if (seq !== mountSeq) return

      deps.stopIdleScheduler()
      deps.stopAnimation()
      deps.stopAnimationPoll()
      // 立绘模式不渲染 Live2D：停掉共享 Ticker，避免空舞台继续按刷新率出帧
      store.pixiApp?.ticker.stop()
      deps.resetMotionPriority()
      disposeCurrentLive2DModel()
      currentBaseHiddenParts = []
      store.emotionAdapter = null
      store.modelCapabilities = null
      store.modelEmotions = []
      store.modelControls = []
      store.modelSliders = []
      deps.resetAppliedControls()
      deps.sendModelControls([])
      store.defaultEmotion = 'neutral'
      store.modelLoaded = false
      clearModelCache()
      // Arm before changing modelUrl: StaticStage mounts from this watcher and
      // reports success/failure only after its own asynchronous load settles.
      const staticLoad = armStaticModelLoad(url)
      store.modelUrl = url
      setStoredModelPath(url)
      modelError.value = ''
      syncModelContextToMain()
      console.log(`[Deskpet] Switched to image-set: ${previousUrl || '(none)'} → ${url}`)
      const loaded = await staticLoad
      if (seq !== mountSeq) return
      if (!loaded) {
        modelError.value = '立绘包加载失败。文件可能缺失或无法读取。'
      }
      return
    }

    if (!(await ensurePixiApp())) return
    if (seq !== mountSeq) return

    let model: DeskpetModel
    let diskAssets: ModelDiskAssetsInfo | null = null
    try {
      ;[model, diskAssets] = await Promise.all([
        createLive2DModel(url),
        window.utaAPI?.inspectModelAssets?.(url).catch(() => null) ?? Promise.resolve(null),
      ])
    } catch (err) {
      if (seq === mountSeq) {
        console.error('[Deskpet] Failed to switch model:', err)
        modelError.value = '角色文件加载失败。它可能被移动、删除或内容不完整。'
      }
      return
    }
    if (seq !== mountSeq) {
      discardLive2DModel(model)
      return
    }
    const emotionAdapter = await loadEmotionAdapter(url, diskAssets?.performance?.modelSignature)
    if (seq !== mountSeq) {
      discardLive2DModel(model)
      return
    }

    deps.stopIdleScheduler()
    deps.stopAnimation()
    deps.resetMotionPriority()
    deps.cancelPresetSequence()
    try {
      commitLive2DModel(url, model, emotionAdapter, diskAssets)
    } catch (err) {
      console.error('[Deskpet] Failed to switch model:', err)
      modelError.value = '角色切换失败。模型文件可能缺失或无法读取。'
      return
    }
    clearModelCache()
    setStoredModelPath(url)
    modelError.value = ''
    console.log(`[Deskpet] Switched model: ${previousUrl || '(none)'} → ${url}`)
  }

  function installModelInspector(): void {
    ;(window as any).deskpetInspectModel = () => {
      const caps = store.modelCapabilities
      if (!caps) {
        console.warn('[Deskpet] 模型还没加载完')
        return null
      }
      console.log(JSON.stringify(caps, null, 2))
      console.info(
        `[Deskpet] 动作组 ${Object.keys(caps.motionGroups).length} 个、` +
          `表情 ${caps.expressions.length} 个、参数 ${caps.parameters.length} 个、` +
          `控件 ${caps.controls?.length ?? 0} 个。` +
          '适配规范见 docs/MODEL-ADAPTER-SPEC.md',
      )
      return caps
    }

    ;(window as any).deskpetInspectModelFacts = () => {
      const facts = inspectModelCapabilityFacts(store.live2dModel, store.emotionAdapter, store.modelCapabilities)
      if (!facts) {
        console.warn('[Deskpet] 模型事实还没准备好')
        return null
      }
      console.log(JSON.stringify(facts, null, 2))
      console.info(
        `[Deskpet] 只读模型事实：参数 ${facts.parameters.length}、表情 ${facts.expressions.length}、` +
          `动作 ${facts.motions.length}、诊断 ${facts.diagnostics.length}。诊断不代表画面已经验收。`,
      )
      return facts
    }

    ;(window as any).deskpetInspectStack = () => {
      if (!store.live2dModel) return null
      const snapshot = inspectModelStack(store.live2dModel)
      console.log(JSON.stringify(snapshot, null, 2))
      return snapshot
    }

    ;(window as any).deskpetListControls = () => {
      const list = store.modelControls.map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category,
        active: c.active,
        source: c.source,
      }))
      console.table(list)
      return list
    }

    ;(window as any).deskpetTestControl = (
      control: string,
      action: DeskpetControlAction = 'toggle',
    ) => {
      return store.applyControlAction(control, action)
    }

    ;(window as any).deskpetInspectControls = (query = '') => {
      const pattern = String(query || '').toLowerCase()
      return store.modelControls
        .filter((control) =>
          !pattern || `${control.id} ${control.label}`.toLowerCase().includes(pattern),
        )
        .map((control) => ({
          id: control.id,
          label: control.label,
          active: control.active,
          parameters: { ...control.parameters },
          shownParts: [...(control.shownParts ?? [])],
          hiddenParts: [...(control.hiddenParts ?? [])],
        }))
    }

    ;(window as any).deskpetInspectParts = (query = '') => {
      const pattern = String(query || '').toLowerCase()
      const coreModel = (store.live2dModel as any)?.internalModel?.coreModel
      return (store.modelCapabilities?.parts ?? [])
        .filter(
          (part) =>
            !pattern || `${part.id} ${part.name || ''}`.toLowerCase().includes(pattern),
        )
        .map((part) => ({
          id: part.id,
          name: part.name,
          opacity:
            typeof coreModel?.getPartOpacityById === 'function'
              ? coreModel.getPartOpacityById(part.id)
              : null,
        }))
    }

    ;(window as any).deskpetTestEmotion = (emotion: string) => {
      if (modelKind.value === 'image-set') {
        if (!store.modelEmotions.includes(emotion)) {
          console.warn(
            `[Deskpet] 立绘包里没有 "${emotion}"，可用：${store.modelEmotions.join(', ')}`,
          )
          return
        }
      } else {
        if (!isDeskpetEmotionValue(emotion) && !store.modelEmotions.includes(emotion)) {
          const available = [...new Set([...DESKPET_EMOTIONS, ...store.modelEmotions])]
          console.warn(`[Deskpet] 未知情绪 "${emotion}"，可用：${available.join(', ')}`)
          return
        }
        if (!getEmotionTarget(store.emotionAdapter, emotion)) {
          console.warn(`[Deskpet] adapter 里没有映射情绪 "${emotion}"，不会有任何效果`)
          return
        }
      }
      store.currentEmotion = emotion
      store.emotionPulse++
      console.info(`[Deskpet] 测试情绪：${emotion}（6 秒后自动回默认表情）`)
    }

    ;(window as any).deskpetTestAnimation = (name: string) => {
      const target = getAnimationTarget(store.emotionAdapter, name, store.modelCapabilities)
      if (!target) {
        const available = Object.keys(store.emotionAdapter?.animations ?? {})
        console.warn(
          `[Deskpet] adapter 里没有映射动作 "${name}"` +
            (available.length
              ? `，已映射的动作：${available.join(', ')}`
              : '（该 adapter 未映射任何动作）'),
        )
        return
      }
      store.pendingAnimation = name
      console.info(
        `[Deskpet] 测试动作：${name} → 组 "${target.motion.group}" #${target.motion.index ?? 0}`,
      )
    }

    ;(window as any).deskpetTestMotion = (group: string, index = 0) => {
      if (!store.live2dModel) return false
      const available = Object.keys(store.modelCapabilities?.motionGroups ?? {})
      if (!available.includes(group)) {
        console.warn(`[Deskpet] 模型没有动作组 "${group}"，可用：${available.join(', ')}`)
        return false
      }
      const ok = deps.playMotionWithPriority(
        group,
        MotionLayer.Interaction,
        Math.max(0, index),
      )
      console.info(`[Deskpet] 测试原始动作：${group}[${Math.max(0, index)}] -> ${ok}`)
      return ok
    }

    ;(window as any).deskpetListExpressions = () => {
      const registered = [...(store.modelCapabilities?.expressions ?? [])]
      const unregistered = [...(store.modelCapabilities?.unregisteredExpressions ?? [])]
      console.table(registered.map((name) => ({ name, registered: true })))
      return { registered, unregistered }
    }

    ;(window as any).deskpetPreviewExpression = (name: string) => {
      if (!store.live2dModel) return false
      const registered = store.modelCapabilities?.expressions ?? []
      if (!registered.includes(name)) {
        console.warn(`[Deskpet] 表情 "${name}" 不在已注册表情中；可用：${registered.join(', ')}`)
        return false
      }
      setExpression(store.live2dModel, name)
      console.info(`[Deskpet] 试听原生表情：${name}`)
      return true
    }

    ;(window as any).deskpetClearExpression = () => {
      if (!store.live2dModel) return false
      clearExpression(store.live2dModel)
      console.info('[Deskpet] 已清除试听表情')
      return true
    }
  }

  /**
   * onMounted 的模型加载部分：
   * - 容器不存在或模型已经加载过时返回 false，舞台据此跳过后续宿主订阅（保持原行为）；
   * - 初始立绘包只写 store.modelUrl，不迁移缓存 / 存储路径（保持原行为）；
   * - 模型加载失败只展示 modelError，仍继续订阅宿主事件。
   */
  async function bootstrapInitialModel(): Promise<boolean> {
    const container = deps.getStageContainer()
    if (!container) return false

    container.innerHTML = ''

    if (store.modelLoaded) {
      console.log('[Deskpet] Model already loaded, skipping')
      return false
    }

    installModelInspector()

    const modelUrl = await discoverModel()
    modelNotice.value = consumeModelFallbackNotice()
    if (!modelUrl) {
      modelError.value = '找不到可用角色。模型文件可能被移动或删除。'
    } else if (kindOfModelUrl(modelUrl) === 'image-set') {
      store.modelUrl = modelUrl
      console.log('[Deskpet] 静态立绘模式:', modelUrl)
    } else {
      if (await ensurePixiApp()) {
        try {
          await mountModel(modelUrl)
          console.log('[Deskpet] Live2D model loaded successfully')
        } catch (err) {
          console.error('[Deskpet] Failed to load Live2D model:', err)
          const reason = err instanceof Error ? err.message : String(err)
          modelError.value = `模型加载失败: ${
            /unknown settings format/i.test(reason) ? '角色文件不是有效的 Live2D 模型。' : reason
          }`
        }
      }
    }
    return true
  }

  /**
   * 组件卸载时的渲染器清理：与拆分前顺序一致——
   * 先解绑 canvas 滚轮、销毁 Pixi 应用，再清空模型 store 字段与调试全局。
   * 停止动画 / 轮询 / 待机与作废在途加载仍由舞台按原顺序调用。
   */
  function disposeRenderer(): void {
    finishModelFade(true)
    if (store.pixiApp) {
      unbindCanvasWheel?.()
      unbindCanvasWheel = null
      store.pixiApp.destroy(true, { children: true, texture: true })
      store.pixiApp = null
    }
    store.live2dModel = null
    store.emotionAdapter = null
    store.modelCapabilities = null
    store.modelControls = []
    store.modelSliders = []
    store.modelLoaded = false
    store.modelUrl = ''
    delete (window as any).deskpetInspectModel
    delete (window as any).deskpetInspectModelFacts
    delete (window as any).deskpetListControls
    delete (window as any).deskpetTestControl
    delete (window as any).deskpetTestEmotion
    delete (window as any).deskpetTestAnimation
    delete (window as any).deskpetListExpressions
    delete (window as any).deskpetPreviewExpression
    delete (window as any).deskpetClearExpression
  }

  // 预设列表变化时同步到宿主；模型就绪前不推送空上下文。
  watch(
    () => store.statePresets,
    () => {
      if (store.modelLoaded) {
        reportControlsAndPresetsToHost()
      }
    },
    { deep: true },
  )

  // 模型情绪列表随加载 / 切换变化，同步给宿主与主进程。
  watch(
    () => store.modelEmotions,
    (emotions) => {
      deps.sendModelEmotions([...emotions])
      syncModelContextToMain()
    },
    { deep: true },
  )
  watch(() => store.modelLoaded, () => syncModelContextToMain())

  store.registerModelSwitcher(switchModel)

  return {
    modelError,
    modelNotice,
    modelKind,
    bootstrapInitialModel,
    invalidatePendingLoads,
    disposeRenderer,
    resolveModelDisplayName,
    reportControlsAndPresetsToHost,
    syncModelContextToMain,
    getModelRevision: () => currentModelRevision,
    getBaseHiddenParts,
    getIdleGroups,
    switchModel,
  }
}
