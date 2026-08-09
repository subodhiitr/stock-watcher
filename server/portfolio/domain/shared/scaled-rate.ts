import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type ScaledRate = Readonly<{
  numerator: bigint
  scale: bigint
}>

export type ScaledRateJson = Readonly<{
  numerator: string
  scale: string
}>

export function createScaledRate(
  numerator: unknown,
  scale: unknown,
): DomainResult<ScaledRate> {
  if (typeof numerator !== 'bigint' || typeof scale !== 'bigint' || scale <= 0n) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', { field: 'scaledRate' }))
  }
  return success(Object.freeze({ numerator, scale }))
}

export function convertScaledRate(
  value: ScaledRate,
  targetScale: bigint,
): DomainResult<ScaledRate> {
  if (targetScale <= 0n) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', { field: 'targetScale' }))
  }
  const scaledNumerator = value.numerator * targetScale
  if (scaledNumerator % value.scale !== 0n) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', { field: 'targetScale' }))
  }
  return createScaledRate(scaledNumerator / value.scale, targetScale)
}

export function scaledRateEquals(left: ScaledRate, right: ScaledRate): boolean {
  return left.numerator * right.scale === right.numerator * left.scale
}

export function serializeScaledRate(value: ScaledRate): ScaledRateJson {
  return Object.freeze({
    numerator: value.numerator.toString(10),
    scale: value.scale.toString(10),
  })
}

export function parseScaledRate(value: unknown): DomainResult<ScaledRate> {
  if (typeof value !== 'object' || value === null) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', { field: 'scaledRate' }))
  }
  const candidate = value as { numerator?: unknown; scale?: unknown }
  if (
    typeof candidate.numerator !== 'string'
    || typeof candidate.scale !== 'string'
    || !/^-?(0|[1-9]\d*)$/.test(candidate.numerator)
    || !/^[1-9]\d*$/.test(candidate.scale)
  ) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', { field: 'scaledRate' }))
  }
  return createScaledRate(BigInt(candidate.numerator), BigInt(candidate.scale))
}
