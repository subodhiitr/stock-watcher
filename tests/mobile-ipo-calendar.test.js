const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mobile-app.js', 'utf8');
function context() {
  const state = { bootstrap: {}, allStockSearch: '', allStockFilter: 'new-ipo', healthScores: {}, allStocks: [{symbol:'SUB'}, {symbol:'OLD'}], ipoCalendar: {listed:[{sym:'SUB', listingDate:'2026-09-01'}, {sym:'UNSUB', listingDate:'2026-09-01'}, {sym:'OLD', listingDate:'2025-01-01'}], upcoming:[{sym:'FUTURE', name:'<Future>', closeDate:'2026-09-10', price:'100'}, {name:'Closed',closeDate:'2026-01-01'}]} };
  const ctx = vm.createContext({state, todayKey:()=> '2026-09-06', Date:class extends Date {static now(){return Date.parse('2026-09-06');}}, withLiveQuote:r=>r, n:Number, escapeHTML:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(source.slice(source.indexOf('  function mobileIpoRows('),source.indexOf('  function renderAllStocks(')),ctx);
  return ctx;
}
test('New IPO intersects recent listings with subscribed stocks without expanding the universe',()=>{
 const ctx=context(); assert.deepEqual(Array.from(vm.runInContext('allStockRows().map(r=>r.symbol)',ctx)),['SUB']); assert.equal(ctx.state.allStocks.length,2);
});
test('Upcoming IPO uses separate searchable calendar rows without trade, chart or detail controls',()=>{
 const ctx=context(); ctx.state.allStockFilter='upcoming-ipo'; const rows=vm.runInContext('allStockRows()',ctx); assert.equal(rows.length,1);
 const html=vm.runInContext('renderUpcomingIpoCard(allStockRows()[0])',ctx); assert.match(html,/Not tradeable/); assert.match(html,/&lt;Future&gt;/); assert.doesNotMatch(html,/<button|data-all-trade|data-chart-symbol|data-detail-symbol/);
 ctx.state.allStockSearch='missing'; assert.equal(vm.runInContext('allStockRows().length',ctx),0); assert.equal(ctx.state.allStocks.length,2);
});
