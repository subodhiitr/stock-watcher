import type { OptimizerPort, OptimizerRequest } from '../../ports/rebalancing/optimizer-port.ts';
export declare class GreedyBaselineOptimizerAdapter implements OptimizerPort {
    optimize(request: OptimizerRequest): Promise<ReturnType<OptimizerPort['optimize']> extends Promise<infer T> ? T : never>;
}
