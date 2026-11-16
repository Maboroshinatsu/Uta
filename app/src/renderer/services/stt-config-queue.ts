// Survives a voice-panel remount. Reads wait for an older panel's final ordinary write.
let pending: Promise<unknown> = Promise.resolve()
export function queueSttConfigOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation)
  pending = result.then(() => undefined, () => undefined)
  return result
}
