import test from 'node:test'

import fc from 'fast-check'

import { executionCommandsArbitrary, runModel } from './support/model-commands.ts'

test('model: bounded execution command sequences preserve order, recovery, and kill-switch invariants', () => {
  fc.assert(fc.property(executionCommandsArbitrary, (commands) => {
    runModel(commands)
  }), {
    numRuns: 100,
    seed: 50_505,
  })
})
