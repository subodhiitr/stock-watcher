# Strategy Advisor API

Base URL defaults to `http://localhost:3001`.

- `POST /strategy-advisor/prepare?date=YYYY-MM-DD`: reconcile data and write the evidence file in the background.
- `GET /strategy-advisor?date=YYYY-MM-DD`: read evidence metadata and the saved Codex result.
- `GET /strategy-advisor/stream?date=YYYY-MM-DD`: receive evidence/result file updates.

Preparation statuses are `queued`, `running`, `prepared`, and `error`. Progress is `0` through `100`.

Recommendation validation:

- `analytics-reviewed`: supported by transactions, setup/exit analytics, snapshots, and configuration inspection, but not replay-tested.
- `hypothesis`: a possible new setup without executable rules.

Evidence configuration fields:

- `configuration.setups[]`: enable state, setup metadata, prefixes, transaction performance, snapshot activity, and all setup-specific setting records.
- `configuration.sharedConfiguration[]`: effective global controls not claimed by one setup.
- Each setting record includes `value`, `defaultValue`, `overridden`, `differsFromDefault`, `source`, `description`, and `valueType`.
- `transactions.positions[]` and `transactions.exits[]`: individual reconciled facts for the selected date.
- `snapshots.settingsFingerprints[]`: snapshot counts by settings fingerprint.

The result file must contain `status: "done"`, `agent.provider: "codex-session"`, `agent.replayUsed: false`, and `agent.sweepUsed: false`.
