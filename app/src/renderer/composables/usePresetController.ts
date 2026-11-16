import { useDeskpetStore } from '@/stores/deskpet'
import {
  applyParameters,
  clearExpression,
  getModelParameterBlendMode,
  releaseParameterIds,
  resetTransientParametersToHome,
  setControlLayer,
  setFocusWeight,
  setPresetMotionOwnership,
  setSequenceGazeOverride,
} from '@/services/live2d/loader'
import {
  applyControlActionToList,
  computeControlLayerState,
  findModelStatePreset,
  getPresetDefaultFinishMode,
  isDeskpetEmotionValue,
  isPersistentControlCategory,
  normalizePresetSteps,
  pickRandomPresetInGroup,
  resolvePresetGroup,
  resolvePresetMotion,
  type ModelStatePreset,
  type PresetFinishMode,
  type PresetKeyframeStep,
} from '@/services/live2d/emotion-adapter'
import { MotionLayer, type MotionPlayOptions } from '@/composables/useMotionPriority'
import type { MotionPlaybackResult } from '../../shared/motion-choreography'
import { isNativeMotionBinding } from '../../shared/native-motion'
import { getDafishHappyOwnedParameters } from '@/services/live2d/dafish-happy-performance'
import type { DeskpetControlAction } from '@/services/host/contracts'
import {
  CONTROL_TRANSITION_MS,
  RETURN_GAZE_MS,
  REVERT_TRANSITION_MS,
  resolvePresetFinishAction,
  resolvePresetRevertDelayMs,
  resolvePresetStepTiming,
} from '@/services/preset-sequence'

/**
 * 舞台侧无法由 store 直接拿到的能力，全部显式注入：
 * - 底层隐藏部件与 Live2D 就绪判定由模型提交阶段维护；
 * - 动作优先级、待机计时、宿主上报属于舞台的生命周期，控制器只发起调用。
 */
export interface PresetControllerDeps {
  /** 当前模型底层常驻隐藏部件（adapter.hiddenParts + 模型提交结果） */
  getBaseHiddenParts: () => string[]
  /** 动作层级播放入口；调用时才取值，避免与 useMotionPriority 的初始化顺序耦合 */
  playMotionWithPriority: (
    group: string,
    layer: MotionLayer,
    index?: number,
    options?: MotionPlayOptions,
  ) => boolean
  /** 显式停止动作与释放动作层 */
  stopMotion?: (options?: { resetTransientParams?: boolean }) => void
  /** 显式释放动作层级（预设演完立即允许待机动作恢复） */
  releaseMotionLayer?: () => void
  /** 预设抢到动作后重置待机计时 */
  notifyIdleInteraction: () => void
  /** 控件层落地后同步宿主与主进程（适配器归舞台所有） */
  reportControlsAndPresetsToHost: () => void
  /** Live2D 模型是否就绪：立绘模式不响应控件与预设 */
  isLive2dAvailable: () => boolean
}

/**
 * 状态预设 / 控件层 / 情绪分组触发的唯一实现。
 *
 * 迁移自 DeskpetStage.vue，保持原有序列语义：
 * - 每次触发先 `cancelPresetSequence` 取消防回并拿新令牌，所有在途定时器靠令牌对账；
 * - 分步序列按「过渡时长 + 保持时长」串行推进，最后一步按 finishMode 决定 loop / 回退 / 恢复视线；
 * - 控件只关闭本序列自己打开的那些，用户手动开启的常驻控件不受影响；
 * - 本轮真正改过的参数回到日常待机时兜底释放，防止渐变提前结束留下旧值。
 */
export function usePresetController(deps: PresetControllerDeps) {
  const store = useDeskpetStore()

  /** 序列代数：取消防回时 +1，在途定时器只认自己那一代 */
  let seqToken = 0
  let seqTimer: ReturnType<typeof setTimeout> | null = null
  /** 分镜序列播放中或分镜编辑锁定时，未显式指定眼球偏移的步骤保持眼球居中 */
  let sequenceGazeLocked = false
  let sequenceGazeAdditive = false

  /**
   * 本预设序列自己打开过的控件 id。
   * 回退时只关这些，用户手动开启的控件永不因预设而关闭。
   */
  let appliedControlIds: string[] = []
  /** 本预设序列在各个步骤中动态激活的控件集合，在后续步骤未声明或预设结束/打断时必须强制关闭复位 */
  const presetActivatedControlIds = new Set<string>()
  /** 预设启动前用户的基线激活控件，不可被预设序列篡夺为临时控件 */
  const userBaselineControlIds = new Set<string>()
  // One-shot presets render temporary controls over the user's selections.
  let temporaryControlLayer: { all: boolean; ids: string[] } | null = null
  /** 本轮预设修改过的滑块 id 集合，在后续步骤未声明或预设结束/打断时必须复位为默认值 */
  const presetModifiedSliderIds = new Set<string>()
  /** 本轮预设真正改过的参数；回到“日常待机”时兜底释放，防止渐变提前结束留下旧值。 */
  const touchedParamIds = new Set<string>()
  let onSequenceEnd: ((status: MotionPlaybackResult) => void) | undefined

  function settleSequence(status: MotionPlaybackResult): void {
    const notify = onSequenceEnd
    onSequenceEnd = undefined
    notify?.(status)
  }

    function cancelPresetSequence(cleanupPresetControls = false): number {
    if (seqTimer) {
      clearTimeout(seqTimer)
      seqTimer = null
    }
    sequenceGazeLocked = false
    sequenceGazeAdditive = false
    if (store.live2dModel) {
      setSequenceGazeOverride(store.live2dModel, false)
      setPresetMotionOwnership(store.live2dModel, false)
    }
    let needSync = Boolean(temporaryControlLayer?.ids.length)
    temporaryControlLayer = null
    if (cleanupPresetControls && presetActivatedControlIds.size > 0) {
      applyControlActionToList(
        store.modelControls,
        [...presetActivatedControlIds],
        'off',
        store.modelCapabilities,
      )
      presetActivatedControlIds.clear()
      appliedControlIds = []
      needSync = true
    }
    if (cleanupPresetControls && presetModifiedSliderIds.size > 0) {
      for (const s of store.modelSliders) {
        if (presetModifiedSliderIds.has(s.id)) {
          s.value = s.defaultValue
        }
      }
      presetModifiedSliderIds.clear()
      needSync = true
    }
    if (needSync && store.live2dModel) {
      applyModelControlAndSliderLayer(REVERT_TRANSITION_MS)
    }
    if (cleanupPresetControls) {
      deps.releaseMotionLayer?.()
    }
    // 序列一旦终止就把活动预设写回终值：presetSequenceActive 由它推导，
    // 残留旧 id 会让闸门永久为真，之后空闲小动作与悬停反应再也不来。
    store.activeRunningPresetId = store.activeHoldPresetId || 'neutral'
    settleSequence('interrupted')
    return ++seqToken
  }

  /**
   * 工坊里的临时部件（表情特效、道具、姿势开关）只属于编辑现场。
   * 回到日常待机或关闭工坊时恢复默认；常驻服装/发型由 isPersistentControlCategory 保留。
   */
  function resetTransientControlsForIdle(): boolean {
    return applyControlActionToList(
      store.modelControls,
      [],
      'reset_transient',
      store.modelCapabilities,
    ).changed
  }

  /** 清掉不归 base/controls/emotion 管的残留场景参数和表情，防止工坊特效回到待机后仍贴在脸上。 */
  function resetIdleScene(): void {
    if (!store.live2dModel) return
    clearExpression(store.live2dModel)
    resetTransientParametersToHome(store.live2dModel)
    applyParameters(store.live2dModel, {})
  }

  /** 控件 + 面捕滑块合并成一层后一次性落地；序列/工坊锁定时眼球归中 */
  function applyModelControlAndSliderLayer(
    transitionMs = 0,
    directParameters?: Record<string, number>,
  ): void {
    const model = store.live2dModel
    if (!model) return
    const caps = store.modelCapabilities
    let controls = store.modelControls
    if (temporaryControlLayer?.ids.length) {
      controls = controls.map(control => ({ ...control }))
      const held = controls.filter(control => control.held && control.active)
      const specs = held.map(control => control.stages?.length ? `${control.id}:${control.currentStageIndex ?? 0}` : control.id)
      applyControlActionToList(controls, [...temporaryControlLayer.ids, ...specs], 'on', caps)
    }
    const ctrlLayer = computeControlLayerState(controls, deps.getBaseHiddenParts(), caps)
    const mergedParams: Record<string, number> = { ...ctrlLayer.parameters }
    const hiddenSet = new Set<string>(ctrlLayer.hiddenParts)
    const shownSet = new Set<string>(ctrlLayer.shownParts)
    let armBSliderModified = false

    for (const s of store.modelSliders) {
      if (Math.abs(s.value - s.defaultValue) > 1e-4) {
        mergedParams[s.id] = s.value
        if (/^Param(Arm|Hand)[LR]B$/i.test(s.id)) {
          armBSliderModified = true
        }
      }
    }

    if (directParameters) {
      for (const [id, val] of Object.entries(directParameters)) {
        if (typeof val === 'number' && Number.isFinite(val)) {
          mergedParams[id] = val
        }
      }
    }

    if (sequenceGazeLocked || store.presetEditingLocked) {
      for (const s of store.modelSliders) {
        if (getDafishHappyOwnedParameters(model).has(s.id)) continue
        if (getModelParameterBlendMode(model, s.id) === 'gaze' && !(s.id in mergedParams)) {
          mergedParams[s.id] = s.defaultValue
        }
      }
    }

    if (armBSliderModified) {
      const partIds = new Set((caps?.parts ?? []).map((p) => p.id))
      if (partIds.has('PartArmA') && partIds.has('PartArmB')) {
        shownSet.add('PartArmB')
        hiddenSet.delete('PartArmB')
        hiddenSet.add('PartArmA')
        shownSet.delete('PartArmA')
      }
    }

    setControlLayer(
      model,
      {
        parameters: mergedParams,
        hiddenParts: hiddenSet,
        shownParts: shownSet,
        additiveGaze: sequenceGazeAdditive,
      },
      { transitionMs },
    )
  }

  function syncControlsToModelAndHost(
    transitionMs = 0,
    directParameters?: Record<string, number>,
  ): void {
    applyModelControlAndSliderLayer(transitionMs, directParameters)
    deps.reportControlsAndPresetsToHost()
  }

  function applyStepStateToModel(
    step: PresetKeyframeStep,
    transitionMs: number,
    preservePersistentControls = false,
  ): void {
    const stepControls = step.controls ?? []
    const stepParams = step.parameters ?? {}
    for (const id of Object.keys(stepParams)) touchedParamIds.add(id)
    for (const controlId of stepControls) {
      const baseId = controlId.split(':')[0]
      const control = store.modelControls.find((c) => c.id === controlId || c.id === baseId)
      if (!control) continue
      if (control.parameters) {
        for (const id of Object.keys(control.parameters)) touchedParamIds.add(id)
      }
    }

    if (temporaryControlLayer?.all) temporaryControlLayer.ids = stepControls
    else {
      const staged = temporaryControlLayer ? stepControls.filter(id => {
        const baseId = id.split(':')[0]
        return userBaselineControlIds.has(baseId) && store.modelControls.some(control => control.id === baseId && control.stages?.length)
      }) : []
      if (temporaryControlLayer) temporaryControlLayer.ids = staged
      applyPersistentStepControls(stepControls.filter(id => !staged.includes(id)), preservePersistentControls)
    }

    // 恢复先前步骤修改但当前步骤不再包含的滑块
    for (const s of store.modelSliders) {
      if (s.id in stepParams) {
        const targetVal = stepParams[s.id]
        s.value =
          typeof targetVal === 'number' && Number.isFinite(targetVal) ? targetVal : s.defaultValue
        presetModifiedSliderIds.add(s.id)
      } else if (presetModifiedSliderIds.has(s.id) || !preservePersistentControls) {
        s.value = s.defaultValue
        presetModifiedSliderIds.delete(s.id)
      }
    }

    syncControlsToModelAndHost(transitionMs, stepParams)

    if (
      preservePersistentControls &&
      stepControls.length === 0 &&
      Object.keys(stepParams).length === 0 &&
      touchedParamIds.size > 0 &&
      store.live2dModel
    ) {
      const ids = [...touchedParamIds]
      touchedParamIds.clear()
      const token = seqToken
      window.setTimeout(() => {
        if (token !== seqToken || !store.live2dModel) return
        releaseParameterIds(store.live2dModel, ids)
      }, transitionMs + 80)
    }
  }

  function applyPersistentStepControls(stepControls: string[], preservePersistentControls: boolean): void {
    // 1. 关闭本预设序列先前步骤动态激活、但当前步骤已不再包含的临时控件
    const stepControlSet = new Set(stepControls)
    const stalePresetControlIds = [...presetActivatedControlIds].filter(
      (id) => !stepControlSet.has(id) && !stepControls.some((sc) => sc.split(':')[0] === id),
    )
    if (stalePresetControlIds.length > 0) {
      applyControlActionToList(
        store.modelControls,
        stalePresetControlIds,
        'off',
        store.modelCapabilities,
      )
      for (const id of stalePresetControlIds) {
        presetActivatedControlIds.delete(id)
      }
    }

    // 2. 登记当前步骤新激活的临时预设控件（非预设开始前基线开启的控件）
    for (const controlId of stepControls) {
      const baseId = controlId.split(':')[0]
      if (!userBaselineControlIds.has(controlId) && !userBaselineControlIds.has(baseId)) {
        presetActivatedControlIds.add(controlId)
        if (baseId !== controlId) presetActivatedControlIds.add(baseId)
      }
    }

    if (stepControls.length > 0 || !preservePersistentControls) {
      // 真正的持久用户部件：属于持久类、且在当前处于 active、且绝非本轮预设步骤临时打开的部件
      const persistentActiveControls = preservePersistentControls
        ? store.modelControls.filter(
            (c) =>
              isPersistentControlCategory(c.category) &&
              c.active &&
              !presetActivatedControlIds.has(c.id),
          )
        : []
      const heldActiveControls = store.modelControls.filter((c) => c.held && c.active)

      for (const c of store.modelControls) {
        c.active = false
      }
      // 用户保持的部件最后落地：与预设控件互斥时以用户选择为准，
      // 否则一次换装就会把刚点开的道具/部件悄悄摘掉。
      // 对于具有多档位（stages）的持久部件或保持部件，明确附带当前已处于的档位索引（如 c.id:index），
      // 避免裸 ID 传给 'on' 时被误当成切换到下一档。
      const persistentSpecs = persistentActiveControls.map((c) =>
        c.stages && c.stages.length > 0 ? `${c.id}:${c.currentStageIndex ?? 0}` : c.id,
      )
      const heldSpecs = heldActiveControls.map((c) =>
        c.stages && c.stages.length > 0 ? `${c.id}:${c.currentStageIndex ?? 0}` : c.id,
      )
      const mergedControls = Array.from(
        new Set([...persistentSpecs, ...stepControls, ...heldSpecs]),
      )
      applyControlActionToList(store.modelControls, mergedControls, 'on', store.modelCapabilities)
      const userActiveIds = new Set([
        ...persistentActiveControls.map((c) => c.id),
        ...heldActiveControls.map((c) => c.id),
      ])
      appliedControlIds = stepControls.filter((id) => !userActiveIds.has(id))
    } else if (preservePersistentControls) {
      if (appliedControlIds.length > 0) {
        applyControlActionToList(store.modelControls, appliedControlIds, 'off', store.modelCapabilities)
        appliedControlIds = []
      }
      if (presetActivatedControlIds.size > 0) {
        applyControlActionToList(store.modelControls, [...presetActivatedControlIds], 'off', store.modelCapabilities)
        presetActivatedControlIds.clear()
      }
    }

  }

  function revertToActiveHoldPreset(expectedToken: number, failedPreset?: ModelStatePreset): void {
    if (expectedToken !== seqToken || !store.live2dModel) return
    sequenceGazeLocked = false
    if (store.live2dModel) setSequenceGazeOverride(store.live2dModel, false)
    // 回到鼠标跟随用长一点的缓动（与序列收尾同一时长），避免静止后猛切
    setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
    if (store.presetEditingLocked) return

    const pinnedPreset = store.statePresets.find((p) => p.id === store.activeHoldPresetId)
    if (store.activeHoldPresetId && !pinnedPreset) store.activeHoldPresetId = ''
    const isFailedPreset = (p: ModelStatePreset) => failedPreset === p || (failedPreset?.id && failedPreset.id === p.id)
    const holdPreset = pinnedPreset && !isFailedPreset(pinnedPreset) ? pinnedPreset
      : store.statePresets.find((p) => p.id === 'neutral' && !isFailedPreset(p))
    if (holdPreset) {
      // 与“钉为常驻”共用完整播放入口；只恢复末步参数会丢掉原生动作和情绪。
      const mode = holdPreset !== pinnedPreset && getPresetDefaultFinishMode(holdPreset) === 'loop' ? 'loop' : 'hold'
      applyPresetByEntry(holdPreset, mode)
      return
    }
    // 基准已删除时也要停止临时原生动作，不能只把显示 ID 改成 neutral。
    deps.stopMotion?.({ resetTransientParams: false })

    // 播完彻底清理本轮预设所有临时激活的控件与滑块，确保黑框眼镜、大牙、姿态等绝不残留
    if (presetActivatedControlIds.size > 0) {
      applyControlActionToList(
        store.modelControls,
        [...presetActivatedControlIds],
        'off',
        store.modelCapabilities,
      )
      presetActivatedControlIds.clear()
    }
    appliedControlIds = []

    if (presetModifiedSliderIds.size > 0) {
      for (const s of store.modelSliders) {
        if (presetModifiedSliderIds.has(s.id)) {
          s.value = s.defaultValue
        }
      }
      presetModifiedSliderIds.clear()
    }

    store.activeRunningPresetId = 'neutral'
    store.currentEmotion = 'neutral'
    resetTransientControlsForIdle()
    applyStepStateToModel(
      { durationMs: REVERT_TRANSITION_MS, holdMs: 0, controls: [], parameters: {} },
      REVERT_TRANSITION_MS,
      true,
    )
    setTimeout(() => {
      if (expectedToken === seqToken && store.live2dModel) {
        resetIdleScene()
        setPresetMotionOwnership(store.live2dModel, false)
      }
    }, REVERT_TRANSITION_MS + 100)
    deps.releaseMotionLayer?.()
  }

  function previewPresetStepOnModel(step: PresetKeyframeStep, gazeOverride = true): boolean {
    if (!deps.isLive2dAvailable() || !store.live2dModel) return false
    const transitionMs = 240
    cancelPresetSequence()
    sequenceGazeLocked = gazeOverride
    if (store.live2dModel) {
      setPresetMotionOwnership(store.live2dModel, true)
      setFocusWeight(store.live2dModel, gazeOverride ? 0 : 1, { transitionMs: 220 })
      clearExpression(store.live2dModel)
      // An immediate sync writes the previous pose into Cubism's motion baseline.
      applyParameters(store.live2dModel, {}, { transitionMs })
    }
    if (isNativeMotionBinding(step.motion)) {
      deps.playMotionWithPriority(
        step.motion.group,
        MotionLayer.Reply,
        step.motion.index ?? 0,
        { loop: false },
      )
    } else {
      // 工坊单步预览要看得到这一帧的精确姿态，这里仍然显式硬归零
      deps.stopMotion?.({ resetTransientParams: true })
    }
    applyStepStateToModel(step, transitionMs, false)
    return true
  }

  /**
   * 预设序列期间由关键帧主导眼神：压住鼠标偏移。
   * 表演循环整段持续独占，只有结束或被打断时才交回鼠标。
   */
  function holdSequenceGaze(steps: PresetKeyframeStep[]): void {
    sequenceGazeLocked = true
    const model = store.live2dModel
    if (!model) return
    setSequenceGazeOverride(model, true)
    setFocusWeight(model, 0, {
      transitionMs: Math.max(260, resolvePresetStepTiming(steps[0]).transitionMs),
    })
  }

  function applyPresetByEntry(preset: ModelStatePreset, modeOverride?: PresetFinishMode,
    onEnd?: (status: MotionPlaybackResult) => void, onStarted?: () => void): boolean {
    // 工坊编辑锁定时，外部预设入口不得抢走预览、控件、活动预设或计时器；
    // 工坊主动预览走 previewPresetStepOnModel / 解锁后的预览触发器。
    if (store.presetEditingLocked) return false
    // 宿主/状态预设接管时，作废工坊预览标记，避免关面板时误杀宿主预设
    if (!preset.preview) store.endPresetPreview()

    // cancel 会把活动 id 写回终值，所以「之前是否真的在播」必须在取消前取一次，
    // 让打断诊断与基线采集共用同一个事实，而不是各自在不同时刻读推导状态。
    const wasActive = store.presetSequenceActive

    // 强行打断上一轮预设：停止上一轮计时器并彻底清理上一轮临时激活的部件与滑块
    if (wasActive) {
      // 播放中途被别的来源接管，就是「切回待机 / 手消失」这类反馈的案发现场；
      // 带上调用栈，下一次复现能直接指出是谁打断的，而不是靠猜。
      console.warn(
        `[Deskpet] 预设「${store.activeRunningPresetId}」被「${preset.id ?? preset.label}」打断`,
        new Error('preset-preempt').stack,
      )
    }
    const token = cancelPresetSequence(true)
    onSequenceEnd = onEnd
    // 停止底层 MotionManager 播放时钟，但不硬归零瞬态参数，由新动作自然平滑淡入
    deps.stopMotion?.({ resetTransientParams: false })

    const steps = normalizePresetSteps(preset)
    const finishMode: PresetFinishMode = modeOverride ?? getPresetDefaultFinishMode(preset)
    if (finishMode === 'revert') temporaryControlLayer = { all: Boolean(onEnd), ids: [] }

    // 记录基线用户控件（仅在没有外部预设运行时采集真实基线）
    const isNewSequence = !wasActive
    if (isNewSequence) {
      userBaselineControlIds.clear()
      for (const c of store.modelControls) {
        if (c.active) userBaselineControlIds.add(c.id)
      }
    }
    presetActivatedControlIds.clear()
    appliedControlIds = []
    presetModifiedSliderIds.clear()

    // 空控件步骤不会清理用户控件；但回到日常待机必须把工坊临时部件和残留场景参数收掉。
    // 场景参数要等这一步的过渡结束再清，否则会在淡出中途硬复位导致闪烁。
    const group = resolvePresetGroup(preset)
    const resetToIdle = preset.id === 'neutral' || group === '日常待机' || group === '日常'
    if (resetToIdle) resetTransientControlsForIdle()

    store.activeRunningPresetId = preset.id ?? preset.label

    const lastStep = steps[steps.length - 1]
    const hasExplicitState =
      steps.length > 1 ||
      lastStep.controls.length > 0 ||
      Object.keys(lastStep.parameters).length > 0

    const explicitMotion =
      preset.motion && typeof preset.motion === 'object'
        ? resolvePresetMotion(preset, store.emotionAdapter, store.modelCapabilities)
        : !hasExplicitState
          ? resolvePresetMotion(preset, store.emotionAdapter, store.modelCapabilities)
          : null
    const loopingStepMotion = finishMode === 'loop' && steps.length === 1 && isNativeMotionBinding(lastStep.motion)
      ? lastStep.motion : null
    const openingMotion = loopingStepMotion ?? explicitMotion
    const awaitNative = Boolean(onEnd && explicitMotion && finishMode === 'revert')
    const nativeLoop = finishMode === 'loop' || finishMode === 'hold'
    const awaitStart = awaitNative || (openingMotion !== null && nativeLoop)
    if (!awaitStart && store.live2dModel) setPresetMotionOwnership(store.live2dModel, true)
    const plainIdle = resetToIdle && steps.length === 1 && !Object.keys(lastStep.parameters).length &&
      !explicitMotion && !lastStep.motion && lastStep.controls.every(id =>
        store.modelControls.some(control => control.id === id && control.defaultActive))
    let nativeFinished = !awaitNative
    let finishSequence: (() => void) | undefined
    const failNative = () => {
      if (token !== seqToken) return
      settleSequence('failed')
      if (token !== seqToken) return
      const nextToken = cancelPresetSequence(true)
      deps.stopMotion?.({ resetTransientParams: false })
      revertToActiveHoldPreset(nextToken, preset)
    }

    const startNative = () => {
      if (!openingMotion) return true
      if (store.currentEmotion !== 'neutral') {
        store.currentEmotion = 'neutral'
      }
      const presetDurationMs = steps.reduce(
        (sum, s) => sum + (s.durationMs ?? 0) + (s.holdMs ?? 0),
        0,
      )
      const accepted = deps.playMotionWithPriority(
        openingMotion.group,
        MotionLayer.Reply,
        openingMotion.index ?? 0,
        {
          loop: nativeLoop,
          durationMs: presetDurationMs > 0 ? presetDurationMs + 500 : 8000,
          ...(awaitStart ? {
            onStart: (started: boolean) => {
              if (token !== seqToken) return
              if (!started) { failNative(); return }
              if (seqTimer) clearTimeout(seqTimer)
              seqTimer = null
              if (store.live2dModel) setPresetMotionOwnership(store.live2dModel, true)
              onStarted?.()
              runStep(0)
            },
            onFinish: () => {
              if (token !== seqToken) return
              nativeFinished = true
              finishSequence?.()
            },
          } : {}),
        },
      )
      deps.notifyIdleInteraction()
      return accepted
    }
    if (!explicitMotion) {
      deps.stopMotion?.()
      if (!hasExplicitState && preset.emotion && preset.emotion !== 'neutral') {
        store.currentEmotion = preset.emotion
        store.emotionPulse++
      } else if (store.currentEmotion !== 'neutral') {
        store.currentEmotion = 'neutral'
      }
    }

    // 日常待机是环境动作，头身摆动和眼球微动叠加在鼠标跟随上；
    // 表演仍由预设主导视线，但循环接缝不再反复交接。
    sequenceGazeAdditive = resetToIdle && finishMode === 'loop'
    if (sequenceGazeAdditive) {
      if (store.live2dModel) {
        setSequenceGazeOverride(store.live2dModel, false)
        setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
      }
    } else {
      holdSequenceGaze(steps)
    }

    const runStep = (idx: number, isLoopStart = false) => {
      if (token !== seqToken || !store.live2dModel) return
      const step = steps[idx]
      // 首步 duration 是首次入场过渡；重复播放直接回到首帧，不新增回程动画或同长静止等待。
      // 作者显式设置的首帧 hold 仍然有效，后续步骤时长保持不变。
      const timing = resolvePresetStepTiming(isLoopStart ? { ...step, durationMs: 0 } : step)
      const isLast = idx >= steps.length - 1

      // 多步编排的最后一步一开始就把眼神交回鼠标跟随：动作放完那一刻视线已经在跟，
      // 不再是「先定住、再慢慢跟上来」的两段感。单步预设没有收尾步，仍在演完时交回，
      // 否则它的关键帧表情从第一帧就会被鼠标盖住。
      if (isLast && steps.length > 1 && finishMode !== 'loop' && !onEnd && store.live2dModel) {
        setSequenceGazeOverride(store.live2dModel, false)
        setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
      }

      // 当预设由独立 Live2D 动作轨道（explicitMotion）驱动时，
      // 仅过滤掉已被 60FPS 动作轨道占用的身体位姿参数，避免双轨参数叠加扭曲；
      // 其余表情参数（面部神态、眼睛、嘴型、道具等）完整保留并正常下发；
      // 工坊单步预览模式保持 100% 原始参数呈现。
      if (explicitMotion && store.live2dModel) {
        const ownedParams = getDafishHappyOwnedParameters(store.live2dModel)
        if (ownedParams && ownedParams.size > 0 && step.parameters) {
          const filteredParams: Record<string, number> = {}
          for (const [key, val] of Object.entries(step.parameters)) {
            if (!ownedParams.has(key)) {
              filteredParams[key] = val
            }
          }
          applyStepStateToModel(
            { ...step, parameters: filteredParams },
            timing.transitionMs,
            true,
          )
        } else {
          applyStepStateToModel(step, timing.transitionMs, true)
        }
      } else {
        applyStepStateToModel(step, timing.transitionMs, true)
      }
      if (!loopingStepMotion && isNativeMotionBinding(step.motion)) {
        deps.playMotionWithPriority(
          step.motion.group,
          MotionLayer.Reply,
          step.motion.index ?? 0,
          { loop: false },
        )
      }

      if (!isLast) {
        seqTimer = setTimeout(() => {
          seqTimer = null
          runStep(idx + 1)
        }, timing.delayMs)
        return
      }

      seqTimer = setTimeout(() => {
        seqTimer = null
        if (token !== seqToken || !store.live2dModel) return
        const action = resolvePresetFinishAction(
          finishMode,
          steps.length,
          store.presetEditingLocked,
        )
        if (action === 'loop') {
          runStep(0, true)
          return
        }
        if (action === 'revert') {
          // 动作放完就立刻开始把视线交回鼠标跟随（保留慢过渡），
          // 姿态仍按 revertHoldMs 保持到位——之前的停顿感来自交回被推迟到保持结束之后。
          if (store.live2dModel) {
            setSequenceGazeOverride(store.live2dModel, false)
            setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
          }
          const complete = () => {
            if (token !== seqToken) return
            if (seqTimer) clearTimeout(seqTimer)
            seqTimer = null
            settleSequence(store.presetEditingLocked ? 'interrupted' : 'completed')
            revertToActiveHoldPreset(token)
          }
          seqTimer = setTimeout(() => {
            if (token !== seqToken) return
            if (nativeFinished) complete()
            else {
              finishSequence = complete
              seqTimer = setTimeout(failNative, 2500)
            }
          }, resolvePresetRevertDelayMs(preset))
          return
        }
        sequenceGazeLocked = false
        settleSequence(store.presetEditingLocked ? 'interrupted' : 'completed')
        // settle（hold 型与单步 loop）演完不经过 revert，也必须自己把活动预设写回终值，
        // 否则宿主 set_preset …mode=hold 之后闸门永不解除。
        store.activeRunningPresetId = store.activeHoldPresetId || 'neutral'
        if (store.live2dModel) {
          setSequenceGazeOverride(store.live2dModel, false)
          setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
        }
        if (!store.presetEditingLocked) {
          applyModelControlAndSliderLayer(RETURN_GAZE_MS)
        }
        if (plainIdle && store.live2dModel) {
          resetIdleScene()
        }
        // 静态终态由控件/滑块层保留；时间线结束后不能继续封锁模型的原生待机。
        // 多步 loop 在上方续播，整段或单步绑定的原生循环继续由 SDK 持有。
        if (!explicitMotion && !loopingStepMotion && !store.presetEditingLocked && store.live2dModel) {
          setPresetMotionOwnership(store.live2dModel, false)
        }
      }, timing.delayMs)
    }

    if (awaitStart) seqTimer = setTimeout(failNative, 5000)
    const accepted = startNative()
    if (awaitStart && !accepted) { failNative(); return false }
    if (!awaitStart) runStep(0)

    console.info(
      `[Deskpet] 已触发预设 "${preset.label}" (步数: ${steps.length}, 模式: ${finishMode})`,
    )
    return true
  }

  function handlePresetTrigger(
    presetOrId: string | ModelStatePreset,
    modeOverride?: PresetFinishMode,
    onEnd?: (status: MotionPlaybackResult) => void,
    onStarted?: () => void,
  ): boolean {
    if (!deps.isLive2dAvailable()) return false
    // 用户在预设工坊编辑时，宿主状态/回复绝不能抢走预览与控件
    if (store.presetEditingLocked) return false
    const preset =
      typeof presetOrId === 'string'
        ? findModelStatePreset(store.statePresets, presetOrId)
        : presetOrId
    if (!preset) return false
    return applyPresetByEntry(preset, modeOverride, onEnd, onStarted)
  }

  function stopSequence(id: string): boolean {
    if (store.activeRunningPresetId !== id || !onSequenceEnd) return false
    const token = cancelPresetSequence(true)
    deps.stopMotion?.({ resetTransientParams: false })
    revertToActiveHoldPreset(token)
    return true
  }

  /**
   * 智能触发预设或情绪分组：
   * - 若传入分组名（如 "开心" / "思考"）或英文情绪键（如 "happy" / "thinking"），
   *   优先在该分组内随机抽取一个预设变体（pickRandomPresetInGroup），让每次反应鲜活不重样；
   * - 若传入精确预设名（如 "开心·元气wink"），则直接触发该预设。
   */
  function triggerPresetOrGroup(query: string, modeOverride?: PresetFinishMode): boolean {
    const clean = (query || '').trim()
    if (!clean) return false
    // 工坊编辑锁定时，外部精确/分组/情绪 fallback 均不得改变舞台状态
    if (store.presetEditingLocked) return false

    if (deps.isLive2dAvailable()) {
      // 1. 精确匹配具体预设名或 ID（当 query 含有 · 或精确等于某个非分组名预设）
      const exactPreset = store.statePresets.find(
        (p) =>
          p.id.toLowerCase() === clean.toLowerCase() ||
          p.label.toLowerCase() === clean.toLowerCase(),
      )
      const groupRandom = pickRandomPresetInGroup(store.statePresets, clean)
      // 如果 query 是分组名或英文情绪名（如 "开心"、"happy"），优先走分组内随机变体
      const chosen =
        groupRandom && (!exactPreset || resolvePresetGroup(exactPreset) === groupRandom.group)
          ? groupRandom
          : exactPreset ?? findModelStatePreset(store.statePresets, clean)
      if (chosen) {
        return applyPresetByEntry(chosen, modeOverride)
      }
    }

    if (isDeskpetEmotionValue(clean) || store.modelEmotions.includes(clean)) {
      store.currentEmotion = clean
      store.emotionPulse++
      return true
    }
    return false
  }

  function handleControlAction(control: string, action: DeskpetControlAction = 'toggle'): boolean {
    if (!deps.isLive2dAvailable()) {
      console.warn('[Deskpet] 当前不在 Live2D 模式或模型未就绪，无法切换控件')
      return false
    }

    if (action === 'preset') {
      const preset = findModelStatePreset(store.statePresets, control)
      if (!preset) {
        console.warn(`[Deskpet] 未找到组合预设 "${control}"`)
        return false
      }
      return applyPresetByEntry(preset)
    }

    if (action === 'set' && control.trim() && !/[,，;；]/.test(control)) {
      const exactPreset = store.statePresets.find(
        (p) =>
          p.id.toLowerCase() === control.trim().toLowerCase() ||
          p.label.toLowerCase() === control.trim().toLowerCase(),
      )
      if (exactPreset) {
        return applyPresetByEntry(exactPreset)
      }
    }

    const isReset = action === 'reset' || action === 'reset_transient'
    const isBatchOrReset = isReset || action === 'set'

    // 先确认是否真正命中控件；未命中的普通动作可能回退到预设，
    // 锁定时必须在取消序列/改视线之前返回，避免破坏工坊预览。
    const { matched, matchedList, changed } = applyControlActionToList(
      store.modelControls,
      control,
      action,
      store.modelCapabilities,
    )
    if (!isBatchOrReset && !matched) {
      const fallbackPreset = findModelStatePreset(store.statePresets, control)
      if (fallbackPreset) {
        return applyPresetByEntry(fallbackPreset)
      }
      const available = store.modelControls.map((c) => c.id)
      console.warn(
        `[Deskpet] 未找到控件 "${control}"` +
          (available.length ? `，可用控件：${available.join(', ')}` : '（该模型没有可用控件）'),
      )
      return false
    }

    cancelPresetSequence()
    if (store.presetEditingLocked && store.live2dModel) {
      sequenceGazeLocked = true
      setFocusWeight(store.live2dModel, 0, { transitionMs: 180 })
    }

    if (isReset) {
      store.activeHoldPresetId = 'neutral'
      store.activeRunningPresetId = 'neutral'
      for (const s of store.modelSliders) {
        s.value = s.defaultValue
      }
      if (!store.presetEditingLocked && store.live2dModel) {
        sequenceGazeLocked = false
        setFocusWeight(store.live2dModel, 1, { transitionMs: CONTROL_TRANSITION_MS })
      }
    }

    syncControlsToModelAndHost(CONTROL_TRANSITION_MS)
    if (action === 'reset') {
      console.info('[Deskpet] 已重置所有模型控件与面捕滑块为默认状态')
    } else if (action === 'reset_transient') {
      console.info('[Deskpet] 已重置临时动作、表情控件与面捕滑块（常驻外观保留）')
    } else if (action === 'set') {
      console.info(
        `[Deskpet] 已组合切换状态控件 (${matchedList.length} 项):`,
        matchedList.map((m) => m.label).join(', ') || '日常待机',
      )
    } else if (matched) {
      console.info(`[Deskpet] 控件 "${matched.label}" → ${matched.active ? 'ON' : 'OFF'}`)
    }
    return changed || isBatchOrReset
  }

  /** 工坊拖动滑块：取消在途序列，编辑锁定时保持眼球居中 */
  function syncSlidersFromWorkshop(transitionMs = 0): boolean {
    if (!deps.isLive2dAvailable() || !store.live2dModel) return false
    cancelPresetSequence()
    if (store.presetEditingLocked && store.live2dModel) {
      sequenceGazeLocked = true
      setFocusWeight(store.live2dModel, 0, { transitionMs: 180 })
    }
    applyModelControlAndSliderLayer(transitionMs)
    return true
  }

  /** 工坊的 loop 预览不会自己结束；关闭面板时必须取消并恢复视线 */
  function stopPresetPreview(): void {
    if (!store.presetPreviewActive) return
    store.endPresetPreview()
    cancelPresetSequence(true)
    deps.stopMotion?.({ resetTransientParams: true })
    if (store.live2dModel) {
      setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
    }
  }

  /**
   * 关闭设置面板：解除编辑锁并在没有在途序列时恢复视线；
   * 若还开着临时预览，先停预览再恢复控件层。
   */
  function handleSettingsPanelClosed(): void {
    if (store.presetEditingLocked) {
      store.presetEditingLocked = false
      if (!seqTimer) {
        sequenceGazeLocked = false
        if (store.live2dModel) {
          setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
        }
        applyModelControlAndSliderLayer(RETURN_GAZE_MS)
      }
    }
    if (store.presetPreviewActive) {
      stopPresetPreview()
      applyModelControlAndSliderLayer(RETURN_GAZE_MS)
    }
    // 关闭工坊/设置：没有常驻预设且 Agent 空闲时，收掉编辑现场留下的临时部件与场景参数。
    if (!store.activeHoldPresetId && store.agentWorkingState === 'idle') {
      if (resetTransientControlsForIdle()) {
        applyModelControlAndSliderLayer(RETURN_GAZE_MS)
      }
      resetIdleScene()
    }
  }

  /** 模型提交/切换后清空“本序列打开过哪些控件”的记忆 */
  function resetAppliedControls(): void {
    temporaryControlLayer = null
    appliedControlIds = []
    presetActivatedControlIds.clear()
    userBaselineControlIds.clear()
    presetModifiedSliderIds.clear()
  }

  return {
    cancelPresetSequence,
    applyPresetByEntry,
    handlePresetTrigger,
    triggerPresetOrGroup,
    handleControlAction,
    previewPresetStepOnModel,
    revertToActiveHoldPreset,
    syncControlsToModelAndHost,
    syncSlidersFromWorkshop,
    stopPresetPreview,
    stopSequence,
    hasTrackedSequence: () => !!onSequenceEnd,
    handleSettingsPanelClosed,
    resetAppliedControls,
  }
}
