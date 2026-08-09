import fs from 'node:fs'
import path from 'node:path'

import { failure, success } from '../../domain/errors/result.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from './failures.ts'
import type { DatabaseOwnerMode } from './configuration.ts'

export type ValidatedDatabasePath = Readonly<{
  sqlitePath: string
  canonicalPath: string
  inMemory: boolean
}>

function canonicalize(input: string): string {
  const absolute = path.resolve(input)
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute)
  const parent = path.dirname(absolute)
  const canonicalParent = fs.existsSync(parent) ? fs.realpathSync.native(parent) : parent
  return path.join(canonicalParent, path.basename(absolute))
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
}

export function validateDatabasePath(
  databasePath: string,
  mode: DatabaseOwnerMode,
  protectedLegacyPaths: readonly string[],
): PersistenceResult<ValidatedDatabasePath> {
  if (databasePath === ':memory:') {
    if (mode !== 'TEMPORARY_TEST') {
      return failure(persistenceFailure('INVALID_DATABASE_PATH', { field: 'databasePath' }))
    }
    return success(Object.freeze({
      sqlitePath: databasePath,
      canonicalPath: databasePath,
      inMemory: true,
    }))
  }
  if (databasePath.trim() !== databasePath || databasePath.length === 0) {
    return failure(persistenceFailure('INVALID_DATABASE_PATH', { field: 'databasePath' }))
  }

  const canonicalPath = canonicalize(databasePath)
  const key = pathKey(canonicalPath)
  for (const protectedPath of protectedLegacyPaths) {
    if (key === pathKey(canonicalize(protectedPath))) {
      return failure(persistenceFailure('PROTECTED_DATABASE_PATH', {
        field: 'databasePath',
      }))
    }
  }
  return success(Object.freeze({
    sqlitePath: canonicalPath,
    canonicalPath,
    inMemory: false,
  }))
}

export function pathsEqual(left: string, right: string): boolean {
  return pathKey(canonicalize(left)) === pathKey(canonicalize(right))
}
