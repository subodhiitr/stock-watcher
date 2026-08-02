#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function parseArgs(argv) {
  const result = { baseUrl:'http://localhost:3001', date:'', timeoutMs:60000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--date') result.date = String(argv[++index] || '');
    else if (argv[index] === '--base-url') result.baseUrl = String(argv[++index] || '').replace(/\/+$/, '');
    else if (argv[index] === '--timeout-ms') result.timeoutMs = Number(argv[++index]) || result.timeoutMs;
  }
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('Usage: run-advisor.js --date YYYY-MM-DD [--base-url http://localhost:3001]');
  }
  await requestJson(`${args.baseUrl}/strategy-advisor/prepare?date=${encodeURIComponent(args.date)}`, {
    method:'POST',
    headers:{ Accept:'application/json' },
  });
  const deadline = Date.now() + args.timeoutMs;
  let lastPhase = '';
  while (Date.now() < deadline) {
    const payload = await requestJson(`${args.baseUrl}/strategy-advisor?date=${encodeURIComponent(args.date)}`);
    const state = payload.state || {};
    if (state.phase && state.phase !== lastPhase) {
      process.stderr.write(`[${state.progress || 0}%] ${state.phase}\n`);
      lastPhase = state.phase;
    }
    if (state.status === 'error') throw new Error(state.error || 'Evidence preparation failed');
    if (payload.evidence?.path && fs.existsSync(payload.evidence.path) && state.status === 'prepared') {
      process.stdout.write(`${payload.evidence.path}\n`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`Evidence preparation timed out after ${args.timeoutMs}ms`);
}

main().catch(error => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
