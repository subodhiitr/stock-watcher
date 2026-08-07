import assert from 'node:assert/strict'
import fc from 'fast-check'

import type {
  OperatingMode,
  Portfolio,
  PortfolioStatus,
} from '../../../server/portfolio/index.ts'
import {
  eventId,
  makeContext,
  makePortfolio,
  portfolioId,
} from './arbitraries.ts'

export type PortfolioModelState = {
  status: PortfolioStatus
  mode: OperatingMode
  version: number
}

export type PortfolioRealState = {
  portfolio: Portfolio
}

export function createModelRunState(): {
  model: PortfolioModelState
  real: PortfolioRealState
} {
  return {
    model: { status: 'ACTIVE', mode: 'PAPER', version: 1 },
    real: { portfolio: makePortfolio('model') },
  }
}

class ArchiveCommand implements fc.Command<PortfolioModelState, PortfolioRealState> {
  readonly #token: number

  constructor(token: number) {
    this.#token = token
  }

  check(): boolean {
    return true
  }

  run(model: PortfolioModelState, real: PortfolioRealState): void {
    const result = real.portfolio.archive({
      portfolioId: real.portfolio.portfolioId,
      context: makeContext(model.version, `model-archive-${this.#token}`),
      eventId: eventId(`model-archive-${this.#token}`),
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    if (model.status === 'ACTIVE') {
      model.status = 'ARCHIVED'
      model.version += 1
      assert.equal(result.value.changed, true)
    } else {
      assert.equal(result.value.changed, false)
    }
    real.portfolio = result.value.state
    assertModelMatchesReal(model, real)
  }

  toString(): string {
    return `Archive(${this.#token})`
  }
}

class ChangeModeCommand implements fc.Command<PortfolioModelState, PortfolioRealState> {
  readonly #mode: 'OBSERVE' | 'PAPER' | 'RECOMMENDATION'
  readonly #token: number

  constructor(
    mode: 'OBSERVE' | 'PAPER' | 'RECOMMENDATION',
    token: number,
  ) {
    this.#mode = mode
    this.#token = token
  }

  check(model: Readonly<PortfolioModelState>): boolean {
    return model.status === 'ACTIVE'
  }

  run(model: PortfolioModelState, real: PortfolioRealState): void {
    const result = real.portfolio.changeMode({
      portfolioId: real.portfolio.portfolioId,
      mode: this.#mode,
      evidence: [],
      context: makeContext(model.version, `model-mode-${this.#token}`),
      eventId: eventId(`model-mode-${this.#token}`),
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    if (model.mode === this.#mode) {
      assert.equal(result.value.changed, false)
    } else {
      model.mode = this.#mode
      model.version += 1
      assert.equal(result.value.changed, true)
    }
    real.portfolio = result.value.state
    assertModelMatchesReal(model, real)
  }

  toString(): string {
    return `ChangeMode(${this.#mode},${this.#token})`
  }
}

class StaleScopeCommand implements fc.Command<PortfolioModelState, PortfolioRealState> {
  readonly #token: number

  constructor(token: number) {
    this.#token = token
  }

  check(): boolean {
    return true
  }

  run(model: PortfolioModelState, real: PortfolioRealState): void {
    const prior = real.portfolio
    const result = real.portfolio.archive({
      portfolioId: portfolioId(`model-foreign-${this.#token}`),
      context: makeContext(model.version, `model-invalid-${this.#token}`),
      eventId: eventId(`model-invalid-${this.#token}`),
    })
    assert.equal(result.ok, false)
    assert.equal(real.portfolio, prior)
    assertModelMatchesReal(model, real)
  }

  toString(): string {
    return `ForeignScope(${this.#token})`
  }
}

export const portfolioCommandArbitraries: readonly fc.Arbitrary<
  fc.Command<PortfolioModelState, PortfolioRealState>
>[] = Object.freeze([
  fc.nat().map((token) => new ArchiveCommand(token)),
  fc.record({
    mode: fc.constantFrom('OBSERVE', 'PAPER', 'RECOMMENDATION'),
    token: fc.nat(),
  }).map(({ mode, token }) => new ChangeModeCommand(mode, token)),
  fc.nat().map((token) => new StaleScopeCommand(token)),
])

function assertModelMatchesReal(
  model: PortfolioModelState,
  real: PortfolioRealState,
): void {
  assert.equal(real.portfolio.status, model.status)
  assert.equal(real.portfolio.mode, model.mode)
  assert.equal(real.portfolio.stateVersion, model.version)
}
