/** Snapshot history for the preset workshop editor. Snapshots stay opaque strings. */
export function createSnapshotHistory(limit = 40) {
  const undoStack: string[] = []
  const redoStack: string[] = []
  let current: string | null = null

  function reset(snapshot: string): void {
    undoStack.length = 0
    redoStack.length = 0
    current = snapshot
  }

  function commit(snapshot: string): void {
    if (current === null) {
      current = snapshot
      return
    }
    if (snapshot === current) return
    undoStack.push(current)
    if (undoStack.length > limit) undoStack.shift()
    current = snapshot
    redoStack.length = 0
  }

  function undo(): string | null {
    const previous = undoStack.pop()
    if (previous === undefined) return null
    if (current !== null) redoStack.push(current)
    current = previous
    return previous
  }

  function redo(): string | null {
    const next = redoStack.pop()
    if (next === undefined) return null
    if (current !== null) undoStack.push(current)
    current = next
    return next
  }

  return {
    reset,
    commit,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    snapshot: () => current,
  }
}
