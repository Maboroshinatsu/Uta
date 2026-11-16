import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { SettingsCloseRequest, SettingsWindowBridge } from '../../shared/settings-window-contracts'
import {
  hasUnsavedDraft,
  saveUnsavedDrafts,
  unsavedDraftLabels,
} from '../services/unsaved-drafts'
import type { useSettingsDraft } from './use-settings-draft'

/**
 * Public preferences save on change, so the close guard only protects drafts
 * that live outside that path (service keys and the preset workshop) and a
 * preference write that failed.
 */
export function useSettingsClose(
  draft: ReturnType<typeof useSettingsDraft>,
  bridge: SettingsWindowBridge | undefined,
) {
  const request = ref<SettingsCloseRequest | null>(null)
  const promptOpen = ref(false)
  const savingToClose = ref(false)
  const savingDrafts = ref(false)
  const replying = ref(false)
  const closeError = ref('')
  const closeGuardError = ref('')
  const closeReason = computed(() => request.value?.reason ?? 'window')
  const closeBusy = computed(() =>
    savingToClose.value || savingDrafts.value || replying.value || draft.saveStatus.value === 'saving')
  const draftLabels = computed(() => unsavedDraftLabels.value)
  let alive = true
  let unsubscribe: (() => void) | undefined

  function needsPrompt(): boolean {
    return hasUnsavedDraft.value || draft.saveStatus.value === 'error'
  }

  function saveFailed(): boolean {
    return draft.saveStatus.value === 'error'
  }

  async function settlePending(): Promise<void> {
    if (draft.hasPending()) await draft.flushPending()
  }

  async function reply(decision: 'close' | 'cancel'): Promise<void> {
    const current = request.value
    if (!bridge || !current || replying.value) return
    replying.value = true
    try {
      const accepted = await bridge.respond(current.id, decision)
      if (!alive || request.value?.id !== current.id) return
      if (accepted) {
        request.value = null
        promptOpen.value = false
        closeError.value = ''
      } else {
        promptOpen.value = true
        closeError.value = '窗口状态已变化，请继续编辑后重新关闭。'
      }
    } catch {
      if (alive && request.value?.id === current.id) {
        promptOpen.value = true
        closeError.value = '暂时无法关闭窗口，草稿仍保留，请重试。'
      }
    } finally {
      if (alive) {
        replying.value = false
        // A new native close can arrive before the old cancel acknowledgement.
        if (request.value && request.value.id !== current.id &&
          !hasUnsavedDraft.value && draft.saveStatus.value === 'idle') void reply('close')
      }
    }
  }

  onMounted(async () => {
    if (!bridge) return
    try {
      unsubscribe = bridge.onCloseRequested(incoming => {
        if (!alive) return
        if (request.value?.id === incoming.id) {
          request.value = { ...incoming }
          return
        }
        request.value = { ...incoming }
        savingToClose.value = false
        closeError.value = ''
        void (async () => {
          await settlePending()
          if (!alive || request.value?.id !== incoming.id) return
          if (needsPrompt()) {
            promptOpen.value = true
          } else {
            void reply('close')
          }
        })()
      })
      const ready = await bridge.ready()
      if (alive && !ready) closeGuardError.value = '关闭提醒暂不可用，请先保存密钥和工坊草稿后再关闭窗口。'
    } catch {
      if (alive) closeGuardError.value = '关闭提醒暂不可用，请先保存密钥和工坊草稿后再关闭窗口。'
    }
  })

  onUnmounted(() => {
    alive = false
    unsubscribe?.()
    request.value = null
  })

  async function saveAndClose(): Promise<void> {
    const id = request.value?.id
    if (!id || closeBusy.value) return
    savingToClose.value = true
    closeError.value = ''
    try {
      await settlePending()
      if (!alive || request.value?.id !== id) return
      if (saveFailed()) {
        await draft.retryNow()
        if (!alive || request.value?.id !== id) return
        if (saveFailed()) {
          closeError.value = draft.errorMessage.value || '偏好设置保存失败，请重试。'
          return
        }
      }
      if (hasUnsavedDraft.value) {
        savingDrafts.value = true
        const saved = await saveUnsavedDrafts()
        if (!alive || request.value?.id !== id) return
        if (!saved.ok) {
          closeError.value = `未能保存${saved.failed.join('、')}，请重试或放弃后关闭。`
          return
        }
      }
      if (hasUnsavedDraft.value || draft.hasPending() || saveFailed()) {
        closeError.value = draft.errorMessage.value || '仍有草稿内容未保存，请检查后再次保存。'
        return
      }
      await reply('close')
    } finally {
      savingDrafts.value = false
      if (alive && (!request.value || request.value.id === id)) savingToClose.value = false
    }
  }

  return {
    promptOpen, closeReason, closeBusy, replying, closeError, closeGuardError, draftLabels, saveAndClose,
    discardAndClose: () => closeBusy.value ? Promise.resolve() : reply('close'),
    continueEditing: () => reply('cancel'),
  }
}
