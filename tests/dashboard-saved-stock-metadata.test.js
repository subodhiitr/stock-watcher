const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'dashboard-app.js'), 'utf8');
const loadSource = source.slice(source.indexOf('async function loadSavedStocks()'), source.indexOf('async function saveFavoriteETFs()'));
function harness(stocks, saved) {
  const state = { MIDCAP_STOCKS: stocks, activeSectors: new Set(), dataSource: null, sectorRenders: 0, tableRenders: 0,
    bootstrapArray: () => saved, saveSavedStocksToStorage() {},
    renderSectors() { state.sectorRenders++; }, renderTable() { state.tableRenders++; } };
  vm.createContext(state); vm.runInContext(source.slice(source.indexOf('function normalizeStockSector('), source.indexOf('function loadSavedStocksFromStorage()')) + loadSource, state); return state;
}
test('saved sector and cap replace cached and built-in metadata and repaint without new symbols', async () => {
  const stocks = [{sym:'TEST',name:'Test',sector:'Information Technology',cap:'mid'}, {sym:'CACHED',name:'Cached',sector:'ENERGY',cap:'custom',source:'saved'}];
  const s = harness(stocks, [{sym:'TEST',name:'Test',sector:'IT',cap:'small'}, {sym:'CACHED',name:'Cached',sector:'Energy',cap:'small'}]);
  s.activeSectors.add('Information Technology'); await s.loadSavedStocks();
  assert.equal(stocks[0].sector, 'IT'); assert.equal(stocks[0].cap, 'small'); assert.equal(stocks[1].sector,'Energy');
  assert.equal(stocks[0].source, undefined); assert.equal(stocks[1].source,'saved');
  assert.deepEqual([...s.activeSectors], ['IT']); assert.equal(s.sectorRenders,1); assert.equal(s.tableRenders,1);
});
test('legacy symbol-only entries preserve metadata and do not repaint unchanged stocks', async () => {
  const stock = {sym:'TEST',name:'Test',sector:'IT',cap:'large'};
  const s = harness([stock], ['TEST']); await s.loadSavedStocks();
  assert.deepEqual(stock,{sym:'TEST',name:'Test',sector:'IT',cap:'large'}); assert.equal(s.sectorRenders,0);
});
test('source aliases use the requested sector names and preserve unrelated sectors', () => {
  const s=harness([],[]);
  for (const [oldName,newName] of [['Information Technology','IT'],['Media, Entertainment & Publication','Media'],['Media, Entertainment & Publications','Media'],['Construction Materials','Construction'],['Automobile and Auto Components','Auto'],['Oil Gas & Consumable Fuels','Energy'],['Oil, Gas & Consumable Fuels','Energy'],['ENERGY','Energy'],['Fast Moving Consumer Goods','Consumer Goods'],['FMCG','FMCG']]) {
    assert.equal(s.normalizeStockSector(oldName),newName);
  }
});
test('long-form server metadata is normalized before replacing cached metadata', async () => {
  const stock={sym:'TEST',sector:'Information Technology',cap:'small'};
  const s=harness([stock],[{sym:'TEST',sector:'Information Technology',cap:'small'}]);
  await s.loadSavedStocks();assert.equal(stock.sector,'IT');assert.equal(s.sectorRenders,1);
});
