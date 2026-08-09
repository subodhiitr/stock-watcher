import { type DomainResult } from '../../domain/errors/result.ts';
import type { OptimizerPort, OptimizerRequest, OptimizerResponse } from '../../ports/rebalancing/optimizer-port.ts';
export declare class SmallProblemOracleOptimizerAdapter implements OptimizerPort {
    optimize(request: OptimizerRequest): Promise<DomainResult<OptimizerResponse>>;
}
