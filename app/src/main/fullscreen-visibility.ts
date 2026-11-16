interface PetWindow {
  isVisible(): boolean
  isMinimized(): boolean
  hide(): void
  showInactive(): void
}

/** Keep user visibility intent separate from the temporary fullscreen suppression. */
export class FullscreenVisibility {
  private occupied: boolean | undefined
  private clearSamples = 0
  private revealLater = false

  constructor(private readonly window: PetWindow, private readonly onExit?: () => void) {}

  blocksReveal(): boolean {
    return this.occupied !== false
  }

  requestShow(): void {
    if (this.blocksReveal()) this.revealLater = true
    else if (!this.window.isVisible()) this.window.showInactive()
  }

  toggleDeferredShow(): void {
    this.revealLater = !this.revealLater
  }

  sample(occupied: boolean): void {
    if (occupied) {
      this.clearSamples = 0
      this.occupied = true
      if (this.window.isVisible() && !this.window.isMinimized()) {
        this.revealLater = true
        this.window.hide()
      }
    } else if (this.occupied !== true || ++this.clearSamples >= 2) {
      this.clearFullscreen()
    }
  }

  clearFullscreen(): void {
    const wasOccupied = this.occupied === true
    this.occupied = false
    this.clearSamples = 0
    const reveal = this.revealLater
    this.revealLater = false
    if (reveal && !this.window.isVisible() && !this.window.isMinimized()) this.window.showInactive()
    if (wasOccupied) this.onExit?.()
  }
}
