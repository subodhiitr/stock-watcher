import { type StrategyConfig, type StrategyConfigHash } from './strategy-config.ts';
export type PresetDescriptor = Readonly<{
    strategyId: string;
    version: string;
    config: StrategyConfig;
    hash: StrategyConfigHash;
}>;
export declare const SHORT_HORIZON_PRESET: PresetDescriptor;
export declare const MEDIUM_HORIZON_PRESET: PresetDescriptor;
export declare const LONG_HORIZON_PRESET: PresetDescriptor;
export declare const STRATEGY_PRESETS: readonly PresetDescriptor[];
