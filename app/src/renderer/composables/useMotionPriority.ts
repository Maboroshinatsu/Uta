import { useDeskpetStore } from '@/stores/deskpet'
import { onMotionFinish, playMotion, resetTransientParametersToHome } from '@/services/live2d/loader'

const SCENE_MOTION_GROUPS = new Set(['selfie', 'selfiequick', 'ketchup', 'openlid', 'bubble', 'splash', 'aidale'])
const SCENE_CLEANUP_MS = 20_000

export enum MotionLayer {
  Idle = 1,
  Reply = 2,
  Interaction = 3,
}

export interface MotionPlayOptions {
  loop?: boolean
  durationMs?: number
  onStart?: (started: boolean) => void
  onFinish?: () => void
}

export function useMotionPriority(store: ReturnType<typeof useDeskpetStore>) {
  let currentLayer: MotionLayer | null = null
  // 每次播放发一个令牌：释放定时器只认自己那次播放，
  // 否则同层新动作会被旧动作的定时器提前解除保护
  let playToken = 0
  // 循环令牌：任何新播放 / 停止 / 换模型都会作废旧循环的续播
  let loopToken = 0
  let loopCleanup: (() => void) | null = null
  // 普通动作的结束订阅：动作真正放完就归还层级，兜底定时器只做保险
  let layerCleanup: (() => void) | null = null
  let looping = false
  let loopModel: ReturnType<typeof useDeskpetStore>['live2dModel'] = null
  let sceneCleanup: (() => void) | null = null
  let sceneTimer: ReturnType<typeof setTimeout> | null = null
  let sceneModel: ReturnType<typeof useDeskpetStore>['live2dModel'] = null

  /** Scene motions carry props; clear them on finish, timeout, replacement or reset. */
  function cleanupScene() {
    if (sceneCleanup) {
      sceneCleanup()
      sceneCleanup = null
    }
    if (sceneTimer) {
      clearTimeout(sceneTimer)
      sceneTimer = null
    }
    const model = sceneModel
    sceneModel = null
    if (model && store.live2dModel === model) {
      try {
        resetTransientParametersToHome(model)
      } catch {
        /* Best-effort cleanup; the next model layer will reapply a clean state. */
      }
    }
  }

  /** 层级释放的唯一出口：七条路径都走这里，避免新增出口时漏掉清理 */
  function clearLayer() {
    currentLayer = null
  }

  function dropLayerCleanup() {
    if (!layerCleanup) return
    layerCleanup()
    layerCleanup = null
  }

  /** 停止循环：令牌递增 + 退订事件，在途续播回调自动失效 */
  function stopLoop() {
    const ownedModel = loopModel
    loopToken++
    looping = false
    loopModel = null
    if (loopCleanup) {
      loopCleanup()
      loopCleanup = null
    }
    dropLayerCleanup()
    if (ownedModel && ownedModel === store.live2dModel) {
      try {
        ;(ownedModel.internalModel?.motionManager as any)?.stopAllMotions?.()
      } catch {
        /* Model may be disposed during a switch. */
      }
    }
    cleanupScene()
  }

  function playMotionWithPriority(
    motion: string,
    layer: MotionLayer,
    index: number = 0,
    options?: MotionPlayOptions,
  ): boolean {
    if (currentLayer !== null && layer < currentLayer) {
      // 循环动作的约定是“直到下一个动作或互动”；待机动作也算新动作，
      // 否则一次 loop 会让待机层永久被挡住，桌宠看起来不再呼吸。
      if (!(looping && layer === MotionLayer.Idle)) return false
      stopLoop()
      clearLayer()
    }

    const model = store.live2dModel
    if (!model) return false

    currentLayer = layer
    const token = ++playToken
    // 新播放接管循环所有权，先作废上一条循环
    stopLoop()
    const wantLoop = !!options?.loop
    const myLoop = loopToken

    void playMotion(model, motion, index, { loop: wantLoop }).then((started) => {
      if (playToken !== token || myLoop !== loopToken) {
        // [作用域清理]: 若当前异步动作 resolve 时令牌已过时（说明在此期间被取消或切换为静态预设），
        // 且此时没有新动作接管（currentLayer === null），必须立刻停掉这个刚启动的过时动作并恢复默认参数，
        // 避免废弃动作在后台循环回魂。
        if (
          started &&
          currentLayer === null &&
          !store.presetSequenceActive &&
          store.live2dModel === model
        ) {
          try {
            ;(model.internalModel?.motionManager as any)?.stopAllMotions?.()
            resetTransientParametersToHome(model)
          } catch {
            /* Model may be disposed. */
          }
        }
        options?.onStart?.(false)
        return
      }
      if (!started) {
        // 模型没有这条动作：不虚报成功，也不占用动作层级
        if (currentLayer === layer) clearLayer()
        options?.onStart?.(false)
        return
      }
      if (!wantLoop) {
        if (SCENE_MOTION_GROUPS.has(motion.toLowerCase())) {
          sceneModel = model
          const finishScene = () => {
            if (playToken !== token || store.live2dModel !== model) return
            cleanupScene()
            if (currentLayer === layer) clearLayer()
          }
          sceneCleanup = onMotionFinish(model, () => {
            if (playToken !== token || store.live2dModel !== model) return
            finishScene()
            options?.onFinish?.()
          })
          sceneTimer = setTimeout(finishScene, SCENE_CLEANUP_MS)
          options?.onStart?.(true)
          return
        }
        // 普通动作同样订阅结束事件；否则层级只能等兜底定时器，待机会被并不存在的播放时间挡住
        layerCleanup = onMotionFinish(model, () => {
          if (playToken !== token || store.live2dModel !== model) return
          dropLayerCleanup()
          if (currentLayer === layer) clearLayer()
          options?.onFinish?.()
        })
        options?.onStart?.(true)
        return
      }
      // 自然结束时续播；播放期间若换模型/换动作/显式停止，令牌不匹配即自动停止
      loopCleanup = onMotionFinish(model, () => {
        if (myLoop !== loopToken || playToken !== token) return
        if (store.live2dModel !== model || currentLayer !== layer) return
        void playMotion(model, motion, index)
      })
      looping = true
      loopModel = model
      options?.onStart?.(true)
    })

    // 兜底释放：finish 事件被 stopAllMotions 吞掉时层级仍要归还。
    // 主路径是上面的 motionFinish 订阅，这里的延时只是保险，测试会断言它。
    if (layer !== MotionLayer.Idle && !wantLoop) {
      setTimeout(() => {
        if (playToken === token && currentLayer === layer) {
          clearLayer()
        }
      }, options?.durationMs ? Math.max(5000, options.durationMs) : 8000)
    }

    return true
  }

  /** 模型热切换后必须重置，否则旧模型留下的层级会挡住新模型的动作 */
  function reset() {
    clearLayer()
    playToken++
    stopLoop()
    cleanupScene()
  }

  /**
   * 显式停止动作（如切回静态预设、清空预览或重置）：
   * 递增令牌作废在途动作，释放层级，停止底层 MotionManager 循环并恢复瞬态参数。
   */
  /** 显式释放当前占用的动作层级（如预设步骤全部演完或被取消，允许待机动作立即自然恢复） */
  function releaseMotionLayer() {
    clearLayer()
  }

  /**
   * 显式停止动作（如切回静态预设、清空预览或重置）：
   * 递增令牌作废在途动作，释放层级，停止底层 MotionManager 循环。
   * 仅在显式传入 resetTransientParams: true 时才执行硬归零，避免打断时造成模型瞬间抽搐。
   */
  function stopMotion(options?: { resetTransientParams?: boolean }) {
    playToken++
    clearLayer()
    const model = store.live2dModel
    stopLoop()
    if (model && store.live2dModel === model) {
      try {
        ;(model.internalModel?.motionManager as any)?.stopAllMotions?.()
        // 默认软停：停止播放时钟不等于把参数硬归零。硬归零必须由调用方显式要求，
        // 否则预设序列里的普通一步会在起步同帧被抹平（表现为抽搐或部件突然消失）。
        if (options?.resetTransientParams === true) {
          resetTransientParametersToHome(model)
        }
      } catch {
        /* Model may be disposed. */
      }
    }
  }

  return { playMotionWithPriority, stopMotion, stopLoop, releaseMotionLayer, isLooping: () => looping, reset }
}
