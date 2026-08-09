export class PortfolioRequestCoordinator {
  private generation = 0
  private active: AbortController | undefined

  begin(): Readonly<{ signal: AbortSignal; isCurrent: () => boolean }> {
    this.active?.abort()
    this.active = new AbortController()
    this.generation += 1
    const generation = this.generation
    return Object.freeze({
      signal: this.active.signal,
      isCurrent: () => !this.active?.signal.aborted && generation === this.generation,
    })
  }

  cancel(): void {
    this.active?.abort()
    this.active = undefined
    this.generation += 1
  }
}

