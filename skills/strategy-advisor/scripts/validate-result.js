#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const fileIndex = process.argv.indexOf('--file');
const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : '';
if (!file) {
  process.stderr.write('Usage: validate-result.js --file RESULT.json\n');
  process.exit(1);
}

const result = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(result.date || ''))) errors.push('date must use YYYY-MM-DD');
if (result.status !== 'done') errors.push('status must be done');
if (result.agent?.provider !== 'codex-session') errors.push('agent.provider must be codex-session');
if (result.agent?.replayUsed !== false) errors.push('agent.replayUsed must be false');
if (result.agent?.sweepUsed !== false) errors.push('agent.sweepUsed must be false');
if (!Array.isArray(result.recommendations)) errors.push('recommendations must be an array');
for (const [index, row] of (result.recommendations || []).entries()) {
  if (!['setting-change', 'new-setup'].includes(row.type)) errors.push(`recommendations[${index}].type is invalid`);
  if (!['low', 'medium', 'high'].includes(row.confidence)) errors.push(`recommendations[${index}].confidence is invalid`);
  if (!row.rationale || !Array.isArray(row.evidence) || !row.risk) errors.push(`recommendations[${index}] lacks evidence or risk`);
  if (!['analytics-reviewed', 'hypothesis'].includes(row.validation?.status)) errors.push(`recommendations[${index}].validation.status is invalid`);
}
if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Valid Strategy Advisor result: ${file}\n`);
