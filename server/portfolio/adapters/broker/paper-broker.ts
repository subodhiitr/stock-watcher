import { hashExecutionValue } from '../../domain/execution/canonical-codec.ts'
import type {
  BrokerOrderSnapshot,
  NormalizedFill,
  OrderIntentPayload,
} from '../../domain/execution/contracts.ts'
import type {
  ReconciledHolding,
  ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import {
  parseBrokerOrderReferenceId,
  parseFillId,
  type BrokerAccountBindingId,
  type InstrumentId,
  type PortfolioId,
} from '../../domain/shared/identifiers.ts'
import { createMoney, type Money } from '../../domain/shared/money.ts'
import { createQuantity, type Quantity } from '../../domain/shared/quantity.ts'
import type {
  BrokerPlacementCapability,
  CancellationRequest,
  CancellationResult,
  FillCollectionRequest,
  FillCollectionResult,
  OrderStatusRequest,
  OrderStatusResult,
  PlacementRequest,
  PlacementResult,
  ReconciliationSnapshotRequest,
  ReconciliationSnapshotResponse,
} from '../../ports/execution/broker-port.ts'
import type {
  DeterministicSeedPort,
  ExecutionClockPort,
} from '../../ports/execution/runtime-port.ts'

export type PaperAccountSeed = Readonly<{
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  cash: Money
  holdings?: readonly ReconciledHolding[]
}>

export type PaperFillDecision =
  | Readonly<{ kind: 'FILL_FULL' }>
  | Readonly<{ kind: 'LEAVE_OPEN' }>
  | Readonly<{ kind: 'REJECT' }>

export interface PaperFillPolicy {
  decide(
    intent: OrderIntentPayload,
    seed: DeterministicSeedPort,
  ): PaperFillDecision
}

export class ImmediatePaperFillPolicy implements PaperFillPolicy {
  public decide(): PaperFillDecision {
    return Object.freeze({ kind: 'FILL_FULL' })
  }
}

type MutableHolding = {
  quantity: bigint
  available: bigint
  reserved: bigint
  averageCostMinorUnits?: bigint
  mappingHash: IntegrityHash
}

type PaperAccount = {
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  cashMinorUnits: bigint
  holdings: Map<InstrumentId, MutableHolding>
  fills: NormalizedFill[]
}

type PaperOrder = {
  intent: OrderIntentPayload
  reference: NonNullable<PlacementResult['brokerReference']>
  status: BrokerOrderSnapshot['status']
  filledQuantity: Quantity
  averageFillPrice?: Money
  asOf: ReturnType<ExecutionClockPort['now']>
  reservedCashMinorUnits?: bigint
  reservedDeliveryQuantity?: bigint
}

function brokerFailure(field: string): DomainResult<never> {
  return failure(domainFailure('BROKER_NORMALIZATION_UNSAFE', {
    field,
    retryability: 'NEVER',
  }))
}

function mustMoney(minorUnits: bigint): Money {
  const result = createMoney(minorUnits)
  if (!result.ok) throw new Error('INVALID_PAPER_MONEY')
  return result.value
}

function mustQuantity(shares: bigint): Quantity {
  const result = createQuantity(shares)
  if (!result.ok) throw new Error('INVALID_PAPER_QUANTITY')
  return result.value
}

function accountKey(
  portfolioId: PortfolioId,
  accountBindingId: BrokerAccountBindingId,
): string {
  return `${portfolioId}\0${accountBindingId}`
}

function deadlineValid(now: string, deadlineAt: string): boolean {
  return Date.parse(deadlineAt) >= Date.parse(now)
}

export class DeterministicPaperBroker implements BrokerPlacementCapability {
  private readonly clock: ExecutionClockPort
  private readonly seed: DeterministicSeedPort
  private readonly fillPolicy: PaperFillPolicy
  private readonly accounts = new Map<string, PaperAccount>()
  private readonly orders = new Map<string, PaperOrder>()
  private readonly placementResults = new Map<string, PlacementResult>()
  private readonly cancellationResults = new Map<string, CancellationResult>()

  public constructor(
    clock: ExecutionClockPort,
    seed: DeterministicSeedPort,
    accounts: readonly PaperAccountSeed[],
    fillPolicy: PaperFillPolicy = new ImmediatePaperFillPolicy(),
  ) {
    this.clock = clock
    this.seed = seed
    this.fillPolicy = fillPolicy
    for (const account of accounts) {
      const key = accountKey(account.portfolioId, account.accountBindingId)
      if (this.accounts.has(key)) throw new TypeError('DUPLICATE_PAPER_ACCOUNT')
      const holdings = new Map<InstrumentId, MutableHolding>()
      for (const holding of account.holdings ?? []) {
        holdings.set(holding.instrumentId, {
          quantity: holding.totalQuantity.shares,
          available: holding.availableDeliveryQuantity.shares,
          reserved: holding.reservedQuantity.shares,
          ...(holding.averageCost !== undefined
            ? { averageCostMinorUnits: holding.averageCost.minorUnits }
            : {}),
          mappingHash: holding.mappingHash,
        })
      }
      this.accounts.set(key, {
        portfolioId: account.portfolioId,
        accountBindingId: account.accountBindingId,
        cashMinorUnits: account.cash.minorUnits,
        holdings,
        fills: [],
      })
    }
  }

  private account(
    portfolioId: PortfolioId,
    accountBindingId: BrokerAccountBindingId,
  ): PaperAccount | undefined {
    return this.accounts.get(accountKey(portfolioId, accountBindingId))
  }

  public async placeOrder(
    request: PlacementRequest,
  ): Promise<DomainResult<PlacementResult>> {
    const cached = this.placementResults.get(request.submissionAttemptId)
    if (cached !== undefined) return success(cached)
    const now = this.clock.now()
    if (!deadlineValid(now, request.deadlineAt)) return brokerFailure('deadlineAt')
    if (
      request.intent.orderId !== request.orderId
      || request.intent.portfolioId !== request.portfolioId
      || request.intent.mapping.brokerAccountBindingId !== request.accountBindingId
      || request.intent.product !== 'CNC'
    ) {
      return brokerFailure('placementRequest')
    }
    const account = this.account(request.portfolioId, request.accountBindingId)
    if (account === undefined) return brokerFailure('accountBindingId')

    const existing = this.orders.get(request.orderId)
    if (existing !== undefined) {
      const replay = Object.freeze({
        submissionAttemptId: request.submissionAttemptId,
        certainty: 'ACKNOWLEDGED' as const,
        brokerReference: existing.reference,
        attemptedAt: now,
        completedAt: now,
      })
      this.placementResults.set(request.submissionAttemptId, replay)
      return success(replay)
    }

    const brokerReferenceId = parseBrokerOrderReferenceId(
      `paper-order:${request.orderId}`,
    )
    if (!brokerReferenceId.ok) return brokerFailure('brokerOrderReferenceId')
    const reference = Object.freeze({
      brokerOrderReferenceId: brokerReferenceId.value,
      brokerOrderId: `paper:${request.orderId}`,
      accountBindingId: request.accountBindingId,
      acknowledgedAt: now,
    })
    const decision = this.fillPolicy.decide(request.intent, this.seed)
    if (decision.kind === 'REJECT') {
      const rejected = Object.freeze({
        submissionAttemptId: request.submissionAttemptId,
        certainty: 'REJECTED' as const,
        attemptedAt: now,
        completedAt: now,
        failure: Object.freeze({
          failureCode: 'ORDER_REJECTED' as const,
          certainty: 'REJECTED' as const,
          redactedDetail: 'PAPER_POLICY_REJECTED',
        }),
      })
      this.placementResults.set(request.submissionAttemptId, rejected)
      return success(rejected)
    }

    const order: PaperOrder = {
      intent: request.intent,
      reference,
      status: decision.kind === 'FILL_FULL' ? 'FILLED' : 'OPEN',
      filledQuantity: mustQuantity(0n),
      asOf: now,
    }
    if (decision.kind === 'FILL_FULL') {
      const applied = this.applyFullFill(account, order, now)
      if (!applied.ok) {
        const rejected = Object.freeze({
          submissionAttemptId: request.submissionAttemptId,
          certainty: 'REJECTED' as const,
          attemptedAt: now,
          completedAt: now,
          failure: Object.freeze({
            failureCode: applied.error.code,
            certainty: 'REJECTED' as const,
            redactedDetail: 'PAPER_ACCOUNT_REJECTED',
          }),
        })
        this.placementResults.set(request.submissionAttemptId, rejected)
        return success(rejected)
      }
    } else {
      const reserved = this.reserveOpenOrder(account, order)
      if (!reserved.ok) {
        const rejected = Object.freeze({
          submissionAttemptId: request.submissionAttemptId,
          certainty: 'REJECTED' as const,
          attemptedAt: now,
          completedAt: now,
          failure: Object.freeze({
            failureCode: reserved.error.code,
            certainty: 'REJECTED' as const,
            redactedDetail: 'PAPER_ACCOUNT_REJECTED',
          }),
        })
        this.placementResults.set(request.submissionAttemptId, rejected)
        return success(rejected)
      }
    }
    this.orders.set(request.orderId, order)
    const result = Object.freeze({
      submissionAttemptId: request.submissionAttemptId,
      certainty: 'ACKNOWLEDGED' as const,
      brokerReference: reference,
      attemptedAt: now,
      completedAt: now,
    })
    this.placementResults.set(request.submissionAttemptId, result)
    return success(result)
  }

  private applyFullFill(
    account: PaperAccount,
    order: PaperOrder,
    tradeTime: ReturnType<ExecutionClockPort['now']>,
  ): DomainResult<void> {
    const intent = order.intent
    const notional = intent.quantity.shares * intent.limitPrice.minorUnits
    const holding = account.holdings.get(intent.instrumentId)
    if (intent.side === 'BUY' && account.cashMinorUnits < notional) {
      return failure(domainFailure('BUY_AFFORDABILITY_FAILED', {
        retryability: 'NEVER',
      }))
    }
    if (
      intent.side === 'SELL'
      && (holding === undefined || holding.available < intent.quantity.shares)
    ) {
      return failure(domainFailure('SELL_DELIVERY_EXCEEDED', {
        retryability: 'NEVER',
      }))
    }
    const fillId = parseFillId(`paper-fill:${intent.orderId}:1`)
    if (!fillId.ok) return brokerFailure('fillId')
    const contentHash = hashExecutionValue('paper-fill', {
      fillId: fillId.value,
      orderId: intent.orderId,
      quantityShares: intent.quantity.shares.toString(10),
      priceMinorUnits: intent.limitPrice.minorUnits.toString(10),
      tradeTime,
    })
    if (!contentHash.ok) return contentHash
    const fill: NormalizedFill = Object.freeze({
      fillId: fillId.value,
      portfolioId: intent.portfolioId,
      orderId: intent.orderId,
      executionRunId: intent.executionRunId,
      instrumentId: intent.instrumentId,
      side: intent.side,
      product: 'CNC',
      quantity: intent.quantity,
      price: intent.limitPrice,
      charges: mustMoney(0n),
      tradeTime,
      brokerFillId: `paper-trade:${intent.orderId}:1`,
      contentHash: contentHash.value,
    })
    if (intent.side === 'BUY') {
      account.cashMinorUnits -= notional
      const current = holding ?? {
        quantity: 0n,
        available: 0n,
        reserved: 0n,
        mappingHash: intent.mapping.snapshotHash,
      }
      const priorCost = (current.averageCostMinorUnits ?? 0n) * current.quantity
      current.quantity += intent.quantity.shares
      current.available += intent.quantity.shares
      current.averageCostMinorUnits =
        (priorCost + notional) / current.quantity
      current.mappingHash = intent.mapping.snapshotHash
      account.holdings.set(intent.instrumentId, current)
    } else {
      account.cashMinorUnits += notional
      if (holding === undefined) return brokerFailure('holding')
      holding.quantity -= intent.quantity.shares
      holding.available -= intent.quantity.shares
      if (holding.quantity === 0n) account.holdings.delete(intent.instrumentId)
    }
    account.fills.push(fill)
    order.filledQuantity = intent.quantity
    order.averageFillPrice = intent.limitPrice
    order.status = 'FILLED'
    order.asOf = tradeTime
    return success(undefined)
  }

  private reserveOpenOrder(
    account: PaperAccount,
    order: PaperOrder,
  ): DomainResult<void> {
    const intent = order.intent
    if (intent.side === 'BUY') {
      const notional = intent.quantity.shares * intent.limitPrice.minorUnits
      if (account.cashMinorUnits < notional) {
        return failure(domainFailure('BUY_AFFORDABILITY_FAILED', {
          retryability: 'NEVER',
        }))
      }
      account.cashMinorUnits -= notional
      order.reservedCashMinorUnits = notional
      return success(undefined)
    }
    const holding = account.holdings.get(intent.instrumentId)
    if (holding === undefined || holding.available < intent.quantity.shares) {
      return failure(domainFailure('SELL_DELIVERY_EXCEEDED', {
        retryability: 'NEVER',
      }))
    }
    holding.available -= intent.quantity.shares
    holding.reserved += intent.quantity.shares
    order.reservedDeliveryQuantity = intent.quantity.shares
    return success(undefined)
  }

  private releaseOpenReservation(
    account: PaperAccount,
    order: PaperOrder,
  ): DomainResult<void> {
    if (order.reservedCashMinorUnits !== undefined) {
      account.cashMinorUnits += order.reservedCashMinorUnits
      delete order.reservedCashMinorUnits
    }
    if (order.reservedDeliveryQuantity !== undefined) {
      const holding = account.holdings.get(order.intent.instrumentId)
      if (holding === undefined || holding.reserved < order.reservedDeliveryQuantity) {
        return brokerFailure('reservationHolding')
      }
      holding.available += order.reservedDeliveryQuantity
      holding.reserved -= order.reservedDeliveryQuantity
      delete order.reservedDeliveryQuantity
    }
    return success(undefined)
  }

  public async cancelOrder(
    request: CancellationRequest,
  ): Promise<DomainResult<CancellationResult>> {
    const cached = this.cancellationResults.get(request.cancellationId)
    if (cached !== undefined) return success(cached)
    const now = this.clock.now()
    if (!deadlineValid(now, request.deadlineAt)) return brokerFailure('deadlineAt')
    const order = this.orders.get(request.orderId)
    if (
      order === undefined
      || order.intent.portfolioId !== request.portfolioId
      || order.reference.accountBindingId !== request.accountBindingId
      || order.reference.brokerOrderReferenceId !== request.brokerOrderReferenceId
    ) {
      return brokerFailure('cancellationRequest')
    }
    const outcome = order.status === 'OPEN' ? 'ACKNOWLEDGED' : 'REJECTED'
    if (outcome === 'ACKNOWLEDGED') {
      const account = this.account(request.portfolioId, request.accountBindingId)
      if (account === undefined) return brokerFailure('accountBindingId')
      const released = this.releaseOpenReservation(account, order)
      if (!released.ok) return released
      order.status = 'CANCELLED'
      order.asOf = now
    }
    const result = Object.freeze({
      cancellationId: request.cancellationId,
      outcome,
      brokerAsOf: now,
      completedAt: now,
      ...(outcome === 'REJECTED'
        ? {
            failure: Object.freeze({
              failureCode: 'ORDER_REJECTED' as const,
              certainty: 'REJECTED' as const,
              redactedDetail: 'PAPER_ORDER_NOT_CANCELLABLE',
            }),
          }
        : {}),
    })
    this.cancellationResults.set(request.cancellationId, result)
    return success(result)
  }

  public async fetchOrderStatus(
    request: OrderStatusRequest,
  ): Promise<DomainResult<OrderStatusResult>> {
    const now = this.clock.now()
    if (!deadlineValid(now, request.deadlineAt)) return brokerFailure('deadlineAt')
    const order = this.orders.get(request.orderId)
    if (
      order === undefined
      || order.intent.portfolioId !== request.portfolioId
      || order.reference.accountBindingId !== request.accountBindingId
      || order.reference.brokerOrderReferenceId !== request.brokerOrderReferenceId
    ) {
      return brokerFailure('orderStatusRequest')
    }
    const ordered = order.intent.quantity
    const open = mustQuantity(
      order.status === 'CANCELLED'
        || order.status === 'REJECTED'
        || order.status === 'EXPIRED'
        || order.status === 'FILLED'
        ? 0n
        : ordered.shares - order.filledQuantity.shares,
    )
    const cursor = accountKey(request.portfolioId, request.accountBindingId)
    const snapshot: BrokerOrderSnapshot = Object.freeze({
      brokerReference: order.reference,
      status: order.status,
      orderedQuantity: ordered,
      filledQuantity: order.filledQuantity,
      openQuantity: open,
      ...(order.averageFillPrice !== undefined
        ? { averageFillPrice: order.averageFillPrice }
        : {}),
      asOf: order.asOf,
      cursor,
    })
    return success(Object.freeze({
      orderId: request.orderId,
      snapshot,
      asOf: order.asOf,
      cursor,
    }))
  }

  public async collectFills(
    request: FillCollectionRequest,
  ): Promise<DomainResult<FillCollectionResult>> {
    const now = this.clock.now()
    if (!deadlineValid(now, request.deadlineAt)) return brokerFailure('deadlineAt')
    const account = this.account(request.portfolioId, request.accountBindingId)
    if (account === undefined) return brokerFailure('accountBindingId')
    const offset = request.fromCursor === undefined ? 0 : Number(request.fromCursor)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > account.fills.length) {
      return brokerFailure('fromCursor')
    }
    return success(Object.freeze({
      fills: Object.freeze(account.fills.slice(offset)),
      nextCursor: String(account.fills.length),
      asOf: now,
      coherent: true,
    }))
  }

  public async collectReconciliationSnapshot(
    request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>> {
    const now = this.clock.now()
    if (!deadlineValid(now, request.deadlineAt)) return brokerFailure('deadlineAt')
    const account = this.account(request.portfolioId, request.accountBindingId)
    if (account === undefined) return brokerFailure('accountBindingId')
    const holdings: ReconciledHolding[] = [...account.holdings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([instrumentId, holding]) => Object.freeze({
        instrumentId,
        totalQuantity: mustQuantity(holding.quantity),
        availableDeliveryQuantity: mustQuantity(holding.available),
        reservedQuantity: mustQuantity(holding.reserved),
        ...(holding.averageCostMinorUnits !== undefined
          ? { averageCost: mustMoney(holding.averageCostMinorUnits) }
          : {}),
        mappingHash: holding.mappingHash,
      }))
    const openOrders: BrokerOrderSnapshot[] = []
    for (const order of this.orders.values()) {
      if (
        order.intent.portfolioId !== request.portfolioId
        || order.reference.accountBindingId !== request.accountBindingId
        || order.status === 'FILLED'
        || order.status === 'REJECTED'
        || order.status === 'EXPIRED'
      ) {
        continue
      }
      openOrders.push(Object.freeze({
        brokerReference: order.reference,
        status: order.status,
        orderedQuantity: order.intent.quantity,
        filledQuantity: order.filledQuantity,
        openQuantity: mustQuantity(order.status === 'CANCELLED'
          ? 0n
          : order.intent.quantity.shares - order.filledQuantity.shares),
        ...(order.averageFillPrice !== undefined
          ? { averageFillPrice: order.averageFillPrice }
          : {}),
        asOf: order.asOf,
      }))
    }
    openOrders.sort((left, right) =>
      left.brokerReference.brokerOrderReferenceId.localeCompare(
        right.brokerReference.brokerOrderReferenceId,
      ))
    const contentHash = hashExecutionValue('paper-reconciliation', {
      portfolioId: request.portfolioId,
      cashMinorUnits: account.cashMinorUnits.toString(10),
      holdings,
      openOrders,
      fills: account.fills,
      capturedAt: now,
      mappingSnapshotHash: request.mappingSnapshotHash,
    })
    if (!contentHash.ok) return contentHash
    const snapshot: ReconciliationSnapshotRecord = Object.freeze({
      snapshotId: request.snapshotId,
      source: 'PAPER',
      portfolioId: request.portfolioId,
      accountBindingId: request.accountBindingId,
      cash: mustMoney(account.cashMinorUnits),
      holdings: Object.freeze(holdings),
      openOrders: Object.freeze(openOrders),
      fills: Object.freeze([...account.fills]),
      endpointTimes: Object.freeze({
        cash: now,
        fills: now,
        holdings: now,
        orders: now,
      }),
      cursor: String(account.fills.length),
      capturedAt: now,
      contentHash: contentHash.value,
    })
    return success(Object.freeze({ snapshot, coherent: true }))
  }
}
