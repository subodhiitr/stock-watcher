export type SafeContextValue = string | number | boolean
export type SafeContext = Readonly<Record<string, SafeContextValue>>

const SAFE_KEY = /^[a-z][A-Za-z0-9]{0,63}$/
const MAX_STRING_LENGTH = 160
const MAX_ENTRIES = 12

export function createSafeContext(
  input: Readonly<Record<string, SafeContextValue | undefined>> = {},
): SafeContext {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, SafeContextValue] => entry[1] !== undefined,
  )

  if (entries.length > MAX_ENTRIES) {
    throw new TypeError('Safe context exceeds its bounded entry count')
  }

  const context: Record<string, SafeContextValue> = {}
  for (const [key, value] of entries) {
    if (!SAFE_KEY.test(key)) {
      throw new TypeError('Safe context contains an invalid field name')
    }
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      throw new TypeError('Safe context contains an oversized string')
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new TypeError('Safe context numbers must be safe integers')
    }
    context[key] = value
  }

  return Object.freeze(context)
}
