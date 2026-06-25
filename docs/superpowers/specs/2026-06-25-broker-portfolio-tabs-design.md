# Broker Portfolio Modal Tabs + Combined Pill Design

## Objective
Update broker portfolio UX so users can see both brokers clearly without losing the quick summary:
- Broker portfolio modal has two broker tabs: **Zerodha** and **Sharekhan**
- Top broker pill shows **combined open positions** and **combined day P&L**
- Each position row explicitly indicates broker name

## Scope
### In scope
1. Modal tab UI for broker-specific views
2. Combined broker summary pill in top action bar
3. Broker-labeled position rows
4. Per-broker error/loading handling in modal and summary behavior
5. Regression tests for the new behavior

### Out of scope
1. Broker execution/routing logic changes
2. New backend endpoints unless required by existing fetch constraints
3. Changes to manual trade entry/exit workflows

## Current Baseline
1. UI currently tracks broker portfolio in a single state object (`brokerPortfolioState`) and renders one combined modal view at a time.
2. Modal/pill labels already support dynamic broker naming but not dual-broker side-by-side navigation.
3. Existing broker portfolio fetch flow can be reused and extended to load both brokers into separate frontend state entries.

## Proposed Design
## 1. UI Structure
1. Keep the existing **Broker Portfolio** modal container.
2. Add a tab bar in modal header/body:
   - `Zerodha`
   - `Sharekhan`
3. Active tab renders one broker’s portfolio cards and positions table.
4. Add a **Broker** column in the positions table so every row labels its source broker.

## 2. State Model
Use per-broker UI state and a derived aggregate:

```js
brokerPortfolioState = {
  activeTab: 'zerodha',
  zerodha: { loading, ok, data, error },
  sharekhan: { loading, ok, data, error }
}
```

Derived aggregate (for pill):
- `combinedOpenCount = sum(openCount for successful broker payloads)`
- `combinedDayPnl = sum(dayPnl for successful broker payloads)`

## 3. Data Flow
1. `refreshBrokerPortfolio()` fetches both broker snapshots and stores them independently.
2. Combined pill updates from derived aggregate after either fetch resolves.
3. Modal tab switch is local-state only (no additional network request).
4. If one broker fetch fails:
   - That tab shows error
   - The other tab still renders normally
   - Pill uses available broker data and tooltip indicates partial availability

## 4. Top Pill Behavior
1. Label uses a combined form, for example:
   - `Brokers Open 7 · Day +₹4,320`
2. Visual class (`live`, `warn`, `down`) remains based on combined value and data availability.
3. Tooltip includes broker-level breakdown and partial-failure note when applicable.

## 5. Modal Rendering Behavior
1. Tab-specific summary cards continue to show cash/day P&L/total P&L/open positions for selected broker.
2. Positions table includes:
   - Broker
   - Symbol
   - Side
   - Quantity
   - Avg
   - LTP
   - P&L
3. Empty state is tab-specific (`No open positions` for selected broker).

## Error Handling
1. Do not block full modal if one broker fails.
2. Preserve existing safe fallbacks (`--`, muted text) for missing numeric fields.
3. Keep errors explicit (no silent fallback masking both-broker failure).

## Testing Plan
1. Pill aggregates open count and day P&L across both brokers.
2. Modal shows two broker tabs and tab switching renders correct broker data.
3. Position rows show explicit broker column values.
4. Partial failure: one broker error still allows other tab + aggregate pill from available data.
5. Existing broker mode toggle and current broker-specific refresh flows remain compatible.

## Risks and Mitigations
1. **Risk:** Mixed payload shape differences by broker.
   - **Mitigation:** Use a small normalization layer before aggregation/rendering.
2. **Risk:** UI confusion if aggregate includes only one broker due to failure.
   - **Mitigation:** Pill tooltip explicitly states partial availability.

## Acceptance Criteria
1. Broker portfolio modal has **two tabs** (`Zerodha`, `Sharekhan`).
2. Top broker pill shows **combined open positions** and **combined day P&L**.
3. Each position row clearly shows its broker.
4. One broker failure does not hide the other broker’s data.
