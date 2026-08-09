import test from 'node:test'
import fc from 'fast-check'

import {
  createModelRunState,
  portfolioCommandArbitraries,
} from './support/portfolio-model.ts'

test('PBT stateful portfolio model matches 250 command sequences of length 0 through 100', () => {
  fc.assert(
    fc.property(
      fc.commands([...portfolioCommandArbitraries], {
        maxCommands: 100,
        size: 'xlarge',
      }),
      (commands) => {
        fc.modelRun(createModelRunState, commands)
      },
    ),
    {
      numRuns: 250,
      endOnFailure: true,
    },
  )
})
