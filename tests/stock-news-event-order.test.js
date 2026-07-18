const test = require('node:test');
const assert = require('node:assert/strict');
const proxy = require('../ticker_proxy');

test('stock events rank a newer result filing above an older detailed result', () => {
  const events = proxy.__test__.eventHighlightsForTests([
    { type:'Results', title:'Third Quarter result (Consolidated)', filingDate:'2026-01-09T10:00:00.000Z' },
    { type:'Dividend', title:'Interim Dividend', exDate:'2026-07-15T00:00:00.000Z' },
    { type:'Result Filing', title:'Financial results for period ended Jun 30, 2026', publishedAt:'2026-07-09T10:22:21.000Z' },
  ]);

  assert.equal(events[0].type, 'Result Filing');
  assert.equal(events[1].type, 'Dividend');
  assert.equal(events.some(item => item.title === 'Third Quarter result (Consolidated)'), false);
});

test('stock events keep the newest result first and order remaining disclosures by time', () => {
  const events = proxy.__test__.sortEventsForTests([
    { type:'Results', title:'Older result', filingDate:'2026-01-09T10:00:00.000Z' },
    { type:'Announcement', title:'New contract', publishedAt:'2026-07-13T05:51:36.000Z' },
    { type:'Result Filing', title:'Latest result', publishedAt:'2026-07-09T10:22:21.000Z' },
  ]);

  assert.deepEqual(events.map(item => item.title), ['Latest result', 'Older result', 'New contract']);
});
