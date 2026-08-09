import {
  allLiveGatesPass,
  type ExecutionMode,
  type LiveEnablementSnapshot,
} from '../../domain/execution/contracts.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { BrokerPlacementCapability } from '../../ports/execution/broker-port.ts'
import type { DryRunBroker } from '../../adapters/broker/dry-run-broker.ts'

declare const liveAuthorityBrand: unique symbol

export type LiveBrokerAuthority = Readonly<{
  [liveAuthorityBrand]: true
}>

export type CertifiedLiveBroker = BrokerPlacementCapability & Readonly<{
  certified: true
  broker: 'ZERODHA' | 'SHAREKHAN'
}>

export type TrustedBrokerComposition = Readonly<{
  paperBroker: BrokerPlacementCapability
  dryRunBroker: DryRunBroker
  fakeTestBroker?: BrokerPlacementCapability
  liveBroker?: CertifiedLiveBroker
  liveAuthority?: LiveBrokerAuthority
  liveEnablement?: LiveEnablementSnapshot
}>

export type TrustedBrokerSelection =
  | Readonly<{
      kind: 'PLACEMENT'
      mode: 'PAPER' | 'FAKE_TEST'
      broker: BrokerPlacementCapability
    }>
  | Readonly<{
      kind: 'DRY_RUN'
      mode: 'DRY_RUN'
      broker: DryRunBroker
    }>
  | Readonly<{
      kind: 'LIVE_PLACEMENT'
      mode: 'LIVE_ZERODHA' | 'LIVE_SHAREKHAN'
      broker: CertifiedLiveBroker
    }>

export function composeTrustedExecutionBroker(
  mode: ExecutionMode,
  composition: TrustedBrokerComposition,
): DomainResult<TrustedBrokerSelection> {
  switch (mode) {
    case 'PAPER':
      return success(Object.freeze({
        kind: 'PLACEMENT',
        mode,
        broker: composition.paperBroker,
      }))
    case 'DRY_RUN':
      return success(Object.freeze({
        kind: 'DRY_RUN',
        mode,
        broker: composition.dryRunBroker,
      }))
    case 'FAKE_TEST':
      return composition.fakeTestBroker === undefined
        ? failure(domainFailure('BROKER_SELECTION_UNAUTHORIZED', {
            retryability: 'NEVER',
          }))
        : success(Object.freeze({
            kind: 'PLACEMENT',
            mode,
            broker: composition.fakeTestBroker,
          }))
    case 'LIVE_ZERODHA':
    case 'LIVE_SHAREKHAN': {
      const expectedBroker = mode === 'LIVE_ZERODHA' ? 'ZERODHA' : 'SHAREKHAN'
      if (
        composition.liveAuthority === undefined
        || composition.liveBroker === undefined
        || composition.liveBroker.certified !== true
        || composition.liveBroker.broker !== expectedBroker
        || composition.liveEnablement === undefined
        || !allLiveGatesPass(composition.liveEnablement)
      ) {
        return failure(domainFailure('LIVE_EXECUTION_DISABLED', {
          retryability: 'NEVER',
        }))
      }
      return success(Object.freeze({
        kind: 'LIVE_PLACEMENT',
        mode,
        broker: composition.liveBroker,
      }))
    }
  }
}
