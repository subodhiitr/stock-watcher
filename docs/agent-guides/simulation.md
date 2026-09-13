# Simulation and trading rules

## Responsibility

This area implements paper-trading decisions: candidate eligibility, entry and exit intents, position management, fees, slippage, replay parity, and the server-authoritative simulation lifecycle.

## Module map

- `simulation_engine.js` contains the reusable scoring, confirmation, profitability, entry, exit, and trade-quality rules.
- `trade_rules.js` contains shared trading settings and rule definitions.
- `server/simulation-domain/index.js` adapts engine functions into a complete simulation cycle and applies exit intents to capacity counts.
- `server/simulation-runtime-store.js` persists `off`, `running`, and `settling` transitions with versioned state.
- `server/routes/simulation-runtime.js` exposes lifecycle controls and status.
- `backtest_simulation.js` replays recorded data using the same rule surface.

## Invariants

- Do not duplicate entry or exit logic in route handlers or UI code.
- Preserve server ownership of runtime state and transition validation.
- Keep `settling` semantics: new entries are blocked while exits may continue.
- Preserve deterministic inputs and audit snapshots used by replay and evidence tests.
- Changes to candidate ordering, fees, stop logic, or confirmation thresholds require replay and regression coverage.

## Exploration path

For a new behavior, start at `runSimulationDomainCycle`, then trace into the specific engine function and its settings helper. For lifecycle behavior, start at `transitionRuntimeState` and follow the route and scheduler callers.

## Validation

Use the focused simulation tests first, then `npm test` when shared engine behavior changes. For strategy or replay changes, also run the relevant backtest CLI tests.
