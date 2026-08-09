import { type ExecutionMode, type LiveEnablementSnapshot } from '../../domain/execution/contracts.ts';
import { type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerPlacementCapability } from '../../ports/execution/broker-port.ts';
import type { DryRunBroker } from '../../adapters/broker/dry-run-broker.ts';
declare const liveAuthorityBrand: unique symbol;
export type LiveBrokerAuthority = Readonly<{
    [liveAuthorityBrand]: true;
}>;
export type CertifiedLiveBroker = BrokerPlacementCapability & Readonly<{
    certified: true;
    broker: 'ZERODHA' | 'SHAREKHAN';
}>;
export type TrustedBrokerComposition = Readonly<{
    paperBroker: BrokerPlacementCapability;
    dryRunBroker: DryRunBroker;
    fakeTestBroker?: BrokerPlacementCapability;
    liveBroker?: CertifiedLiveBroker;
    liveAuthority?: LiveBrokerAuthority;
    liveEnablement?: LiveEnablementSnapshot;
}>;
export type TrustedBrokerSelection = Readonly<{
    kind: 'PLACEMENT';
    mode: 'PAPER' | 'FAKE_TEST';
    broker: BrokerPlacementCapability;
}> | Readonly<{
    kind: 'DRY_RUN';
    mode: 'DRY_RUN';
    broker: DryRunBroker;
}> | Readonly<{
    kind: 'LIVE_PLACEMENT';
    mode: 'LIVE_ZERODHA' | 'LIVE_SHAREKHAN';
    broker: CertifiedLiveBroker;
}>;
export declare function composeTrustedExecutionBroker(mode: ExecutionMode, composition: TrustedBrokerComposition): DomainResult<TrustedBrokerSelection>;
export {};
