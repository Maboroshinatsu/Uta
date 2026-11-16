export class TransactionQueue {
  private tail: Promise<unknown> = Promise.resolve()

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => task(),
      () => task()
    )
    this.tail = next.catch(() => {})
    return next
  }

  public drain(): Promise<void> {
    return this.tail.then(
      () => {},
      () => {}
    )
  }
}
