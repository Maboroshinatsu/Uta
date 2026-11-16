export interface FailedDraftContext {
  sendSequence: number
  draftRevision: number
}

export interface CurrentDraftState {
  inputText: string
  sendSequence: number
  draftRevision: number
}

/**
 * A late failure may restore its text only when no newer send exists and the
 * user has not typed/cleared a newer draft in the meantime.
 */
export function canRestoreFailedDraft(
  context: FailedDraftContext,
  current: CurrentDraftState,
): boolean {
  return current.sendSequence === context.sendSequence &&
    current.draftRevision === context.draftRevision &&
    current.inputText.trim().length === 0
}
