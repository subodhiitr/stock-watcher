const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', 'sharekhan-credentials.js');

function loadWithHome(homeDir) {
  delete require.cache[require.resolve(MODULE_PATH)];
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const mod = require(MODULE_PATH);
  return {
    mod,
    restore() {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      delete require.cache[require.resolve(MODULE_PATH)];
    },
  };
}

test('Sharekhan login can load api key before access token exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharekhan-creds-'));
  const file = path.join(dir, '.sharekhan.properties');
  fs.writeFileSync(file, [
    'SHAREKHAN_API_KEY=file-api-key',
    'SHAREKHAN_CUSTOMER_ID=file-customer',
    'SHAREKHAN_SECRET_KEY=file-secret',
  ].join('\n'), 'utf8');
  const { mod, restore } = loadWithHome(dir);
  try {
    const creds = mod.loadSharekhanCredentials({ requireSession:false });
    assert.equal(creds.apiKey, 'file-api-key');
    assert.equal(creds.customerId, 'file-customer');
    assert.equal(creds.secretKey, 'file-secret');
    assert.equal(creds.accessToken, '');
  } finally {
    restore();
  }
});

test('Sharekhan credentials load Nifty Midcap 150 streaming code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharekhan-index-creds-'));
  fs.writeFileSync(path.join(dir, '.sharekhan.properties'), [
    'SHAREKHAN_API_KEY=file-api-key',
    'SHAREKHAN_CUSTOMER_ID=file-customer',
    'SHAREKHAN_MIDCAP150_SCRIP_CODE=26060',
  ].join('\n'), 'utf8');
  const { mod, restore } = loadWithHome(dir);
  try {
    const creds = mod.loadSharekhanCredentials({ requireSession:false });
    assert.equal(creds.midcap150ScripCode, '26060');
  } finally {
    restore();
  }
});

test('Sharekhan credentials load Smallcap 100 and Bank Nifty streaming codes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharekhan-extra-index-creds-'));
  fs.writeFileSync(path.join(dir, '.sharekhan.properties'), [
    'SHAREKHAN_API_KEY=file-api-key',
    'SHAREKHAN_CUSTOMER_ID=file-customer',
    'SHAREKHAN_SMALLCAP100_SCRIP_CODE=26055',
    'SHAREKHAN_BANKNIFTY_SCRIP_CODE=25',
  ].join('\n'), 'utf8');
  const { mod, restore } = loadWithHome(dir);
  try {
    const creds = mod.loadSharekhanCredentials({ requireSession:false });
    assert.equal(creds.smallcap100ScripCode, '26055');
    assert.equal(creds.bankNiftyScripCode, '25');
  } finally {
    restore();
  }
});

test('Sharekhan credentials prefer environment values over file template values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharekhan-creds-env-'));
  fs.writeFileSync(path.join(dir, '.sharekhan.properties'), [
    'SHAREKHAN_API_KEY=your_api_key_here',
    'SHAREKHAN_CUSTOMER_ID=your_customer_id_here',
  ].join('\n'), 'utf8');
  const previous = {
    api: process.env.SHAREKHAN_API_KEY,
    customer: process.env.SHAREKHAN_CUSTOMER_ID,
    secret: process.env.SHAREKHAN_SECRET_KEY,
  };
  process.env.SHAREKHAN_API_KEY = 'env-api-key';
  process.env.SHAREKHAN_CUSTOMER_ID = 'env-customer';
  process.env.SHAREKHAN_SECRET_KEY = 'env-secret';
  const { mod, restore } = loadWithHome(dir);
  try {
    const creds = mod.loadSharekhanCredentials({ requireSession:false });
    assert.equal(creds.apiKey, 'env-api-key');
    assert.equal(creds.customerId, 'env-customer');
    assert.equal(creds.secretKey, 'env-secret');
  } finally {
    restore();
    if (previous.api === undefined) delete process.env.SHAREKHAN_API_KEY;
    else process.env.SHAREKHAN_API_KEY = previous.api;
    if (previous.customer === undefined) delete process.env.SHAREKHAN_CUSTOMER_ID;
    else process.env.SHAREKHAN_CUSTOMER_ID = previous.customer;
    if (previous.secret === undefined) delete process.env.SHAREKHAN_SECRET_KEY;
    else process.env.SHAREKHAN_SECRET_KEY = previous.secret;
  }
});
