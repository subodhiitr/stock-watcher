# Backtest Analysis

One-off analysis and debugging scripts for backtesting parameter optimization and strategy research.

## Scripts

- `analysis/analyze_entry_score.js` - Test impact of increasing minimum entry score threshold
- `analysis/analyze_fade_threshold.js` - Analyze fade/short signal thresholds  
- `analysis/analyze_pnl_impact.js` - Calculate P&L impact of various trade parameters
- `analysis/analyze_screenshot_data.js` - Parse and analyze trade screenshot data
- `analysis/analyze_screenshot_exits.js` - Analyze exit patterns from screenshot data

## Usage

```bash
node backtest/analysis/analyze_entry_score.js
node backtest/analysis/analyze_fade_threshold.js
# etc.
```

These are development tools for strategy parameter tuning and backtesting analysis.
