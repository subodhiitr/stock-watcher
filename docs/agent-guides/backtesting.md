# Backtesting and strategy research

## Responsibility

This area replays historical snapshots, runs strategy experiments, analyzes entry and exit behavior, and produces strategy-advisor evidence without changing live runtime state.

## Module map

- `backtest_simulation.js` is the replay engine and CLI-facing orchestration layer.
- `backtest/analysis/` contains focused analysis scripts.
- `run_backtest_experiments.js` runs experiment batches.
- `strategy_versions/` stores frozen strategy definitions used for reproducible comparisons.
- `skills/strategy-advisor/` contains advisor scripts and result validation.
- `reports/`, `cache/`, and `snapshots/` are generated or persisted data surfaces; do not overwrite them casually.

## Reproducibility rules

- Keep frozen strategy inputs and snapshot selection explicit.
- Reuse simulation engine rules rather than creating a second implementation for backtests.
- Preserve audit fingerprints, recorded decisions, and evidence schemas.
- Treat generated reports and caches as outputs, not source configuration.
- Separate analysis-only scripts from code used by the live proxy.

## Validation

Use the focused backtest CLI and recorded-decision tests for replay changes. Compare output shape and deterministic selection, not just process exit status.
