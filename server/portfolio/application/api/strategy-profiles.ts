import {
  LONG_HORIZON_PRESET,
  MEDIUM_HORIZON_PRESET,
  STRATEGIC_MEDIUM_HORIZON_PRESET,
  SHORT_HORIZON_PRESET,
  type PresetDescriptor,
} from '../../domain/strategy/strategy-presets.ts'

export type ApprovedStrategyProfile = Readonly<{
  strategyVersionId: string
  thesis: string
  decisionTiming: 'FINALIZED_EOD'
  executionTiming: 'LATER_SESSION_CNC'
  validationStatus: 'SEEDED_APPROVED_PRESET'
  config: PresetDescriptor['config']
  configHash: string
}>

const PROFILES: Readonly<Record<string, Readonly<{
  preset: PresetDescriptor
  thesis: string
}>>> = Object.freeze({
  'strategy-version:short-horizon-momentum:v1': Object.freeze({
    preset: SHORT_HORIZON_PRESET,
    thesis: 'Faster biweekly momentum and quality rotation with strict turnover and delivery-only constraints.',
  }),
  'strategy-version:adaptive-momentum-quality:v1': Object.freeze({
    preset: MEDIUM_HORIZON_PRESET,
    thesis: 'Monthly momentum-quality selection balanced by low-risk scoring, holding preferences, and after-cost discipline.',
  }),
  'strategy-version:adaptive-momentum-quality:v2-strategic': Object.freeze({
    preset: STRATEGIC_MEDIUM_HORIZON_PRESET,
    thesis: 'Monthly momentum-quality selection with paper-based strategic rebalancing that delays routine equity buys during confirmed negative stock-versus-gilt trends.',
  }),
  'strategy-version:long-horizon-quality:v1': Object.freeze({
    preset: LONG_HORIZON_PRESET,
    thesis: 'Quarterly quality-compounder allocation with lower turnover, longer preferred holds, and conservative concentration limits.',
  }),
})

export function approvedStrategyProfile(strategyVersionId: string): ApprovedStrategyProfile | undefined {
  const value = PROFILES[strategyVersionId]
  if (value === undefined) return undefined
  return Object.freeze({
    strategyVersionId,
    thesis: value.thesis,
    decisionTiming: 'FINALIZED_EOD',
    executionTiming: 'LATER_SESSION_CNC',
    validationStatus: 'SEEDED_APPROVED_PRESET',
    config: value.preset.config,
    configHash: value.preset.hash,
  })
}
