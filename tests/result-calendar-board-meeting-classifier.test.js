const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isEarningsResultBoardMeeting,
  classifyBoardMeetingResultType,
} = require('../server/result-calendar');

test('board meeting classifier identifies financial-result meetings', () => {
  const item = {
    bm_purpose: 'Financial Results',
    bm_desc: 'To consider and approve unaudited financial results for the quarter ended June 30, 2026',
  };
  assert.equal(isEarningsResultBoardMeeting(item), true);
  assert.equal(classifyBoardMeetingResultType(item), 'Financial Results');
});

test('board meeting classifier labels non-result board items explicitly', () => {
  assert.equal(isEarningsResultBoardMeeting({ bm_desc: 'To consider declaration of interim dividend' }), false);
  assert.equal(classifyBoardMeetingResultType({ bm_desc: 'To consider declaration of interim dividend' }), 'Interim Dividend');
  assert.equal(classifyBoardMeetingResultType({ bm_desc: 'Proposal for raising of funds by issue of securities' }), 'Fund Raising');
  assert.equal(classifyBoardMeetingResultType({ bm_desc: 'To consider bonus issue of equity shares' }), 'Bonus Issue');
});

test('board meeting classifier rejects generic unclassified board meetings', () => {
  const item = { bm_desc: 'Board meeting to review general business operations' };
  assert.equal(isEarningsResultBoardMeeting(item), false);
  assert.equal(classifyBoardMeetingResultType(item), null);
});
