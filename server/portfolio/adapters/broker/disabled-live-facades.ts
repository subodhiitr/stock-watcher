import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, type DomainResult } from '../../domain/errors/result.ts'
import {
  parseBrokerOrderReferenceId,
} from '../../domain/shared/identifiers.ts'
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

export type ReviewedLivePlacement = Readonly<{
  status: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN'
  brokerOrderId?: string
  attemptedAt: PlacementResult['attemptedAt']
  completedAt: PlacementResult['completedAt']
}>

function normalizeReviewedPlacement(
  broker: 'zerodha' | 'sharekhan',
  request: PlacementRequest,
  response: ReviewedLivePlacement,
): DomainResult<PlacementResult> {
  if (response.status === 'ACCEPTED') {
    if (
      response.brokerOrderId === undefined
      || response.brokerOrderId.length === 0
      || response.brokerOrderId.length > 80
    ) {
      return failure(domainFailure('BROKER_NORMALIZATION_UNSAFE', {
        field: 'brokerOrderId',
        retryability: 'NEVER',
      }))
    }
    const referenceId = parseBrokerOrderReferenceId(
      `${broker}-order:${response.brokerOrderId}`,
    )
    if (!referenceId.ok) return referenceId
    return {
      ok: true,
      value: Object.freeze({
        submissionAttemptId: request.submissionAttemptId,
        certainty: 'ACKNOWLEDGED',
        brokerReference: Object.freeze({
          brokerOrderReferenceId: referenceId.value,
          brokerOrderId: response.brokerOrderId,
          accountBindingId: request.accountBindingId,
          acknowledgedAt: response.completedAt,
        }),
        attemptedAt: response.attemptedAt,
        completedAt: response.completedAt,
      }),
    }
  }
  const certainty = response.status === 'REJECTED' ? 'REJECTED' : 'UNKNOWN'
  return {
    ok: true,
    value: Object.freeze({
      submissionAttemptId: request.submissionAttemptId,
      certainty,
      attemptedAt: response.attemptedAt,
      completedAt: response.completedAt,
      failure: Object.freeze({
        failureCode: response.status === 'REJECTED'
          ? 'ORDER_REJECTED'
          : 'SUBMISSION_OUTCOME_UNKNOWN',
        certainty,
        redactedDetail: response.status === 'REJECTED'
          ? 'BROKER_REJECTED'
          : 'BROKER_OUTCOME_UNKNOWN',
      }),
    }),
  }
}

export function normalizeReviewedZerodhaPlacement(
  request: PlacementRequest,
  response: ReviewedLivePlacement,
): DomainResult<PlacementResult> {
  return normalizeReviewedPlacement('zerodha', request, response)
}

function disabled<T>(): DomainResult<T> {
  return failure(domainFailure('LIVE_ADAPTER_NOT_CERTIFIED', {
    retryability: 'NEVER',
  }))
}

abstract class DisabledLiveBrokerFacade implements BrokerPlacementCapability {
  public readonly certified = false as const

  public async placeOrder(
    _request: PlacementRequest,
  ): Promise<DomainResult<PlacementResult>> {
    return disabled()
  }

  public async cancelOrder(
    _request: CancellationRequest,
  ): Promise<DomainResult<CancellationResult>> {
    return disabled()
  }

  public async fetchOrderStatus(
    _request: OrderStatusRequest,
  ): Promise<DomainResult<OrderStatusResult>> {
    return disabled()
  }

  public async collectFills(
    _request: FillCollectionRequest,
  ): Promise<DomainResult<FillCollectionResult>> {
    return disabled()
  }

  public async collectReconciliationSnapshot(
    _request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>> {
    return disabled()
  }
}

export class DisabledZerodhaBrokerFacade extends DisabledLiveBrokerFacade {
  public readonly broker = 'ZERODHA' as const
}

export type SharekhanReviewedProduct =
  | 'DELIVERY'
  | 'INTRADAY'
  | 'UNKNOWN'

export function normalizeSharekhanDeliveryProduct(
  product: SharekhanReviewedProduct,
): DomainResult<'CNC'> {
  return product === 'DELIVERY'
    ? { ok: true, value: 'CNC' }
    : failure(domainFailure('SHAREKHAN_CNC_MAPPING_REQUIRED', {
        field: 'product',
        retryability: 'NEVER',
      }))
}

export function normalizeReviewedSharekhanPlacement(
  request: PlacementRequest,
  product: SharekhanReviewedProduct,
  response: ReviewedLivePlacement,
): DomainResult<PlacementResult> {
  const delivery = normalizeSharekhanDeliveryProduct(product)
  return delivery.ok
    ? normalizeReviewedPlacement('sharekhan', request, response)
    : delivery
}

export class DisabledSharekhanBrokerFacade extends DisabledLiveBrokerFacade {
  public readonly broker = 'SHAREKHAN' as const
}
