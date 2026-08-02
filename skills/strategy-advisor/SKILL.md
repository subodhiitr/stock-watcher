---
name: strategy-advisor
description: Analyze one trading date's simulation transactions, setup efficiency, exit quality, captured candidate snapshots, and detailed effective setup configuration with a bounded Codex investigation. Use when asked to review a simulation day, explain weak setup or exit behavior, recommend configuration improvements without replay, or propose a new simulation setup from recurring evidence.
---

# Strategy Advisor

Use Codex as the reasoning agent. The local server only reconciles analytics and writes evidence; it never calls an AI provider.

## Run a daily analysis

1. Confirm the requested date uses `YYYY-MM-DD`.
2. From the stock-watcher repository, run:

   `node skills/strategy-advisor/scripts/run-advisor.js --date YYYY-MM-DD`

3. If the local server is not at `http://localhost:3001`, add `--base-url URL`.
4. Read the evidence file printed by the script.
5. Investigate relationships among:
   - individual reconciled positions and exit legs;
   - setup efficiency and exit quality;
   - recurring snapshot states and settings fingerprints;
   - each used setup's enabled state and complete configuration;
   - shared entry, capacity, risk, cost, and exit controls.
6. Trace every proposed setting change to an existing setting record in `configuration`. Cite its current value, default, override source, description, and the observed evidence it could improve.
7. Do not run Replay, sweeps, backtests, or targeted trials. Label recommendations `analytics-reviewed`, never validated.
8. Write the result to `reports/strategy-advisor/strategy_advisor_result_YYYY-MM-DD.json`.
9. Validate it:

   `node skills/strategy-advisor/scripts/validate-result.js --file reports/strategy-advisor/strategy_advisor_result_YYYY-MM-DD.json`

10. Report:
   - the daily thesis and data limitations;
   - each recommendation's exact evidence, confidence, and risk;
   - whether it is `analytics-reviewed` or only a `hypothesis`;
   - exact setting keys and current/recommended values.
11. Never describe an analytics-only recommendation as validated.

## Safety boundary

- Never apply settings as part of analysis.
- Never run Replay, a backtest, a parameter sweep, autotuning, or a targeted settings trial.
- Reject setting keys absent from the effective settings catalog.
- Treat a single date as hypothesis-generating. Recommend cross-date confirmation before applying.
- Require explicit user approval before using an Apply endpoint or editing live settings.
- Set `agent.provider` to `codex-session`, `agent.replayUsed` to `false`, and `agent.sweepUsed` to `false`.

## Recommendation discipline

- Prefer setup-specific settings over global settings when evidence isolates one setup.
- Recommend an enable/disable change only with a sufficient transaction sample and corroborating snapshot behavior.
- Do not treat repeated snapshot rows as independent observations.
- Separate entry-quality, capacity, risk, cost, and exit hypotheses.
- Explain the expected mechanism and downside of every proposed value change.
- Preserve current settings when evidence is insufficient.

## New setup suggestions

Require observable entry evidence, invalidation, exit concept, sample count, and the snapshot pattern that motivated the idea. Label the result a research hypothesis until executable rules and multi-date tests exist.

For endpoint fields and validation meanings, read [references/api.md](references/api.md).
